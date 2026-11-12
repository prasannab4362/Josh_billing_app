import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { DEFAULT_PREFERENCES } from '@shared/models'
import { NUMBERED_TYPES } from '@shared/docTypes'
import { openDatabase, type DB } from '../db/connection'
import { getBusiness, setupBusiness, updateBusiness } from './business'
import { ensureSeriesForFy, listSeries, previewNumber, updateSeries } from './numberSeries'
import { DEFAULT_TAX_RATES, DEFAULT_UNITS } from './seed'
import { getPreferences, savePreferences } from './settings'
import { createTaxRate, listTaxRates, setTaxRateActive } from './taxRates'
import { createUnit, deleteUnit, listUnits } from './units'

const profile = { ...EMPTY_TEST_PROFILE, name: 'Sharma Traders', stateCode: '27', gstin: '27AAPFU0939F1ZV' }
const TODAY = '2025-07-15'
const FY = '2025-26'
let db: DB

beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => db.close())

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('setupBusiness', () => {
  it('creates the business and seeds every default', () => {
    const b = setupBusiness(db, 'b1', { profile, preferences: { pricesIncludeTax: true } }, TODAY)
    expect(b.name).toBe('Sharma Traders')
    expect(b.pan).toBe('AAPFU0939F')
    expect(count('unit')).toBe(DEFAULT_UNITS.length)
    expect(count('tax_rate')).toBe(DEFAULT_TAX_RATES.length)
    expect(count('bank_account')).toBe(1)
    expect(listSeries(db, FY)).toHaveLength(NUMBERED_TYPES.length)
    expect(getPreferences(db)).toEqual({ ...DEFAULT_PREFERENCES, pricesIncludeTax: true })
  })

  it('applies the chosen invoice prefix and adds a bank account', () => {
    setupBusiness(
      db,
      'b1',
      {
        profile,
        preferences: {},
        invoicePrefix: 'ST-',
        bankAccount: { kind: 'bank', name: 'SBI current', bankName: 'SBI', accountNo: '1234567890', ifsc: 'sbin0001234', upiId: '', openingBalance: 500000 }
      },
      TODAY
    )
    const invoice = listSeries(db, FY).find((s) => s.docType === 'SALE_INVOICE')!
    expect(previewNumber(invoice)).toBe('ST-1')
    const bank = db.prepare(`SELECT ifsc, opening_balance FROM bank_account WHERE kind = 'bank'`).get()
    expect(bank).toEqual({ ifsc: 'SBIN0001234', opening_balance: 500000 })
  })

  it('writes nothing when the profile is invalid', () => {
    expect(() => setupBusiness(db, 'b1', { profile: { ...profile, name: '' }, preferences: {} }, TODAY)).toThrow(/name is required/)
    expect(count('business')).toBe(0)
    expect(count('unit')).toBe(0)
  })

  it('refuses to set up the same file twice', () => {
    setupBusiness(db, 'b1', { profile, preferences: {} }, TODAY)
    expect(() => setupBusiness(db, 'b2', { profile, preferences: {} }, TODAY)).toThrow(/already has a business/)
  })
})

describe('business profile', () => {
  it('updates and validates', () => {
    setupBusiness(db, 'b1', { profile, preferences: {} }, TODAY)
    const updated = updateBusiness(db, { ...profile, name: 'Sharma & Sons', city: 'Pune' })
    expect(updated.name).toBe('Sharma & Sons')
    expect(getBusiness(db).city).toBe('Pune')
    expect(() => updateBusiness(db, { ...profile, stateCode: '29' })).toThrow(/does not match/)
  })
})

describe('preferences', () => {
  it('merges partial saves with defaults', () => {
    setupBusiness(db, 'b1', { profile, preferences: {} }, TODAY)
    const p = savePreferences(db, { paperSize: 'thermal80', defaultDueDays: 30 })
    expect(p).toEqual({ ...DEFAULT_PREFERENCES, paperSize: 'thermal80', defaultDueDays: 30 })
    expect(() => savePreferences(db, { defaultDueDays: 999 })).toThrow()
  })
})

describe('number series', () => {
  beforeEach(() => {
    setupBusiness(db, 'b1', { profile, preferences: {} }, TODAY)
  })

  it('creates default prefixes per financial year', () => {
    const inv = listSeries(db, FY).find((s) => s.docType === 'SALE_INVOICE')!
    expect(previewNumber(inv)).toBe('INV/25-26/1')
    ensureSeriesForFy(db, '2026-27')
    expect(previewNumber(listSeries(db, '2026-27').find((s) => s.docType === 'SALE_INVOICE')!)).toBe('INV/26-27/1')
    ensureSeriesForFy(db, '2026-27') // no duplicates
    expect(listSeries(db, '2026-27')).toHaveLength(NUMBERED_TYPES.length)
  })

  it('updates prefix, start and padding', () => {
    const inv = listSeries(db, FY).find((s) => s.docType === 'SALE_INVOICE')!
    const saved = updateSeries(db, inv.id, { prefix: 'A-', nextNumber: 101, padding: 4 })
    expect(previewNumber(saved)).toBe('A-0101')
  })

  it('will not reissue a number already used', () => {
    const inv = listSeries(db, FY).find((s) => s.docType === 'SALE_INVOICE')!
    db.prepare(
      `INSERT INTO document (id, doc_type, number, date, created_at, updated_at) VALUES ('d1','SALE_INVOICE','INV/25-26/1','2025-07-15','x','x')`
    ).run()
    expect(() => updateSeries(db, inv.id, { prefix: inv.prefix, nextNumber: 1, padding: 0 })).toThrow(/already used/)
  })

  it('rejects invalid input', () => {
    const inv = listSeries(db, FY).find((s) => s.docType === 'SALE_INVOICE')!
    expect(() => updateSeries(db, inv.id, { prefix: 'IN V', nextNumber: 1, padding: 0 })).toThrow()
  })
})

describe('tax rates', () => {
  beforeEach(() => {
    setupBusiness(db, 'b1', { profile, preferences: {} }, TODAY)
  })

  it('lists GST rates first in ascending order', () => {
    const rates = listTaxRates(db)
    expect(rates[0].name).toBe('GST 0%')
    expect(rates.filter((r) => r.kind === 'gst').map((r) => r.rateBp)).toEqual([0, 25, 300, 500, 1200, 1800, 2800, 4000])
  })

  it('adds a rate with cess and blocks duplicates', () => {
    const r = createTaxRate(db, { name: 'GST 28% + Cess 12%', kind: 'gst', rateBp: 2800, cessBp: 1200 })
    expect(r.cessBp).toBe(1200)
    expect(() => createTaxRate(db, { name: 'again', kind: 'gst', rateBp: 1800, cessBp: 0 })).toThrow(/already exists/)
  })

  it('hides and shows rates', () => {
    const r = listTaxRates(db)[0]
    expect(setTaxRateActive(db, r.id, false).isActive).toBe(false)
    expect(setTaxRateActive(db, r.id, true).isActive).toBe(true)
  })
})

describe('units', () => {
  beforeEach(() => {
    setupBusiness(db, 'b1', { profile, preferences: {} }, TODAY)
  })

  it('adds a unit and refuses duplicates', () => {
    const u = createUnit(db, 'Carton', 'CTN')
    expect(u.short).toBe('ctn')
    expect(() => createUnit(db, 'Carton 2', 'ctn')).toThrow(/already exists/)
  })

  it('deletes unused units only', () => {
    const pcs = listUnits(db).find((u) => u.short === 'pcs')!
    db.prepare(
      `INSERT INTO item (id, name, kind, base_unit_id, created_at, updated_at) VALUES ('i1','Pen','goods',?,'x','x')`
    ).run(pcs.id)
    expect(listUnits(db).find((u) => u.id === pcs.id)!.inUse).toBe(true)
    expect(() => deleteUnit(db, pcs.id)).toThrow(/cannot be deleted/)

    const box = listUnits(db).find((u) => u.short === 'box')!
    deleteUnit(db, box.id)
    expect(listUnits(db).some((u) => u.short === 'box')).toBe(false)
  })
})
