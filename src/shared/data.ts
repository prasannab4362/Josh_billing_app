// Backups, the recycle bin and the change history.
import type { BillType } from './billTypes'

export interface BackupFile {
  path: string
  name: string
  /** 'auto' = daily copy, 'safety' = taken just before a restore, 'manual' = saved by the user elsewhere. */
  kind: 'auto' | 'safety' | 'manual'
  size: number
  modifiedAt: string
}

/** What a backup file holds, read before restoring it. */
export interface BackupInfo {
  path: string
  businessName: string
  /** Same business as the one open now. */
  sameBusiness: boolean
  schemaVersion: number
  invoices: number
  parties: number
  lastEntry: string
  modifiedAt: string
}

export type BinKind = 'bill' | 'expense' | 'payment' | 'party' | 'item' | 'transfer' | 'adjustment'

export interface BinEntry {
  kind: BinKind
  id: string
  billType: BillType | null
  /** What it was, e.g. "Sale invoice", "Payment received", "Party". */
  what: string
  /** Its number or name. */
  title: string
  detail: string
  amount: number | null
  date: string
  deletedAt: string
}

export interface AuditEntry {
  id: string
  at: string
  entity: string
  entityId: string
  action: 'create' | 'update' | 'delete' | 'restore'
  /** e.g. "Sale invoice INV/26-27/4", "Party Mehta Electronics". */
  label: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export interface AuditFilter {
  from?: string
  to?: string
  entity?: string
  search?: string
  entityId?: string
}

export const AUDIT_ENTITIES: { key: string; label: string }[] = [
  { key: 'document', label: 'Bills' },
  { key: 'payment', label: 'Payments' },
  { key: 'expense', label: 'Expenses' },
  { key: 'party', label: 'Parties' },
  { key: 'item', label: 'Items' },
  { key: 'stock_adjustment', label: 'Stock adjustments' },
  { key: 'bank_account', label: 'Cash & bank accounts' },
  { key: 'account_transfer', label: 'Transfers' }
]
