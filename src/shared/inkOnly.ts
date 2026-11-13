// Keep only the ink of a signature photographed on paper: the paper becomes transparent, so the signature
// prints cleanly on any invoice or thermal bill instead of as a grey box. Works on RGBA pixel data in place.

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/**
 * Make the paper around the ink transparent. Returns false (and changes nothing) when the picture does not look
 * like ink on light paper: already transparent, or too dark to tell paper from ink.
 */
export function inkOnly(px: Uint8ClampedArray): boolean {
  const n = px.length / 4
  if (n === 0) return false
  // Already a clean cut-out (a PNG with transparency): leave it alone.
  let clear = 0
  for (let i = 3; i < px.length; i += 4) if (px[i] < 16) clear++
  if (clear > n * 0.2) return false

  // Paper is most of the picture: take a bright percentile of the brightness as the paper's shade.
  const hist = new Array(256).fill(0)
  for (let i = 0; i < px.length; i += 4) hist[Math.round(lum(px[i], px[i + 1], px[i + 2]))]++
  let seen = 0
  let paper = 255
  for (let v = 255; v >= 0; v--) {
    seen += hist[v]
    if (seen >= n * 0.5) {
      paper = v
      break
    }
  }
  if (paper < 110) return false

  // Lighter than just under the paper: gone. Darker: kept, fading in over a soft band so edges stay smooth.
  const clearAbove = paper - 28
  const solidBelow = Math.max(0, paper - 110)
  for (let i = 0; i < px.length; i += 4) {
    const l = lum(px[i], px[i + 1], px[i + 2])
    if (l >= clearAbove) px[i + 3] = 0
    else if (l > solidBelow) px[i + 3] = Math.min(px[i + 3], Math.round((255 * (clearAbove - l)) / (clearAbove - solidBelow)))
  }
  return true
}
