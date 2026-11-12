import type { TaxKind, TaxRate, TaxRateInput } from '@shared/models'
import { hasErrors, validateTaxRate } from '@shared/validation'
import type { DB } from '../db/connection'
import { nowIso, toBool, toInt, UserError, uuid } from '../util'

interface TaxRow {
  id: string
  name: string
  kind: TaxKind
  rate_bp: number
  cess_bp: number
  is_active: number
}

const fromRow = (r: TaxRow): TaxRate => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  rateBp: r.rate_bp,
  cessBp: r.cess_bp,
  isActive: toBool(r.is_active)
})

const KIND_ORDER: Record<TaxKind, number> = { gst: 0, exempt: 1, nil: 2, non_gst: 3 }

export function listTaxRates(db: DB): TaxRate[] {
  const rows = db.prepare('SELECT * FROM tax_rate').all() as TaxRow[]
  return rows
    .map(fromRow)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.rateBp - b.rateBp || a.cessBp - b.cessBp)
}

export function createTaxRate(db: DB, input: TaxRateInput): TaxRate {
  const errors = validateTaxRate(input)
  if (hasErrors(errors)) throw new UserError(Object.values(errors)[0]!)
  const dup = db
    .prepare('SELECT 1 FROM tax_rate WHERE kind = ? AND rate_bp = ? AND cess_bp = ?')
    .get(input.kind, input.rateBp, input.cessBp)
  if (dup) throw new UserError('A tax rate with the same values already exists')
  const id = uuid()
  db.prepare('INSERT INTO tax_rate (id, name, kind, rate_bp, cess_bp, created_at) VALUES (?,?,?,?,?,?)').run(
    id,
    input.name.trim(),
    input.kind,
    input.rateBp,
    input.cessBp,
    nowIso()
  )
  return fromRow(db.prepare('SELECT * FROM tax_rate WHERE id = ?').get(id) as TaxRow)
}

/** Rates are never deleted (old invoices refer to them); they are hidden instead. */
export function setTaxRateActive(db: DB, id: string, active: boolean): TaxRate {
  const result = db.prepare('UPDATE tax_rate SET is_active = ? WHERE id = ?').run(toInt(active), id)
  if (result.changes === 0) throw new UserError('Tax rate not found')
  return fromRow(db.prepare('SELECT * FROM tax_rate WHERE id = ?').get(id) as TaxRow)
}
