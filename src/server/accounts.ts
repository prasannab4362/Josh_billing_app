// Website accounts: people sign in with email and password; each business belongs to its owner, who may add staff.
// Kept in its own database (accounts.db), apart from the business files. Passwords are stored only as scrypt hashes;
// sign-in sessions only as SHA-256 hashes of their random tokens, so a copied database cannot be used to sign in.
import { createHash, randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { passwordProblem, type Role } from '@shared/auth'
import { emailProblem, normEmail, type NewStaffInput, type TeamMember, type WebUser } from '@shared/web'
import { hashPassword, verifyPassword } from '../main/services/users'
import { UserError, uuid } from '../main/util'

export type AccountsDB = Database.Database

const SCHEMA = [
  `CREATE TABLE web_user (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     failed_count INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER,
     created_at TEXT NOT NULL,
     last_login_at TEXT
   )`,
  `CREATE TABLE web_session (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES web_user(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     last_seen INTEGER NOT NULL,
     business_id TEXT
   )`,
  `CREATE TABLE web_business (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL REFERENCES web_user(id),
     name TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE web_member (
     business_id TEXT NOT NULL REFERENCES web_business(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES web_user(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
     added_at TEXT NOT NULL,
     PRIMARY KEY (business_id, user_id)
   )`,
  `CREATE INDEX idx_member_user ON web_member(user_id)`,
  `CREATE INDEX idx_session_user ON web_session(user_id)`
]

/** Wrong passwords in a row before the account waits, and for how long. */
export const MAX_FAILS = 5
export const LOCK_MS = 15 * 60_000
/** A sign-in lasts this long without use, and at most this long in all. */
export const IDLE_MS = 14 * 24 * 3600_000
export const MAX_AGE_MS = 30 * 24 * 3600_000

export function openAccounts(path: string): AccountsDB {
  const db = new Database(path)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('trusted_schema = OFF')
    if (path !== ':memory:') {
      db.pragma('journal_mode = WAL')
      db.pragma('synchronous = FULL')
    }
    db.pragma('busy_timeout = 5000')
    if ((db.pragma('user_version', { simple: true }) as number) === 0) {
      db.transaction(() => {
        for (const sql of SCHEMA) db.exec(sql)
        db.pragma('user_version = 1')
      })()
    }
  } catch (err) {
    db.close()
    throw err
  }
  return db
}

const now = () => new Date().toISOString()
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

interface UserRow {
  id: string
  email: string
  name: string
  password_hash: string
  failed_count: number
  locked_until: number | null
}

const toUser = (r: { id: string; email: string; name: string }): WebUser => ({ id: r.id, email: r.email, name: r.name })

function cleanName(name: string): string {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!n) throw new UserError('Enter your name')
  if (n.length > 60) throw new UserError('Use a shorter name (up to 60 letters)')
  return n
}

function checkNewPassword(password: string, email: string): void {
  const p = passwordProblem(password, email.split('@')[0] ?? '')
  if (p) throw new UserError(p)
}

export function userCount(db: AccountsDB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM web_user').get() as { n: number }).n
}

export function createUser(db: AccountsDB, input: { name: string; email: string; password: string }): WebUser {
  const email = normEmail(input.email)
  const bad = emailProblem(email)
  if (bad) throw new UserError(bad)
  const name = cleanName(input.name)
  checkNewPassword(String(input.password ?? ''), email)
  if (db.prepare('SELECT 1 FROM web_user WHERE email = ?').get(email)) {
    throw new UserError('An account with this email already exists. Sign in instead.')
  }
  const id = uuid()
  db.prepare('INSERT INTO web_user (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)').run(
    id, email, name, hashPassword(input.password), now()
  )
  return { id, email, name }
}

/** The account for this email and password; counts wrong tries and locks the account for a while after too many. */
export function checkLogin(db: AccountsDB, emailIn: string, password: string, at = Date.now()): WebUser {
  const email = normEmail(emailIn)
  const row = db.prepare('SELECT * FROM web_user WHERE email = ?').get(email) as UserRow | undefined
  const wrong = new UserError('Wrong email or password')
  if (!row) {
    verifyPassword(String(password ?? ''), null) // same time as a real check
    throw wrong
  }
  if (row.locked_until && row.locked_until > at) {
    const mins = Math.ceil((row.locked_until - at) / 60_000)
    throw new UserError(`Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`)
  }
  if (!verifyPassword(String(password ?? ''), row.password_hash)) {
    const fails = row.failed_count + 1
    db.prepare('UPDATE web_user SET failed_count = ?, locked_until = ? WHERE id = ?').run(
      fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? at + LOCK_MS : null, row.id
    )
    throw fails >= MAX_FAILS ? new UserError('Too many wrong passwords. Try again in 15 minutes.') : wrong
  }
  db.prepare('UPDATE web_user SET failed_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now(), row.id)
  return toUser(row)
}

// ---------- Sign-in sessions ----------

export function startSession(db: AccountsDB, userId: string, at = Date.now()): string {
  const token = randomBytes(32).toString('base64url')
  db.prepare('INSERT INTO web_session (token_hash, user_id, created_at, last_seen) VALUES (?,?,?,?)').run(hashToken(token), userId, at, at)
  // Old, finished sessions are cleared now and then.
  db.prepare('DELETE FROM web_session WHERE last_seen < ? OR created_at < ?').run(at - IDLE_MS, at - MAX_AGE_MS)
  return token
}

export interface SessionInfo {
  tokenHash: string
  user: WebUser
  businessId: string | null
}

/** Who a session token belongs to, or null when it is unknown or has run out. Using it keeps it alive. */
export function sessionUser(db: AccountsDB, token: string | undefined, at = Date.now()): SessionInfo | null {
  if (!token || token.length > 100) return null
  const h = hashToken(token)
  const r = db.prepare(
    `SELECT s.token_hash, s.created_at, s.last_seen, s.business_id, u.id, u.email, u.name
       FROM web_session s JOIN web_user u ON u.id = s.user_id WHERE s.token_hash = ?`
  ).get(h) as { token_hash: string; created_at: number; last_seen: number; business_id: string | null; id: string; email: string; name: string } | undefined
  if (!r) return null
  if (r.last_seen < at - IDLE_MS || r.created_at < at - MAX_AGE_MS) {
    db.prepare('DELETE FROM web_session WHERE token_hash = ?').run(h)
    return null
  }
  if (at - r.last_seen > 60_000) db.prepare('UPDATE web_session SET last_seen = ? WHERE token_hash = ?').run(at, h)
  return { tokenHash: h, user: toUser(r), businessId: r.business_id }
}

export function endSession(db: AccountsDB, tokenHash: string): void {
  db.prepare('DELETE FROM web_session WHERE token_hash = ?').run(tokenHash)
}

export function setSessionBusiness(db: AccountsDB, tokenHash: string, businessId: string | null): void {
  db.prepare('UPDATE web_session SET business_id = ? WHERE token_hash = ?').run(businessId, tokenHash)
}

/** New password; every other sign-in of this account is ended. */
export function changePassword(db: AccountsDB, userId: string, current: string, next: string, keepTokenHash: string): void {
  const row = db.prepare('SELECT * FROM web_user WHERE id = ?').get(userId) as UserRow | undefined
  if (!row) throw new UserError('Please sign in')
  if (!verifyPassword(String(current ?? ''), row.password_hash)) throw new UserError('Your current password is wrong')
  checkNewPassword(String(next ?? ''), row.email)
  db.transaction(() => {
    db.prepare('UPDATE web_user SET password_hash = ? WHERE id = ?').run(hashPassword(next), userId)
    db.prepare('DELETE FROM web_session WHERE user_id = ? AND token_hash <> ?').run(userId, keepTokenHash)
  })()
}

/** For the server's operator (command line), when someone has forgotten their password. */
export function resetPassword(db: AccountsDB, emailIn: string, next: string): void {
  const email = normEmail(emailIn)
  const row = db.prepare('SELECT id FROM web_user WHERE email = ?').get(email) as { id: string } | undefined
  if (!row) throw new UserError(`No account has the email ${email}`)
  checkNewPassword(next, email)
  db.transaction(() => {
    db.prepare('UPDATE web_user SET password_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?').run(hashPassword(next), row.id)
    db.prepare('DELETE FROM web_session WHERE user_id = ?').run(row.id)
  })()
}

// ---------- Businesses and who may use them ----------

export function addBusiness(db: AccountsDB, id: string, ownerId: string, name: string): void {
  const at = now()
  db.transaction(() => {
    db.prepare('INSERT INTO web_business (id, owner_id, name, created_at) VALUES (?,?,?,?)').run(id, ownerId, name, at)
    db.prepare(`INSERT INTO web_member (business_id, user_id, role, added_at) VALUES (?,?,'owner',?)`).run(id, ownerId, at)
  })()
}

export function renameBusiness(db: AccountsDB, id: string, name: string): void {
  db.prepare('UPDATE web_business SET name = ? WHERE id = ?').run(name, id)
}

export interface MyBusiness {
  id: string
  name: string
  ownerId: string
  role: Role
  createdAt: string
}

export function myBusinesses(db: AccountsDB, userId: string): MyBusiness[] {
  return (db.prepare(
    `SELECT b.id, b.name, b.owner_id AS ownerId, m.role, b.created_at AS createdAt
       FROM web_member m JOIN web_business b ON b.id = m.business_id
      WHERE m.user_id = ? ORDER BY b.name COLLATE NOCASE`
  ).all(userId) as MyBusiness[])
}

/** The user's role in the business, or null when they have no access to it. */
export function roleIn(db: AccountsDB, userId: string, businessId: string): { role: Role; ownerId: string } | null {
  const r = db.prepare(
    `SELECT m.role, b.owner_id FROM web_member m JOIN web_business b ON b.id = m.business_id WHERE m.user_id = ? AND m.business_id = ?`
  ).get(userId, businessId) as { role: Role; owner_id: string } | undefined
  return r ? { role: r.role, ownerId: r.owner_id } : null
}

export function team(db: AccountsDB, businessId: string): TeamMember[] {
  return db.prepare(
    `SELECT u.id AS userId, u.email, u.name, m.role, m.added_at AS addedAt
       FROM web_member m JOIN web_user u ON u.id = m.user_id WHERE m.business_id = ?
      ORDER BY m.role = 'owner' DESC, u.name COLLATE NOCASE`
  ).all(businessId) as TeamMember[]
}

/** Give a person staff access. A new email gets an account with the password given; an existing one keeps theirs. */
export function addStaff(db: AccountsDB, businessId: string, input: NewStaffInput): TeamMember {
  const email = normEmail(input.email)
  const bad = emailProblem(email)
  if (bad) throw new UserError(bad)
  return db.transaction(() => {
    let user = db.prepare('SELECT id, email, name FROM web_user WHERE email = ?').get(email) as WebUser | undefined
    if (!user) user = createUser(db, { name: input.name, email, password: input.password })
    if (db.prepare('SELECT 1 FROM web_member WHERE business_id = ? AND user_id = ?').get(businessId, user.id)) {
      throw new UserError(`${email} is already in this business's team`)
    }
    const at = now()
    db.prepare(`INSERT INTO web_member (business_id, user_id, role, added_at) VALUES (?,?,'staff',?)`).run(businessId, user.id, at)
    return { userId: user.id, email: user.email, name: user.name, role: 'staff' as Role, addedAt: at }
  })()
}

/** Take a staff member's access away (their own account stays); the owner cannot be removed. */
export function removeStaff(db: AccountsDB, businessId: string, userId: string): void {
  const r = db.prepare('SELECT role FROM web_member WHERE business_id = ? AND user_id = ?').get(businessId, userId) as { role: Role } | undefined
  if (!r) throw new UserError('That person is not in the team')
  if (r.role === 'owner') throw new UserError('The owner cannot be removed')
  db.transaction(() => {
    db.prepare('DELETE FROM web_member WHERE business_id = ? AND user_id = ?').run(businessId, userId)
    db.prepare('UPDATE web_session SET business_id = NULL WHERE user_id = ? AND business_id = ?').run(userId, businessId)
  })()
}
