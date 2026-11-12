// Money is always an integer number of paise (₹1 = 100 paise).
// Rates are integer basis points (18% = 1800 bp).

export type Paise = number
export type BasisPoints = number

/** Integer division rounded half away from zero. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('Division by zero')
  const sign = Math.sign(numerator) * Math.sign(denominator)
  const n = Math.abs(numerator)
  const d = Math.abs(denominator)
  const q = Math.floor(n / d)
  const r = n - q * d
  return sign * (r * 2 >= d ? q + 1 : q)
}

/** Parse a rupee string like "1,234.5" or "-10" into paise without floating point. */
export function toPaise(input: string | number): Paise {
  const text = String(input).trim().replace(/[,₹\s]/g, '')
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new RangeError(`Invalid amount: "${input}"`)
  }
  const [, minus, whole, fraction = ''] = match
  const frac3 = (fraction + '000').slice(0, 3)
  const thousandths = Number(whole || '0') * 1000 + Number(frac3)
  const paise = divRound(thousandths, 10)
  return minus ? -paise : paise
}

/** Format paise as Indian-grouped rupees, e.g. 12345678 -> "₹1,23,456.78". */
export function formatINR(paise: Paise, opts: { symbol?: boolean } = {}): string {
  const negative = paise < 0
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100).toString()
  const fraction = (abs % 100).toString().padStart(2, '0')
  const last3 = rupees.slice(-3)
  const rest = rupees.slice(0, -3)
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3
  const symbol = opts.symbol === false ? '' : '₹'
  return `${negative ? '-' : ''}${symbol}${grouped}.${fraction}`
}

/** "18" or "0.25" (percent) -> basis points. Same two-decimal parsing as rupees. */
export function percentToBp(input: string | number): BasisPoints {
  return toPaise(String(input).replace('%', ''))
}

/** 1800 -> "18%", 25 -> "0.25%". */
export function formatPercent(bp: BasisPoints): string {
  const whole = Math.floor(bp / 100)
  const fraction = (bp % 100).toString().padStart(2, '0').replace(/0+$/, '')
  return `${whole}${fraction ? '.' + fraction : ''}%`
}

/** amount × rate, rounded to the nearest paisa. */
export function applyRate(amount: Paise, rate: BasisPoints): Paise {
  return divRound(amount * rate, 10_000)
}

/** Remove tax from a tax-inclusive amount: returns the taxable value. */
export function removeTax(inclusive: Paise, rate: BasisPoints): Paise {
  return divRound(inclusive * 10_000, 10_000 + rate)
}

/** Split tax into CGST/SGST halves that always add back to the total. */
export function splitHalves(tax: Paise): { cgst: Paise; sgst: Paise } {
  const cgst = divRound(tax, 2)
  return { cgst, sgst: tax - cgst }
}

/** Round to the nearest whole rupee; returns the adjustment and the rounded total. */
export function roundOffToRupee(total: Paise): { roundOff: Paise; rounded: Paise } {
  const rounded = divRound(total, 100) * 100
  return { roundOff: rounded - total, rounded }
}
