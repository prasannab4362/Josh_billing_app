import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codeFormatError, codeFormatExample, nextCode, nextPatternCode } from '@shared/barcode'
import { bigPrice, DEFAULT_LABEL_OPTIONS, LABEL_STYLES, type LabelOptions, type LabelStyle } from '@shared/labels'
import type { ItemInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { setupBusiness } from './business'
import { createItem, generateBarcode, getItem } from './items'
import { assignBarcodes, getCodeFormat, labelPage, saveCodeFormat, saveLabelDesign } from './labels'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

let db: DB
let base: ItemInput
beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Only Garments (India)', stateCode: '33' }, preferences: {} }, '2026-04-01')
  base = {
    name: 'Swami Jolna Bag', code: '', kind: 'goods', category: 'Bags', hsnSac: '4202', taxRateId: listTaxRates(db).find((t) => t.name === 'GST 5%')!.id,
    priceIncludesTax: true, salePrice: 123_000, purchasePrice: 80_000, mrp: 149_900, wholesalePrice: null, wholesaleMinQty: null,
    baseUnitId: listUnits(db).find((u) => u.short === 'pcs')!.id, altUnitId: null, altConversion: null, trackStock: true,
    openingQty: 10_000, openingRate: 80_000, openingDate: '2026-04-01', lowStockQty: null
  }
})
afterEach(() => db.close())

const opts = (o: Partial<LabelOptions>): LabelOptions => ({
  ...DEFAULT_LABEL_OPTIONS,
  layout: 'roll-2x50x38',
  header: { field: 'business', text: '' },
  lines: [{ field: 'name', text: '' }, { field: 'price', text: '' }, { field: 'none', text: '' }, { field: 'none', text: '' }],
  ...o
})

describe('shop barcode numbers like 472-00001~1', () => {
  it('are accepted as barcodes, printed and found again', () => {
    const bag = createItem(db, { ...base, barcode: '472-00001~1' })
    expect(getItem(db, bag.id).barcode).toBe('472-00001~1')
    const html = labelPage(db, { items: [{ itemId: bag.id, copies: 1 }], options: opts({ symbol: 'barcode', style: 'classic' }) })
    expect(html).toContain('472-00001~1')
    expect(html).toContain('<svg') // drawn as Code 128
  })

  it('can be made from the shop\'s own pattern, carrying on from the highest one used', () => {
    expect(codeFormatError({ kind: 'pattern', prefix: '472-', digits: 5, suffix: '~1' })).toBe('')
    expect(codeFormatExample({ kind: 'pattern', prefix: '472-', digits: 5, suffix: '~1' })).toBe('472-00001~1')
    const f = { kind: 'pattern' as const, prefix: '472-', digits: 5, suffix: '~1' }
    expect(nextPatternCode(['472-00007~1', '472-00003~1', 'X-1', '472-00009~2'], f)).toBe('472-00008~1')
    expect(nextCode([], { kind: 'ean13' })).toMatch(/^2\d{12}$/)
    expect(() => nextPatternCode(['472-999~1'], { ...f, digits: 3 })).toThrow(/add a digit/)
    expect(codeFormatError({ kind: 'pattern', prefix: '', digits: 5, suffix: '' })).toMatch(/prefix or a suffix/)
    expect(codeFormatError({ kind: 'pattern', prefix: 'A B', digits: 5, suffix: '' })).toMatch(/no spaces/)
    expect(codeFormatError({ kind: 'pattern', prefix: 'A', digits: 2, suffix: '' })).toMatch(/3 to 10/)
  })

  it('are used by Create barcode and Create barcodes once saved', () => {
    expect(getCodeFormat(db)).toEqual({ kind: 'ean13' })
    saveCodeFormat(db, { kind: 'pattern', prefix: '472-', digits: 5, suffix: '~1' })
    createItem(db, { ...base, name: 'Old tag', barcode: '472-00004~1' })
    expect(generateBarcode(db)).toBe('472-00005~1')
    const a = createItem(db, { ...base, name: 'Bag A' })
    const b = createItem(db, { ...base, name: 'Bag B' })
    expect(assignBarcodes(db, [a.id, b.id])).toBe(2)
    expect([getItem(db, a.id).barcode, getItem(db, b.id).barcode]).toEqual(['472-00005~1', '472-00006~1'])
    expect(() => saveCodeFormat(db, { kind: 'pattern', prefix: '', digits: 5, suffix: '' })).toThrow(/prefix or a suffix/)
    saveCodeFormat(db, { kind: 'ean13' })
    expect(generateBarcode(db)).toMatch(/^2\d{12}$/)
  })
})

describe('label designs', () => {
  it('every design draws every label, with a barcode or a QR code, escaping text', () => {
    const bag = createItem(db, { ...base, barcode: '472-00001~1', name: 'Bag <b>"x"</b>' })
    for (const style of Object.keys(LABEL_STYLES) as LabelStyle[]) {
      for (const symbol of ['barcode', 'qr'] as const) {
        const html = labelPage(db, { items: [{ itemId: bag.id, copies: 2 }], options: opts({ style, symbol }) })
        expect(html.match(/class="label[ "](?!empty)/g)?.length ?? 0, `${style} ${symbol}`).toBeGreaterThanOrEqual(2)
        expect(html, `${style} ${symbol}`).toContain('<svg')
        expect(html, `${style} ${symbol}`).not.toContain('<b>"x"</b>')
      }
    }
  })

  it('garment tag: shop name on a black band, big price with ₹, code sideways beside the QR code', () => {
    const bag = createItem(db, { ...base, barcode: '472-00001~1' })
    const html = labelPage(db, { items: [{ itemId: bag.id, copies: 1 }], options: opts({ style: 'garment', symbol: 'qr' }) })
    expect(html).toContain('<div class="sg-band">Only Garments (India)</div>')
    expect(html).toContain('<div class="sg-price">₹1,230</div>')
    expect(html).toContain('<div class="sg-vcode">472-00001~1</div>')
    expect(html).toContain('writing-mode: vertical-rl')
    expect(html).toContain('background: #000; color: #fff')
  })

  it('shelf strip shows the MRP crossed out and the saving; price tag and food packet show their parts', () => {
    const bag = createItem(db, { ...base, barcode: '2000000000015' })
    const shelf = labelPage(db, { items: [{ itemId: bag.id, copies: 1 }], options: opts({ style: 'shelf' }) })
    expect(shelf).toContain('<div class="ss-price">₹1,230</div>')
    expect(shelf).toContain('MRP <s>₹1,499</s>')
    expect(shelf).toContain('You save ₹269')
    const tag = labelPage(db, { items: [{ itemId: bag.id, copies: 1 }], options: opts({ style: 'priceTag' }) })
    expect(tag).toContain('<div class="sp-price">₹1,230</div>')
    const food = labelPage(db, { items: [{ itemId: bag.id, copies: 1, extra: { mfg: '2026-11-13', exp: '2027-01' } }], options: opts({ style: 'food' }) })
    expect(food).toContain('<span>Packed</span><b>13/11/2026</b>')
    expect(food).toContain('<span>Best before</span><b>01/2027</b>')
    const code = labelPage(db, { items: [{ itemId: bag.id, copies: 1 }], options: opts({ style: 'codeOnly' }) })
    expect(code).not.toContain('Swami')
    const jewel = labelPage(db, { items: [{ itemId: bag.id, copies: 1 }], options: opts({ style: 'jewellery', symbol: 'qr', layout: 'roll-jewel-100x15' }) })
    expect(jewel).toContain('class="sj-tail"')
    expect(jewel).toContain('@page { size: 100mm 15mm')
  })

  it('older saved designs (no style) stay Classic; unknown designs are refused', () => {
    const bag = createItem(db, { ...base, barcode: '2000000000015' })
    const html = labelPage(db, { items: [{ itemId: bag.id, copies: 1 }], options: opts({ style: undefined }) })
    expect(html).toContain('<div class="bars">')
    expect(() => saveLabelDesign(db, { ...opts({}), style: 'fancy' as never })).toThrow(/label design/)
    expect(bigPrice(123_050)).toBe('₹1,230.50')
    expect(bigPrice(123_000)).toBe('₹1,230')
  })
})
