// Barcode and QR labels for items, on a label-printer roll or A4 sticker sheets. One HTML page;
// the same page is previewed, printed and saved as PDF.
import { barcodeSvg } from './barcode'
import { formatINR } from './money'
import { qrSvg } from './qr'

export type LabelLayout =
  | 'roll-50x25' | 'roll-2x50x25' | 'roll-38x25' | 'roll-2x38x25' | 'roll-100x50' | 'roll-custom'
  | 'a4-65' | 'a4-40' | 'a4-24'

export interface LayoutInfo {
  label: string
  /** Label printer (a roll, one row of labels per page) or regular printer (A4 sticker sheet). */
  printer: 'label' | 'regular'
  /** Label size, millimetres. */
  width: number
  height: number
  /** Rolls: labels side by side and the gap between them. */
  across?: number
  gap?: number
  /** A4 sheets: columns, rows and the gaps of common sticker sheets. */
  sheet?: { cols: number; rows: number; top: number; left: number; gapX: number; gapY: number }
}

export const LABEL_LAYOUTS: Record<LabelLayout, LayoutInfo> = {
  'roll-50x25': { label: '1 label across, 50 × 25 mm', printer: 'label', width: 50, height: 25 },
  'roll-2x50x25': { label: '2 labels across, 50 × 25 mm', printer: 'label', width: 50, height: 25, across: 2, gap: 2 },
  'roll-38x25': { label: '1 label across, 38 × 25 mm', printer: 'label', width: 38, height: 25 },
  'roll-2x38x25': { label: '2 labels across, 38 × 25 mm', printer: 'label', width: 38, height: 25, across: 2, gap: 2 },
  'roll-100x50': { label: '1 label across, 100 × 50 mm', printer: 'label', width: 100, height: 50 },
  'roll-custom': { label: 'Custom size…', printer: 'label', width: 50, height: 25 },
  'a4-65': { label: 'A4 sheet, 65 labels (38 × 21 mm)', printer: 'regular', width: 38.1, height: 21.2, sheet: { cols: 5, rows: 13, top: 10.7, left: 4.7, gapX: 2.5, gapY: 0 } },
  'a4-40': { label: 'A4 sheet, 40 labels (52 × 30 mm)', printer: 'regular', width: 52.5, height: 29.7, sheet: { cols: 4, rows: 10, top: 0, left: 0, gapX: 0, gapY: 0 } },
  'a4-24': { label: 'A4 sheet, 24 labels (70 × 37 mm)', printer: 'regular', width: 70, height: 37, sheet: { cols: 3, rows: 8, top: 0.5, left: 0, gapX: 0, gapY: 0 } }
}

export type LabelSymbol = 'barcode' | 'qr'

/** What a text line on the label shows. */
export type LabelField =
  | 'none' | 'business' | 'name' | 'price' | 'mrp' | 'saving' | 'code' | 'category' | 'hsn' | 'description'
  | 'batch' | 'model' | 'mfg' | 'exp' | 'custom'

export const LABEL_FIELDS: Record<LabelField, string> = {
  none: 'Nothing',
  business: 'Business name',
  name: 'Item name',
  price: 'Sale price (with GST)',
  mrp: 'MRP',
  saving: 'You save (MRP − price)',
  code: 'Item code',
  category: 'Category',
  hsn: 'HSN code',
  description: 'Description',
  batch: 'Batch no. (enter per item)',
  model: 'Model no. (enter per item)',
  mfg: 'Mfg. date (enter per item)',
  exp: 'Exp. date (enter per item)',
  custom: 'Your own text…'
}

/** Values typed per item for this print, for the batch, model and date lines. */
export type LabelExtraField = 'batch' | 'model' | 'mfg' | 'exp'
export const EXTRA_FIELDS: LabelExtraField[] = ['batch', 'model', 'mfg', 'exp']
export const EXTRA_TITLES: Record<LabelExtraField, string> = { batch: 'Batch no.', model: 'Model no.', mfg: 'Mfg. date', exp: 'Exp. date' }
export type LabelExtra = Partial<Record<LabelExtraField, string>>

/** The per-item fields the chosen lines need, in order. */
export function extraFieldsUsed(o: Pick<LabelOptions, 'header' | 'lines'>): LabelExtraField[] {
  const used = new Set([o.header, ...o.lines].map((l) => l.field))
  return EXTRA_FIELDS.filter((f) => used.has(f))
}

/** "2026-11" (a month picker's value) → "11/2026"; anything else as typed. */
export function monthText(v: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v.trim())
  if (!m) return v.trim()
  return m[3] ? `${m[3]}/${m[2]}/${m[1]}` : `${m[2]}/${m[1]}`
}

export interface LabelLine {
  field: LabelField
  /** The text, for 'custom' (the same on every label, e.g. "Mfg 11/2026" or "Batch B12"). */
  text: string
}

export interface CustomSize {
  width: number
  height: number
  across: number
  gap: number
}

/** A label size the business saved under a name, for its own label rolls. */
export interface SavedLabelSize extends CustomSize {
  id: string
  name: string
}

export interface LabelOptions {
  layout: LabelLayout
  /** Used when layout is 'roll-custom'. */
  custom?: CustomSize
  /** The saved size chosen, when layout is 'roll-custom'. */
  sizeId?: string
  symbol: LabelSymbol
  /** Print the code in figures under the barcode (or beside the QR code). */
  showCode: boolean
  /** Small heading at the top, then up to four lines. */
  header: LabelLine
  lines: LabelLine[]
  /** Empty places to skip at the start of the first sheet (to use a part-used sheet). */
  skip: number
}

export interface LabelData {
  name: string
  /** What the barcode or QR code holds: the item's barcode, else its item code. */
  code: string
  itemCode: string
  category: string
  hsn: string
  description: string
  /** Selling price including GST, paise. */
  price: number
  mrp: number | null
  /** Batch, model and dates typed for this print. */
  extra?: LabelExtra
}

export const MAX_LABEL_LINES = 4

export const DEFAULT_LABEL_OPTIONS: LabelOptions = {
  layout: 'roll-2x50x25',
  custom: { width: 50, height: 25, across: 1, gap: 2 },
  symbol: 'barcode',
  showCode: true,
  header: { field: 'business', text: '' },
  lines: [
    { field: 'name', text: '' },
    { field: 'price', text: '' },
    { field: 'mrp', text: '' },
    { field: 'none', text: '' }
  ],
  skip: 0
}

/** Problem with a custom size, or '' when it is fine. */
export function customSizeError(c: CustomSize | undefined): string {
  if (!c) return 'Enter the label size'
  const bad = (n: number, lo: number, hi: number) => !Number.isFinite(n) || n < lo || n > hi
  if (bad(c.width, 15, 120)) return 'Label width must be 15 to 120 mm'
  if (bad(c.height, 10, 120)) return 'Label height must be 10 to 120 mm'
  if (!Number.isInteger(c.across) || c.across < 1 || c.across > 4) return 'Labels across must be 1 to 4'
  if (bad(c.gap, 0, 10)) return 'Gap between labels must be 0 to 10 mm'
  return ''
}

/** The layout to print, with a custom size filled in. */
export function resolveLayout(o: Pick<LabelOptions, 'layout' | 'custom'>): LayoutInfo {
  const L = LABEL_LAYOUTS[o.layout]
  if (o.layout !== 'roll-custom' || !o.custom) return L
  return { ...L, width: o.custom.width, height: o.custom.height, across: o.custom.across, gap: o.custom.gap }
}

/** Width of the printed page, millimetres (what to set as the paper width in the printer). */
export function pageWidth(L: LayoutInfo): number {
  if (L.sheet) return 210
  const n = L.across ?? 1
  return Math.round((n * L.width + (n - 1) * (L.gap ?? 0)) * 10) / 10
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The text of one line for one label; '' leaves the line off. */
export function lineText(line: LabelLine, d: LabelData, businessName: string): string {
  switch (line.field) {
    case 'business': return businessName
    case 'name': return d.name
    case 'price': return formatINR(d.price)
    case 'mrp': return d.mrp !== null ? `MRP ${formatINR(d.mrp)}` : ''
    case 'saving': return d.mrp !== null && d.mrp > d.price ? `You save ${formatINR(d.mrp - d.price)}` : ''
    case 'code': return d.itemCode
    case 'category': return d.category
    case 'hsn': return d.hsn ? `HSN ${d.hsn}` : ''
    case 'description': return d.description
    case 'batch': return d.extra?.batch?.trim() ? `Batch: ${d.extra.batch.trim()}` : ''
    case 'model': return d.extra?.model?.trim() ? `Model: ${d.extra.model.trim()}` : ''
    case 'mfg': return d.extra?.mfg?.trim() ? `Mfg: ${monthText(d.extra.mfg)}` : ''
    case 'exp': return d.extra?.exp?.trim() ? `Exp: ${monthText(d.extra.exp)}` : ''
    case 'custom': return line.text.trim()
    default: return ''
  }
}

function labelHtml(d: LabelData, o: LabelOptions, businessName: string, L: LayoutInfo): string {
  const header = lineText(o.header, d, businessName)
  const lines = o.lines.slice(0, MAX_LABEL_LINES).map((l) => lineText(l, d, businessName)).filter(Boolean)
  const text = [
    header ? `<div class="head">${esc(header)}</div>` : '',
    ...lines.map((t, i) => `<div class="line${i === 0 ? ' first' : ''}">${esc(t)}</div>`)
  ]
  const code = o.showCode ? `<div class="code">${esc(d.code)}</div>` : ''
  if (o.symbol === 'qr') {
    // Wide labels: QR code on the left, text beside it. Tall ones: QR code on top.
    const side = L.width >= L.height * 1.3
    return `<div class="label qr ${side ? 'side' : 'top'}"><div class="qrbox">${qrSvg(d.code)}</div><div class="text">${text.join('')}${code}</div></div>`
  }
  const [head, ...rest] = text
  return `<div class="label">${head}<div class="bars">${barcodeSvg(d.code)}</div>${code}${rest.join('')}</div>`
}

const PT_MM = 0.3528
const LINE_HEIGHT = 1.12
/** Smallest text that still prints readably on thermal and laser printers. */
export const MIN_LABEL_PT = 4.5

/**
 * Text size for a label: as large as reads well, shrunk so every line fits the height.
 * `fits` is false when even the smallest size cannot hold them all (some lines would be cut off).
 */
export function labelFit(L: Pick<LayoutInfo, 'width' | 'height'>, symbol: LabelSymbol, lineCount: number): { pt: number; fits: boolean } {
  const base = Math.max(5.5, Math.min(10, L.height / 3.4))
  if (lineCount === 0) return { pt: base, fits: true }
  const inner = L.height - 2.4
  // Room left for text: beside a QR code the full height; under a barcode or a QR code on top, what the code leaves.
  const qrSide = symbol === 'qr' && L.width >= L.height * 1.3
  const room = qrSide ? inner : symbol === 'qr' ? inner - Math.max(6, L.height * 0.45) : inner - Math.max(5, L.height * 0.3) - 0.7
  const needed = (pt: number) => lineCount * pt * PT_MM * LINE_HEIGHT
  const pt = Math.min(base, room / (lineCount * PT_MM * LINE_HEIGHT))
  if (pt >= MIN_LABEL_PT) return { pt: Math.floor(pt * 10) / 10, fits: true }
  return { pt: MIN_LABEL_PT, fits: needed(MIN_LABEL_PT) <= room + 0.01 }
}

/** How many text lines the fullest label of this print has (header, lines and the code in figures). */
export function labelLineCount(labels: LabelData[], o: LabelOptions, businessName: string): number {
  const lines = (d: LabelData) => [o.header, ...o.lines.slice(0, MAX_LABEL_LINES)].filter((l) => lineText(l, d, businessName)).length
  return Math.max(0, ...labels.map(lines)) + (o.showCode ? 1 : 0)
}

/** Printable page(s) with one label per entry, in order. */
export function labelsHtml(labels: LabelData[], o: LabelOptions, businessName: string): string {
  const L = resolveLayout(o)
  const mm = (n: number) => `${n}mm`
  const s = L.sheet
  const empty = '<div class="label empty"></div>'
  const cells = [...Array(s ? Math.max(0, Math.min(o.skip, s.cols * s.rows - 1)) : 0).fill(empty), ...labels.map((d) => labelHtml(d, o, businessName, L))]
  let body = ''
  let page: string
  if (s) {
    const per = s.cols * s.rows
    for (let i = 0; i < cells.length; i += per) body += `<div class="sheet">${cells.slice(i, i + per).join('')}</div>`
    page = `@page { size: A4; margin: 0; }
.sheet { width: 210mm; height: 297mm; padding: ${mm(s.top)} 0 0 ${mm(s.left)}; display: grid;
  grid-template-columns: repeat(${s.cols}, ${mm(L.width)}); grid-auto-rows: ${mm(L.height)};
  column-gap: ${mm(s.gapX)}; row-gap: ${mm(s.gapY)}; align-content: start; page-break-after: always; }
.sheet:last-child { page-break-after: auto; }`
  } else {
    // A roll: each page is one row of labels side by side.
    const n = L.across ?? 1
    for (let i = 0; i < cells.length; i += n) body += `<div class="row">${cells.slice(i, i + n).join('')}${empty.repeat(Math.max(0, i + n - cells.length))}</div>`
    page = `@page { size: ${mm(pageWidth(L))} ${mm(L.height)}; margin: 0; }
.row { display: flex; column-gap: ${mm(L.gap ?? 0)}; width: ${mm(pageWidth(L))}; height: ${mm(L.height)}; page-break-after: always; }
.row:last-child { page-break-after: auto; }`
  }
  // Text scales with the label height so small stickers stay readable.
  // Beside a QR code the item name may take two lines; count it so, when there is a name.
  const qrSide = o.symbol === 'qr' && L.width >= L.height * 1.3
  const count = labelLineCount(labels, o, businessName)
  const fit = labelFit(L, o.symbol, count + (qrSide && count > (o.showCode ? 1 : 0) ? 1 : 0))
  const base = fit.pt
  // The code in figures stays on one line beside a QR code: shrink it to the width of the text column.
  const longest = Math.max(1, ...labels.map((d) => d.code.length))
  // Beside a QR code, keep at least half the label for text.
  const qrSize = Math.max(8, Math.min(L.height - 2.4, L.width * 0.5))
  const textWidth = L.width - qrSize - 1.5 - 2.4
  const codeFitPt = textWidth / (longest * 0.62 * PT_MM)
  // Too long for one line even small: wrap it instead.
  const sideCodePt = codeFitPt >= 3.5 ? Math.min(base * 0.85, codeFitPt) : Math.min(base * 0.85, 4.5)
  const sideCodeWrap = codeFitPt < 3.5
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="label-fit" content="${fit.fits ? 'ok' : 'tight'}"><title>Labels</title><style>
* { box-sizing: border-box; margin: 0; }
html, body { background: #fff; }
body { font-family: Arial, 'Segoe UI', sans-serif; color: #000; font-size: ${base}pt; }
${page}
.label { width: ${mm(L.width)}; height: ${mm(L.height)}; flex: none; padding: 1.2mm 2mm; overflow: hidden; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; line-height: 1.12; }
.head { font-size: 0.85em; font-weight: 700; color: #222; }
.head, .line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.line.first { font-weight: 700; }
.bars { width: 100%; max-width: 60mm; flex: 1 1 auto; min-height: ${mm(Math.max(5, L.height * 0.3))}; max-height: ${mm(Math.max(6, L.height * 0.42))}; margin: 0.5mm 0 0.2mm; }
.bars svg { width: 100%; height: 100%; display: block; fill: #000; }
.code { font-family: Consolas, monospace; font-size: 0.85em; letter-spacing: 0.04em; }
.qrbox svg { width: 100%; height: 100%; display: block; fill: #000; }
.label.qr.side { flex-direction: row; justify-content: flex-start; gap: 1.5mm; padding: 1.2mm; text-align: left; }
.label.qr.side .qrbox { width: ${mm(qrSize)}; height: ${mm(qrSize)}; flex: none; }
.label.qr.side .text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.3mm; }
.label.qr.top .qrbox { width: 100%; flex: 1 1 auto; min-height: 6mm; }
.label.qr.top .text { width: 100%; }
.label.qr.side .code { ${sideCodeWrap ? 'word-break: break-all;' : 'white-space: nowrap; overflow: hidden;'} font-size: ${sideCodePt.toFixed(1)}pt; letter-spacing: 0; }
.label.qr.side .line.first { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
</style></head><body>${body}</body></html>`
}
