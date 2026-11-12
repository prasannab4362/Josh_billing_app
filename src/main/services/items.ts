import { writeCustom } from './parties'
import type { Item, ItemInput, ItemKind } from '@shared/models'
import { hasErrors, normalizeItem, validateItem } from '@shared/validation'
import type { DB } from '../db/connection'
import { nowIso, toBool, toInt, UserError, uuid } from '../util'
import { audit } from './audit'
import { addMovement, rebuildItemStock, removeMovements } from './stock'
import { nextStoreEan } from '@shared/barcode'

const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
/** Images are kept inside the business file (so backups carry them); keep them small. */
export function checkImage(dataUrl: string, what: string): void {
  if (!IMAGE.test(dataUrl)) throw new UserError(`${what} must be a PNG, JPEG or WebP image`)
  if (dataUrl.length > 1_500_000) throw new UserError(`${what} is too large; use a smaller picture`)
}

interface ItemRow {
  id: string
  name: string
  code: string | null
  kind: ItemKind
  category_name: string | null
  hsn_sac: string | null
  tax_rate_id: string | null
  tax_rate_name: string | null
  price_includes_tax: number
  sale_price: number
  purchase_price: number
  mrp: number | null
  wholesale_price: number | null
  wholesale_min_qty: number | null
  base_unit_id: string | null
  base_unit_short: string | null
  alt_unit_id: string | null
  alt_conversion: number | null
  track_stock: number
  opening_qty: number
  opening_rate: number
  opening_date: string | null
  low_stock_qty: number | null
  is_active: number
  description: string | null
  barcode: string | null
  has_image: number
  created_at: string
  updated_at: string
  stock_qty: number | null
  stock_value: number | null
  has_txn: number
  extra: string | null
}

const SELECT = `
  SELECT i.id, i.name, i.code, i.kind, i.hsn_sac, i.tax_rate_id, i.price_includes_tax, i.sale_price, i.purchase_price,
         i.mrp, i.wholesale_price, i.wholesale_min_qty, i.base_unit_id, i.alt_unit_id, i.alt_conversion, i.track_stock,
         i.opening_qty, i.opening_rate, i.opening_date, i.low_stock_qty, i.is_active, i.created_at, i.updated_at,
         i.description, i.barcode, i.image IS NOT NULL AS has_image, i.extra,
         c.name AS category_name, t.name AS tax_rate_name, u.short AS base_unit_short,
         s.qty AS stock_qty, s.value AS stock_value,
         (EXISTS (SELECT 1 FROM document_line l JOIN document d ON d.id = l.document_id
                  WHERE l.item_id = i.id AND d.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM stock_movement m WHERE m.item_id = i.id AND m.source_type <> 'opening')) AS has_txn
  FROM item i
  LEFT JOIN item_category c ON c.id = i.category_id
  LEFT JOIN tax_rate t ON t.id = i.tax_rate_id
  LEFT JOIN unit u ON u.id = i.base_unit_id
  LEFT JOIN item_stock s ON s.item_id = i.id
  WHERE i.deleted_at IS NULL`

function fromRow(r: ItemRow): Item {
  return {
    id: r.id,
    name: r.name,
    code: r.code ?? '',
    kind: r.kind,
    category: r.category_name ?? '',
    hsnSac: r.hsn_sac ?? '',
    taxRateId: r.tax_rate_id,
    taxRateName: r.tax_rate_name ?? '',
    priceIncludesTax: toBool(r.price_includes_tax),
    salePrice: r.sale_price,
    purchasePrice: r.purchase_price,
    mrp: r.mrp,
    wholesalePrice: r.wholesale_price,
    wholesaleMinQty: r.wholesale_min_qty,
    baseUnitId: r.base_unit_id,
    baseUnitShort: r.base_unit_short ?? '',
    altUnitId: r.alt_unit_id,
    altConversion: r.alt_conversion,
    trackStock: toBool(r.track_stock),
    openingQty: r.opening_qty,
    openingRate: r.opening_rate,
    openingDate: r.opening_date ?? '',
    lowStockQty: r.low_stock_qty,
    stockQty: r.stock_qty ?? 0,
    stockValue: r.stock_value ?? 0,
    hasTransactions: r.has_txn === 1,
    isActive: toBool(r.is_active),
    description: r.description ?? '',
    barcode: r.barcode ?? '',
    customFields: r.extra ? (JSON.parse(r.extra) as string[]) : null,
    hasImage: r.has_image === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

const orNull = (s: string): string | null => (s === '' ? null : s)

function check(db: DB, input: ItemInput, selfId: string | null): ItemInput {
  const i = normalizeItem(input)
  const errors = validateItem(i)
  if (hasErrors(errors)) throw new UserError(Object.values(errors)[0]!)
  const sameName = db
    .prepare('SELECT 1 FROM item WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id IS NOT ?')
    .get(i.name, selfId)
  if (sameName) throw new UserError(`An item named "${i.name}" already exists`)
  if (i.code) {
    const sameCode = db
      .prepare('SELECT name FROM item WHERE code = ? COLLATE NOCASE AND deleted_at IS NULL AND id IS NOT ?')
      .get(i.code, selfId) as { name: string } | undefined
    if (sameCode) throw new UserError(`Code "${i.code}" is already used by ${sameCode.name}`)
  }
  if (i.barcode) {
    const sameBarcode = db
      .prepare('SELECT name FROM item WHERE barcode = ? AND deleted_at IS NULL AND id IS NOT ?')
      .get(i.barcode, selfId) as { name: string } | undefined
    if (sameBarcode) throw new UserError(`Barcode ${i.barcode} is already used by ${sameBarcode.name}`)
  }
  if (i.image !== undefined && i.image !== null) checkImage(i.image, 'Item photo')
  for (const unit of [i.baseUnitId, i.altUnitId]) {
    if (unit && !db.prepare('SELECT 1 FROM unit WHERE id = ?').get(unit)) throw new UserError('Unit not found')
  }
  if (i.taxRateId && !db.prepare('SELECT 1 FROM tax_rate WHERE id = ?').get(i.taxRateId)) {
    throw new UserError('Tax rate not found')
  }
  return i
}

function categoryId(db: DB, name: string): string | null {
  if (!name) return null
  const row = db.prepare('SELECT id FROM item_category WHERE name = ? COLLATE NOCASE').get(name) as
    | { id: string }
    | undefined
  if (row) return row.id
  const id = uuid()
  db.prepare('INSERT INTO item_category (id, name) VALUES (?,?)').run(id, name)
  return id
}

/** Opening stock is an ordinary stock movement, so current stock is always Σ movements. */
function writeOpeningStock(db: DB, id: string, i: ItemInput): void {
  removeMovements(db, 'opening', id, id)
  if (i.trackStock && i.openingQty > 0) addMovement(db, id, i.openingDate, i.openingQty, i.openingRate, 'opening', id)
  rebuildItemStock(db, id)
}

const COLUMNS = [
  'name', 'code', 'kind', 'category_id', 'hsn_sac', 'tax_rate_id', 'price_includes_tax', 'sale_price',
  'purchase_price', 'mrp', 'wholesale_price', 'wholesale_min_qty', 'base_unit_id', 'alt_unit_id', 'alt_conversion',
  'track_stock', 'opening_qty', 'opening_rate', 'opening_date', 'low_stock_qty', 'description', 'barcode'
]

function values(db: DB, i: ItemInput): unknown[] {
  return [
    i.name, orNull(i.code), i.kind, categoryId(db, i.category), orNull(i.hsnSac), i.taxRateId, toInt(i.priceIncludesTax),
    i.salePrice, i.purchasePrice, i.mrp, i.wholesalePrice, i.wholesaleMinQty, i.baseUnitId, i.altUnitId, i.altConversion,
    toInt(i.trackStock), i.openingQty, i.openingRate, orNull(i.openingDate), i.lowStockQty, orNull(i.description ?? ''),
    orNull(i.barcode ?? '')
  ]
}

export function listItems(db: DB): Item[] {
  return (db.prepare(`${SELECT} ORDER BY i.name COLLATE NOCASE`).all() as ItemRow[]).map(fromRow)
}

export function getItem(db: DB, id: string): Item {
  const row = db.prepare(`${SELECT} AND i.id = ?`).get(id) as ItemRow | undefined
  if (!row) throw new UserError('Item not found')
  return fromRow(row)
}

export function getItemImage(db: DB, id: string): string | null {
  const r = db.prepare('SELECT image FROM item WHERE id = ?').get(id) as { image: string | null } | undefined
  return r?.image ?? null
}

/** A new in-store barcode (EAN-13 starting with 2) not used by any item. */
export function generateBarcode(db: DB): string {
  const used = (db.prepare(`SELECT barcode FROM item WHERE barcode LIKE '2%'`).all() as { barcode: string }[]).map((r) => r.barcode)
  return nextStoreEan(used)
}

export function listItemCategories(db: DB): string[] {
  const rows = db.prepare('SELECT name FROM item_category ORDER BY name COLLATE NOCASE').all() as { name: string }[]
  return rows.map((r) => r.name)
}

export function createItem(db: DB, input: ItemInput): Item {
  const i = check(db, input, null)
  const id = uuid()
  const now = nowIso()
  const placeholders = Array(COLUMNS.length + 3).fill('?').join(', ')
  db.transaction(() => {
    db.prepare(`INSERT INTO item (id, ${COLUMNS.join(', ')}, created_at, updated_at) VALUES (${placeholders})`).run(
      id, ...values(db, i), now, now
    )
    if (i.image) db.prepare('UPDATE item SET image = ? WHERE id = ?').run(i.image, id)
    writeCustom(db, 'item', id, i.customFields)
    writeOpeningStock(db, id, i)
    audit(db, 'item', id, 'create', null, { ...i, image: i.image ? '(photo)' : null })
  })()
  return getItem(db, id)
}

export function updateItem(db: DB, id: string, input: ItemInput): Item {
  const before = getItem(db, id)
  const i = check(db, input, id)
  if (before.hasTransactions && before.trackStock && !i.trackStock) {
    throw new UserError('This item already has stock movements, so stock tracking cannot be turned off')
  }
  if (before.hasTransactions && i.baseUnitId !== before.baseUnitId) {
    throw new UserError('The main unit cannot change once the item has been used in a bill')
  }
  db.transaction(() => {
    const sets = COLUMNS.map((c) => `${c} = ?`).join(', ')
    db.prepare(`UPDATE item SET ${sets}, updated_at = ? WHERE id = ?`).run(...values(db, i), nowIso(), id)
    if (i.image !== undefined) db.prepare('UPDATE item SET image = ? WHERE id = ?').run(i.image, id)
    writeCustom(db, 'item', id, i.customFields)
    writeOpeningStock(db, id, i)
    audit(db, 'item', id, 'update', before, { ...i, image: i.image === undefined ? undefined : i.image ? '(new photo)' : '(removed)' })
  })()
  return getItem(db, id)
}

export function setItemActive(db: DB, id: string, active: boolean): Item {
  getItem(db, id)
  db.prepare('UPDATE item SET is_active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowIso(), id)
  return getItem(db, id)
}

/** Soft-delete an item that is not on any bill. Its opening stock leaves the stock cache. */
export function deleteItem(db: DB, id: string): void {
  const before = getItem(db, id)
  if (before.hasTransactions) throw new UserError('This item is used in bills. Mark it inactive instead of deleting it.')
  db.transaction(() => {
    const now = nowIso()
    db.prepare('UPDATE item SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    removeMovements(db, 'opening', id, id)
    db.prepare('DELETE FROM item_stock WHERE item_id = ?').run(id)
    audit(db, 'item', id, 'delete', before, null)
  })()
}
