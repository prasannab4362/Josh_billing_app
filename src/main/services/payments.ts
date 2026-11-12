// Payments in (receipts from customers) and out (payments to suppliers), with allocation
// against open bills. Money not set against a bill stays on the party as an advance.

import { fyFor } from '@shared/fy'
import type {
  OpenDocument,
  Payment,
  PaymentDirection,
  PaymentInput,
  PaymentMode,
  PaymentSummary
} from '@shared/models'
import type { PaymentFilter } from '@shared/ipc'
import type { DB } from '../db/connection'
import { nowIso, UserError, uuid } from '../util'
import { getAccount } from './accounts'
import { audit } from './audit'
import { getBusiness } from './business'
import { refreshDocumentPaid } from './invoices'
import { bankAccount, partyAccount, post, unpost } from './ledger'
import { peekNumber, takeNumber } from './numberSeries'
import { getParty } from './parties'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const MODES: PaymentMode[] = ['cash', 'upi', 'bank', 'cheque', 'card']
/** Which bills each direction settles: money in clears invoices and supplier refunds; out clears bills and customer refunds. */
const SETTLES: Record<PaymentDirection, string[]> = { in: ['SALE_INVOICE', 'PURCHASE_RETURN'], out: ['PURCHASE_BILL', 'SALE_RETURN'] }
const SERIES = { in: 'PAYMENT_IN', out: 'PAYMENT_OUT' } as const

const numberTaken = (db: DB, direction: PaymentDirection, selfId: string | null) => (number: string) =>
  !!db.prepare('SELECT 1 FROM payment WHERE direction = ? AND number = ? AND id IS NOT ?').get(direction, number, selfId)

export function nextPaymentNumber(db: DB, direction: PaymentDirection, date: string): string {
  const fy = fyFor(date, getBusiness(db).fyStartMonth)
  return peekNumber(db, SERIES[direction], fy, numberTaken(db, direction, null))
}

/** Bills of this party that can still take money. When editing, this payment's own share counts as open. */
export function openDocuments(db: DB, partyId: string, direction: PaymentDirection, paymentId: string | null = null): OpenDocument[] {
  const types = SETTLES[direction].map((t) => `'${t}'`).join(',')
  const rows = db
    .prepare(
      `SELECT d.id, d.number, d.date, d.due_date, d.grand_total, d.balance_due,
              COALESCE((SELECT a.amount FROM payment_allocation a WHERE a.document_id = d.id AND a.payment_id = ?), 0) AS mine
       FROM document d
       WHERE d.party_id = ? AND d.doc_type IN (${types}) AND d.deleted_at IS NULL
       ORDER BY d.date, d.created_at`
    )
    .all(paymentId, partyId) as { id: string; number: string; date: string; due_date: string | null; grand_total: number; balance_due: number; mine: number }[]
  return rows
    .map((r) => ({ id: r.id, number: r.number, date: r.date, dueDate: r.due_date ?? '', total: r.grand_total, open: r.balance_due + r.mine }))
    .filter((d) => d.open > 0)
}

/** Spread an amount over open bills, oldest first. */
export function autoAllocate(docs: OpenDocument[], amount: number): { documentId: string; amount: number }[] {
  const out: { documentId: string; amount: number }[] = []
  let left = amount
  for (const d of docs) {
    if (left <= 0) break
    const take = Math.min(left, d.open)
    out.push({ documentId: d.id, amount: take })
    left -= take
  }
  return out
}

interface PaymentRow {
  id: string
  direction: PaymentDirection
  number: string
  date: string
  party_id: string | null
  party_name: string | null
  amount: number
  account_id: string
  account_name: string
  mode: PaymentMode
  reference: string | null
  notes: string | null
  allocated: number
  source_doc_id: string | null
  source_number: string | null
}

const SELECT = `
  SELECT p.*, pt.name AS party_name, b.name AS account_name, src.number AS source_number,
         COALESCE((SELECT SUM(a.amount) FROM payment_allocation a WHERE a.payment_id = p.id), 0) AS allocated
  FROM payment p
  LEFT JOIN party pt ON pt.id = p.party_id
  JOIN bank_account b ON b.id = p.account_id
  LEFT JOIN document src ON src.id = p.source_doc_id
  WHERE p.deleted_at IS NULL`

function summary(r: PaymentRow): PaymentSummary {
  return {
    id: r.id,
    direction: r.direction,
    number: r.number,
    date: r.date,
    partyId: r.party_id,
    partyName: r.party_name ?? 'Cash sale',
    amount: r.amount,
    accountId: r.account_id,
    accountName: r.account_name,
    mode: r.mode,
    reference: r.reference ?? '',
    allocated: r.allocated,
    unallocated: r.amount - r.allocated,
    sourceDocId: r.source_doc_id,
    sourceDocNumber: r.source_number ?? ''
  }
}


export function listPayments(db: DB, filter: PaymentFilter = {}): PaymentSummary[] {
  const where: string[] = []
  const args: string[] = []
  const add = (sql: string, v: string | undefined) => {
    if (v) (where.push(sql), args.push(v))
  }
  add('p.date >= ?', filter.from)
  add('p.date <= ?', filter.to)
  add('p.party_id = ?', filter.partyId)
  add('p.direction = ?', filter.direction)
  const rows = db
    .prepare(`${SELECT}${where.length ? ' AND ' + where.join(' AND ') : ''} ORDER BY p.date DESC, p.created_at DESC`)
    .all(...args) as PaymentRow[]
  return rows.map(summary)
}

export function getPayment(db: DB, id: string): Payment {
  const r = db.prepare(`${SELECT} AND p.id = ?`).get(id) as PaymentRow | undefined
  if (!r) throw new UserError('Payment not found')
  const allocations = db
    .prepare(
      `SELECT a.document_id, a.amount, d.number, d.date FROM payment_allocation a JOIN document d ON d.id = a.document_id
       WHERE a.payment_id = ? ORDER BY d.date`
    )
    .all(id) as { document_id: string; amount: number; number: string; date: string }[]
  return {
    ...summary(r),
    notes: r.notes ?? '',
    allocations: allocations.map((a) => ({ documentId: a.document_id, amount: a.amount, number: a.number, date: a.date }))
  }
}

function postPayment(db: DB, id: string, p: { direction: PaymentDirection; date: string; partyId: string; amount: number; accountId: string }): void {
  unpost(db, 'payment', id)
  const sign = p.direction === 'in' ? 1 : -1
  post(db, p.date, 'payment', id, [
    { account: bankAccount(p.accountId), amount: sign * p.amount },
    { account: partyAccount(p.partyId), amount: -sign * p.amount }
  ])
}

export function savePayment(db: DB, id: string | null, input: PaymentInput): Payment {
  const existing = id ? getPayment(db, id) : null
  if (existing?.sourceDocId) {
    throw new UserError(`This payment was taken on invoice ${existing.sourceDocNumber}. Change it on that invoice.`)
  }
  if (existing && existing.direction !== input.direction) throw new UserError('A payment cannot change direction')
  if (input.direction !== 'in' && input.direction !== 'out') throw new UserError('Choose payment in or out')
  if (!DATE.test(input.date)) throw new UserError('Choose the payment date')
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new UserError('Amount must be more than 0')
  if (!input.partyId) throw new UserError('Choose a party')
  getParty(db, input.partyId)
  if (!getAccount(db, input.accountId)) throw new UserError('Choose the cash or bank account')
  if (!MODES.includes(input.mode)) throw new UserError('Choose how the money was paid')
  const number = input.number.trim()
  if (number.length > 30 || /[\r\n]/.test(number)) throw new UserError('Payment number is too long')

  // Allocations: only this party's open bills, never more than a bill's balance or the payment itself.
  const open = new Map(openDocuments(db, input.partyId, input.direction, id).map((d) => [d.id, d]))
  const seen = new Set<string>()
  let allocated = 0
  const allocations = input.allocations.filter((a) => a.amount !== 0)
  for (const a of allocations) {
    if (!Number.isInteger(a.amount) || a.amount < 0) throw new UserError('Allocation amounts must be positive')
    const doc = open.get(a.documentId)
    if (!doc) throw new UserError('A selected bill is not open for this party')
    if (seen.has(a.documentId)) throw new UserError(`Bill ${doc.number} is listed twice`)
    seen.add(a.documentId)
    if (a.amount > doc.open) throw new UserError(`Only ${(doc.open / 100).toFixed(2)} is due on ${doc.number}`)
    allocated += a.amount
  }
  if (allocated > input.amount) throw new UserError('Amounts set against bills are more than the payment')

  const fy = fyFor(input.date, getBusiness(db).fyStartMonth)
  const now = nowIso()
  const paymentId = existing?.id ?? uuid()
  db.transaction(() => {
    let finalNumber = number || existing?.number || ''
    const taken = numberTaken(db, input.direction, existing?.id ?? null)
    if (!existing && (!finalNumber || finalNumber === peekNumber(db, SERIES[input.direction], fy, taken))) {
      finalNumber = takeNumber(db, SERIES[input.direction], fy, taken).number
    } else if (taken(finalNumber)) {
      throw new UserError(`Payment number ${finalNumber} is already used`)
    }
    const values = [finalNumber, input.date, input.partyId, input.amount, input.accountId, input.mode, input.reference.trim() || null, input.notes.trim() || null]
    if (existing) {
      db.prepare(
        `UPDATE payment SET number = ?, date = ?, party_id = ?, amount = ?, account_id = ?, mode = ?, reference = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      ).run(...values, now, paymentId)
    } else {
      db.prepare(
        `INSERT INTO payment (id, direction, number, date, party_id, amount, account_id, mode, reference, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(paymentId, input.direction, ...values, now, now)
    }

    const touched = new Set(existing?.allocations.map((a) => a.documentId) ?? [])
    db.prepare('DELETE FROM payment_allocation WHERE payment_id = ?').run(paymentId)
    const insert = db.prepare('INSERT INTO payment_allocation (payment_id, document_id, amount) VALUES (?,?,?)')
    for (const a of allocations) {
      insert.run(paymentId, a.documentId, a.amount)
      touched.add(a.documentId)
    }
    for (const docId of touched) refreshDocumentPaid(db, docId)

    postPayment(db, paymentId, { ...input, partyId: input.partyId })
    audit(db, 'payment', paymentId, existing ? 'update' : 'create', existing, { ...input, number: finalNumber })
  })()
  return getPayment(db, paymentId)
}

export function deletePayment(db: DB, id: string): void {
  const before = getPayment(db, id)
  if (before.sourceDocId) {
    throw new UserError(`This payment was taken on invoice ${before.sourceDocNumber}. Change it on that invoice.`)
  }
  db.transaction(() => {
    const now = nowIso()
    db.prepare('UPDATE payment SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    db.prepare('DELETE FROM payment_allocation WHERE payment_id = ?').run(id)
    for (const a of before.allocations) refreshDocumentPaid(db, a.documentId)
    unpost(db, 'payment', id)
    audit(db, 'payment', id, 'delete', before, null)
  })()
}
