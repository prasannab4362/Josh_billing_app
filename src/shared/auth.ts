// Owner and staff logins: who may do what. Shared so the screens hide what the main process would refuse;
// the main process is what actually enforces it (see registerIpc in main/ipc.ts).
import type { BillType } from './billTypes'

export type Role = 'owner' | 'staff'
export const ROLES: Record<Role, string> = { owner: 'Owner', staff: 'Staff (billing)' }

export interface AuthUser {
  id: string
  name: string
  username: string
  role: Role
}

export interface UserSummary extends AuthUser {
  isActive: boolean
  lastLoginAt: string
  createdAt: string
}

export interface AuthStatus {
  /** The open business, or null when none is open. Only its id and name, so nothing leaks before sign-in. */
  business: { id: string; name: string } | null
  /** The business has logins switched on. */
  required: boolean
  /** Who is signed in (null when no one is, or logins are off). */
  user: AuthUser | null
  /** Lock after this many minutes without use (0 = never). */
  idleMinutes: number
}

export interface NewUserInput {
  name: string
  username: string
  password: string
  role: Role
}

export interface UserUpdate {
  name: string
  role: Role
  isActive: boolean
  /** A new password for this user, or '' to keep theirs. */
  password: string
}

/** Calls that need no sign-in: choosing, opening or creating a business, and signing in. */
export const PUBLIC_METHODS = [
  'getAppInfo', 'listBusinesses', 'createBusiness', 'openBusiness', 'closeBusiness', 'chooseBackupFile', 'importBackup',
  'authStatus', 'login', 'logout', 'recoverOwner', 'setupOwner'
] as const

/** What staff may call once signed in; everything else is for the owner only. */
export const STAFF_METHODS = [
  'currentBusiness', 'getPreferences', 'listSeries', 'listTaxRates', 'listUnits', 'listParties', 'getParty', 'listPartyGroups',
  'createParty', 'updateParty', 'listItems', 'getItem', 'createItem', 'updateItem', 'listItemCategories', 'listStockMovements',
  'getItemImage', 'generateBarcode', 'assignBarcodes', 'previewLabels', 'printLabels', 'saveLabelsPdf', 'listLabelSizes',
  'getLabelDesign', 'saveLabelDesign', 'getFeatures', 'getItemFields', 'getPrintSettings', 'listAccounts', 'stockSummary',
  'listBills', 'getBill', 'nextBillNumber', 'saveBill', 'getBillPrint', 'exportBillPdf', 'printBill', 'shareBillOnWhatsApp',
  'openWhatsApp', 'listPayments', 'getPayment', 'nextPaymentNumber', 'openDocuments', 'savePayment', 'partyStatement',
  'catalogueItems', 'saveCatalogue', 'savePoster', 'copyPoster', 'changeMyPassword'
] as const

/** Bills staff may make and see: the sale side, without returns (refunds are for the owner). */
export const STAFF_BILL_TYPES: BillType[] = ['SALE_INVOICE', 'ESTIMATE', 'SALE_ORDER', 'DELIVERY_CHALLAN']

/** The app's pages staff see. */
export const STAFF_PAGES = ['Sale', 'Payments', 'Parties', 'Items', 'Grow', 'Settings'] as const

export const MIN_PASSWORD = 8

/** A problem with a new password, or ''. */
export function passwordProblem(password: string, username = ''): string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters`
  if (password.length > 128) return 'Use at most 128 characters'
  if (/^(.)\1+$/.test(password)) return 'Do not use the same character again and again'
  if (/^(?:0123456789|1234567890|12345678|123456789|password|qwertyui)/i.test(password)) return 'That password is too easy to guess'
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'Do not put your username in the password'
  return ''
}

/** Usernames: 3–30 letters, digits, dot, dash or underscore. */
export function usernameProblem(username: string): string {
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username ?? '')) return 'Username: 3 to 30 letters, digits, dot, dash or underscore'
  return ''
}
