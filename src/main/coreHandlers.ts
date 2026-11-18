// The calls that only read and write the open business's database. Shared by the desktop app (main/ipc.ts) and
// the website (server/handlers.ts), so both run exactly the same business rules. Nothing here may import electron.
import { fyFor, todayLocal } from '@shared/fy'
import type { BillingApi } from '@shared/ipc'
import type { BillType, PaperSize } from '@shared/models'
import type { InvoicePrintData } from '@shared/invoiceHtml'
import type { CatalogueItem } from '@shared/share'
import type { DB } from './db/connection'
import { databaseProblems } from './db/connection'
import { getBusiness, setBusinessImage } from './services/business'
import {
  assignBarcodes, deleteLabelSize, getCodeFormat, getLabelDesign, labelPage, labelPrice, listLabelSizes, saveCodeFormat, saveLabelDesign,
  saveLabelSize
} from './services/labels'
import {
  createAccount, createTransfer, deactivateAccount, deleteTransfer, listAccounts, listAccountsWithBalance, printAccount, updateAccount
} from './services/accounts'
import { deletePayment, getPayment, listPayments, nextPaymentNumber, openDocuments, savePayment } from './services/payments'
import { accountStatement, partyStatement } from './services/statements'
import { deleteBill, getBill, listBills, nextBillNumber, saveBill } from './services/invoices'
import { deleteExpense, listExpenseCategories, listExpenses, saveExpense } from './services/expenses'
import { createAdjustment, deleteAdjustment, stockSummary } from './services/inventory'
import { ageing, billRegister, dashboard, dayBook, gstSummary, itemSales, profitLoss } from './services/reports'
import {
  addItemSizes, createItem, deleteItem, generateBarcode, getItem, getItemImage, listItemCategories, listItems, setItemActive, updateItem
} from './services/items'
import { listSeries, updateSeries } from './services/numberSeries'
import { createParty, deleteParty, getParty, listParties, listPartyGroups, setPartyActive, updateParty } from './services/parties'
import { getPreferences, savePreferences } from './services/settings'
import { listMovements } from './services/stock'
import { createTaxRate, listTaxRates, setTaxRateActive } from './services/taxRates'
import { createUnit, deleteUnit, listUnits } from './services/units'
import { listAudit } from './services/auditLog'
import { gstr1, gstr3b } from './services/gstReturns'
import { listBin, restoreFromBin } from './services/recycleBin'
import { getFeatures, getItemFields, getPrintSettings, samplePrintHtml, saveFeatures, saveItemFields, savePrintSettings } from './services/printDesign'
import { bulkUpdateItems, commitImport } from './services/imports'
import { UserError } from './util'

const PAPER_SIZES: PaperSize[] = ['A4', 'A5', 'thermal80', 'thermal58']

/** Everything a printed bill needs, on the business's paper or the one asked for. */
export function printData(db: DB, type: BillType, id: string, paper?: PaperSize | null): InvoicePrintData {
  const prefs = getPreferences(db)
  if (paper && !PAPER_SIZES.includes(paper)) throw new UserError('Unknown paper size')
  const invoice = getBill(db, type, id)
  let partyCustomFields: string[] | null = null
  if (invoice.partyId) {
    try {
      partyCustomFields = getParty(db, invoice.partyId).customFields ?? null
    } catch {
      // The party has since been deleted.
    }
  }
  return {
    type,
    invoice,
    partyCustomFields,
    business: getBusiness(db),
    bank: printAccount(db),
    paper: paper || prefs.paperSize,
    gstRegistered: prefs.gstRegistered,
    design: getPrintSettings(db),
    itemFields: getItemFields(db),
    features: getFeatures(db)
  }
}

/** Items for posters and the catalogue, in the order asked: price with GST (what the customer pays) and photo. */
export function catalogueItems(db: DB, ids: string[]): (CatalogueItem & { id: string })[] {
  if (!Array.isArray(ids) || ids.length > 1000) throw new UserError('Choose at most 1000 items')
  const registered = getPreferences(db).gstRegistered
  const rates = new Map(listTaxRates(db).map((r) => [r.id, r]))
  const byId = new Map(listItems(db).map((i) => [i.id, i]))
  return ids.flatMap((id) => {
    const i = byId.get(id)
    if (!i) return []
    const r = i.taxRateId ? rates.get(i.taxRateId) : undefined
    return [{
      id, name: i.name, description: i.description, category: i.category, unit: i.baseUnitShort,
      price: labelPrice(i.salePrice, i.priceIncludesTax, r?.rateBp ?? 0, r?.cessBp ?? 0, registered),
      mrp: i.mrp, photo: i.hasImage ? getItemImage(db, id) : null
    }]
  })
}

export type CoreHandlers = Pick<BillingApi,
  | 'setBusinessImage' | 'getPreferences' | 'savePreferences' | 'listSeries' | 'updateSeries' | 'listTaxRates' | 'createTaxRate'
  | 'setTaxRateActive' | 'listUnits' | 'createUnit' | 'deleteUnit' | 'listParties' | 'getParty' | 'createParty' | 'updateParty'
  | 'setPartyActive' | 'deleteParty' | 'listPartyGroups' | 'listItems' | 'getItem' | 'createItem' | 'addItemSizes' | 'updateItem'
  | 'setItemActive' | 'deleteItem' | 'listItemCategories' | 'listStockMovements' | 'getItemImage' | 'generateBarcode' | 'assignBarcodes'
  | 'previewLabels' | 'catalogueItems' | 'getFeatures' | 'saveFeatures' | 'getItemFields' | 'saveItemFields' | 'getPrintSettings'
  | 'savePrintSettings' | 'previewPrintSettings' | 'commitImport' | 'bulkUpdateItems' | 'listLabelSizes' | 'saveLabelSize'
  | 'deleteLabelSize' | 'getLabelDesign' | 'getCodeFormat' | 'saveCodeFormat' | 'saveLabelDesign' | 'listAccounts' | 'listBills' | 'getBill'
  | 'nextBillNumber' | 'saveBill' | 'deleteBill' | 'getBillPrint' | 'createAdjustment' | 'deleteAdjustment' | 'stockSummary'
  | 'listPayments' | 'getPayment' | 'nextPaymentNumber' | 'openDocuments' | 'savePayment' | 'deletePayment' | 'partyStatement'
  | 'accountStatement' | 'listAccountsWithBalance' | 'createAccount' | 'updateAccount' | 'deactivateAccount' | 'createTransfer'
  | 'deleteTransfer' | 'listExpenses' | 'saveExpense' | 'deleteExpense' | 'listExpenseCategories' | 'checkDatabase' | 'listBin'
  | 'restoreFromBin' | 'listAudit' | 'gstr1' | 'gstr3b' | 'dashboard' | 'billRegister' | 'dayBook' | 'ageing' | 'profitLoss'
  | 'gstSummary' | 'itemSales'>

export function coreHandlers(db: () => DB): CoreHandlers {
  return {
    setBusinessImage: async (kind, dataUrl) => setBusinessImage(db(), kind, dataUrl),

    getPreferences: async () => getPreferences(db()),
    savePreferences: async (changes) => savePreferences(db(), changes),

    listSeries: async () => {
      const fy = fyFor(todayLocal(), getBusiness(db()).fyStartMonth)
      return { fy, series: listSeries(db(), fy) }
    },
    updateSeries: async (id, update) => updateSeries(db(), id, update),

    listTaxRates: async () => listTaxRates(db()),
    createTaxRate: async (input) => createTaxRate(db(), input),
    setTaxRateActive: async (id, active) => setTaxRateActive(db(), id, active),

    listUnits: async () => listUnits(db()),
    createUnit: async (name, short) => createUnit(db(), name, short),
    deleteUnit: async (id) => deleteUnit(db(), id),

    listParties: async () => listParties(db()),
    getParty: async (id) => getParty(db(), id),
    createParty: async (input) => createParty(db(), input),
    updateParty: async (id, input) => updateParty(db(), id, input),
    setPartyActive: async (id, active) => setPartyActive(db(), id, active),
    deleteParty: async (id) => deleteParty(db(), id),
    listPartyGroups: async () => listPartyGroups(db()),

    listItems: async () => listItems(db()),
    getItem: async (id) => getItem(db(), id),
    createItem: async (input) => createItem(db(), input),
    addItemSizes: async (itemId, sizes) => addItemSizes(db(), itemId, sizes),
    updateItem: async (id, input) => updateItem(db(), id, input),
    setItemActive: async (id, active) => setItemActive(db(), id, active),
    deleteItem: async (id) => deleteItem(db(), id),
    listItemCategories: async () => listItemCategories(db()),
    listStockMovements: async (itemId) => listMovements(db(), itemId),
    getItemImage: async (id) => getItemImage(db(), id),
    generateBarcode: async () => generateBarcode(db()),
    assignBarcodes: async (ids) => assignBarcodes(db(), ids),
    previewLabels: async (req) => labelPage(db(), req),
    catalogueItems: async (ids) => catalogueItems(db(), ids),

    getFeatures: async () => getFeatures(db()),
    saveFeatures: async (s) => saveFeatures(db(), s),
    getItemFields: async () => getItemFields(db()),
    saveItemFields: async (s) => saveItemFields(db(), s),
    getPrintSettings: async () => getPrintSettings(db()),
    savePrintSettings: async (s) => savePrintSettings(db(), s),
    previewPrintSettings: async (s, paper) => samplePrintHtml(db(), s, paper),
    commitImport: async (token) => commitImport(db(), token),
    bulkUpdateItems: async (changes) => bulkUpdateItems(db(), changes),
    listLabelSizes: async () => listLabelSizes(db()),
    saveLabelSize: async (id, name, size) => saveLabelSize(db(), id, name, size),
    deleteLabelSize: async (id) => deleteLabelSize(db(), id),
    getLabelDesign: async () => getLabelDesign(db()),
    getCodeFormat: async () => getCodeFormat(db()),
    saveCodeFormat: async (f) => saveCodeFormat(db(), f),
    saveLabelDesign: async (d) => saveLabelDesign(db(), d),

    listAccounts: async () => listAccounts(db()),

    listBills: async (type, filter) => listBills(db(), type, filter ?? {}),
    getBill: async (type, id) => getBill(db(), type, id),
    nextBillNumber: async (type, date) => nextBillNumber(db(), type, date),
    saveBill: async (type, id, input) => saveBill(db(), type, id, input),
    deleteBill: async (type, id) => deleteBill(db(), type, id),
    getBillPrint: async (type, id, paper) => printData(db(), type, id, paper),

    createAdjustment: async (input) => createAdjustment(db(), input),
    deleteAdjustment: async (id) => deleteAdjustment(db(), id),
    stockSummary: async (asOf) => stockSummary(db(), asOf),

    listPayments: async (filter) => listPayments(db(), filter ?? {}),
    getPayment: async (id) => getPayment(db(), id),
    nextPaymentNumber: async (direction, date) => nextPaymentNumber(db(), direction, date),
    openDocuments: async (partyId, direction, paymentId) => openDocuments(db(), partyId, direction, paymentId),
    savePayment: async (id, input) => savePayment(db(), id, input),
    deletePayment: async (id) => deletePayment(db(), id),

    partyStatement: async (partyId, period) => partyStatement(db(), partyId, period ?? {}),
    accountStatement: async (accountId, period) => accountStatement(db(), accountId, period ?? {}),

    listAccountsWithBalance: async () => listAccountsWithBalance(db()),
    createAccount: async (input) => createAccount(db(), input),
    updateAccount: async (id, input) => updateAccount(db(), id, input),
    deactivateAccount: async (id) => deactivateAccount(db(), id),
    createTransfer: async (input) => createTransfer(db(), input),
    deleteTransfer: async (id) => deleteTransfer(db(), id),

    listExpenses: async (period) => listExpenses(db(), period ?? {}),
    saveExpense: async (id, input) => saveExpense(db(), id, input),
    deleteExpense: async (id) => deleteExpense(db(), id),
    listExpenseCategories: async () => listExpenseCategories(db()),

    checkDatabase: async () => databaseProblems(db()),
    listBin: async () => listBin(db()),
    restoreFromBin: async (kind, id) => restoreFromBin(db(), kind, id),
    listAudit: async (filter) => listAudit(db(), filter ?? {}),

    gstr1: async (period) => gstr1(db(), period ?? {}),
    gstr3b: async (period) => gstr3b(db(), period ?? {}),

    dashboard: async () => dashboard(db()),
    billRegister: async (type, period) => billRegister(db(), type, period ?? {}),
    dayBook: async (period) => dayBook(db(), period ?? {}),
    ageing: async (side) => ageing(db(), side),
    profitLoss: async (period) => profitLoss(db(), period ?? {}),
    gstSummary: async (period) => gstSummary(db(), period ?? {}),
    itemSales: async (period) => itemSales(db(), period ?? {})
  }
}
