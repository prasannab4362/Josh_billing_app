// Counter billing (POS): the lines on the counter, their prices and totals, and the sale they save as.
// Pure functions, shared by the POS screen and its tests; saving goes through the normal sale invoice.
import type { InvoiceInput, Item, PaymentMode, TaxRate } from './models'
import { priceForDocument, computeTax, type SupplyType, type TaxResult } from './tax'
import { lineAmount, toBaseUnits } from './qty'

export interface PosLine {
  key: number
  itemId: string
  /** Milli line units. */
  qty: number
  /** The item's second unit when chosen, else its main unit. */
  useAltUnit: boolean
  /** A price typed for this line (paise per line unit); null follows the item (retail or wholesale). */
  priceOverride: number | null
  discountPctBp: number
  /** Discount in rupees for the whole line, used when there is no % discount. */
  discountAmount: number
}

export interface PosContext {
  items: Map<string, Item>
  rates: Map<string, TaxRate>
  /** Prices on this bill include GST (the business's setting). */
  inclusive: boolean
  registered: boolean
  supply: SupplyType
  roundOff: boolean
}

/** Milli base units in one line unit. */
export const unitFactor = (item: Item, l: Pick<PosLine, 'useAltUnit'>): number =>
  l.useAltUnit && item.altUnitId && item.altConversion ? item.altConversion : 1000

export function taxOf(item: Item, ctx: PosContext): { bp: number; cess: number } {
  const r = item.taxRateId ? ctx.rates.get(item.taxRateId) : undefined
  return ctx.registered && r ? { bp: r.rateBp, cess: r.cessBp } : { bp: 0, cess: 0 }
}

/** True when the quantity reaches the item's wholesale minimum (counted in the main unit). */
export function isWholesale(item: Item, l: Pick<PosLine, 'qty' | 'useAltUnit'>): boolean {
  return item.wholesalePrice !== null && item.wholesaleMinQty !== null && toBaseUnits(l.qty, unitFactor(item, l)) >= item.wholesaleMinQty
}

/** Price per line unit on this bill: typed price, else wholesale or retail, turned to the bill's tax basis. */
export function linePrice(item: Item, l: PosLine, ctx: PosContext): number {
  if (l.priceOverride !== null) return l.priceOverride
  const t = taxOf(item, ctx)
  const perBase = priceForDocument(isWholesale(item, l) ? item.wholesalePrice! : item.salePrice, item.priceIncludesTax, ctx.inclusive, t.bp + t.cess)
  return lineAmount(unitFactor(item, l), perBase)
}

export function posTotals(lines: PosLine[], ctx: PosContext, charges: { amount: number; taxRateId: string | null }[] = []): TaxResult {
  return computeTax({
    lines: lines.map((l) => {
      const item = ctx.items.get(l.itemId)!
      const t = taxOf(item, ctx)
      return { qty: l.qty, rate: linePrice(item, l, ctx), discountPctBp: l.discountPctBp, discountAmount: l.discountAmount, taxRateBp: t.bp, cessBp: t.cess }
    }),
    charges: charges.map((c) => {
      const r = c.taxRateId ? ctx.rates.get(c.taxRateId) : undefined
      return { amount: c.amount, taxRateBp: ctx.registered && r ? r.rateBp : 0 }
    }),
    pricesIncludeTax: ctx.inclusive,
    supply: ctx.supply,
    roundOff: ctx.roundOff
  })
}

/** Add an item: one more of it if it is already on the bill (same unit, own price untouched), else a new line. */
export function addItem(lines: PosLine[], itemId: string, nextKey: number, qty = 1000): PosLine[] {
  const i = lines.findIndex((l) => l.itemId === itemId && !l.useAltUnit && l.priceOverride === null)
  if (i >= 0) return lines.map((l, k) => (k === i ? { ...l, qty: l.qty + qty } : l))
  return [...lines, { key: nextKey, itemId, qty, useAltUnit: false, priceOverride: null, discountPctBp: 0, discountAmount: 0 }]
}

/** Find what the scanner typed: barcode first, then item code (any case), then an exact name. */
export function findForScan(items: Item[], raw: string): Item | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const active = items.filter((i) => i.isActive)
  return (
    active.find((i) => i.barcode === t) ??
    active.find((i) => i.code !== '' && i.code.toLowerCase() === t.toLowerCase()) ??
    active.find((i) => i.name.toLowerCase() === t.toLowerCase())
  )
}

/** Items matching what is typed in the search box: name, code, barcode, HSN, or a price. */
export function searchItems(items: Item[], raw: string, limit = 8): Item[] {
  const q = raw.trim().toLowerCase()
  if (!q) return []
  const price = /^\d+(\.\d{1,2})?$/.test(q) ? Math.round(Number(q) * 100) : null
  return items
    .filter((i) => i.isActive)
    .map((i) => {
      const name = i.name.toLowerCase()
      const score = name.startsWith(q) ? 0 : i.code.toLowerCase() === q || i.barcode === q ? 0 : name.includes(q) ? 1
        : i.code.toLowerCase().includes(q) || i.barcode.includes(q) || i.hsnSac.startsWith(q) ? 2
        : price !== null && (i.salePrice === price || i.mrp === price) ? 3 : -1
      return { i, score }
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.i.name.localeCompare(b.i.name))
    .slice(0, limit)
    .map((x) => x.i)
}

export interface PosBill {
  partyId: string | null
  walkInName: string
  date: string
  placeOfSupply: string
  lines: PosLine[]
  charges: { name: string; amount: number; taxRateId: string | null }[]
  notes: string
  mode: PaymentMode
  accountId: string
  /** Amount the customer handed over, paise (may be more than the total: the rest is change). */
  tendered: number
  reference: string
}

/** What is received on the bill (never more than the total), and the change to give back. */
export function settle(total: number, tendered: number): { received: number; change: number; due: number } {
  const received = Math.min(Math.max(0, tendered), total)
  return { received, change: Math.max(0, tendered - total), due: total - received }
}

/** The sale invoice this counter bill is saved as. */
export function posInvoiceInput(b: PosBill, ctx: PosContext): InvoiceInput {
  const totals = posTotals(b.lines, ctx, b.charges)
  const { received } = settle(totals.grandTotal, b.tendered)
  return {
    partyId: b.partyId,
    walkInName: b.partyId ? '' : b.walkInName.trim(),
    number: '',
    date: b.date,
    dueDate: '',
    placeOfSupply: b.placeOfSupply,
    pricesIncludeTax: ctx.inclusive,
    lines: b.lines.map((l) => {
      const item = ctx.items.get(l.itemId)!
      return {
        itemId: item.id, description: '', qty: l.qty, unitId: l.useAltUnit ? item.altUnitId : item.baseUnitId, unitFactor: unitFactor(item, l),
        rate: linePrice(item, l, ctx), discountPctBp: l.discountPctBp, discountAmount: l.discountPctBp ? 0 : l.discountAmount,
        taxRateId: item.taxRateId, hsnSac: item.hsnSac
      }
    }),
    charges: b.charges,
    received: received > 0 ? { amount: received, accountId: b.accountId, mode: b.mode, reference: b.reference } : null,
    notes: b.notes,
    terms: ''
  }
}
