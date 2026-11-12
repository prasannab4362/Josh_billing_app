import { describe, expect, it } from 'vitest'
import { barcodeSvg, CODE128, code128Modules, code128Values, ean13CheckDigit, ean13Modules, isEan13, nextStoreEan } from './barcode'
import { DEFAULT_LABEL_OPTIONS, LABEL_LAYOUTS, labelFit, labelsHtml, MIN_LABEL_PT, type LabelData, type LabelOptions } from './labels'

describe('EAN-13', () => {
  it('computes check digits of real product codes', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1)
    expect(ean13CheckDigit('890123456789')).toBe(0) // an Indian (890) prefix
    expect(isEan13('4006381333931')).toBe(true)
    expect(isEan13('4006381333932')).toBe(false)
    expect(isEan13('12345')).toBe(false)
  })

  it('encodes to 95 modules with guard bars in place', () => {
    const m = ean13Modules('4006381333931')
    expect(m).toHaveLength(95)
    expect(m.slice(0, 3)).toBe('101')
    expect(m.slice(45, 50)).toBe('01010')
    expect(m.slice(92)).toBe('101')
    // First digit 4 → parity LGLLGG; second digit 0 in set L.
    expect(m.slice(3, 10)).toBe('0001101')
    expect(m.slice(10, 17)).toBe('0100111') // 0 in set G
  })

  it('hands out in-store codes starting with 2, one after another', () => {
    expect(nextStoreEan([])).toBe('2000000000015')
    expect(nextStoreEan(['2000000000015', '8901234567891'])).toBe('2000000000022')
    expect(isEan13(nextStoreEan(['2000000000992']))).toBe(true)
  })
})

describe('Code 128', () => {
  it('has a complete, valid pattern table', () => {
    expect(CODE128).toHaveLength(107)
    expect(new Set(CODE128).size).toBe(107)
    for (const p of CODE128.slice(0, 106)) expect([...p].reduce((s, d) => s + Number(d), 0)).toBe(11)
    expect([...CODE128[106]].reduce((s, d) => s + Number(d), 0)).toBe(13)
  })

  it('uses set B for text and set C for digit runs, with the right check value', () => {
    // "ABC": start B (104), A=33, B=34, C=35; check = (104 + 33 + 68 + 105) % 103 = 1
    expect(code128Values('ABC')).toEqual([104, 33, 34, 35, 1, 106])
    // "123456" packs into pairs: start C, 12, 34, 56
    expect(code128Values('123456').slice(0, 4)).toEqual([105, 12, 34, 56])
    // Odd digit run after text: switches to C for the pairs, back to B for the last digit
    expect(code128Values('TS12345').slice(0, 7)).toEqual([104, 52, 51, 99, 12, 34, 100])
    expect(() => code128Values('रु')).toThrow(/ASCII/)
  })

  it('has bar–space widths that add up', () => {
    const m = code128Modules('ABC')
    expect(m).toHaveLength(11 * 5 + 13)
    expect(m.startsWith('11010010000')).toBe(true) // start B = 211214
    expect(m.endsWith('1100011101011')).toBe(true) // stop
  })
})

describe('drawing and labels', () => {
  it('draws EAN-13 codes as EAN and other codes as Code 128', () => {
    expect(barcodeSvg('4006381333931')).toContain('viewBox="0 0 115 40"') // 95 modules + quiet zones
    expect(barcodeSvg('TSHIRT-M-RED')).toMatch(/<svg[^>]*class="barcode">(<rect [^>]+\/>)+<\/svg>/)
  })

  const label: LabelData = { name: 'T-shirt <M>', code: '2000000000015', itemCode: '', category: '', hsn: '', description: '', price: 45_150, mrp: 49_900 }
  const opts: LabelOptions = { ...DEFAULT_LABEL_OPTIONS, layout: 'a4-65' }

  it('fills A4 sheets, starting a new sheet after 65', () => {
    const html = labelsHtml(Array(70).fill(label), opts, "Kumar's")
    expect(html.match(/<div class="sheet">/g)).toHaveLength(2)
    expect(html.match(/<div class="label">/g)).toHaveLength(70)
    expect(html).toContain('T-shirt &lt;M&gt;')
    expect(html).toContain('₹451.50')
    expect(html).toContain('MRP ₹499.00')
    expect(html).toContain("Kumar's")
    expect(html).toContain('grid-template-columns: repeat(5, 38.1mm)')
  })

  it('can skip used places on a sheet, and print rolls one row per page', () => {
    const skipped = labelsHtml([label], { ...opts, skip: 3 }, '')
    expect(skipped.match(/label empty/g)).toHaveLength(3)
    const lines = [{ field: 'name' as const, text: '' }]
    const roll = labelsHtml([label, label], { ...opts, layout: 'roll-50x25', header: { field: 'none', text: '' }, lines }, "Kumar's")
    expect(roll).toContain('@page { size: 50mm 25mm; margin: 0; }')
    expect(roll.match(/<div class="row">/g)).toHaveLength(2)
    expect(roll).not.toContain('MRP')
    expect(roll).not.toContain('class="head"')
    const custom = labelsHtml([label], { ...opts, layout: 'roll-custom', custom: { width: 40, height: 30, across: 3, gap: 1.5 } }, '')
    expect(custom).toContain('@page { size: 123mm 30mm; margin: 0; }')
    expect(custom.match(/label empty/g)).toHaveLength(2)
  })

  it('shrinks text to fit the label, and says when lines will not fit', () => {
    // A 65-per-sheet label (21 mm tall) holds header, three lines and the code under a barcode.
    const small = labelFit(LABEL_LAYOUTS['a4-65'], 'barcode', 5)
    expect(small.fits).toBe(true)
    expect(small.pt).toBeGreaterThanOrEqual(MIN_LABEL_PT)
    expect(small.pt).toBeLessThan(labelFit(LABEL_LAYOUTS['a4-65'], 'barcode', 2).pt)
    expect(labelFit(LABEL_LAYOUTS['roll-100x50'], 'barcode', 3)).toEqual({ pt: 10, fits: true })
    expect(labelFit({ width: 25, height: 15 }, 'barcode', 6).fits).toBe(false)
    const tight = labelsHtml([label], { ...opts, layout: 'roll-custom', custom: { width: 25, height: 15, across: 1, gap: 0 },
      lines: ['name', 'price', 'mrp', 'hsn'].map((f) => ({ field: f as 'name', text: '' })), header: { field: 'business', text: '' } }, 'Shop')
    expect(tight).toContain('content="tight"')
    expect(labelsHtml([label], opts, 'Shop')).toContain('content="ok"')
  })
})
