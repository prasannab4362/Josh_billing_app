import type { Unit } from '@shared/models'
import type { DB } from '../db/connection'
import { UserError, uuid } from '../util'

const IN_USE = `EXISTS (SELECT 1 FROM item WHERE base_unit_id = u.id OR alt_unit_id = u.id)
             OR EXISTS (SELECT 1 FROM document_line WHERE unit_id = u.id)`

export function listUnits(db: DB): Unit[] {
  const rows = db
    .prepare(`SELECT u.id, u.name, u.short, (${IN_USE}) AS in_use FROM unit u ORDER BY u.name COLLATE NOCASE`)
    .all() as { id: string; name: string; short: string; in_use: number }[]
  return rows.map((r) => ({ id: r.id, name: r.name, short: r.short, inUse: r.in_use === 1 }))
}

export function createUnit(db: DB, name: string, short: string): Unit {
  const n = name.trim()
  const s = short.trim().toLowerCase()
  if (!n) throw new UserError('Unit name is required')
  if (!s || s.length > 10) throw new UserError('Short name must be 1–10 characters')
  if (db.prepare('SELECT 1 FROM unit WHERE short = ?').get(s)) throw new UserError(`Unit "${s}" already exists`)
  const id = uuid()
  db.prepare('INSERT INTO unit (id, name, short) VALUES (?,?,?)').run(id, n, s)
  return { id, name: n, short: s, inUse: false }
}

export function deleteUnit(db: DB, id: string): void {
  const row = db.prepare(`SELECT (${IN_USE}) AS in_use FROM unit u WHERE u.id = ?`).get(id) as
    | { in_use: number }
    | undefined
  if (!row) throw new UserError('Unit not found')
  if (row.in_use) throw new UserError('This unit is used by items or invoices and cannot be deleted')
  db.prepare('DELETE FROM unit WHERE id = ?').run(id)
}
