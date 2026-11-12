import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BillType, ExpenseInput, InvoiceInput, InvoiceLineInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { accountStatement } from './statements'
import { setupBusiness } from './business'
import { deleteExpense, listExpenseCategories, listExpenses, saveExpense } from './expenses'
import { deleteBill, getBill, saveBill } from './invoices'
import { createItem, getItem } from './items'
import { accountBalance, bankAccount } from './ledger'
import { createParty, getParty } from './parties'
import { openDocuments } from './payments'
import { dayBook, gstSummary, itemSales, profitLoss } from './reports'
import { CASH_ACCOUNT_ID } from './seed'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

let db: DB
let ravi: string
let mill: string
let rice: string
let gst5: string
let gst18: string
const ledgerTotal = () => (db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS n FROM ledger_entry').get() as { n: number }).n
const ledgerRows = (id: string) => (db.prepare('SELECT COUNT(*) AS n FROM ledger_entry WHERE source_id = ?').get(id) as { n: number }).n

const line = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  itemId: rice, description: '', qty: 30_000, unitId: null, unitFactor: 1000, rate: 10_000, discountPctBp: 0,
  discountAmount: 0, taxRateId: gst5, hsnSac: '', ...over
})
const doc = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  partyId: ravi, walkInName: '', number: '', date: '2025-07-10', dueDate: '', placeOfSupply: '',
  pricesIncludeTax: false, lines: [line()], charges: [], received: null, notes: '', terms: '', ...over
})
const save = (type: BillType, over: Partial<InvoiceInput> = {}, id: string | null = null) => saveBill(db, type, id, doc(over))
const cash = (amount: number) => ({ amount, accountId: CASH_ACCOUNT_ID, mode: 'cash' as const, reference: '' })

beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '27' }, preferences: { roundOff: false } }, '2025-04-01')
  const rates = listTaxRates(db)
  gst5 = rates.find((t) => t.name === 'GST 5%')!.id
  gst18 = rates.find((t) => t.name === 'GST 18%')!.id
  const kg = listUnits(db).find((u) => u.short === 'kg')!.id
  const base = {
    phone: '', email: '', gstin: '', billingAddress: '', shippingAddress: '', openingBalance: 0, openingDate: '',
    creditLimit: null, paymentTermDays: null, group: '', stateCode: '27'
  }
  ravi = createParty(db, { ...base, name: 'Ravi', kind: 'customer' }).id
  mill = createParty(db, { ...base, name: 'Local Mill', kind: 'supplier' }).id
  rice = createItem(db, {
    name: 'Rice', code: '', kind: 'goods', category: '', hsnSac: '1006', taxRateId: gst5, priceIncludesTax: false,
    salePrice: 10_000, purchasePrice: 8000, mrp: null, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: kg,
    altUnitId: null, altConversion: null, trackStock: true, openingQty: 100_000, openingRate: 8000, openingDate: '2025-04-01',
    lowStockQty: null
  }).id
})
afterEach(() => db.close())

describe('estimates, orders and challans', () => {
  it('are numbered but touch neither the ledger nor stock, and take no money', () => {
    const est = save('ESTIMATE')
    expect(est).toMatchObject({ type: 'ESTIMATE', number: 'EST/25-26/1', status: 'open', grandTotal: 315_000, balanceDue: 0 })
    expect(ledgerRows(est.id)).toBe(0)
    expect(getItem(db, rice).stockQty).toBe(100_000)
    expect(getParty(db, ravi).balance).toBe(0)
    expect(() => save('ESTIMATE', { received: cash(1000) })).toThrow(/not taken on a estimate/)
    expect(save('DELIVERY_CHALLAN', { partyId: null, walkInName: 'Counter' }).number).toBe('DC/25-26/1')
    expect(save('PURCHASE_ORDER', { partyId: mill }).number).toBe('PO/25-26/1')
    expect(() => save('PURCHASE_ORDER', { partyId: null })).toThrow(/supplier/)
  })

  it('convert estimate → order → invoice, and reopen when the invoice is deleted', () => {
    const est = save('ESTIMATE')
    const so = save('SALE_ORDER', { linkedId: est.id })
    expect(getBill(db, 'ESTIMATE', est.id)).toMatchObject({ status: 'converted', links: [{ id: so.id, type: 'SALE_ORDER', direction: 'to', kind: 'converted' }] })
    expect(() => save('SALE_INVOICE', { linkedId: est.id })).toThrow(/already been converted/)
    const inv = save('SALE_INVOICE', { linkedId: so.id })
    expect(inv.links).toMatchObject([{ id: so.id, number: 'SO/25-26/1', direction: 'from' }])
    expect(getBill(db, 'SALE_ORDER', so.id).status).toBe('converted')
    expect(getItem(db, rice).stockQty).toBe(70_000)
    deleteBill(db, 'SALE_INVOICE', inv.id)
    expect(getBill(db, 'SALE_ORDER', so.id)).toMatchObject({ status: 'open', links: [{ id: est.id }] })
  })

  it('only convert into the kinds that make sense', () => {
    const dc = save('DELIVERY_CHALLAN')
    expect(() => save('PURCHASE_BILL', { partyId: mill, number: 'X1', linkedId: dc.id })).toThrow(/cannot be turned into a bill/)
    const po = save('PURCHASE_ORDER', { partyId: mill })
    expect(save('PURCHASE_BILL', { partyId: mill, number: 'LM-9', linkedId: po.id }).links[0].id).toBe(po.id)
  })
})

describe('credit notes (sale returns)', () => {
  it('reduce what is due on the invoice, bring stock back and reverse sales and GST', () => {
    const inv = save('SALE_INVOICE', { dueDate: '2025-07-30' }) // 30 kg × ₹100 + 5% = ₹3,150
    const cn = save('SALE_RETURN', { lines: [line({ qty: 10_000 })], linkedId: inv.id }) // ₹1,050
    expect(cn).toMatchObject({ number: 'CN/25-26/1', grandTotal: 105_000, paidAmount: 105_000, status: 'paid' })
    expect(cn.links).toMatchObject([{ id: inv.id, kind: 'returned', direction: 'from', amount: 105_000 }])
    expect(getBill(db, 'SALE_INVOICE', inv.id)).toMatchObject({ paidAmount: 105_000, balanceDue: 210_000, status: 'overdue' })
    expect(getParty(db, ravi).balance).toBe(210_000)
    expect(getItem(db, rice).stockQty).toBe(80_000)
    expect(accountBalance(db, 'sales')).toBe(-200_000)
    expect(accountBalance(db, 'gst_out:cgst')).toBe(-5000)
    expect(ledgerTotal()).toBe(0)
    expect(() => deleteBill(db, 'SALE_INVOICE', inv.id)).toThrow(/Delete the return first/)

    // A bigger return than what is due leaves the rest open on the note, to refund.
    save('SALE_RETURN', { lines: [line({ qty: 40_000 })] }, cn.id) // ₹4,200 against ₹3,150 due
    expect(getBill(db, 'SALE_INVOICE', inv.id)).toMatchObject({ balanceDue: 0, status: 'paid' })
    expect(getBill(db, 'SALE_RETURN', cn.id)).toMatchObject({ paidAmount: 315_000, balanceDue: 105_000, status: 'partial' })
    expect(openDocuments(db, ravi, 'out').map((d) => [d.number, d.open])).toEqual([['CN/25-26/1', 105_000]])

    deleteBill(db, 'SALE_RETURN', cn.id)
    expect(getBill(db, 'SALE_INVOICE', inv.id)).toMatchObject({ balanceDue: 315_000, status: 'overdue', links: [] })
    expect(getItem(db, rice).stockQty).toBe(70_000)
  })

  it('can refund money straight away, and needs a party and a sale invoice', () => {
    const inv = save('SALE_INVOICE', { received: cash(315_000) })
    const cn = save('SALE_RETURN', { lines: [line({ qty: 10_000 })], linkedId: inv.id, received: cash(105_000) })
    expect(cn).toMatchObject({ status: 'paid', received: { number: 'PAY/25-26/1', amount: 105_000 } })
    expect(accountBalance(db, bankAccount(CASH_ACCOUNT_ID))).toBe(210_000)
    expect(getParty(db, ravi).balance).toBe(0)
    expect(() => save('SALE_RETURN', { partyId: null })).toThrow(/Choose the party/)
    const bill = save('PURCHASE_BILL', { partyId: mill, number: 'B1' })
    expect(() => save('SALE_RETURN', { linkedId: bill.id })).toThrow(/against a invoice/)
  })
})

describe('debit notes (purchase returns)', () => {
  it('reduce what we owe the supplier and take stock back out', () => {
    const bill = save('PURCHASE_BILL', { partyId: mill, number: 'LM-1', lines: [line({ qty: 40_000, rate: 9000 })] }) // ₹3,780
    const dn = save('PURCHASE_RETURN', { partyId: mill, lines: [line({ qty: 5000, rate: 9000 })], linkedId: bill.id }) // ₹472.50
    expect(dn).toMatchObject({ number: 'DN/25-26/1', grandTotal: 47_250, status: 'paid' })
    expect(getBill(db, 'PURCHASE_BILL', bill.id)).toMatchObject({ balanceDue: 330_750, status: 'overdue' })
    expect(getParty(db, mill).balance).toBe(-330_750)
    expect(getItem(db, rice).stockQty).toBe(135_000)
    expect(accountBalance(db, 'purchase')).toBe(315_000)
    expect(accountBalance(db, 'gst_in:cgst')).toBe(7875)
    expect(ledgerTotal()).toBe(0)
  })
})

describe('expenses', () => {
  const exp = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
    date: '2025-07-31', category: 'Rent', amount: 1_000_000, taxRateId: null, accountId: CASH_ACCOUNT_ID, paidTo: 'Landlord',
    reference: '', notes: '', ...over
  })

  it('come out of cash or bank, with GST as input credit', () => {
    saveExpense(db, null, exp())
    const e = saveExpense(db, null, exp({ category: 'Electricity', amount: 200_000, taxRateId: gst18, paidTo: '', reference: 'MSEB-7' }))
    expect(e).toMatchObject({ cgst: 18_000, sgst: 18_000, total: 236_000, reference: 'MSEB-7', accountName: 'Cash in hand' })
    expect(accountBalance(db, 'expense')).toBe(1_200_000)
    expect(accountBalance(db, 'gst_in:cgst')).toBe(18_000)
    expect(accountBalance(db, bankAccount(CASH_ACCOUNT_ID))).toBe(-1_236_000)
    expect(ledgerTotal()).toBe(0)
    expect(accountStatement(db, CASH_ACCOUNT_ID).rows.map((r) => r.label)).toEqual(['Expense · Landlord', 'Expense · Electricity'])
    expect(listExpenses(db, { from: '2025-07-01', to: '2025-07-31' })).toHaveLength(2)
  })

  it('edit, delete and remember new categories', () => {
    const e = saveExpense(db, null, exp({ category: 'Diwali gifts' }))
    expect(listExpenseCategories(db)).toContain('Diwali gifts')
    saveExpense(db, e.id, exp({ category: 'Diwali gifts', amount: 50_000 }))
    expect(accountBalance(db, 'expense')).toBe(50_000)
    deleteExpense(db, e.id)
    expect(accountBalance(db, 'expense')).toBe(0)
    expect(listExpenses(db)).toEqual([])
    expect(() => saveExpense(db, null, exp({ amount: 0 }))).toThrow(/more than 0/)
    expect(() => saveExpense(db, null, exp({ category: ' ' }))).toThrow(/category/)
  })
})

describe('reports with returns and expenses', () => {
  beforeEach(() => {
    const bill = save('PURCHASE_BILL', { partyId: mill, number: 'LM-1', date: '2025-07-05', lines: [line({ qty: 40_000, rate: 9000 })] })
    save('PURCHASE_RETURN', { partyId: mill, date: '2025-07-06', lines: [line({ qty: 5000, rate: 9000 })], linkedId: bill.id })
    const inv = save('SALE_INVOICE')
    save('SALE_RETURN', { date: '2025-07-12', lines: [line({ qty: 10_000 })], linkedId: inv.id })
    saveExpense(db, null, {
      date: '2025-07-31', category: 'Electricity', amount: 200_000, taxRateId: gst18, accountId: CASH_ACCOUNT_ID, paidTo: '', reference: '', notes: ''
    })
  })

  it('P&L nets returns and takes off expenses', () => {
    const p = profitLoss(db, { from: '2025-07-01', to: '2025-07-31' })
    // Sales 3,000 − 1,000; purchases 3,600 − 450; expenses 2,000.
    expect(p).toMatchObject({ sales: 200_000, purchases: 315_000, totalExpenses: 200_000, expenses: [{ category: 'Electricity', amount: 200_000 }] })
    expect(p.netProfit).toBe(p.grossProfit - 200_000)
  })

  it('GST summary nets credit and debit notes and counts GST on expenses', () => {
    const g = gstSummary(db, { from: '2025-07-01', to: '2025-07-31' })
    expect(g.outward).toMatchObject({ taxable: 200_000, cgst: 5000, bills: 2 })
    // Purchases 9,000 − 1,125 (debit note) + 18,000 (electricity) of CGST.
    expect(g.inward).toMatchObject({ taxable: 315_000 + 200_000, cgst: 9000 - 1125 + 18_000, bills: 3 })
  })

  it('item sales are net of returns, and the day book lists everything', () => {
    expect(itemSales(db, {}).rows[0]).toMatchObject({ qty: 20_000, sales: 200_000 })
    const b = dayBook(db, { from: '2025-07-01', to: '2025-07-31' })
    expect(b.rows.map((r) => r.kind)).toEqual(['purchase', 'purchase_return', 'sale', 'sale_return', 'expense'])
    expect(b).toMatchObject({ sales: 315_000 - 105_000, moneyOut: 236_000 })
  })
})
