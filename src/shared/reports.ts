// Shapes returned by the report and dashboard calls. Money is paise, quantities milli-units.
import type { InvoiceSummary } from './models'
import type { RateSummary } from './tax'

export interface DashboardData {
  today: string
  todaySales: number
  todaySalesCount: number
  monthSales: number
  monthPurchases: number
  /** Total that customers owe us (parties with a positive balance). */
  receivable: number
  /** Total we owe suppliers, as a positive number. */
  payable: number
  cashBank: number
  accounts: { id: string; name: string; kind: string; balance: number }[]
  overdue: { count: number; total: number; top: InvoiceSummary[] }
  lowStock: { itemId: string; name: string; qty: number; unit: string; lowStockQty: number }[]
  /** One entry per day for the last 30 days, oldest first. */
  salesByDay: { date: string; total: number }[]
}

export interface RegisterRow {
  id: string
  date: string
  number: string
  partyName: string
  gstin: string
  /** Value before tax, including taxable charges. */
  taxable: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  total: number
  paid: number
  balance: number
  status: InvoiceSummary['status']
}

export type RegisterTotals = Pick<RegisterRow, 'taxable' | 'cgst' | 'sgst' | 'igst' | 'cess' | 'total' | 'paid' | 'balance'>

export interface Register {
  rows: RegisterRow[]
  totals: RegisterTotals
}

export type DayBookKind =
  | 'sale' | 'purchase' | 'sale_return' | 'purchase_return' | 'expense' | 'payment_in' | 'payment_out' | 'transfer' | 'adjustment'

export interface DayBookRow {
  date: string
  kind: DayBookKind
  label: string
  number: string
  party: string
  /** Bill total, payment amount, transfer amount or adjustment value. */
  amount: number
  /** Cash or bank money that came in or went out with this entry. */
  moneyIn: number
  moneyOut: number
  sourceId: string
}

export interface DayBook {
  rows: DayBookRow[]
  sales: number
  purchases: number
  moneyIn: number
  moneyOut: number
}

export const AGE_BUCKETS = ['Not due', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days'] as const

export interface AgeingRow {
  partyId: string | null
  name: string
  phone: string
  /** Open bill amounts by how long they are overdue; same order as AGE_BUCKETS. */
  buckets: number[]
  /** Balance not tied to a bill: opening balance, or advances not yet set off (negative). */
  onAccount: number
  total: number
}

export interface Ageing {
  side: 'receivable' | 'payable'
  asOf: string
  rows: AgeingRow[]
  totals: { buckets: number[]; onAccount: number; total: number }
}

export interface ProfitLoss {
  from: string
  to: string
  sales: number
  purchases: number
  openingStock: number
  closingStock: number
  /** Opening stock + purchases − closing stock. */
  costOfGoodsSold: number
  grossProfit: number
  /** Net of rounding on bills: positive is a small gain. */
  roundOff: number
  /** Expenses before GST, by category, largest first. */
  expenses: { category: string; amount: number }[]
  totalExpenses: number
  netProfit: number
}

export interface GstSide {
  byRate: RateSummary[]
  taxable: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  bills: number
}

export interface GstSummary {
  from: string
  to: string
  outward: GstSide
  inward: GstSide
  /** Output tax minus input credit, per head. Negative means credit carried forward. */
  net: { cgst: number; sgst: number; igst: number; cess: number; total: number }
}

export interface ItemSalesRow {
  itemId: string | null
  name: string
  unit: string
  /** Quantity sold in base units. */
  qty: number
  /** Sale value before tax. */
  sales: number
  /** Quantity × average purchase cost. */
  cost: number
  profit: number
}

export interface ItemSales {
  rows: ItemSalesRow[]
  sales: number
  cost: number
  profit: number
}
