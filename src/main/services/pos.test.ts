import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addItem, findForScan, isWholesale, linePrice, posInvoiceInput, posTotals, searchItems, settle, type PosBill, type PosContext } from '@shared/pos'
import type { Item } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { setupBusiness } from './business'
import { getBill, saveBill } from './invoices'
import { createItem, getItem, listItems } from './items'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

let db: DB
let shirt: Item
let dhoti: Item
let ctx: PosContext
beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '33' }, preferences: { pricesIncludeTax: false, roundOff: true } }, '2026-04-01')
  const pcs = listUnits(db).find((u) => u.short === 'pcs')!.id
  const box = listUnits(db).find((u) => u.short === 'box')!.id
  const gst5 = listTaxRates(db).find((t) => t.name === 'GST 5%')!.id
  const base = {
    code: '', kind: 'goods' as const, category: '', hsnSac: '', taxRateId: gst5, priceIncludesTax: false, purchasePrice: 20_000, mrp: null,
    baseUnitId: pcs, altUnitId: null, altConversion: null, trackStock: true, openingQty: 500_000, openingRate: 20_000, openingDate: '2026-04-01', lowStockQty: null
  }
  shirt = createItem(db, { ...base, name: 'Shirt', code: 'SH-1', barcode: '2000000000015', salePrice: 43_000, wholesalePrice: 38_000, wholesaleMinQty: 15_000, altUnitId: box, altConversion: 12_000 })
  dhoti = createItem(db, { ...base, name: 'Dhoti', salePrice: 35_000, wholesalePrice: null, wholesaleMinQty: null })
  ctx = {
    items: new Map(listItems(db).map((i) => [i.id, i])), rates: new Map(listTaxRates(db).map((r) => [r.id, r])),
    inclusive: false, registered: true, supply: 'intra', roundOff: true
  }
})
afterEach(() => db.close())

const bill = (over: Partial<PosBill> = {}): PosBill => ({
  partyId: null, walkInName: '', date: '2026-11-16', placeOfSupply: '33', lines: [], charges: [], notes: '', mode: 'cash', accountId: 'cash', tendered: 0, reference: '', ...over
})

describe('counter billing (POS)', () => {
  it('scanning adds one more of an item already on the bill', () => {
    let lines = addItem([], shirt.id, 1)
    lines = addItem(lines, shirt.id, 2)
    lines = addItem(lines, dhoti.id, 3)
    expect(lines.map((l) => [l.itemId === shirt.id ? 'shirt' : 'dhoti', l.qty])).toEqual([['shirt', 2000], ['dhoti', 1000]])
    expect(findForScan(listItems(db), '2000000000015')?.name).toBe('Shirt')
    expect(findForScan(listItems(db), 'sh-1')?.name).toBe('Shirt')
    expect(findForScan(listItems(db), '999')).toBeUndefined()
    expect(searchItems(listItems(db), 'dho').map((i) => i.name)).toEqual(['Dhoti'])
    expect(searchItems(listItems(db), '350').map((i) => i.name)).toEqual(['Dhoti']) // by price
  })

  it('switches to the wholesale price from 15 pieces, counting a box as 12', () => {
    const one = { key: 1, itemId: shirt.id, qty: 14_000, useAltUnit: false, priceOverride: null, discountPctBp: 0, discountAmount: 0 }
    expect(isWholesale(ctx.items.get(shirt.id)!, one)).toBe(false)
    expect(linePrice(ctx.items.get(shirt.id)!, one, ctx)).toBe(43_000)
    expect(linePrice(ctx.items.get(shirt.id)!, { ...one, qty: 15_000 }, ctx)).toBe(38_000)
    // 2 boxes = 24 pieces: wholesale, priced per box.
    expect(linePrice(ctx.items.get(shirt.id)!, { ...one, qty: 2000, useAltUnit: true }, ctx)).toBe(38_000 * 12)
    expect(linePrice(ctx.items.get(shirt.id)!, { ...one, priceOverride: 40_000 }, ctx)).toBe(40_000)
  })

  it('saves as a sale invoice with the same totals, GST, round off and change', () => {
    const lines = [
      { key: 1, itemId: shirt.id, qty: 5000, useAltUnit: false, priceOverride: null, discountPctBp: 0, discountAmount: 0 },
      { key: 2, itemId: dhoti.id, qty: 15_000, useAltUnit: false, priceOverride: null, discountPctBp: 1000, discountAmount: 0 }
    ]
    const t = posTotals(lines, ctx)
    // 5 × 430 + 15 × 350 less 10% = 2150 + 4725 = 6875; GST 5% = 343.75; 7218.75 → round off to 7219.
    expect(t.taxableTotal).toBe(687_500)
    expect(t.cgst + t.sgst).toBe(34_375)
    expect(t.grandTotal).toBe(721_900)
    expect(settle(t.grandTotal, 800_000)).toEqual({ received: 721_900, change: 78_100, due: 0 })
    const inv = saveBill(db, 'SALE_INVOICE', null, posInvoiceInput(bill({ lines, tendered: 800_000 }), ctx))
    const saved = getBill(db, 'SALE_INVOICE', inv.id)
    expect(saved.grandTotal).toBe(t.grandTotal)
    expect(saved.paidAmount).toBe(721_900)
    expect(saved.balanceDue).toBe(0)
    expect(getItem(db, shirt.id).stockQty).toBe(495_000)
  })

  it('a walk-in customer must pay in full; a party can take credit', () => {
    const lines = [{ key: 1, itemId: dhoti.id, qty: 1000, useAltUnit: false, priceOverride: null, discountPctBp: 0, discountAmount: 0 }]
    expect(() => saveBill(db, 'SALE_INVOICE', null, posInvoiceInput(bill({ lines, tendered: 10_000 }), ctx))).toThrow(/paid in full/)
    expect(settle(36_750, 10_000)).toEqual({ received: 10_000, change: 0, due: 26_750 })
  })
})
