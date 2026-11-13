// Barcode labels: what goes on each label, and giving barcodes to items that have none.
import { nextStoreEan } from '@shared/barcode'
import { randomUUID } from 'node:crypto'
import {
  customSizeError, EXTRA_FIELDS, LABEL_FIELDS, labelsHtml, LABEL_LAYOUTS, MAX_LABEL_LINES,
  type CustomSize, type LabelData, type LabelExtra, type LabelOptions, type SavedLabelSize
} from '@shared/labels'
import { applyRate } from '@shared/money'
import type { DB } from '../db/connection'
import { nowIso, UserError } from '../util'
import { audit } from './audit'
import { getBusiness } from './business'
import { getPreferences } from './settings'
import { getFeatures } from './printDesign'
import type { CustomField } from '@shared/features'

import type { LabelRequest } from '@shared/ipc'

const MAX_LABELS = 5000

/** Price on the label: what the customer pays, so GST is added when the item's price excludes it. */
export function labelPrice(salePrice: number, includesTax: boolean, rateBp: number, cessBp: number, registered: boolean): number {
  if (includesTax || !registered) return salePrice
  return salePrice + applyRate(salePrice, rateBp) + applyRate(salePrice, cessBp)
}

/** Batch, model and dates typed for one item: short text only. */
function checkExtra(e: LabelExtra | undefined): LabelExtra | undefined {
  if (!e) return undefined
  const out: LabelExtra = {}
  for (const f of EXTRA_FIELDS) {
    const v = e[f]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string' || v.length > 30) throw new UserError('Batch, model and dates can be at most 30 characters')
    if (v.trim()) out[f] = v.trim()
  }
  return out
}

// The business's label sizes and last design live in the settings table, so backups carry them.
const SIZES_KEY = 'labels.sizes'
const DESIGN_KEY = 'labels.design'
function readSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : fallback
}
function writeSetting(db: DB, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), nowIso())
}

export const listLabelSizes = (db: DB): SavedLabelSize[] => readSetting<SavedLabelSize[]>(db, SIZES_KEY, [])

/** Add a named size (id null) or change one. Names are unique, ignoring case. */
export function saveLabelSize(db: DB, id: string | null, name: string, size: CustomSize): SavedLabelSize {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!clean) throw new UserError('Give the size a name')
  if (clean.length > 40) throw new UserError('Size name can be at most 40 characters')
  const across = Number(size?.across)
  const s: CustomSize = { width: Number(size?.width), height: Number(size?.height), across, gap: across === 1 ? 0 : Number(size?.gap) }
  const err = customSizeError(s)
  if (err) throw new UserError(err)
  const sizes = listLabelSizes(db)
  if (id && !sizes.some((x) => x.id === id)) throw new UserError('Label size not found')
  if (sizes.some((x) => x.id !== id && x.name.toLowerCase() === clean.toLowerCase())) throw new UserError(`There is already a size named ${clean}`)
  const saved: SavedLabelSize = { id: id ?? randomUUID(), name: clean, ...s }
  writeSetting(db, SIZES_KEY, id ? sizes.map((x) => (x.id === id ? saved : x)) : [...sizes, saved])
  return saved
}

export function deleteLabelSize(db: DB, id: string): void {
  writeSetting(db, SIZES_KEY, listLabelSizes(db).filter((x) => x.id !== id))
}

export const getLabelDesign = (db: DB): Omit<LabelOptions, 'skip'> | null => readSetting(db, DESIGN_KEY, null)

export function saveLabelDesign(db: DB, design: Omit<LabelOptions, 'skip'>): void {
  checkLabelOptions({ ...design, skip: 0 })
  writeSetting(db, DESIGN_KEY, design)
}

/** Refuse options the page cannot be drawn from. */
export function checkLabelOptions(o: LabelOptions): void {
  if (!LABEL_LAYOUTS[o.layout]) throw new UserError('Choose a label size')
  if (o.layout === 'roll-custom') {
    const err = customSizeError(o.custom)
    if (err) throw new UserError(err)
  }
  if (o.symbol !== 'barcode' && o.symbol !== 'qr') throw new UserError('Choose barcode or QR code')
  const lines = [o.header, ...(o.lines ?? [])]
  if ((o.lines ?? []).length > MAX_LABEL_LINES) throw new UserError(`At most ${MAX_LABEL_LINES} lines`)
  for (const l of lines) {
    if (!l || !(l.field in LABEL_FIELDS)) throw new UserError('Choose what each line shows')
    if (typeof l.text !== 'string' || l.text.length > 60) throw new UserError('Your own text can be at most 60 characters')
  }
}

/** The item's own field values with their names, by position; null where the field is switched off. */
export function ownValues(fields: CustomField[], extra: string | null): ({ label: string; value: string } | null)[] {
  let values: string[] = []
  try {
    values = extra ? (JSON.parse(extra) as string[]) : []
  } catch {
    values = []
  }
  return fields.map((f, i) => (f.on ? { label: f.label, value: String(values[i] ?? '') } : null))
}

export function labelData(db: DB, req: LabelRequest): LabelData[] {
  checkLabelOptions(req.options)
  const registered = getPreferences(db).gstRegistered
  const get = db.prepare(
    `SELECT i.name, i.barcode, i.code, i.hsn_sac, i.description, i.extra, c.name AS category, i.sale_price, i.price_includes_tax, i.mrp,
            COALESCE(t.rate_bp, 0) AS rate_bp, COALESCE(t.cess_bp, 0) AS cess_bp
     FROM item i LEFT JOIN tax_rate t ON t.id = i.tax_rate_id LEFT JOIN item_category c ON c.id = i.category_id
     WHERE i.id = ? AND i.deleted_at IS NULL`
  )
  const ownFields = getFeatures(db).itemFields
  const out: LabelData[] = []
  for (const r of req.items) {
    if (!Number.isInteger(r.copies) || r.copies < 0) throw new UserError('Number of labels must be a whole number')
    if (r.copies === 0) continue
    const i = get.get(r.itemId) as
      | {
          name: string; barcode: string | null; code: string | null; hsn_sac: string | null; description: string | null; extra: string | null; category: string | null
          sale_price: number; price_includes_tax: number; mrp: number | null; rate_bp: number; cess_bp: number
        }
      | undefined
    if (!i) throw new UserError('Item not found')
    const code = i.barcode || i.code
    if (!code) throw new UserError(`${i.name} has no barcode or item code yet. Create a barcode first.`)
    const extra = checkExtra(r.extra)
    const label: LabelData = {
      extra,
      name: i.name,
      code,
      itemCode: i.code ?? '',
      category: i.category ?? '',
      hsn: i.hsn_sac ?? '',
      description: i.description ?? '',
      price: labelPrice(i.sale_price, i.price_includes_tax === 1, i.rate_bp, i.cess_bp, registered),
      mrp: i.mrp,
      own: ownFields.some((f) => f.on) ? ownValues(ownFields, i.extra) : undefined
    }
    for (let n = 0; n < r.copies; n++) out.push(label)
    if (out.length > MAX_LABELS) throw new UserError(`At most ${MAX_LABELS} labels at a time`)
  }
  if (!out.length) throw new UserError('Choose at least one label to print')
  return out
}

export function labelPage(db: DB, req: LabelRequest): string {
  return labelsHtml(labelData(db, req), req.options, getBusiness(db).name)
}

/** Give each listed item without a barcode a new in-store EAN-13. Returns how many were given one. */
export function assignBarcodes(db: DB, itemIds: string[]): number {
  let given = 0
  db.transaction(() => {
    const used = (db.prepare(`SELECT barcode FROM item WHERE barcode IS NOT NULL`).all() as { barcode: string }[]).map((r) => r.barcode)
    for (const id of itemIds) {
      const row = db.prepare('SELECT barcode FROM item WHERE id = ? AND deleted_at IS NULL').get(id) as { barcode: string | null } | undefined
      if (!row || row.barcode) continue
      const code = nextStoreEan(used)
      used.push(code)
      db.prepare('UPDATE item SET barcode = ?, updated_at = ? WHERE id = ?').run(code, nowIso(), id)
      audit(db, 'item', id, 'update', { barcode: null }, { barcode: code })
      given++
    }
  })()
  return given
}
