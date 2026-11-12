// Which business is open right now, and opening / creating / switching between them.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { BackupFile, BackupInfo } from '@shared/data'
import { todayLocal } from '@shared/fy'
import type { Business, CreateBusinessInput } from '@shared/models'
import { openDatabase, type DB } from './db/connection'
import { migrations } from './db/migrations'
import { BusinessRegistry } from './registry'
import { getBusiness, setupBusiness } from './services/business'
import { UserError, uuid } from './util'

export class Session {
  readonly registry: BusinessRegistry
  private db: DB | null = null
  private currentId: string | null = null
  private readonly baseDir: string
  /** How many daily automatic backups to keep per business. */
  static readonly KEEP_AUTO = 7

  constructor(baseDir: string) {
    this.baseDir = baseDir
    this.registry = new BusinessRegistry(baseDir)
  }

  get isOpen(): boolean {
    return this.db !== null
  }

  get dbPath(): string | null {
    return this.currentId ? this.registry.pathFor(this.currentId) : null
  }

  /** The open database; throws if no business is open. */
  requireDb(): DB {
    if (!this.db) throw new UserError('No business is open')
    return this.db
  }

  current(): Business | null {
    return this.db ? getBusiness(this.db) : null
  }

  /** Reopen the business used last time, if its file still exists. */
  restoreLast(): Business | null {
    const id = this.registry.lastOpenedId
    if (!id || !this.registry.get(id) || !existsSync(this.registry.pathFor(id))) return null
    return this.open(id)
  }

  open(id: string): Business {
    if (!this.registry.get(id)) throw new UserError('That business was not found')
    const path = this.registry.pathFor(id)
    if (!existsSync(path)) throw new UserError('The data file for this business is missing')
    const db = openDatabase(path)
    this.close()
    this.db = db
    this.currentId = id
    this.registry.markOpened(id)
    return getBusiness(db)
  }

  create(input: CreateBusinessInput): Business {
    const id = uuid()
    const path = this.registry.pathFor(id)
    const db = openDatabase(path)
    let business: Business
    try {
      business = setupBusiness(db, id, input)
    } catch (err) {
      db.close()
      for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
      throw err
    }
    db.close()
    this.registry.add(id, business.name)
    return this.open(id)
  }

  close(): void {
    this.db?.close()
    this.db = null
    this.currentId = null
  }

  /** Keep the registry name in step after the profile is edited. */
  syncName(business: Business): void {
    this.registry.rename(business.id, business.name)
  }

  // ---------- Backups ----------

  /** Folder holding this business's automatic and safety backups. */
  backupDir(id = this.currentId): string {
    if (!id) throw new UserError('No business is open')
    return join(this.baseDir, 'backups', id)
  }

  /** Copy the open business to a file, safely even while it is in use. */
  async backupTo(path: string): Promise<string> {
    const db = this.requireDb()
    if (resolve(path) === resolve(this.dbPath!)) throw new UserError('Choose a different file to save the backup to')
    rmSync(path, { force: true })
    await db.backup(path)
    // A plain single file (no -wal/-shm companions), so it can be copied or emailed as is.
    const copy = new Database(path)
    try {
      copy.pragma('journal_mode = DELETE')
    } finally {
      copy.close()
    }
    return path
  }

  /** Take today's automatic backup if there is none yet, keeping the newest few. Returns its path, or null. */
  async autoBackup(today = todayLocal()): Promise<string | null> {
    if (!this.db) return null
    const dir = this.backupDir()
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `auto-${today}.db`)
    if (existsSync(path)) return null
    await this.backupTo(path)
    const autos = readdirSync(dir).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse()
    for (const old of autos.slice(Session.KEEP_AUTO)) rmSync(join(dir, old), { force: true })
    return path
  }

  listBackups(): BackupFile[] {
    const dir = this.backupDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.db') && !f.startsWith('.'))
      .map((f) => {
        const st = statSync(join(dir, f))
        const kind: BackupFile['kind'] = f.startsWith('auto-') ? 'auto' : f.startsWith('before-restore-') ? 'safety' : 'manual'
        return { path: join(dir, f), name: f, kind, size: st.size, modifiedAt: st.mtime.toISOString() }
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  }

  /** Read what a backup holds without changing it. Throws a friendly error if it is not a backup of this app. */
  inspectBackup(path: string): BackupInfo {
    if (!existsSync(path)) throw new UserError('That file was not found')
    let db: DB
    try {
      db = new Database(path, { readonly: true, fileMustExist: true })
    } catch {
      throw new UserError('That file is not a backup from this app')
    }
    try {
      const version = db.pragma('user_version', { simple: true }) as number
      const hasBusiness = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'business'`).get()
      if (!hasBusiness || version < 1) throw new UserError('That file is not a backup from this app')
      if (version > migrations.length) throw new UserError('That backup was made by a newer version of the app. Update the app first.')
      const biz = db.prepare('SELECT id, name FROM business LIMIT 1').get() as { id: string; name: string } | undefined
      if (!biz) throw new UserError('That backup has no business in it')
      const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
      const last = db.prepare('SELECT MAX(updated_at) AS at FROM document').get() as { at: string | null }
      return {
        path,
        businessName: biz.name,
        sameBusiness: biz.id === this.currentId,
        schemaVersion: version,
        invoices: count(`SELECT COUNT(*) AS n FROM document WHERE doc_type = 'SALE_INVOICE' AND deleted_at IS NULL`),
        parties: count('SELECT COUNT(*) AS n FROM party WHERE deleted_at IS NULL'),
        lastEntry: last.at ?? '',
        modifiedAt: statSync(path).mtime.toISOString()
      }
    } catch (err) {
      if (err instanceof UserError) throw err
      throw new UserError('That file is not a backup from this app')
    } finally {
      db.close()
    }
  }

  /**
   * Replace the open business's data with a backup. A safety copy of the current data is kept first,
   * so a wrong restore can itself be undone.
   */
  async restore(path: string): Promise<{ business: Business; safetyCopy: string }> {
    const id = this.currentId
    if (!id) throw new UserError('No business is open')
    const target = this.registry.pathFor(id)
    if (resolve(path) === resolve(target)) throw new UserError('That is the file already in use')
    this.inspectBackup(path)
    const dir = this.backupDir(id)
    mkdirSync(dir, { recursive: true })
    // Copy the chosen file aside first: it may itself be a backup in this folder.
    const source = join(dir, `.restoring-${Date.now()}-${basename(path)}`)
    copyFileSync(path, source)
    let safetyCopy: string
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      let name = `before-restore-${stamp}.db`
      for (let n = 2; existsSync(join(dir, name)); n++) name = `before-restore-${stamp}-${n}.db`
      safetyCopy = await this.backupTo(join(dir, name))
    } catch (err) {
      rmSync(source, { force: true })
      throw err
    }
    this.close()
    try {
      for (const suffix of ['-wal', '-shm']) rmSync(target + suffix, { force: true })
      copyFileSync(source, target)
    } finally {
      rmSync(source, { force: true })
    }
    this.open(id)
    // The file may come from another computer or business; it now lives under this business's id.
    this.requireDb().prepare('UPDATE business SET id = ? WHERE id <> ?').run(id, id)
    return { business: this.current()!, safetyCopy }
  }

  /** Open a backup as a separate business (e.g. moving to a new computer) without touching existing ones. */
  importBackup(path: string): Business {
    const info = this.inspectBackup(path)
    const id = uuid()
    const target = this.registry.pathFor(id)
    copyFileSync(path, target)
    try {
      const db = openDatabase(target)
      db.prepare('UPDATE business SET id = ?').run(id)
      db.close()
    } catch (err) {
      for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true })
      throw err
    }
    this.registry.add(id, info.businessName)
    return this.open(id)
  }
}
