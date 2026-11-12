// Extra details typed on each bill line: batch, manufacturing and expiry dates, model, size and
// serial number. Each can be switched on and renamed in Settings › Item fields.

export type DetailKey = 'batch' | 'mfg' | 'exp' | 'model' | 'size' | 'serial'
export type LineDetails = Partial<Record<DetailKey, string>>
export type DateFormat = 'dd/mm/yyyy' | 'mm/yyyy'

export const DETAIL_KEYS: DetailKey[] = ['batch', 'mfg', 'exp', 'model', 'size', 'serial']
export const DATE_KEYS: DetailKey[] = ['mfg', 'exp']
export const DETAIL_DEFAULT_LABELS: Record<DetailKey, string> = {
  batch: 'Batch no.', mfg: 'Mfg. date', exp: 'Exp. date', model: 'Model no.', size: 'Size', serial: 'Serial no.'
}
export const DETAIL_HINTS: Record<DetailKey, string> = {
  batch: 'Batch or lot number, for medicines, food, cosmetics',
  mfg: 'Date of manufacture',
  exp: 'Expiry or best-before date',
  model: 'Model number, for electronics and machines',
  size: 'Size, e.g. M, 32, 10 inch',
  serial: 'Serial or IMEI number, one item at a time'
}

export interface ItemFieldSettings {
  fields: Record<DetailKey, { on: boolean; label: string }>
  mfgFormat: DateFormat
  expFormat: DateFormat
}

export const DEFAULT_ITEM_FIELDS: ItemFieldSettings = {
  fields: Object.fromEntries(DETAIL_KEYS.map((k) => [k, { on: false, label: DETAIL_DEFAULT_LABELS[k] }])) as ItemFieldSettings['fields'],
  mfgFormat: 'dd/mm/yyyy',
  expFormat: 'mm/yyyy'
}

export function completeItemFields(saved: Partial<ItemFieldSettings> | null | undefined): ItemFieldSettings {
  const s = saved ?? {}
  const fields = { ...DEFAULT_ITEM_FIELDS.fields }
  for (const k of DETAIL_KEYS) {
    const f = s.fields?.[k]
    if (f) fields[k] = { on: !!f.on, label: typeof f.label === 'string' && f.label.trim() ? f.label.trim().slice(0, 30) : DETAIL_DEFAULT_LABELS[k] }
  }
  const fmt = (v: unknown, d: DateFormat): DateFormat => (v === 'dd/mm/yyyy' || v === 'mm/yyyy' ? v : d)
  return { fields, mfgFormat: fmt(s.mfgFormat, 'dd/mm/yyyy'), expFormat: fmt(s.expFormat, 'mm/yyyy') }
}

export const enabledDetails = (s: ItemFieldSettings): DetailKey[] => DETAIL_KEYS.filter((k) => s.fields[k].on)

const DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/

/** A problem with one line's details, or ''. Dates are stored as YYYY-MM or YYYY-MM-DD. */
export function lineDetailsError(d: LineDetails | undefined): string {
  if (!d) return ''
  if (typeof d !== 'object') return 'Invalid item details'
  for (const [k, v] of Object.entries(d)) {
    if (!DETAIL_KEYS.includes(k as DetailKey)) return `Unknown item detail "${k}"`
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string' || v.length > 40) return `${DETAIL_DEFAULT_LABELS[k as DetailKey]} can be at most 40 characters`
    if (DATE_KEYS.includes(k as DetailKey) && !DATE_RE.test(v)) return `${DETAIL_DEFAULT_LABELS[k as DetailKey]} must be a date`
  }
  if (d.mfg && d.exp && d.exp.slice(0, 7) < d.mfg.slice(0, 7)) return 'Expiry date is before the manufacturing date'
  return ''
}

/** Details with blanks removed; null when nothing is left. */
export function cleanDetails(d: LineDetails | undefined): LineDetails | null {
  if (!d) return null
  const out: LineDetails = {}
  for (const k of DETAIL_KEYS) {
    const v = d[k]?.trim()
    if (v) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

/** A stored date in the chosen format: 2026-11-12 → 12/11/2026 or 11/2026. */
export function detailDate(v: string, f: DateFormat): string {
  const m = DATE_RE.exec(v)
  if (!m) return v
  return f === 'mm/yyyy' || !m[3] ? `${m[2]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`
}

/** "Batch no.: B12 · Exp. date: 11/2027", for printing under the item name. */
export function detailsText(d: LineDetails | null | undefined, s: ItemFieldSettings): string {
  if (!d) return ''
  return DETAIL_KEYS.filter((k) => d[k])
    .map((k) => `${s.fields[k].label}: ${k === 'mfg' ? detailDate(d[k]!, s.mfgFormat) : k === 'exp' ? detailDate(d[k]!, s.expFormat) : d[k]}`)
    .join(' · ')
}
