// Stock adjustments (damage, count corrections, free samples) and the stock summary report.
import type { StockAdjustmentInput, StockSummary } from '@shared/models'
import { divRound } from '@shared/money'
import { lineAmount } from '@shared/qty'
import { todayLocal } from '@shared/fy'
import type { DB } from '../db/connection'
import { nowIso, UserError, uuid } from '../util'
import { audit } from './audit'
import { checkStock } from './invoices'
import { addMovement, rebuildItemStock, removeMovements } from './stock'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Average cost per base unit of everything that came in up to a date (0 when nothing has). */
export function averageCost(db: DB, itemId: string, asOf = '9999-12-31'): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(qty_change), 0) AS q, COALESCE(SUM(qty_change * rate), 0) AS v
       FROM stock_movement WHERE item_id = ? AND qty_change > 0 AND date <= ?`
    )
    .get(itemId, asOf) as { q: number; v: number }
  return r.q > 0 ? divRound(r.v, r.q) : 0
}

export function createAdjustment(db: DB, a: StockAdjustmentInput): string {
  const item = db
    .prepare('SELECT name, kind, track_stock, purchase_price FROM item WHERE id = ? AND deleted_at IS NULL')
    .get(a.itemId) as { name: string; kind: string; track_stock: number; purchase_price: number } | undefined
  if (!item) throw new UserError('Item not found')
  if (item.kind !== 'goods' || !item.track_stock) throw new UserError(`${item.name} does not track stock`)
  if (!DATE.test(a.date)) throw new UserError('Choose the adjustment date')
  if (!Number.isInteger(a.qtyChange) || a.qtyChange === 0) throw new UserError('Enter the quantity to add or remove')
  if (a.rate !== null && (!Number.isInteger(a.rate) || a.rate < 0)) throw new UserError('Enter a valid cost')
  if (a.reason.trim().length > 120) throw new UserError('Reason is too long')
  // Stock added without a cost is valued at the current average (or the purchase price for a new item).
  const rate = a.rate ?? (averageCost(db, a.itemId) || item.purchase_price)

  const id = uuid()
  db.transaction(() => {
    db.prepare(
      'INSERT INTO stock_adjustment (id, date, item_id, qty_change, rate, reason, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(id, a.date, a.itemId, a.qtyChange, rate, a.reason.trim() || null, nowIso())
    addMovement(db, a.itemId, a.date, a.qtyChange, a.qtyChange > 0 ? rate : 0, 'adjustment', id)
    rebuildItemStock(db, a.itemId)
    checkStock(db, [a.itemId])
    audit(db, 'stock_adjustment', id, 'create', null, { ...a, rate })
  })()
  return id
}

export function deleteAdjustment(db: DB, id: string): void {
  const row = db.prepare('SELECT * FROM stock_adjustment WHERE id = ? AND deleted_at IS NULL').get(id) as
    | { item_id: string }
    | undefined
  if (!row) throw new UserError('Adjustment not found')
  db.transaction(() => {
    db.prepare('UPDATE stock_adjustment SET deleted_at = ? WHERE id = ?').run(nowIso(), id)
    removeMovements(db, 'adjustment', id)
    rebuildItemStock(db, row.item_id)
    checkStock(db, [row.item_id])
    audit(db, 'stock_adjustment', id, 'delete', row, null)
  })()
}

/** Quantity and value of every stocked item on a date, valued at weighted average cost. */
export function stockSummary(db: DB, asOf = todayLocal(), activeOnly = true): StockSummary {
  if (!DATE.test(asOf)) throw new UserError('Choose a date')
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.code, c.name AS category, u.short AS unit, i.sale_price, i.low_stock_qty,
              COALESCE(SUM(m.qty_change), 0) AS qty,
              COALESCE(SUM(CASE WHEN m.qty_change > 0 THEN m.qty_change END), 0) AS in_qty,
              COALESCE(SUM(CASE WHEN m.qty_change > 0 THEN m.qty_change * m.rate END), 0) AS in_value
       FROM item i
       LEFT JOIN item_category c ON c.id = i.category_id
       LEFT JOIN unit u ON u.id = i.base_unit_id
       LEFT JOIN stock_movement m ON m.item_id = i.id AND m.date <= ?
       WHERE i.deleted_at IS NULL AND i.kind = 'goods' AND i.track_stock = 1 AND (i.is_active = 1 OR ? = 0)
       GROUP BY i.id
       ORDER BY i.name COLLATE NOCASE`
    )
    .all(asOf, activeOnly ? 1 : 0) as {
    id: string; name: string; code: string | null; category: string | null; unit: string | null; sale_price: number
    low_stock_qty: number | null; qty: number; in_qty: number; in_value: number
  }[]
  const out = rows.map((r) => {
    const avgCost = r.in_qty > 0 ? divRound(r.in_value, r.in_qty) : 0
    const positive = Math.max(r.qty, 0)
    return {
      itemId: r.id,
      name: r.name,
      code: r.code ?? '',
      category: r.category ?? '',
      unit: r.unit ?? '',
      qty: r.qty,
      avgCost,
      value: lineAmount(positive, avgCost),
      salePrice: r.sale_price,
      saleValue: lineAmount(positive, r.sale_price),
      lowStockQty: r.low_stock_qty,
      low: r.low_stock_qty !== null && r.qty <= r.low_stock_qty
    }
  })
  return {
    asOf,
    rows: out,
    totalValue: out.reduce((s, r) => s + r.value, 0),
    totalSaleValue: out.reduce((s, r) => s + r.saleValue, 0),
    lowCount: out.filter((r) => r.low).length
  }
}
