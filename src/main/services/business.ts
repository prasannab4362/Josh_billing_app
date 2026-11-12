import type { Business, BusinessProfile, CreateBusinessInput } from '@shared/models'
import { hasErrors, normalizeBusiness, validateBankAccount, validateBusiness } from '@shared/validation'
import { fyFor, todayLocal } from '@shared/fy'
import type { DB } from '../db/connection'
import { nowIso, UserError, uuid } from '../util'
import { CASH_ACCOUNT_ID, DEFAULT_TAX_RATES, DEFAULT_UNITS } from './seed'
import { savePreferences } from './settings'
import { bankAccount as bankAccountKey, setOpeningBalance } from './ledger'
import { ensureSeriesForFy, setSeriesPrefix } from './numberSeries'
import { checkImage } from './items'

interface BusinessRow {
  id: string
  name: string
  legal_name: string | null
  gstin: string | null
  pan: string | null
  state_code: string
  address: string | null
  city: string | null
  pincode: string | null
  phone: string | null
  email: string | null
  business_type: string | null
  category: string | null
  fy_start_month: number
  logo_path: string | null
  signature_path: string | null
  created_at: string
  updated_at: string
}

function fromRow(r: BusinessRow): Business {
  return {
    id: r.id,
    name: r.name,
    legalName: r.legal_name ?? '',
    gstin: r.gstin ?? '',
    pan: r.pan ?? '',
    stateCode: r.state_code,
    address: r.address ?? '',
    city: r.city ?? '',
    pincode: r.pincode ?? '',
    phone: r.phone ?? '',
    email: r.email ?? '',
    businessType: r.business_type ?? '',
    category: r.category ?? '',
    fyStartMonth: r.fy_start_month,
    // Only data URLs count; older files never stored images here.
    logo: r.logo_path?.startsWith('data:') ? r.logo_path : '',
    signature: r.signature_path?.startsWith('data:') ? r.signature_path : '',
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function checkProfile(profile: BusinessProfile): BusinessProfile {
  const clean = normalizeBusiness(profile)
  const errors = validateBusiness(clean)
  if (hasErrors(errors)) throw new UserError(Object.values(errors)[0]!)
  return clean
}

const orNull = (s: string): string | null => (s === '' ? null : s)

/** Fill a brand-new database: business row plus all defaults, in one transaction. */
export function setupBusiness(db: DB, id: string, input: CreateBusinessInput, today = todayLocal()): Business {
  const p = checkProfile(input.profile)
  if (input.bankAccount) {
    const errors = validateBankAccount(input.bankAccount)
    if (hasErrors(errors)) throw new UserError(Object.values(errors)[0]!)
  }
  const existing = db.prepare('SELECT COUNT(*) AS n FROM business').get() as { n: number }
  if (existing.n > 0) throw new Error('This database already has a business')

  const now = nowIso()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO business (id, name, legal_name, gstin, pan, state_code, address, city, pincode, phone, email,
                             business_type, category, fy_start_month, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, p.name, orNull(p.legalName), orNull(p.gstin), orNull(p.pan), p.stateCode, orNull(p.address), orNull(p.city),
      orNull(p.pincode), orNull(p.phone), orNull(p.email), orNull(p.businessType), orNull(p.category), p.fyStartMonth,
      now, now
    )

    const unit = db.prepare('INSERT INTO unit (id, name, short) VALUES (?,?,?)')
    for (const u of DEFAULT_UNITS) unit.run(uuid(), u.name, u.short)

    const tax = db.prepare('INSERT INTO tax_rate (id, name, kind, rate_bp, cess_bp, created_at) VALUES (?,?,?,?,0,?)')
    for (const t of DEFAULT_TAX_RATES) tax.run(uuid(), t.name, t.kind, t.rateBp, now)

    db.prepare(
      `INSERT INTO bank_account (id, kind, name, opening_balance, opening_date, created_at, updated_at)
       VALUES (?, 'cash', 'Cash in hand', 0, ?, ?, ?)`
    ).run(CASH_ACCOUNT_ID, today, now, now)

    if (input.bankAccount) {
      const b = input.bankAccount
      const bankId = uuid()
      db.prepare(
        `INSERT INTO bank_account (id, kind, name, bank_name, account_no, ifsc, upi_id, opening_balance, opening_date,
                                   is_default_for_print, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`
      ).run(
        bankId, b.kind, b.name.trim(), orNull(b.bankName.trim()), orNull(b.accountNo.trim()),
        orNull(b.ifsc.trim().toUpperCase()), orNull(b.upiId.trim()), b.openingBalance, today, now, now
      )
      setOpeningBalance(db, bankAccountKey(bankId), bankId, b.openingBalance, today)
    }

    savePreferences(db, input.preferences)

    const fy = fyFor(today, p.fyStartMonth)
    ensureSeriesForFy(db, fy)
    if (input.invoicePrefix !== undefined) setSeriesPrefix(db, 'SALE_INVOICE', fy, input.invoicePrefix)
  })()

  return getBusiness(db)
}

export function getBusiness(db: DB): Business {
  const row = db.prepare('SELECT * FROM business LIMIT 1').get() as BusinessRow | undefined
  if (!row) throw new Error('Business details are missing from this file')
  return fromRow(row)
}

/** Set or clear (null) the logo or signature printed on bills. */
export function setBusinessImage(db: DB, kind: 'logo' | 'signature', dataUrl: string | null): Business {
  if (dataUrl !== null) checkImage(dataUrl, kind === 'logo' ? 'Logo' : 'Signature')
  const column = kind === 'logo' ? 'logo_path' : 'signature_path'
  db.prepare(`UPDATE business SET ${column} = ?, updated_at = ?`).run(dataUrl, nowIso())
  return getBusiness(db)
}

export function updateBusiness(db: DB, profile: BusinessProfile): Business {
  const p = checkProfile(profile)
  const current = getBusiness(db)
  db.prepare(
    `UPDATE business SET name=?, legal_name=?, gstin=?, pan=?, state_code=?, address=?, city=?, pincode=?, phone=?,
            email=?, business_type=?, category=?, fy_start_month=?, updated_at=? WHERE id=?`
  ).run(
    p.name, orNull(p.legalName), orNull(p.gstin), orNull(p.pan), p.stateCode, orNull(p.address), orNull(p.city),
    orNull(p.pincode), orNull(p.phone), orNull(p.email), orNull(p.businessType), orNull(p.category), p.fyStartMonth,
    nowIso(), current.id
  )
  return getBusiness(db)
}
