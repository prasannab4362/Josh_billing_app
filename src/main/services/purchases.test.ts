import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InvoiceInput, InvoiceLineInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { listAccountsWithBalance } from './accounts'
import { setupBusiness } from './business'
import { createAdjustment, deleteAdjustment, stockSummary } from './inventory'
import { deletePurchase, getPurchase, listInvoices, listPurchases, saveInvoice, savePurchase } from './invoices'
import { createItem, getItem } from './items'
import { accountBalance } from './ledger'
import { createParty, getParty } from './parties'
import { openDocuments, savePayment } from './payments'
import { CASH_ACCOUNT_ID } from './seed'
import { savePreferences } from './settings'
import { listMovements } from './stock'
import { partyStatement } from './statements'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

let db: DB
let local: string // supplier in Maharashtra (our state)
let delhi: string // supplier in Delhi
let customer: string
let rice: string // kg, 5% GST, 10 kg opening at ₹80
let gst5: string
const ledgerTotal = () =>
  (db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS n FROM ledger_entry').get() as { n: number }).n

beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '27' }, preferences: { roundOff: false } }, '2025-07-01')
  gst5 = listTaxRates(db).find((t) => t.name === 'GST 5%')!.id
  const kg = listUnits(db).find((u) => u.short === 'kg')!.id
  const base = {
    phone: '', email: '', gstin: '', billingAddress: '', shippingAddress: '', openingBalance: 0, openingDate: '',
    creditLimit: null, paymentTermDays: null, group: ''
  }
  local = createParty(db, { ...base, name: 'Local Mill', kind: 'supplier', stateCode: '27' }).id
  delhi = createParty(db, { ...base, name: 'Delhi Traders', kind: 'supplier', stateCode: '07' }).id
  customer = createParty(db, { ...base, name: 'Ravi', kind: 'customer', stateCode: '27' }).id
  rice = createItem(db, {
    name: 'Rice', code: '', kind: 'goods', category: 'Grocery', hsnSac: '1006', taxRateId: gst5, priceIncludesTax: false,
    salePrice: 9500, purchasePrice: 8000, mrp: null, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: kg,
    altUnitId: null, altConversion: null, trackStock: true, openingQty: 10_000, openingRate: 8000, openingDate: '2025-04-01',
    lowStockQty: 20_000
  }).id
})
afterEach(() => db.close())

const line = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  itemId: rice, description: '', qty: 40_000, unitId: null, unitFactor: 1000, rate: 9000, discountPctBp: 0,
  discountAmount: 0, taxRateId: gst5, hsnSac: '', ...over
})
const bill = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  partyId: local, walkInName: '', number: 'LM-101', date: '2025-07-05', dueDate: '', placeOfSupply: '',
  pricesIncludeTax: false, lines: [line()], charges: [], received: null, notes: '', terms: '', ...over
})

describe('purchase bills', () => {
  it('adds stock at cost, books input GST and what we owe', () => {
    const b = savePurchase(db, null, bill())
    // 40 kg × ₹90 = ₹3,600 + 5% = ₹3,780
    expect(b).toMatchObject({ number: 'LM-101', taxableTotal: 360_000, cgst: 9000, sgst: 9000, grandTotal: 378_000, supplyType: 'intra' })
    expect(getParty(db, local).balance).toBe(-378_000)
    expect(accountBalance(db, 'purchase')).toBe(360_000)
    expect(accountBalance(db, 'gst_in:cgst')).toBe(9000)
    expect(ledgerTotal()).toBe(0)
    // 10 kg at ₹80 + 40 kg at ₹90 → 50 kg, average ₹88, value ₹4,400
    expect(getItem(db, rice)).toMatchObject({ stockQty: 50_000, stockValue: 440_000 })
    expect(listMovements(db, rice)[1]).toMatchObject({ label: 'Purchase bill · Local Mill', number: 'LM-101', qtyChange: 40_000, rate: 9000 })
    expect(listInvoices(db)).toEqual([])
    expect(listPurchases(db)).toHaveLength(1)
  })

  it('charges IGST when the supplier is in another state', () => {
    expect(savePurchase(db, null, bill({ partyId: delhi }))).toMatchObject({ supplyType: 'inter', igst: 18_000, placeOfSupply: '27' })
  })

  it('needs a supplier, lets bill numbers repeat across suppliers but not for the same one', () => {
    expect(() => savePurchase(db, null, bill({ partyId: null }))).toThrow(/supplier/)
    savePurchase(db, null, bill())
    savePurchase(db, null, bill({ partyId: delhi }))
    expect(() => savePurchase(db, null, bill())).toThrow(/already entered/)
    expect(savePurchase(db, null, bill({ number: '' })).number).toBe('')
  })

  it('records money paid now as a payment out', () => {
    const b = savePurchase(db, null, bill({ received: { amount: 100_000, accountId: CASH_ACCOUNT_ID, mode: 'cash', reference: '' } }))
    expect(b).toMatchObject({ paidAmount: 100_000, balanceDue: 278_000 })
    expect(b.received?.number).toBe('PAY/25-26/1')
    expect(listAccountsWithBalance(db).find((a) => a.id === CASH_ACCOUNT_ID)!.balance).toBe(-100_000)
    expect(getParty(db, local).balance).toBe(-278_000)
    expect(ledgerTotal()).toBe(0)
  })

  it('is settled by payments out from the Payments page', () => {
    const b = savePurchase(db, null, bill())
    const open = openDocuments(db, local, 'out')
    expect(open.map((d) => d.id)).toEqual([b.id])
    savePayment(db, null, {
      direction: 'out', partyId: local, number: '', date: '2025-07-10', amount: 378_000, accountId: CASH_ACCOUNT_ID,
      mode: 'bank', reference: 'UTR9', notes: '', allocations: [{ documentId: b.id, amount: 378_000 }]
    })
    expect(getPurchase(db, b.id).status).toBe('paid')
    expect(getParty(db, local).balance).toBe(0)
    expect(partyStatement(db, local).rows.map((r) => r.label)).toEqual(['Purchase bill', 'Payment made'])
  })

  it('edits and deletes, taking the stock back out', () => {
    const b = savePurchase(db, null, bill())
    savePurchase(db, b.id, bill({ lines: [line({ qty: 20_000 })] }))
    expect(getItem(db, rice).stockQty).toBe(30_000)
    deletePurchase(db, b.id)
    expect(getItem(db, rice).stockQty).toBe(10_000)
    expect(getParty(db, local).balance).toBe(0)
    expect(ledgerTotal()).toBe(0)
  })

  it('will not delete a purchase whose stock is already sold when negative stock is off', () => {
    savePreferences(db, { allowNegativeStock: false })
    const b = savePurchase(db, null, bill())
    saveInvoice(db, null, {
      ...bill({ partyId: customer, number: '' }), lines: [line({ qty: 45_000, rate: 9500 })]
    })
    expect(() => deletePurchase(db, b.id)).toThrow(/Not enough stock of Rice/)
    expect(getItem(db, rice).stockQty).toBe(5000)
  })
})

describe('stock adjustments', () => {
  it('adds and removes stock with a reason and can be undone', () => {
    const add = createAdjustment(db, { itemId: rice, date: '2025-07-02', qtyChange: 5000, rate: null, reason: 'Found in godown' })
    expect(getItem(db, rice).stockQty).toBe(15_000)
    expect(listMovements(db, rice)[1]).toMatchObject({ label: 'Adjustment · Found in godown', rate: 8000 })
    createAdjustment(db, { itemId: rice, date: '2025-07-03', qtyChange: -2500, rate: null, reason: 'Damaged' })
    expect(getItem(db, rice).stockQty).toBe(12_500)
    deleteAdjustment(db, add)
    expect(getItem(db, rice).stockQty).toBe(7500)
    expect(getItem(db, rice).hasTransactions).toBe(true)
  })

  it('refuses bad adjustments', () => {
    expect(() => createAdjustment(db, { itemId: rice, date: '2025-07-02', qtyChange: 0, rate: null, reason: '' })).toThrow(/quantity/)
    savePreferences(db, { allowNegativeStock: false })
    expect(() => createAdjustment(db, { itemId: rice, date: '2025-07-02', qtyChange: -20_000, rate: null, reason: '' })).toThrow(/Not enough/)
    expect(getItem(db, rice).stockQty).toBe(10_000)
  })
})

describe('stock summary', () => {
  it('values stock at average cost on any date and flags low stock', () => {
    savePurchase(db, null, bill({ date: '2025-07-05' }))
    const before = stockSummary(db, '2025-07-01')
    expect(before.rows[0]).toMatchObject({ name: 'Rice', qty: 10_000, avgCost: 8000, value: 80_000, saleValue: 95_000, low: true })
    const after = stockSummary(db, '2025-07-31')
    expect(after.rows[0]).toMatchObject({ qty: 50_000, avgCost: 8800, value: 440_000, low: false })
    expect(after).toMatchObject({ totalValue: 440_000, lowCount: 0 })
  })
})
