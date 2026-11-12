// The business's print settings, and a sample invoice to preview them on.
import { invoiceHtml } from '@shared/invoiceHtml'
import type { Invoice, PaperSize } from '@shared/models'
import { completePrintSettings, printSettingsError, type PrintSettings } from '@shared/printSettings'
import { completeItemFields, type ItemFieldSettings } from '@shared/itemFields'
import { completeFeatures, type FeatureSettings } from '@shared/features'
import type { DB } from '../db/connection'
import { nowIso, UserError } from '../util'
import { printAccount } from './accounts'
import { getBusiness } from './business'
import { getPreferences } from './settings'

const KEY = 'print.design'
const FIELDS_KEY = 'item.fields'
const FEATURES_KEY = 'features'

export function getFeatures(db: DB): FeatureSettings {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(FEATURES_KEY) as { value: string } | undefined
  return completeFeatures(row ? JSON.parse(row.value) : null)
}

export function saveFeatures(db: DB, s: FeatureSettings): FeatureSettings {
  const full = completeFeatures(s)
  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(FEATURES_KEY, JSON.stringify(full), nowIso())
  return full
}

export function getItemFields(db: DB): ItemFieldSettings {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(FIELDS_KEY) as { value: string } | undefined
  return completeItemFields(row ? JSON.parse(row.value) : null)
}

export function saveItemFields(db: DB, s: ItemFieldSettings): ItemFieldSettings {
  const full = completeItemFields(s)
  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(FIELDS_KEY, JSON.stringify(full), nowIso())
  return full
}

export function getPrintSettings(db: DB): PrintSettings {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(KEY) as { value: string } | undefined
  return completePrintSettings(row ? JSON.parse(row.value) : null)
}

export function savePrintSettings(db: DB, s: PrintSettings): PrintSettings {
  const full = completePrintSettings(s)
  const err = printSettingsError({ ...full, footer: String(s.footer ?? ''), defaultTerms: String(s.defaultTerms ?? '') })
  if (err) throw new UserError(err)
  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(KEY, JSON.stringify(full), nowIso())
  return full
}

/** A made-up invoice from this business, to show what the settings look like. */
export function sampleInvoice(stateCode: string, terms: string): Invoice {
  const line = (n: number, name: string, desc: string, hsn: string, qty: number, rate: number, discBp: number, taxBp: number, taxable: number, cgst: number, sgst: number) => ({
    id: `s${n}`, itemId: `i${n}`, description: '', itemName: name, itemDescription: desc, hsnSac: hsn, qty, unitId: null, unitFactor: 1000,
    unitShort: 'pcs', itemCustomFields: null, rate, discountPctBp: discBp, discountAmount: 0, taxRateId: null, taxRateBp: taxBp, cessBp: 0,
    taxable, cgst, sgst, igst: 0, cess: 0, total: taxable + cgst + sgst
  })
  return {
    id: 'sample', type: 'SALE_INVOICE', number: 'INV-0042', date: '2026-11-12', dueDate: '2026-11-27', partyId: 'p', partyName: 'Ravi Traders',
    grandTotal: 225_500, paidAmount: 100_000, balanceDue: 125_500, status: 'partial',
    party: { name: 'Ravi Traders', phone: '9876543210', gstin: '', stateCode, billingAddress: '12, Main Road\nMadurai 625001', shippingAddress: 'Shop 4, Market Street, Madurai' },
    placeOfSupply: stateCode, supplyType: 'intra', pricesIncludeTax: false,
    lines: [
      line(1, 'Cotton T-shirt (M)', 'Round neck, 100% cotton', '6109', 2000, 45_000, 0, 500, 90_000, 2_250, 2_250),
      { ...line(2, 'Denim Jeans', '', '6203', 1000, 129_900, 1000, 1200, 116_910, 7_015, 7_014), details: { batch: 'B-2611', size: '32', mfg: '2026-10-01' } }
    ],
    charges: [], subtotal: 219_900, discountTotal: 12_990, taxableTotal: 206_910, cgst: 9_265, sgst: 9_264, igst: 0, cess: 0,
    roundOff: 61, notes: 'Thank you for your order.', terms, links: [], extra: { vehicleNo: 'TN 58 AB 1234', ewayBillNo: '351002345678', poNumber: 'PO-77', poDate: '2026-11-10' }, createdAt: nowIso(), updatedAt: nowIso()
  } as unknown as Invoice
}

export function samplePrintHtml(db: DB, design: PrintSettings, paper: PaperSize): string {
  const b = getBusiness(db)
  const prefs = getPreferences(db)
  return invoiceHtml({
    type: 'SALE_INVOICE',
    invoice: sampleInvoice(b.stateCode, design.defaultTerms || '1. Goods once sold will not be taken back.\n2. Payment due in 15 days.'),
    business: b,
    bank: printAccount(db),
    paper,
    gstRegistered: prefs.gstRegistered,
    design,
    itemFields: getItemFields(db),
    features: getFeatures(db)
  })
}
