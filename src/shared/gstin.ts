// GSTIN: 2-digit state + 10-char PAN + entity no. + 'Z' + check character.

import { isStateCode } from './states'

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

export function normalizeGstin(input: string): string {
  return input.replace(/\s/g, '').toUpperCase()
}

/** Check character for the first 14 characters (standard mod-36 scheme). */
export function gstinCheckChar(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHARS[(36 - (sum % 36)) % 36]
}

export type GstinProblem = 'format' | 'state' | 'checksum'

/** Returns null when valid, otherwise what is wrong. */
export function gstinProblem(input: string): GstinProblem | null {
  const g = normalizeGstin(input)
  if (!PATTERN.test(g)) return 'format'
  if (!isStateCode(g.slice(0, 2))) return 'state'
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return 'checksum'
  return null
}

export function isValidGstin(input: string): boolean {
  return gstinProblem(input) === null
}

export function gstinStateCode(input: string): string {
  return normalizeGstin(input).slice(0, 2)
}

export function gstinPan(input: string): string {
  return normalizeGstin(input).slice(2, 12)
}
