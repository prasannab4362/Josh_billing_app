// Every call of the app's API, for the website. The business rules are the desktop's own (coreHandlers); only what
// the desktop does with windows, printers and files is done here the web way: the browser is asked to download a
// file, print a page or open a link (WebEffect), and files come in as uploads.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { todayLocal } from '@shared/fy'
import { gstr1Json } from '@shared/gstr1Json'
import { invoiceHtml } from '@shared/invoiceHtml'
import type { BillingApi } from '@shared/ipc'
import type { Role } from '@shared/auth'
import { reportCsv, reportHtml } from '@shared/reportDoc'
import { catalogueHtml, gmailLink, isSafeExternalUrl, mailtoLink, smsLink, whatsappLink } from '@shared/share'
import { MAX_UPLOAD_BYTES, type UploadedFile, type WebEffect } from '@shared/web'
import type { BackupInfo } from '@shared/data'
import { schemaVersion } from '../main/db/connection'
import { catalogueItems, coreHandlers, printData } from '../main/coreHandlers'
import type { Session } from '../main/session'
import { getBusiness, updateBusiness } from '../main/services/business'
import { exportSheets, previewImport, templateSheets } from '../main/services/imports'
import { labelPage } from '../main/services/labels'
import { gstr1 } from '../main/services/gstReturns'
import { UserError } from '../main/util'
import { readSpreadsheet, writeXlsx } from '../main/xlsx'
import {
  addBusiness, changePassword, myBusinesses, renameBusiness, roleIn, setSessionBusiness, type AccountsDB, type SessionInfo
} from './accounts'
import type { BusinessPool } from './pool'

/** Files the website keeps for a while: uploaded backups, and the business's own backups, by an id the page may use. */
export class FileTokens {
  private readonly files = new Map<string, { path: string; userId: string; temp: boolean; until: number }>()

  constructor(private readonly dir: string) {}

  /** Keep an uploaded file and give it an id. */
  saveUpload(userId: string, file: UploadedFile, ext: string): string {
    const data = decode(file)
    mkdirSync(this.dir, { recursive: true })
    const path = join(this.dir, `${randomBytes(12).toString('hex')}${ext}`)
    writeFileSync(path, data)
    return this.add(userId, path, true)
  }

  add(userId: string, path: string, temp = false): string {
    this.sweep()
    const id = `file:${randomBytes(16).toString('hex')}`
    this.files.set(id, { path, userId, temp, until: Date.now() + 3600_000 })
    return id
  }

  /** The real path behind an id this person was given. */
  path(userId: string, id: unknown): string {
    const f = typeof id === 'string' ? this.files.get(id) : undefined
    if (!f || f.userId !== userId || f.until < Date.now()) throw new UserError('Choose the backup file again')
    return f.path
  }

  sweep(): void {
    const now = Date.now()
    for (const [id, f] of this.files) {
      if (f.until < now) {
        if (f.temp) rmSync(f.path, { force: true })
        this.files.delete(id)
      }
    }
  }
}

export function decode(file: UploadedFile | undefined): Buffer {
  if (!file || typeof file.base64 !== 'string' || typeof file.name !== 'string') throw new UserError('Choose a file')
  if (file.base64.length > (MAX_UPLOAD_BYTES * 4) / 3 + 4) throw new UserError('That file is too large (over 50 MB)')
  return Buffer.from(file.base64, 'base64')
}

const download = (name: string, mime: string, data: Buffer | string, result: unknown = name): WebEffect => ({
  __web: 'download', name: safeName(name), mime, base64: Buffer.from(data).toString('base64'), result
})
const print = (html: string, result: unknown): WebEffect => ({ __web: 'print', html, result })
const open = (url: string, result: unknown): WebEffect => {
  if (!isSafeExternalUrl(url)) throw new UserError('That link cannot be opened')
  return { __web: 'open', url, result }
}
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ON_WEBSITE = 'On the website, people sign in with their email. The owner adds staff under Team, at the top of the page.'

export interface WebCtx {
  accounts: AccountsDB
  pool: BusinessPool
  files: FileTokens
  me: SessionInfo
  version: string
  /** The open business, when one is open and this person may use it. */
  biz: { session: Session; role: Role; ownerId: string } | null
}

/** The API for one call. Answers may be a WebEffect for the browser to carry out. */
export function webHandlers(ctx: WebCtx): BillingApi & WebExtras {
  const { accounts, pool, me } = ctx
  const session = (): Session => {
    if (!ctx.biz) throw new UserError('No business is open')
    return ctx.biz.session
  }
  const db = () => session().requireDb()
  const owner = () => {
    if (ctx.biz?.role !== 'owner') throw new UserError('Only the owner can do this')
  }
  const toEffect = <T>(e: WebEffect): T => e as unknown as T
  const backupInfo = (info: BackupInfo, id: string): BackupInfo => ({ ...info, path: id })
  const choose = (businessId: string | null) => setSessionBusiness(accounts, me.tokenHash, businessId)

  return {
    ...coreHandlers(db),

    getAppInfo: async () => ({ appVersion: ctx.version, dbPath: null, schemaVersion: ctx.biz ? schemaVersion(db()) : null }),
    listBusinesses: async () =>
      myBusinesses(accounts, me.user.id).map((b) => ({ id: b.id, name: b.name, file: '', createdAt: b.createdAt, lastOpenedAt: null })),
    currentBusiness: async () => (ctx.biz ? ctx.biz.session.current() : null),

    // The desktop's own per-business logins are not used on the website: the website account decides.
    authStatus: async () => ({ business: ctx.biz ? { id: getBusiness(db()).id, name: getBusiness(db()).name } : null, required: false, user: null, idleMinutes: 0 }),
    login: async () => { throw new UserError(ON_WEBSITE) },
    logout: async () => undefined,
    setupOwner: async () => { throw new UserError(ON_WEBSITE) },
    recoverOwner: async () => { throw new UserError(ON_WEBSITE) },
    listUsers: async () => [],
    createUser: async () => { throw new UserError(ON_WEBSITE) },
    updateUser: async () => { throw new UserError(ON_WEBSITE) },
    changeMyPassword: async (current, next) => changePassword(accounts, me.user.id, current, next, me.tokenHash),
    renewRecoveryCode: async () => { throw new UserError(ON_WEBSITE) },
    setIdleMinutes: async () => { throw new UserError(ON_WEBSITE) },
    turnOffLogins: async () => { throw new UserError(ON_WEBSITE) },

    createBusiness: async (input) => {
      const b = pool.create(me.user.id, input)
      addBusiness(accounts, b.id, me.user.id, b.name)
      choose(b.id)
      return b
    },
    openBusiness: async (id) => {
      const access = roleIn(accounts, me.user.id, String(id))
      if (!access) throw new UserError('That business was not found')
      const s = pool.get(String(id), access.ownerId)
      choose(String(id))
      return s.current()!
    },
    closeBusiness: async () => choose(null),
    updateBusiness: async (profile) => {
      const b = updateBusiness(db(), profile)
      session().syncName(b)
      renameBusiness(accounts, b.id, b.name)
      return b
    },

    printLabels: async (req) => toEffect(print(labelPage(db(), req), true)),
    saveLabelsPdf: async (req) => toEffect(print(labelPage(db(), req), null)),
    savePoster: async (html) => toEffect(print(String(html), null)),
    copyPoster: async () => {
      throw new UserError('Copying a picture is not available on the website. Use Save, then choose "Save as PDF" in the print window.')
    },
    saveCatalogue: async (ids, options) => toEffect(print(catalogueHtml(catalogueItems(db(), ids), options, getBusiness(db())), null)),
    shareBillOnWhatsApp: async (type, id, text) => {
      const inv = printData(db(), type, id).invoice
      return toEffect(open(whatsappLink(inv.party.phone, text), ''))
    },
    shareBill: async (type, id, req) => {
      const inv = printData(db(), type, id, req.paper).invoice
      const text = String(req.text ?? '').slice(0, 4000)
      const subject = String(req.subject ?? '').slice(0, 200)
      const to = String(req.to ?? '')
      const url =
        req.channel === 'whatsapp' ? whatsappLink(to || inv.party.phone, text)
        : req.channel === 'gmail' ? gmailLink(to, subject, text)
        : req.channel === 'email' ? mailtoLink(to, subject, text)
        : req.channel === 'sms' ? smsLink(to || inv.party.phone, text)
        : ''
      if (!url) throw new UserError('Choose how to share')
      return toEffect(open(url, ''))
    },
    openWhatsApp: async (phone, text) => toEffect(open(whatsappLink(phone, text), undefined)),
    openWeb: async (url) => toEffect(open(String(url), undefined)),

    saveImportTemplate: async (kind) =>
      toEffect(download(`${kind === 'items' ? 'Items' : 'Parties'} import template.xlsx`, XLSX, writeXlsx(templateSheets(kind)))),
    exportToExcel: async (kind) =>
      toEffect(download(`${getBusiness(db()).name} ${kind === 'items' ? 'items' : 'parties'} ${todayLocal()}.xlsx`, XLSX, writeXlsx(exportSheets(db(), kind)))),
    chooseImportFile: async () => {
      throw new UserError('Choose the file again')
    },
    exportBillPdf: async (type, id, paper) => toEffect(print(invoiceHtml(printData(db(), type, id, paper)), null)),
    printBill: async (type, id, paper) => toEffect(print(invoiceHtml(printData(db(), type, id, paper)), true)),

    backupNow: async () => {
      owner()
      const b = getBusiness(db())
      const dir = join(session().backupDir(), '.download')
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${randomBytes(8).toString('hex')}.db`)
      try {
        await session().backupTo(path)
        return toEffect(download(`${b.name} backup ${todayLocal()}.db`, 'application/octet-stream', readFileSync(path)))
      } finally {
        rmSync(path, { force: true })
      }
    },
    getBackupMirror: async () => null,
    chooseBackupMirror: async () => {
      throw new UserError('On the website the server keeps daily backups. Use "Back up now" to download a copy to your computer.')
    },
    clearBackupMirror: async () => undefined,
    backupToMirrorNow: async () => {
      owner()
      const path = await session().autoBackup(todayLocal(), true)
      return { local: path ? 'the server' : '', mirror: null }
    },
    listBackups: async () => {
      owner()
      return session().listBackups().map((f) => ({ ...f, path: ctx.files.add(me.user.id, f.path) }))
    },
    chooseBackupFile: async () => {
      throw new UserError('Choose the backup file again')
    },
    inspectBackup: async (id) => backupInfo(session().inspectBackup(ctx.files.path(me.user.id, id)), String(id)),
    restoreBackup: async (id) => {
      owner()
      const r = await session().restore(ctx.files.path(me.user.id, id))
      renameBusiness(accounts, r.business.id, r.business.name)
      return { business: r.business, safetyCopy: 'kept on the server' }
    },
    importBackup: async (id) => {
      const b = pool.importBackup(me.user.id, ctx.files.path(me.user.id, id))
      addBusiness(accounts, b.id, me.user.id, b.name)
      choose(b.id)
      return b
    },
    openBackupFolder: async () => {
      throw new UserError('On the website, use "Back up now" to download a copy.')
    },

    exportGstr1Json: async (period) => {
      const g = gstr1(db(), period ?? {})
      if (!g.gstin) throw new UserError('Add your business GSTIN in Settings › Business first')
      return toEffect(download(`GSTR1_${g.gstin}_${g.period}.json`, 'application/json', JSON.stringify(gstr1Json(g))))
    },
    exportReport: async (doc, format) => {
      const name = getBusiness(db()).name
      if (format === 'csv') return toEffect(download(`${doc.title ?? 'report'} ${todayLocal()}.csv`, 'text/csv', reportCsv(doc, name)))
      return toEffect(print(reportHtml(doc, name), null))
    },
    printReport: async (doc) => toEffect(print(reportHtml(doc, getBusiness(db()).name), true)),

    // Calls that come with a file chosen in the browser.
    uploadImportFile: async (kind, file) => {
      const data = decode(file)
      if (data.length > 20 * 1024 * 1024) throw new UserError('That file is too large (over 20 MB). Split it into smaller files.')
      let rows
      try {
        rows = readSpreadsheet(file.name, data)
      } catch (e) {
        throw new UserError((e as Error).message)
      }
      return previewImport(db(), kind, rows, safeName(file.name))
    },
    uploadBackupFile: async (file) => {
      const id = ctx.files.saveUpload(me.user.id, file, '.db')
      const path = ctx.files.path(me.user.id, id)
      // Read with a session of this person's own (another business's open file is never used for it).
      const info = ctx.biz ? ctx.biz.session.inspectBackup(path) : pool.inspect(me.user.id, path)
      return backupInfo(info, id)
    }
  }
}

/** Calls only the website has: the desktop's file windows become uploads. */
export interface WebExtras {
  uploadImportFile(kind: 'items' | 'parties', file: UploadedFile): Promise<unknown>
  uploadBackupFile(file: UploadedFile): Promise<BackupInfo>
}

/** Website calls that work without an open business. */
export const NO_BUSINESS = new Set([
  'getAppInfo', 'listBusinesses', 'currentBusiness', 'authStatus', 'login', 'logout', 'setupOwner', 'recoverOwner', 'createBusiness',
  'openBusiness', 'closeBusiness', 'changeMyPassword', 'uploadBackupFile', 'inspectBackup', 'importBackup', 'listUsers'
])
