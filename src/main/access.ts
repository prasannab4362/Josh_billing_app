// Who may call what. Every call from the screen passes through check() before its handler runs (registerIpc),
// so a hidden button is never the only thing standing between staff and an owner-only action.
import { PUBLIC_METHODS, STAFF_BILL_TYPES, STAFF_METHODS, type AuthUser } from '@shared/auth'
import type { BillType } from '@shared/billTypes'
import { todayLocal } from '@shared/fy'
import type { DB } from './db/connection'
import type { Session } from './session'
import { getIdleMinutes, loginRequired } from './services/users'
import { UserError } from './util'

const PUBLIC = new Set<string>(PUBLIC_METHODS)
const STAFF = new Set<string>(STAFF_METHODS)
/** Calls whose first argument is a bill type. */
const BILL_TYPE_FIRST = new Set(['listBills', 'getBill', 'nextBillNumber', 'saveBill', 'getBillPrint', 'exportBillPdf', 'printBill', 'shareBillOnWhatsApp'])

export const NOT_OWNER = 'Only the owner can do this. Ask the owner to sign in.'

/** Throws when the call is not allowed for whoever is signed in. Logins off: everything is allowed, as before. */
export function check(session: Session, method: string, args: unknown[], now = Date.now()): void {
  if (PUBLIC.has(method) || !session.isOpen) return
  const db = session.requireDb()
  if (!loginRequired(db)) return
  const user = session.user
  if (!user) throw new UserError('Please sign in')
  const idle = getIdleMinutes(db)
  if (idle > 0 && now - session.lastActive > idle * 60_000) {
    session.setUser(null)
    throw new UserError('Locked after no use. Please sign in again.')
  }
  session.lastActive = now
  if (user.role === 'owner') return
  if (!STAFF.has(method)) throw new UserError(NOT_OWNER)
  staffArgs(db, user, method, args)
}

function staffArgs(db: DB, _user: AuthUser, method: string, args: unknown[]): void {
  if (BILL_TYPE_FIRST.has(method) && !STAFF_BILL_TYPES.includes(args[0] as BillType)) throw new UserError(NOT_OWNER)
  // Staff may change a saved bill only on the day it is dated (later changes are for the owner).
  if (method === 'saveBill' && args[1]) {
    const r = db.prepare('SELECT date FROM document WHERE id = ? AND deleted_at IS NULL').get(String(args[1])) as { date: string } | undefined
    if (!r || r.date !== todayLocal()) throw new UserError('Only the owner can change a bill from an earlier day')
    const input = args[2] as { date?: string } | undefined
    if (input?.date !== todayLocal()) throw new UserError('Only the owner can move a bill to another day')
  }
  // Money in only, and a payment can be changed only on its day.
  if (method === 'listPayments') {
    const f = (args[0] ?? {}) as { direction?: string }
    if (f.direction !== 'in') throw new UserError(NOT_OWNER)
  }
  if ((method === 'nextPaymentNumber' && args[0] !== 'in') || (method === 'openDocuments' && args[1] !== 'in')) throw new UserError(NOT_OWNER)
  if (method === 'getPayment' || (method === 'savePayment' && args[0])) {
    const r = db.prepare('SELECT direction, date FROM payment WHERE id = ? AND deleted_at IS NULL').get(String(args[0])) as { direction: string; date: string } | undefined
    if (!r || r.direction !== 'in') throw new UserError(NOT_OWNER)
    if (method === 'savePayment' && r.date !== todayLocal()) throw new UserError('Only the owner can change a payment from an earlier day')
  }
  if (method === 'savePayment') {
    const input = args[1] as { direction?: string } | undefined
    if (input?.direction !== 'in') throw new UserError(NOT_OWNER)
  }
}
