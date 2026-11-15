import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codeFormatError, codeFormatExample, nextCode, nextSizeCodes, splitSizeCode, yearLetters, type YearlyFormat } from '@shared/barcode'
import type { ItemInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { setupBusiness } from './business'
import { addItemSizes, createItem, generateBarcode, getItem } from './items'
import { assignBarcodes, currentFy, getCodeFormat, saveCodeFormat } from './labels'
import { getFeatures, saveFeatures } from './printDesign'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

const yearly = (o: Partial<YearlyFormat> = {}): YearlyFormat => ({
  kind: 'yearly', startCode: 'AA', startFy: '2026-27', digits: 5, separator: '-', restartEachYear: false, sizeNumbers: true, ...o
})

describe('year letters', () => {
  it('start at the chosen letters and move one step each accounting year', () => {
    expect(yearLetters(yearly(), '2026-27')).toBe('AA')
    expect(yearLetters(yearly(), '2027-28')).toBe('AB')
    expect(yearLetters(yearly(), '2051-52')).toBe('AZ')
    expect(yearLetters(yearly(), '2052-53')).toBe('BA')
    expect(yearLetters(yearly({ startCode: 'EE' }), '2027-28')).toBe('EF')
    expect(yearLetters(yearly({ startCode: 'EZ' }), '2027-28')).toBe('FA')
    expect(yearLetters(yearly({ startCode: 'ZZ' }), '2026-27')).toBe('ZZ')
    expect(() => yearLetters(yearly({ startCode: 'ZZ' }), '2027-28')).toThrow(/past ZZ/)
    // A year before the start keeps the starting letters; calendar-year businesses work too.
    expect(yearLetters(yearly(), '2025-26')).toBe('AA')
    expect(yearLetters(yearly({ startFy: '2026' }), '2028')).toBe('AC')
  })

  it('check the settings', () => {
    expect(codeFormatError(yearly())).toBe('')
    expect(codeFormatError(yearly({ startCode: 'A1' }))).toMatch(/two capital letters/)
    expect(codeFormatError(yearly({ startCode: 'aa' }))).toMatch(/two capital letters/)
    expect(codeFormatError(yearly({ digits: 2 }))).toMatch(/3 to 8/)
    expect(codeFormatError(yearly({ separator: '~' }))).toMatch(/one of/)
    expect(codeFormatError(yearly({ separator: '' }))).toBe('')
    expect(codeFormatExample(yearly(), 1, '2026-27')).toBe('AA-00001~1')
    expect(codeFormatExample(yearly({ sizeNumbers: false, separator: '' }), 7, '2027-28')).toBe('AB00007')
  })

  it('give the next product number, carrying on or restarting each year', () => {
    const used = ['AA-00001~1', 'AA-00001~2', 'AA-00002~1', 'AA-00003~1', '472-00009~1', '2000000000015']
    expect(nextCode(used, yearly(), '2026-27')).toBe('AA-00004~1')
    // Next year: carry on from 3, or start again at 1.
    expect(nextCode(used, yearly(), '2027-28')).toBe('AB-00004~1')
    expect(nextCode(used, yearly({ restartEachYear: true }), '2027-28')).toBe('AB-00001~1')
    expect(nextCode([...used, 'AB-00001~1'], yearly({ restartEachYear: true }), '2027-28')).toBe('AB-00002~1')
    expect(nextCode(used, yearly({ sizeNumbers: false }), '2026-27')).toBe('AA-00004')
    expect(() => nextCode(['AA-999'], yearly({ digits: 3, sizeNumbers: false }), '2026-27')).toThrow(/add a digit/)
  })

  it('size numbers share the product number', () => {
    expect(splitSizeCode('AA-00012~3')).toEqual({ stem: 'AA-00012', size: 3 })
    expect(splitSizeCode('2000000000015')).toEqual({ stem: '2000000000015', size: null })
    expect(nextSizeCodes('AA-00012~1', ['AA-00012~1', 'AA-00012~3'], 3)).toEqual(['AA-00012~2', 'AA-00012~4', 'AA-00012~5'])
    expect(nextSizeCodes('472-00001~1', ['472-00001~1'], 1)).toEqual(['472-00001~2'])
    expect(nextSizeCodes('2000000000015', [], 2)).toBeNull()
  })
})

describe('year-letter numbering in a shop', () => {
  let db: DB
  let base: ItemInput
  beforeEach(() => {
    db = openDatabase(':memory:')
    setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Only Garments (India)', stateCode: '33' }, preferences: {} }, '2026-04-01')
    const f = getFeatures(db)
    saveFeatures(db, {
      ...f,
      itemFields: f.itemFields.map((x, i) => (i === 0 ? { on: true, label: 'Size', print: true } : i === 1 ? { on: true, label: 'Colour', print: true } : x))
    })
    base = {
      name: 'Cotton Kurti', code: '', kind: 'goods', category: 'Kurtis', hsnSac: '6204', taxRateId: listTaxRates(db).find((t) => t.name === 'GST 5%')!.id,
      priceIncludesTax: true, salePrice: 79_900, purchasePrice: 50_000, mrp: 89_900, wholesalePrice: null, wholesaleMinQty: null,
      baseUnitId: listUnits(db).find((u) => u.short === 'pcs')!.id, altUnitId: null, altConversion: null, trackStock: true,
      openingQty: 5_000, openingRate: 50_000, openingDate: '2026-04-01', lowStockQty: null, customFields: ['S', 'Blue', '', '']
    }
  })
  afterEach(() => db.close())

  it('saves the format with this accounting year as the start', () => {
    const f = saveCodeFormat(db, { ...yearly({ startCode: 'ee' }), startFy: '' })
    expect(f).toMatchObject({ kind: 'yearly', startCode: 'EE', startFy: currentFy(db) })
    expect(getCodeFormat(db)).toEqual(f)
    expect(() => saveCodeFormat(db, yearly({ startCode: 'E' }))).toThrow(/two capital letters/)
  })

  it('numbers new items AA-00001~1, AA-00002~1 and gives sizes ~2, ~3', () => {
    saveCodeFormat(db, yearly({ startFy: currentFy(db) }))
    const kurti = createItem(db, base)
    const bag = createItem(db, { ...base, name: 'Jolna Bag', customFields: null })
    expect(assignBarcodes(db, [kurti.id, bag.id])).toBe(2)
    expect(getItem(db, kurti.id).barcode).toBe('AA-00001~1')
    expect(getItem(db, bag.id).barcode).toBe('AA-00002~1')

    const sizes = addItemSizes(db, kurti.id, [{ size: 'M' }, { size: 'L', salePrice: 84_900 }])
    expect(sizes.map((i) => [i.name, i.barcode, i.customFields?.[0], i.customFields?.[1], i.salePrice, i.stockQty])).toEqual([
      ['Cotton Kurti (M)', 'AA-00001~2', 'M', 'Blue', 79_900, 0],
      ['Cotton Kurti (L)', 'AA-00001~3', 'L', 'Blue', 84_900, 0]
    ])
    // Sizes do not use up product numbers: the next product is still 3.
    expect(generateBarcode(db)).toBe('AA-00003~1')
    // A size already there is refused; an item without a barcode gets one first.
    expect(() => addItemSizes(db, kurti.id, [{ size: 's' }])).toThrow(/already size S/)
    expect(() => addItemSizes(db, kurti.id, [{ size: 'XL' }, { size: 'xl' }])).toThrow(/twice/)
    expect(() => addItemSizes(db, kurti.id, [{ size: ' ' }])).toThrow(/at least one size/)
    const top = createItem(db, { ...base, name: 'Crop Top' })
    expect(addItemSizes(db, top.id, [{ size: 'M' }])[0]!.barcode).toBe('AA-00003~2')
    expect(getItem(db, top.id).barcode).toBe('AA-00003~1')
  })

  it('gives each size a new code when codes have no size number', () => {
    const kurti = createItem(db, base)
    const sizes = addItemSizes(db, kurti.id, [{ size: 'M' }, { size: 'L' }])
    const codes = [getItem(db, kurti.id).barcode, ...sizes.map((s) => s.barcode)]
    expect(new Set(codes).size).toBe(3)
    expect(codes.every((c) => /^2\d{12}$/.test(c))).toBe(true)
  })
})
