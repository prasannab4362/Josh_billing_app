import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountInput, InvoiceInput, PaymentInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { migrations } from '../db/migrations'
import { openDatabase, type DB } from '../db/connection'
import {
  createAccount, createTransfer, deactivateAccount, deleteTransfer, listAccountsWithBalance, updateAccount
} from './accounts'
import { setupBusiness } from './business'
import { deleteInvoice, getInvoice, saveInvoice } from './invoices'
import { createParty, getParty } from './parties'
import { autoAllocate, deletePayment, getPayment, listPayments, nextPaymentNumber, openDocuments, savePayment } from './payments'
import { CASH_ACCOUNT_ID } from './seed'
import { accountStatement, partyStatement } from './statements'

let db: DB
let ravi: string
let supplier: string
const ledgerTotal = () =>
  (db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS n FROM ledger_entry').get() as { n: number }).n
const cash = () => listAccountsWithBalance(db).find((a) => a.id === CASH_ACCOUNT_ID)!.balance

beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '27' }, preferences: { roundOff: false } }, '2025-07-01')
  const base = {
    phone: '', email: '', gstin: '', stateCode: '27', billingAddress: '', shippingAddress: '',
    creditLimit: null, paymentTermDays: null, group: ''
  }
  ravi = createParty(db, { ...base, name: 'Ravi', kind: 'customer', openingBalance: 20_000, openingDate: '2025-04-01' }).id
  supplier = createParty(db, { ...base, name: 'Supplier', kind: 'supplier', openingBalance: -30_000, openingDate: '2025-04-01' }).id
})
afterEach(() => db.close())

/** A ₹ amount (no GST) invoice for Ravi. */
const invoice = (rupees: number, date: string): string => {
  const input: InvoiceInput = {
    partyId: ravi, walkInName: '', number: '', date, dueDate: '', placeOfSupply: '', pricesIncludeTax: false,
    lines: [{ itemId: null, description: 'Work', qty: 1000, unitId: null, unitFactor: 1000, rate: rupees * 100, discountPctBp: 0, discountAmount: 0, taxRateId: null, hsnSac: '' }],
    charges: [], received: null, notes: '', terms: ''
  }
  return saveInvoice(db, null, input).id
}

const payIn = (amount: number, allocations: PaymentInput['allocations'] = [], over: Partial<PaymentInput> = {}): PaymentInput => ({
  direction: 'in', partyId: ravi, number: '', date: '2025-07-20', amount, accountId: CASH_ACCOUNT_ID, mode: 'cash',
  reference: '', notes: '', allocations, ...over
})

describe('payments in', () => {
  it('settles invoices oldest first and updates balances', () => {
    const a = invoice(1000, '2025-07-01')
    const b = invoice(500, '2025-07-05')
    const open = openDocuments(db, ravi, 'in')
    expect(open.map((d) => d.open)).toEqual([100_000, 50_000])
    const allocations = autoAllocate(open, 120_000)
    expect(allocations).toEqual([{ documentId: a, amount: 100_000 }, { documentId: b, amount: 20_000 }])

    expect(nextPaymentNumber(db, 'in', '2025-07-20')).toBe('RCPT/25-26/1')
    const p = savePayment(db, null, payIn(120_000, allocations))
    expect(p).toMatchObject({ number: 'RCPT/25-26/1', allocated: 120_000, unallocated: 0, accountName: 'Cash in hand' })
    expect(getInvoice(db, a)).toMatchObject({ status: 'paid', balanceDue: 0 })
    expect(getInvoice(db, b)).toMatchObject({ paidAmount: 20_000, balanceDue: 30_000 })
    expect(getParty(db, ravi).balance).toBe(20_000 + 150_000 - 120_000)
    expect(cash()).toBe(120_000)
    expect(ledgerTotal()).toBe(0)
  })

  it('keeps unallocated money as an advance', () => {
    const p = savePayment(db, null, payIn(50_000))
    expect(p.unallocated).toBe(50_000)
    expect(getParty(db, ravi).balance).toBe(-30_000) // ₹200 owed − ₹500 paid
  })

  it('refuses over-allocation and bills of other parties', () => {
    const a = invoice(100, '2025-07-01')
    expect(() => savePayment(db, null, payIn(5000, [{ documentId: a, amount: 8000 }]))).toThrow(/more than the payment/)
    expect(() => savePayment(db, null, payIn(50_000, [{ documentId: a, amount: 20_000 }]))).toThrow(/Only 100.00 is due/)
    expect(() => savePayment(db, null, payIn(5000, [{ documentId: a, amount: 5000 }], { partyId: supplier }))).toThrow(/not open/)
    expect(() => savePayment(db, null, payIn(0))).toThrow(/more than 0/)
    expect(listPayments(db)).toEqual([])
  })

  it('edits a payment, moving its allocation, and deletes it', () => {
    const a = invoice(1000, '2025-07-01')
    const b = invoice(1000, '2025-07-02')
    const p = savePayment(db, null, payIn(100_000, [{ documentId: a, amount: 100_000 }]))
    // While editing, this payment's own share counts as open on bill a.
    expect(openDocuments(db, ravi, 'in', p.id).find((d) => d.id === a)?.open).toBe(100_000)
    const edited = savePayment(db, p.id, payIn(60_000, [{ documentId: b, amount: 60_000 }]))
    expect(edited.number).toBe(p.number)
    expect(getInvoice(db, a).status).not.toBe('paid')
    expect(getInvoice(db, b).paidAmount).toBe(60_000)
    deletePayment(db, p.id)
    expect(getInvoice(db, b).paidAmount).toBe(0)
    expect(cash()).toBe(0)
    expect(ledgerTotal()).toBe(0)
  })

  it('leaves payments taken on an invoice to that invoice', () => {
    const input: InvoiceInput = {
      ...getInvoice(db, invoice(100, '2025-07-01')),
      walkInName: '', number: '', dueDate: '', placeOfSupply: '',
      lines: [{ itemId: null, description: 'Work', qty: 1000, unitId: null, unitFactor: 1000, rate: 10_000, discountPctBp: 0, discountAmount: 0, taxRateId: null, hsnSac: '' }],
      charges: [], received: { amount: 10_000, accountId: CASH_ACCOUNT_ID, mode: 'cash', reference: '' }
    }
    const inv = saveInvoice(db, null, input)
    const src = listPayments(db).find((p) => p.sourceDocId === inv.id)!
    expect(src.sourceDocNumber).toBe(inv.number)
    expect(() => deletePayment(db, src.id)).toThrow(/Change it on that invoice/)
    expect(() => savePayment(db, src.id, payIn(1))).toThrow(/Change it on that invoice/)
  })

  it('stops an invoice from being deleted while a payment is set against it', () => {
    const a = invoice(100, '2025-07-01')
    const p = savePayment(db, null, payIn(10_000, [{ documentId: a, amount: 10_000 }]))
    expect(() => deleteInvoice(db, a)).toThrow(/Remove them/)
    deletePayment(db, p.id)
    deleteInvoice(db, a)
  })

  it('lists payments by party and direction', () => {
    savePayment(db, null, payIn(1000))
    savePayment(db, null, payIn(2000, [], { direction: 'out', partyId: supplier }))
    expect(listPayments(db, { direction: 'in' })).toHaveLength(1)
    expect(listPayments(db, { partyId: supplier })[0].number).toBe('PAY/25-26/1')
    expect(getPayment(db, listPayments(db, { partyId: supplier })[0].id).direction).toBe('out')
  })
})

describe('payments out', () => {
  it('reduces what we owe the supplier and takes money out of the account', () => {
    savePayment(db, null, payIn(30_000, [], { direction: 'out', partyId: supplier }))
    expect(getParty(db, supplier).balance).toBe(0)
    expect(cash()).toBe(-30_000)
    expect(ledgerTotal()).toBe(0)
  })
})

describe('statements', () => {
  it('shows a party statement with running balance and period opening', () => {
    const a = invoice(1000, '2025-07-01')
    savePayment(db, null, payIn(40_000, [{ documentId: a, amount: 40_000 }], { date: '2025-07-10' }))
    const s = partyStatement(db, ravi)
    expect(s.rows.map((r) => [r.label, r.debit, r.credit, r.balance])).toEqual([
      ['Opening balance', 20_000, 0, 20_000],
      ['Sale invoice', 100_000, 0, 120_000],
      ['Payment received', 0, 40_000, 80_000]
    ])
    expect(s.rows[1].number).toBe('INV/25-26/1')
    const july = partyStatement(db, ravi, { from: '2025-07-05' })
    expect(july.openingBalance).toBe(120_000)
    expect(july.rows).toHaveLength(1)
    expect(july.closingBalance).toBe(80_000)
  })

  it('shows an account statement naming the party', () => {
    savePayment(db, null, payIn(1000))
    expect(accountStatement(db, CASH_ACCOUNT_ID).rows[0]).toMatchObject({ label: 'Payment received · Ravi', debit: 1000, balance: 1000 })
  })
})

describe('cash & bank accounts', () => {
  const bank = (over: Partial<AccountInput> = {}): AccountInput => ({
    kind: 'bank', name: 'HDFC Current', bankName: 'HDFC', accountNo: '50100012345', ifsc: 'hdfc0001234', upiId: '',
    openingBalance: 500_000, openingDate: '2025-04-01', isDefaultForPrint: true, ...over
  })

  it('creates an account with its opening balance in the ledger', () => {
    const a = createAccount(db, bank())
    expect(a).toMatchObject({ balance: 500_000, ifsc: 'HDFC0001234', isDefaultForPrint: true })
    expect(() => createAccount(db, bank({ isDefaultForPrint: false }))).toThrow(/already exists/)
    expect(() => createAccount(db, bank({ name: 'X', ifsc: 'bad' }))).toThrow(/IFSC/)
    const e = updateAccount(db, a.id, bank({ openingBalance: 100_000 }))
    expect(e.balance).toBe(100_000)
    expect(ledgerTotal()).toBe(0)
  })

  it('transfers money between accounts and can undo it', () => {
    const a = createAccount(db, bank())
    const t = createTransfer(db, { fromAccountId: a.id, toAccountId: CASH_ACCOUNT_ID, amount: 200_000, date: '2025-07-01', notes: 'ATM' })
    expect(cash()).toBe(200_000)
    expect(accountStatement(db, CASH_ACCOUNT_ID).rows[0].label).toBe('Transfer from HDFC Current · ATM')
    expect(accountStatement(db, a.id).rows[1].label).toBe('Transfer to Cash in hand · ATM')
    expect(() => createTransfer(db, { fromAccountId: a.id, toAccountId: a.id, amount: 1, date: '2025-07-01', notes: '' })).toThrow(/different/)
    deleteTransfer(db, t)
    expect(cash()).toBe(0)
  })

  it('removes only an empty account, never cash', () => {
    const a = createAccount(db, bank())
    expect(() => deactivateAccount(db, a.id)).toThrow(/Move the money/)
    expect(() => deactivateAccount(db, CASH_ACCOUNT_ID)).toThrow(/cannot be removed/)
    updateAccount(db, a.id, bank({ openingBalance: 0 }))
    deactivateAccount(db, a.id)
    expect(listAccountsWithBalance(db).map((x) => x.id)).toEqual([CASH_ACCOUNT_ID])
  })

  it('moves bank opening balances of older files into the ledger when upgrading', () => {
    const old = openDatabase(':memory:', migrations.slice(0, 3))
    setupBusiness(
      old, 'b', {
        profile: { ...EMPTY_TEST_PROFILE, name: 'Old', stateCode: '27' }, preferences: {},
        bankAccount: { kind: 'bank', name: 'SBI', bankName: '', accountNo: '', ifsc: '', upiId: '', openingBalance: 70_000 }
      }, '2025-04-01'
    )
    // Simulate a file made before version 4, when bank openings were not posted.
    old.prepare(`DELETE FROM ledger_entry WHERE source_type = 'opening'`).run()
    old.exec(migrations[3].sql)
    expect(listAccountsWithBalance(old).find((x) => x.name === 'SBI')?.balance).toBe(70_000)
    expect((old.prepare('SELECT SUM(debit - credit) AS n FROM ledger_entry').get() as { n: number }).n).toBe(0)
    old.close()
  })
})
