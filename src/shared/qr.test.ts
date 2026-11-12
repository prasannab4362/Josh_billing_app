import { describe, expect, it } from 'vitest'
import { qrCapacity, qrModules, qrSvg } from './qr'

// Every size and level was also read back with OpenCV's QR reader while this was written; these
// tests pin the parts a reader depends on.
describe('QR codes', () => {
  it('pick the smallest size that holds the text', () => {
    expect(qrModules('2000000000015')).toHaveLength(21) // version 1
    expect(qrModules('x'.repeat(qrCapacity(1, 'M') + 1))).toHaveLength(25) // version 2
    expect(qrCapacity(1, 'M')).toBe(14)
    expect(qrCapacity(10, 'M')).toBe(213)
    expect(qrCapacity(40, 'L')).toBe(2953)
    expect(() => qrModules('x'.repeat(3000), 'L')).toThrow(/Too much text/)
  })

  it('draw the finder, timing and dark-module patterns', () => {
    for (const ver of [1, 7, 20]) {
      const n = ver * 4 + 17
      const m = qrModules('a'.repeat(qrCapacity(ver, 'M')))
      expect(m).toHaveLength(n)
      const finder = (x0: number, y0: number) =>
        Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => m[y0 + y][x0 + x] ? 1 : 0).join('')).join('|')
      const expected = '1111111|1000001|1011101|1011101|1011101|1000001|1111111'
      expect(finder(0, 0)).toBe(expected)
      expect(finder(n - 7, 0)).toBe(expected)
      expect(finder(0, n - 7)).toBe(expected)
      for (let i = 8; i < n - 8; i++) expect(m[6][i]).toBe(i % 2 === 0)
      expect(m[n - 8][8]).toBe(true)
    }
  })

  it('carry the error-correction level and mask in the format bits', () => {
    // Level M, mask 0 → format word 101010000010010.
    const m = qrModules('HELLO', 'M', 0)
    const bits = [0, 1, 2, 3, 4, 5, 7, 8].map((y) => (m[y][8] ? 1 : 0)).join('') + [7, 5, 4, 3, 2, 1, 0].map((x) => (m[8][x] ? 1 : 0)).join('')
    expect(bits.split('').reverse().join('')).toBe('101010000010010')
  })

  it('encode text in UTF-8 and draw an SVG with a quiet zone', () => {
    const svg = qrSvg('₹451.50')
    expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 29 29"/)
    expect(svg).toContain('<path d="M4 4h7v1h-7z')
  })
})
