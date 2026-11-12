// Cash, bank and wallet accounts, their balances, and transfers between them.
import type { AccountInput, AccountWithBalance, MoneyAccount, TransferInput } from '@shared/models'
import { hasErrors, validateBankAccount } from '@shared/validation'
import type { DB } from '../db/connection'
import { nowIso, toBool, toInt, UserError, uuid } from '../util'
import { audit } from './audit'
import { bankAccount, post, setOpeningBalance, unpost } from './ledger'

interface AccountRow {
  id: string
  kind: MoneyAccount['kind']
  name: string
  bank_name: string | null
  account_no: string | null
  ifsc: string | null
  upi_id: string | null
  is_default_for_print: number
}

const fromRow = (r: AccountRow): MoneyAccount => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  bankName: r.bank_name ?? '',
  accountNo: r.account_no ?? '',
  ifsc: r.ifsc ?? '',
  upiId: r.upi_id ?? '',
  isDefaultForPrint: toBool(r.is_default_for_print)
})

/** Active cash, bank and wallet accounts; cash first. */
export function listAccounts(db: DB): MoneyAccount[] {
  const rows = db
    .prepare(`SELECT * FROM bank_account WHERE is_active = 1 ORDER BY kind = 'cash' DESC, name COLLATE NOCASE`)
    .all() as AccountRow[]
  return rows.map(fromRow)
}

export function getAccount(db: DB, id: string, includeInactive = false): MoneyAccount | null {
  const row = db
    .prepare(`SELECT * FROM bank_account WHERE id = ?${includeInactive ? '' : ' AND is_active = 1'}`)
    .get(id) as AccountRow | undefined
  return row ? fromRow(row) : null
}

/** The account whose bank / UPI details are printed on invoices. */
export function printAccount(db: DB): MoneyAccount | null {
  const row = db
    .prepare(
      `SELECT * FROM bank_account WHERE is_active = 1 AND kind <> 'cash' ORDER BY is_default_for_print DESC, created_at LIMIT 1`
    )
    .get() as AccountRow | undefined
  return row ? fromRow(row) : null
}

// ---------- Managing accounts ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/
const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

export function listAccountsWithBalance(db: DB): AccountWithBalance[] {
  const rows = db
    .prepare(
      `SELECT b.*, COALESCE((SELECT SUM(debit - credit) FROM ledger_entry WHERE account = 'bank:' || b.id), 0) AS balance
       FROM bank_account b WHERE b.is_active = 1 ORDER BY b.kind = 'cash' DESC, b.name COLLATE NOCASE`
    )
    .all() as (AccountRow & { opening_balance: number; opening_date: string | null; balance: number })[]
  return rows.map((r) => ({
    ...fromRow(r),
    openingBalance: r.opening_balance,
    openingDate: r.opening_date ?? '',
    balance: r.balance
  }))
}

function check(db: DB, a: AccountInput, selfId: string | null): void {
  // Cash has no bank fields; validate it like a wallet (name + amount only).
  const errors = validateBankAccount({ ...a, kind: a.kind === 'bank' ? 'bank' : 'upi_wallet' })
  if (hasErrors(errors)) throw new UserError(Object.values(errors)[0]!)
  if (a.openingBalance !== 0 && !DATE.test(a.openingDate)) throw new UserError('Choose the date of the opening balance')
  const dup = db
    .prepare('SELECT 1 FROM bank_account WHERE name = ? COLLATE NOCASE AND is_active = 1 AND id IS NOT ?')
    .get(a.name.trim(), selfId)
  if (dup) throw new UserError(`An account named "${a.name.trim()}" already exists`)
}

function writeValues(a: AccountInput): unknown[] {
  return [
    a.kind, a.name.trim(), orNull(a.bankName), orNull(a.accountNo), orNull(a.ifsc.toUpperCase()), orNull(a.upiId),
    a.openingBalance, a.openingBalance ? a.openingDate : null, toInt(a.isDefaultForPrint && a.kind !== 'cash')
  ]
}

export function createAccount(db: DB, a: AccountInput): AccountWithBalance {
  if (a.kind === 'cash') throw new UserError('There is already a cash account')
  check(db, a, null)
  const id = uuid()
  const now = nowIso()
  db.transaction(() => {
    if (a.isDefaultForPrint) db.prepare('UPDATE bank_account SET is_default_for_print = 0').run()
    db.prepare(
      `INSERT INTO bank_account (id, kind, name, bank_name, account_no, ifsc, upi_id, opening_balance, opening_date,
                                 is_default_for_print, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, ...writeValues(a), now, now)
    setOpeningBalance(db, bankAccount(id), id, a.openingBalance, a.openingDate)
    audit(db, 'bank_account', id, 'create', null, a)
  })()
  return listAccountsWithBalance(db).find((x) => x.id === id)!
}

export function updateAccount(db: DB, id: string, a: AccountInput): AccountWithBalance {
  const before = listAccountsWithBalance(db).find((x) => x.id === id)
  if (!before) throw new UserError('Account not found')
  if ((before.kind === 'cash') !== (a.kind === 'cash')) throw new UserError('The cash account cannot change type')
  check(db, a, id)
  db.transaction(() => {
    if (a.isDefaultForPrint) db.prepare('UPDATE bank_account SET is_default_for_print = 0').run()
    db.prepare(
      `UPDATE bank_account SET kind = ?, name = ?, bank_name = ?, account_no = ?, ifsc = ?, upi_id = ?, opening_balance = ?,
              opening_date = ?, is_default_for_print = ?, updated_at = ? WHERE id = ?`
    ).run(...writeValues(a), nowIso(), id)
    setOpeningBalance(db, bankAccount(id), id, a.openingBalance, a.openingDate)
    audit(db, 'bank_account', id, 'update', before, a)
  })()
  return listAccountsWithBalance(db).find((x) => x.id === id)!
}

/** Hide an account that has nothing left in it. Its history stays in reports. */
export function deactivateAccount(db: DB, id: string): void {
  const a = listAccountsWithBalance(db).find((x) => x.id === id)
  if (!a) throw new UserError('Account not found')
  if (a.kind === 'cash') throw new UserError('The cash account cannot be removed')
  if (a.balance !== 0) throw new UserError('Move the money out of this account before removing it')
  db.prepare('UPDATE bank_account SET is_active = 0, is_default_for_print = 0, updated_at = ? WHERE id = ?').run(nowIso(), id)
  audit(db, 'bank_account', id, 'delete', a, null)
}

// ---------- Transfers ----------

export function createTransfer(db: DB, t: TransferInput): string {
  if (!DATE.test(t.date)) throw new UserError('Choose the transfer date')
  if (!Number.isInteger(t.amount) || t.amount <= 0) throw new UserError('Amount must be more than 0')
  if (t.fromAccountId === t.toAccountId) throw new UserError('Choose two different accounts')
  if (!getAccount(db, t.fromAccountId) || !getAccount(db, t.toAccountId)) throw new UserError('Account not found')
  const id = uuid()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO account_transfer (id, from_account_id, to_account_id, amount, date, notes, created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(id, t.fromAccountId, t.toAccountId, t.amount, t.date, orNull(t.notes), nowIso())
    post(db, t.date, 'transfer', id, [
      { account: bankAccount(t.toAccountId), amount: t.amount },
      { account: bankAccount(t.fromAccountId), amount: -t.amount }
    ])
    audit(db, 'account_transfer', id, 'create', null, t)
  })()
  return id
}

export function deleteTransfer(db: DB, id: string): void {
  const row = db.prepare('SELECT * FROM account_transfer WHERE id = ? AND deleted_at IS NULL').get(id)
  if (!row) throw new UserError('Transfer not found')
  db.transaction(() => {
    db.prepare('UPDATE account_transfer SET deleted_at = ? WHERE id = ?').run(nowIso(), id)
    unpost(db, 'transfer', id)
    audit(db, 'account_transfer', id, 'delete', row, null)
  })()
}
