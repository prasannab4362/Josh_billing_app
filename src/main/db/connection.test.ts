import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listTables, migrate, openDatabase, schemaVersion, type DB } from './connection'
import { migrations } from './migrations'

const now = '2025-04-01T00:00:00Z'
let db: DB

afterEach(() => db?.close())

describe('migrations', () => {
  it('creates the full schema on a new database', () => {
    db = openDatabase(':memory:')
    expect(schemaVersion(db)).toBe(migrations.length)
    expect(listTables(db)).toEqual(
      expect.arrayContaining([
        'business', 'bank_account', 'setting', 'number_series', 'tax_rate',
        'party', 'party_group', 'unit', 'item', 'item_category', 'party_price',
        'document', 'document_line', 'document_charge', 'document_link',
        'payment', 'payment_allocation', 'cheque', 'account_transfer',
        'ledger_entry', 'stock_movement', 'stock_adjustment', 'item_stock',
        'app_user', 'audit_log'
      ])
    )
  })

  it('is idempotent when run again', () => {
    db = openDatabase(':memory:')
    expect(migrate(db)).toEqual([])
  })

  it('only applies newer migrations', () => {
    db = openDatabase(':memory:', migrations)
    const next = [...migrations, { version: migrations.length + 1, name: 'test', sql: 'CREATE TABLE extra (id TEXT);' }]
    expect(migrate(db, next)).toEqual([migrations.length + 1])
    expect(listTables(db)).toContain('extra')
  })

  it('rolls back a failing migration and keeps the old version', () => {
    db = openDatabase(':memory:')
    const bad = [...migrations, { version: migrations.length + 1, name: 'bad', sql: 'CREATE TABLE ok (id TEXT); NOT SQL;' }]
    expect(() => migrate(db, bad)).toThrow()
    expect(schemaVersion(db)).toBe(migrations.length)
    expect(listTables(db)).not.toContain('ok')
  })

  it('refuses a database from a newer app version', () => {
    db = openDatabase(':memory:')
    db.pragma(`user_version = ${migrations.length + 5}`)
    expect(() => migrate(db)).toThrow(/newer than this app/)
  })

  it('persists to a file and reopens at the same version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-'))
    const file = join(dir, 'test.db')
    try {
      db = openDatabase(file)
      db.close()
      db = openDatabase(file)
      expect(schemaVersion(db)).toBe(migrations.length)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('schema rules', () => {
  it('enforces foreign keys', () => {
    db = openDatabase(':memory:')
    expect(() =>
      db
        .prepare(`INSERT INTO document (id, doc_type, date, party_id, created_at, updated_at) VALUES ('d1','SALE_INVOICE','2025-04-01','missing',?,?)`)
        .run(now, now)
    ).toThrow(/FOREIGN KEY/)
  })

  it('rejects unknown document types', () => {
    db = openDatabase(':memory:')
    expect(() =>
      db.prepare(`INSERT INTO document (id, doc_type, date, created_at, updated_at) VALUES ('d1','BOGUS','2025-04-01',?,?)`).run(now, now)
    ).toThrow(/CHECK/)
  })

  it('keeps sale invoice numbers unique but allows repeated supplier bill numbers', () => {
    db = openDatabase(':memory:')
    const ins = db.prepare(`INSERT INTO document (id, doc_type, number, date, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    ins.run('a', 'SALE_INVOICE', 'INV-1', '2025-04-01', now, now)
    expect(() => ins.run('b', 'SALE_INVOICE', 'INV-1', '2025-04-02', now, now)).toThrow(/UNIQUE/)
    ins.run('c', 'PURCHASE_BILL', '101', '2025-04-01', now, now)
    expect(() => ins.run('d', 'PURCHASE_BILL', '101', '2025-04-02', now, now)).not.toThrow()
  })

  it('rejects negative ledger amounts and non-positive payments', () => {
    db = openDatabase(':memory:')
    expect(() =>
      db
        .prepare(`INSERT INTO ledger_entry (id, date, source_type, source_id, account, debit, created_at) VALUES ('l1','2025-04-01','opening','x','sales',-1,?)`)
        .run(now)
    ).toThrow(/CHECK/)
    db.prepare(`INSERT INTO bank_account (id, kind, name, created_at, updated_at) VALUES ('cash','cash','Cash',?,?)`).run(now, now)
    expect(() =>
      db
        .prepare(`INSERT INTO payment (id, direction, date, amount, account_id, mode, created_at, updated_at) VALUES ('p1','in','2025-04-01',0,'cash','cash',?,?)`)
        .run(now, now)
    ).toThrow(/CHECK/)
  })

  it('removes lines when a document row is deleted', () => {
    db = openDatabase(':memory:')
    db.prepare(`INSERT INTO document (id, doc_type, date, created_at, updated_at) VALUES ('d1','ESTIMATE','2025-04-01',?,?)`).run(now, now)
    db.prepare(`INSERT INTO document_line (id, document_id, line_no, qty, rate, taxable_amount, line_total) VALUES ('l1','d1',1,1000,100,100,100)`).run()
    db.prepare(`DELETE FROM document WHERE id = 'd1'`).run()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM document_line`).get()).toEqual({ n: 0 })
  })
})
