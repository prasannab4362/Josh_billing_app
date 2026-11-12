import { describe, expect, it } from 'vitest'
import { applyRate, divRound, formatINR, removeTax, roundOffToRupee, splitHalves, toPaise } from './money'

describe('divRound', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5, 2)).toBe(3)
    expect(divRound(-5, 2)).toBe(-3)
    expect(divRound(4, 3)).toBe(1)
    expect(divRound(-4, 3)).toBe(-1)
    expect(divRound(7, -2)).toBe(-4)
  })
  it('rejects division by zero', () => {
    expect(() => divRound(1, 0)).toThrow(RangeError)
  })
})

describe('toPaise', () => {
  it.each([
    ['100', 10000],
    ['0.5', 50],
    ['.75', 75],
    ['1,234.56', 123456],
    ['₹ 99.99', 9999],
    ['10.005', 1001],
    ['10.004', 1000],
    ['-12.30', -1230],
    [42, 4200]
  ])('%s -> %i paise', (input, expected) => {
    expect(toPaise(input)).toBe(expected)
  })
  it.each(['', 'abc', '1.2.3', '-', '.'])('rejects "%s"', (input) => {
    expect(() => toPaise(input)).toThrow(RangeError)
  })
})

describe('formatINR', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [99999, '₹999.99'],
    [100000, '₹1,000.00'],
    [12345678, '₹1,23,456.78'],
    [1234567890, '₹1,23,45,678.90'],
    [-150050, '-₹1,500.50']
  ])('%i -> %s', (paise, expected) => {
    expect(formatINR(paise)).toBe(expected)
  })
  it('can omit the symbol', () => {
    expect(formatINR(100000, { symbol: false })).toBe('1,000.00')
  })
})

describe('GST helpers', () => {
  it('applies 18% to ₹100', () => {
    expect(applyRate(10000, 1800)).toBe(1800)
  })
  it('rounds tax to the nearest paisa', () => {
    expect(applyRate(333, 1800)).toBe(60) // 59.94 -> 60
  })
  it('removes 18% from a ₹118 inclusive price', () => {
    expect(removeTax(11800, 1800)).toBe(10000)
  })
  it('splits odd tax so halves add back to the total', () => {
    expect(splitHalves(1801)).toEqual({ cgst: 901, sgst: 900 })
    const { cgst, sgst } = splitHalves(12345)
    expect(cgst + sgst).toBe(12345)
  })
  it('rounds off to the nearest rupee', () => {
    expect(roundOffToRupee(118049)).toEqual({ roundOff: -49, rounded: 118000 })
    expect(roundOffToRupee(118050)).toEqual({ roundOff: 50, rounded: 118100 })
  })
})
