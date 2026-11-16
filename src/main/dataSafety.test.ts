// Data safety: damage is noticed, backups are checked before they are kept, and a second copy is made.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { safeImage } from '@shared/safeHtml'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { databaseProblems, openDatabase } from './db/connection'
import { createParty } from './services/parties'
import { Session } from './session'

const profile = (name: string) => ({ ...EMPTY_TEST_PROFILE, name, stateCode: '27' })
let dir: string
let outside: string
let session: Session

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'billing-safety-'))
  outside = mkdtempSync(join(tmpdir(), 'billing-mirror-'))
  session = new Session(dir)
})
afterEach(() => {
  session.close()
  rmSync(dir, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const addParty = (name: string) =>
  createParty(session.requireDb(), {
    name, kind: 'customer', phone: '', email: '', gstin: '', stateCode: '27', billingAddress: '', shippingAddress: '',
    openingBalance: 0, openingDate: '', creditLimit: null, paymentTermDays: null, group: ''
  })

describe('database health', () => {
  it('writes are durable and a healthy file reports no problems', () => {
    const b = session.create({ profile: profile('Shop'), preferences: {} })
    const db = session.requireDb()
    expect(db.pragma('synchronous', { simple: true })).toBe(2) // FULL
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(databaseProblems(db)).toEqual([])
    expect(b.id).toBeTruthy()
  })

  it('refuses to open a damaged file and points to the newest backup', async () => {
    const b = session.create({ profile: profile('Shop'), preferences: {} })
    for (let i = 0; i < 40; i++) addParty(`Party ${i}`)
    await session.autoBackup('2026-11-16')
    const file = session.dbPath!
    session.close()
    // Overwrite the middle of the file with junk, as a failing disk would.
    const bytes = readFileSync(file)
    for (let i = 4096; i < Math.min(bytes.length, 4096 * 4); i++) bytes[i] = 0xab
    writeFileSync(file, bytes)
    for (const s of ['-wal', '-shm']) rmSync(file + s, { force: true })
    let message = ''
    try {
      session.open(b.id)
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/damaged/)
    expect(message).toMatch(/auto-2026-11-16\.db/)
    expect(session.isOpen).toBe(false)
  })

  it('finds rows that point to something missing', () => {
    const db = openDatabase(':memory:')
    db.exec('PRAGMA foreign_keys = OFF')
    db.prepare('INSERT INTO item_category (id, name) VALUES (?, ?)').run('c1', 'Cat')
    db.prepare(
      `INSERT INTO item (id, name, kind, category_id, created_at, updated_at) VALUES ('i1', 'X', 'goods', 'gone', '2026-01-01', '2026-01-01')`
    ).run()
    expect(databaseProblems(db).join()).toMatch(/point to something that no longer exists/)
    db.close()
  })
})

describe('verified backups', () => {
  it('keeps a backup only once it checks out, and leaves no half-written file', async () => {
    session.create({ profile: profile('Shop'), preferences: {} })
    addParty('Ravi')
    const target = join(outside, 'manual.db')
    await session.backupTo(target)
    expect(readdirSync(outside)).toEqual(['manual.db'])
    const copy = new Database(target, { readonly: true })
    expect(databaseProblems(copy)).toEqual([])
    expect((copy.prepare('SELECT COUNT(*) AS n FROM party').get() as { n: number }).n).toBe(1)
    copy.close()
  })

  it('refreshes today’s copy when it is old, and keeps it when it is fresh', async () => {
    session.create({ profile: profile('Shop'), preferences: {} })
    const first = await session.autoBackup('2026-11-16')
    expect(first).toBeTruthy()
    expect(await session.autoBackup('2026-11-16')).toBeNull() // fresh: left alone
    const old = new Date(Date.now() - 60 * 60_000)
    const { utimesSync } = await import('node:fs')
    utimesSync(first!, old, old)
    addParty('Later party')
    expect(await session.autoBackup('2026-11-16')).toBe(first) // an hour old: refreshed
    const copy = new Database(first!, { readonly: true })
    expect((copy.prepare('SELECT COUNT(*) AS n FROM party').get() as { n: number }).n).toBe(1)
    copy.close()
  })

  it('will not restore a damaged backup, and changes nothing when it refuses', async () => {
    session.create({ profile: profile('Shop'), preferences: {} })
    addParty('Keep me')
    const good = join(outside, 'good.db')
    await session.backupTo(good)
    const bad = join(outside, 'bad.db')
    copyFileSync(good, bad)
    const bytes = readFileSync(bad)
    for (let i = 4096; i < Math.min(bytes.length, 4096 * 6); i++) bytes[i] = 0x00
    writeFileSync(bad, bytes)
    await expect(session.restore(bad)).rejects.toThrow()
    expect((session.requireDb().prepare('SELECT COUNT(*) AS n FROM party').get() as { n: number }).n).toBe(1)
    const folder = session.backupDir()
    expect(existsSync(folder) ? readdirSync(folder).filter((f) => f.startsWith('.restoring')) : []).toEqual([])
  })
})

describe('second backup place', () => {
  it('copies every backup to the chosen folder, keeps 7, and says so when the drive is gone', async () => {
    session.create({ profile: profile('Shop A'), preferences: {} })
    expect(session.mirrorDir).toBeNull()
    expect(await session.mirrorLatest()).toBeNull()
    expect(() => session.setMirrorDir(join(dir, 'inside'))).toThrow(/not found/)
    mkdirSync(join(dir, 'inside'))
    expect(() => session.setMirrorDir(join(dir, 'inside'))).toThrow(/outside/)
    session.setMirrorDir(outside)
    expect(session.mirrorDir).toBe(outside)
    // A fresh session (a restart) still knows it.
    expect(new Session(dir).mirrorDir).toBe(outside)

    addParty('Ravi')
    await session.autoBackup('2026-11-16')
    const folder = readdirSync(outside).find((f) => f.startsWith('Shop A'))!
    const files = readdirSync(join(outside, folder))
    expect(files).toHaveLength(1)
    const copy = new Database(join(outside, folder, files[0]), { readonly: true })
    expect((copy.prepare('SELECT COUNT(*) AS n FROM party').get() as { n: number }).n).toBe(1)
    copy.close()

    // Old copies beyond the 7 newest are removed.
    for (let d = 1; d <= 9; d++) writeFileSync(join(outside, folder, `backup-2026-10-0${d}.db`), 'x')
    await session.mirrorLatest()
    expect(readdirSync(join(outside, folder)).filter((f) => f.startsWith('backup-')).length).toBe(7)
    expect(existsSync(join(outside, folder, `backup-${new Date().toISOString().slice(0, 4)}-10-01.db`))).toBe(false)

    // The drive is unplugged: a clear message, and the local backup still works.
    rmSync(outside, { recursive: true, force: true })
    await expect(session.mirrorLatest()).rejects.toThrow(/not available/)
    expect(await session.autoBackup('2026-11-17')).toBeTruthy()
    session.setMirrorDir(null)
    expect(session.mirrorDir).toBeNull()
    expect(statSync(dir).isDirectory()).toBe(true)
  })
})

describe('pictures in printed pages', () => {
  it('lets through only plain base64 PNG, JPEG and WebP', () => {
    const ok = 'data:image/png;base64,iVBORw0KGgo='
    expect(safeImage(ok)).toBe(ok)
    expect(safeImage('data:image/jpeg;base64,/9j/4AAQ')).toBeTruthy()
    for (const bad of [
      'data:image/png;base64,AAAA" onerror="alert(1)',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'javascript:alert(1)',
      'https://evil.example/x.png',
      'data:image/png;base64,AAAA"><script>x</script>',
      '', null, undefined
    ]) expect(safeImage(bad as never), String(bad)).toBe('')
  })
})
