import Database from 'better-sqlite3'
import { migrations as defaultMigrations, type Migration } from './migrations'

export type DB = Database.Database

/** Open a business database file (or ':memory:') with safe defaults and run migrations. */
export function openDatabase(path: string, migrations: Migration[] = defaultMigrations): DB {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  if (path !== ':memory:') db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  migrate(db, migrations)
  return db
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
