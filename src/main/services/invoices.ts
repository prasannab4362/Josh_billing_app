import { billExtraError, cleanBillExtra, type BillExtra } from '@shared/features'
import { cleanDetails, lineDetailsError, type LineDetails } from '@shared/itemFields'
// Every bill-like document: invoices, purchase bills, credit/debit notes, estimates, orders and
// challans. Save (with GST, numbering, ledger, stock and money taken), read, delete.
// Every save runs in one transaction; the totals are always recomputed here.

import { fyFor, todayLocal } from '@shared/fy'
import { BILL_INFO, BILL_TYPES, payDirection, type BillInfo } from '@shared/billTypes'
import type { NumberedType } from '@shared/docTypes'
import type {
  BillLink,
  BillType,
  Invoice,
  InvoiceCharge,
  InvoiceInput,
  InvoiceLine,
  InvoiceStatus,
  InvoiceSummary,
  PartySnapshot,
  PaymentMode
} from '@shared/models'
import type { InvoiceFilter } from '@shared/ipc'
import { toBaseUnits } from '@shared/qty'
import { isStateCode } from '@shared/states'
import { computeTax, perBaseUnit, type TaxResult } from '@shared/tax'
import type { DB } from '../db/connection'
import { nowIso, toBool, toInt, UserError, uuid } from '../util'
import { getAccount } from './accounts'
import { audit } from './audit'
import { getBusiness } from './business'
import { bankAccount, partyAccount, post, unpost } from './ledger'
import { peekNumber, takeNumber } from './numberSeries'
import { getParty } from './parties'
import { getPreferences } from './settings'
import { addMovement, rebuildItemStock, removeMovements } from './stock'


/**
 * How each bill type books. A purchase bill is a sale invoice with every sign flipped: we owe the
 * party, stock comes in, GST is input credit, and money paid now goes out. A credit note flips a
 * sale invoice; a debit note flips a purchase bill. Quotes, orders and challans do not post at all.
 */
interface Config extends BillInfo {
  main: 'sales' | 'purchase'
  tax: 'gst_out' | 'gst_in'
  pay: 'in' | 'out'
  series: 'PAYMENT_IN' | 'PAYMENT_OUT'
}
const CONFIG = Object.fromEntries(
  BILL_TYPES.map((t): [BillType, Config] => {
    const i = BILL_INFO[t]
    const pay = payDirection(t)
    return [t, { ...i, main: i.side === 'sale' ? 'sales' : 'purchase', tax: i.side === 'sale' ? 'gst_out' : 'gst_in', pay, series: pay === 'in' ? 'PAYMENT_IN' : 'PAYMENT_OUT' }]
  })
) as Record<BillType, Config>

const DOC = 'SALE_INVOICE'
export const WALK_IN_ACCOUNT = 'party:walkin'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MODES: PaymentMode[] = ['cash', 'upi', 'bank', 'cheque', 'card']

const numberTaken = (db: DB, selfId: string | null, type: BillType = DOC, partyId: string | null = null) => (number: string) =>
  type === 'PURCHASE_BILL'
    ? // Suppliers number their own bills, so a number only has to be unique per supplier.
      !!db
        .prepare('SELECT 1 FROM document WHERE doc_type = ? AND number = ? AND party_id IS ? AND deleted_at IS NULL AND id IS NOT ?')
        .get(type, number, partyId, selfId)
    : !!db.prepare('SELECT 1 FROM document WHERE doc_type = ? AND number = ? AND id IS NOT ?').get(type, number, selfId)

const paymentNumberTaken = (db: DB, direction: 'in' | 'out') => (number: string) =>
  !!db.prepare('SELECT 1 FROM payment WHERE direction = ? AND number = ?').get(direction, number)

/** The number the next new bill of this type dated `date` would get ('' when not numbered by us). */
export function nextBillNumber(db: DB, type: BillType, date: string): string {
  if (!CONFIG[type].numbered) return ''
  const fy = fyFor(DATE.test(date) ? date : todayLocal(), getBusiness(db).fyStartMonth)
  return peekNumber(db, type as NumberedType, fy, numberTaken(db, null, type))
}

export function nextInvoiceNumber(db: DB, date: string): string {
  return nextBillNumber(db, DOC, date)
}

// ---------- Resolving the input against the database ----------

interface ResolvedLine {
  itemId: string | null
  itemName: string
  description: string
  qty: number
  unitId: string | null
  unitFactor: number
  baseQty: number
  rate: number
  discountPctBp: number
  discountAmount: number
  taxRateId: string | null
  taxRateBp: number
  cessBp: number
  hsnSac: string
  details: LineDetails | null
  stocked: boolean
}

interface ItemInfo {
  id: string
  name: string
  kind: 'goods' | 'service'
  track_stock: number
  base_unit_id: string | null
  alt_unit_id: string | null
  alt_conversion: number | null
  hsn_sac: string | null
}

function taxRate(db: DB, id: string | null, registered: boolean): { bp: number; cess: number } {
  if (!id) return { bp: 0, cess: 0 }
  const r = db.prepare('SELECT rate_bp, cess_bp FROM tax_rate WHERE id = ?').get(id) as
    | { rate_bp: number; cess_bp: number }
    | undefined
  if (!r) throw new UserError('Tax rate not found')
  // An unregistered business cannot charge GST.
  return registered ? { bp: r.rate_bp, cess: r.cess_bp } : { bp: 0, cess: 0 }
}

function resolveLines(db: DB, input: InvoiceInput, registered: boolean): ResolvedLine[] {
  if (input.lines.length === 0) throw new UserError('Add at least one item')
  if (input.lines.length > 500) throw new UserError('A bill can have at most 500 lines')
  return input.lines.map((l, idx) => {
    const n = idx + 1
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new UserError(`Line ${n}: quantity must be more than 0`)
    if (!Number.isInteger(l.rate) || l.rate < 0) throw new UserError(`Line ${n}: enter a valid price`)
    if (!Number.isInteger(l.discountPctBp) || l.discountPctBp < 0 || l.discountPctBp > 10_000) {
      throw new UserError(`Line ${n}: discount must be 0–100%`)
    }
    if (!Number.isInteger(l.discountAmount) || l.discountAmount < 0) throw new UserError(`Line ${n}: invalid discount`)

    let item: ItemInfo | undefined
    let unitFactor = 1000
    if (l.itemId) {
      item = db
        .prepare(
          `SELECT id, name, kind, track_stock, base_unit_id, alt_unit_id, alt_conversion, hsn_sac
           FROM item WHERE id = ? AND deleted_at IS NULL`
        )
        .get(l.itemId) as ItemInfo | undefined
      if (!item) throw new UserError(`Line ${n}: item not found`)
      // The unit decides the conversion; never trust a factor sent from the screen.
      if (l.unitId && l.unitId === item.alt_unit_id && item.alt_conversion) unitFactor = item.alt_conversion
      else if (l.unitId && l.unitId !== item.base_unit_id) throw new UserError(`Line ${n}: that unit is not set up for ${item.name}`)
    } else if (!l.description.trim()) {
      throw new UserError(`Line ${n}: choose an item or type a description`)
    }
    if (l.unitId && !db.prepare('SELECT 1 FROM unit WHERE id = ?').get(l.unitId)) throw new UserError(`Line ${n}: unit not found`)
    const tax = taxRate(db, l.taxRateId, registered)
    const hsn = l.hsnSac.trim() || item?.hsn_sac || ''
    if (hsn && !/^\d{4}(\d{2}){0,2}$/.test(hsn)) throw new UserError(`Line ${n}: HSN/SAC should be 4, 6 or 8 digits`)
    const detailsProblem = lineDetailsError(l.details ?? undefined)
    if (detailsProblem) throw new UserError(`Line ${n}: ${detailsProblem}`)
    return {
      itemId: item?.id ?? null,
      itemName: item?.name ?? '',
      description: l.description.trim() || item?.name || '',
      qty: l.qty,
      unitId: l.unitId,
      unitFactor,
      baseQty: toBaseUnits(l.qty, unitFactor),
      rate: l.rate,
      discountPctBp: l.discountPctBp,
      discountAmount: l.discountPctBp > 0 ? 0 : l.discountAmount,
      taxRateId: l.taxRateId,
      taxRateBp: tax.bp,
      cessBp: tax.cess,
      hsnSac: hsn,
      details: cleanDetails(l.details ?? undefined),
      stocked: !!item && item.kind === 'goods' && toBool(item.track_stock)
    }
  })
}

interface Header {
  partyId: string | null
  snapshot: PartySnapshot
  number: string
  date: string
  dueDate: string
  placeOfSupply: string
  supplyType: 'intra' | 'inter'
}

function resolveHeader(db: DB, type: BillType, input: InvoiceInput, businessState: string, defaultDueDays: number): Header {
  const noun = CONFIG[type].noun.toLowerCase()
  if (!DATE.test(input.date)) throw new UserError(`Choose the ${noun} date`)
  const c = CONFIG[type]
  if (!c.walkIn && !input.partyId) throw new UserError(c.side === 'purchase' ? 'Choose the supplier' : 'Choose the party')
  let snapshot: PartySnapshot
  let termDays = defaultDueDays
  if (input.partyId) {
    const p = getParty(db, input.partyId)
    snapshot = {
      name: p.name,
      phone: p.phone,
      gstin: p.gstin,
      stateCode: p.stateCode,
      billingAddress: p.billingAddress,
      shippingAddress: p.shippingAddress
    }
    if (p.paymentTermDays !== null) termDays = p.paymentTermDays
  } else {
    const name = input.walkInName.trim() || 'Cash sale'
    snapshot = { name, phone: '', gstin: '', stateCode: '', billingAddress: '', shippingAddress: '' }
  }
  // Sales: supply is to the customer's state. Purchases: goods come to us, and the tax type
  // depends on whether the supplier is in our state.
  const placeOfSupply = input.placeOfSupply || (c.side === 'sale' ? snapshot.stateCode : '') || businessState
  if (!isStateCode(placeOfSupply)) throw new UserError('Choose the place of supply')
  const supplierState = snapshot.stateCode || businessState
  let dueDate = input.dueDate
  if (!dueDate) {
    const d = new Date(`${input.date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + termDays)
    dueDate = d.toISOString().slice(0, 10)
  }
  if (!DATE.test(dueDate)) throw new UserError('Choose a valid due date')
  if (dueDate < input.date) throw new UserError(`Due date cannot be before the ${noun} date`)
  const number = input.number.trim()
  if (number.length > 30 || /[\r\n]/.test(number)) throw new UserError(`${CONFIG[type].noun} number is too long`)
  return {
    partyId: input.partyId,
    snapshot,
    number,
    date: input.date,
    dueDate,
    placeOfSupply,
    supplyType:
      c.side === 'sale'
        ? placeOfSupply === businessState ? 'intra' : 'inter'
        : supplierState === placeOfSupply ? 'intra' : 'inter'
  }
}

// ---------- Saving ----------

/** Money and returns set against this bill other than what was taken on the bill itself. */
function otherPaymentsTotal(db: DB, docId: string): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(a.amount), 0) AS n FROM payment_allocation a JOIN payment p ON p.id = a.payment_id
       WHERE a.document_id = ? AND p.deleted_at IS NULL AND p.source_doc_id IS NOT ?`
    )
    .get(docId, docId) as { n: number }
  return r.n + returnedAgainst(db, docId)
}

/** Total of credit/debit notes set off against a bill. */
function returnedAgainst(db: DB, docId: string): number {
  return (
    db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM document_link WHERE to_doc_id = ? AND kind = 'returned_against'`)
      .get(docId) as { n: number }
  ).n
}

function sourcePayment(db: DB, docId: string): { id: string; number: string } | undefined {
  return db.prepare('SELECT id, number FROM payment WHERE source_doc_id = ? AND deleted_at IS NULL').get(docId) as
    | { id: string; number: string }
    | undefined
}

function removeSourcePayment(db: DB, docId: string): void {
  const p = sourcePayment(db, docId)
  if (!p) return
  const now = nowIso()
  db.prepare('UPDATE payment SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, p.id)
  db.prepare('DELETE FROM payment_allocation WHERE payment_id = ?').run(p.id)
  unpost(db, 'payment', p.id)
}

/** Money taken (or paid) while billing becomes an ordinary payment, allocated to this bill. */
function writeSourcePayment(db: DB, type: BillType, docId: string, h: Header, received: InvoiceInput['received'], fy: string): void {
  const c = CONFIG[type]
  if (!received || received.amount === 0) return removeSourcePayment(db, docId)
  const now = nowIso()
  let p = sourcePayment(db, docId)
  if (p) {
    db.prepare(
      `UPDATE payment SET date = ?, party_id = ?, amount = ?, account_id = ?, mode = ?, reference = ?, updated_at = ? WHERE id = ?`
    ).run(h.date, h.partyId, received.amount, received.accountId, received.mode, received.reference.trim() || null, now, p.id)
    unpost(db, 'payment', p.id)
  } else {
    const { number } = takeNumber(db, c.series, fy, paymentNumberTaken(db, c.pay))
    p = { id: uuid(), number }
    db.prepare(
      `INSERT INTO payment (id, direction, number, date, party_id, amount, account_id, mode, reference, source_doc_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(p.id, c.pay, number, h.date, h.partyId, received.amount, received.accountId, received.mode, received.reference.trim() || null, docId, now, now)
  }
  db.prepare(
    `INSERT INTO payment_allocation (payment_id, document_id, amount) VALUES (?,?,?)
     ON CONFLICT(payment_id, document_id) DO UPDATE SET amount = excluded.amount`
  ).run(p.id, docId, received.amount)
  const party = h.partyId ? partyAccount(h.partyId) : WALK_IN_ACCOUNT
  post(db, h.date, 'payment', p.id, [
    { account: bankAccount(received.accountId), amount: c.sign * received.amount },
    { account: party, amount: -c.sign * received.amount }
  ])
}

function postBill(db: DB, type: BillType, docId: string, h: Header, t: TaxResult): void {
  const { sign, main, tax } = CONFIG[type]
  unpost(db, 'document', docId)
  post(db, h.date, 'document', docId, [
    { account: h.partyId ? partyAccount(h.partyId) : WALK_IN_ACCOUNT, amount: sign * t.grandTotal },
    { account: main, amount: -sign * (t.taxableTotal + t.chargesTotal) },
    { account: `${tax}:cgst`, amount: -sign * t.cgst },
    { account: `${tax}:sgst`, amount: -sign * t.sgst },
    { account: `${tax}:igst`, amount: -sign * t.igst },
    { account: `${tax}:cess`, amount: -sign * t.cess },
    { account: 'round_off', amount: -sign * t.roundOff }
  ])
}

/** With negative stock turned off, refuse any change that leaves a touched item below zero. */
export function checkStock(db: DB, items: Iterable<string>): void {
  if (getPreferences(db).allowNegativeStock) return
  for (const itemId of items) {
    const s = db
      .prepare('SELECT s.qty, i.name FROM item_stock s JOIN item i ON i.id = s.item_id WHERE s.item_id = ?')
      .get(itemId) as { qty: number; name: string } | undefined
    if (s && s.qty < 0) throw new UserError(`Not enough stock of ${s.name}`)
  }
}

/** Paid = payments allocated to it + returns set off against it (or, for a return, set off by it). */
export function refreshPaid(db: DB, docId: string, grandTotal: number): void {
  const r = db
    .prepare(
      `SELECT COALESCE((SELECT SUM(a.amount) FROM payment_allocation a JOIN payment p ON p.id = a.payment_id
                        WHERE a.document_id = @id AND p.deleted_at IS NULL), 0)
            + COALESCE((SELECT SUM(amount) FROM document_link
                        WHERE kind = 'returned_against' AND (from_doc_id = @id OR to_doc_id = @id)), 0) AS paid`
    )
    .get({ id: docId }) as { paid: number }
  const balance = grandTotal - r.paid
  const status = r.paid === 0 ? (grandTotal === 0 ? 'paid' : 'unpaid') : balance <= 0 ? 'paid' : 'partial'
  db.prepare('UPDATE document SET paid_amount = ?, balance_due = ?, status = ? WHERE id = ?').run(r.paid, balance, status, docId)
}

/** Recompute paid amount, balance and status of any document from its payment allocations. */
export function refreshDocumentPaid(db: DB, docId: string): void {
  const r = db.prepare('SELECT grand_total FROM document WHERE id = ?').get(docId) as { grand_total: number } | undefined
  if (r) refreshPaid(db, docId, r.grand_total)
}

function stockedItemsOf(db: DB, docId: string): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT item_id FROM stock_movement WHERE source_type = 'document' AND source_id = ?`)
    .all(docId) as { item_id: string }[]
  return rows.map((r) => r.item_id)
}

/** Check the bill a new one is converted from or returns against. */
function checkLink(db: DB, type: BillType, linkedId: string | null, partyId: string | null): { id: string; kind: 'converted' | 'returned' } | null {
  if (!linkedId) return null
  const c = CONFIG[type]
  const src = db
    .prepare('SELECT id, doc_type, number, party_id, status FROM document WHERE id = ? AND deleted_at IS NULL')
    .get(linkedId) as { id: string; doc_type: BillType; number: string | null; party_id: string | null; status: string } | undefined
  if (!src) throw new UserError('The bill this is based on was not found')
  if (c.returnOf) {
    if (src.doc_type !== c.returnOf) throw new UserError(`A ${c.noun.toLowerCase()} can only be made against a ${CONFIG[c.returnOf].noun.toLowerCase()}`)
    if (src.party_id !== partyId) throw new UserError(`The party must be the same as on ${src.number || 'the original bill'}`)
    return { id: src.id, kind: 'returned' }
  }
  const from = CONFIG[src.doc_type]
  if (!from?.convertsTo.includes(type)) throw new UserError(`A ${from?.noun.toLowerCase() ?? 'bill'} cannot be turned into a ${c.noun.toLowerCase()}`)
  if (src.status === 'converted') throw new UserError(`${from.noun} ${src.number ?? ''} has already been converted`)
  return { id: src.id, kind: 'converted' }
}

/**
 * A credit/debit note first reduces what is still due on the bill it returns against; anything
 * beyond that stays open on the note (to refund, or to set off against later bills).
 */
function setOffReturn(db: DB, docId: string, newTarget: string | null, available: number): void {
  const old = db
    .prepare(`SELECT to_doc_id FROM document_link WHERE from_doc_id = ? AND kind = 'returned_against'`)
    .get(docId) as { to_doc_id: string } | undefined
  const target = old?.to_doc_id ?? newTarget
  if (!target) return
  db.prepare(`DELETE FROM document_link WHERE from_doc_id = ? AND kind = 'returned_against'`).run(docId)
  refreshDocumentPaid(db, target)
  const open = (db.prepare('SELECT balance_due FROM document WHERE id = ?').get(target) as { balance_due: number }).balance_due
  const amount = Math.max(0, Math.min(available, open))
  db.prepare(`INSERT INTO document_link (from_doc_id, to_doc_id, kind, amount, created_at) VALUES (?, ?, 'returned_against', ?, ?)`)
    .run(docId, target, amount, nowIso())
  refreshDocumentPaid(db, target)
}

export function saveInvoice(db: DB, id: string | null, input: InvoiceInput): Invoice {
  return saveBill(db, 'SALE_INVOICE', id, input)
}

export function savePurchase(db: DB, id: string | null, input: InvoiceInput): Invoice {
  return saveBill(db, 'PURCHASE_BILL', id, input)
}

export function saveBill(db: DB, type: BillType, id: string | null, input: InvoiceInput): Invoice {
  const c = CONFIG[type]
  const noun = c.noun.toLowerCase()
  const business = getBusiness(db)
  const prefs = getPreferences(db)
  const existing = id ? getBill(db, type, id) : null

  const h = resolveHeader(db, type, input, business.stateCode, prefs.defaultDueDays)
  const lines = resolveLines(db, input, prefs.gstRegistered)
  const charges = input.charges
    .filter((c) => c.name.trim() || c.amount)
    .map((c) => {
      if (!c.name.trim()) throw new UserError('Give each additional charge a name')
      if (!Number.isInteger(c.amount) || c.amount < 0) throw new UserError(`Enter a valid amount for ${c.name.trim()}`)
      const tax = taxRate(db, c.taxRateId, prefs.gstRegistered)
      return { name: c.name.trim(), amount: c.amount, taxRateId: c.taxRateId, taxRateBp: tax.bp }
    })
  const t = computeTax({
    lines,
    charges: charges.map((c) => ({ amount: c.amount, taxRateBp: c.taxRateBp })),
    pricesIncludeTax: input.pricesIncludeTax,
    supply: h.supplyType,
    roundOff: prefs.roundOff
  })

  const received = input.received && input.received.amount > 0 ? input.received : null
  if (received && !c.posts) throw new UserError(`Money is not taken on a ${c.noun.toLowerCase()}. Record it on the invoice or as a payment.`)
  if (received) {
    if (!Number.isInteger(received.amount)) throw new UserError(`Enter a valid ${c.paidWord.toLowerCase()} amount`)
    if (!getAccount(db, received.accountId)) throw new UserError('Choose the cash or bank account')
    if (!MODES.includes(received.mode)) throw new UserError('Choose how the money was paid')
  }
  const receivedAmount = received?.amount ?? 0
  const others = existing ? otherPaymentsTotal(db, existing.id) : 0
  if (receivedAmount + others > t.grandTotal) {
    throw new UserError(
      others > 0
        ? `Payments already recorded against this ${noun} are more than its new total`
        : `${c.paidWord} amount is more than the ${noun} total`
    )
  }
  if (!h.partyId && c.posts && receivedAmount !== t.grandTotal) {
    throw new UserError('A cash sale must be paid in full. Choose a party to give credit.')
  }

  const fy = fyFor(h.date, business.fyStartMonth)
  const now = nowIso()
  const docId = existing?.id ?? uuid()
  const link = existing ? null : checkLink(db, type, input.linkedId ?? null, h.partyId)
  const extraProblem = billExtraError(input.extra)
  if (extraProblem) throw new UserError(extraProblem)
  const extra = cleanBillExtra(input.extra)

  db.transaction(() => {
    // Number: keep the existing one, use the one typed in, or take the next from the series.
    let number = c.numbered ? h.number || existing?.number || '' : h.number
    let seriesId: string | null = null
    const taken = numberTaken(db, existing?.id ?? null, type, h.partyId)
    if (c.numbered && !existing && (!number || number === peekNumber(db, type as NumberedType, fy, taken))) {
      ;({ number, seriesId } = takeNumber(db, type as NumberedType, fy, taken))
    } else if (number && taken(number)) {
      throw new UserError(
        type === 'PURCHASE_BILL' ? `Bill ${number} from this supplier is already entered` : `${c.noun} number ${number} is already used`
      )
    }

    const header = [
      number || null, h.date, h.dueDate, h.partyId, JSON.stringify(h.snapshot), h.placeOfSupply, h.supplyType,
      toInt(input.pricesIncludeTax), t.subtotal, t.discountTotal, t.taxableTotal, t.cgst, t.sgst, t.igst, t.cess,
      t.chargesTotal, t.roundOff, t.grandTotal, input.notes.trim() || null, input.terms.trim() || null
    ]
    const cols = `number, date, due_date, party_id, party_snapshot, place_of_supply, supply_type, prices_include_tax,
      subtotal, discount_total, taxable_total, cgst, sgst, igst, cess, charges_total, round_off, grand_total, notes, terms`
    if (existing) {
      const sets = cols.split(',').map((c) => `${c.trim()} = ?`).join(', ')
      db.prepare(`UPDATE document SET ${sets}, updated_at = ? WHERE id = ?`).run(...header, now, docId)
      db.prepare('DELETE FROM document_line WHERE document_id = ?').run(docId)
      db.prepare('DELETE FROM document_charge WHERE document_id = ?').run(docId)
    } else {
      db.prepare(
        `INSERT INTO document (id, doc_type, series_id, ${cols}, created_at, updated_at)
         VALUES (?, ?, ?, ${Array(20).fill('?').join(', ')}, ?, ?)`
      ).run(docId, type, seriesId, ...header, now, now)
    }

    db.prepare('UPDATE document SET extra = ? WHERE id = ?').run(extra ? JSON.stringify(extra) : null, docId)

    const insertLine = db.prepare(
      `INSERT INTO document_line (id, document_id, line_no, item_id, description, qty, unit_id, unit_factor, rate,
         discount_pct_bp, discount_amount, taxable_amount, tax_rate_id, tax_rate_bp, cgst, sgst, igst, cess, line_total, hsn_sac, details)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    lines.forEach((l, i) => {
      const r = t.lines[i]
      insertLine.run(
        uuid(), docId, i + 1, l.itemId, l.description, l.qty, l.unitId, l.unitFactor, l.rate, l.discountPctBp,
        r.discount, r.taxable, l.taxRateId, l.taxRateBp, r.cgst, r.sgst, r.igst, r.cess, r.total, l.hsnSac || null,
        l.details ? JSON.stringify(l.details) : null
      )
    })
    const insertCharge = db.prepare(
      'INSERT INTO document_charge (id, document_id, name, amount, tax_rate_id, tax_amount) VALUES (?,?,?,?,?,?)'
    )
    charges.forEach((c, i) => insertCharge.run(uuid(), docId, c.name, c.amount, c.taxRateId, t.charges[i].tax))

    if (link?.kind === 'converted') {
      db.prepare(`INSERT INTO document_link (from_doc_id, to_doc_id, kind, created_at) VALUES (?, ?, 'converted', ?)`).run(docId, link.id, now)
      db.prepare(`UPDATE document SET status = 'converted', updated_at = ? WHERE id = ?`).run(now, link.id)
    }

    if (c.posts) {
      postBill(db, type, docId, h, t)

      // Stock goes out on a sale and comes in on a purchase (returns the other way), at cost before tax.
      const touched = new Set(stockedItemsOf(db, docId))
      removeMovements(db, 'document', docId)
      lines.forEach((l, i) => {
        if (!l.stocked || !l.itemId) return
        addMovement(db, l.itemId, h.date, -c.sign * l.baseQty, perBaseUnit(t.lines[i].taxable, l.baseQty), 'document', docId)
        touched.add(l.itemId)
      })
      for (const itemId of touched) rebuildItemStock(db, itemId)
      checkStock(db, touched)

      writeSourcePayment(db, type, docId, h, received, fy)
      if (c.returnOf) setOffReturn(db, docId, link?.id ?? null, t.grandTotal - receivedAmount)
      refreshPaid(db, docId, t.grandTotal)
    } else if (!existing) {
      db.prepare(`UPDATE document SET status = 'open', paid_amount = 0, balance_due = 0 WHERE id = ?`).run(docId)
    } else {
      db.prepare('UPDATE document SET paid_amount = 0, balance_due = 0 WHERE id = ?').run(docId)
    }
    audit(db, 'document', docId, existing ? 'update' : 'create', existing, { ...input, number })
  })()

  return getBill(db, type, docId)
}

export function deleteInvoice(db: DB, id: string): void {
  deleteBill(db, 'SALE_INVOICE', id)
}

export function deletePurchase(db: DB, id: string): void {
  deleteBill(db, 'PURCHASE_BILL', id)
}

export function deleteBill(db: DB, type: BillType, id: string): void {
  const before = getBill(db, type, id)
  const noun = CONFIG[type].noun.toLowerCase()
  if (returnedAgainst(db, id) > 0) throw new UserError(`A return is set against this ${noun}. Delete the return first.`)
  if (otherPaymentsTotal(db, id) > 0) {
    throw new UserError(`Payments are recorded against this ${noun}. Remove them before deleting it.`)
  }
  db.transaction(() => {
    const now = nowIso()
    db.prepare('UPDATE document SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
    unpost(db, 'document', id)
    const items = stockedItemsOf(db, id)
    removeMovements(db, 'document', id)
    for (const itemId of items) rebuildItemStock(db, itemId)
    // Deleting a purchase takes its stock back out; that must not oversell what was already sold.
    checkStock(db, items)
    removeSourcePayment(db, id)
    // Undo links: a return frees the bill it was set against; a converted estimate/order opens again.
    const links = db.prepare('SELECT to_doc_id, kind FROM document_link WHERE from_doc_id = ?').all(id) as { to_doc_id: string; kind: string }[]
    db.prepare('DELETE FROM document_link WHERE from_doc_id = ? OR to_doc_id = ?').run(id, id)
    for (const l of links) {
      if (l.kind === 'returned_against') refreshDocumentPaid(db, l.to_doc_id)
      else if (!db.prepare(`SELECT 1 FROM document_link WHERE to_doc_id = ? AND kind = 'converted'`).get(l.to_doc_id)) {
        db.prepare(`UPDATE document SET status = 'open', updated_at = ? WHERE id = ?`).run(now, l.to_doc_id)
      }
    }
    audit(db, 'document', id, 'delete', before, null)
  })()
}

// ---------- Reading ----------

interface DocRow {
  id: string
  doc_type: BillType
  number: string | null
  date: string
  due_date: string | null
  party_id: string | null
  party_snapshot: string
  place_of_supply: string
  supply_type: 'intra' | 'inter'
  prices_include_tax: number
  subtotal: number
  discount_total: number
  taxable_total: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  charges_total: number
  round_off: number
  grand_total: number
  paid_amount: number
  balance_due: number
  status: InvoiceStatus
  notes: string | null
  terms: string | null
  created_at: string
  updated_at: string
  extra: string | null
}

function statusOf(r: DocRow, today: string): InvoiceStatus {
  // Only invoices and bills fall due; an open credit note or estimate is never "overdue".
  const dueType = r.doc_type === 'SALE_INVOICE' || r.doc_type === 'PURCHASE_BILL'
  if (dueType && (r.status === 'unpaid' || r.status === 'partial') && r.due_date && r.due_date < today) return 'overdue'
  return r.status
}

function summary(r: DocRow, today: string): InvoiceSummary {
  const snap = JSON.parse(r.party_snapshot) as PartySnapshot
  return {
    id: r.id,
    type: r.doc_type,
    number: r.number ?? '',
    date: r.date,
    dueDate: r.due_date ?? '',
    partyId: r.party_id,
    partyName: snap.name,
    grandTotal: r.grand_total,
    paidAmount: r.paid_amount,
    balanceDue: r.balance_due,
    status: statusOf(r, today)
  }
}


export function listInvoices(db: DB, filter: InvoiceFilter = {}, today = todayLocal()): InvoiceSummary[] {
  return listBills(db, 'SALE_INVOICE', filter, today)
}

export function listPurchases(db: DB, filter: InvoiceFilter = {}, today = todayLocal()): InvoiceSummary[] {
  return listBills(db, 'PURCHASE_BILL', filter, today)
}

export function listBills(db: DB, type: BillType, filter: InvoiceFilter = {}, today = todayLocal()): InvoiceSummary[] {
  const where = ['doc_type = ?', 'deleted_at IS NULL']
  const args: string[] = [type]
  if (filter.from) (where.push('date >= ?'), args.push(filter.from))
  if (filter.to) (where.push('date <= ?'), args.push(filter.to))
  if (filter.partyId) (where.push('party_id = ?'), args.push(filter.partyId))
  const rows = db
    .prepare(`SELECT * FROM document WHERE ${where.join(' AND ')} ORDER BY date DESC, created_at DESC`)
    .all(...args) as DocRow[]
  return rows.map((r) => summary(r, today))
}

export function getInvoice(db: DB, id: string, today = todayLocal()): Invoice {
  return getBill(db, 'SALE_INVOICE', id, today)
}

export function getPurchase(db: DB, id: string, today = todayLocal()): Invoice {
  return getBill(db, 'PURCHASE_BILL', id, today)
}

export function getBill(db: DB, type: BillType, id: string, today = todayLocal()): Invoice {
  const r = db
    .prepare('SELECT * FROM document WHERE id = ? AND doc_type = ? AND deleted_at IS NULL')
    .get(id, type) as DocRow | undefined
  if (!r) throw new UserError(`${CONFIG[type].noun} not found`)

  const lineRows = db
    .prepare(
      `SELECT l.*, i.name AS item_name, i.description AS item_description, i.extra AS item_extra, u.short AS unit_short, COALESCE(t.cess_bp, 0) AS cess_bp
       FROM document_line l
       LEFT JOIN item i ON i.id = l.item_id
       LEFT JOIN unit u ON u.id = l.unit_id
       LEFT JOIN tax_rate t ON t.id = l.tax_rate_id
       WHERE l.document_id = ? ORDER BY l.line_no`
    )
    .all(id) as Record<string, never>[]
  const lines: InvoiceLine[] = lineRows.map((l: Record<string, any>) => ({
    id: l.id,
    itemId: l.item_id,
    itemName: l.item_name ?? '',
    itemDescription: l.item_description ?? '',
    itemCustomFields: l.item_extra ? (JSON.parse(l.item_extra) as string[]) : null,
    description: l.description ?? '',
    qty: l.qty,
    unitId: l.unit_id,
    unitShort: l.unit_short ?? '',
    unitFactor: l.unit_factor,
    rate: l.rate,
    discountPctBp: l.discount_pct_bp,
    discountAmount: l.discount_amount,
    taxRateId: l.tax_rate_id,
    taxRateBp: l.tax_rate_bp,
    cessBp: l.cess > 0 ? l.cess_bp : 0,
    hsnSac: l.hsn_sac ?? '',
    details: l.details ? (JSON.parse(l.details) as LineDetails) : null,
    taxable: l.taxable_amount,
    cgst: l.cgst,
    sgst: l.sgst,
    igst: l.igst,
    cess: l.cess,
    total: l.line_total
  }))

  const chargeRows = db
    .prepare(
      `SELECT c.name, c.amount, c.tax_rate_id, c.tax_amount, COALESCE(t.rate_bp, 0) AS rate_bp
       FROM document_charge c LEFT JOIN tax_rate t ON t.id = c.tax_rate_id WHERE c.document_id = ? ORDER BY c.rowid`
    )
    .all(id) as { name: string; amount: number; tax_rate_id: string | null; tax_amount: number; rate_bp: number }[]
  const charges: InvoiceCharge[] = chargeRows.map((c) => ({
    name: c.name,
    amount: c.amount,
    taxRateId: c.tax_rate_id,
    taxRateBp: c.tax_amount > 0 ? c.rate_bp : 0,
    tax: c.tax_amount
  }))

  const pay = db
    .prepare(
      `SELECT id, number, amount, account_id, mode, reference FROM payment WHERE source_doc_id = ? AND deleted_at IS NULL`
    )
    .get(id) as { id: string; number: string; amount: number; account_id: string; mode: PaymentMode; reference: string | null } | undefined

  return {
    ...summary(r, today),
    party: JSON.parse(r.party_snapshot) as PartySnapshot,
    placeOfSupply: r.place_of_supply,
    supplyType: r.supply_type,
    pricesIncludeTax: toBool(r.prices_include_tax),
    lines,
    charges,
    subtotal: r.subtotal,
    discountTotal: r.discount_total,
    taxableTotal: r.taxable_total,
    chargesTotal: r.charges_total,
    cgst: r.cgst,
    sgst: r.sgst,
    igst: r.igst,
    cess: r.cess,
    roundOff: r.round_off,
    received: pay
      ? { paymentId: pay.id, number: pay.number, amount: pay.amount, accountId: pay.account_id, mode: pay.mode, reference: pay.reference ?? '' }
      : null,
    notes: r.notes ?? '',
    extra: r.extra ? (JSON.parse(r.extra) as BillExtra) : null,
    terms: r.terms ?? '',
    links: billLinks(db, id),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function billLinks(db: DB, id: string): BillLink[] {
  const rows = db
    .prepare(
      `SELECT l.kind, l.amount, l.from_doc_id, d.id, d.doc_type, d.number, d.date, d.grand_total
       FROM document_link l JOIN document d ON d.id = CASE WHEN l.from_doc_id = @id THEN l.to_doc_id ELSE l.from_doc_id END
       WHERE (l.from_doc_id = @id OR l.to_doc_id = @id) AND d.deleted_at IS NULL
       ORDER BY d.date, d.created_at`
    )
    .all({ id }) as { kind: string; amount: number; from_doc_id: string; id: string; doc_type: BillType; number: string | null; date: string; grand_total: number }[]
  return rows.map((r) => ({
    id: r.id,
    type: r.doc_type,
    number: r.number ?? '',
    date: r.date,
    kind: r.kind === 'converted' ? 'converted' : 'returned',
    direction: r.from_doc_id === id ? 'from' : 'to',
    amount: r.amount,
    grandTotal: r.grand_total
  }))
}
