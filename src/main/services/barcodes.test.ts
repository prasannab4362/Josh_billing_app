import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invoiceHtml } from '@shared/invoiceHtml'
import type { ItemInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { printAccount } from './accounts'
import { getBusiness, setBusinessImage, setupBusiness } from './business'
import { getBill, saveBill } from './invoices'
import { createItem, generateBarcode, getItem, getItemImage, listItems, updateItem } from './items'
import { DEFAULT_LABEL_OPTIONS, extraFieldsUsed, LABEL_LAYOUTS, lineText, monthText, pageWidth, type LabelOptions } from '@shared/labels'
import {
  assignBarcodes, deleteLabelSize, getLabelDesign, labelData, labelPage, labelPrice, listLabelSizes, saveLabelDesign, saveLabelSize
} from './labels'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let db: DB
let base: ItemInput

beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: "Kumar's", stateCode: '33' }, preferences: { roundOff: false } }, '2026-04-01')
  base = {
    name: 'T-shirt', code: '', kind: 'goods', category: 'Clothing', hsnSac: '6109', taxRateId: listTaxRates(db).find((t) => t.name === 'GST 5%')!.id,
    priceIncludesTax: false, salePrice: 43_000, purchasePrice: 23_000, mrp: 49_900, wholesalePrice: null, wholesaleMinQty: null,
    baseUnitId: listUnits(db).find((u) => u.short === 'pcs')!.id, altUnitId: null, altConversion: null, trackStock: true,
    openingQty: 50_000, openingRate: 23_000, openingDate: '2026-04-01', lowStockQty: null
  }
})
afterEach(() => db.close())

describe('item description, barcode and photo', () => {
  it('are saved, and a barcode can belong to one item only', () => {
    const t = createItem(db, { ...base, description: 'Cotton, round neck', barcode: '8901234567891', image: PNG })
    expect(t).toMatchObject({ description: 'Cotton, round neck', barcode: '8901234567891', hasImage: true })
    expect(getItemImage(db, t.id)).toBe(PNG)
    expect(() => createItem(db, { ...base, name: 'Shirt', barcode: '8901234567891' })).toThrow(/already used by T-shirt/)
    expect(() => createItem(db, { ...base, name: 'Cap', barcode: 'कोड' })).toThrow(/English letters/)
    expect(() => createItem(db, { ...base, name: 'Cap', image: 'data:text/html;base64,PGI+' })).toThrow(/PNG, JPEG or WebP/)
  })

  it('keeps the photo when an edit does not touch it, and removes it on null', () => {
    const t = createItem(db, { ...base, image: PNG })
    updateItem(db, t.id, { ...base, salePrice: 45_000 })
    expect(getItemImage(db, t.id)).toBe(PNG)
    updateItem(db, t.id, { ...base, image: null })
    expect(getItem(db, t.id).hasImage).toBe(false)
    // Lists never carry the photo itself.
    expect(Object.keys(listItems(db)[0])).not.toContain('image')
  })

  it('creates in-store barcodes and gives them to items that have none', () => {
    expect(generateBarcode(db)).toBe('2000000000015')
    const a = createItem(db, { ...base, barcode: generateBarcode(db) })
    const b = createItem(db, { ...base, name: 'Jeans' })
    const c = createItem(db, { ...base, name: 'Saree', barcode: '8901234567891' })
    expect(assignBarcodes(db, [a.id, b.id, c.id])).toBe(1)
    expect(getItem(db, b.id).barcode).toBe('2000000000022')
    expect(getItem(db, c.id).barcode).toBe('8901234567891')
    expect(generateBarcode(db)).toBe('2000000000039')
  })
})

describe('labels', () => {
  const opts = (o: Partial<LabelOptions> = {}): LabelOptions => ({ ...DEFAULT_LABEL_OPTIONS, ...o })

  it('print the price the customer pays, GST included', () => {
    expect(labelPrice(43_000, false, 500, 0, true)).toBe(45_150)
    expect(labelPrice(45_150, true, 500, 0, true)).toBe(45_150)
    expect(labelPrice(43_000, false, 500, 0, false)).toBe(43_000)
    const t = createItem(db, { ...base, barcode: '2000000000015', code: 'TS-1', description: 'Round neck' })
    const labels = labelData(db, { items: [{ itemId: t.id, copies: 3 }], options: opts() })
    expect(labels).toHaveLength(3)
    expect(labels[0]).toEqual({
      name: 'T-shirt', code: '2000000000015', itemCode: 'TS-1', category: 'Clothing', hsn: '6109', description: 'Round neck', price: 45_150, mrp: 49_900
    })
  })

  it('use the item code when there is no barcode, and refuse items with neither', () => {
    const coded = createItem(db, { ...base, code: 'TS-RED-M' })
    expect(labelData(db, { items: [{ itemId: coded.id, copies: 1 }], options: opts() })[0].code).toBe('TS-RED-M')
    const t = createItem(db, { ...base, name: 'Plain' })
    expect(() => labelData(db, { items: [{ itemId: t.id, copies: 1 }], options: opts() })).toThrow(/no barcode or item code/)
    expect(() => labelData(db, { items: [{ itemId: t.id, copies: 0 }], options: opts() })).toThrow(/at least one label/)
  })

  it('check the options', () => {
    const t = createItem(db, { ...base, barcode: '2000000000015' })
    const req = (o: Partial<LabelOptions>) => ({ items: [{ itemId: t.id, copies: 1 }], options: opts(o) })
    expect(() => labelData(db, req({ layout: 'roll-custom', custom: { width: 200, height: 25, across: 1, gap: 0 } }))).toThrow(/width must be 15 to 120/)
    expect(() => labelData(db, req({ layout: 'roll-custom', custom: { width: 40, height: 30, across: 5, gap: 0 } }))).toThrow(/across must be 1 to 4/)
    expect(() => labelData(db, req({ header: { field: 'custom', text: 'x'.repeat(61) } }))).toThrow(/at most 60/)
    expect(() => labelData(db, req({ lines: Array(5).fill({ field: 'name', text: '' }) }))).toThrow(/At most 4 lines/)
    expect(() => labelData(db, req({ symbol: 'pdf417' as never }))).toThrow(/barcode or QR/)
    expect(labelData(db, req({ layout: 'roll-custom', custom: { width: 40, height: 30, across: 3, gap: 1.5 } }))).toHaveLength(1)
  })

  it('draw the chosen lines, and QR codes in place of barcodes', () => {
    const t = createItem(db, { ...base, barcode: '2000000000015', code: 'TS-1' })
    const req = (o: Partial<LabelOptions>, copies = 3) => ({ items: [{ itemId: t.id, copies }], options: opts(o) })
    const bar = labelPage(db, req({
      header: { field: 'business', text: '' },
      lines: [{ field: 'name', text: '' }, { field: 'mrp', text: '' }, { field: 'saving', text: '' }, { field: 'custom', text: 'Mfg 11/2026' }]
    }))
    expect(bar).toContain(`<div class="head">Kumar's</div>`)
    expect(bar).toContain('<div class="line first">T-shirt</div>')
    expect(bar).toContain('MRP ₹499.00')
    expect(bar).toContain('You save ₹47.50')
    expect(bar).toContain('Mfg 11/2026')
    expect(bar).not.toContain('class="qrbox"')
    // Two across: three labels make two rows, the second with one empty place; page 50 + 2 + 50 mm wide.
    expect(bar.match(/<div class="row">/g)).toHaveLength(2)
    expect(bar).toContain('size: 102mm 25mm')

    const qr = labelPage(db, req({ symbol: 'qr', layout: 'a4-24', lines: [{ field: 'none', text: '' }] }, 2))
    expect(qr.match(/class="qrbox"/g)).toHaveLength(2)
    expect(qr).toContain('label qr side')
    expect(qr).toContain('2000000000015')
    expect(lineText({ field: 'saving', text: '' }, { ...labelData(db, req({}))[0], mrp: 40_000 }, '')).toBe('')
    expect(pageWidth(LABEL_LAYOUTS['roll-2x38x25'])).toBe(78)
  })
})

describe('logo, signature and descriptions on bills', () => {
  it('stores the images and prints them, with the item description under its name', () => {
    setBusinessImage(db, 'logo', PNG)
    setBusinessImage(db, 'signature', PNG)
    expect(getBusiness(db)).toMatchObject({ logo: PNG, signature: PNG })
    expect(() => setBusinessImage(db, 'logo', 'not an image')).toThrow(/PNG, JPEG or WebP/)

    const t = createItem(db, { ...base, description: 'Cotton, round neck' })
    const inv = saveBill(db, 'SALE_INVOICE', null, {
      partyId: null, walkInName: '', number: '', date: '2026-11-12', dueDate: '', placeOfSupply: '', pricesIncludeTax: false,
      lines: [{ itemId: t.id, description: '', qty: 1000, unitId: null, unitFactor: 1000, rate: 43_000, discountPctBp: 0, discountAmount: 0, taxRateId: base.taxRateId, hsnSac: '' }],
      charges: [], received: { amount: 45_150, accountId: 'cash', mode: 'cash', reference: '' }, notes: '', terms: ''
    })
    const html = invoiceHtml({ type: 'SALE_INVOICE', invoice: getBill(db, 'SALE_INVOICE', inv.id), business: getBusiness(db), bank: printAccount(db), paper: 'A4', gstRegistered: true })
    expect(html).toContain(`<img class="logo" src="${PNG}"`)
    expect(html).toMatch(/For Kumar&#39;s<\/div><img src="data:image\/png/)
    expect(html).toContain('<div class="muted small desc">Cotton, round neck</div>')

    setBusinessImage(db, 'logo', null)
    expect(getBusiness(db).logo).toBe('')
  })
})

describe('label sizes, saved design and per-item fields', () => {
  it('save named sizes of your own, unique by name, and change or delete them', () => {
    expect(listLabelSizes(db)).toEqual([])
    const tag = saveLabelSize(db, null, '  Jewellery   tag ', { width: 40, height: 30, across: 3, gap: 1.5 })
    expect(tag).toMatchObject({ name: 'Jewellery tag', width: 40, height: 30, across: 3, gap: 1.5 })
    const single = saveLabelSize(db, null, 'Shelf', { width: 60, height: 40, across: 1, gap: 5 })
    expect(single.gap).toBe(0) // no gap with one label per row
    expect(() => saveLabelSize(db, null, 'jewellery TAG', { width: 40, height: 30, across: 1, gap: 0 })).toThrow(/already a size named/)
    expect(() => saveLabelSize(db, null, '', { width: 40, height: 30, across: 1, gap: 0 })).toThrow(/Give the size a name/)
    expect(() => saveLabelSize(db, null, 'Big', { width: 400, height: 30, across: 1, gap: 0 })).toThrow(/width must be 15 to 120/)
    expect(() => saveLabelSize(db, null, 'Wide', { width: 40, height: 30, across: 6, gap: 0 })).toThrow(/across must be 1 to 4/)
    expect(() => saveLabelSize(db, 'nope', 'X', { width: 40, height: 30, across: 1, gap: 0 })).toThrow(/not found/)
    const changed = saveLabelSize(db, tag.id, 'Jewellery tag', { width: 45, height: 30, across: 2, gap: 2 })
    expect(changed.id).toBe(tag.id)
    expect(listLabelSizes(db).map((x) => `${x.name} ${x.width}x${x.height}x${x.across}`)).toEqual(['Jewellery tag 45x30x2', 'Shelf 60x40x1'])
    deleteLabelSize(db, single.id)
    expect(listLabelSizes(db)).toHaveLength(1)
  })

  it('keep the last design in the business file, refusing bad ones', () => {
    expect(getLabelDesign(db)).toBeNull()
    const design = { ...DEFAULT_LABEL_OPTIONS, symbol: 'qr' as const, header: { field: 'none' as const, text: '' } }
    const { skip: _skip, ...rest } = design
    saveLabelDesign(db, rest)
    expect(getLabelDesign(db)).toMatchObject({ symbol: 'qr', header: { field: 'none' } })
    expect(() => saveLabelDesign(db, { ...rest, layout: 'roll-custom', custom: { width: 5, height: 25, across: 1, gap: 0 } })).toThrow(/width must be/)
  })

  it('print batch, model and dates typed per item', () => {
    const t = createItem(db, { ...base, barcode: '2000000000015' })
    const u = createItem(db, { ...base, name: 'Shirt', barcode: '2000000000022' })
    const options: LabelOptions = {
      ...DEFAULT_LABEL_OPTIONS,
      layout: 'roll-50x25',
      lines: [{ field: 'name', text: '' }, { field: 'batch', text: '' }, { field: 'mfg', text: '' }, { field: 'exp', text: '' }]
    }
    expect(extraFieldsUsed(options)).toEqual(['batch', 'mfg', 'exp'])
    const html = labelPage(db, {
      items: [
        { itemId: t.id, copies: 1, extra: { batch: ' B12 ', mfg: '2026-11', exp: '2027-10' } },
        { itemId: u.id, copies: 1, extra: { batch: 'C7' } }
      ],
      options
    })
    expect(html).toContain('Batch: B12')
    expect(html).toContain('Mfg: 11/2026')
    expect(html).toContain('Exp: 10/2027')
    expect(html).toContain('Batch: C7')
    expect(html.match(/Mfg:/g)).toHaveLength(1) // left off where not typed
    expect(monthText('2026-11-05')).toBe('05/11/2026')
    expect(monthText('Nov 26')).toBe('Nov 26')
    expect(() => labelData(db, { items: [{ itemId: t.id, copies: 1, extra: { model: 'x'.repeat(31) } }], options })).toThrow(/at most 30/)
  })
})
