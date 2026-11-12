// A report laid out as plain tables. The screen builds one of these from report data; the same
// document is drawn on screen, printed / saved as PDF, and saved as CSV for Excel.
import { formatINR } from './money'
import { formatQty } from './qty'

export type ColumnKind = 'text' | 'money' | 'qty' | 'number'
export interface ReportColumn {
  label: string
  kind?: ColumnKind
}
/** Money cells are paise, quantity cells milli-units; null prints as blank. */
export type ReportCell = string | number | null
export interface ReportRow {
  cells: ReportCell[]
  strong?: boolean
  /** Lets the screen open the bill or party behind a row. */
  link?: { kind: 'sale' | 'purchase' | 'party' | 'expense'; id: string; billType?: string }
}
export interface ReportSection {
  heading?: string
  columns: ReportColumn[]
  rows: ReportRow[]
  total?: ReportCell[]
  /** Shown when there are no rows. */
  empty?: string
}
export interface ReportDoc {
  title: string
  /** Usually the period, e.g. "1 Apr 2026 – 31 Mar 2027". */
  subtitle: string
  /** Points to check, shown above the tables. */
  notes?: string[]
  sections: ReportSection[]
}

export const isNumeric = (kind: ColumnKind | undefined) => kind === 'money' || kind === 'qty' || kind === 'number'

export function formatCell(cell: ReportCell, kind: ColumnKind = 'text'): string {
  if (cell === null || cell === '') return ''
  if (typeof cell === 'string') return cell
  if (kind === 'money') return formatINR(cell)
  if (kind === 'qty') return formatQty(cell)
  return cell.toLocaleString('en-IN')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function tableHtml(s: ReportSection): string {
  const cls = (i: number) => (isNumeric(s.columns[i]?.kind) ? ' class="r"' : '')
  const cell = (c: ReportCell, i: number) => esc(formatCell(c, s.columns[i]?.kind))
  const head = s.columns.map((c, i) => `<th${cls(i)}>${esc(c.label)}</th>`).join('')
  const body = s.rows.length
    ? s.rows
        .map((r) => `<tr${r.strong ? ' class="strong"' : ''}>${r.cells.map((c, i) => `<td${cls(i)}>${cell(c, i)}</td>`).join('')}</tr>`)
        .join('')
    : `<tr><td colspan="${s.columns.length}" class="empty">${esc(s.empty ?? 'Nothing in this period')}</td></tr>`
  const foot = s.total && s.rows.length
    ? `<tfoot><tr>${s.total.map((c, i) => `<td${cls(i)}>${cell(c, i)}</td>`).join('')}</tr></tfoot>`
    : ''
  return `${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`
}

/** Printable A4 page (landscape when a table is wide). */
export function reportHtml(doc: ReportDoc, businessName: string): string {
  const wide = doc.sections.some((s) => s.columns.length > 7)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
@page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 12mm; }
body { font: 10pt/1.35 "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
header { border-bottom: 2px solid #111; margin-bottom: 10px; padding-bottom: 6px; }
header .biz { font-size: 13pt; font-weight: 700; }
header h1 { font-size: 12pt; margin: 2px 0 0; }
header .sub { color: #555; }
h2 { font-size: 10.5pt; margin: 14px 0 4px; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 1px solid #ddd; padding: 3px 5px; text-align: left; vertical-align: top; }
th { background: #f2f2f2; font-weight: 600; }
.r, th.r { text-align: right; white-space: nowrap; }
tr.strong td { font-weight: 700; }
tfoot td { font-weight: 700; border-top: 1.5px solid #111; }
td.empty { color: #777; text-align: center; padding: 12px; }
ul.notes { margin: 0 0 8px; padding-left: 18px; color: #8a4b00; }
</style></head><body><header><div class="biz">${esc(businessName)}</div><h1>${esc(doc.title)}</h1><div class="sub">${esc(doc.subtitle)}</div></header>
${doc.notes?.length ? `<ul class="notes">${doc.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
${doc.sections.map(tableHtml).join('\n')}
</body></html>`
}

function csvValue(cell: ReportCell, kind: ColumnKind = 'text'): string {
  let text: string
  if (cell === null) text = ''
  else if (typeof cell === 'string') text = cell
  else if (kind === 'money') text = (cell / 100).toFixed(2)
  else if (kind === 'qty') text = formatQty(cell)
  else text = String(cell)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV with plain numbers (no ₹ or grouping) so Excel can add them up. */
export function reportCsv(doc: ReportDoc, businessName: string): string {
  const out: string[] = [csvValue(businessName), csvValue(doc.title), csvValue(doc.subtitle), ...(doc.notes ?? []).map((n) => csvValue(`Note: ${n}`))]
  for (const s of doc.sections) {
    out.push('')
    if (s.heading) out.push(csvValue(s.heading))
    out.push(s.columns.map((c) => csvValue(c.label)).join(','))
    for (const r of s.rows) out.push(r.cells.map((c, i) => csvValue(c, s.columns[i]?.kind)).join(','))
    if (s.total && s.rows.length) out.push(s.total.map((c, i) => csvValue(c, s.columns[i]?.kind)).join(','))
  }
  // The byte-order mark makes Excel read the file as UTF-8 (₹, Hindi names).
  return '﻿' + out.join('\r\n') + '\r\n'
}
