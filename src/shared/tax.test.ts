import { describe, expect, it } from 'vitest'
import { amountInWords, computeLine, computeTax, perBaseUnit, priceForDocument, type TaxLine } from './tax'

const line = (over: Partial<TaxLine> = {}): TaxLine => ({
  qty: 1000,
  rate: 10_000,
  discountPctBp: 0,
  discountAmount: 0,
  taxRateBp: 1800,
  cessBp: 0,
  ...over
})

describe('computeLine', () => {
  it('splits intra-state tax into CGST and SGST', () => {
    const r = computeLine(line({ qty: 2000 }), false, 'intra') // 2 × ₹100 @18%
    expect(r).toMatchObject({ gross: 20_000, taxable: 20_000, cgst: 1800, sgst: 1800, igst: 0, total: 23_600 })
  })

  it('charges IGST between states', () => {
    expect(computeLine(line(), false, 'inter')).toMatchObject({ cgst: 0, sgst: 0, igst: 1800, total: 11_800 })
  })

  it('keeps odd paise when halving tax', () => {
    const r = computeLine(line({ rate: 1001, taxRateBp: 500 }), false, 'intra') // tax 50.05 -> 50 paise
    expect(r.cgst + r.sgst).toBe(50)
    expect(r.cgst - r.sgst).toBeLessThanOrEqual(1)
  })

  it('backs tax out of tax-inclusive prices exactly', () => {
    const r = computeLine(line({ rate: 11_800 }), true, 'intra')
    expect(r).toMatchObject({ taxable: 10_000, cgst: 900, sgst: 900, total: 11_800 })
    const odd = computeLine(line({ rate: 9_999, taxRateBp: 1200 }), true, 'intra')
    expect(odd.total).toBe(9_999)
    expect(odd.taxable + odd.cgst + odd.sgst).toBe(9_999)
  })

  it('applies percentage and fixed discounts before tax', () => {
    expect(computeLine(line({ discountPctBp: 1000 }), false, 'intra')).toMatchObject({ discount: 1000, taxable: 9000, total: 10_620 })
    expect(computeLine(line({ discountAmount: 2500 }), false, 'intra')).toMatchObject({ discount: 2500, taxable: 7500 })
    expect(computeLine(line({ discountAmount: 50_000 }), false, 'intra').taxable).toBe(0) // capped at gross
  })

  it('adds cess on the taxable value', () => {
    const r = computeLine(line({ taxRateBp: 2800, cessBp: 1200 }), false, 'inter')
    expect(r).toMatchObject({ igst: 2800, cess: 1200, total: 14_000 })
    const inc = computeLine(line({ rate: 14_000, taxRateBp: 2800, cessBp: 1200 }), true, 'inter')
    expect(inc).toMatchObject({ taxable: 10_000, igst: 2800, cess: 1200 })
  })

  it('handles fractional quantities', () => {
    expect(computeLine(line({ qty: 1_250, rate: 8_000, taxRateBp: 500 }), false, 'intra').taxable).toBe(10_000)
  })
})

describe('computeTax', () => {
  it('totals lines and taxed charges, rounds off, and groups by rate', () => {
    const r = computeTax({
      lines: [line({ rate: 10_050 }), line({ rate: 5_000, taxRateBp: 500 })],
      charges: [{ amount: 1000, taxRateBp: 1800 }],
      pricesIncludeTax: false,
      supply: 'intra',
      roundOff: true
    })
    // taxable 100.50 + 50 = 150.50; tax 18.09 + 2.50 + 1.80 (charge) = 22.39; charge 10
    expect(r.taxableTotal).toBe(15_050)
    expect(r.chargesTotal).toBe(1000)
    expect(r.totalTax).toBe(2239)
    expect(r.cgst + r.sgst).toBe(2239)
    expect(r.grandTotal).toBe(18_300) // 182.89 -> 183
    expect(r.roundOff).toBe(11)
    expect(r.byRate.map((g) => [g.rateBp, g.taxable])).toEqual([[500, 5000], [1800, 11_050]])
  })

  it('leaves totals unrounded when round-off is off', () => {
    const r = computeTax({ lines: [line({ rate: 10_050 })], charges: [], pricesIncludeTax: false, supply: 'inter', roundOff: false })
    expect(r.roundOff).toBe(0)
    expect(r.grandTotal).toBe(11_859)
  })
})

describe('price helpers', () => {
  it('converts item prices between with-tax and without-tax', () => {
    expect(priceForDocument(11_800, true, false, 1800)).toBe(10_000)
    expect(priceForDocument(10_000, false, true, 1800)).toBe(11_800)
    expect(priceForDocument(10_000, true, true, 1800)).toBe(10_000)
  })

  it('works out a per-base-unit rate', () => {
    expect(perBaseUnit(12_000, 12_000)).toBe(1000)
    expect(perBaseUnit(100, 0)).toBe(0)
  })
})

describe('amountInWords', () => {
  it('uses lakh and crore', () => {
    expect(amountInWords(0)).toBe('Zero Rupees Only')
    expect(amountInWords(100)).toBe('One Rupee Only')
    expect(amountInWords(18_300)).toBe('One Hundred Eighty Three Rupees Only')
    expect(amountInWords(123_456)).toBe('One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paise Only')
    expect(amountInWords(1_25_00_000_00)).toBe('One Crore Twenty Five Lakh Rupees Only')
    expect(amountInWords(99_99_999_00)).toBe('Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Rupees Only')
  })
})
