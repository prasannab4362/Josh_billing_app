// Textile and wholesale shops: sizes as separate items, tax-inclusive sarees, metres, dozens, bulk orders.
// The counter (POS) and the sale invoice must always agree.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Item, ItemInput } from '@shared/models'
import { addItem, bulkHint, isWholesale, linePrice, posInvoiceInput, posTotals, type PosBill, type PosContext, type PosLine } from '@shared/pos'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { setupBusiness } from './business'
import { getBill, saveBill } from './invoices'
import { createItem, getItem, listItems } from './items'
import { savePreferences } from './settings'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

let db: DB
let it_: Record<string, Item>
const unit = (short: string) => listUnits(db).find((u) => u.short === short)!.id
const rate = (name: string) => listTaxRates(db).find((t) => t.name === name)!.id

const make = (over: Partial<ItemInput> & { name: string }): Item =>
  createItem(db, {
    code: '', kind: 'goods', category: 'Textiles', hsnSac: '6109', taxRateId: rate('GST 5%'), priceIncludesTax: false, salePrice: 45_000, purchasePrice: 25_000,
    mrp: null, wholesalePrice: 38_000, wholesaleMinQty: 15_000, baseUnitId: unit('pcs'), altUnitId: null, altConversion: null, trackStock: true,
    openingQty: 10_000_000, openingRate: 25_000, openingDate: '2026-04-01', lowStockQty: null, ...over
  })

beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Textiles', stateCode: '33' }, preferences: { pricesIncludeTax: false, roundOff: true } }, '2026-04-01')
  it_ = {
    shirtM: make({ name: 'Shirt M' }),
    shirtL: make({ name: 'Shirt L' }),
    saree: make({ name: 'Silk saree', priceIncludesTax: true, salePrice: 199_900, wholesalePrice: 159_900, wholesaleMinQty: 6_000 }),
    dhoti: make({ name: 'Dhoti cloth', baseUnitId: unit('m'), salePrice: 35_000, wholesalePrice: 30_000, wholesaleMinQty: 20_000, hsnSac: '5208' }),
    towel: make({ name: 'Towel', salePrice: 12_000, wholesalePrice: 9_500, wholesaleMinQty: 24_000, altUnitId: unit('dzn'), altConversion: 12_000, taxRateId: rate('GST 12%') }),
    plain: make({ name: 'Button', salePrice: 500, wholesalePrice: null, wholesaleMinQty: null, taxRateId: rate('GST 12%') })
  }
})
afterEach(() => db.close())

const ctxFor = (over: Partial<PosContext> = {}): PosContext => ({
  items: new Map(listItems(db).map((i) => [i.id, i])), rates: new Map(listTaxRates(db).map((r) => [r.id, r])),
  inclusive: false, registered: true, supply: 'intra', roundOff: true, ...over
})
const line = (item: Item, qty: number, over: Partial<PosLine> = {}): PosLine => ({
  key: Math.floor(Math.random() * 1e9), itemId: item.id, qty, useAltUnit: false, priceOverride: null, discountPctBp: 0, discountAmount: 0, ...over
})

describe('wholesale on textile items', () => {
  it('switches at the minimum quantity, exactly, for pieces, metres and dozens', () => {
    const c = ctxFor()
    const price = (item: Item, qty: number, alt = false) => linePrice(c.items.get(item.id)!, line(item, qty, { useAltUnit: alt }), c)
    expect(price(it_.shirtM, 14_000)).toBe(45_000)
    expect(price(it_.shirtM, 15_000)).toBe(38_000)
    expect(price(it_.dhoti, 19_999)).toBe(35_000) // 19.999 m
    expect(price(it_.dhoti, 20_000)).toBe(30_000)
    expect(price(it_.dhoti, 4_500)).toBe(35_000) // 4.5 m is retail
    expect(price(it_.towel, 23_000)).toBe(12_000)
    expect(price(it_.towel, 24_000)).toBe(9_500)
    // 2 dozen = 24 pieces: wholesale, priced per dozen. 1 dozen is retail per dozen.
    expect(price(it_.towel, 2_000, true)).toBe(9_500 * 12)
    expect(price(it_.towel, 1_000, true)).toBe(12_000 * 12)
    expect(price(it_.plain, 999_000)).toBe(500) // no wholesale price: never changes
  })

  it('keeps tax-inclusive sarees correct on a tax-exclusive bill and the other way round', () => {
    const saree = it_.saree
    // Saree prices include 5% GST: on a bill without tax the rate is the price before tax.
    const excl = linePrice(ctxFor().items.get(saree.id)!, line(saree, 1_000), ctxFor())
    expect(excl).toBe(190_381) // 1999 / 1.05
    expect(linePrice(ctxFor().items.get(saree.id)!, line(saree, 6_000), ctxFor())).toBe(152_286) // wholesale 1599 / 1.05
    const incl = ctxFor({ inclusive: true })
    expect(linePrice(incl.items.get(saree.id)!, line(saree, 1_000), incl)).toBe(199_900)
    // Whichever way prices are shown, the customer pays the item's own price, GST included.
    const t = posTotals([line(saree, 1_000)], incl)
    expect(t.grandTotal).toBe(199_900)
    const t2 = posTotals([line(saree, 1_000)], ctxFor())
    expect(Math.abs(t2.grandTotal - 199_900)).toBeLessThanOrEqual(100) // rounded to the rupee
  })

  it('suggests wholesale for a bulk order spread over sizes, and applies it to the whole bill', () => {
    const c = ctxFor()
    let lines = addItem([], it_.shirtM.id, 1, 10_000)
    lines = addItem(lines, it_.shirtL.id, 2, 8_000)
    expect(bulkHint(lines, c.items)).toEqual({ pieces: 18_000, minimum: 15_000, items: 2 })
    // Neither size reaches 15 on its own, so each is retail until the bill is made a wholesale bill.
    expect(isWholesale(c.items.get(it_.shirtM.id)!, lines[0])).toBe(false)
    const retail = posTotals(lines, c)
    const whole = posTotals(lines, { ...c, wholesaleBill: true })
    expect(retail.taxableTotal).toBe(18 * 450_00)
    expect(whole.taxableTotal).toBe(18 * 380_00)
    // Small orders are left alone, and so are bills with a single line.
    expect(bulkHint([...addItem([], it_.shirtM.id, 1, 5_000), ...addItem([], it_.shirtL.id, 2, 5_000)], c.items)).toBeNull()
    expect(bulkHint(addItem([], it_.shirtM.id, 1, 18_000), c.items)).toBeNull() // already wholesale by itself
    // An item without a wholesale price stays retail on a wholesale bill.
    const mixed = posTotals([line(it_.shirtM, 1_000), line(it_.plain, 10_000)], { ...c, wholesaleBill: true })
    expect(mixed.lines[0].taxable).toBe(380_00)
    expect(mixed.lines[1].taxable).toBe(5_000)
  })

  it('a price typed for a line is never replaced', () => {
    const c = ctxFor({ wholesaleBill: true })
    expect(linePrice(c.items.get(it_.shirtM.id)!, line(it_.shirtM, 20_000, { priceOverride: 41_000 }), c)).toBe(41_000)
  })
})

describe('counter and invoice agree', () => {
  /** A small deterministic generator, so a failure can be repeated. */
  const rng = (seed: number) => () => ((seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff)

  it('gives the same totals to the paisa over 150 random textile bills, and posts stock and ledger', () => {
    const next = rng(2026)
    const all = Object.values(it_)
    const stockBefore = new Map(all.map((i) => [i.id, getItem(db, i.id).stockQty]))
    const sold = new Map<string, number>()
    for (let n = 0; n < 150; n++) {
      const inclusive = next() < 0.5
      savePreferences(db, { pricesIncludeTax: inclusive })
      const inter = next() < 0.3
      const count = 1 + Math.floor(next() * 4)
      const lines: PosLine[] = []
      for (let k = 0; k < count; k++) {
        const item = all[Math.floor(next() * all.length)]
        const alt = !!item.altUnitId && next() < 0.4
        const qty = (1 + Math.floor(next() * 80)) * 500 // 0.5 to 40
        const pct = [0, 0, 500, 1000, 1250][Math.floor(next() * 5)]
        lines.push(line(item, qty, { useAltUnit: alt, discountPctBp: pct, discountAmount: pct ? 0 : next() < 0.2 ? 1_000 : 0 }))
      }
      const ctx = ctxFor({ inclusive, supply: inter ? 'inter' : 'intra', wholesaleBill: next() < 0.3 })
      const charges = next() < 0.3 ? [{ name: 'Packing', amount: 2_000, taxRateId: rate('GST 18%') }] : []
      const t = posTotals(lines, ctx, charges)
      const bill: PosBill = {
        partyId: null, walkInName: '', date: '2026-11-16', placeOfSupply: inter ? '27' : '33', lines, charges, notes: '', mode: 'cash', accountId: 'cash',
        tendered: t.grandTotal, reference: ''
      }
      const inv = saveBill(db, 'SALE_INVOICE', null, posInvoiceInput(bill, ctx))
      const saved = getBill(db, 'SALE_INVOICE', inv.id)
      expect([saved.grandTotal, saved.taxableTotal, saved.cgst, saved.sgst, saved.igst, saved.roundOff]).toEqual([t.grandTotal, t.taxableTotal, t.cgst, t.sgst, t.igst, t.roundOff])
      expect(saved.balanceDue).toBe(0)
      for (const l of lines) {
        const item = it_[Object.keys(it_).find((k) => it_[k].id === l.itemId)!]
        sold.set(item.id, (sold.get(item.id) ?? 0) + Math.round((l.qty * (l.useAltUnit ? item.altConversion! : 1000)) / 1000))
      }
    }
    // Stock fell by exactly what was sold, in main units.
    for (const i of all) expect(getItem(db, i.id).stockQty).toBe(stockBefore.get(i.id)! - (sold.get(i.id) ?? 0))
    // The books balance: every ledger entry has its other side.
    const net = db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS n FROM ledger_entry').get() as { n: number }
    expect(net.n).toBe(0)
  })
})
