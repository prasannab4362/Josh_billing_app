import Database from 'better-sqlite3'
import { migrations as defaultMigrations, type Migration } from './migrations'

export type DB = Database.Database

/** Open a business database file (or ':memory:') with safe defaults and run migrations. */
export function openDatabase(path: string, migrations: Migration[] = defaultMigrations): DB {
  const db = new Database(path)
  try {
    db.pragma('foreign_keys = ON')
    // Never run SQL functions from inside the file's own schema (views, triggers): a file may come from elsewhere.
    db.pragma('trusted_schema = OFF')
    if (path !== ':memory:') {
      db.pragma('journal_mode = WAL')
      // FULL: a saved bill survives a power cut or a crash the moment the save returns.
      db.pragma('synchronous = FULL')
    }
    db.pragma('busy_timeout = 5000')
    migrate(db, migrations)
  } catch (err) {
    db.close() // never leave a half-opened file locked
    throw err
  }
  return db
}

/** True for the errors SQLite gives when a file is damaged or is not a database at all. */
export function isDamageError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? ''
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || /malformed|not a database|disk image/i.test((err as Error)?.message ?? '')
}

/**
 * Look for damage in a database file: broken pages, bad indexes, rows that point to nothing.
 * Returns what was found (empty = healthy). `quick` skips the slower index-by-index comparison.
 */
export function databaseProblems(db: DB, quick = false): string[] {
  const rows = db.pragma(quick ? 'quick_check' : 'integrity_check') as Record<string, string>[]
  const problems = rows.map((r) => Object.values(r)[0]).filter((v) => v !== 'ok')
  const orphans = db.pragma('foreign_key_check') as { table: string }[]
  if (orphans.length) problems.push(`${orphans.length} record(s) point to something that no longer exists (in ${[...new Set(orphans.map((o) => o.table))].join(', ')})`)
  return problems
}

export function schemaVersion(db: DB): number {
  return db.pragma('user_version', { simple: true }) as number
}

/** Apply every migration newer than the file's user_version, each in its own transaction. */
export function migrate(db: DB, migrations: Migration[] = defaultMigrations): number[] {
  const sorted = [...migrations].sort((a, b) => a.version - b.version)
  sorted.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migration versions must be 1..n without gaps (found ${m.version})`)
  })

  const current = schemaVersion(db)
  if (current > sorted.length) {
    throw new Error(`Database schema v${current} is newer than this app (v${sorted.length}). Update the app.`)
  }

  const applied: number[] = []
  for (const m of sorted.slice(current)) {
    db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    })()
    applied.push(m.version)
  }
  return applied
}

export function listTables(db: DB): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name)
}
