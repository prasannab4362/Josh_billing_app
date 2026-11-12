// QR codes (ISO/IEC 18004), byte mode, versions 1–40, drawn as SVG. Written for labels: the code
// holds the item's barcode or item code, so a 2D scanner types it into the bill like a 1D one.

export type QrLevel = 'L' | 'M' | 'Q' | 'H'

// Error-correction codewords per block, and number of blocks, by level and version (index 0 unused).
const ECC_PER_BLOCK: Record<QrLevel, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
}
const BLOCKS: Record<QrLevel, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
}
const LEVEL_BITS: Record<QrLevel, number> = { L: 1, M: 0, Q: 3, H: 2 }

/** Modules that carry data or error correction (everything but the fixed patterns). */
function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}
const dataCodewords = (ver: number, lvl: QrLevel) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[lvl][ver] * BLOCKS[lvl][ver]

/** Most bytes that fit in a QR code of this version and level. */
export function qrCapacity(ver: number, lvl: QrLevel): number {
  return Math.floor((dataCodewords(ver, lvl) * 8 - 4 - (ver < 10 ? 8 : 16)) / 8)
}

// Arithmetic in GF(2^8) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}
function rsDivisor(degree: number): number[] {
  const out = new Array(degree).fill(0)
  out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root)
      if (j + 1 < degree) out[j] ^= out[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return out
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const out = new Array(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (out.shift() as number)
    out.push(0)
    divisor.forEach((d, i) => (out[i] ^= gfMul(d, factor)))
  }
  return out
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2
  const out = [6]
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
]

/** Penalty score of a finished symbol (lower is easier to read). */
function penalty(m: boolean[][]): number {
  const size = m.length
  let score = 0
  const lines: boolean[][] = []
  for (let i = 0; i < size; i++) {
    lines.push(m[i])
    lines.push(m.map((row) => row[i]))
  }
  const finderLike = [true, false, true, true, true, false, true]
  for (const line of lines) {
    // Runs of five or more of one colour.
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++
      else {
        if (run >= 5) score += run - 2
        run = 1
      }
    }
    // Finder-like 1:1:3:1:1 with four light modules on one side.
    for (let i = 0; i + 7 <= size; i++) {
      if (!finderLike.every((v, k) => line[i + k] === v)) continue
      const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !line[i - k])
      const lightAfter = [0, 1, 2, 3].every((k) => i + 7 + k >= size || !line[i + 7 + k])
      if (lightBefore || lightAfter) score += 40
    }
  }
  // 2 × 2 blocks of one colour.
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const c = m[y][x]
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
    }
  // Balance of dark and light.
  const dark = m.reduce((s, row) => s + row.filter(Boolean).length, 0)
  const total = size * size
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

/** The QR symbol as rows of modules (true = dark), without the quiet zone. */
export function qrModules(text: string, level: QrLevel = 'M', onlyMask?: number): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)]
  let ver = 1
  while (ver <= 40 && qrCapacity(ver, level) < bytes.length) ver++
  if (ver > 40) throw new Error('Too much text for a QR code')

  // Data: byte mode, length, bytes, terminator, then pad to the full count.
  const bits: number[] = []
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, ver < 10 ? 8 : 16)
  bytes.forEach((b) => put(b, 8))
  const capacityBits = dataCodewords(ver, level) * 8
  put(0, Math.min(4, capacityBits - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // Split into blocks, add error correction, interleave.
  const numBlocks = BLOCKS[level][ver]
  const eccLen = ECC_PER_BLOCK[level][ver]
  const rawCodewords = Math.floor(rawModules(ver) / 8)
  const numShort = numBlocks - (rawCodewords % numBlocks)
  const shortLen = Math.floor(rawCodewords / numBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - eccLen + (i < numShort ? 0 : 1)
    const dat = data.slice(k, k + len)
    k += len
    const ecc = rsRemainder(dat, divisor)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i])
    })

  // Fixed patterns.
  const size = ver * 4 + 17
  const mod: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const fixed: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    mod[y][x] = dark
    fixed[y][x] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
  }
  const al = alignmentPositions(ver)
  al.forEach((ay, i) =>
    al.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    })
  )
  const drawFormat = (mask: number) => {
    const d = (LEVEL_BITS[level] << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const f = ((d << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((f >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6))
    set(8, 8, bit(7))
    set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  drawFormat(0) // reserves the format areas
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const v = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const b = ((v >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      set(a, c, b)
      set(c, a, b)
    }
  }

  // Codewords in the zigzag, two columns at a time, skipping the timing column.
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
        if (!fixed[y][x] && i < codewords.length * 8) {
          mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
          i++
        }
      }
  }

  // Try each mask and keep the easiest to read.
  let best: boolean[][] = []
  let bestScore = Infinity
  for (let m = 0; m < 8; m++) {
    if (onlyMask !== undefined && m !== onlyMask) continue
    const f = MASKS[m]
    drawFormat(m)
    const trial = mod.map((row, y) => row.map((dark, x) => (fixed[y][x] ? dark : dark !== f(x, y))))
    const s = penalty(trial)
    if (s < bestScore) {
      bestScore = s
      best = trial
    }
  }
  return best
}

/** A QR code as an SVG with a four-module quiet zone; it scales to whatever box it is put in. */
export function qrSvg(text: string, level: QrLevel = 'M'): string {
  const m = qrModules(text, level)
  const q = 4
  const n = m.length + q * 2
  let d = ''
  m.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let end = x
      while (end + 1 < row.length && row[end + 1]) end++
      d += `M${x + q} ${y + q}h${end - x + 1}v1h-${end - x + 1}z`
      x = end
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><path d="${d}"/></svg>`
}
