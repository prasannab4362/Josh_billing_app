import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InvoiceInput, InvoiceLineInput } from '@shared/models'
import { reportCsv, reportHtml, type ReportDoc } from '@shared/reportDoc'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { setupBusiness } from './business'
import { createAdjustment } from './inventory'
import { deleteInvoice, saveInvoice, savePurchase } from './invoices'
import { createItem } from './items'
import { createParty } from './parties'
import { savePayment } from './payments'
import { ageing, billRegister, dashboard, dayBook, gstSummary, itemSales, profitLoss } from './reports'
import { CASH_ACCOUNT_ID } from './seed'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

// A month of trading for one shop (Maharashtra), seen from 14 Aug 2025:
//   opening stock     10 kg rice at ₹80 (1 Apr)
//   5 Jul  purchase   40 kg at ₹90 + 5% from Local Mill            = ₹3,780.00 (unpaid)
//  10 Jul  sale       30 kg at ₹100 + 5%, delivery ₹100 + 18% to Ravi = ₹3,268.00 (due the same day)
//   1 Aug  Ravi pays  ₹1,000
//   2 Aug  2 kg damaged
//  14 Aug  cash sale  5 kg at ₹100 + 5%, paid in cash               = ₹525.00
// plus an old customer who owes ₹5,000 from before we started using the app.
const TODAY = '2025-08-14'
let db: DB
let ravi: string
let mill: string
let rice: string
let gst5: string
let gst18: string

const line = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  itemId: rice, description: '', qty: 30_000, unitId: null, unitFactor: 1000, rate: 10_000, discountPctBp: 0,
  discountAmount: 0, taxRateId: gst5, hsnSac: '', ...over
})
const doc = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  partyId: ravi, walkInName: '', number: '', date: '2025-07-10', dueDate: '2025-07-10', placeOfSupply: '',
  pricesIncludeTax: false, lines: [line()], charges: [], received: null, notes: '', terms: '', ...over
})

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
  ravi = createParty(db, { ...base, name: 'Ravi', kind: 'customer', phone: '9876543210' }).id
  mill = createParty(db, { ...base, name: 'Local Mill', kind: 'supplier' }).id
  createParty(db, { ...base, name: 'Old Customer', kind: 'customer', openingBalance: 500_000, openingDate: '2025-04-01' })
  rice = createItem(db, {
    name: 'Rice', code: '', kind: 'goods', category: '', hsnSac: '1006', taxRateId: gst5, priceIncludesTax: false,
    salePrice: 10_000, purchasePrice: 8000, mrp: null, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: kg,
    altUnitId: null, altConversion: null, trackStock: true, openingQty: 10_000, openingRate: 8000, openingDate: '2025-04-01',
    lowStockQty: 20_000
  }).id

  savePurchase(db, null, doc({ partyId: mill, number: 'LM-101', date: '2025-07-05', dueDate: '', lines: [line({ qty: 40_000, rate: 9000 })] }))
  const sale = saveInvoice(db, null, doc({ charges: [{ name: 'Delivery', amount: 10_000, taxRateId: gst18 }] }))
  savePayment(db, null, {
    direction: 'in', partyId: ravi, number: '', date: '2025-08-01', amount: 100_000, accountId: CASH_ACCOUNT_ID,
    mode: 'cash', reference: '', notes: '', allocations: [{ documentId: sale.id, amount: 100_000 }]
  })
  createAdjustment(db, { itemId: rice, date: '2025-08-02', qtyChange: -2000, rate: null, reason: 'Damaged' })
  saveInvoice(db, null, doc({
    partyId: null, date: TODAY, dueDate: '', lines: [line({ qty: 5000 })],
    received: { amount: 52_500, accountId: CASH_ACCOUNT_ID, mode: 'cash', reference: '' }
  }))
})
afterEach(() => db.close())

describe('dashboard', () => {
  it('sums today, the month, money owed both ways, cash and stock alerts', () => {
    const d = dashboard(db, TODAY)
    expect(d).toMatchObject({
      todaySales: 52_500, todaySalesCount: 1, monthSales: 52_500, monthPurchases: 0,
      receivable: 226_800 + 500_000, payable: 378_000, cashBank: 152_500
    })
    expect(d.overdue).toMatchObject({ count: 1, total: 226_800 })
    expect(d.overdue.top[0].partyName).toBe('Ravi')
    expect(d.lowStock).toEqual([{ itemId: rice, name: 'Rice', qty: 13_000, unit: 'kg', lowStockQty: 20_000 }])
    expect(d.salesByDay).toHaveLength(30)
    expect(d.salesByDay[0]).toEqual({ date: '2025-07-16', total: 0 })
    expect(d.salesByDay[29]).toEqual({ date: TODAY, total: 52_500 })
  })
})

describe('registers', () => {
  it('lists bills with tax columns and totals, leaving out deleted ones', () => {
    const extra = saveInvoice(db, null, doc({ date: '2025-08-10', dueDate: '' }))
    deleteInvoice(db, extra.id)
    const r = billRegister(db, 'SALE_INVOICE', {}, TODAY)
    expect(r.rows.map((x) => x.partyName)).toEqual(['Ravi', 'Cash sale'])
    expect(r.rows[0]).toMatchObject({ taxable: 310_000, cgst: 8400, sgst: 8400, total: 326_800, paid: 100_000, status: 'overdue' })
    expect(r.totals).toEqual({ taxable: 360_000, cgst: 9650, sgst: 9650, igst: 0, cess: 0, total: 379_300, paid: 152_500, balance: 226_800 })
    expect(billRegister(db, 'SALE_INVOICE', { from: '2025-08-01', to: '2025-08-31' }).rows).toHaveLength(1)
    expect(billRegister(db, 'PURCHASE_BILL', {}).rows[0]).toMatchObject({ number: 'LM-101', total: 378_000, balance: 378_000 })
  })

  it('rejects a reversed date range', () => {
    expect(() => billRegister(db, 'SALE_INVOICE', { from: '2025-09-01', to: '2025-08-01' })).toThrow(/after the end/)
  })
})

describe('day book', () => {
  it('lists every entry in order with money in and out', () => {
    const b = dayBook(db, { from: '2025-07-01', to: '2025-08-31' })
    expect(b.rows.map((r) => r.kind)).toEqual(['purchase', 'sale', 'payment_in', 'adjustment', 'sale', 'payment_in'])
    expect(b.rows[2]).toMatchObject({ label: 'Payment received · Cash in hand', party: 'Ravi', moneyIn: 100_000 })
    expect(b.rows[3]).toMatchObject({ label: 'Stock reduced · Rice · Damaged', amount: 17_600 }) // 2 kg × ₹88 average
    expect(b).toMatchObject({ sales: 379_300, purchases: 378_000, moneyIn: 152_500, moneyOut: 0 })
    expect(dayBook(db, { from: TODAY, to: TODAY }).rows).toHaveLength(2)
  })
})

describe('ageing', () => {
  it('buckets open bills by days overdue and keeps opening balances on account', () => {
    const a = ageing(db, 'receivable', TODAY)
    expect(a.rows.map((r) => r.name)).toEqual(['Old Customer', 'Ravi'])
    expect(a.rows[0]).toMatchObject({ buckets: [0, 0, 0, 0, 0], onAccount: 500_000, total: 500_000 })
    expect(a.rows[1]).toMatchObject({ phone: '9876543210', buckets: [0, 0, 226_800, 0, 0], onAccount: 0, total: 226_800 }) // 35 days
    expect(a.totals).toEqual({ buckets: [0, 0, 226_800, 0, 0], onAccount: 500_000, total: 726_800 })
  })

  it('does the same for what we owe', () => {
    // Bill of 5 Jul with the default 15-day terms → due 20 Jul → 25 days overdue.
    const a = ageing(db, 'payable', TODAY)
    expect(a.rows).toHaveLength(1)
    expect(a.rows[0]).toMatchObject({ name: 'Local Mill', buckets: [0, 378_000, 0, 0, 0], total: 378_000 })
  })
})

describe('profit and loss', () => {
  it('values stock at average cost, so damage and sales both reach cost of goods', () => {
    // Opening 10 kg × ₹80 = ₹800; closing 13 kg × ₹88 = ₹1,144; COGS = 800 + 3,600 − 1,144 = ₹3,256.
    const p = profitLoss(db, { from: '2025-07-01', to: '2025-08-31' })
    expect(p).toMatchObject({
      sales: 360_000, purchases: 360_000, openingStock: 80_000, closingStock: 114_400, costOfGoodsSold: 325_600,
      grossProfit: 34_400, roundOff: 0, netProfit: 34_400
    })
  })

  it('treats opening stock typed on items as opening stock, not profit', () => {
    const all = profitLoss(db, {})
    expect(all).toMatchObject({ openingStock: 80_000, closingStock: 114_400, grossProfit: 34_400 })
    expect(profitLoss(db, { from: '2025-04-01', to: '2025-06-30' })).toMatchObject({ sales: 0, openingStock: 80_000, closingStock: 80_000, grossProfit: 0 })
  })
})

describe('GST summary', () => {
  it('splits output tax and input credit by rate, charges included', () => {
    const g = gstSummary(db, {})
    expect(g.outward.byRate).toEqual([
      { rateBp: 500, taxable: 350_000, cgst: 8750, sgst: 8750, igst: 0, cess: 0 },
      { rateBp: 1800, taxable: 10_000, cgst: 900, sgst: 900, igst: 0, cess: 0 }
    ])
    expect(g.outward).toMatchObject({ taxable: 360_000, cgst: 9650, sgst: 9650, bills: 2 })
    expect(g.inward).toMatchObject({ taxable: 360_000, cgst: 9000, sgst: 9000, bills: 1 })
    expect(g.net).toEqual({ cgst: 650, sgst: 650, igst: 0, cess: 0, total: 1300 })
  })
})

describe('item-wise sales', () => {
  it('shows quantity, value and profit at average cost', () => {
    const s = itemSales(db, {})
    expect(s.rows).toEqual([{ itemId: rice, name: 'Rice', unit: 'kg', qty: 35_000, sales: 350_000, cost: 308_000, profit: 42_000 }])
    expect(s).toMatchObject({ sales: 350_000, cost: 308_000, profit: 42_000 })
  })
})

describe('report documents', () => {
  const report: ReportDoc = {
    title: 'Sale register',
    subtitle: 'July 2025',
    sections: [{
      columns: [{ label: 'Party' }, { label: 'Qty', kind: 'qty' }, { label: 'Total', kind: 'money' }],
      rows: [{ cells: ['Mehta, "Sons" & Co', 2500, 123_456] }],
      total: ['Total', null, 123_456]
    }]
  }

  it('writes CSV with plain numbers that Excel can add', () => {
    const csv = reportCsv(report, 'Shop')
    expect(csv.startsWith('﻿Shop\r\nSale register\r\nJuly 2025\r\n')).toBe(true)
    expect(csv).toContain('Party,Qty,Total\r\n"Mehta, ""Sons"" & Co",2.5,1234.56\r\nTotal,,1234.56\r\n')
  })

  it('prints an escaped, right-aligned table', () => {
    const html = reportHtml(report, 'Shop <1>')
    expect(html).toContain('Shop &lt;1&gt;')
    expect(html).toContain('<td>Mehta, &quot;Sons&quot; &amp; Co</td><td class="r">2.5</td><td class="r">₹1,234.56</td>')
    expect(html).toContain('size: A4 portrait')
  })
})
