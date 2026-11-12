// Quantities are integer milli-units (1 pc = 1000, 0.5 kg = 500).

import { divRound, type Paise } from './money'

export type MilliQty = number

/** Parse "2", "0.25" or "1,000.5" into milli-units without floating point. */
export function toMilli(input: string | number): MilliQty {
  const text = String(input).trim().replace(/[,\s]/g, '')
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new RangeError(`Invalid quantity: "${input}"`)
  }
  const [, minus, whole, fraction = ''] = match
  const frac4 = (fraction + '0000').slice(0, 4)
  const milli = divRound(Number(whole || '0') * 10_000 + Number(frac4), 10)
  return minus ? -milli : milli
}

/** Format milli-units, trimming trailing zeros: 1500 -> "1.5", 2000 -> "2". */
export function formatQty(milli: MilliQty): string {
  const negative = milli < 0
  const abs = Math.abs(milli)
  const whole = Math.floor(abs / 1000)
  const fraction = (abs % 1000).toString().padStart(3, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`
}

/** quantity × rate-per-unit, rounded to the nearest paisa. */
export function lineAmount(qty: MilliQty, rate: Paise): Paise {
  return divRound(qty * rate, 1000)
}

/** Convert a quantity in an alternate unit to base units (e.g. 2 box × 12 = 24 pcs). */
export function toBaseUnits(qty: MilliQty, conversion: MilliQty): MilliQty {
  return divRound(qty * conversion, 1000)
}
