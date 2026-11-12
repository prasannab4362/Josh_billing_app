// Double-entry ledger. Every posting balances: total debit = total credit.
import type { DB } from '../db/connection'
import { nowIso, uuid } from '../util'

/** Balancing account for opening balances (owner's capital / opening equity). */
export const OPENING_EQUITY = 'opening_equity'

export const partyAccount = (id: string) => `party:${id}`
export const bankAccount = (id: string) => `bank:${id}`

export type SourceType = 'document' | 'payment' | 'opening' | 'transfer' | 'adjustment'

export interface Posting {
  account: string
  /** Positive = debit, negative = credit. */
  amount: number
}

export function post(db: DB, date: string, sourceType: SourceType, sourceId: string, postings: Posting[]): void {
  const total = postings.reduce((s, p) => s + p.amount, 0)
  if (total !== 0) throw new Error(`Unbalanced posting for ${sourceType}:${sourceId} (off by ${total})`)
  const insert = db.prepare(
    `INSERT INTO ledger_entry (id, date, source_type, source_id, account, debit, credit, created_at) VALUES (?,?,?,?,?,?,?,?)`
  )
  const now = nowIso()
  for (const p of postings) {
    if (p.amount === 0) continue
    insert.run(uuid(), date, sourceType, sourceId, p.account, Math.max(p.amount, 0), Math.max(-p.amount, 0), now)
  }
}

export function unpost(db: DB, sourceType: SourceType, sourceId: string): void {
  db.prepare('DELETE FROM ledger_entry WHERE source_type = ? AND source_id = ?').run(sourceType, sourceId)
}

/** Σ(debit − credit) for an account. */
export function accountBalance(db: DB, account: string): number {
  const r = db
    .prepare('SELECT COALESCE(SUM(debit - credit), 0) AS b FROM ledger_entry WHERE account = ?')
    .get(account) as { b: number }
  return r.b
}

/** Replace the opening-balance entry for one ledger account (party or bank). */
export function setOpeningBalance(db: DB, account: string, sourceId: string, amount: number, date: string): void {
  unpost(db, 'opening', sourceId)
  if (amount !== 0) post(db, date, 'opening', sourceId, [{ account, amount }, { account: OPENING_EQUITY, amount: -amount }])
}
