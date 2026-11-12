// Statements: every ledger movement of one party or one cash/bank account, with a running balance.
import type { Statement, StatementRow } from '@shared/models'
import type { Period } from '@shared/ipc'
import type { DB } from '../db/connection'
import { UserError } from '../util'
import { getAccount } from './accounts'
import { bankAccount, partyAccount } from './ledger'
import { getParty } from './parties'

const DOC_LABEL: Record<string, string> = {
  SALE_INVOICE: 'Sale invoice',
  SALE_RETURN: 'Credit note',
  PURCHASE_BILL: 'Purchase bill',
  PURCHASE_RETURN: 'Debit note',
  EXPENSE: 'Expense'
}

interface Row {
  date: string
  source_type: string
  source_id: string
  debit: number
  credit: number
  doc_type: string | null
  doc_number: string | null
  doc_party: string | null
  direction: 'in' | 'out' | null
  pay_number: string | null
  pay_party: string | null
  from_name: string | null
  to_name: string | null
  t_notes: string | null
}


function statement(db: DB, account: string, period: Period, side: 'party' | 'bank'): Statement {
  const from = period.from || null
  const to = period.to || null
  const opening = from
    ? (
        db
          .prepare('SELECT COALESCE(SUM(debit - credit), 0) AS b FROM ledger_entry WHERE account = ? AND date < ?')
          .get(account, from) as { b: number }
      ).b
    : 0
  const rows = db
    .prepare(
      `SELECT e.date, e.source_type, e.source_id, e.debit, e.credit,
              d.doc_type, d.number AS doc_number, json_extract(d.party_snapshot, '$.name') AS doc_party,
              p.direction, p.number AS pay_number,
              COALESCE(pp.name, CASE WHEN p.id IS NOT NULL THEN 'Cash sale' END) AS pay_party,
              fa.name AS from_name, ta.name AS to_name, t.notes AS t_notes
       FROM ledger_entry e
       LEFT JOIN document d ON e.source_type = 'document' AND d.id = e.source_id
       LEFT JOIN payment p ON e.source_type = 'payment' AND p.id = e.source_id
       LEFT JOIN party pp ON pp.id = p.party_id
       LEFT JOIN account_transfer t ON e.source_type = 'transfer' AND t.id = e.source_id
       LEFT JOIN bank_account fa ON fa.id = t.from_account_id
       LEFT JOIN bank_account ta ON ta.id = t.to_account_id
       WHERE e.account = ? AND (? IS NULL OR e.date >= ?) AND (? IS NULL OR e.date <= ?)
       ORDER BY e.date, e.source_type = 'opening' DESC, e.created_at, e.rowid`
    )
    .all(account, from, from, to, to) as Row[]

  let balance = opening
  let totalDebit = 0
  let totalCredit = 0
  const out: StatementRow[] = rows.map((r) => {
    balance += r.debit - r.credit
    totalDebit += r.debit
    totalCredit += r.credit
    let kind: StatementRow['kind'] = 'other'
    let label = r.source_type
    let number = ''
    if (r.source_type === 'opening') {
      kind = 'opening'
      label = 'Opening balance'
    } else if (r.source_type === 'document') {
      kind = 'invoice'
      label = DOC_LABEL[r.doc_type ?? ''] ?? 'Bill'
      if (side === 'bank' && r.doc_party) label += ` · ${r.doc_party}`
      number = r.doc_number ?? ''
    } else if (r.source_type === 'payment') {
      kind = r.direction === 'out' ? 'payment_out' : 'payment_in'
      label = r.direction === 'out' ? 'Payment made' : 'Payment received'
      if (side === 'bank' && r.pay_party) label += ` · ${r.pay_party}`
      number = r.pay_number ?? ''
    } else if (r.source_type === 'transfer') {
      kind = 'transfer'
      label = r.debit > 0 ? `Transfer from ${r.from_name}` : `Transfer to ${r.to_name}`
      if (r.t_notes) label += ` · ${r.t_notes}`
    }
    return { date: r.date, kind, label, number, sourceId: r.source_id, debit: r.debit, credit: r.credit, balance }
  })
  return { openingBalance: opening, rows: out, closingBalance: balance, totalDebit, totalCredit }
}

/** Debit = they owe more (invoice); credit = they paid. Positive balance = to receive. */
export function partyStatement(db: DB, partyId: string, period: Period = {}): Statement {
  getParty(db, partyId)
  return statement(db, partyAccount(partyId), period, 'party')
}

/** Debit = money in; credit = money out. */
export function accountStatement(db: DB, accountId: string, period: Period = {}): Statement {
  if (!getAccount(db, accountId, true)) throw new UserError('Account not found')
  return statement(db, bankAccount(accountId), period, 'bank')
}
