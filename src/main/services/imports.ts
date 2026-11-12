// Importing items and parties from spreadsheets, exporting them, templates, and bulk changes to items.
// An import is checked first (nothing saved) and then saved in one transaction.
import { randomUUID } from 'node:crypto'
import { todayLocal } from '@shared/fy'
import {
  IMPORT_COLUMNS, matchHeadings, type ImportKind, type ImportPreview, type ImportResult, type ImportRowResult, type ItemBulkChange
} from '@shared/imports'
import type { Item, ItemInput, Party, PartyInput, PartyKind, TaxRate, Unit } from '@shared/models'
import { formatINR, toPaise } from '@shared/money'
import { formatQty, toMilli } from '@shared/qty'
import { STATES } from '@shared/states'
import { normalizeItem, normalizeParty, validateItem, validateParty } from '@shared/validation'
import type { DB } from '../db/connection'
import { UserError } from '../util'
import type { Cell, Row, SheetSpec } from '../xlsx'
import { createItem, getItem, listItems, updateItem } from './items'
import { createParty, listParties, updateParty } from './parties'
import { getPreferences } from './settings'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

const MAX_ROWS = 10_000

type Plan = { skipped: number } & (
  | { kind: 'items'; entries: { row: number; id: string | null; input: ItemInput }[] }
  | { kind: 'parties'; entries: { row: number; id: string | null; input: PartyInput }[] }
)
const plans = new Map<string, Plan>()

const text = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c).trim())
const lc = (s: string) => s.trim().toLowerCase()

/** Money from a cell: numbers as they are, text like "₹1,234.50". Blank → null. */
function money(c: Cell | undefined, what: string): number | null {
  const t = text(c)
  if (!t) return null
  try {
    return toPaise(typeof c === 'number' ? String(Math.round(c * 1000) / 1000) : t)
  } catch {
    throw new Error(`${what} "${t}" is not an amount`)
  }
}
function qty(c: Cell | undefined, what: string): number | null {
  const t = text(c)
  if (!t) return null
  try {
    return toMilli(typeof c === 'number' ? String(Math.round(c * 10_000) / 10_000) : t)
  } catch {
    throw new Error(`${what} "${t}" is not a quantity`)
  }
}
function yesNo(c: Cell | undefined, what: string): boolean | null {
  if (typeof c === 'boolean') return c
  const t = lc(text(c))
  if (!t) return null
  if (['yes', 'y', 'true', '1', 'inclusive', 'incl', 'included', 'with tax'].includes(t)) return true
  if (['no', 'n', 'false', '0', 'exclusive', 'excl', 'excluded', 'without tax'].includes(t)) return false
  throw new Error(`${what} should be Yes or No, not "${text(c)}"`)
}

/** A tax rate from "18", "18%", 0.18 or its name, e.g. "GST 18%". */
function findTaxRate(rates: TaxRate[], c: Cell | undefined): TaxRate | null {
  const t = text(c)
  if (!t) return null
  const byName = rates.find((r) => lc(r.name) === lc(t))
  if (byName) return byName
  const m = /^(\d+(?:\.\d+)?)\s*%?$/.exec(t.replace(/^gst\s*/i, ''))
  if (m) {
    let pct = Number(m[1])
    if (typeof c === 'number' && c > 0 && c < 1) pct = c * 100 // a cell formatted as a percentage
    const bp = Math.round(pct * 100)
    const match = rates.filter((r) => r.isActive && r.rateBp === bp && r.cessBp === 0)
    const found = match.find((r) => r.kind === 'gst') ?? match[0]
    if (found) return found
  }
  throw new Error(`No tax rate "${t}". Use 0, 5, 12, 18 or 28, or add it in Settings › Tax rates`)
}

function findUnit(units: Unit[], c: Cell | undefined): Unit | null {
  const t = lc(text(c))
  if (!t) return units.find((u) => lc(u.short) === 'pcs') ?? units[0] ?? null
  const u = units.find((x) => lc(x.short) === t || lc(x.name) === t || lc(x.name) === t.replace(/s$/, ''))
  if (!u) throw new Error(`No unit "${text(c)}". Add it in Settings › Units first`)
  return u
}

function findState(c: Cell | undefined): string {
  const t = text(c)
  if (!t) return ''
  const code = /^\d{1,2}$/.test(t) ? t.padStart(2, '0') : ''
  const s = STATES.find((x) => x.code === code || lc(x.name) === lc(t))
  if (!s) throw new Error(`Unknown state "${t}"`)
  return s.code
}

/** The heading row (the first row with any text) and the data rows after it, with Excel row numbers. */
function splitSheet(kind: ImportKind, rows: Row[]) {
  const headIndex = rows.findIndex((r) => r.some((c) => text(c) !== ''))
  if (headIndex < 0) throw new UserError('The file is empty')
  const headings = rows[headIndex].map((c) => text(c))
  const keys = matchHeadings(kind, headings)
  const required = IMPORT_COLUMNS[kind].filter((c) => c.required)
  for (const r of required) {
    if (!keys.includes(r.key)) {
      throw new UserError(`The file needs a "${r.title}" column. Download the template to see the columns.`)
    }
  }
  const data = rows
    .slice(headIndex + 1)
    .map((r, i) => ({ row: headIndex + i + 2, cells: r }))
    .filter((r) => r.cells.some((c) => text(c) !== ''))
  if (data.length > MAX_ROWS) throw new UserError(`At most ${MAX_ROWS} rows at a time`)
  const columns = IMPORT_COLUMNS[kind].filter((c) => keys.includes(c.key)).map((c) => c.title)
  const ignored = headings.filter((h, i) => h && !keys[i])
  const get = (cells: Row) => {
    const out: Record<string, Cell> = {}
    keys.forEach((k, i) => k && (out[k] = cells[i] ?? null))
    return out
  }
  return { data, columns, ignored, get, has: (k: string) => keys.includes(k) }
}

function itemInputFrom(base: Item | null, v: Record<string, Cell>, has: (k: string) => boolean, ctx: { rates: TaxRate[]; units: Unit[]; includesTax: boolean }): ItemInput {
  // A column left out, or a blank cell, keeps what the existing record has (or the default for a new one).
  const pick = <T>(key: string, parse: () => T, keep: T): T => (has(key) && text(v[key]) !== '' ? parse() : keep)
  const kindText = lc(text(v.kind))
  const kind = pick<'goods' | 'service'>('kind', () => {
    if (!kindText) return base?.kind ?? 'goods'
    if (['goods', 'good', 'product', 'products', 'item'].includes(kindText)) return 'goods'
    if (['service', 'services'].includes(kindText)) return 'service'
    throw new Error(`Type should be Goods or Service, not "${text(v.kind)}"`)
  }, base?.kind ?? 'goods')
  const salePrice = pick('salePrice', () => money(v.salePrice, 'Sale price') ?? 0, base?.salePrice ?? 0)
  const purchasePrice = pick('purchasePrice', () => money(v.purchasePrice, 'Purchase price') ?? 0, base?.purchasePrice ?? 0)
  const openingQty = pick('openingQty', () => qty(v.openingQty, 'Opening stock') ?? 0, base?.openingQty ?? 0)
  const unit = (has('unit') && text(v.unit)) || !base ? findUnit(ctx.units, v.unit) : null
  const tax = has('gst') && text(v.gst) ? findTaxRate(ctx.rates, v.gst) : undefined
  return {
    name: has('name') ? text(v.name) : base?.name ?? '',
    // Matched by code ignoring case: keep the code as it was written before.
    code: pick('code', () => (base && lc(base.code) === lc(text(v.code)) ? base.code : text(v.code)), base?.code ?? ''),
    barcode: pick('barcode', () => text(v.barcode), base?.barcode ?? ''),
    kind,
    category: pick('category', () => text(v.category), base?.category ?? ''),
    hsnSac: pick('hsn', () => text(v.hsn).replace(/\.0+$/, ''), base?.hsnSac ?? ''),
    taxRateId: tax !== undefined ? tax?.id ?? null : base?.taxRateId ?? null,
    priceIncludesTax: pick('includesTax', () => yesNo(v.includesTax, 'Price includes GST') ?? base?.priceIncludesTax ?? ctx.includesTax, base?.priceIncludesTax ?? ctx.includesTax),
    salePrice,
    purchasePrice,
    mrp: pick('mrp', () => money(v.mrp, 'MRP'), base?.mrp ?? null),
    wholesalePrice: pick('wholesalePrice', () => money(v.wholesalePrice, 'Wholesale price'), base?.wholesalePrice ?? null),
    wholesaleMinQty: pick('wholesaleMinQty', () => qty(v.wholesaleMinQty, 'Wholesale min qty'), base?.wholesaleMinQty ?? null),
    baseUnitId: unit ? unit.id : base?.baseUnitId ?? null,
    altUnitId: base?.altUnitId ?? null,
    altConversion: base?.altConversion ?? null,
    trackStock: base ? base.trackStock : kind === 'goods',
    openingQty,
    openingRate: pick('openingRate', () => money(v.openingRate, 'Opening stock rate') ?? purchasePrice, base?.openingRate ?? purchasePrice),
    openingDate: base?.openingDate || todayLocal(),
    lowStockQty: pick('lowStock', () => qty(v.lowStock, 'Low stock alert'), base?.lowStockQty ?? null),
    description: pick('description', () => text(v.description), base?.description ?? '')
  }
}

function itemChanges(before: Item, after: ItemInput, rates: TaxRate[], units: Unit[]): string[] {
  const out: string[] = []
  const rate = (id: string | null) => rates.find((r) => r.id === id)?.name ?? 'none'
  const m = (p: number | null) => (p === null ? 'blank' : formatINR(p))
  const q = (p: number | null) => (p === null ? 'blank' : formatQty(p))
  const diff = (title: string, a: string, b: string) => a !== b && out.push(`${title} ${a || 'blank'} → ${b || 'blank'}`)
  diff('Name', before.name, after.name)
  diff('Code', before.code, after.code)
  diff('Barcode', before.barcode, after.barcode ?? '')
  diff('Category', before.category, after.category)
  diff('Type', before.kind, after.kind)
  diff('HSN', before.hsnSac, after.hsnSac)
  diff('Unit', units.find((u) => u.id === before.baseUnitId)?.short ?? '', units.find((u) => u.id === after.baseUnitId)?.short ?? '')
  diff('Sale price', m(before.salePrice), m(after.salePrice))
  diff('Purchase price', m(before.purchasePrice), m(after.purchasePrice))
  diff('MRP', m(before.mrp), m(after.mrp))
  diff('GST', rate(before.taxRateId), rate(after.taxRateId))
  diff('Price includes GST', before.priceIncludesTax ? 'Yes' : 'No', after.priceIncludesTax ? 'Yes' : 'No')
  diff('Wholesale price', m(before.wholesalePrice), m(after.wholesalePrice))
  diff('Wholesale min qty', q(before.wholesaleMinQty), q(after.wholesaleMinQty))
  diff('Opening stock', q(before.openingQty), q(after.openingQty))
  diff('Opening stock rate', m(before.openingRate), m(after.openingRate))
  diff('Low stock alert', q(before.lowStockQty), q(after.lowStockQty))
  diff('Description', before.description, after.description ?? '')
  return out
}

function planItems(db: DB, rows: Row[], fileName: string): { preview: Omit<ImportPreview, 'token'>; plan: Plan } {
  const { data, columns, ignored, get, has } = splitSheet('items', rows)
  const ctx = { rates: listTaxRates(db), units: listUnits(db), includesTax: getPreferences(db).pricesIncludeTax }
  const existing = listItems(db)
  const byCode = new Map(existing.filter((i) => i.code).map((i) => [lc(i.code), i]))
  const byName = new Map(existing.map((i) => [lc(i.name), i]))
  const results: ImportRowResult[] = []
  const entries: { row: number; id: string | null; input: ItemInput }[] = []
  // Names, codes and barcodes already taken, by item id (or the row for new items), so clashes are caught before saving.
  const taken = { name: new Map<string, string>(), code: new Map<string, string>(), barcode: new Map<string, string>() }
  for (const i of existing) {
    taken.name.set(lc(i.name), i.id)
    if (i.code) taken.code.set(lc(i.code), i.id)
    if (i.barcode) taken.barcode.set(i.barcode, i.id)
  }
  for (const { row, cells } of data) {
    const v = get(cells)
    const name = text(v.name)
    const errors: string[] = []
    let base: Item | null = null
    if (has('code') && text(v.code)) base = byCode.get(lc(text(v.code))) ?? null
    if (!base && name) base = byName.get(lc(name)) ?? null
    let input: ItemInput | null = null
    try {
      input = normalizeItem(itemInputFrom(base, v, has, ctx))
      if (!name) errors.push('Item name is missing')
      else errors.push(...Object.values(validateItem(input)).filter((e): e is string => !!e))
      if (base?.hasTransactions && input.baseUnitId !== base.baseUnitId) errors.push('The unit cannot change: the item is already used in bills')
      const self = base?.id ?? `row${row}`
      const clash = (map: Map<string, string>, key: string, what: string) => {
        if (!key) return
        const owner = map.get(key)
        if (owner && owner !== self) errors.push(`${what} is already used by ${existing.find((i) => i.id === owner)?.name ?? `row ${owner.slice(3)}`}`)
        else map.set(key, self)
      }
      if (name) clash(taken.name, lc(input.name), `Name "${input.name}"`)
      clash(taken.code, lc(input.code), `Code "${input.code}"`)
      clash(taken.barcode, input.barcode ?? '', `Barcode ${input.barcode}`)
    } catch (e) {
      errors.push((e as Error).message)
    }
    const action = errors.length ? 'error' : base ? 'update' : 'create'
    const changes = action === 'update' && input && base ? itemChanges(base, input, ctx.rates, ctx.units) : []
    results.push({ row, name: name || '(no name)', action, errors, changes })
    if (!errors.length && input && !(action === 'update' && !changes.length)) entries.push({ row, id: base?.id ?? null, input })
  }
  return { preview: summary('items', fileName, columns, ignored, results), plan: { kind: 'items', entries, skipped: results.length - entries.length } }
}

function partyInputFrom(base: Party | null, v: Record<string, Cell>, has: (k: string) => boolean): PartyInput {
  // A column left out, or a blank cell, keeps what the existing record has (or the default for a new one).
  const pick = <T>(key: string, parse: () => T, keep: T): T => (has(key) && text(v[key]) !== '' ? parse() : keep)
  const kind = pick<PartyKind>('kind', () => {
    const t = lc(text(v.kind))
    if (!t) return base?.kind ?? 'customer'
    if (['customer', 'buyer', 'client'].includes(t)) return 'customer'
    if (['supplier', 'vendor', 'seller'].includes(t)) return 'supplier'
    if (['both', 'customer and supplier', 'customer & supplier'].includes(t)) return 'both'
    throw new Error(`Type should be Customer, Supplier or Both, not "${text(v.kind)}"`)
  }, base?.kind ?? 'customer')
  let opening = base?.openingBalance ?? 0
  if ((has('opening') && text(v.opening)) || (has('balanceType') && text(v.balanceType))) {
    const amount = has('opening') && text(v.opening) ? money(v.opening, 'Opening balance') ?? 0 : Math.abs(opening)
    const side = lc(text(v.balanceType))
    let sign = amount < 0 ? -1 : 1
    if (side) {
      if (['to receive', 'receive', 'receivable', 'dr', 'debit', 'they owe'].includes(side)) sign = 1
      else if (['to pay', 'pay', 'payable', 'cr', 'credit', 'we owe', 'i owe'].includes(side)) sign = -1
      else throw new Error(`Balance type should be To receive or To pay, not "${text(v.balanceType)}"`)
    } else if (!(has('opening') && text(v.opening))) sign = Math.sign(opening) || 1
    opening = sign * Math.abs(amount)
  }
  const days = has('creditDays') && text(v.creditDays) ? qty(v.creditDays, 'Credit days') : null
  return {
    name: has('name') ? text(v.name) : base?.name ?? '',
    kind,
    phone: pick('phone', () => text(v.phone).replace(/\.0+$/, ''), base?.phone ?? ''),
    email: pick('email', () => text(v.email), base?.email ?? ''),
    gstin: pick('gstin', () => text(v.gstin).toUpperCase(), base?.gstin ?? ''),
    stateCode: pick('state', () => findState(v.state), base?.stateCode ?? ''),
    billingAddress: pick('address', () => text(v.address), base?.billingAddress ?? ''),
    shippingAddress: pick('shipping', () => text(v.shipping), base?.shippingAddress ?? ''),
    openingBalance: opening,
    openingDate: opening === 0 ? '' : base?.openingDate || todayLocal(),
    creditLimit: pick('creditLimit', () => money(v.creditLimit, 'Credit limit'), base?.creditLimit ?? null),
    paymentTermDays: days !== null ? days / 1000 : base?.paymentTermDays ?? null,
    group: pick('group', () => text(v.group), base?.group ?? '')
  }
}

function partyChanges(before: Party, after: PartyInput): string[] {
  const out: string[] = []
  const diff = (title: string, a: string, b: string) => a !== b && out.push(`${title} ${a || 'blank'} → ${b || 'blank'}`)
  const bal = (p: number) => (p === 0 ? '₹0.00' : `${formatINR(Math.abs(p))} ${p > 0 ? 'to receive' : 'to pay'}`)
  diff('Type', before.kind, after.kind)
  diff('Phone', before.phone, after.phone)
  diff('Email', before.email, after.email)
  diff('GSTIN', before.gstin, after.gstin)
  diff('State', before.stateCode, after.stateCode)
  diff('Billing address', before.billingAddress, after.billingAddress)
  diff('Shipping address', before.shippingAddress, after.shippingAddress)
  diff('Opening balance', bal(before.openingBalance), bal(after.openingBalance))
  diff('Credit limit', before.creditLimit === null ? '' : formatINR(before.creditLimit), after.creditLimit === null ? '' : formatINR(after.creditLimit))
  diff('Credit days', before.paymentTermDays === null ? '' : String(before.paymentTermDays), after.paymentTermDays === null ? '' : String(after.paymentTermDays))
  diff('Group', before.group, after.group)
  return out
}

function planParties(db: DB, rows: Row[], fileName: string): { preview: Omit<ImportPreview, 'token'>; plan: Plan } {
  const { data, columns, ignored, get, has } = splitSheet('parties', rows)
  const existing = listParties(db)
  const byName = new Map(existing.map((p) => [lc(p.name), p]))
  const seen = new Map<string, number>()
  const results: ImportRowResult[] = []
  const entries: { row: number; id: string | null; input: PartyInput }[] = []
  for (const { row, cells } of data) {
    const v = get(cells)
    const name = text(v.name)
    const errors: string[] = []
    const base = name ? byName.get(lc(name)) ?? null : null
    let input: PartyInput | null = null
    try {
      input = normalizeParty(partyInputFrom(base, v, has))
      if (!name) errors.push('Party name is missing')
      else errors.push(...Object.values(validateParty(input)).filter((e): e is string => !!e))
      if (input.paymentTermDays !== null && !Number.isInteger(input.paymentTermDays)) errors.push('Credit days must be a whole number')
      if (name) {
        const first = seen.get(lc(name))
        if (first) errors.push(`"${name}" is also in row ${first}`)
        else seen.set(lc(name), row)
      }
    } catch (e) {
      errors.push((e as Error).message)
    }
    const action = errors.length ? 'error' : base ? 'update' : 'create'
    const changes = action === 'update' && input && base ? partyChanges(base, input) : []
    results.push({ row, name: name || '(no name)', action, errors, changes })
    if (!errors.length && input && !(action === 'update' && !changes.length)) entries.push({ row, id: base?.id ?? null, input })
  }
  return { preview: summary('parties', fileName, columns, ignored, results), plan: { kind: 'parties', entries, skipped: results.length - entries.length } }
}

function summary(kind: ImportKind, fileName: string, columns: string[], ignored: string[], rows: ImportRowResult[]): Omit<ImportPreview, 'token'> {
  return {
    kind, fileName, columns, ignored, rows,
    creates: rows.filter((r) => r.action === 'create').length,
    updates: rows.filter((r) => r.action === 'update' && r.changes.length).length,
    errors: rows.filter((r) => r.action === 'error').length
  }
}

/** Check a sheet's rows; nothing is saved. The token hands the good rows to commitImport. */
export function previewImport(db: DB, kind: ImportKind, rows: Row[], fileName: string): ImportPreview {
  const { preview, plan } = kind === 'items' ? planItems(db, rows, fileName) : planParties(db, rows, fileName)
  plans.clear() // one import at a time
  const token = randomUUID()
  plans.set(token, plan)
  return { ...preview, token }
}

/** Save the good rows of a checked import, all or nothing. Rows with problems are skipped. */
export function commitImport(db: DB, token: string): ImportResult {
  const plan = plans.get(token)
  if (!plan) throw new UserError('Check the file again before importing')
  let created = 0
  let updated = 0
  db.transaction(() => {
    for (const e of plan.entries) {
      try {
        if (plan.kind === 'items') {
          const entry = e as { row: number; id: string | null; input: ItemInput }
          if (entry.id) updateItem(db, entry.id, entry.input)
          else createItem(db, entry.input)
        } else {
          const entry = e as { row: number; id: string | null; input: PartyInput }
          if (entry.id) updateParty(db, entry.id, entry.input)
          else createParty(db, entry.input)
        }
        if (e.id) updated++
        else created++
      } catch (err) {
        throw new UserError(`Row ${e.row}: ${(err as Error).message}. Nothing was imported.`)
      }
    }
  })()
  plans.delete(token)
  return { created, updated, skipped: plan.skipped }
}

// ---------- Templates and exports ----------

const rupees = (p: number | null) => (p === null ? null : p / 100)
const units = (q: number | null) => (q === null ? null : q / 1000)

function howToSheet(kind: ImportKind): SheetSpec {
  return {
    name: 'How to fill',
    header: true,
    widths: [24, 90],
    rows: [['Column', 'What to put in it'], ...IMPORT_COLUMNS[kind].map((c) => [c.title + (c.required ? ' *' : ''), c.hint]),
      [], ['', 'Keep the headings in the first row. Rows whose name matches an existing ' + (kind === 'items' ? 'item' : 'party') + ' update it; blank cells keep what is already saved.']]
  }
}

export function templateSheets(kind: ImportKind): SheetSpec[] {
  const cols = IMPORT_COLUMNS[kind]
  const examples: Row[] =
    kind === 'items'
      ? [
          ['Cotton T-shirt (M)', 'TS-M', '', 'Clothing', 'Goods', '6109', 'pcs', 450, 250, 499, 5, 'No', 350, 10, 40, 250, 5, 'Round neck'],
          ['Basmati Rice 5 kg', 'RICE-5', '', 'Grocery', 'Goods', '1006', 'bag', 620, 540, 650, 5, 'Yes', null, null, 20, 540, 4, '']
        ]
      : [
          ['Ravi Traders', 'Customer', '9876543210', 'ravi@example.com', '', 'Tamil Nadu', '12, Main Road, Madurai', '', 1500, 'To receive', 50000, 30, 'Retail'],
          ['Sri Mills', 'Supplier', '9123456780', '', '', '33', 'Coimbatore', '', 2200, 'To pay', null, 15, '']
        ]
  return [{ name: kind === 'items' ? 'Items' : 'Parties', header: true, widths: cols.map((c) => Math.max(12, c.title.length + 4)), rows: [cols.map((c) => c.title), ...examples] }, howToSheet(kind)]
}

export function exportSheets(db: DB, kind: ImportKind): SheetSpec[] {
  const cols = IMPORT_COLUMNS[kind]
  let rows: Row[]
  if (kind === 'items') {
    const rates = listTaxRates(db)
    const us = listUnits(db)
    rows = listItems(db).map((i) => {
      const r = rates.find((x) => x.id === i.taxRateId)
      const v: Record<string, Cell> = {
        name: i.name, code: i.code, barcode: i.barcode, category: i.category, kind: i.kind === 'goods' ? 'Goods' : 'Service', hsn: i.hsnSac,
        unit: us.find((u) => u.id === i.baseUnitId)?.short ?? '', salePrice: rupees(i.salePrice), purchasePrice: rupees(i.purchasePrice),
        mrp: rupees(i.mrp), gst: r ? (r.kind === 'gst' && r.cessBp === 0 ? r.rateBp / 100 : r.name) : '', includesTax: i.priceIncludesTax ? 'Yes' : 'No',
        wholesalePrice: rupees(i.wholesalePrice), wholesaleMinQty: units(i.wholesaleMinQty), openingQty: i.trackStock ? units(i.openingQty) : null,
        openingRate: i.trackStock ? rupees(i.openingRate) : null, lowStock: units(i.lowStockQty), description: i.description
      }
      return cols.map((c) => v[c.key] ?? null)
    })
  } else {
    rows = listParties(db).map((p) => {
      const v: Record<string, Cell> = {
        name: p.name, kind: p.kind === 'both' ? 'Both' : p.kind === 'supplier' ? 'Supplier' : 'Customer', phone: p.phone, email: p.email, gstin: p.gstin,
        state: STATES.find((s) => s.code === p.stateCode)?.name ?? '', address: p.billingAddress, shipping: p.shippingAddress,
        opening: rupees(Math.abs(p.openingBalance)), balanceType: p.openingBalance < 0 ? 'To pay' : p.openingBalance > 0 ? 'To receive' : '',
        creditLimit: rupees(p.creditLimit), creditDays: p.paymentTermDays, group: p.group
      }
      return cols.map((c) => v[c.key] ?? null)
    })
  }
  return [{ name: kind === 'items' ? 'Items' : 'Parties', header: true, widths: cols.map((c) => Math.max(12, c.title.length + 4)), rows: [cols.map((c) => c.title), ...rows] }, howToSheet(kind)]
}

// ---------- Bulk update ----------

/** Change several items at once, all or nothing. Returns how many items changed. */
export function bulkUpdateItems(db: DB, changes: ItemBulkChange[]): number {
  if (!Array.isArray(changes) || !changes.length) throw new UserError('Nothing to save')
  if (changes.length > MAX_ROWS) throw new UserError(`At most ${MAX_ROWS} items at a time`)
  let n = 0
  db.transaction(() => {
    for (const c of changes) {
      const before = getItem(db, c.id)
      const { id: _id, ...fields } = c
      const next: ItemInput = { ...before, ...fields, image: undefined }
      if (next.wholesalePrice === null) next.wholesaleMinQty = null
      try {
        updateItem(db, c.id, next)
      } catch (e) {
        throw new UserError(`${before.name}: ${(e as Error).message}. Nothing was saved.`)
      }
      n++
    }
  })()
  return n
}

