import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invoiceHtml } from '@shared/invoiceHtml'
import { completePrintSettings, DEFAULT_PRINT_SETTINGS, upiPayLink, type PrintSettings } from '@shared/printSettings'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import type { Business, MoneyAccount } from '@shared/models'
import { openDatabase, type DB } from '../db/connection'
import { setupBusiness, getBusiness, setBusinessImage } from './business'
import { getPrintSettings, sampleInvoice, samplePrintHtml, savePrintSettings } from './printDesign'

let db: DB
beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Kumar Stores', stateCode: '33', phone: '9000012345', email: 'k@example.com' }, preferences: {} }, '2026-04-01')
})
afterEach(() => db.close())

const bank: MoneyAccount = { id: 'b', kind: 'bank', name: 'SBI', bankName: 'State Bank of India', accountNo: '1234567890', ifsc: 'SBIN0001234', upiId: 'kumar@sbi', isDefaultForPrint: true }
const html = (design: Partial<PrintSettings>, paper: 'A4' | 'thermal80' = 'A4', b: MoneyAccount | null = bank) =>
  invoiceHtml({ type: 'SALE_INVOICE', invoice: sampleInvoice('33', 'Goods once sold will not be taken back.'), business: getBusiness(db) as Business, bank: b, paper, gstRegistered: true, design })
const withShow = (k: keyof PrintSettings['show'], v: boolean) => ({ show: { ...DEFAULT_PRINT_SETTINGS.show, [k]: v } })

describe('print settings', () => {
  it('are saved per business, with missing parts filled from the defaults', () => {
    expect(getPrintSettings(db)).toEqual(DEFAULT_PRINT_SETTINGS)
    const s = savePrintSettings(db, { ...DEFAULT_PRINT_SETTINGS, theme: 'boxed', colour: '#1d4ed8', footer: 'Thank you!' })
    expect(getPrintSettings(db)).toMatchObject({ theme: 'boxed', colour: '#1d4ed8', footer: 'Thank you!' })
    expect(s.show.upiQr).toBe(true)
    expect(completePrintSettings({ theme: 'nope' as never, show: { logo: false } as never })).toMatchObject({ theme: 'classic', show: { logo: false, signature: true } })
    expect(() => savePrintSettings(db, { ...DEFAULT_PRINT_SETTINGS, footer: 'x'.repeat(201) })).toThrow(/Footer/)
  })

  it('draw each layout with the chosen colour and text size', () => {
    for (const theme of ['classic', 'boxed', 'modern', 'compact'] as const) {
      const h = html({ theme, colour: '#047857', textSize: 'large' })
      expect(h).toContain(`<body class="theme-${theme}">`)
      expect(h).toContain('--accent: #047857')
      expect(h).toContain('font-size: 13.5px')
    }
    expect(html({ theme: 'compact' })).toContain('margin: 8mm')
    const r = html({ thermalTheme: 'itemised' }, 'thermal80')
    expect(r).toContain('thermal th-itemised')
    expect(r).toContain('2 pcs × 450.00')
    expect(r).toContain('HSN 6109 · GST 5%')
  })

  it('leave off what is switched off', () => {
    const full = html({})
    for (const text of ['k@example.com', 'Amount in words', 'Tax summary', 'Bank details', 'Scan to pay', 'Authorised signatory', 'HSN/SAC 6109', 'Round neck', '<th>#</th>', '<th class="r hide-thermal">Disc.</th>', '<th class="r hide-thermal">GST</th>', 'Ship to', 'Terms &amp; conditions', 'Balance']) {
      expect(full, text).toContain(text)
    }
    const off: [keyof PrintSettings['show'], string][] = [
      ['businessEmail', 'k@example.com'], ['amountInWords', 'Amount in words'], ['taxSummary', 'Tax summary'], ['bankDetails', 'Bank details'],
      ['upiQr', 'Scan to pay'], ['signature', 'Authorised signatory'], ['hsn', 'HSN/SAC 6109'], ['itemDescription', 'Round neck'],
      ['serialNo', '<th>#</th>'], ['discountColumn', 'Disc.</th>'], ['taxColumn', 'hide-thermal">GST</th>'], ['shipTo', 'Ship to'], ['terms', 'Terms &amp; conditions'],
      ['receivedBalance', '<strong>Balance</strong>'], ['businessPhone', 'Phone: 9000012345'], ['partyPhone', 'Phone: 9876543210']
    ]
    for (const [k, text] of off) expect(html(withShow(k, false)), k).not.toContain(text)
    expect(html({ footer: 'Thank you for shopping!' })).toContain('<div class="footer">Thank you for shopping!</div>')
  })

  it("print the logo on every paper, and the signature on invoices (on small bills only when chosen)", () => {
    const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const SIGN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    setBusinessImage(db, 'logo', LOGO)
    setBusinessImage(db, 'signature', SIGN)
    const a4 = html({})
    expect(a4).toContain(`<img class="logo" src="${LOGO}"`)
    // On A4 the signature shows (hide-thermal only hides it on thermal paper).
    expect(a4).toContain(`<div>For Kumar Stores</div><img src="${SIGN}"`)
    expect(a4).toContain('<body class="theme-classic">')
    const bill = html({}, 'thermal80')
    expect(bill).toContain(`<img class="logo" src="${LOGO}"`)
    expect(bill).toContain('<div class="sign hide-thermal">') // left off small bills by default
    const signed = html({ show: { ...DEFAULT_PRINT_SETTINGS.show, signatureOnBill: true } }, 'thermal80')
    expect(signed).toContain(`<div class="sign"><div>For Kumar Stores</div><img src="${SIGN}"`)
    expect(html(withShow('logo', false))).not.toContain('class="logo"')
    expect(getPrintSettings(db).show.signatureOnBill).toBe(false)
  })

  it('print a UPI QR code for the balance due, only when there is a UPI ID and something due', () => {
    const link = upiPayLink('kumar@sbi', 'Kumar Stores', 125_500, 'Invoice INV-0042')
    expect(link).toBe('upi://pay?pa=kumar%40sbi&pn=Kumar%20Stores&am=1255.00&cu=INR&tn=Invoice%20INV-0042')
    expect(html({})).toContain('Scan to pay ₹1,255.00')
    expect(html({}, 'A4', { ...bank, upiId: '' })).not.toContain('Scan to pay')
    expect(html({}, 'thermal80')).toContain('Scan to pay')
    expect(samplePrintHtml(db, { ...DEFAULT_PRINT_SETTINGS, theme: 'modern' }, 'A5')).toContain('@page { size: A5')
  })
})
