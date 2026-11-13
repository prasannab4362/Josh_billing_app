// Owner and staff logins for one business. Passwords are kept only as scrypt hashes (salted, deliberately slow);
// wrong tries lock the login for a while; the owner gets a one-time recovery code for a forgotten password.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
import {
  passwordProblem, usernameProblem, type AuthUser, type NewUserInput, type Role, type UserSummary, type UserUpdate
} from '@shared/auth'
import type { DB } from '../db/connection'
import { nowIso, UserError, uuid } from '../util'
import { audit } from './audit'

// scrypt cost: 2^15 × 8 × 1 needs ~32 MB and ~0.1 s per try, which makes guessing slow.
const N = 1 << 15
const R = 8
const P = 1
const KEYLEN = 32
const MAXMEM = 64 * 1024 * 1024

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(password: string, stored: string | null): boolean {
  const parts = (stored ?? '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    // Same work as a real check, so a missing user takes as long as a wrong password.
    scryptSync(password, 'no-such-user-salt', KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
    return false
  }
  const [, n, r, p, salt, hash] = parts
  const want = Buffer.from(hash, 'base64')
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM })
  return got.length === want.length && timingSafeEqual(got, want)
}

interface Row {
  id: string
  name: string
  username: string | null
  role: string
  password_hash: string | null
  is_active: number
  failed_count: number
  locked_until: string | null
  last_login_at: string | null
  created_at: string
}

const toUser = (r: Row): AuthUser => ({ id: r.id, name: r.name, username: r.username ?? '', role: r.role === 'owner' ? 'owner' : 'staff' })
const toSummary = (r: Row): UserSummary => ({ ...toUser(r), isActive: r.is_active === 1, lastLoginAt: r.last_login_at ?? '', createdAt: r.created_at })

/** Logins are on when the business has at least one active user with a password. */
export function loginRequired(db: DB): boolean {
  return !!db.prepare(`SELECT 1 FROM app_user WHERE is_active = 1 AND password_hash IS NOT NULL LIMIT 1`).get()
}

export function listUsers(db: DB): UserSummary[] {
  return (db.prepare(`SELECT * FROM app_user WHERE username IS NOT NULL ORDER BY role = 'owner' DESC, name COLLATE NOCASE`).all() as Row[]).map(toSummary)
}

export function getUser(db: DB, id: string): AuthUser | null {
  const r = db.prepare('SELECT * FROM app_user WHERE id = ? AND is_active = 1 AND password_hash IS NOT NULL').get(id) as Row | undefined
  return r ? toUser(r) : null
}

function checkNew(db: DB, input: NewUserInput, selfId: string | null = null): void {
  const name = (input.name ?? '').trim()
  if (!name || name.length > 60) throw new UserError('Enter the person\'s name (up to 60 characters)')
  const u = usernameProblem(input.username)
  if (u) throw new UserError(u)
  if (input.role !== 'owner' && input.role !== 'staff') throw new UserError('Choose owner or staff')
  const p = passwordProblem(input.password, input.username)
  if (p) throw new UserError(p)
  if (db.prepare('SELECT 1 FROM app_user WHERE username = ? COLLATE NOCASE AND id IS NOT ?').get(input.username, selfId)) {
    throw new UserError(`The username ${input.username} is already taken`)
  }
}

// ---------- Recovery code ----------

const RECOVERY_KEY = 'auth.recovery'
const RECOVERY_TRIES_KEY = 'auth.recoveryTries'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I

function newRecoveryCode(db: DB): string {
  const code = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')).join('-')
  writeSetting(db, RECOVERY_KEY, hashPassword(code))
  return code
}

function readSetting(db: DB, key: string): string | null {
  const r = db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined
  return r ? (JSON.parse(r.value) as string) : null
}

function writeSetting(db: DB, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), nowIso())
}

// ---------- Turning logins on ----------

/** The first owner account: switches logins on. Returns the recovery code, shown once. */
export function setupOwner(db: DB, input: Omit<NewUserInput, 'role'>): { user: AuthUser; recoveryCode: string } {
  if (loginRequired(db)) throw new UserError('Logins are already on for this business')
  const full: NewUserInput = { ...input, role: 'owner' }
  checkNew(db, full)
  const id = uuid()
  const now = nowIso()
  let recoveryCode = ''
  db.transaction(() => {
    db.prepare(
      `INSERT INTO app_user (id, name, username, role, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, 'owner', ?, 1, ?, ?)`
    ).run(id, input.name.trim(), input.username, hashPassword(input.password), now, now)
    recoveryCode = newRecoveryCode(db)
    audit(db, 'user', id, 'create', null, { name: input.name.trim(), username: input.username, role: 'owner' })
  })()
  return { user: getUser(db, id)!, recoveryCode }
}

/** Switch logins off again (owner only, with their password): removes every login of the business. */
export function turnOffLogins(db: DB, owner: AuthUser, password: string): void {
  const row = db.prepare('SELECT * FROM app_user WHERE id = ?').get(owner.id) as Row | undefined
  if (!row || row.role !== 'owner' || !verifyPassword(password, row.password_hash)) throw new UserError('Wrong password')
  db.transaction(() => {
    db.prepare('DELETE FROM app_user').run()
    db.prepare(`DELETE FROM setting WHERE key IN (?, ?)`).run(RECOVERY_KEY, RECOVERY_TRIES_KEY)
    audit(db, 'user', owner.id, 'delete', { logins: 'on' }, { logins: 'off' })
  })()
}

// ---------- Signing in ----------

const MAX_TRIES = 5

/** How long a login stays locked after `failed` wrong tries: 1 minute after 5, doubling, at most an hour. */
export function lockMinutes(failed: number): number {
  return failed < MAX_TRIES ? 0 : Math.min(60, 2 ** (failed - MAX_TRIES))
}

export function login(db: DB, username: string, password: string, now = new Date()): AuthUser {
  const row = db.prepare('SELECT * FROM app_user WHERE username = ? COLLATE NOCASE').get(String(username ?? '').trim()) as Row | undefined
  if (row?.locked_until && row.locked_until > now.toISOString()) {
    const mins = Math.ceil((Date.parse(row.locked_until) - now.getTime()) / 60_000)
    throw new UserError(`Too many wrong tries. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`)
  }
  const ok = verifyPassword(String(password ?? ''), row?.password_hash ?? null)
  // One message for an unknown user and a wrong password, so usernames cannot be found by guessing.
  if (!row || !ok || row.is_active !== 1) {
    if (row) {
      const failed = row.failed_count + 1
      const lock = lockMinutes(failed)
      db.prepare('UPDATE app_user SET failed_count = ?, locked_until = ? WHERE id = ?').run(
        failed, lock ? new Date(now.getTime() + lock * 60_000).toISOString() : null, row.id
      )
    }
    throw new UserError('Wrong username or password')
  }
  db.prepare('UPDATE app_user SET failed_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now.toISOString(), row.id)
  return toUser(row)
}

/** Forgotten owner password: the recovery code sets a new one, and a new code is issued. */
export function recoverOwner(db: DB, code: string, username: string, newPassword: string, now = new Date()): string {
  const tries = Number(readSetting(db, RECOVERY_TRIES_KEY) ?? 0)
  if (tries >= 10) throw new UserError('Too many wrong recovery codes. Restore a backup to get in, or ask for help.')
  const stored = readSetting(db, RECOVERY_KEY)
  const row = db.prepare(`SELECT * FROM app_user WHERE username = ? COLLATE NOCASE AND role = 'owner'`).get(String(username ?? '').trim()) as Row | undefined
  const clean = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-')
  if (!stored || !row || !verifyPassword(clean, stored)) {
    writeSetting(db, RECOVERY_TRIES_KEY, tries + 1)
    throw new UserError('That recovery code or username is not right')
  }
  const p = passwordProblem(newPassword, row.username ?? '')
  if (p) throw new UserError(p)
  let fresh = ''
  db.transaction(() => {
    db.prepare('UPDATE app_user SET password_hash = ?, failed_count = 0, locked_until = NULL, is_active = 1, updated_at = ? WHERE id = ?')
      .run(hashPassword(newPassword), now.toISOString(), row.id)
    writeSetting(db, RECOVERY_TRIES_KEY, 0)
    fresh = newRecoveryCode(db)
    audit(db, 'user', row.id, 'update', null, { passwordReset: 'with recovery code' })
  })()
  return fresh
}

// ---------- Managing users (owner) ----------

export function createUser(db: DB, input: NewUserInput): UserSummary {
  checkNew(db, input)
  const id = uuid()
  const now = nowIso()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO app_user (id, name, username, role, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, input.name.trim(), input.username, input.role, hashPassword(input.password), now, now)
    audit(db, 'user', id, 'create', null, { name: input.name.trim(), username: input.username, role: input.role })
  })()
  return listUsers(db).find((u) => u.id === id)!
}

const activeOwners = (db: DB, exceptId: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM app_user WHERE role = 'owner' AND is_active = 1 AND password_hash IS NOT NULL AND id <> ?`).get(exceptId) as { n: number }).n

export function updateUser(db: DB, id: string, u: UserUpdate): UserSummary {
  const row = db.prepare('SELECT * FROM app_user WHERE id = ? AND username IS NOT NULL').get(id) as Row | undefined
  if (!row) throw new UserError('User not found')
  const name = (u.name ?? '').trim()
  if (!name || name.length > 60) throw new UserError('Enter the person\'s name (up to 60 characters)')
  if (u.role !== 'owner' && u.role !== 'staff') throw new UserError('Choose owner or staff')
  // The business must always keep an owner who can sign in.
  if (row.role === 'owner' && (u.role !== 'owner' || !u.isActive) && activeOwners(db, id) === 0) {
    throw new UserError('Keep at least one active owner. Add another owner first.')
  }
  if (u.password) {
    const p = passwordProblem(u.password, row.username ?? '')
    if (p) throw new UserError(p)
  }
  db.transaction(() => {
    db.prepare('UPDATE app_user SET name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?').run(name, u.role, u.isActive ? 1 : 0, nowIso(), id)
    if (u.password) db.prepare('UPDATE app_user SET password_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?').run(hashPassword(u.password), id)
    audit(db, 'user', id, 'update', toSummary(row), { name, role: u.role, isActive: u.isActive, passwordChanged: !!u.password })
  })()
  return listUsers(db).find((x) => x.id === id)!
}

export function changeMyPassword(db: DB, user: AuthUser, current: string, next: string): void {
  const row = db.prepare('SELECT * FROM app_user WHERE id = ?').get(user.id) as Row | undefined
  if (!row || !verifyPassword(String(current ?? ''), row.password_hash)) throw new UserError('Your current password is not right')
  const p = passwordProblem(next, row.username ?? '')
  if (p) throw new UserError(p)
  db.prepare('UPDATE app_user SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(next), nowIso(), user.id)
  audit(db, 'user', user.id, 'update', null, { passwordChanged: true })
}

/** A new recovery code for the owner (the old one stops working). */
export function renewRecoveryCode(db: DB): string {
  return newRecoveryCode(db)
}

// ---------- Idle lock ----------

const IDLE_KEY = 'auth.idleMinutes'
export function getIdleMinutes(db: DB): number {
  const v = Number(readSetting(db, IDLE_KEY) ?? 15)
  return Number.isInteger(v) && v >= 0 && v <= 240 ? v : 15
}
export function setIdleMinutes(db: DB, minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) throw new UserError('Lock after 0 (never) to 240 minutes')
  writeSetting(db, IDLE_KEY, minutes)
  return minutes
}

export type { Role }
