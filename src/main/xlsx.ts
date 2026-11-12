// Reading and writing simple Excel (.xlsx) workbooks and CSV files: one sheet of text and number
// cells, which is all the import templates need. An .xlsx file is a ZIP of XML parts.
import { inflateRawSync } from 'node:zlib'

export type Cell = string | number | boolean | null
export type Row = Cell[]

// ---------- ZIP ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** The files in a ZIP archive, by path. */
export function unzip(zip: Buffer): Map<string, Buffer> {
  // End of central directory: signature 0x06054b50, within the last 64 KB.
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file')
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip file')
    const method = zip.readUInt16LE(p + 10)
    const compSize = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    p += 46 + nameLen + extraLen + commentLen
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('damaged zip file')
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + compSize)
    if (method === 0) out.set(name, Buffer.from(data))
    else if (method === 8) out.set(name, inflateRawSync(data))
    else throw new Error(`unsupported zip compression ${method}`)
  }
  return out
}

/** A ZIP archive of the given files, stored uncompressed. */
export function zip(files: [string, Buffer][]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6) // UTF-8 names
    head.writeUInt16LE(0, 8)
    head.writeUInt32LE(0x00210000, 10) // 1980-01-01 00:00
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBuf.length, 26)
    locals.push(head, nameBuf, data)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt32LE(0x00210000, 12)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(data.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt32LE(offset, 42)
    centrals.push(cen, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const central = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}

// ---------- XML bits ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()]
  )
const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Characters XML 1.0 does not allow.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
/** Text of all <t> elements inside a fragment (rich text runs are joined). */
const textOf = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => unescape(m[1])).join('')

/** Column letters → 0-based index: A → 0, Z → 25, AA → 26. */
export function columnIndex(ref: string): number {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
export function columnName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

// ---------- Reading ----------

/** The rows of the first worksheet. Empty cells are null; trailing empty rows are dropped. */
export function readXlsx(file: Buffer): Row[] {
  let parts: Map<string, Buffer>
  try {
    parts = unzip(file)
  } catch {
    throw new Error('This is not an Excel (.xlsx) file')
  }
  const part = (p: string) => parts.get(p)?.toString('utf8')
  const workbook = part('xl/workbook.xml')
  if (!workbook) throw new Error('This is not an Excel (.xlsx) file')
  // First sheet → its file, through the workbook relationships.
  const firstSheet = /<(?:\w+:)?sheet\b[^>]*>/.exec(workbook)?.[0] ?? ''
  const rid = attr(firstSheet, 'r:id') ?? attr(firstSheet, 'id')
  const rels = part('xl/_rels/workbook.xml.rels') ?? ''
  let target = 'worksheets/sheet1.xml'
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) if (attr(m[0], 'Id') === rid) target = attr(m[0], 'Target') ?? target
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  const sheet = part(sheetPath)
  if (!sheet) throw new Error('The workbook has no sheet')

  const shared = [...(part('xl/sharedStrings.xml') ?? '').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1]))
  const rows: Row[] = []
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const r = attr(rm[1], 'r')
    const rowIndex = r ? Number(r) - 1 : rows.length
    const row: Row = []
    let col = 0
    for (const cm of rm[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = attr(cm[1], 'r')
      if (ref) col = columnIndex(ref)
      const type = attr(cm[1], 't') ?? 'n'
      const inner = cm[2] ?? ''
      const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1]
      let value: Cell = null
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = textOf(inner)
      else if (type === 'str' || type === 'e') value = v !== undefined ? unescape(v) : null
      else if (type === 'b') value = v === '1'
      else if (v !== undefined && v !== '') value = Number(v)
      row[col] = value
      col++
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null
    rows[rowIndex] = row
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
  while (rows.length && rows[rows.length - 1].every((c) => c === null || c === '')) rows.pop()
  return rows
}

/** CSV (comma, semicolon or tab separated; quotes as Excel writes them). */
export function readCsv(text: string): Row[] {
  const t = text.replace(/^﻿/, '')
  const firstLine = t.split(/\r?\n/, 1)[0]
  const sep = [',', ';', '\t'].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: Row[] = []
  let row: Row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') (cell += '"'), i++
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) row.push(cell), (cell = '')
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row)
  while (rows.length && rows[rows.length - 1].every((c) => c === null || c === '')) rows.pop()
  return rows.map((r) => r.map((c) => (c === '' ? null : c)))
}

/** Rows of a spreadsheet file, by its name: .xlsx or .csv. Old .xls files are refused with a hint. */
export function readSpreadsheet(name: string, data: Buffer): Row[] {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'csv' || ext === 'txt') return readCsv(data.toString('utf8'))
  if (ext === 'xls') throw new Error('Old .xls files cannot be read. In Excel, use File › Save As › Excel Workbook (.xlsx), then import that file.')
  return readXlsx(data)
}

// ---------- Writing ----------

export interface SheetSpec {
  name: string
  rows: Row[]
  /** Column widths in characters. */
  widths?: number[]
  /** Bold the first row and freeze it. */
  header?: boolean
}

/** A workbook with one sheet per spec. Strings are written inline, so no shared-string table is needed. */
export function writeXlsx(sheets: SheetSpec[]): Buffer {
  const files: [string, string][] = []
  files.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`])
  files.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`])
  files.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${escape(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`])
  files.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`])
  files.push(['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`])
  sheets.forEach((s, i) => {
    const rows = s.rows
      .map((row, r) => {
        const cells = row
          .map((v, c) => {
            if (v === null || v === undefined || v === '') return ''
            const ref = `${columnName(c)}${r + 1}`
            const style = s.header && r === 0 ? ' s="1"' : ''
            if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`
            if (typeof v === 'boolean') return `<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`
            return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escape(String(v))}</t></is></c>`
          })
          .join('')
        return `<row r="${r + 1}">${cells}</row>`
      })
      .join('')
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
    const freeze = s.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ''
    files.push([`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${rows}</sheetData></worksheet>`])
  })
  return zip(files.map(([n, x]) => [n, Buffer.from(x, 'utf8')]))
}
