// Stock movements are the source of truth; item_stock is a cache rebuilt from them.
import type { StockMovement } from '@shared/models'
import { divRound } from '@shared/money'
import type { DB } from '../db/connection'
import { nowIso, uuid } from '../util'

export type StockSource = 'document' | 'adjustment' | 'opening'

export function addMovement(
  db: DB, itemId: string, date: string, qtyChange: number, rate: number, sourceType: StockSource, sourceId: string
): void {
  if (qtyChange === 0) return
  db.prepare(
    `INSERT INTO stock_movement (id, date, item_id, qty_change, rate, source_type, source_id, created_at) VALUES (?,?,?,?,?,?,?,?)`
  ).run(uuid(), date, itemId, qtyChange, rate, sourceType, sourceId, nowIso())
}

export function removeMovements(db: DB, sourceType: StockSource, sourceId: string, itemId?: string): void {
  if (itemId) {
    db.prepare('DELETE FROM stock_movement WHERE source_type = ? AND source_id = ? AND item_id = ?').run(sourceType, sourceId, itemId)
  } else {
    db.prepare('DELETE FROM stock_movement WHERE source_type = ? AND source_id = ?').run(sourceType, sourceId)
  }
}

/**
 * Recompute the cached quantity and value of one item.
 * Value uses the weighted average cost of everything that came in.
 */
export function rebuildItemStock(db: DB, itemId: string): void {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(qty_change), 0) AS qty,
              COALESCE(SUM(CASE WHEN qty_change > 0 THEN qty_change END), 0) AS in_qty,
              COALESCE(SUM(CASE WHEN qty_change > 0 THEN qty_change * rate END), 0) AS in_value
       FROM stock_movement WHERE item_id = ?`
    )
    .get(itemId) as { qty: number; in_qty: number; in_value: number }
  // in_value is milli-qty × paise; value = qty × (in_value / in_qty) / 1000
  const value = r.in_qty > 0 && r.qty > 0 ? divRound(r.qty * divRound(r.in_value, r.in_qty), 1000) : 0
  db.prepare(
    `INSERT INTO item_stock (item_id, qty, value) VALUES (?,?,?)
     ON CONFLICT(item_id) DO UPDATE SET qty = excluded.qty, value = excluded.value`
  ).run(itemId, r.qty, value)
}

export function rebuildAllStock(db: DB): void {
  db.transaction(() => {
    db.prepare('DELETE FROM item_stock').run()
    for (const { id } of db.prepare('SELECT id FROM item').all() as { id: string }[]) rebuildItemStock(db, id)
  })()
}

const DOC_LABEL: Record<string, string> = {
  SALE_INVOICE: 'Sale invoice',
  SALE_RETURN: 'Credit note',
  PURCHASE_BILL: 'Purchase bill',
  PURCHASE_RETURN: 'Debit note',
  DELIVERY_CHALLAN: 'Delivery challan'
}

export function listMovements(db: DB, itemId: string): StockMovement[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.date, m.qty_change, m.rate, m.source_type, m.source_id,
              d.doc_type, d.number, json_extract(d.party_snapshot, '$.name') AS party, a.reason
       FROM stock_movement m
       LEFT JOIN document d ON m.source_type = 'document' AND d.id = m.source_id
       LEFT JOIN stock_adjustment a ON m.source_type = 'adjustment' AND a.id = m.source_id
       WHERE m.item_id = ? ORDER BY m.date, m.source_type = 'opening' DESC, m.created_at`
    )
    .all(itemId) as {
    id: string; date: string; qty_change: number; rate: number; source_type: StockSource; source_id: string
    doc_type: string | null; number: string | null; party: string | null; reason: string | null
  }[]
  let running = 0
  return rows.map((r) => {
    running += r.qty_change
    let label = 'Opening stock'
    if (r.source_type === 'document') label = `${DOC_LABEL[r.doc_type ?? ''] ?? 'Bill'}${r.party ? ` · ${r.party}` : ''}`
    if (r.source_type === 'adjustment') label = `Adjustment${r.reason ? ` · ${r.reason}` : ''}`
    return {
      id: r.id, date: r.date, qtyChange: r.qty_change, rate: r.rate, sourceType: r.source_type, sourceId: r.source_id,
      label, number: r.number ?? '', runningQty: running
    }
  })
}
