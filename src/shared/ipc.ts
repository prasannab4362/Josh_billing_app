// The calls the renderer can make. Each method name is also its IPC channel.

import type { PaperSize } from './models'
import type { InvoicePrintData } from './invoiceHtml'
import type { ReportDoc } from './reportDoc'
import type { Gstr1, Gstr3b } from './gstReturns'
import type { PrintSettings } from './printSettings'
import type { ItemFieldSettings } from './itemFields'
import type { FeatureSettings } from './features'
import type { ImportKind, ImportPreview, ImportResult, ItemBulkChange } from './imports'
import type { CustomSize, LabelExtra, LabelOptions, SavedLabelSize } from './labels'
import type { AuditEntry, AuditFilter, BackupFile, BackupInfo, BinEntry, BinKind } from './data'
import type { Ageing, DashboardData, DayBook, GstSummary, ItemSales, ProfitLoss, Register } from './reports'
import type {
  Business,
  BusinessProfile,
  BusinessSummary,
  AccountInput,
  AccountWithBalance,
  CreateBusinessInput,
  Expense,
  ExpenseInput,
  BillType,
  Invoice,
  InvoiceInput,
  InvoiceSummary,
  Item,
  ItemInput,
  MoneyAccount,
  NumberSeries,
  OpenDocument,
  Payment,
  PaymentDirection,
  PaymentInput,
  PaymentSummary,
  Statement,
  StockAdjustmentInput,
  StockSummary,
  TransferInput,
  NumberSeriesUpdate,
  Party,
  PartyInput,
  Preferences,
  StockMovement,
  TaxRate,
  TaxRateInput,
  Unit
} from './models'

export interface AppInfo {
  appVersion: string
  dbPath: string | null
  schemaVersion: number | null
}

export interface BillingApi {
  getAppInfo(): Promise<AppInfo>

  listBusinesses(): Promise<BusinessSummary[]>
  currentBusiness(): Promise<Business | null>
  createBusiness(input: CreateBusinessInput): Promise<Business>
  openBusiness(id: string): Promise<Business>
  closeBusiness(): Promise<void>
  updateBusiness(profile: BusinessProfile): Promise<Business>
  /** Set or clear (null) the logo or signature; images are data URLs. */
  setBusinessImage(kind: 'logo' | 'signature', dataUrl: string | null): Promise<Business>

  getPreferences(): Promise<Preferences>
  savePreferences(changes: Partial<Preferences>): Promise<Preferences>

  listSeries(): Promise<{ fy: string; series: NumberSeries[] }>
  updateSeries(id: string, update: NumberSeriesUpdate): Promise<NumberSeries>

  listTaxRates(): Promise<TaxRate[]>
  createTaxRate(input: TaxRateInput): Promise<TaxRate>
  setTaxRateActive(id: string, active: boolean): Promise<TaxRate>

  listUnits(): Promise<Unit[]>
  createUnit(name: string, short: string): Promise<Unit>
  deleteUnit(id: string): Promise<void>

  listParties(): Promise<Party[]>
  getParty(id: string): Promise<Party>
  createParty(input: PartyInput): Promise<Party>
  updateParty(id: string, input: PartyInput): Promise<Party>
  setPartyActive(id: string, active: boolean): Promise<Party>
  deleteParty(id: string): Promise<void>
  listPartyGroups(): Promise<string[]>

  listItems(): Promise<Item[]>
  getItem(id: string): Promise<Item>
  createItem(input: ItemInput): Promise<Item>
  updateItem(id: string, input: ItemInput): Promise<Item>
  setItemActive(id: string, active: boolean): Promise<Item>
  deleteItem(id: string): Promise<void>
  listItemCategories(): Promise<string[]>
  listStockMovements(itemId: string): Promise<StockMovement[]>
  getItemImage(id: string): Promise<string | null>
  /** A free in-store barcode number for a new item. */
  generateBarcode(): Promise<string>
  /** Give barcodes to the listed items that have none; returns how many got one. */
  assignBarcodes(itemIds: string[]): Promise<number>
  /** The label sheet as HTML, for the preview. */
  previewLabels(req: LabelRequest): Promise<string>
  printLabels(req: LabelRequest): Promise<boolean>
  saveLabelsPdf(req: LabelRequest): Promise<string | null>
  /** How invoices print: layout, colour, what to show. */
  getPrintSettings(): Promise<PrintSettings>
  savePrintSettings(s: PrintSettings): Promise<PrintSettings>
  /** Optional parts of bills and the business's own party and item fields. */
  getFeatures(): Promise<FeatureSettings>
  saveFeatures(s: FeatureSettings): Promise<FeatureSettings>
  /** Which extra details (batch, dates, model, size, serial) bill lines have. */
  getItemFields(): Promise<ItemFieldSettings>
  saveItemFields(s: ItemFieldSettings): Promise<ItemFieldSettings>
  /** A sample invoice drawn with these settings, for the preview. */
  previewPrintSettings(s: PrintSettings, paper: PaperSize): Promise<string>
  /** Excel import and export. Each asks where to save or which file to open; null when cancelled. */
  saveImportTemplate(kind: ImportKind): Promise<string | null>
  exportToExcel(kind: ImportKind): Promise<string | null>
  /** Choose a file and check it; nothing is saved until commitImport. */
  chooseImportFile(kind: ImportKind): Promise<ImportPreview | null>
  commitImport(token: string): Promise<ImportResult>
  /** Change prices, tax and other fields of many items at once. Returns how many changed. */
  bulkUpdateItems(changes: ItemBulkChange[]): Promise<number>
  /** The business's own label sizes, and the label design last used (null before the first print). */
  listLabelSizes(): Promise<SavedLabelSize[]>
  saveLabelSize(id: string | null, name: string, size: CustomSize): Promise<SavedLabelSize>
  deleteLabelSize(id: string): Promise<void>
  getLabelDesign(): Promise<Omit<LabelOptions, 'skip'> | null>
  saveLabelDesign(design: Omit<LabelOptions, 'skip'>): Promise<void>

  listAccounts(): Promise<MoneyAccount[]>

  /** Sale invoices and purchase bills share one set of calls. */
  listBills(type: BillType, filter: InvoiceFilter): Promise<InvoiceSummary[]>
  getBill(type: BillType, id: string): Promise<Invoice>
  /** Next number for a new bill of this type ('' when the type carries the supplier's number). */
  nextBillNumber(type: BillType, date: string): Promise<string>
  saveBill(type: BillType, id: string | null, input: InvoiceInput): Promise<Invoice>
  deleteBill(type: BillType, id: string): Promise<void>
  /** Everything needed to draw the printed bill. */
  getBillPrint(type: BillType, id: string): Promise<InvoicePrintData>
  exportBillPdf(type: BillType, id: string): Promise<string | null>
  printBill(type: BillType, id: string): Promise<boolean>

  createAdjustment(input: StockAdjustmentInput): Promise<string>
  deleteAdjustment(id: string): Promise<void>
  stockSummary(asOf: string): Promise<StockSummary>

  listPayments(filter: PaymentFilter): Promise<PaymentSummary[]>
  getPayment(id: string): Promise<Payment>
  nextPaymentNumber(direction: PaymentDirection, date: string): Promise<string>
  openDocuments(partyId: string, direction: PaymentDirection, paymentId: string | null): Promise<OpenDocument[]>
  savePayment(id: string | null, input: PaymentInput): Promise<Payment>
  deletePayment(id: string): Promise<void>

  partyStatement(partyId: string, period: Period): Promise<Statement>
  accountStatement(accountId: string, period: Period): Promise<Statement>

  listAccountsWithBalance(): Promise<AccountWithBalance[]>
  createAccount(input: AccountInput): Promise<AccountWithBalance>
  updateAccount(id: string, input: AccountInput): Promise<AccountWithBalance>
  deactivateAccount(id: string): Promise<void>
  createTransfer(input: TransferInput): Promise<string>
  deleteTransfer(id: string): Promise<void>

  listExpenses(period: Period): Promise<Expense[]>
  saveExpense(id: string | null, input: ExpenseInput): Promise<Expense>
  deleteExpense(id: string): Promise<void>
  listExpenseCategories(): Promise<string[]>

  /** Ask where to save, then copy the open business there. Returns the path, or null if cancelled. */
  backupNow(): Promise<string | null>
  /** Automatic and safety backups of the open business, newest first. */
  listBackups(): Promise<BackupFile[]>
  /** Ask for a backup file and describe it (null if cancelled). */
  chooseBackupFile(): Promise<BackupInfo | null>
  inspectBackup(path: string): Promise<BackupInfo>
  /** Replace the open business's data with a backup (a safety copy is taken first). */
  restoreBackup(path: string): Promise<{ business: Business; safetyCopy: string }>
  /** Open a backup as a separate business. */
  importBackup(path: string): Promise<Business>
  openBackupFolder(): Promise<void>

  listBin(): Promise<BinEntry[]>
  restoreFromBin(kind: BinKind, id: string): Promise<void>
  listAudit(filter: AuditFilter): Promise<AuditEntry[]>

  gstr1(period: Period): Promise<Gstr1>
  gstr3b(period: Period): Promise<Gstr3b>
  /** Save GSTR-1 as JSON for the GST portal (asks where). */
  exportGstr1Json(period: Period): Promise<string | null>

  dashboard(): Promise<DashboardData>
  billRegister(type: BillType, period: Period): Promise<Register>
  dayBook(period: Period): Promise<DayBook>
  ageing(side: 'receivable' | 'payable'): Promise<Ageing>
  profitLoss(period: Period): Promise<ProfitLoss>
  gstSummary(period: Period): Promise<GstSummary>
  itemSales(period: Period): Promise<ItemSales>
  /** Save a report as PDF or CSV (asks where). Returns the path, or null if cancelled. */
  exportReport(doc: ReportDoc, format: 'pdf' | 'csv'): Promise<string | null>
  printReport(doc: ReportDoc): Promise<boolean>
}

export interface LabelRequest {
  items: { itemId: string; copies: number; extra?: LabelExtra }[]
  options: LabelOptions
}

export interface PaymentFilter {
  from?: string
  to?: string
  partyId?: string
  direction?: PaymentDirection
}

export interface Period {
  from?: string
  to?: string
}

export interface InvoiceFilter {
  from?: string
  to?: string
  partyId?: string
}

// Listing every key here (checked by the type) lets the preload bridge expose them all.
const methods: Record<keyof BillingApi, true> = {
  getAppInfo: true,
  listBusinesses: true,
  currentBusiness: true,
  createBusiness: true,
  openBusiness: true,
  closeBusiness: true,
  updateBusiness: true,
  setBusinessImage: true,
  getPreferences: true,
  savePreferences: true,
  listSeries: true,
  updateSeries: true,
  listTaxRates: true,
  createTaxRate: true,
  setTaxRateActive: true,
  listUnits: true,
  createUnit: true,
  deleteUnit: true,
  listParties: true,
  getParty: true,
  createParty: true,
  updateParty: true,
  setPartyActive: true,
  deleteParty: true,
  listPartyGroups: true,
  listItems: true,
  getItem: true,
  createItem: true,
  updateItem: true,
  setItemActive: true,
  deleteItem: true,
  listItemCategories: true,
  listStockMovements: true,
  getItemImage: true,
  generateBarcode: true,
  assignBarcodes: true,
  previewLabels: true,
  printLabels: true,
  saveLabelsPdf: true,
  getFeatures: true,
  saveFeatures: true,
  getItemFields: true,
  saveItemFields: true,
  getPrintSettings: true,
  savePrintSettings: true,
  previewPrintSettings: true,
  saveImportTemplate: true,
  exportToExcel: true,
  chooseImportFile: true,
  commitImport: true,
  bulkUpdateItems: true,
  listLabelSizes: true,
  saveLabelSize: true,
  deleteLabelSize: true,
  getLabelDesign: true,
  saveLabelDesign: true,
  listAccounts: true,
  listBills: true,
  getBill: true,
  nextBillNumber: true,
  saveBill: true,
  deleteBill: true,
  getBillPrint: true,
  exportBillPdf: true,
  printBill: true,
  createAdjustment: true,
  deleteAdjustment: true,
  stockSummary: true,
  listPayments: true,
  getPayment: true,
  nextPaymentNumber: true,
  openDocuments: true,
  savePayment: true,
  deletePayment: true,
  partyStatement: true,
  accountStatement: true,
  listAccountsWithBalance: true,
  createAccount: true,
  updateAccount: true,
  deactivateAccount: true,
  createTransfer: true,
  deleteTransfer: true,
  listExpenses: true,
  saveExpense: true,
  deleteExpense: true,
  listExpenseCategories: true,
  backupNow: true,
  listBackups: true,
  chooseBackupFile: true,
  inspectBackup: true,
  restoreBackup: true,
  importBackup: true,
  openBackupFolder: true,
  listBin: true,
  restoreFromBin: true,
  listAudit: true,
  gstr1: true,
  gstr3b: true,
  exportGstr1Json: true,
  dashboard: true,
  billRegister: true,
  dayBook: true,
  ageing: true,
  profitLoss: true,
  gstSummary: true,
  itemSales: true,
  exportReport: true,
  printReport: true
}

export const API_METHODS = Object.keys(methods) as (keyof BillingApi)[]
