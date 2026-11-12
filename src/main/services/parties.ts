import { cleanCustomValues } from '@shared/features'
import type { Party, PartyInput, PartyKind } from '@shared/models'
import { hasErrors, normalizeParty, validateParty } from '@shared/validation'
import type { DB } from '../db/connection'
import { nowIso, toBool, UserError, uuid } from '../util'
import { audit } from './audit'
import { partyAccount, setOpeningBalance, unpost } from './ledger'

interface PartyRow {
  id: string
  name: string
  kind: PartyKind
  phone: string | null
  email: string | null
  gstin: string | null
  state_code: string | null
  billing_address: string | null
  shipping_address: string | null
  opening_balance: number
  opening_date: string | null
  credit_limit: number | null
  payment_term_days: number | null
  group_name: string | null
  is_active: number
  created_at: string
  updated_at: string
  balance: number
  has_txn: number
  extra: string | null
}

const SELECT = `
  SELECT p.*, g.name AS group_name,
         COALESCE((SELECT SUM(debit - credit) FROM ledger_entry WHERE account = 'party:' || p.id), 0) AS balance,
         (EXISTS (SELECT 1 FROM document d WHERE d.party_id = p.id AND d.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM payment y WHERE y.party_id = p.id AND y.deleted_at IS NULL)) AS has_txn
  FROM party p LEFT JOIN party_group g ON g.id = p.group_id
  WHERE p.deleted_at IS NULL`

function fromRow(r: PartyRow): Party {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    phone: r.phone ?? '',
    email: r.email ?? '',
    gstin: r.gstin ?? '',
    stateCode: r.state_code ?? '',
    billingAddress: r.billing_address ?? '',
    shippingAddress: r.shipping_address ?? '',
    openingBalance: r.opening_balance,
    openingDate: r.opening_date ?? '',
    creditLimit: r.credit_limit,
    paymentTermDays: r.payment_term_days,
    group: r.group_name ?? '',
    customFields: r.extra ? (JSON.parse(r.extra) as string[]) : null,
    balance: r.balance,
    hasTransactions: r.has_txn === 1,
    isActive: toBool(r.is_active),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

const orNull = (s: string): string | null => (s === '' ? null : s)

/** Store a record's own field values (party or item); null clears them. */
export function writeCustom(db: DB, table: 'party' | 'item', id: string, values: string[] | null | undefined): void {
  if (values === undefined) return
  let clean: string[] | null
  try {
    clean = cleanCustomValues(values)
  } catch (e) {
    throw new UserError((e as Error).message)
  }
  db.prepare(`UPDATE ${table} SET extra = ? WHERE id = ?`).run(clean ? JSON.stringify(clean) : null, id)
}

function check(db: DB, input: PartyInput, selfId: string | null): PartyInput {
  const p = normalizeParty(input)
  const errors = validateParty(p)
  if (hasErrors(errors)) throw new UserError(Object.values(errors)[0]!)
  const dup = db
    .prepare('SELECT id FROM party WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id IS NOT ?')
    .get(p.name, selfId) as { id: string } | undefined
  if (dup) throw new UserError(`A party named "${p.name}" already exists`)
  return p
}

function groupId(db: DB, name: string): string | null {
  if (!name) return null
  const row = db.prepare('SELECT id FROM party_group WHERE name = ? COLLATE NOCASE').get(name) as { id: string } | undefined
  if (row) return row.id
  const id = uuid()
  db.prepare('INSERT INTO party_group (id, name) VALUES (?,?)').run(id, name)
  return id
}

export function listParties(db: DB): Party[] {
  return (db.prepare(`${SELECT} ORDER BY p.name COLLATE NOCASE`).all() as PartyRow[]).map(fromRow)
}

export function getParty(db: DB, id: string): Party {
  const row = db.prepare(`${SELECT} AND p.id = ?`).get(id) as PartyRow | undefined
  if (!row) throw new UserError('Party not found')
  return fromRow(row)
}

export function listPartyGroups(db: DB): string[] {
  return (db.prepare('SELECT name FROM party_group ORDER BY name COLLATE NOCASE').all() as { name: string }[]).map((r) => r.name)
}

export function createParty(db: DB, input: PartyInput): Party {
  const p = check(db, input, null)
  const id = uuid()
  const now = nowIso()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO party (id, name, kind, phone, email, gstin, state_code, billing_address, shipping_address,
                          opening_balance, opening_date, credit_limit, payment_term_days, group_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, p.name, p.kind, orNull(p.phone), orNull(p.email), orNull(p.gstin), orNull(p.stateCode),
      orNull(p.billingAddress), orNull(p.shippingAddress), p.openingBalance, orNull(p.openingDate),
      p.creditLimit, p.paymentTermDays, groupId(db, p.group), now, now
    )
    setOpeningBalance(db, partyAccount(id), id, p.openingBalance, p.openingDate)
    writeCustom(db, 'party', id, p.customFields)
    audit(db, 'party', id, 'create', null, p)
  })()
  return getParty(db, id)
}

export function updateParty(db: DB, id: string, input: PartyInput): Party {
  const before = getParty(db, id)
  const p = check(db, input, id)
  db.transaction(() => {
    db.prepare(
      `UPDATE party SET name=?, kind=?, phone=?, email=?, gstin=?, state_code=?, billing_address=?, shipping_address=?,
              opening_balance=?, opening_date=?, credit_limit=?, payment_term_days=?, group_id=?, updated_at=?
       WHERE id=?`
    ).run(
      p.name, p.kind, orNull(p.phone), orNull(p.email), orNull(p.gstin), orNull(p.stateCode),
      orNull(p.billingAddress), orNull(p.shippingAddress), p.openingBalance, orNull(p.openingDate),
      p.creditLimit, p.paymentTermDays, groupId(db, p.group), nowIso(), id
    )
    setOpeningBalance(db, partyAccount(id), id, p.openingBalance, p.openingDate)
    if (p.customFields !== undefined) writeCustom(db, 'party', id, p.customFields)
    audit(db, 'party', id, 'update', before, p)
  })()
  return getParty(db, id)
}

export function setPartyActive(db: DB, id: string, active: boolean): Party {
  getParty(db, id)
  db.prepare('UPDATE party SET is_active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowIso(), id)
  return getParty(db, id)
}

/**
 * Soft-delete a party that has no invoices or payments. Its opening balance is taken out of the
 * ledger; the row keeps the amount so a later restore can post it again.
 */
export function deleteParty(db: DB, id: string): void {
  const before = getParty(db, id)
  if (before.hasTransactions) {
    throw new UserError('This party has invoices or payments. Mark it inactive instead of deleting it.')
  }
  db.transaction(() => {
    db.prepare('UPDATE party SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id)
    unpost(db, 'opening', id)
    audit(db, 'party', id, 'delete', before, null)
  })()
}
