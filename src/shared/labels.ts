// Barcode and QR labels for items, on a label-printer roll or A4 sticker sheets. One HTML page;
// the same page is previewed, printed and saved as PDF.
import { barcodeSvg } from './barcode'
import { formatINR } from './money'
import { qrSvg } from './qr'

export type LabelLayout =
  | 'roll-50x25' | 'roll-2x50x25' | 'roll-38x25' | 'roll-2x38x25' | 'roll-2x50x38' | 'roll-100x50' | 'roll-jewel-100x15' | 'roll-custom'
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
  'roll-2x50x38': { label: '2 labels across, 50 × 38 mm (garment tags)', printer: 'label', width: 50, height: 38, across: 2, gap: 2 },
  'roll-100x50': { label: '1 label across, 100 × 50 mm', printer: 'label', width: 100, height: 50 },
  'roll-jewel-100x15': { label: 'Jewellery tag, 100 × 15 mm', printer: 'label', width: 100, height: 15 },
  'roll-custom': { label: 'Custom size…', printer: 'label', width: 50, height: 25 },
  'a4-65': { label: 'A4 sheet, 65 labels (38 × 21 mm)', printer: 'regular', width: 38.1, height: 21.2, sheet: { cols: 5, rows: 13, top: 10.7, left: 4.7, gapX: 2.5, gapY: 0 } },
  'a4-40': { label: 'A4 sheet, 40 labels (52 × 30 mm)', printer: 'regular', width: 52.5, height: 29.7, sheet: { cols: 4, rows: 10, top: 0, left: 0, gapX: 0, gapY: 0 } },
  'a4-24': { label: 'A4 sheet, 24 labels (70 × 37 mm)', printer: 'regular', width: 70, height: 37, sheet: { cols: 3, rows: 8, top: 0.5, left: 0, gapX: 0, gapY: 0 } }
}

export type LabelSymbol = 'barcode' | 'qr'

/** What a text line on the label shows. */
export type LabelField =
  | 'none' | 'business' | 'name' | 'price' | 'mrp' | 'saving' | 'code' | 'category' | 'hsn' | 'description'
  | 'batch' | 'model' | 'mfg' | 'exp' | 'own1' | 'own2' | 'own3' | 'own4' | 'custom'

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
  // The business's own item fields (Settings › Extra fields), e.g. Size, Colour, Design no.; the screen shows their names.
  own1: 'Own item field 1',
  own2: 'Own item field 2',
  own3: 'Own item field 3',
  own4: 'Own item field 4',
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
  /** The design (layout of the parts); 'classic' when not set, as in older saved designs. */
  style?: LabelStyle
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
  /** The item's own fields, by position (Size, Colour…): name and value, or null when switched off. */
  own?: ({ label: string; value: string } | null)[]
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
    case 'own1':
    case 'own2':
    case 'own3':
    case 'own4': {
      const f = d.own?.[Number(line.field.slice(3)) - 1]
      if (!f || !f.value.trim()) return ''
      // Short names read well in front ("Size: M"); a long one ("Design no.") would push the value itself off a
      // small label, so then the value is printed alone ("D-220").
      return f.label.length <= 6 ? `${f.label}: ${f.value.trim()}` : f.value.trim()
    }
    case 'custom': return line.text.trim()
    default: return ''
  }
}

function labelHtml(d: LabelData, o: LabelOptions, businessName: string, L: LayoutInfo): string {
  const style = o.style && o.style in LABEL_STYLES ? o.style : 'classic'
  if (style === 'classic') return classicHtml(d, o, businessName, L)
  const html = styledLabelHtml(style, d, o, businessName, L)
  return style === 'boxed' ? html : html.replace('class="label ', 'class="label styled ')
}

function classicHtml(d: LabelData, o: LabelOptions, businessName: string, L: LayoutInfo): string {
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
  const style = o.style && o.style in LABEL_STYLES ? o.style : 'classic'
  // The other designs size their own text from the label size and cut long lines short, so only Classic can be "tight".
  const fit = style === 'classic' || style === 'boxed' ? labelFit(L, o.symbol, count + (qrSide && count > (o.showCode ? 1 : 0) ? 1 : 0)) : { pt: labelFit(L, o.symbol, 0).pt, fits: true }
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
/* Room below each line so g, p and y are not cut off, taken back by the margin so the label still fits. */
.head, .line { padding-bottom: 0.14em; margin-bottom: -0.14em; }
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
${styleCss(style, L)}
</style></head><body>${body}</body></html>`
}

// ---------- Label designs ----------

/** How a label is laid out. Every design works with a barcode or a QR code, any size and the lines chosen. */
export type LabelStyle = 'classic' | 'garment' | 'priceTag' | 'shelf' | 'boxed' | 'jewellery' | 'codeOnly' | 'food'

export const LABEL_STYLES: Record<LabelStyle, { name: string; hint: string }> = {
  classic: { name: 'Classic', hint: 'Code in the middle, the lines under it' },
  garment: { name: 'Garment tag', hint: 'Shop name on a black band, big price, code sideways, QR on the right' },
  priceTag: { name: 'Price tag', hint: 'Big price in the middle, small code' },
  shelf: { name: 'Shelf strip', hint: 'Name and code on the left, big price with MRP and "You save"' },
  boxed: { name: 'Boxed', hint: 'Classic inside a rounded border' },
  jewellery: { name: 'Jewellery tag', hint: 'Two flaps (code | details) with a tail between, for long thin tags' },
  codeOnly: { name: 'Code only', hint: 'Just the barcode or QR code and its number, for cartons and bins' },
  food: { name: 'Food packet', hint: 'Name, price and a packed / best-before box' }
}

const PRICE_FIELDS: LabelField[] = ['price']
const DATE_FIELDS: LabelField[] = ['mfg', 'exp']

/** The price for the big price designs: whole rupees without ".00" (₹1,230), paise kept when there are some. */
export function bigPrice(paise: number): string {
  const t = formatINR(paise)
  return t.endsWith('.00') ? t.slice(0, -3) : t
}

interface Parts {
  header: string
  /** Chosen lines with their field, without empty ones. */
  lines: { field: LabelField; text: string }[]
  symbol: string
  code: string
}

function parts(d: LabelData, o: LabelOptions, businessName: string): Parts {
  const lines = o.lines
    .slice(0, MAX_LABEL_LINES)
    .map((l) => ({ field: l.field, text: lineText(l, d, businessName) }))
    .filter((l) => l.text)
  return {
    header: lineText(o.header, d, businessName),
    lines,
    symbol: o.symbol === 'qr' ? qrSvg(d.code) : barcodeSvg(d.code),
    code: o.showCode ? esc(d.code) : ''
  }
}

const div = (cls: string, html: string) => (html ? `<div class="${cls}">${html}</div>` : '')
const textLines = (lines: Parts['lines'], firstBold = true) =>
  lines.map((l, i) => `<div class="ln${i === 0 && firstBold ? ' b' : ''}">${esc(l.text)}</div>`).join('')

function styledLabelHtml(style: LabelStyle, d: LabelData, o: LabelOptions, businessName: string, L: LayoutInfo): string {
  const p = parts(d, o, businessName)
  const qr = o.symbol === 'qr'
  const priceChosen = p.lines.some((l) => PRICE_FIELDS.includes(l.field))
  const others = p.lines.filter((l) => !PRICE_FIELDS.includes(l.field))
  switch (style) {
    case 'garment': {
      const price = priceChosen ? div('sg-price', esc(bigPrice(d.price))) : ''
      if (qr) {
        // As on printed garment tags: shop name on a band, the name lines across, then price | code | QR at the bottom.
        return `<div class="label sg qr">${div('sg-band', esc(p.header))}<div class="sg-lines">${textLines(others)}</div><div class="sg-body"><div class="sg-text">${price}</div>${div('sg-vcode', p.code)}<div class="sg-sym">${p.symbol}</div></div></div>`
      }
      return `<div class="label sg bar">${div('sg-band', esc(p.header))}<div class="sg-lines">${textLines(others)}</div><div class="sg-bars">${p.symbol}</div><div class="sg-foot">${price || '<span></span>'}${div('sg-code', p.code)}</div></div>`
    }
    case 'priceTag': {
      const [name, ...rest] = others
      const price = priceChosen ? div('sp-price', esc(bigPrice(d.price))) : ''
      const sym = qr
        ? `<div class="sp-qrrow"><div class="sp-qr">${p.symbol}</div>${div('sp-code', p.code)}</div>`
        : `<div class="sp-bars">${p.symbol}</div>${div('sp-code', p.code)}`
      return `<div class="label sp">${div('sp-head', esc(p.header))}${name ? div('ln b', esc(name.text)) : ''}${price}${textLines(rest.slice(0, 1), false)}${sym}</div>`
    }
    case 'shelf': {
      const named = others.filter((l) => l.field !== 'mrp' && l.field !== 'saving')
      const showDeal = d.mrp !== null && d.mrp > d.price
      const right = `<div class="ss-price">${esc(bigPrice(d.price))}</div>${
        showDeal ? `<div class="ss-mrp">MRP <s>${esc(bigPrice(d.mrp!))}</s></div><div class="ss-save">You save ${esc(bigPrice(d.mrp! - d.price))}</div>` : ''
      }`
      const sym = qr ? `<div class="ss-qr">${p.symbol}</div>` : `<div class="ss-bars">${p.symbol}</div>`
      return `<div class="label ss"><div class="ss-left">${div('ss-head', esc(p.header))}${textLines(named)}${sym}${div('ss-code', p.code)}</div><div class="ss-right">${right}</div></div>`
    }
    case 'boxed':
      return classicHtml(d, o, businessName, L).replace('class="label', 'class="label sb')
    case 'jewellery': {
      const sym = qr
        ? `<div class="sj-qr">${p.symbol}</div>${div('sj-vcode', p.code)}`
        : `<div class="sj-barcol"><div class="sj-bars">${p.symbol}</div>${div('sj-code', p.code)}</div>`
      return `<div class="label sj"><div class="sj-flap sj-sym">${sym}</div><div class="sj-tail"></div><div class="sj-flap sj-info">${div('sj-head', esc(p.header))}${textLines(p.lines)}</div></div>`
    }
    case 'codeOnly':
      return `<div class="label sc ${qr ? 'qr' : 'bar'}"><div class="sc-sym">${p.symbol}</div>${div('sc-code', p.code)}</div>`
    case 'food': {
      const text = others.filter((l) => !DATE_FIELDS.includes(l.field))
      const price = priceChosen ? div('sf-price', esc(formatINR(d.price))) : ''
      const mfg = d.extra?.mfg?.trim() ? monthText(d.extra.mfg) : ''
      const exp = d.extra?.exp?.trim() ? monthText(d.extra.exp) : ''
      const dates = mfg || exp
        ? `<div class="sf-dates">${mfg ? `<div><span>Packed</span><b>${esc(mfg)}</b></div>` : ''}${exp ? `<div><span>Best before</span><b>${esc(exp)}</b></div>` : ''}</div>`
        : ''
      if (qr) {
        return `<div class="label sf qr">${div('sf-head', esc(p.header))}<div class="sf-body"><div class="sf-text">${textLines(text)}${price}${dates}</div><div class="sf-side"><div class="sf-qr">${p.symbol}</div>${div('sf-code', p.code)}</div></div></div>`
      }
      return `<div class="label sf bar">${div('sf-head', esc(p.header))}${textLines(text)}${price}${dates}<div class="sf-bars">${p.symbol}</div>${div('sf-code', p.code)}</div>`
    }
    default:
      return classicHtml(d, o, businessName, L)
  }
}

/** Sizes for the designs, from the label size: text in mm so it scales with small and large labels alike. */
function styleCss(style: LabelStyle, L: LayoutInfo): string {
  const W = L.width
  const H = L.height
  const mm = (n: number) => `${Math.max(0, n).toFixed(2)}mm`
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
  const pad = clamp(H * 0.05, 0.8, 1.6)
  const base = `
.label.styled { display: flex; text-align: left; align-items: stretch; justify-content: flex-start; padding: ${mm(pad)}; line-height: 1.1; }
.label.styled .ln { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; padding-bottom: 0.14em; margin-bottom: -0.14em; }
.label.styled .ln.b { font-weight: 700; }
.label.styled svg { display: block; width: 100%; height: 100%; fill: #000; }
.vcode { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; font-family: Consolas, monospace; overflow: hidden; }`
  switch (style) {
    case 'garment': {
      const band = clamp(H * 0.17, 2.4, 6)
      const body = H - 2 * pad - band - 0.8
      const line = clamp(body * 0.13, 1.5, 3.2)
      // The QR code takes what the band and up to two name lines leave.
      const qr = clamp(Math.min(body - line * 2.4, W * 0.36), 6, 40)
      const price = clamp(Math.min(body * 0.34, W * 0.085), 2.2, 7.5)
      const vcode = clamp(Math.min(qr * 0.12, 2.4), 1.2, 2.4)
      return `${base}
.label.sg { flex-direction: column; gap: 0.6mm; }
.sg-band { align-self: flex-start; max-width: 100%; background: #000; color: #fff; font-weight: 700; font-size: ${mm(band * 0.62)}; height: ${mm(band)}; line-height: ${mm(band)}; padding: 0 1mm;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0.02em; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sg .ln { font-size: ${mm(line)}; }
.sg-body { flex: 1 1 auto; display: flex; gap: 0.8mm; min-height: 0; align-items: flex-end; }
.sg-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
.sg-lines { min-width: 0; display: flex; flex-direction: column; }
.sg-price { margin-top: auto; font-size: ${mm(price)}; font-weight: 700; white-space: nowrap; letter-spacing: 0.02em; }
.sg-vcode { font-size: ${mm(vcode)}; max-height: ${mm(qr)}; writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; font-family: Consolas, monospace; overflow: hidden; }
.sg-sym { width: ${mm(qr)}; height: ${mm(qr)}; flex: none; }
.sg.bar .sg-lines { min-width: 0; }
.sg-bars { flex: 1 1 auto; min-height: ${mm(Math.max(4, H * 0.24))}; max-height: ${mm(H * 0.34)}; padding: 0 ${mm(W * 0.04)}; }
.sg-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 1mm; }
.sg-foot .sg-price { margin-top: 0; }
.sg-code { font-family: Consolas, monospace; font-size: ${mm(clamp(H * 0.075, 1.3, 2.6))}; white-space: nowrap; overflow: hidden; }`
    }
    case 'priceTag': {
      const line = clamp(H * 0.09, 1.5, 3.4)
      return `${base}
.label.sp { flex-direction: column; align-items: center; text-align: center; justify-content: space-between; }
.sp-head { font-size: ${mm(line * 0.8)}; font-weight: 700; color: #222; white-space: nowrap; overflow: hidden; max-width: 100%; }
.sp .ln { font-size: ${mm(line)}; }
.sp-price { font-size: ${mm(clamp(Math.min(H * 0.27, W * 0.14), 3, 12))}; font-weight: 800; line-height: 1; white-space: nowrap; }
.sp-bars { width: 92%; height: ${mm(clamp(H * 0.2, 3.5, 12))}; flex: none; }
.sp-qrrow { display: flex; align-items: center; gap: 1mm; }
.sp-qr { width: ${mm(clamp(H * 0.32, 5, 20))}; height: ${mm(clamp(H * 0.32, 5, 20))}; }
.sp-code { font-family: Consolas, monospace; font-size: ${mm(clamp(H * 0.065, 1.2, 2.4))}; white-space: nowrap; }`
    }
    case 'shelf': {
      const line = clamp(H * 0.1, 1.5, 3.4)
      return `${base}
.label.ss { flex-direction: row; gap: 1mm; }
.ss-left { flex: 1 1 56%; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; }
.ss-head { font-size: ${mm(line * 0.75)}; font-weight: 700; color: #333; white-space: nowrap; overflow: hidden; }
.ss .ln { font-size: ${mm(line)}; }
.ss .ln.b { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ss-bars { height: ${mm(clamp(H * 0.3, 4, 14))}; flex: none; }
.ss-qr { width: ${mm(clamp(H * 0.38, 6, 22))}; height: ${mm(clamp(H * 0.38, 6, 22))}; }
.ss-code { font-family: Consolas, monospace; font-size: ${mm(clamp(H * 0.065, 1.2, 2.2))}; white-space: nowrap; overflow: hidden; }
.ss-right { flex: 0 0 42%; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; text-align: right; border-left: 0.3mm solid #000; padding-left: 1mm; }
.ss-price { font-size: ${mm(clamp(Math.min(H * 0.3, W * 0.12), 3, 12))}; font-weight: 800; line-height: 1; white-space: nowrap; }
.ss-mrp { font-size: ${mm(line * 0.9)}; margin-top: 0.6mm; white-space: nowrap; }
.ss-save { margin-top: 0.6mm; background: #000; color: #fff; font-weight: 700; font-size: ${mm(line * 0.85)}; padding: 0.2mm 0.8mm; border-radius: 0.6mm; white-space: nowrap;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }`
    }
    case 'boxed':
      return `.label.sb { border: 0.35mm solid #000; border-radius: 1.6mm; padding: ${mm(pad + 0.4)}; }
.label.sb .head { border: 0.25mm solid #000; border-radius: 0.9mm; padding: 0 1mm 0.14em; }`
    case 'jewellery': {
      const tail = W >= H * 2.4 ? W * 0.2 : 0
      const flap = (W - tail - 2 * pad) / 2
      const inner = H - 2 * pad
      const qr = clamp(Math.min(inner, flap * 0.62), 4, 30)
      const line = clamp(inner * 0.2, 1.3, 3.2)
      return `${base}
.label.sj { flex-direction: row; gap: 0; }
.sj-flap { width: ${mm(flap)}; flex: none; display: flex; min-width: 0; }
.sj-sym { align-items: center; justify-content: center; gap: 0.6mm; }
.sj-tail { width: ${mm(tail)}; flex: none; ${tail ? 'border-left: 0.2mm dashed #999; border-right: 0.2mm dashed #999;' : ''} }
.sj-qr { width: ${mm(qr)}; height: ${mm(qr)}; flex: none; }
.sj-vcode { font-size: ${mm(clamp(qr * 0.13, 1, 2.2))}; max-height: ${mm(qr)}; writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; font-family: Consolas, monospace; overflow: hidden; }
.sj-barcol { width: 100%; display: flex; flex-direction: column; align-items: center; }
.sj-bars { width: 100%; height: ${mm(inner * 0.62)}; }
.sj-code { font-family: Consolas, monospace; font-size: ${mm(clamp(inner * 0.18, 1, 2.2))}; white-space: nowrap; overflow: hidden; max-width: 100%; }
.sj-info { flex-direction: column; justify-content: center; padding-left: 1mm; }
.sj-head { font-size: ${mm(line * 0.8)}; font-weight: 700; white-space: nowrap; overflow: hidden; }
.sj .ln { font-size: ${mm(line)}; }`
    }
    case 'codeOnly': {
      const codeFont = clamp(H * 0.1, 1.4, 3.6)
      const sym = H - 2 * pad - codeFont * 1.4
      return `${base}
.label.sc { flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.sc.bar .sc-sym { width: 94%; height: ${mm(sym)}; }
.sc.qr .sc-sym { width: ${mm(Math.min(sym, W - 2 * pad))}; height: ${mm(Math.min(sym, W - 2 * pad))}; }
.sc-code { font-family: Consolas, monospace; font-size: ${mm(codeFont)}; white-space: nowrap; letter-spacing: 0.04em; }`
    }
    case 'food': {
      const line = clamp(H * 0.085, 1.4, 3.2)
      const qr = clamp(Math.min((H - 2 * pad) * 0.62, W * 0.34), 6, 30)
      return `${base}
.label.sf { flex-direction: column; gap: 0.4mm; }
.sf-head { font-size: ${mm(line * 0.85)}; font-weight: 700; border-bottom: 0.3mm solid #000; padding-bottom: 0.3mm; white-space: nowrap; overflow: hidden; }
.sf .ln { font-size: ${mm(line)}; }
.sf-price { font-size: ${mm(line * 1.35)}; font-weight: 800; }
.sf-dates { display: flex; border: 0.25mm solid #000; border-radius: 0.6mm; margin-top: 0.4mm; }
.sf-dates > div { flex: 1; padding: 0.2mm 0.6mm; display: flex; flex-direction: column; line-height: 1.05; min-width: 0; }
.sf-dates > div + div { border-left: 0.25mm solid #000; }
.sf-dates span { font-size: ${mm(line * 0.65)}; color: #333; }
.sf-dates b { font-size: ${mm(line * 0.9)}; white-space: nowrap; }
.sf-bars { flex: 1 1 auto; min-height: ${mm(Math.max(4, H * 0.2))}; max-height: ${mm(H * 0.3)}; padding: 0 3%; }
.sf-code { font-family: Consolas, monospace; font-size: ${mm(clamp(H * 0.06, 1.2, 2.2))}; text-align: center; white-space: nowrap; }
.sf-body { flex: 1 1 auto; display: flex; gap: 1mm; min-height: 0; }
.sf-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.sf-side { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.sf-qr { width: ${mm(qr)}; height: ${mm(qr)}; }`
    }
    default:
      return ''
  }
}
