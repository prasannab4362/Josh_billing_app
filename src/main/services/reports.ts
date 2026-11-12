// Dashboard figures and reports. Everything is read from bills, payments, the ledger and stock
// movements; nothing here writes to the database.
import { todayLocal } from '@shared/fy'
import type { Period } from '@shared/ipc'
import type { BillType, InvoiceStatus } from '@shared/models'
import { splitHalves } from '@shared/money'
import { lineAmount, toBaseUnits } from '@shared/qty'
import type {
  Ageing, AgeingRow, DashboardData, DayBook, DayBookRow, GstSide, GstSummary, ItemSales, ItemSalesRow, ProfitLoss,
  Register, RegisterRow
} from '@shared/reports'
import type { RateSummary } from '@shared/tax'
import type { DB } from '../db/connection'
import { UserError } from '../util'
import { listAccountsWithBalance } from './accounts'
import { EXPENSE_ACCOUNT, expensesByCategory } from './expenses'
import { averageCost, stockSummary } from './inventory'
import { listBills } from './invoices'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const FAR_PAST = '0000-01-01'
const FAR_FUTURE = '9999-12-31'

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** A checked period with both ends filled in, for SQL. */
function range(period: Period): { from: string; to: string } {
  const from = period.from || FAR_PAST
  const to = period.to || FAR_FUTURE
  if (!DATE.test(from) || !DATE.test(to)) throw new UserError('Choose a valid date range')
  if (from > to) throw new UserError('The start date is after the end date')
  return { from, to }
}

/** Σ(debit − credit) of one ledger account between two dates. */
function movement(db: DB, account: string, from: string, to: string): number {
  return (
    db
      .prepare('SELECT COALESCE(SUM(debit - credit), 0) AS n FROM ledger_entry WHERE account = ? AND date BETWEEN ? AND ?')
      .get(account, from, to) as { n: number }
  ).n
}

interface PartyBalance {
  partyId: string | null
  name: string
  phone: string
  balance: number
}

/** Balance of every party still in use, plus cash-sale customers who left money owing. */
function partyBalances(db: DB): PartyBalance[] {
  const rows = db
    .prepare(
      `SELECT e.account, SUM(e.debit - e.credit) AS balance, p.id, p.name, p.phone
       FROM ledger_entry e LEFT JOIN party p ON p.id = substr(e.account, 7)
       WHERE e.account LIKE 'party:%' AND (e.account = 'party:walkin' OR (p.id IS NOT NULL AND p.deleted_at IS NULL))
       GROUP BY e.account HAVING balance <> 0`
    )
    .all() as { account: string; balance: number; id: string | null; name: string | null; phone: string | null }[]
  return rows.map((r) => ({
    partyId: r.id,
    name: r.name ?? 'Cash sale customers',
    phone: r.phone ?? '',
    balance: r.balance
  }))
}

// ---------- Dashboard ----------

export function dashboard(db: DB, today = todayLocal()): DashboardData {
  const monthStart = `${today.slice(0, 7)}-01`
  const total = (type: BillType, from: string, to: string) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(grand_total), 0) AS total, COUNT(*) AS n FROM document
         WHERE doc_type = ? AND deleted_at IS NULL AND date BETWEEN ? AND ?`
      )
      .get(type, from, to) as { total: number; n: number }

  const todaySales = total('SALE_INVOICE', today, today)
  const balances = partyBalances(db)
  const accounts = listAccountsWithBalance(db)

  const overdue = listBills(db, 'SALE_INVOICE', {}, today)
    .filter((b) => b.status === 'overdue')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  const start = addDays(today, -29)
  const byDay = new Map(
    (
      db
        .prepare(
          `SELECT date, SUM(grand_total) AS total FROM document
           WHERE doc_type = 'SALE_INVOICE' AND deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY date`
        )
        .all(start, today) as { date: string; total: number }[]
    ).map((r) => [r.date, r.total])
  )

  return {
    today,
    todaySales: todaySales.total,
    todaySalesCount: todaySales.n,
    monthSales: total('SALE_INVOICE', monthStart, today).total,
    monthPurchases: total('PURCHASE_BILL', monthStart, today).total,
    receivable: balances.reduce((s, b) => s + Math.max(b.balance, 0), 0),
    payable: balances.reduce((s, b) => s + Math.max(-b.balance, 0), 0),
    cashBank: accounts.reduce((s, a) => s + a.balance, 0),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, balance: a.balance })),
    overdue: { count: overdue.length, total: overdue.reduce((s, b) => s + b.balanceDue, 0), top: overdue.slice(0, 5) },
    lowStock: stockSummary(db, today)
      .rows.filter((r) => r.low)
      .map((r) => ({ itemId: r.itemId, name: r.name, qty: r.qty, unit: r.unit, lowStockQty: r.lowStockQty ?? 0 })),
    salesByDay: Array.from({ length: 30 }, (_, i) => {
      const date = addDays(start, i)
      return { date, total: byDay.get(date) ?? 0 }
    })
  }
}

// ---------- Sale / purchase register ----------

export function billRegister(db: DB, type: BillType, period: Period = {}, today = todayLocal()): Register {
  const { from, to } = range(period)
  const rows = db
    .prepare(
      `SELECT id, date, due_date, number, party_snapshot, taxable_total, charges_total, cgst, sgst, igst, cess,
              grand_total, paid_amount, balance_due, status
       FROM document WHERE doc_type = ? AND deleted_at IS NULL AND date BETWEEN ? AND ?
       ORDER BY date, created_at`
    )
    .all(type, from, to) as {
    id: string; date: string; due_date: string | null; number: string | null; party_snapshot: string
    taxable_total: number; charges_total: number; cgst: number; sgst: number; igst: number; cess: number
    grand_total: number; paid_amount: number; balance_due: number; status: InvoiceStatus
  }[]
  const out: RegisterRow[] = rows.map((r) => {
    const party = JSON.parse(r.party_snapshot) as { name: string; gstin: string }
    return {
      id: r.id,
      date: r.date,
      number: r.number ?? '',
      partyName: party.name,
      gstin: party.gstin,
      taxable: r.taxable_total + r.charges_total,
      cgst: r.cgst,
      sgst: r.sgst,
      igst: r.igst,
      cess: r.cess,
      total: r.grand_total,
      paid: r.paid_amount,
      balance: r.balance_due,
      status: r.status !== 'paid' && r.due_date && r.due_date < today ? 'overdue' : r.status
    }
  })
  const sum = (k: keyof Register['totals']) => out.reduce((s, r) => s + r[k], 0)
  return {
    rows: out,
    totals: {
      taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess'),
      total: sum('total'), paid: sum('paid'), balance: sum('balance')
    }
  }
}

// ---------- Day book ----------

/** Every bill, payment, transfer and stock adjustment in the period, in the order they happened. */
export function dayBook(db: DB, period: Period): DayBook {
  const { from, to } = range(period)
  const rows: (DayBookRow & { at: string })[] = []

  const docs = db
    .prepare(
      `SELECT d.id, d.doc_type, d.date, d.number, json_extract(d.party_snapshot, '$.name') AS party, d.grand_total, d.created_at,
              d.category, b.name AS account
       FROM document d LEFT JOIN bank_account b ON b.id = d.account_id
       WHERE d.doc_type IN ('SALE_INVOICE','PURCHASE_BILL','SALE_RETURN','PURCHASE_RETURN','EXPENSE')
         AND d.deleted_at IS NULL AND d.date BETWEEN ? AND ?`
    )
    .all(from, to) as {
    id: string; doc_type: string; date: string; number: string | null; party: string; grand_total: number; created_at: string
    category: string | null; account: string | null
  }[]
  const DOC_KIND: Record<string, [DayBookRow['kind'], string]> = {
    SALE_INVOICE: ['sale', 'Sale invoice'],
    PURCHASE_BILL: ['purchase', 'Purchase bill'],
    SALE_RETURN: ['sale_return', 'Credit note (sale return)'],
    PURCHASE_RETURN: ['purchase_return', 'Debit note (purchase return)'],
    EXPENSE: ['expense', 'Expense']
  }
  for (const d of docs) {
    const [kind, label] = DOC_KIND[d.doc_type]
    const expense = kind === 'expense'
    rows.push({
      date: d.date, at: d.created_at, kind, label: expense ? `Expense · ${d.category} · ${d.account}` : label,
      number: d.number ?? '', party: expense ? (d.party === d.category ? '' : d.party) : d.party, amount: d.grand_total,
      moneyIn: 0, moneyOut: expense ? d.grand_total : 0, sourceId: d.id
    })
  }

  const pays = db
    .prepare(
      `SELECT p.id, p.direction, p.date, p.number, p.amount, p.created_at, pt.name AS party, b.name AS account
       FROM payment p LEFT JOIN party pt ON pt.id = p.party_id JOIN bank_account b ON b.id = p.account_id
       WHERE p.deleted_at IS NULL AND p.date BETWEEN ? AND ?`
    )
    .all(from, to) as { id: string; direction: 'in' | 'out'; date: string; number: string | null; amount: number; created_at: string; party: string | null; account: string }[]
  for (const p of pays) {
    const isIn = p.direction === 'in'
    rows.push({
      date: p.date, at: p.created_at, kind: isIn ? 'payment_in' : 'payment_out',
      label: `${isIn ? 'Payment received' : 'Payment made'} · ${p.account}`, number: p.number ?? '',
      party: p.party ?? 'Cash sale', amount: p.amount, moneyIn: isIn ? p.amount : 0, moneyOut: isIn ? 0 : p.amount, sourceId: p.id
    })
  }

  const transfers = db
    .prepare(
      `SELECT t.id, t.date, t.amount, t.notes, t.created_at, f.name AS from_name, a.name AS to_name
       FROM account_transfer t JOIN bank_account f ON f.id = t.from_account_id JOIN bank_account a ON a.id = t.to_account_id
       WHERE t.deleted_at IS NULL AND t.date BETWEEN ? AND ?`
    )
    .all(from, to) as { id: string; date: string; amount: number; notes: string | null; created_at: string; from_name: string; to_name: string }[]
  for (const t of transfers) {
    rows.push({
      date: t.date, at: t.created_at, kind: 'transfer',
      label: `Transfer · ${t.from_name} → ${t.to_name}${t.notes ? ` · ${t.notes}` : ''}`, number: '', party: '',
      amount: t.amount, moneyIn: 0, moneyOut: 0, sourceId: t.id
    })
  }

  const adjustments = db
    .prepare(
      `SELECT a.id, a.date, a.qty_change, a.rate, a.reason, a.created_at, i.name
       FROM stock_adjustment a JOIN item i ON i.id = a.item_id
       WHERE a.deleted_at IS NULL AND a.date BETWEEN ? AND ?`
    )
    .all(from, to) as { id: string; date: string; qty_change: number; rate: number; reason: string | null; created_at: string; name: string }[]
  for (const a of adjustments) {
    rows.push({
      date: a.date, at: a.created_at, kind: 'adjustment',
      label: `Stock ${a.qty_change > 0 ? 'added' : 'reduced'} · ${a.name}${a.reason ? ` · ${a.reason}` : ''}`, number: '',
      party: '', amount: lineAmount(Math.abs(a.qty_change), a.rate), moneyIn: 0, moneyOut: 0, sourceId: a.id
    })
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at))
  const sum = (f: (r: DayBookRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  return {
    rows: rows.map(({ at: _at, ...r }) => r),
    sales: sum((r) => (r.kind === 'sale' ? r.amount : r.kind === 'sale_return' ? -r.amount : 0)),
    purchases: sum((r) => (r.kind === 'purchase' ? r.amount : r.kind === 'purchase_return' ? -r.amount : 0)),
    moneyIn: sum((r) => r.moneyIn),
    moneyOut: sum((r) => r.moneyOut)
  }
}

// ---------- Receivable / payable ageing ----------

function bucketOf(daysOverdue: number): number {
  if (daysOverdue <= 0) return 0
  if (daysOverdue <= 30) return 1
  if (daysOverdue <= 60) return 2
  if (daysOverdue <= 90) return 3
  return 4
}

/** Who owes us (or whom we owe), split by how long their open bills have been overdue. */
export function ageing(db: DB, side: 'receivable' | 'payable', today = todayLocal()): Ageing {
  const sign = side === 'receivable' ? 1 : -1
  // What they owe us: invoices and supplier refunds due (debit notes). What we owe: bills and customer refunds.
  const [a, b] = side === 'receivable' ? ['SALE_INVOICE', 'PURCHASE_RETURN'] : ['PURCHASE_BILL', 'SALE_RETURN']
  const open = db
    .prepare(
      `SELECT party_id, date, due_date, balance_due FROM document
       WHERE doc_type IN (?, ?) AND deleted_at IS NULL AND balance_due > 0`
    )
    .all(a, b) as { party_id: string | null; date: string; due_date: string | null; balance_due: number }[]

  const rows: AgeingRow[] = partyBalances(db)
    .filter((p) => sign * p.balance > 0)
    .map((p) => {
      const buckets = [0, 0, 0, 0, 0]
      for (const d of open) {
        if (d.party_id !== p.partyId) continue
        buckets[bucketOf(daysBetween(d.due_date || d.date, today))] += d.balance_due
      }
      const total = sign * p.balance
      return { partyId: p.partyId, name: p.name, phone: p.phone, buckets, onAccount: total - buckets.reduce((s, n) => s + n, 0), total }
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  return {
    side,
    asOf: today,
    rows,
    totals: {
      buckets: [0, 1, 2, 3, 4].map((i) => rows.reduce((s, r) => s + r.buckets[i], 0)),
      onAccount: rows.reduce((s, r) => s + r.onAccount, 0),
      total: rows.reduce((s, r) => s + r.total, 0)
    }
  }
}

// ---------- Profit & loss ----------

/** Value of opening stock entered on items, dated inside the period. */
function openingStockEntered(db: DB, from: string, to: string): number {
  const rows = db
    .prepare(
      `SELECT m.qty_change, m.rate FROM stock_movement m JOIN item i ON i.id = m.item_id
       WHERE m.source_type = 'opening' AND m.date BETWEEN ? AND ? AND i.deleted_at IS NULL AND i.kind = 'goods' AND i.track_stock = 1`
    )
    .all(from, to) as { qty_change: number; rate: number }[]
  return rows.reduce((s, r) => s + lineAmount(r.qty_change, r.rate), 0)
}

/**
 * Trading profit: sales − (opening stock + purchases − closing stock), with stock at average cost.
 * Opening stock typed on items counts as opening stock even when dated inside the period, so it is
 * not mistaken for profit. Expenses are taken off to reach net profit.
 */
export function profitLoss(db: DB, period: Period): ProfitLoss {
  const { from, to } = range(period)
  const sales = 0 - movement(db, 'sales', from, to)
  const purchases = movement(db, 'purchase', from, to)
  const roundOff = 0 - movement(db, 'round_off', from, to)
  const openingStock =
    (from === FAR_PAST ? 0 : stockSummary(db, addDays(from, -1), false).totalValue) + openingStockEntered(db, from, to)
  const closingStock = stockSummary(db, to, false).totalValue
  const costOfGoodsSold = openingStock + purchases - closingStock
  const grossProfit = sales - costOfGoodsSold
  const totalExpenses = movement(db, EXPENSE_ACCOUNT, from, to)
  return {
    from: period.from ?? '',
    to: period.to ?? '',
    sales,
    purchases,
    openingStock,
    closingStock,
    costOfGoodsSold,
    grossProfit,
    roundOff,
    expenses: expensesByCategory(db, from, to),
    totalExpenses,
    netProfit: grossProfit + roundOff - totalExpenses
  }
}

// ---------- GST summary ----------

/** Tax by rate over several document types; returns (sign −1) reduce the totals. */
function gstSide(db: DB, types: [string, 1 | -1][], from: string, to: string): GstSide {
  const groups = new Map<number, RateSummary>()
  const group = (rateBp: number) => {
    let g = groups.get(rateBp)
    if (!g) groups.set(rateBp, (g = { rateBp, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }))
    return g
  }
  const lines = db
    .prepare(
      `SELECT l.tax_rate_bp AS rate, SUM(l.taxable_amount) AS taxable, SUM(l.cgst) AS cgst, SUM(l.sgst) AS sgst,
              SUM(l.igst) AS igst, SUM(l.cess) AS cess
       FROM document_line l JOIN document d ON d.id = l.document_id
       WHERE d.doc_type = ? AND d.deleted_at IS NULL AND d.date BETWEEN ? AND ? GROUP BY l.tax_rate_bp`
    )
  const charges = db
    .prepare(
      `SELECT c.amount, c.tax_amount, COALESCE(t.rate_bp, 0) AS rate, d.supply_type
       FROM document_charge c JOIN document d ON d.id = c.document_id LEFT JOIN tax_rate t ON t.id = c.tax_rate_id
       WHERE d.doc_type = ? AND d.deleted_at IS NULL AND d.date BETWEEN ? AND ?`
    )
  const count = db.prepare('SELECT COUNT(*) AS n FROM document WHERE doc_type = ? AND deleted_at IS NULL AND date BETWEEN ? AND ?')
  let bills = 0
  for (const [type, sign] of types) {
    for (const l of lines.all(type, from, to) as { rate: number; taxable: number; cgst: number; sgst: number; igst: number; cess: number }[]) {
      const g = group(l.rate)
      g.taxable += sign * l.taxable
      g.cgst += sign * l.cgst
      g.sgst += sign * l.sgst
      g.igst += sign * l.igst
      g.cess += sign * l.cess
    }
    // Charges keep only their tax amount; split it the same way the bill did.
    for (const c of charges.all(type, from, to) as { amount: number; tax_amount: number; rate: number; supply_type: 'intra' | 'inter' }[]) {
      const g = group(c.tax_amount > 0 ? c.rate : 0)
      g.taxable += sign * c.amount
      if (c.supply_type === 'intra') {
        const h = splitHalves(c.tax_amount)
        g.cgst += sign * h.cgst
        g.sgst += sign * h.sgst
      } else g.igst += sign * c.tax_amount
    }
    bills += (count.get(type, from, to) as { n: number }).n
  }
  const byRate = [...groups.values()].sort((a, b) => a.rateBp - b.rateBp)
  const sum = (k: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'cess') => byRate.reduce((s, r) => s + r[k], 0)
  return { byRate, taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess'), bills }
}

/** Output tax on sales against input credit on purchases, by GST rate. */
export function gstSummary(db: DB, period: Period): GstSummary {
  const { from, to } = range(period)
  // Credit notes reduce output tax; debit notes reduce input credit; GST on expenses is input credit.
  const outward = gstSide(db, [['SALE_INVOICE', 1], ['SALE_RETURN', -1]], from, to)
  const inward = gstSide(db, [['PURCHASE_BILL', 1], ['EXPENSE', 1], ['PURCHASE_RETURN', -1]], from, to)
  const net = {
    cgst: outward.cgst - inward.cgst,
    sgst: outward.sgst - inward.sgst,
    igst: outward.igst - inward.igst,
    cess: outward.cess - inward.cess,
    total: 0
  }
  net.total = net.cgst + net.sgst + net.igst + net.cess
  return { from: period.from ?? '', to: period.to ?? '', outward, inward, net }
}

// ---------- Item-wise sales and profit ----------

/** Quantity and value sold per item (net of sale returns), with profit at average purchase cost. */
export function itemSales(db: DB, period: Period): ItemSales {
  const { from, to } = range(period)
  const lines = db
    .prepare(
      `SELECT l.item_id, COALESCE(i.name, NULLIF(l.description, ''), 'Other') AS name, u.short AS unit, l.qty, l.unit_factor,
              l.taxable_amount, i.purchase_price, CASE d.doc_type WHEN 'SALE_RETURN' THEN -1 ELSE 1 END AS sign
       FROM document_line l JOIN document d ON d.id = l.document_id
       LEFT JOIN item i ON i.id = l.item_id LEFT JOIN unit u ON u.id = i.base_unit_id
       WHERE d.doc_type IN ('SALE_INVOICE', 'SALE_RETURN') AND d.deleted_at IS NULL AND d.date BETWEEN ? AND ?`
    )
    .all(from, to) as { item_id: string | null; name: string; unit: string | null; qty: number; unit_factor: number; taxable_amount: number; purchase_price: number | null; sign: number }[]

  const byKey = new Map<string, ItemSalesRow & { purchasePrice: number }>()
  for (const l of lines) {
    const key = l.item_id ?? `text:${l.name.toLowerCase()}`
    let row = byKey.get(key)
    if (!row) {
      row = { itemId: l.item_id, name: l.name, unit: l.unit ?? '', qty: 0, sales: 0, cost: 0, profit: 0, purchasePrice: l.purchase_price ?? 0 }
      byKey.set(key, row)
    }
    row.qty += l.sign * toBaseUnits(l.qty, l.unit_factor)
    row.sales += l.sign * l.taxable_amount
  }
  const rows: ItemSalesRow[] = [...byKey.values()].map(({ purchasePrice, ...r }) => {
    const unitCost = r.itemId ? averageCost(db, r.itemId, to) || purchasePrice : 0
    const cost = lineAmount(r.qty, unitCost)
    return { ...r, cost, profit: r.sales - cost }
  })
  rows.sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name))
  return {
    rows,
    sales: rows.reduce((s, r) => s + r.sales, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0),
    profit: rows.reduce((s, r) => s + r.profit, 0)
  }
}
