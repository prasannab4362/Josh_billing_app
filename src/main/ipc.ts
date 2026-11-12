import { mkdirSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fyFor, todayLocal } from '@shared/fy'
import type { BillingApi } from '@shared/ipc'
import { schemaVersion } from './db/connection'
import type { Session } from './session'
import { getBusiness, setBusinessImage, updateBusiness } from './services/business'
import { assignBarcodes, deleteLabelSize, getLabelDesign, labelPage, listLabelSizes, saveLabelDesign, saveLabelSize } from './services/labels'
import {
  createAccount, createTransfer, deactivateAccount, deleteTransfer, listAccounts, listAccountsWithBalance, printAccount,
  updateAccount
} from './services/accounts'
import { deletePayment, getPayment, listPayments, nextPaymentNumber, openDocuments, savePayment } from './services/payments'
import { accountStatement, partyStatement } from './services/statements'
import { deleteBill, getBill, listBills, nextBillNumber, saveBill } from './services/invoices'
import { deleteExpense, listExpenseCategories, listExpenses, saveExpense } from './services/expenses'
import { createAdjustment, deleteAdjustment, stockSummary } from './services/inventory'
import { exportPdf, exportReport, printInvoice, printLabels, printReport, saveLabelsPdf } from './print'
import { ageing, billRegister, dashboard, dayBook, gstSummary, itemSales, profitLoss } from './services/reports'
import type { BillType } from '@shared/models'
import type { InvoicePrintData } from '@shared/invoiceHtml'
import {
  createItem, deleteItem, generateBarcode, getItem, getItemImage, listItemCategories, listItems, setItemActive, updateItem
} from './services/items'
import { listSeries, updateSeries } from './services/numberSeries'
import {
  createParty, deleteParty, getParty, listParties, listPartyGroups, setPartyActive, updateParty
} from './services/parties'
import { getPreferences, savePreferences } from './services/settings'
import { listMovements } from './services/stock'
import { createTaxRate, listTaxRates, setTaxRateActive } from './services/taxRates'
import { createUnit, deleteUnit, listUnits } from './services/units'
import { UserError } from './util'
import { listAudit } from './services/auditLog'
import { gstr1, gstr3b } from './services/gstReturns'
import { gstr1Json } from '@shared/gstr1Json'
import { writeFileSync } from 'node:fs'
import { listBin, restoreFromBin } from './services/recycleBin'
import { getFeatures, getItemFields, getPrintSettings, samplePrintHtml, saveFeatures, saveItemFields, savePrintSettings } from './services/printDesign'
import { bulkUpdateItems, commitImport, exportSheets, previewImport, templateSheets } from './services/imports'
import { readSpreadsheet, writeXlsx } from './xlsx'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

/** Take today's automatic backup in the background; a failure must never stop the app. */
export function autoBackupLater(session: Session): void {
  setTimeout(() => {
    session.autoBackup().catch((err) => console.error('Automatic backup failed', err))
  }, 1500)
}

const BACKUP_FILTER = [{ name: 'Billing backup', extensions: ['db'] }]
const parentWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

/** Ask where to save an Excel file. */
async function askXlsxPath(name: string): Promise<string | null> {
  const options = { defaultPath: `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.xlsx`, filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] }
  const parent = parentWindow()
  const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  return r.canceled || !r.filePath ? null : r.filePath
}

export function createHandlers(session: Session): BillingApi {
  const db = () => session.requireDb()
  // The party's own field values; none when the party has since been deleted.
  const partyFieldsOf = (id: string | null): string[] | null => {
    if (!id) return null
    try {
      return getParty(db(), id).customFields ?? null
    } catch {
      return null
    }
  }
  const printData = (type: BillType, id: string): InvoicePrintData => {
    const prefs = getPreferences(db())
    const invoice = getBill(db(), type, id)
    return {
      type,
      invoice,
      partyCustomFields: partyFieldsOf(invoice.partyId),
      business: getBusiness(db()),
      bank: printAccount(db()),
      paper: prefs.paperSize,
      gstRegistered: prefs.gstRegistered,
      design: getPrintSettings(db()),
      itemFields: getItemFields(db()),
      features: getFeatures(db())
    }
  }

  return {
    getAppInfo: async () => ({
      appVersion: app.getVersion(),
      dbPath: session.dbPath,
      schemaVersion: session.isOpen ? schemaVersion(db()) : null
    }),

    listBusinesses: async () => session.registry.list(),
    currentBusiness: async () => session.current(),
    createBusiness: async (input) => {
      const b = session.create(input)
      autoBackupLater(session)
      return b
    },
    openBusiness: async (id) => {
      const b = session.open(id)
      autoBackupLater(session)
      return b
    },
    closeBusiness: async () => session.close(),
    updateBusiness: async (profile) => {
      const business = updateBusiness(db(), profile)
      session.syncName(business)
      return business
    },

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
    updateItem: async (id, input) => updateItem(db(), id, input),
    setItemActive: async (id, active) => setItemActive(db(), id, active),
    deleteItem: async (id) => deleteItem(db(), id),
    listItemCategories: async () => listItemCategories(db()),
    listStockMovements: async (itemId) => listMovements(db(), itemId),
    getItemImage: async (id) => getItemImage(db(), id),
    generateBarcode: async () => generateBarcode(db()),
    assignBarcodes: async (ids) => assignBarcodes(db(), ids),
    previewLabels: async (req) => labelPage(db(), req),
    printLabels: async (req) => printLabels(labelPage(db(), req)),
    saveLabelsPdf: async (req) => saveLabelsPdf(labelPage(db(), req)),
    getFeatures: async () => getFeatures(db()),
    saveFeatures: async (s) => saveFeatures(db(), s),
    getItemFields: async () => getItemFields(db()),
    saveItemFields: async (s) => saveItemFields(db(), s),
    getPrintSettings: async () => getPrintSettings(db()),
    savePrintSettings: async (s) => savePrintSettings(db(), s),
    previewPrintSettings: async (s, paper) => samplePrintHtml(db(), s, paper),
    saveImportTemplate: async (kind) => {
      const path = await askXlsxPath(kind === 'items' ? 'Items import template' : 'Parties import template')
      if (path) writeFileSync(path, writeXlsx(templateSheets(kind)))
      return path
    },
    exportToExcel: async (kind) => {
      const path = await askXlsxPath(`${getBusiness(db()).name} ${kind === 'items' ? 'items' : 'parties'} ${todayLocal()}`)
      if (path) writeFileSync(path, writeXlsx(exportSheets(db(), kind)))
      return path
    },
    chooseImportFile: async (kind) => {
      const options = {
        title: kind === 'items' ? 'Choose the items file' : 'Choose the parties file',
        properties: ['openFile' as const],
        filters: [{ name: 'Excel or CSV', extensions: ['xlsx', 'csv', 'xls'] }]
      }
      const parent = parentWindow()
      const r = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      if (r.canceled || !r.filePaths[0]) return null
      let rows
      try {
        rows = readSpreadsheet(r.filePaths[0], readFileSync(r.filePaths[0]))
      } catch (e) {
        throw new UserError((e as Error).message)
      }
      return previewImport(db(), kind, rows, basename(r.filePaths[0]))
    },
    commitImport: async (token) => commitImport(db(), token),
    bulkUpdateItems: async (changes) => bulkUpdateItems(db(), changes),
    listLabelSizes: async () => listLabelSizes(db()),
    saveLabelSize: async (id, name, size) => saveLabelSize(db(), id, name, size),
    deleteLabelSize: async (id) => deleteLabelSize(db(), id),
    getLabelDesign: async () => getLabelDesign(db()),
    saveLabelDesign: async (d) => saveLabelDesign(db(), d),

    listAccounts: async () => listAccounts(db()),

    listBills: async (type, filter) => listBills(db(), type, filter ?? {}),
    getBill: async (type, id) => getBill(db(), type, id),
    nextBillNumber: async (type, date) => nextBillNumber(db(), type, date),
    saveBill: async (type, id, input) => saveBill(db(), type, id, input),
    deleteBill: async (type, id) => deleteBill(db(), type, id),
    getBillPrint: async (type, id) => printData(type, id),
    exportBillPdf: async (type, id) => exportPdf(printData(type, id)),
    printBill: async (type, id) => printInvoice(printData(type, id)),

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

    backupNow: async () => {
      const name = `${getBusiness(db()).name} backup ${todayLocal()}`.replace(/[\\/:*?"<>|]+/g, '-')
      const options = { title: 'Save backup', defaultPath: `${name}.db`, filters: BACKUP_FILTER }
      const parent = parentWindow()
      const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (r.canceled || !r.filePath) return null
      return session.backupTo(r.filePath)
    },
    listBackups: async () => session.listBackups(),
    chooseBackupFile: async () => {
      const options = { title: 'Choose a backup', properties: ['openFile' as const], filters: BACKUP_FILTER }
      const parent = parentWindow()
      const r = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      if (r.canceled || !r.filePaths[0]) return null
      return session.inspectBackup(r.filePaths[0])
    },
    inspectBackup: async (path) => session.inspectBackup(path),
    restoreBackup: async (path) => session.restore(path),
    importBackup: async (path) => session.importBackup(path),
    openBackupFolder: async () => {
      const dir = session.backupDir()
      mkdirSync(dir, { recursive: true })
      await shell.openPath(dir)
    },

    listBin: async () => listBin(db()),
    restoreFromBin: async (kind, id) => restoreFromBin(db(), kind, id),
    listAudit: async (filter) => listAudit(db(), filter ?? {}),

    gstr1: async (period) => gstr1(db(), period ?? {}),
    gstr3b: async (period) => gstr3b(db(), period ?? {}),
    exportGstr1Json: async (period) => {
      const g = gstr1(db(), period ?? {})
      if (!g.gstin) throw new UserError('Add your business GSTIN in Settings › Business first')
      const options = { title: 'Save GSTR-1 JSON', defaultPath: `GSTR1_${g.gstin}_${g.period}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] }
      const parent = parentWindow()
      const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (r.canceled || !r.filePath) return null
      writeFileSync(r.filePath, JSON.stringify(gstr1Json(g)), 'utf8')
      return r.filePath
    },

    dashboard: async () => dashboard(db()),
    billRegister: async (type, period) => billRegister(db(), type, period ?? {}),
    dayBook: async (period) => dayBook(db(), period ?? {}),
    ageing: async (side) => ageing(db(), side),
    profitLoss: async (period) => profitLoss(db(), period ?? {}),
    gstSummary: async (period) => gstSummary(db(), period ?? {}),
    itemSales: async (period) => itemSales(db(), period ?? {}),
    exportReport: async (doc, format) => exportReport(doc, getBusiness(db()).name, format),
    printReport: async (doc) => printReport(doc, getBusiness(db()).name)
  }
}

export function registerIpc(session: Session): void {
  const handlers = createHandlers(session)
  for (const [channel, fn] of Object.entries(handlers) as [string, (...args: unknown[]) => Promise<unknown>][]) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...args)
      } catch (err) {
        if (err instanceof UserError) throw err
        console.error(`[ipc:${channel}]`, err)
        throw new Error(`Something went wrong: ${(err as Error).message}`)
      }
    })
  }
}
