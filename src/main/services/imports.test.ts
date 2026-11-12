import { deflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { matchHeadings } from '@shared/imports'
import { gstinCheckChar } from '@shared/gstin'
import { openDatabase, type DB } from '../db/connection'
import { columnIndex, columnName, crc32, readCsv, readSpreadsheet, readXlsx, unzip, writeXlsx, zip } from '../xlsx'
import { setupBusiness } from './business'
import { bulkUpdateItems, commitImport, exportSheets, previewImport, templateSheets } from './imports'
import { createItem, listItems } from './items'
import { listParties } from './parties'
import { saveBill } from './invoices'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

let db: DB
beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '33' }, preferences: { pricesIncludeTax: false } }, '2026-04-01')
})
afterEach(() => db.close())

const H = ['Item name', 'Item code', 'Category', 'HSN/SAC', 'Unit', 'Sale price', 'Purchase price', 'MRP', 'GST %', 'Opening stock']

describe('spreadsheet files', () => {
  it('write a workbook and read it back, with text, numbers, symbols and blanks', () => {
    const file = writeXlsx([{ name: 'Items', header: true, rows: [['Name', 'Price', 'Note'], ['T-shirt <M> & "L"', 450.5, null], ['சட்டை ₹', 0, true]] }])
    expect(readXlsx(file)).toEqual([['Name', 'Price', 'Note'], ['T-shirt <M> & "L"', 450.5], ['சட்டை ₹', 0, true]])
    expect(unzip(file).get('xl/workbook.xml')!.toString()).toContain('<sheet name="Items"')
  })

  it('read compressed files with shared strings, as Excel saves them', () => {
    const parts = writeXlsxLikeExcel()
    const rows = readXlsx(parts)
    expect(rows).toEqual([['Item name', 'Sale price'], ['Rice', 62], [null, null, 'gap'], ['Dal & Co', 110.25]])
  })

  it('read CSV with quotes, commas and Excel’s semicolons', () => {
    expect(readCsv('﻿Name,Price\n"Rice, 5 kg",620\n"He said ""hi""",\n')).toEqual([['Name', 'Price'], ['Rice, 5 kg', '620'], ['He said "hi"', null]])
    expect(readCsv('Name;Price\r\nDal;110,5\r\n')).toEqual([['Name', 'Price'], ['Dal', '110,5']])
    expect(() => readSpreadsheet('old.xls', Buffer.from('x'))).toThrow(/Save As/)
    expect(() => readSpreadsheet('bad.xlsx', Buffer.from('not a zip'))).toThrow(/not an Excel/)
  })

  it('name columns like Excel', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA'])
    expect(['A1', 'Z9', 'AA3', 'AAA10'].map(columnIndex)).toEqual([0, 25, 26, 702])
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('understand other headings for the same column', () => {
    expect(matchHeadings('items', ['Product Name', 'SKU', 'Selling Price', 'GST Rate', 'Qty', 'Colour'])).toEqual(['name', 'code', 'salePrice', 'gst', 'openingQty', null])
  })
})

describe('importing items', () => {
  it('checks every row first, then creates the good ones with stock and tax', () => {
    const p = previewImport(db, 'items', [
      H,
      ['Cotton T-shirt', 'TS-1', 'Clothing', '6109', 'pcs', 450, 250, '₹499', 5, 40],
      ['Rice 5 kg', '', 'Grocery', 1006, 'Bag', '620.50', 540, null, '5%', 10],
      [null, 'X', null, null, null, 10, null, null, null, null],
      ['Bad HSN', '', '', '12', 'pcs', 10, 5, null, 18, 0],
      ['Strange unit', '', '', '', 'bucket', 10, 5, null, 0, 0],
      ['Odd tax', '', '', '', '', 10, 5, null, 7, 0],
      ['cotton t-shirt', 'TS-2', '', '', '', 1, 1, null, null, null],
      [],
    ], 'items.xlsx')
    expect(p.columns).toEqual(['Item name', 'Item code', 'Category', 'HSN/SAC', 'Unit', 'Sale price', 'Purchase price', 'MRP', 'GST %', 'Opening stock'])
    expect([p.creates, p.updates, p.errors]).toEqual([2, 0, 5])
    const err = (row: number) => p.rows.find((r) => r.row === row)!.errors.join(' | ')
    expect(err(4)).toMatch(/name is missing/)
    expect(err(5)).toMatch(/HSN/)
    expect(err(6)).toMatch(/No unit "bucket"/)
    expect(err(7)).toMatch(/No tax rate "7"/)
    expect(err(8)).toMatch(/already used by row 2/)
    expect(listItems(db)).toHaveLength(0) // nothing saved yet

    expect(commitImport(db, p.token)).toEqual({ created: 2, updated: 0, skipped: 5 })
    const [shirt, rice] = listItems(db)
    expect(shirt).toMatchObject({ name: 'Cotton T-shirt', code: 'TS-1', category: 'Clothing', hsnSac: '6109', salePrice: 45_000, mrp: 49_900, stockQty: 40_000, openingRate: 25_000, priceIncludesTax: false })
    expect(rice).toMatchObject({ hsnSac: '1006', salePrice: 62_050, baseUnitShort: 'bag', stockQty: 10_000 })
    expect(listTaxRates(db).find((t) => t.id === shirt.taxRateId)?.rateBp).toBe(500)
    expect(() => commitImport(db, p.token)).toThrow(/Check the file again/)
  })

  it('updates matching items, changing only the columns in the file', () => {
    const pcs = listUnits(db).find((u) => u.short === 'pcs')!.id
    createItem(db, {
      name: 'Pen', code: 'PEN', kind: 'goods', category: 'Stationery', hsnSac: '9608', taxRateId: null, priceIncludesTax: true, salePrice: 1_000,
      purchasePrice: 600, mrp: 1_200, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: pcs, altUnitId: null, altConversion: null,
      trackStock: true, openingQty: 100_000, openingRate: 600, openingDate: '2026-04-01', lowStockQty: null, description: 'Blue'
    })
    const p = previewImport(db, 'items', [['Item code', 'Item name', 'Sale price'], ['pen', 'Pen (blue)', 12], ['PEN-NEW', 'Pencil', 5]], 'x.csv')
    expect(p.rows[0]).toMatchObject({ action: 'update', changes: ['Name Pen → Pen (blue)', 'Sale price ₹10.00 → ₹12.00'] })
    expect(p.rows[0].name).toBe('Pen (blue)')
    commitImport(db, p.token)
    const pen = listItems(db).find((i) => i.code === 'PEN')!
    expect(pen).toMatchObject({ name: 'Pen (blue)', salePrice: 1_200, mrp: 1_200, category: 'Stationery', description: 'Blue', stockQty: 100_000 })
    // Blank cells keep the saved values.
    const blank = previewImport(db, 'items', [['Item name', 'Unit', 'MRP', 'Purchase price'], ['Pen (blue)', '', null, '']], 'x.csv')
    expect([blank.updates, blank.errors]).toEqual([0, 0])
    // The same file again changes nothing.
    const again = previewImport(db, 'items', [['Item code', 'Item name', 'Sale price'], ['PEN', 'Pen (blue)', 12]], 'x.csv')
    expect([again.creates, again.updates, again.errors]).toEqual([0, 0, 0])
  })

  it('refuses a file without the name column, and keeps the unit of items used in bills', () => {
    expect(() => previewImport(db, 'items', [['Code', 'Price'], ['A', 1]], 'x.csv')).toThrow(/needs a "Item name" column/)
    expect(() => previewImport(db, 'items', [], 'x.csv')).toThrow(/empty/)
    const units = listUnits(db)
    const item = createItem(db, {
      name: 'Soap', code: '', kind: 'goods', category: '', hsnSac: '', taxRateId: null, priceIncludesTax: false, salePrice: 4_000,
      purchasePrice: 3_000, mrp: null, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: units.find((u) => u.short === 'pcs')!.id,
      altUnitId: null, altConversion: null, trackStock: true, openingQty: 0, openingRate: 0, openingDate: '', lowStockQty: null
    })
    saveBill(db, 'SALE_INVOICE', null, {
      partyId: null, walkInName: '', number: '', date: '2026-11-12', dueDate: '', placeOfSupply: '', pricesIncludeTax: false,
      lines: [{ itemId: item.id, description: '', qty: 1000, unitId: null, unitFactor: 1000, rate: 4_000, discountPctBp: 0, discountAmount: 0, taxRateId: null, hsnSac: '' }],
      charges: [], received: { amount: 4_000, accountId: 'cash', mode: 'cash', reference: '' }, notes: '', terms: ''
    } as never)
    const p = previewImport(db, 'items', [['Item name', 'Unit'], ['Soap', 'box']], 'x.csv')
    expect(p.rows[0].errors.join()).toMatch(/unit cannot change/)
  })

  it('exports items in the template columns, and the export imports back unchanged', () => {
    const p = previewImport(db, 'items', [H, ['Cotton T-shirt', 'TS-1', 'Clothing', '6109', 'pcs', 450, 250, 499, 5, 40]], 'a.xlsx')
    commitImport(db, p.token)
    const [sheet, help] = exportSheets(db, 'items')
    expect(help.name).toBe('How to fill')
    const file = writeXlsx([sheet])
    const back = previewImport(db, 'items', readXlsx(file), 'export.xlsx')
    expect([back.creates, back.updates, back.errors]).toEqual([0, 0, 0])
    expect(templateSheets('items')[0].rows[0][0]).toBe('Item name')
    const tpl = previewImport(db, 'items', readXlsx(writeXlsx(templateSheets('items'))), 'template.xlsx')
    expect(tpl.errors).toBe(0)
  })
})

describe('importing parties', () => {
  it('reads balances, states from names, codes or GSTIN, and types', () => {
    const p = previewImport(db, 'parties', [
      ['Party name', 'Type', 'Phone', 'GSTIN', 'State', 'Opening balance', 'Balance type', 'Credit days'],
      ['Ravi Traders', 'Customer', 9876543210, '', 'Tamil Nadu', 1500, 'To receive', 30],
      ['Sri Mills', 'supplier', '', '', '33', 2200, 'to pay', ''],
      ['Kerala Co', 'Both', '', '32AAACK1234A1Z' + gstinCheckChar('32AAACK1234A1Z'), '', -300, '', null],
      ['Bad phone', '', '12345', '', '', 0, '', ''],
      ['Wrong side', '', '', '', '', 10, 'maybe', '']
    ], 'p.xlsx')
    expect([p.creates, p.errors]).toEqual([3, 2])
    expect(p.rows[3].errors.join()).toMatch(/10-digit/)
    expect(p.rows[4].errors.join()).toMatch(/To receive or To pay/)
    commitImport(db, p.token)
    const ps = Object.fromEntries(listParties(db).map((x) => [x.name, x]))
    expect(ps['Ravi Traders']).toMatchObject({ kind: 'customer', phone: '9876543210', stateCode: '33', openingBalance: 150_000, balance: 150_000, paymentTermDays: 30 })
    expect(ps['Sri Mills']).toMatchObject({ kind: 'supplier', openingBalance: -220_000 })
    expect(ps['Kerala Co']).toMatchObject({ kind: 'both', stateCode: '32', openingBalance: -30_000 })
    const again = previewImport(db, 'parties', readXlsx(writeXlsx([exportSheets(db, 'parties')[0]])), 'e.xlsx')
    expect([again.creates, again.updates, again.errors]).toEqual([0, 0, 0])
  })
})

describe('bulk update', () => {
  it('changes many items at once, all or nothing', () => {
    const p = previewImport(db, 'items', [H, ['A', '', '', '', '', 100, 50, null, 5, 0], ['B', '', '', '', '', 200, 90, null, 5, 0]], 'a.xlsx')
    commitImport(db, p.token)
    const [a, b] = listItems(db)
    const gst18 = listTaxRates(db).find((t) => t.name === 'GST 18%')!.id
    expect(bulkUpdateItems(db, [{ id: a.id, salePrice: 12_000, taxRateId: gst18 }, { id: b.id, taxRateId: gst18, hsnSac: '6109', category: 'New' }])).toBe(2)
    const [a2, b2] = listItems(db)
    expect(a2).toMatchObject({ salePrice: 12_000, taxRateId: gst18, purchasePrice: 5_000 })
    expect(b2).toMatchObject({ taxRateId: gst18, hsnSac: '6109', category: 'New', salePrice: 20_000 })
    expect(() => bulkUpdateItems(db, [{ id: a.id, salePrice: 1 }, { id: b.id, hsnSac: '12' }])).toThrow(/^B: HSN.*Nothing was saved/)
    expect(listItems(db)[0].salePrice).toBe(12_000)
    expect(() => bulkUpdateItems(db, [])).toThrow(/Nothing to save/)
  })
})

/** A workbook shaped like Excel's own: deflated parts, shared strings, a gap row and column. */
function writeXlsxLikeExcel(): Buffer {
  const deflated = (name: string, xml: string) => [name, Buffer.from(xml)] as [string, Buffer]
  const files = [
    deflated('[Content_Types].xml', '<Types/>'),
    deflated('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId7"/></sheets></workbook>'),
    deflated('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId7" Target="worksheets/data.xml"/></Relationships>'),
    deflated('xl/sharedStrings.xml', '<sst><si><t>Item name</t></si><si><t>Sale price</t></si><si><t>Rice</t></si><si><r><t>Dal </t></r><r><t>&amp; Co</t></r></si><si><t>gap</t></si></sst>'),
    deflated('xl/worksheets/data.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>62</v></c></row><row r="3"><c r="C3" t="s"><v>4</v></c></row><row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4" s="1"><v>110.25</v></c></row><row r="5"><c r="A5" s="2"/></row></sheetData></worksheet>')
  ]
  // Re-pack with deflate, as Excel does.
  const z = zip(files)
  const out: Buffer[] = []
  void out
  return repackDeflated(z)
}

function repackDeflated(stored: Buffer): Buffer {
  // Build a ZIP whose entries use method 8 (deflate).
  const entries = [...unzip(stored)]
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data] of entries) {
    const comp = deflateRawSync(data)
    const n = Buffer.from(name)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8)
    h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26)
    locals.push(h, n, comp)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10)
    c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42)
    centrals.push(c, n)
    offset += 30 + n.length + comp.length
  }
  const cen = Buffer.concat(centrals)
  const e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cen.length, 12); e.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cen, e])
}
