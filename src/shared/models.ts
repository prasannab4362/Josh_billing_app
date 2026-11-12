import type { BillExtra } from './features'
import type { LineDetails } from './itemFields'
// Data shapes passed between the main process and the renderer.

import type { BillType } from './billTypes'
import type { NumberedType } from './docTypes'

export interface BusinessProfile {
  name: string
  legalName: string
  gstin: string
  pan: string
  stateCode: string
  address: string
  city: string
  pincode: string
  phone: string
  email: string
  businessType: string
  category: string
  fyStartMonth: number
}

export interface Business extends BusinessProfile {
  id: string
  /** Logo and signature images as data URLs ('' when not set). */
  logo: string
  signature: string
  createdAt: string
  updatedAt: string
}

export interface BusinessSummary {
  id: string
  name: string
  file: string
  createdAt: string
  lastOpenedAt: string | null
}

export type PaperSize = 'A4' | 'A5' | 'thermal80' | 'thermal58'

export interface Preferences {
  gstRegistered: boolean
  pricesIncludeTax: boolean
  roundOff: boolean
  defaultDueDays: number
  allowNegativeStock: boolean
  paperSize: PaperSize
}

export const DEFAULT_PREFERENCES: Preferences = {
  gstRegistered: true,
  pricesIncludeTax: false,
  roundOff: true,
  defaultDueDays: 15,
  allowNegativeStock: true,
  paperSize: 'A4'
}

export interface BankAccountInput {
  kind: 'bank' | 'upi_wallet'
  name: string
  bankName: string
  accountNo: string
  ifsc: string
  upiId: string
  openingBalance: number // paise
}

export interface CreateBusinessInput {
  profile: BusinessProfile
  preferences: Partial<Preferences>
  invoicePrefix?: string
  bankAccount?: BankAccountInput | null
}

export interface NumberSeries {
  id: string
  docType: NumberedType
  prefix: string
  nextNumber: number
  padding: number
  fy: string | null
  isDefault: boolean
}

export interface NumberSeriesUpdate {
  prefix: string
  nextNumber: number
  padding: number
}

export type TaxKind = 'gst' | 'exempt' | 'nil' | 'non_gst'

export interface TaxRate {
  id: string
  name: string
  kind: TaxKind
  rateBp: number
  cessBp: number
  isActive: boolean
}

export interface TaxRateInput {
  name: string
  kind: TaxKind
  rateBp: number
  cessBp: number
}

export interface Unit {
  id: string
  name: string
  short: string
  inUse: boolean
}

// ---------- Parties ----------

export type PartyKind = 'customer' | 'supplier' | 'both'

export interface PartyInput {
  name: string
  kind: PartyKind
  phone: string
  email: string
  gstin: string
  stateCode: string
  billingAddress: string
  shippingAddress: string
  /** Paise. Positive = they owe us (to receive), negative = we owe them (to pay). */
  openingBalance: number
  openingDate: string
  creditLimit: number | null
  paymentTermDays: number | null
  group: string
  /** Values of the business's own party fields, by position (Settings › Extra fields). */
  customFields?: string[] | null
}

export interface Party extends PartyInput {
  id: string
  /** Current balance in paise, same sign rule as openingBalance. */
  balance: number
  /** True once invoices or payments refer to this party. */
  hasTransactions: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ---------- Items ----------

export type ItemKind = 'goods' | 'service'

export interface ItemInput {
  name: string
  code: string
  kind: ItemKind
  category: string
  hsnSac: string
  taxRateId: string | null
  priceIncludesTax: boolean
  salePrice: number // paise per base unit
  purchasePrice: number
  mrp: number | null
  wholesalePrice: number | null
  wholesaleMinQty: number | null // milli base units
  baseUnitId: string | null
  altUnitId: string | null
  altConversion: number | null // milli base units per 1 alt unit
  trackStock: boolean
  openingQty: number // milli base units
  openingRate: number // paise per base unit
  openingDate: string
  lowStockQty: number | null
  /** Printed under the item name on bills. */
  description?: string
  /** Scanned at the counter and printed on labels. */
  barcode?: string
  /** Photo as a data URL. Leave undefined to keep the current one; null removes it. */
  image?: string | null
  /** Values of the business's own item fields, by position (Settings › Extra fields). */
  customFields?: string[] | null
}

export interface Item extends ItemInput {
  id: string
  description: string
  barcode: string
  hasImage: boolean
  stockQty: number // milli base units
  stockValue: number // paise, at average purchase cost
  baseUnitShort: string
  taxRateName: string
  hasTransactions: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface StockMovement {
  id: string
  date: string
  qtyChange: number
  rate: number
  sourceType: 'document' | 'adjustment' | 'opening'
  sourceId: string
  /** What caused it, e.g. "Sale invoice · Ravi" or "Adjustment · Damaged". */
  label: string
  /** Bill number, when there is one. */
  number: string
  /** Stock after this movement, in milli base units. */
  runningQty: number
}

export interface StockAdjustmentInput {
  itemId: string
  date: string
  /** Milli base units: positive adds stock, negative removes it. */
  qtyChange: number
  /** Cost per base unit for stock added; null = current average cost. */
  rate: number | null
  reason: string
}

export interface StockSummaryRow {
  itemId: string
  name: string
  code: string
  category: string
  unit: string
  qty: number
  /** Weighted average cost per base unit, in paise. */
  avgCost: number
  value: number
  salePrice: number
  saleValue: number
  lowStockQty: number | null
  low: boolean
}

export interface StockSummary {
  asOf: string
  rows: StockSummaryRow[]
  totalValue: number
  totalSaleValue: number
  lowCount: number
}

// ---------- Accounts ----------

export interface MoneyAccount {
  id: string
  kind: 'cash' | 'bank' | 'upi_wallet'
  name: string
  bankName: string
  accountNo: string
  ifsc: string
  upiId: string
  isDefaultForPrint: boolean
}

// ---------- Sale invoices ----------

export type PaymentMode = 'cash' | 'upi' | 'bank' | 'cheque' | 'card'
export type { BillType } from './billTypes'
/** Posting bills: unpaid → partial → paid (overdue when past due). Quotes, orders, challans: open → converted. */
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'overdue' | 'open' | 'converted'

export interface InvoiceLineInput {
  itemId: string | null
  description: string
  qty: number // milli line units
  unitId: string | null
  unitFactor: number // milli base units per 1 line unit (1000 = base unit)
  rate: number // paise per line unit
  discountPctBp: number
  discountAmount: number
  taxRateId: string | null
  hsnSac: string
  /** Batch, dates, model, size, serial (Settings › Item fields). */
  details?: LineDetails | null
}

export interface InvoiceChargeInput {
  name: string
  amount: number
  taxRateId: string | null
}

export interface ReceivedInput {
  amount: number
  accountId: string
  mode: PaymentMode
  reference: string
}

export interface InvoiceInput {
  /** null = cash sale to a walk-in customer (must be paid in full). */
  partyId: string | null
  walkInName: string
  /** Empty = take the next number from the series. */
  number: string
  date: string
  dueDate: string
  placeOfSupply: string
  pricesIncludeTax: boolean
  lines: InvoiceLineInput[]
  charges: InvoiceChargeInput[]
  received: ReceivedInput | null
  notes: string
  terms: string
  /** Transport and purchase-order details. */
  extra?: BillExtra | null
  /**
   * New bills only: the estimate/order/challan this was converted from, or the bill a return is
   * made against.
   */
  linkedId?: string | null
}

export interface PartySnapshot {
  name: string
  phone: string
  gstin: string
  stateCode: string
  billingAddress: string
  shippingAddress: string
}

export interface InvoiceLine extends InvoiceLineInput {
  id: string
  itemName: string
  /** The item's own description, printed under its name. */
  itemDescription: string
  /** Values of the item's own fields (Settings › Extra fields). */
  itemCustomFields: string[] | null
  unitShort: string
  taxRateBp: number
  cessBp: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  total: number
}

export interface InvoiceCharge extends InvoiceChargeInput {
  taxRateBp: number
  tax: number
}

/** A bill this one came from or led to. */
export interface BillLink {
  id: string
  type: BillType
  number: string
  date: string
  /** converted: one was turned into the other. returned: a credit/debit note against a bill. */
  kind: 'converted' | 'returned'
  /** 'from' = this bill came from it; 'to' = it came from this bill. */
  direction: 'from' | 'to'
  /** For returns: amount set off against the bill. */
  amount: number
  grandTotal: number
}

export interface InvoiceSummary {
  id: string
  type: BillType
  number: string
  date: string
  dueDate: string
  partyId: string | null
  partyName: string
  grandTotal: number
  paidAmount: number
  balanceDue: number
  status: InvoiceStatus
}

export interface Invoice extends InvoiceSummary {
  party: PartySnapshot
  placeOfSupply: string
  supplyType: 'intra' | 'inter'
  pricesIncludeTax: boolean
  lines: InvoiceLine[]
  charges: InvoiceCharge[]
  subtotal: number
  discountTotal: number
  taxableTotal: number
  chargesTotal: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  roundOff: number
  received: (ReceivedInput & { paymentId: string; number: string }) | null
  notes: string
  terms: string
  links: BillLink[]
  extra: BillExtra | null
  createdAt: string
  updatedAt: string
}

// ---------- Payments ----------

export type PaymentDirection = 'in' | 'out'

export interface AllocationInput {
  documentId: string
  amount: number
}

export interface PaymentInput {
  direction: PaymentDirection
  partyId: string
  /** Empty = next number from the series. */
  number: string
  date: string
  amount: number
  accountId: string
  mode: PaymentMode
  reference: string
  notes: string
  allocations: AllocationInput[]
}

export interface PaymentSummary {
  id: string
  direction: PaymentDirection
  number: string
  date: string
  partyId: string | null
  partyName: string
  amount: number
  accountId: string
  accountName: string
  mode: PaymentMode
  reference: string
  allocated: number
  /** Amount not set against any bill: an advance (in) or on-account payment (out). */
  unallocated: number
  /** Set when the money was taken while saving an invoice; edit it on that invoice. */
  sourceDocId: string | null
  sourceDocNumber: string
}

export interface Payment extends PaymentSummary {
  notes: string
  allocations: (AllocationInput & { number: string; date: string })[]
}

/** A bill that can still take money: its balance counts back this payment's own share when editing. */
export interface OpenDocument {
  id: string
  number: string
  date: string
  dueDate: string
  total: number
  open: number
}

// ---------- Statements ----------

export interface StatementRow {
  date: string
  kind: 'opening' | 'invoice' | 'payment_in' | 'payment_out' | 'transfer' | 'other'
  label: string
  number: string
  sourceId: string
  debit: number
  credit: number
  /** Running balance after this row (debit − credit). */
  balance: number
}

export interface Statement {
  openingBalance: number
  rows: StatementRow[]
  closingBalance: number
  totalDebit: number
  totalCredit: number
}

// ---------- Cash & bank ----------

export interface AccountInput {
  kind: 'cash' | 'bank' | 'upi_wallet'
  name: string
  bankName: string
  accountNo: string
  ifsc: string
  upiId: string
  openingBalance: number
  openingDate: string
  isDefaultForPrint: boolean
}

export interface AccountWithBalance extends MoneyAccount {
  openingBalance: number
  openingDate: string
  balance: number
}

export interface TransferInput {
  fromAccountId: string
  toAccountId: string
  amount: number
  date: string
  notes: string
}

// ---------- Expenses ----------

export interface ExpenseInput {
  date: string
  category: string
  /** Amount before GST, in paise. */
  amount: number
  /** GST charged on the expense, if any (claimed as input credit). */
  taxRateId: string | null
  /** Cash or bank account the expense was paid from. */
  accountId: string
  paidTo: string
  /** Bill or voucher number, if any. */
  reference: string
  notes: string
}

export interface Expense extends ExpenseInput {
  id: string
  taxRateBp: number
  cgst: number
  sgst: number
  total: number
  accountName: string
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent', 'Salary', 'Electricity', 'Transport', 'Telephone & internet', 'Office supplies', 'Repairs', 'Bank charges', 'Other'
]
