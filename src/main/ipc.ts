import { mkdirSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fyFor, todayLocal } from '@shared/fy'
import type { BillingApi } from '@shared/ipc'
import { databaseProblems, schemaVersion } from './db/connection'
import type { Session } from './session'
import { getBusiness, setBusinessImage, updateBusiness } from './services/business'
import { assignBarcodes, deleteLabelSize, getCodeFormat, getLabelDesign, saveCodeFormat, labelPage, listLabelSizes, saveLabelDesign, saveLabelSize } from './services/labels'
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
import type { BillType, PaperSize } from '@shared/models'

const PAPER_SIZES: PaperSize[] = ['A4', 'A5', 'thermal80', 'thermal58']
import type { InvoicePrintData } from '@shared/invoiceHtml'
import {
  addItemSizes, createItem, deleteItem, generateBarcode, getItem, getItemImage, listItemCategories, listItems, setItemActive, updateItem
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
import { catalogueItems as sharedCatalogueItems, coreHandlers, printData as sharedPrintData } from './coreHandlers'
import { listAudit } from './services/auditLog'
import { gstr1, gstr3b } from './services/gstReturns'
import { gstr1Json } from '@shared/gstr1Json'
import { writeFileSync } from 'node:fs'
import { listBin, restoreFromBin } from './services/recycleBin'
import { getFeatures, getItemFields, getPrintSettings, samplePrintHtml, saveFeatures, saveItemFields, savePrintSettings } from './services/printDesign'
import { bulkUpdateItems, commitImport, exportSheets, previewImport, templateSheets } from './services/imports'
import { readSpreadsheet, writeXlsx } from './xlsx'
import { copyPoster, htmlToPdf, keepForSharing, openSafe, savePdfAs, savePoster } from './share'
import { catalogueHtml, gmailLink, mailtoLink, smsLink, whatsappLink, type CatalogueItem } from '@shared/share'
import { invoiceHtml } from '@shared/invoiceHtml'
import { labelPrice } from './services/labels'
import { readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { check, NOT_OWNER } from './access'
import { isTrustedSender } from './security'
import { logError } from './log'
import {
  changeMyPassword, createUser, getIdleMinutes, listUsers, login, loginRequired, recoverOwner, renewRecoveryCode, setIdleMinutes,
  setupOwner, turnOffLogins, updateUser
} from './services/users'
import type { Business } from '@shared/models'

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

/** The business with only its id and name, for screens shown before sign-in. */
const nameOnly = (b: Business): Business => ({
  ...b, legalName: '', gstin: '', pan: '', address: '', city: '', pincode: '', phone: '', email: '', businessType: '', category: '', logo: '', signature: ''
})

export function createHandlers(session: Session): BillingApi {
  const db = () => session.requireDb()
  const locked = () => session.isOpen && loginRequired(db()) && !session.user
  const owner = () => {
    const u = session.user
    if (!u || u.role !== 'owner') throw new UserError(NOT_OWNER)
    return u
  }
  // Backup files the screen may name: only ones the owner picked in a file window, or the app's own backups.
  // Restore and import must never be pointed at any other file on the computer.
  const approvedBackups = new Set<string>()
  const approve = (p: string) => approvedBackups.add(resolve(p).toLowerCase())
  const approved = (p: unknown): string => {
    if (typeof p !== 'string' || !approvedBackups.has(resolve(p).toLowerCase())) throw new UserError('Choose the backup file again')
    return p
  }
  const printData = (type: BillType, id: string, paper?: PaperSize | null): InvoicePrintData => sharedPrintData(db(), type, id, paper)
  const catalogueItems = (ids: string[]) => sharedCatalogueItems(db(), ids)

  return {
    ...coreHandlers(db),
    getAppInfo: async () => ({
      appVersion: app.getVersion(),
      dbPath: session.dbPath,
      schemaVersion: session.isOpen ? schemaVersion(db()) : null
    }),

    listBusinesses: async () => session.registry.list(),
    currentBusiness: async () => session.current(),

    authStatus: async () => {
      const b = session.current()
      const required = !!b && loginRequired(db())
      return { business: b ? { id: b.id, name: b.name } : null, required, user: required ? session.user : null, idleMinutes: b ? getIdleMinutes(db()) : 0 }
    },
    login: async (username, password) => {
      if (!session.isOpen) throw new UserError('Open a business first')
      const user = login(db(), username, password)
      session.setUser(user)
      return user
    },
    logout: async () => session.setUser(null),
    setupOwner: async (input) => {
      // Switching logins on is allowed only while they are off (then everyone is effectively the owner).
      const r = setupOwner(db(), input)
      session.setUser(r.user)
      return r
    },
    recoverOwner: async (code, username, password) => recoverOwner(db(), code, username, password),
    listUsers: async () => (owner(), listUsers(db())),
    createUser: async (input) => {
      owner()
      if (!loginRequired(db())) throw new UserError('Switch logins on first')
      return createUser(db(), input)
    },
    updateUser: async (id, update) => {
      const me = owner()
      const u = updateUser(db(), id, update)
      if (id === me.id) session.setUser(u.isActive ? { id: u.id, name: u.name, username: u.username, role: u.role } : null)
      return u
    },
    changeMyPassword: async (current, next) => {
      const me = session.user
      if (!me) throw new UserError('Please sign in')
      changeMyPassword(db(), me, current, next)
    },
    renewRecoveryCode: async () => (owner(), renewRecoveryCode(db())),
    setIdleMinutes: async (minutes) => (owner(), setIdleMinutes(db(), minutes)),
    turnOffLogins: async (password) => {
      turnOffLogins(db(), owner(), password)
      session.setUser(null)
    },
    createBusiness: async (input) => {
      const b = session.create(input)
      autoBackupLater(session)
      return b
    },
    openBusiness: async (id) => {
      const b = session.open(id)
      autoBackupLater(session)
      return locked() ? nameOnly(b) : b
    },
    closeBusiness: async () => session.close(),
    updateBusiness: async (profile) => {
      const business = updateBusiness(db(), profile)
      session.syncName(business)
      return business
    },

    printLabels: async (req) => printLabels(labelPage(db(), req)),
    saveLabelsPdf: async (req) => saveLabelsPdf(labelPage(db(), req)),
    savePoster: async (html, size, name) => savePoster(html, size, name),
    copyPoster: async (html, size) => copyPoster(html, size),
    saveCatalogue: async (ids, options) => {
      const b = getBusiness(db())
      return savePdfAs(catalogueHtml(catalogueItems(ids), options, b), `${b.name} ${options.title || 'catalogue'}`)
    },
    shareBillOnWhatsApp: async (type, id, text) => {
      const data = printData(type, id)
      const inv = data.invoice
      const path = keepForSharing(await htmlToPdf(invoiceHtml(data)), `${inv.number || type} ${inv.party.name}`)
      await openSafe(whatsappLink(inv.party.phone, text))
      return path
    },
    shareBill: async (type, id, req) => {
      const data = printData(type, id, req.paper)
      const inv = data.invoice
      const text = String(req.text ?? '').slice(0, 4000)
      const subject = String(req.subject ?? '').slice(0, 200)
      let path = ''
      if (req.channel !== 'sms') path = keepForSharing(await htmlToPdf(invoiceHtml(data)), `${inv.number || type} ${inv.party.name}`)
      const to = String(req.to ?? '')
      const url =
        req.channel === 'whatsapp' ? whatsappLink(to || inv.party.phone, text)
        : req.channel === 'gmail' ? gmailLink(to, subject, text)
        : req.channel === 'email' ? mailtoLink(to, subject, text)
        : req.channel === 'sms' ? smsLink(to || inv.party.phone, text)
        : ''
      if (!url) throw new UserError('Choose how to share')
      await openSafe(url)
      return path
    },
    openWhatsApp: async (phone, text) => openSafe(whatsappLink(phone, text)),
    openWeb: async (url) => openSafe(url),
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
      if (statSync(r.filePaths[0]).size > 20 * 1024 * 1024) throw new UserError('That file is too large (over 20 MB). Split it into smaller files.')
      let rows
      try {
        rows = readSpreadsheet(r.filePaths[0], readFileSync(r.filePaths[0]))
      } catch (e) {
        throw new UserError((e as Error).message)
      }
      return previewImport(db(), kind, rows, basename(r.filePaths[0]))
    },

    exportBillPdf: async (type, id, paper) => exportPdf(printData(type, id, paper)),
    printBill: async (type, id, paper) => printInvoice(printData(type, id, paper)),

    backupNow: async () => {
      const name = `${getBusiness(db()).name} backup ${todayLocal()}`.replace(/[\\/:*?"<>|]+/g, '-')
      const options = { title: 'Save backup', defaultPath: `${name}.db`, filters: BACKUP_FILTER }
      const parent = parentWindow()
      const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (r.canceled || !r.filePath) return null
      return session.backupTo(r.filePath)
    },
    getBackupMirror: async () => session.mirrorDir,
    chooseBackupMirror: async () => {
      const options = { title: 'Choose a second place for backups (another drive, or a OneDrive / Google Drive folder)', properties: ['openDirectory' as const, 'createDirectory' as const] }
      const parent = parentWindow()
      const r = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      if (r.canceled || !r.filePaths[0]) return null
      session.setMirrorDir(r.filePaths[0])
      return r.filePaths[0]
    },
    clearBackupMirror: async () => session.setMirrorDir(null),
    backupToMirrorNow: async () => {
      const dir = session.backupDir()
      mkdirSync(dir, { recursive: true })
      const local = await session.backupTo(join(dir, `auto-${todayLocal()}.db`))
      return { local, mirror: await session.mirrorLatest() }
    },
    listBackups: async () => {
      const list = session.listBackups()
      for (const f of list) approve(f.path)
      return list
    },
    chooseBackupFile: async () => {
      const options = { title: 'Choose a backup', properties: ['openFile' as const], filters: BACKUP_FILTER }
      const parent = parentWindow()
      const r = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      if (r.canceled || !r.filePaths[0]) return null
      approve(r.filePaths[0])
      return session.inspectBackup(r.filePaths[0])
    },
    inspectBackup: async (path) => session.inspectBackup(approved(path)),
    restoreBackup: async (path) => session.restore(approved(path)),
    importBackup: async (path) => session.importBackup(approved(path)),
    openBackupFolder: async () => {
      const dir = session.backupDir()
      mkdirSync(dir, { recursive: true })
      await shell.openPath(dir)
    },

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

    exportReport: async (doc, format) => exportReport(doc, getBusiness(db()).name, format),
    printReport: async (doc) => printReport(doc, getBusiness(db()).name)
  }
}

export function registerIpc(session: Session): void {
  const handlers = createHandlers(session)
  for (const [channel, fn] of Object.entries(handlers) as [string, (...args: unknown[]) => Promise<unknown>][]) {
    ipcMain.handle(channel, async (event, ...args) => {
      // Only the app's own window may call in; hidden print windows and the invoice preview cannot.
      if (!isTrustedSender(event)) throw new Error('Not allowed')
      try {
        check(session, channel, args)
        return await fn(...args)
      } catch (err) {
        if (err instanceof UserError) throw err
        // Details (file paths, database messages) go to the local log, not to the screen.
        const ref = logError(channel, err)
        throw new Error(`Something went wrong. Please try again; if it keeps happening, restart the app. (ref ${ref})`)
      }
    })
  }
}
