import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InvoiceInput, InvoiceLineInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { setupBusiness } from './business'
import { deleteInvoice, getInvoice, listInvoices, nextInvoiceNumber, saveInvoice, WALK_IN_ACCOUNT } from './invoices'
import { createItem, getItem } from './items'
import { accountBalance, bankAccount, partyAccount } from './ledger'
import { createParty, getParty } from './parties'
import { CASH_ACCOUNT_ID } from './seed'
import { savePreferences } from './settings'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

let db: DB
let customer: string // Maharashtra, same state as the business
let outOfState: string // Karnataka
let pen: string // ₹10 + 18%, 100 pcs in stock, sold also by box of 12
let gst18: string
let pcs: string
let box: string

const ledgerTotal = () =>
  (db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS n FROM ledger_entry').get() as { n: number }).n

beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '27' }, preferences: {} }, '2025-07-01')
  const units = listUnits(db)
  pcs = units.find((u) => u.short === 'pcs')!.id
  box = units.find((u) => u.short === 'box')!.id
  gst18 = listTaxRates(db).find((t) => t.name === 'GST 18%')!.id
  const base = {
    kind: 'customer' as const, phone: '', email: '', gstin: '', billingAddress: '', shippingAddress: '',
    openingBalance: 0, openingDate: '', creditLimit: null, group: ''
  }
  customer = createParty(db, { ...base, name: 'Ravi', stateCode: '27', paymentTermDays: 30 }).id
  outOfState = createParty(db, { ...base, name: 'Bangalore Mart', stateCode: '29', paymentTermDays: null }).id
  pen = createItem(db, {
    name: 'Pen', code: '', kind: 'goods', category: '', hsnSac: '9608', taxRateId: gst18, priceIncludesTax: false,
    salePrice: 1000, purchasePrice: 700, mrp: null, wholesalePrice: null, wholesaleMinQty: null,
    baseUnitId: pcs, altUnitId: box, altConversion: 12_000, trackStock: true, openingQty: 100_000, openingRate: 700,
    openingDate: '2025-04-01', lowStockQty: null
  }).id
})
afterEach(() => db.close())

const penLine = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  itemId: pen, description: '', qty: 10_000, unitId: pcs, unitFactor: 1000, rate: 1000,
  discountPctBp: 0, discountAmount: 0, taxRateId: gst18, hsnSac: '', ...over
})

const invoice = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  partyId: customer, walkInName: '', number: '', date: '2025-07-10', dueDate: '', placeOfSupply: '',
  pricesIncludeTax: false, lines: [penLine()], charges: [], received: null, notes: '', terms: '', ...over
})

describe('saving a sale invoice', () => {
  it('numbers, totals, posts to the ledger and takes stock out', () => {
    expect(nextInvoiceNumber(db, '2025-07-10')).toBe('INV/25-26/1')
    const inv = saveInvoice(db, null, invoice())
    expect(inv.number).toBe('INV/25-26/1')
    expect(inv).toMatchObject({ taxableTotal: 10_000, cgst: 900, sgst: 900, igst: 0, grandTotal: 11_800, status: 'overdue' }) // dated 2025, so past due today
    expect(inv.dueDate).toBe('2025-08-09') // party terms: 30 days
    expect(inv.lines[0]).toMatchObject({ itemName: 'Pen', description: 'Pen', hsnSac: '9608', unitShort: 'pcs' })
    expect(getParty(db, customer).balance).toBe(11_800)
    expect(accountBalance(db, 'sales')).toBe(-10_000)
    expect(accountBalance(db, 'gst_out:cgst')).toBe(-900)
    expect(ledgerTotal()).toBe(0)
    expect(getItem(db, pen).stockQty).toBe(90_000)
    expect(nextInvoiceNumber(db, '2025-07-11')).toBe('INV/25-26/2')
  })

  it('charges IGST for another state and uses the default due days', () => {
    const inv = saveInvoice(db, null, invoice({ partyId: outOfState }))
    expect(inv).toMatchObject({ supplyType: 'inter', placeOfSupply: '29', igst: 1800, cgst: 0 })
    expect(inv.dueDate).toBe('2025-07-25') // 15 default days
  })

  it('converts boxes to pieces for stock', () => {
    saveInvoice(db, null, invoice({ lines: [penLine({ qty: 2000, unitId: box, unitFactor: 1, rate: 12_000 })] }))
    expect(getItem(db, pen).stockQty).toBe(76_000) // 100 − 2 × 12
  })

  it('records money received now as a payment against the invoice', () => {
    const inv = saveInvoice(db, null, invoice({ received: { amount: 5000, accountId: CASH_ACCOUNT_ID, mode: 'cash', reference: '' } }))
    expect(inv).toMatchObject({ paidAmount: 5000, balanceDue: 6800, status: 'overdue' })
    expect(inv.received).toMatchObject({ amount: 5000, number: 'RCPT/25-26/1' })
    expect(getParty(db, customer).balance).toBe(6800)
    expect(accountBalance(db, bankAccount(CASH_ACCOUNT_ID))).toBe(5000)
    expect(ledgerTotal()).toBe(0)
  })

  it('applies round-off and charges', () => {
    const inv = saveInvoice(db, null, invoice({
      lines: [penLine({ qty: 1000, rate: 1050 })],
      charges: [{ name: 'Delivery', amount: 2000, taxRateId: gst18 }]
    }))
    // 10.50 + 1.89 tax + 20 + 3.60 tax = 35.99 -> 36.00
    expect(inv).toMatchObject({ chargesTotal: 2000, roundOff: 1, grandTotal: 3600 })
    expect(inv.charges[0]).toMatchObject({ name: 'Delivery', tax: 360, taxRateBp: 1800 })
    expect(ledgerTotal()).toBe(0)
  })

  it('handles a cash sale only when paid in full', () => {
    const lines = [penLine({ qty: 1000 })]
    expect(() => saveInvoice(db, null, invoice({ partyId: null, lines }))).toThrow(/paid in full/)
    const inv = saveInvoice(db, null, invoice({
      partyId: null, walkInName: 'Walk-in', lines,
      received: { amount: 1200, accountId: CASH_ACCOUNT_ID, mode: 'upi', reference: 'UTR1' }
    }))
    expect(inv).toMatchObject({ partyName: 'Walk-in', status: 'paid', placeOfSupply: '27' })
    expect(accountBalance(db, WALK_IN_ACCOUNT)).toBe(0)
  })

  it('refuses bad input', () => {
    expect(() => saveInvoice(db, null, invoice({ lines: [] }))).toThrow(/at least one/)
    expect(() => saveInvoice(db, null, invoice({ lines: [penLine({ qty: 0 })] }))).toThrow(/quantity/)
    expect(() => saveInvoice(db, null, invoice({ lines: [penLine({ unitId: listUnits(db)[0].id })] }))).toThrow(/unit/)
    expect(() => saveInvoice(db, null, invoice({ dueDate: '2025-07-01' }))).toThrow(/before/)
    expect(() =>
      saveInvoice(db, null, invoice({ received: { amount: 99_999, accountId: CASH_ACCOUNT_ID, mode: 'cash', reference: '' } }))
    ).toThrow(/more than/)
    expect(listInvoices(db)).toEqual([])
    expect(nextInvoiceNumber(db, '2025-07-10')).toBe('INV/25-26/1') // nothing used up
  })

  it('blocks overselling when negative stock is off', () => {
    savePreferences(db, { allowNegativeStock: false })
    expect(() => saveInvoice(db, null, invoice({ lines: [penLine({ qty: 101_000 })] }))).toThrow(/Not enough stock/)
    expect(getItem(db, pen).stockQty).toBe(100_000)
  })

  it('accepts a typed number, refuses duplicates and skips taken numbers', () => {
    saveInvoice(db, null, invoice({ number: 'INV/25-26/2' }))
    expect(() => saveInvoice(db, null, invoice({ number: 'INV/25-26/2' }))).toThrow(/already used/)
    expect(saveInvoice(db, null, invoice()).number).toBe('INV/25-26/1')
    expect(saveInvoice(db, null, invoice()).number).toBe('INV/25-26/3')
  })

  it('does not charge GST when the business is not registered', () => {
    savePreferences(db, { gstRegistered: false })
    expect(saveInvoice(db, null, invoice()).grandTotal).toBe(10_000)
  })
})

describe('editing and deleting', () => {
  it('re-posts everything on edit and keeps the number', () => {
    const inv = saveInvoice(db, null, invoice({ received: { amount: 1000, accountId: CASH_ACCOUNT_ID, mode: 'cash', reference: '' } }))
    const edited = saveInvoice(db, inv.id, invoice({
      partyId: outOfState, lines: [penLine({ qty: 5000 })],
      received: { amount: 2000, accountId: CASH_ACCOUNT_ID, mode: 'cash', reference: '' }
    }))
    expect(edited.number).toBe(inv.number)
    expect(edited).toMatchObject({ igst: 900, grandTotal: 5900, paidAmount: 2000 })
    expect(edited.received?.number).toBe(inv.received?.number)
    expect(getParty(db, customer).balance).toBe(0)
    expect(getParty(db, outOfState).balance).toBe(3900)
    expect(getItem(db, pen).stockQty).toBe(95_000)
    expect(ledgerTotal()).toBe(0)

    const unpaid = saveInvoice(db, inv.id, invoice({ partyId: outOfState, lines: [penLine({ qty: 5000 })] }))
    expect(unpaid).toMatchObject({ paidAmount: 0, balanceDue: 5900, received: null })
    expect(accountBalance(db, bankAccount(CASH_ACCOUNT_ID))).toBe(0)
  })

  it('deletes an invoice and reverses its effects, without reusing the number', () => {
    const inv = saveInvoice(db, null, invoice({ received: { amount: 1000, accountId: CASH_ACCOUNT_ID, mode: 'cash', reference: '' } }))
    deleteInvoice(db, inv.id)
    expect(listInvoices(db)).toEqual([])
    expect(() => getInvoice(db, inv.id)).toThrow(/not found/)
    expect(getParty(db, customer).balance).toBe(0)
    expect(getItem(db, pen).stockQty).toBe(100_000)
    expect(accountBalance(db, bankAccount(CASH_ACCOUNT_ID))).toBe(0)
    expect(saveInvoice(db, null, invoice()).number).toBe('INV/25-26/2')
  })

  it('protects items and parties used on invoices', () => {
    saveInvoice(db, null, invoice())
    expect(getItem(db, pen).hasTransactions).toBe(true)
    expect(getParty(db, customer).hasTransactions).toBe(true)
  })

  it('lists invoices by date with overdue status', () => {
    saveInvoice(db, null, invoice({ date: '2025-06-01', dueDate: '2025-06-10' }))
    saveInvoice(db, null, invoice({ date: '2025-07-10' }))
    const all = listInvoices(db, {}, '2025-07-15')
    expect(all.map((i) => i.date)).toEqual(['2025-07-10', '2025-06-01'])
    expect(all[1].status).toBe('overdue')
    expect(all[0].status).toBe('unpaid')
    expect(listInvoices(db, {}, '2025-06-05').find((i) => i.date === '2025-06-01')?.status).toBe('unpaid')
    expect(listInvoices(db, { from: '2025-07-01', to: '2025-07-31' })).toHaveLength(1)
    expect(listInvoices(db, { partyId: outOfState })).toHaveLength(0)
  })

  it('starts a new number series in the next financial year', () => {
    saveInvoice(db, null, invoice())
    expect(saveInvoice(db, null, invoice({ date: '2026-04-02' })).number).toBe('INV/26-27/1')
  })

  it('leaves partyAccount untouched for other parties', () => {
    saveInvoice(db, null, invoice())
    expect(accountBalance(db, partyAccount(outOfState))).toBe(0)
  })
})
