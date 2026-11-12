// Recycle bin: everything deleted is only marked deleted, so it can be brought back. Restoring runs the
// normal save again, which re-posts the ledger, puts stock back and re-applies money taken on a bill.
import { BILL_INFO, type BillType } from '@shared/billTypes'
import type { BinEntry, BinKind } from '@shared/data'
import type { Invoice, InvoiceInput } from '@shared/models'
import { lineAmount } from '@shared/qty'
import type { DB } from '../db/connection'
import { UserError } from '../util'
import { audit } from './audit'
import { getExpense, saveExpense } from './expenses'
import { checkStock, getBill, saveBill } from './invoices'
import { bankAccount, partyAccount, post, setOpeningBalance } from './ledger'
import { getPayment, openDocuments, savePayment } from './payments'
import { addMovement, rebuildItemStock } from './stock'

export function listBin(db: DB): BinEntry[] {
  const out: BinEntry[] = []

  const docs = db
    .prepare(
      `SELECT id, doc_type, number, date, grand_total, deleted_at, category, json_extract(party_snapshot, '$.name') AS party
       FROM document WHERE deleted_at IS NOT NULL`
    )
    .all() as { id: string; doc_type: string; number: string | null; date: string; grand_total: number; deleted_at: string; category: string | null; party: string }[]
  for (const d of docs) {
    if (d.doc_type === 'EXPENSE') {
      out.push({ kind: 'expense', id: d.id, billType: null, what: 'Expense', title: d.category ?? '', detail: d.party === d.category ? '' : d.party, amount: d.grand_total, date: d.date, deletedAt: d.deleted_at })
    } else {
      const t = d.doc_type as BillType
      out.push({ kind: 'bill', id: d.id, billType: t, what: BILL_INFO[t].noun, title: d.number || '(no number)', detail: d.party, amount: d.grand_total, date: d.date, deletedAt: d.deleted_at })
    }
  }

  // Money taken on a bill comes back with the bill, so it is not listed on its own.
  const pays = db
    .prepare(
      `SELECT p.id, p.direction, p.number, p.date, p.amount, p.deleted_at, pt.name AS party
       FROM payment p LEFT JOIN party pt ON pt.id = p.party_id WHERE p.deleted_at IS NOT NULL AND p.source_doc_id IS NULL`
    )
    .all() as { id: string; direction: string; number: string; date: string; amount: number; deleted_at: string; party: string | null }[]
  for (const p of pays) {
    out.push({ kind: 'payment', id: p.id, billType: null, what: p.direction === 'in' ? 'Payment received' : 'Payment made', title: p.number, detail: p.party ?? '', amount: p.amount, date: p.date, deletedAt: p.deleted_at })
  }

  for (const p of db.prepare('SELECT id, name, phone, opening_balance, deleted_at, created_at FROM party WHERE deleted_at IS NOT NULL').all() as { id: string; name: string; phone: string | null; opening_balance: number; deleted_at: string; created_at: string }[]) {
    out.push({ kind: 'party', id: p.id, billType: null, what: 'Party', title: p.name, detail: p.phone ?? '', amount: p.opening_balance || null, date: p.created_at.slice(0, 10), deletedAt: p.deleted_at })
  }
  for (const i of db.prepare('SELECT id, name, code, deleted_at, created_at FROM item WHERE deleted_at IS NOT NULL').all() as { id: string; name: string; code: string | null; deleted_at: string; created_at: string }[]) {
    out.push({ kind: 'item', id: i.id, billType: null, what: 'Item', title: i.name, detail: i.code ?? '', amount: null, date: i.created_at.slice(0, 10), deletedAt: i.deleted_at })
  }

  const transfers = db
    .prepare(
      `SELECT t.id, t.date, t.amount, t.notes, t.deleted_at, f.name AS from_name, a.name AS to_name
       FROM account_transfer t JOIN bank_account f ON f.id = t.from_account_id JOIN bank_account a ON a.id = t.to_account_id
       WHERE t.deleted_at IS NOT NULL`
    )
    .all() as { id: string; date: string; amount: number; notes: string | null; deleted_at: string; from_name: string; to_name: string }[]
  for (const t of transfers) {
    out.push({ kind: 'transfer', id: t.id, billType: null, what: 'Transfer', title: `${t.from_name} → ${t.to_name}`, detail: t.notes ?? '', amount: t.amount, date: t.date, deletedAt: t.deleted_at })
  }

  const adjustments = db
    .prepare(
      `SELECT a.id, a.date, a.qty_change, a.rate, a.reason, a.deleted_at, i.name
       FROM stock_adjustment a JOIN item i ON i.id = a.item_id WHERE a.deleted_at IS NOT NULL`
    )
    .all() as { id: string; date: string; qty_change: number; rate: number; reason: string | null; deleted_at: string; name: string }[]
  for (const a of adjustments) {
    out.push({
      kind: 'adjustment', id: a.id, billType: null, what: a.qty_change > 0 ? 'Stock added' : 'Stock reduced', title: a.name,
      detail: a.reason ?? '', amount: lineAmount(Math.abs(a.qty_change), a.rate), date: a.date, deletedAt: a.deleted_at
    })
  }

  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/** The input that would save this bill exactly as it is. */
export function billInput(b: Invoice): InvoiceInput {
  return {
    partyId: b.partyId,
    walkInName: b.partyId ? '' : b.partyName,
    number: b.number,
    date: b.date,
    dueDate: b.dueDate,
    placeOfSupply: b.placeOfSupply,
    pricesIncludeTax: b.pricesIncludeTax,
    lines: b.lines.map((l) => ({
      itemId: l.itemId, description: l.itemId ? '' : l.description, qty: l.qty, unitId: l.unitId, unitFactor: l.unitFactor,
      rate: l.rate, discountPctBp: l.discountPctBp, discountAmount: l.discountAmount, taxRateId: l.taxRateId, hsnSac: l.hsnSac, details: l.details ?? null
    })),
    charges: b.charges.map((c) => ({ name: c.name, amount: c.amount, taxRateId: c.taxRateId })),
    received: b.received ? { amount: b.received.amount, accountId: b.received.accountId, mode: b.received.mode, reference: b.received.reference } : null,
    notes: b.notes,
    terms: b.terms,
    extra: b.extra ?? null,
    linkedId: null
  }
}

function deletedRow<T>(db: DB, table: string, id: string): T {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`).get(id) as T | undefined
  if (!row) throw new UserError('That is no longer in the recycle bin')
  return row
}

export function restoreFromBin(db: DB, kind: BinKind, id: string): void {
  db.transaction(() => {
    switch (kind) {
      case 'bill': return restoreBill(db, id)
      case 'expense': return restoreExpense(db, id)
      case 'payment': return restorePayment(db, id)
      case 'party': return restoreParty(db, id)
      case 'item': return restoreItem(db, id)
      case 'transfer': return restoreTransfer(db, id)
      case 'adjustment': return restoreAdjustment(db, id)
      default: throw new UserError('Unknown kind of entry')
    }
  })()
}

function restoreBill(db: DB, id: string): void {
  const d = deletedRow<{ doc_type: BillType; deleted_at: string; number: string | null }>(db, 'document', id)
  if (d.doc_type === ('EXPENSE' as BillType)) throw new UserError('Restore expenses as expenses')
  db.prepare('UPDATE document SET deleted_at = NULL WHERE id = ?').run(id)
  // Money taken on the bill was removed with it; bring that same payment (and its number) back.
  db.prepare('UPDATE payment SET deleted_at = NULL WHERE source_doc_id = ? AND deleted_at >= ?').run(id, d.deleted_at)
  const bill = getBill(db, d.doc_type, id)
  if (!BILL_INFO[d.doc_type].posts) db.prepare(`UPDATE document SET status = 'open' WHERE id = ?`).run(id)
  saveBill(db, d.doc_type, id, billInput(bill))
  audit(db, 'document', id, 'restore', null, { type: d.doc_type, number: d.number })
}

function restoreExpense(db: DB, id: string): void {
  deletedRow(db, 'document', id)
  db.prepare('UPDATE document SET deleted_at = NULL WHERE id = ?').run(id)
  const e = getExpense(db, id)
  saveExpense(db, id, { date: e.date, category: e.category, amount: e.amount, taxRateId: e.taxRateId, accountId: e.accountId, paidTo: e.paidTo, reference: e.reference, notes: e.notes })
  audit(db, 'expense', id, 'restore', null, { category: e.category, total: e.total })
}

function restorePayment(db: DB, id: string): void {
  deletedRow(db, 'payment', id)
  db.prepare('UPDATE payment SET deleted_at = NULL WHERE id = ?').run(id)
  const p = getPayment(db, id)
  if (!p.partyId) throw new UserError('This payment has no party')
  // Set it against the same bills as before, as far as they are still open.
  const last = db
    .prepare(`SELECT before_json FROM audit_log WHERE entity = 'payment' AND entity_id = ? AND action = 'delete' ORDER BY at DESC LIMIT 1`)
    .get(id) as { before_json: string | null } | undefined
  const before = last?.before_json ? (JSON.parse(last.before_json) as { allocations?: { documentId: string; amount: number }[] }) : {}
  const open = new Map(openDocuments(db, p.partyId, p.direction, id).map((o) => [o.id, o.open]))
  let left = p.amount
  const allocations = (before.allocations ?? [])
    .map((a) => {
      const amount = Math.min(a.amount, open.get(a.documentId) ?? 0, left)
      left -= amount
      return { documentId: a.documentId, amount }
    })
    .filter((a) => a.amount > 0)
  savePayment(db, id, {
    direction: p.direction, partyId: p.partyId, number: p.number, date: p.date, amount: p.amount, accountId: p.accountId,
    mode: p.mode, reference: p.reference, notes: p.notes, allocations
  })
  audit(db, 'payment', id, 'restore', null, { number: p.number, allocations })
}

function restoreParty(db: DB, id: string): void {
  const p = deletedRow<{ name: string; opening_balance: number; opening_date: string | null; created_at: string }>(db, 'party', id)
  if (db.prepare('SELECT 1 FROM party WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL').get(p.name)) {
    throw new UserError(`Another party is already called ${p.name}. Rename it first.`)
  }
  db.prepare('UPDATE party SET deleted_at = NULL WHERE id = ?').run(id)
  if (p.opening_balance) setOpeningBalance(db, partyAccount(id), id, p.opening_balance, p.opening_date || p.created_at.slice(0, 10))
  audit(db, 'party', id, 'restore', null, { name: p.name })
}

function restoreItem(db: DB, id: string): void {
  const i = deletedRow<{ name: string; code: string | null; track_stock: number; opening_qty: number; opening_rate: number; opening_date: string | null; created_at: string }>(db, 'item', id)
  if (db.prepare('SELECT 1 FROM item WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL').get(i.name)) {
    throw new UserError(`Another item is already called ${i.name}. Rename it first.`)
  }
  if (i.code && db.prepare('SELECT 1 FROM item WHERE code = ? AND deleted_at IS NULL').get(i.code)) {
    throw new UserError(`Another item already uses the code ${i.code}`)
  }
  db.prepare('UPDATE item SET deleted_at = NULL WHERE id = ?').run(id)
  if (i.track_stock && i.opening_qty > 0) {
    addMovement(db, id, i.opening_date || i.created_at.slice(0, 10), i.opening_qty, i.opening_rate, 'opening', id)
  }
  rebuildItemStock(db, id)
  audit(db, 'item', id, 'restore', null, { name: i.name })
}

function restoreTransfer(db: DB, id: string): void {
  const t = deletedRow<{ from_account_id: string; to_account_id: string; amount: number; date: string }>(db, 'account_transfer', id)
  db.prepare('UPDATE account_transfer SET deleted_at = NULL WHERE id = ?').run(id)
  post(db, t.date, 'transfer', id, [
    { account: bankAccount(t.to_account_id), amount: t.amount },
    { account: bankAccount(t.from_account_id), amount: -t.amount }
  ])
  audit(db, 'account_transfer', id, 'restore', null, t)
}

function restoreAdjustment(db: DB, id: string): void {
  const a = deletedRow<{ item_id: string; date: string; qty_change: number; rate: number }>(db, 'stock_adjustment', id)
  if (!db.prepare('SELECT 1 FROM item WHERE id = ? AND deleted_at IS NULL').get(a.item_id)) throw new UserError('Restore the item first')
  db.prepare('UPDATE stock_adjustment SET deleted_at = NULL WHERE id = ?').run(id)
  addMovement(db, a.item_id, a.date, a.qty_change, a.qty_change > 0 ? a.rate : 0, 'adjustment', id)
  rebuildItemStock(db, a.item_id)
  checkStock(db, [a.item_id])
  audit(db, 'stock_adjustment', id, 'restore', null, a)
}
