import { describe, expect, it } from 'vitest'
import { inkOnly } from './inkOnly'

/** A w × h picture filled with one colour, as RGBA. */
const picture = (w: number, h: number, rgb: [number, number, number], alpha = 255) => {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < px.length; i += 4) px.set([...rgb, alpha], i)
  return px
}
const pixel = (px: Uint8ClampedArray, i: number) => Array.from(px.slice(i * 4, i * 4 + 4))

describe('signature background removal', () => {
  it('makes off-white paper transparent and keeps blue ink solid', () => {
    const px = picture(10, 10, [247, 246, 242]) // off-white paper, as photographed
    px.set([30, 58, 138, 255], 0) // dark blue ink
    px.set([150, 160, 200, 255], 4) // the soft edge of a stroke
    expect(inkOnly(px)).toBe(true)
    expect(pixel(px, 0)).toEqual([30, 58, 138, 255])
    expect(pixel(px, 5)[3]).toBe(0)
    const edge = pixel(px, 1)[3]
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)
  })

  it('handles greyish paper from a phone photo in poor light', () => {
    const px = picture(10, 10, [190, 188, 182])
    px.set([20, 20, 20, 255], 0)
    expect(inkOnly(px)).toBe(true)
    expect(pixel(px, 0)[3]).toBe(255)
    expect(pixel(px, 9)[3]).toBe(0)
  })

  it('leaves pictures alone when they are already cut out or too dark to tell', () => {
    const cut = picture(10, 10, [0, 0, 0], 0)
    cut.set([20, 20, 20, 255], 0)
    expect(inkOnly(cut)).toBe(false)
    const dark = picture(10, 10, [60, 60, 60])
    expect(inkOnly(dark)).toBe(false)
    expect(pixel(dark, 0)).toEqual([60, 60, 60, 255])
  })
})
