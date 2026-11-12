// GST calculation. Pure integer maths in paise, used by the invoice editor for live totals
// and by the main process when saving (which never trusts totals sent from the screen).

import { applyRate, divRound, removeTax, roundOffToRupee, splitHalves, type BasisPoints, type Paise } from './money'
import { lineAmount, type MilliQty } from './qty'

export type SupplyType = 'intra' | 'inter'

export interface TaxLine {
  qty: MilliQty
  /** Price per line unit, in paise; includes tax when the document says prices include tax. */
  rate: Paise
  /** Percentage discount in basis points; used when > 0, otherwise discountAmount. */
  discountPctBp: BasisPoints
  discountAmount: Paise
  taxRateBp: BasisPoints
  cessBp: BasisPoints
}

export interface TaxCharge {
  /** Taxable amount of the charge (shipping, packing...), always before tax. */
  amount: Paise
  taxRateBp: BasisPoints
}

export interface TaxInput {
  lines: TaxLine[]
  charges: TaxCharge[]
  pricesIncludeTax: boolean
  supply: SupplyType
  roundOff: boolean
}

export interface LineResult {
  gross: Paise
  discount: Paise
  taxable: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  cess: Paise
  total: Paise
}

export interface ChargeResult {
  amount: Paise
  tax: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  total: Paise
}

export interface RateSummary {
  rateBp: BasisPoints
  taxable: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  cess: Paise
}

export interface TaxResult {
  lines: LineResult[]
  charges: ChargeResult[]
  subtotal: Paise // Σ gross
  discountTotal: Paise
  taxableTotal: Paise // lines only
  chargesTotal: Paise // charges before tax
  cgst: Paise
  sgst: Paise
  igst: Paise
  cess: Paise
  totalTax: Paise
  roundOff: Paise
  grandTotal: Paise
  /** Taxable value and tax grouped by GST rate (lines and charges), lowest rate first. */
  byRate: RateSummary[]
}

function split(tax: Paise, supply: SupplyType) {
  return supply === 'intra' ? { ...splitHalves(tax), igst: 0 } : { cgst: 0, sgst: 0, igst: tax }
}

export function computeLine(l: TaxLine, pricesIncludeTax: boolean, supply: SupplyType): LineResult {
  const gross = lineAmount(l.qty, l.rate)
  const rawDiscount = l.discountPctBp > 0 ? applyRate(gross, l.discountPctBp) : l.discountAmount
  const discount = Math.min(Math.max(rawDiscount, 0), Math.max(gross, 0))
  const net = gross - discount
  let taxable: Paise
  let tax: Paise
  let cess: Paise
  if (pricesIncludeTax) {
    // The price already holds GST and cess: pull them out, then give any rounding paisa to the
    // tax so taxable + tax + cess equals exactly what the customer was quoted.
    taxable = removeTax(net, l.taxRateBp + l.cessBp)
    cess = applyRate(taxable, l.cessBp)
    tax = net - taxable - cess
  } else {
    taxable = net
    tax = applyRate(taxable, l.taxRateBp)
    cess = applyRate(taxable, l.cessBp)
  }
  return { gross, discount, taxable, ...split(tax, supply), cess, total: taxable + tax + cess }
}

export function computeCharge(c: TaxCharge, supply: SupplyType): ChargeResult {
  const tax = applyRate(c.amount, c.taxRateBp)
  return { amount: c.amount, tax, ...split(tax, supply), total: c.amount + tax }
}

export function computeTax(input: TaxInput): TaxResult {
  const lines = input.lines.map((l) => computeLine(l, input.pricesIncludeTax, input.supply))
  const charges = input.charges.map((c) => computeCharge(c, input.supply))
  const sum = <T>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0)

  const cgst = sum(lines, (l) => l.cgst) + sum(charges, (c) => c.cgst)
  const sgst = sum(lines, (l) => l.sgst) + sum(charges, (c) => c.sgst)
  const igst = sum(lines, (l) => l.igst) + sum(charges, (c) => c.igst)
  const cess = sum(lines, (l) => l.cess)
  const taxableTotal = sum(lines, (l) => l.taxable)
  const chargesTotal = sum(charges, (c) => c.amount)
  const total = taxableTotal + chargesTotal + cgst + sgst + igst + cess
  const roundOff = input.roundOff ? roundOffToRupee(total).roundOff : 0

  const groups = new Map<number, RateSummary>()
  const add = (rateBp: number, taxable: number, r: { cgst: number; sgst: number; igst: number }, c: number) => {
    const g = groups.get(rateBp) ?? { rateBp, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }
    g.taxable += taxable
    g.cgst += r.cgst
    g.sgst += r.sgst
    g.igst += r.igst
    g.cess += c
    groups.set(rateBp, g)
  }
  input.lines.forEach((l, i) => add(l.taxRateBp, lines[i].taxable, lines[i], lines[i].cess))
  input.charges.forEach((c, i) => add(c.taxRateBp, charges[i].amount, charges[i], 0))

  return {
    lines,
    charges,
    subtotal: sum(lines, (l) => l.gross),
    discountTotal: sum(lines, (l) => l.discount),
    taxableTotal,
    chargesTotal,
    cgst,
    sgst,
    igst,
    cess,
    totalTax: cgst + sgst + igst + cess,
    roundOff,
    grandTotal: total + roundOff,
    byRate: [...groups.values()].sort((a, b) => a.rateBp - b.rateBp)
  }
}

/** Convert an item's stored price to the basis the document uses (with or without tax). */
export function priceForDocument(price: Paise, itemIncludesTax: boolean, docIncludesTax: boolean, rateBp: number): Paise {
  if (itemIncludesTax === docIncludesTax) return price
  return docIncludesTax ? price + applyRate(price, rateBp) : removeTax(price, rateBp)
}

/** Price per base unit from a price per line unit: e.g. ₹120 per box of 12 -> ₹10 per piece. */
export function perBaseUnit(amount: Paise, baseQty: MilliQty): Paise {
  return baseQty > 0 ? divRound(amount * 1000, baseQty) : 0
}

// ---------- Amount in words (Indian numbering) ----------

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ')
}

function wholeInWords(n: number): string {
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 10_000_000)
  n %= 10_000_000
  const lakh = Math.floor(n / 100_000)
  n %= 100_000
  const thousand = Math.floor(n / 1000)
  n %= 1000
  if (crore) parts.push(`${wholeInWords(crore)} Crore`)
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`)
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`)
  if (n) parts.push(belowThousand(n))
  return parts.join(' ')
}

/** 123456 paise -> "One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paise Only". */
export function amountInWords(paise: Paise): string {
  const negative = paise < 0
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100)
  const p = abs % 100
  const text = `${wholeInWords(rupees)} Rupee${rupees === 1 ? '' : 's'}${p ? ` and ${belowHundred(p)} Paise` : ''} Only`
  return negative ? `Minus ${text}` : text
}
