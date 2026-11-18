import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { unzip, writeXlsx, readXlsx } from './xlsx'

/** A ZIP with one deflated file, built by hand. */
function deflatedZip(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content)
  const n = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt16LE(n.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt16LE(n.length, 28)
  central.writeUInt32LE(0, 42)
  const cdStart = 30 + n.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(46 + n.length, 12)
  end.writeUInt32LE(cdStart, 16)
  return Buffer.concat([local, n, data, central, n, end])
}

describe('zip reading', () => {
  it('reads a normal deflated part and a workbook made by the app', () => {
    expect(unzip(deflatedZip('a.txt', Buffer.from('hello'))).get('a.txt')?.toString()).toBe('hello')
    const book = writeXlsx([{ name: 'Items', rows: [['Name'], ['Kurti']] }] as never)
    expect(readXlsx(book).length).toBeGreaterThan(0)
  })

  it('refuses a small file that unpacks to more than 200 MB (a "zip bomb")', () => {
    const bomb = deflatedZip('xl/worksheets/sheet1.xml', Buffer.alloc(210 * 1024 * 1024))
    expect(bomb.length).toBeLessThan(1024 * 1024)
    expect(() => unzip(bomb)).toThrow(/too large when unpacked/)
  })
})
