// A small local error log for troubleshooting (never sent anywhere). Kept under 1 MB: the old file is
// renamed to .old when it grows past that.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { app } from 'electron'

const MAX = 1024 * 1024

function file(): string {
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'errors.log')
}

/** Record an unexpected error; returns a short reference to quote when asking for help. */
export function logError(where: string, err: unknown): string {
  const ref = randomBytes(3).toString('hex')
  const e = err as Error
  const text = `${new Date().toISOString()} [${ref}] ${where}: ${e?.stack ?? String(err)}\n`
  try {
    const f = file()
    if (existsSync(f) && statSync(f).size > MAX) renameSync(f, f + '.old')
    appendFileSync(f, text, 'utf8')
  } catch {
    // Logging must never break the app.
  }
  try {
    console.error(text)
  } catch {
    // The terminal that launched the app may already be closed.
  }
  return ref
}
