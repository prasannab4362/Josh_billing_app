// Helpers for form fields that hold text but save as integer paise / milli-units.
import { formatINR, toPaise } from '@shared/money'
import { formatQty, toMilli } from '@shared/qty'

/** '' -> null, otherwise paise; throws RangeError on bad text. */
export const paiseOrNull = (s: string): number | null => (s.trim() === '' ? null : toPaise(s))
export const paiseOrZero = (s: string): number => paiseOrNull(s) ?? 0
export const milliOrNull = (s: string): number | null => (s.trim() === '' ? null : toMilli(s))
export const milliOrZero = (s: string): number => milliOrNull(s) ?? 0

/** Paise -> editable text: 150000 -> "1500", 1050 -> "10.50", null -> "". */
export const paiseText = (p: number | null): string =>
  p === null || p === 0 ? '' : formatINR(p, { symbol: false }).replace(/,/g, '').replace(/\.00$/, '')
export const milliText = (q: number | null): string => (q === null || q === 0 ? '' : formatQty(q))

/** Parse several text fields, collecting a message per field that is not a number. */
export function parseFields<K extends string>(
  fields: Record<K, () => unknown>,
  message = 'Enter a number'
): { values: Partial<Record<K, unknown>>; errors: Partial<Record<K, string>> } {
  const values: Partial<Record<K, unknown>> = {}
  const errors: Partial<Record<K, string>> = {}
  for (const key of Object.keys(fields) as K[]) {
    try {
      values[key] = fields[key]()
    } catch {
      errors[key] = message
    }
  }
  return { values, errors }
}
