import { DEFAULT_PREFERENCES, type PaperSize, type Preferences } from '@shared/models'
import type { DB } from '../db/connection'
import { nowIso, UserError } from '../util'

const KEYS: Record<keyof Preferences, string> = {
  gstRegistered: 'gst.registered',
  pricesIncludeTax: 'gst.pricesIncludeTax',
  roundOff: 'invoice.roundOff',
  defaultDueDays: 'invoice.defaultDueDays',
  allowNegativeStock: 'stock.allowNegative',
  paperSize: 'print.paperSize'
}

const PAPER_SIZES: PaperSize[] = ['A4', 'A5', 'thermal80', 'thermal58']

function check(p: Partial<Preferences>): void {
  if (p.defaultDueDays !== undefined && (!Number.isInteger(p.defaultDueDays) || p.defaultDueDays < 0 || p.defaultDueDays > 365)) {
    throw new UserError('Default due days must be between 0 and 365')
  }
  if (p.paperSize !== undefined && !PAPER_SIZES.includes(p.paperSize)) throw new UserError('Unknown paper size')
}

export function getPreferences(db: DB): Preferences {
  const rows = db.prepare('SELECT key, value FROM setting').all() as { key: string; value: string }[]
  const stored = new Map(rows.map((r) => [r.key, r.value]))
  const result = { ...DEFAULT_PREFERENCES } as Record<keyof Preferences, unknown>
  for (const [field, key] of Object.entries(KEYS) as [keyof Preferences, string][]) {
    const raw = stored.get(key)
    if (raw !== undefined) result[field] = JSON.parse(raw)
  }
  return result as unknown as Preferences
}

/** Save only the fields given; returns the full merged preferences. */
export function savePreferences(db: DB, changes: Partial<Preferences>): Preferences {
  check(changes)
  const upsert = db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
  const now = nowIso()
  db.transaction(() => {
    for (const [field, value] of Object.entries(changes) as [keyof Preferences, unknown][]) {
      if (value !== undefined && KEYS[field]) upsert.run(KEYS[field], JSON.stringify(value), now)
    }
  })()
  return getPreferences(db)
}
