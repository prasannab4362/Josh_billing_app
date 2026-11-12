import { describe, expect, it } from 'vitest'
import { formatQty, lineAmount, toBaseUnits, toMilli } from './qty'

describe('toMilli', () => {
  it.each([
    ['1', 1000],
    ['0.5', 500],
    ['2.125', 2125],
    ['1,000', 1000000],
    ['0.0005', 1],
    ['-3', -3000]
  ])('%s -> %i', (input, expected) => {
    expect(toMilli(input)).toBe(expected)
  })
  it('rejects bad input', () => {
    expect(() => toMilli('two')).toThrow(RangeError)
  })
})

describe('formatQty', () => {
  it.each([
    [2000, '2'],
    [1500, '1.5'],
    [125, '0.125'],
    [-250, '-0.25']
  ])('%i -> %s', (milli, expected) => {
    expect(formatQty(milli)).toBe(expected)
  })
})

describe('lineAmount', () => {
  it('multiplies quantity by rate', () => {
    expect(lineAmount(3000, 25000)).toBe(75000) // 3 × ₹250
    expect(lineAmount(500, 12000)).toBe(6000) // 0.5 kg × ₹120
    expect(lineAmount(333, 100)).toBe(33) // 0.333 × ₹1 = 33.3 paise
  })
})

describe('toBaseUnits', () => {
  it('converts boxes to pieces', () => {
    expect(toBaseUnits(2000, 12000)).toBe(24000) // 2 box × 12 pcs
  })
})
