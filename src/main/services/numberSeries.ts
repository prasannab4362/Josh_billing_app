import { formatDocNumber, NUMBERED_LABELS, NUMBERED_TYPES, type NumberedType } from '@shared/docTypes'
import { fyShort } from '@shared/fy'
import type { NumberSeries, NumberSeriesUpdate } from '@shared/models'
import { hasErrors, validateSeries } from '@shared/validation'
import type { DB } from '../db/connection'
import { nowIso, toBool, UserError, uuid } from '../util'

interface SeriesRow {
  id: string
  doc_type: NumberedType
  prefix: string
  next_number: number
  padding: number
  fy: string | null
  is_default: number
}

const fromRow = (r: SeriesRow): NumberSeries => ({
  id: r.id,
  docType: r.doc_type,
  prefix: r.prefix,
  nextNumber: r.next_number,
  padding: r.padding,
  fy: r.fy,
  isDefault: toBool(r.is_default)
})

export function defaultPrefix(type: NumberedType, fy: string): string {
  return `${NUMBERED_LABELS[type].code}/${fyShort(fy)}/`
}

/** Make sure each numbered type has a default series for this financial year. */
export function ensureSeriesForFy(db: DB, fy: string): void {
  const exists = db.prepare('SELECT 1 FROM number_series WHERE doc_type = ? AND fy = ? AND is_default = 1')
  const insert = db.prepare(
    `INSERT INTO number_series (id, doc_type, prefix, next_number, padding, fy, is_default, created_at)
     VALUES (?,?,?,1,0,?,1,?)`
  )
  const now = nowIso()
  db.transaction(() => {
    for (const type of NUMBERED_TYPES) {
      if (!exists.get(type, fy)) insert.run(uuid(), type, defaultPrefix(type, fy), fy, now)
    }
  })()
}

export function listSeries(db: DB, fy: string): NumberSeries[] {
  ensureSeriesForFy(db, fy)
  const rows = db
    .prepare('SELECT * FROM number_series WHERE fy = ? AND is_default = 1')
    .all(fy) as SeriesRow[]
  const order = new Map(NUMBERED_TYPES.map((t, i) => [t, i]))
  return rows.map(fromRow).sort((a, b) => (order.get(a.docType) ?? 99) - (order.get(b.docType) ?? 99))
}

export function updateSeries(db: DB, id: string, update: NumberSeriesUpdate): NumberSeries {
  const errors = validateSeries(update)
  if (hasErrors(errors)) throw new UserError(Object.values(errors)[0]!)
  const row = db.prepare('SELECT * FROM number_series WHERE id = ?').get(id) as SeriesRow | undefined
  if (!row) throw new UserError('Number series not found')

  const clash = db
    .prepare('SELECT 1 FROM number_series WHERE doc_type = ? AND prefix = ? AND fy IS ? AND id <> ?')
    .get(row.doc_type, update.prefix, row.fy, id)
  if (clash) throw new UserError('Another series already uses this prefix')

  // Do not allow a restart that would reissue a number already used on a saved document.
  const candidate = formatDocNumber(update.prefix, update.nextNumber, update.padding)
  const used = db
    .prepare('SELECT 1 FROM document WHERE doc_type = ? AND number = ? LIMIT 1')
    .get(row.doc_type, candidate)
  if (used) throw new UserError(`Number ${candidate} is already used. Choose a higher starting number.`)

  db.prepare('UPDATE number_series SET prefix = ?, next_number = ?, padding = ? WHERE id = ?').run(
    update.prefix,
    update.nextNumber,
    update.padding,
    id
  )
  return fromRow(db.prepare('SELECT * FROM number_series WHERE id = ?').get(id) as SeriesRow)
}

export function setSeriesPrefix(db: DB, type: NumberedType, fy: string, prefix: string): void {
  const row = db
    .prepare('SELECT * FROM number_series WHERE doc_type = ? AND fy = ? AND is_default = 1')
    .get(type, fy) as SeriesRow
  updateSeries(db, row.id, { prefix, nextNumber: row.next_number, padding: row.padding })
}

export function previewNumber(s: Pick<NumberSeries, 'prefix' | 'nextNumber' | 'padding'>): string {
  return formatDocNumber(s.prefix, s.nextNumber, s.padding)
}

/** The default series row for a type in a financial year (created if missing). */
export function defaultSeries(db: DB, type: NumberedType, fy: string): NumberSeries {
  ensureSeriesForFy(db, fy)
  const row = db
    .prepare('SELECT * FROM number_series WHERE doc_type = ? AND fy = ? AND is_default = 1')
    .get(type, fy) as SeriesRow
  return fromRow(row)
}

/**
 * Hand out the next number of a series and move the series on. Skips numbers already taken
 * (for example typed in by hand), so a number is never issued twice.
 */
export function takeNumber(
  db: DB, type: NumberedType, fy: string, isTaken: (number: string) => boolean
): { number: string; seriesId: string } {
  const s = defaultSeries(db, type, fy)
  let n = s.nextNumber
  while (isTaken(formatDocNumber(s.prefix, n, s.padding))) n++
  db.prepare('UPDATE number_series SET next_number = ? WHERE id = ?').run(n + 1, s.id)
  return { number: formatDocNumber(s.prefix, n, s.padding), seriesId: s.id }
}

/** What takeNumber would return, without using it up. */
export function peekNumber(db: DB, type: NumberedType, fy: string, isTaken: (number: string) => boolean): string {
  const s = defaultSeries(db, type, fy)
  let n = s.nextNumber
  while (isTaken(formatDocNumber(s.prefix, n, s.padding))) n++
  return formatDocNumber(s.prefix, n, s.padding)
}
