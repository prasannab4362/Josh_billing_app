// Barcodes drawn as SVG: EAN-13 for 13-digit retail codes, Code 128 for anything else.
// Both are standard symbologies every USB/Bluetooth scanner reads.

// ---------- EAN-13 ----------

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''))
/** Which of the six left digits use the G set, chosen by the first digit. */
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** Check digit for the first 12 digits of an EAN-13. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new RangeError('EAN-13 needs 12 digits before the check digit')
  const sum = [...first12].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10
}

export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/** 95 modules: 1 = bar, 0 = space. */
export function ean13Modules(code: string): string {
  if (!isEan13(code)) throw new RangeError(`Not a valid EAN-13: ${code}`)
  const d = [...code].map(Number)
  const parity = EAN_PARITY[d[0]]
  let left = ''
  for (let i = 1; i <= 6; i++) left += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[d[i]]
  let right = ''
  for (let i = 7; i <= 12; i++) right += EAN_R[d[i]]
  return `101${left}01010${right}101`
}

// ---------- Code 128 ----------

/** Bar/space widths for values 0–106 (103–105 are the starts, 106 the stop). */
export const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
]
const START_B = 104
const START_C = 105
const CODE_B = 100
const CODE_C = 99
const STOP = 106

/** Symbol values for a text: digit pairs use set C (half the width), everything else set B. */
export function code128Values(text: string): number[] {
  if (!/^[\x20-\x7E]+$/.test(text)) throw new RangeError('Code 128 here supports printable ASCII only')
  const values: number[] = []
  let set: 'B' | 'C' | null = null
  let i = 0
  const digitsAt = (k: number) => {
    let n = 0
    while (k + n < text.length && /\d/.test(text[k + n])) n++
    return n
  }
  while (i < text.length) {
    const run = digitsAt(i)
    // Switch to C for 4+ digits (or the whole text being an even run of digits).
    const useC = run >= 4 || (run === text.length && run >= 2 && run % 2 === 0)
    if (useC) {
      const pairs = Math.floor(run / 2)
      if (set !== 'C') values.push(set === null ? START_C : CODE_C)
      set = 'C'
      for (let p = 0; p < pairs; p++, i += 2) values.push(Number(text.slice(i, i + 2)))
      if (run % 2 === 0) continue
    }
    if (set !== 'B') values.push(set === null ? START_B : CODE_B)
    set = 'B'
    values.push(text.charCodeAt(i) - 32)
    i++
  }
  const check = values.reduce((s, v, k) => s + v * (k === 0 ? 1 : k), 0) % 103
  return [...values, check, STOP]
}

/** Modules (1 = bar, 0 = space) for a Code 128 symbol. */
export function code128Modules(text: string): string {
  let out = ''
  for (const v of code128Values(text)) {
    const widths = CODE128[v]
    for (let k = 0; k < widths.length; k++) out += (k % 2 === 0 ? '1' : '0').repeat(Number(widths[k]))
  }
  return out
}

// ---------- Drawing ----------

export interface BarcodeSvgOptions {
  /** Height of the bars, in the SVG's own units. */
  height?: number
  /** Quiet zone either side, in modules (scanners need it). */
  quiet?: number
}

/**
 * The barcode as an SVG that stretches to its container's width. EAN-13 when the code is a valid
 * EAN-13, Code 128 otherwise.
 */
export function barcodeSvg(code: string, opts: BarcodeSvgOptions = {}): string {
  const modules = isEan13(code) ? ean13Modules(code) : code128Modules(code)
  const quiet = opts.quiet ?? 10
  const height = opts.height ?? 40
  const width = modules.length + quiet * 2
  let rects = ''
  for (let i = 0; i < modules.length; ) {
    if (modules[i] === '1') {
      let n = 1
      while (modules[i + n] === '1') n++
      rects += `<rect x="${i + quiet}" y="0" width="${n}" height="${height}"/>`
      i += n
    } else i++
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges" class="barcode">${rects}</svg>`
}

/** Next in-store EAN-13 (prefix 2, reserved for a shop's own codes) after the ones already used. */
export function nextStoreEan(used: string[]): string {
  let max = 200_000_000_000
  for (const u of used) if (/^2\d{12}$/.test(u)) max = Math.max(max, Number(u.slice(0, 12)))
  const body = String(max + 1)
  return body + ean13CheckDigit(body)
}

/**
 * How new barcode numbers are made: in-store EAN-13 (prefix 2), or the shop's own pattern such as
 * prefix "472-", 5 digits, suffix "~1" → 472-00001~1, 472-00002~1 (printed as Code 128 or a QR code).
 */
export type CodeFormat =
  | { kind: 'ean13' }
  | { kind: 'pattern'; prefix: string; digits: number; suffix: string }
  | {
      kind: 'yearly'
      /** Two letters for the first accounting year, e.g. 'AA' (or 'EE' to start there). */
      startCode: string
      /** The accounting year that gets startCode, e.g. '2026-27'. Each later year moves one step: AA, AB, AC … ZZ. */
      startFy: string
      /** Digits in the running product number (00001). */
      digits: number
      /** Between the year letters and the number, e.g. '-' (may be empty). */
      separator: string
      /** true: the product number starts again at 1 each year; false: it carries on from last year. */
      restartEachYear: boolean
      /** Add a size number after '~' (AA-00001~1, ~2, ~3 …). Sizes of one product share the product number. */
      sizeNumbers: boolean
    }

export type YearlyFormat = Extract<CodeFormat, { kind: 'yearly' }>

export const DEFAULT_CODE_FORMAT: CodeFormat = { kind: 'ean13' }

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A problem with a pattern, or ''. */
export function codeFormatError(f: CodeFormat): string {
  if (f?.kind === 'ean13') return ''
  if (f?.kind === 'yearly') {
    if (typeof f.startCode !== 'string' || !/^[A-Z]{2}$/.test(f.startCode)) return 'Year letters: two capital letters from AA to ZZ'
    if (typeof f.startFy !== 'string' || !/^\d{4}(-\d{2})?$/.test(f.startFy)) return 'Choose the accounting year the letters start from'
    if (!Number.isInteger(f.digits) || f.digits < 3 || f.digits > 8) return 'Use 3 to 8 digits for the product number'
    if (typeof f.separator !== 'string' || !['', '-', '/', '.', '#', '_'].includes(f.separator)) return 'Between letters and number: nothing, or one of - / . # _'
    return ''
  }
  if (f?.kind !== 'pattern') return 'Choose how barcode numbers are made'
  if (!Number.isInteger(f.digits) || f.digits < 3 || f.digits > 10) return 'Use 3 to 10 digits for the running number'
  for (const part of [f.prefix, f.suffix]) {
    if (typeof part !== 'string' || !/^[\x21-\x7E]{0,12}$/.test(part)) return 'Prefix and suffix: up to 12 English letters, digits or symbols, no spaces'
  }
  if (!f.prefix && !f.suffix) return 'Give the pattern a prefix or a suffix, so its numbers cannot be mistaken for others'
  return ''
}

/** Year letters for an accounting year: startCode in startFy, one step on for each year after (AA, AB … AZ, BA … ZZ). */
export function yearLetters(f: Pick<YearlyFormat, 'startCode' | 'startFy'>, fy: string): string {
  const start = LETTERS.indexOf(f.startCode[0]!) * 26 + LETTERS.indexOf(f.startCode[1]!)
  const step = Math.max(0, Number(fy.slice(0, 4)) - Number(f.startFy.slice(0, 4)))
  const n = start + step
  if (n > 675) throw new RangeError('The year letters have gone past ZZ; choose new starting letters')
  return LETTERS[Math.floor(n / 26)]! + LETTERS[n % 26]!
}

function yearlyCode(f: YearlyFormat, fy: string, n: number, size = 1): string {
  return `${yearLetters(f, fy)}${f.separator}${String(n).padStart(f.digits, '0')}${f.sizeNumbers ? `~${size}` : ''}`
}

/** The pattern written as an example, e.g. "472-00001~1" or "AA-00001~1". fy is needed for year letters. */
export function codeFormatExample(f: CodeFormat, n = 1, fy?: string): string {
  if (f.kind === 'ean13') return nextStoreEan([])
  if (f.kind === 'yearly') return yearlyCode(f, fy ?? f.startFy, n)
  return `${f.prefix}${String(n).padStart(f.digits, '0')}${f.suffix}`
}

/** Next unused number of the pattern after the highest one already used. */
export function nextPatternCode(used: string[], f: Extract<CodeFormat, { kind: 'pattern' }>): string {
  const re = new RegExp(`^${esc(f.prefix)}(\\d{${f.digits}})${esc(f.suffix)}$`)
  let max = 0
  for (const u of used) {
    const m = re.exec(u)
    if (m) max = Math.max(max, Number(m[1]))
  }
  const next = max + 1
  if (String(next).length > f.digits) throw new RangeError(`All ${f.digits}-digit numbers of this pattern are used; add a digit`)
  return codeFormatExample(f, next)
}

/**
 * Next product number with year letters. Restarting each year counts only this year's codes; carrying on counts
 * every year's codes of the format (any two letters). Size numbers (~1, ~2) do not make new product numbers.
 */
export function nextYearlyCode(used: string[], f: YearlyFormat, fy: string): string {
  const letters = f.restartEachYear ? yearLetters(f, fy) : '[A-Z]{2}'
  const re = new RegExp(`^${letters}${esc(f.separator)}(\\d{${f.digits}})(?:~\\d{1,3})?$`)
  let max = 0
  for (const u of used) {
    const m = re.exec(u)
    if (m) max = Math.max(max, Number(m[1]))
  }
  const next = max + 1
  if (String(next).length > f.digits) throw new RangeError(`All ${f.digits}-digit product numbers are used; add a digit`)
  return yearlyCode(f, fy, next)
}

/** The next barcode number for the chosen way of making them. fy (e.g. '2026-27') is today's accounting year. */
export function nextCode(used: string[], f: CodeFormat, fy = ''): string {
  if (f.kind === 'pattern') return nextPatternCode(used, f)
  if (f.kind === 'yearly') return nextYearlyCode(used, f, fy || f.startFy)
  return nextStoreEan(used)
}

/** 'AA-00012~3' -> { stem: 'AA-00012', size: 3 }; a code without '~n' has size null. */
export function splitSizeCode(code: string): { stem: string; size: number | null } {
  const m = /^(.+)~(\d{1,3})$/.exec(code)
  return m ? { stem: m[1]!, size: Number(m[2]) } : { stem: code, size: null }
}

/**
 * Codes for more sizes of a product: the same product number with the next free size numbers
 * (AA-00012~1 -> AA-00012~2, ~3 …). Returns null when the code has no size number (then each size gets a new code).
 */
export function nextSizeCodes(code: string, used: string[], count: number): string[] | null {
  const { stem, size } = splitSizeCode(code)
  if (size === null) return null
  const taken = new Set(used)
  const out: string[] = []
  for (let k = 1; out.length < count; k++) {
    if (k > 999) throw new RangeError('This product has too many sizes')
    const c = `${stem}~${k}`
    if (!taken.has(c)) {
      out.push(c)
      taken.add(c)
    }
  }
  return out
}
