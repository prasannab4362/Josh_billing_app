import { describe, expect, it } from 'vitest'
import { gstinCheckChar, gstinPan, gstinProblem, isValidGstin } from './gstin'
import { fyFor, fyRange, fyShort } from './fy'
import { formatDocNumber } from './docTypes'
import { formatPercent, percentToBp } from './money'
import { EMPTY_TEST_PROFILE } from './testFixtures'
import { normalizeBusiness, validateBankAccount, validateBusiness, validateSeries, validateTaxRate } from './validation'

const withCheck = (first14: string) => first14 + gstinCheckChar(first14)

describe('GSTIN', () => {
  it('accepts a published sample GSTIN', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true)
  })
  it('accepts a GSTIN with a correct check character', () => {
    expect(isValidGstin(withCheck('29ABCDE1234F1Z'))).toBe(true)
  })
  it('detects a wrong check character', () => {
    const good = withCheck('29ABCDE1234F1Z')
    const bad = good.slice(0, 14) + (good[14] === 'A' ? 'B' : 'A')
    expect(gstinProblem(bad)).toBe('checksum')
  })
  it('detects bad format and unknown states', () => {
    expect(gstinProblem('12345')).toBe('format')
    expect(gstinProblem(withCheck('99ABCDE1234F1Z'))).toBe('state')
  })
  it('ignores case and spaces, and extracts the PAN', () => {
    expect(isValidGstin(' 27aapfu0939f1zv ')).toBe(true)
    expect(gstinPan('27AAPFU0939F1ZV')).toBe('AAPFU0939F')
  })
})

describe('financial year', () => {
  it('uses April–March by default', () => {
    expect(fyFor('2025-04-01')).toBe('2025-26')
    expect(fyFor('2026-03-31')).toBe('2025-26')
    expect(fyFor('2026-04-01')).toBe('2026-27')
    expect(fyFor('2099-12-31')).toBe('2099-00')
  })
  it('supports calendar-year businesses', () => {
    expect(fyFor('2025-06-15', 1)).toBe('2025')
  })
  it('formats short labels and ranges', () => {
    expect(fyShort('2025-26')).toBe('25-26')
    expect(fyRange('2025-26')).toEqual({ from: '2025-04-01', to: '2026-03-31' })
    expect(fyRange('2024-25')).toEqual({ from: '2024-04-01', to: '2025-03-31' })
  })
})

describe('numbers and percents', () => {
  it('formats document numbers with padding', () => {
    expect(formatDocNumber('INV/25-26/', 7, 0)).toBe('INV/25-26/7')
    expect(formatDocNumber('INV-', 7, 4)).toBe('INV-0007')
    expect(formatDocNumber('', 12345, 3)).toBe('12345')
  })
  it('converts percents to basis points and back', () => {
    expect(percentToBp('18')).toBe(1800)
    expect(percentToBp('0.25%')).toBe(25)
    expect(formatPercent(1800)).toBe('18%')
    expect(formatPercent(25)).toBe('0.25%')
    expect(formatPercent(1250)).toBe('12.5%')
  })
})

describe('business validation', () => {
  const base = { ...EMPTY_TEST_PROFILE, name: 'Sharma Traders', stateCode: '27' }

  it('accepts a minimal profile', () => {
    expect(validateBusiness(base)).toEqual({})
  })
  it('requires name and state', () => {
    const e = validateBusiness({ ...base, name: ' ', stateCode: '' })
    expect(e.name).toBeDefined()
    expect(e.stateCode).toBeDefined()
  })
  it('rejects a GSTIN from a different state', () => {
    expect(validateBusiness({ ...base, stateCode: '29', gstin: '27AAPFU0939F1ZV' }).gstin).toMatch(/does not match/)
  })
  it('checks phone, pincode and email', () => {
    const e = validateBusiness({ ...base, phone: '12345', pincode: '0123', email: 'x@' })
    expect(Object.keys(e).sort()).toEqual(['email', 'phone', 'pincode'])
    expect(validateBusiness({ ...base, phone: '+91 98765-43210' })).toEqual({})
  })
  it('normalises GSTIN, PAN and phone', () => {
    const n = normalizeBusiness({ ...base, gstin: '27aapfu0939f1zv', phone: '+91 98765 43210' })
    expect(n.gstin).toBe('27AAPFU0939F1ZV')
    expect(n.pan).toBe('AAPFU0939F')
    expect(n.phone).toBe('9876543210')
  })
})

describe('other validation', () => {
  it('validates bank accounts', () => {
    const ok = { kind: 'bank' as const, name: 'SBI', bankName: '', accountNo: '12345678', ifsc: 'SBIN0001234', upiId: 'shop@oksbi', openingBalance: 0 }
    expect(validateBankAccount(ok)).toEqual({})
    expect(Object.keys(validateBankAccount({ ...ok, ifsc: 'BAD', upiId: 'nope', accountNo: '12' })).sort()).toEqual([
      'accountNo', 'ifsc', 'upiId'
    ])
  })
  it('validates number series', () => {
    expect(validateSeries({ prefix: 'INV/25-26/', nextNumber: 1, padding: 0 })).toEqual({})
    expect(Object.keys(validateSeries({ prefix: 'IN V', nextNumber: 0, padding: 9 })).sort()).toEqual([
      'nextNumber', 'padding', 'prefix'
    ])
  })
  it('validates tax rates', () => {
    expect(validateTaxRate({ name: 'GST 18%', kind: 'gst', rateBp: 1800, cessBp: 0 })).toEqual({})
    expect(validateTaxRate({ name: 'Exempt', kind: 'exempt', rateBp: 500, cessBp: 0 }).rateBp).toBeDefined()
  })
})
