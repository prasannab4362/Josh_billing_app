// Expenses: rent, salary, electricity... paid straight from cash or bank. Each one is stored as an
// EXPENSE document with one line, so GST credit on it shows up in the GST summary.
//   Ledger: Dr expense (amount) + Dr gst_in (tax), Cr bank:<account> (total).
import { DEFAULT_EXPENSE_CATEGORIES, type Expense, type ExpenseInput } from '@shared/models'
import { applyRate, splitHalves } from '@shared/money'
import type { Period } from '@shared/ipc'
import type { DB } from '../db/connection'
import { nowIso, UserError, uuid } from '../util'
import { getAccount } from './accounts'
import { audit } from './audit'
import { getBusiness } from './business'
import { bankAccount, post, unpost } from './ledger'
import { getPreferences } from './settings'

const DATE = /^\d{4}-\d{2}-\d{2}$/
export const EXPENSE_ACCOUNT = 'expense'

interface Row {
  id: string
  date: string
  number: string | null
  category: string
  taxable_total: number
  cgst: number
  sgst: number
  grand_total: number
  account_id: string
  account_name: string
  paid_to: string
  notes: string | null
  tax_rate_id: string | null
  tax_rate_bp: number
}

const SELECT = `
  SELECT d.id, d.date, d.number, d.category, d.taxable_total, d.cgst, d.sgst, d.grand_total, d.account_id, d.notes,
         b.name AS account_name, COALESCE(json_extract(d.party_snapshot, '$.paidTo'), '') AS paid_to,
         l.tax_rate_id, COALESCE(l.tax_rate_bp, 0) AS tax_rate_bp
  FROM document d
  JOIN bank_account b ON b.id = d.account_id
  LEFT JOIN document_line l ON l.document_id = d.id AND l.line_no = 1
  WHERE d.doc_type = 'EXPENSE' AND d.deleted_at IS NULL`

const fromRow = (r: Row): Expense => ({
  id: r.id,
  date: r.date,
  category: r.category,
  amount: r.taxable_total,
  taxRateId: r.tax_rate_id,
  taxRateBp: r.tax_rate_bp,
  cgst: r.cgst,
  sgst: r.sgst,
  total: r.grand_total,
  accountId: r.account_id,
  accountName: r.account_name,
  paidTo: r.paid_to,
  reference: r.number ?? '',
  notes: r.notes ?? ''
})

export function listExpenses(db: DB, period: Period = {}): Expense[] {
  const rows = db
    .prepare(`${SELECT} AND (@from IS NULL OR d.date >= @from) AND (@to IS NULL OR d.date <= @to) ORDER BY d.date DESC, d.created_at DESC`)
    .all({ from: period.from || null, to: period.to || null }) as Row[]
  return rows.map(fromRow)
}

export function getExpense(db: DB, id: string): Expense {
  const r = db.prepare(`${SELECT} AND d.id = ?`).get(id) as Row | undefined
  if (!r) throw new UserError('Expense not found')
  return fromRow(r)
}

/** The usual categories plus any the business has used. */
export function listExpenseCategories(db: DB): string[] {
  const used = (db.prepare(`SELECT DISTINCT category FROM document WHERE doc_type = 'EXPENSE' AND deleted_at IS NULL AND category IS NOT NULL`).all() as { category: string }[]).map((r) => r.category)
  const all = new Map<string, string>()
  for (const c of [...DEFAULT_EXPENSE_CATEGORIES, ...used]) if (!all.has(c.toLowerCase())) all.set(c.toLowerCase(), c)
  return [...all.values()].sort((a, b) => a.localeCompare(b))
}

export function saveExpense(db: DB, id: string | null, input: ExpenseInput): Expense {
  const existing = id ? getExpense(db, id) : null
  if (!DATE.test(input.date)) throw new UserError('Choose the expense date')
  const category = input.category.trim()
  if (!category) throw new UserError('Choose or type a category')
  if (category.length > 60) throw new UserError('Category is too long')
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new UserError('Amount must be more than 0')
  if (!getAccount(db, input.accountId)) throw new UserError('Choose the cash or bank account it was paid from')
  const reference = input.reference.trim()
  if (reference.length > 30) throw new UserError('Bill number is too long')

  // GST on an expense is input credit, and only a registered business can claim it.
  let rateBp = 0
  if (input.taxRateId) {
    const r = db.prepare('SELECT rate_bp FROM tax_rate WHERE id = ?').get(input.taxRateId) as { rate_bp: number } | undefined
    if (!r) throw new UserError('Tax rate not found')
    rateBp = getPreferences(db).gstRegistered ? r.rate_bp : 0
  }
  const tax = applyRate(input.amount, rateBp)
  const { cgst, sgst } = splitHalves(tax)
  const total = input.amount + tax
  const business = getBusiness(db)
  const docId = existing?.id ?? uuid()
  const now = nowIso()
  const snapshot = JSON.stringify({
    name: input.paidTo.trim() || category, paidTo: input.paidTo.trim(), phone: '', gstin: '', stateCode: business.stateCode,
    billingAddress: '', shippingAddress: ''
  })

  db.transaction(() => {
    const values = [
      reference || null, input.date, snapshot, business.stateCode, input.amount, input.amount, cgst, sgst, total, total,
      category, input.accountId, input.notes.trim() || null
    ]
    if (existing) {
      db.prepare(
        `UPDATE document SET number = ?, date = ?, party_snapshot = ?, place_of_supply = ?, subtotal = ?, taxable_total = ?,
           cgst = ?, sgst = ?, grand_total = ?, paid_amount = ?, category = ?, account_id = ?, notes = ?, updated_at = ? WHERE id = ?`
      ).run(...values, now, docId)
      db.prepare('DELETE FROM document_line WHERE document_id = ?').run(docId)
    } else {
      db.prepare(
        `INSERT INTO document (id, doc_type, number, date, party_snapshot, place_of_supply, supply_type, subtotal, taxable_total,
           cgst, sgst, grand_total, paid_amount, balance_due, status, category, account_id, notes, created_at, updated_at)
         VALUES (?, 'EXPENSE', ?, ?, ?, ?, 'intra', ?, ?, ?, ?, ?, ?, 0, 'paid', ?, ?, ?, ?, ?)`
      ).run(docId, ...values, now, now)
    }
    db.prepare(
      `INSERT INTO document_line (id, document_id, line_no, description, qty, rate, taxable_amount, tax_rate_id, tax_rate_bp,
         cgst, sgst, line_total) VALUES (?, ?, 1, ?, 1000, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuid(), docId, category, input.amount, input.amount, input.taxRateId, rateBp, cgst, sgst, total)

    unpost(db, 'document', docId)
    post(db, input.date, 'document', docId, [
      { account: EXPENSE_ACCOUNT, amount: input.amount },
      { account: 'gst_in:cgst', amount: cgst },
      { account: 'gst_in:sgst', amount: sgst },
      { account: bankAccount(input.accountId), amount: -total }
    ])
    audit(db, 'expense', docId, existing ? 'update' : 'create', existing, input)
  })()
  return getExpense(db, docId)
}

export function deleteExpense(db: DB, id: string): void {
  const before = getExpense(db, id)
  db.transaction(() => {
    const now = nowIso()
    db.prepare('UPDATE document SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    unpost(db, 'document', id)
    audit(db, 'expense', id, 'delete', before, null)
  })()
}

/** Expense totals by category for a period, largest first. */
export function expensesByCategory(db: DB, from: string, to: string): { category: string; amount: number }[] {
  return db
    .prepare(
      `SELECT category, SUM(taxable_total) AS amount FROM document
       WHERE doc_type = 'EXPENSE' AND deleted_at IS NULL AND date BETWEEN ? AND ?
       GROUP BY category ORDER BY amount DESC, category`
    )
    .all(from, to) as { category: string; amount: number }[]
}
