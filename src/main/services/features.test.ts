import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { billExtraError, completeFeatures, customFieldLines, DEFAULT_FEATURES } from '@shared/features'
import { invoiceHtml } from '@shared/invoiceHtml'
import type { InvoiceInput, PartyInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { getBusiness, setupBusiness } from './business'
import { getBill, saveBill } from './invoices'
import { createItem, getItem, updateItem } from './items'
import { createParty, getParty, updateParty } from './parties'
import { getFeatures, saveFeatures } from './printDesign'
import { bulkUpdateItems } from './imports'
import { listUnits } from './units'

let db: DB
beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '33' }, preferences: {} }, '2026-04-01')
})
afterEach(() => db.close())

const partyInput: PartyInput = {
  name: 'Ravi', kind: 'customer', phone: '', email: '', gstin: '', stateCode: '33', billingAddress: '', shippingAddress: '',
  openingBalance: 0, openingDate: '', creditLimit: null, paymentTermDays: null, group: ''
}
const newItem = (customFields: string[] | null = null) =>
  createItem(db, {
    name: 'Phone', code: '', kind: 'goods', category: '', hsnSac: '8517', taxRateId: null, priceIncludesTax: true, salePrice: 1_000_000,
    purchasePrice: 800_000, mrp: null, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: listUnits(db).find((u) => u.short === 'pcs')!.id,
    altUnitId: null, altConversion: null, trackStock: false, openingQty: 0, openingRate: 0, openingDate: '', lowStockQty: null, customFields
  })
const bill = (partyId: string, itemId: string, extra: InvoiceInput['extra']): InvoiceInput => ({
  partyId, walkInName: '', number: '', date: '2026-11-12', dueDate: '', placeOfSupply: '33', pricesIncludeTax: true,
  lines: [{ itemId, description: '', qty: 1000, unitId: null, unitFactor: 1000, rate: 1_000_000, discountPctBp: 0, discountAmount: 0, taxRateId: null, hsnSac: '' }],
  charges: [], received: null, notes: '', terms: '', extra
})

describe('feature settings', () => {
  it('are saved, and fields without a name stay off', () => {
    expect(getFeatures(db)).toEqual(DEFAULT_FEATURES)
    const s = saveFeatures(db, { ...DEFAULT_FEATURES, transport: true, partyFields: [{ on: true, label: ' Aadhaar ', print: false }, { on: true, label: '', print: true }] })
    expect(s.transport).toBe(true)
    expect(s.partyFields.slice(0, 2)).toEqual([{ on: true, label: 'Aadhaar', print: false }, { on: false, label: '', print: true }])
    expect(s.partyFields).toHaveLength(4)
    expect(completeFeatures(null).itemFields).toHaveLength(4)
  })

  it('keep own field values on parties and items, through edits and bulk updates', () => {
    const p = createParty(db, { ...partyInput, customFields: ['1234 5678 9012', '', 'North', ''] })
    expect(getParty(db, p.id).customFields).toEqual(['1234 5678 9012', '', 'North', ''])
    updateParty(db, p.id, { ...partyInput, name: 'Ravi K' }) // values left out are kept
    expect(getParty(db, p.id).customFields?.[0]).toBe('1234 5678 9012')
    updateParty(db, p.id, { ...partyInput, customFields: null })
    expect(getParty(db, p.id).customFields).toBeNull()
    expect(() => createParty(db, { ...partyInput, name: 'X', customFields: ['x'.repeat(101)] })).toThrow(/at most 100/)
    const it = newItem(['Black', 'Acme'])
    bulkUpdateItems(db, [{ id: it.id, salePrice: 900_000 }])
    expect(getItem(db, it.id).customFields).toEqual(['Black', 'Acme'])
    updateItem(db, it.id, { ...getItem(db, it.id), customFields: ['Blue'] })
    expect(getItem(db, it.id).customFields).toEqual(['Blue'])
  })

  it('save transport and PO details on bills, checked, and print them with the own fields', () => {
    expect(billExtraError({ ewayBillNo: '1234' })).toMatch(/12 digits/)
    expect(billExtraError({ poDate: 'yesterday' })).toMatch(/PO date must be a date/)
    const p = createParty(db, { ...partyInput, customFields: ['1234 5678 9012', 'Hidden'] })
    const it = newItem(['Black'])
    saveFeatures(db, {
      ...DEFAULT_FEATURES, showTime: true, transport: true,
      partyFields: [{ on: true, label: 'Aadhaar', print: true }, { on: true, label: 'Note', print: false }, ...DEFAULT_FEATURES.partyFields.slice(2)],
      itemFields: [{ on: true, label: 'Colour', print: true }, ...DEFAULT_FEATURES.itemFields.slice(1)]
    })
    expect(() => saveBill(db, 'SALE_INVOICE', null, bill(p.id, it.id, { ewayBillNo: '12' }))).toThrow(/12 digits/)
    const inv = saveBill(db, 'SALE_INVOICE', null, bill(p.id, it.id, { vehicleNo: 'tn 58 ab 1234', ewayBillNo: '3510 0234 5678', poNumber: 'PO-77', poDate: '2026-11-10', transportName: '' }))
    const full = getBill(db, 'SALE_INVOICE', inv.id)
    expect(full.extra).toEqual({ vehicleNo: 'TN 58 AB 1234', ewayBillNo: '351002345678', poNumber: 'PO-77', poDate: '2026-11-10' })
    const f = getFeatures(db)
    expect(customFieldLines(f.partyFields, ['1234 5678 9012', 'Hidden'], true)).toEqual(['Aadhaar: 1234 5678 9012'])
    const html = invoiceHtml({
      type: 'SALE_INVOICE', invoice: full, business: getBusiness(db), bank: null, paper: 'A4', gstRegistered: true, features: f,
      partyCustomFields: getParty(db, p.id).customFields
    })
    expect(html).toContain('<td class="muted">Vehicle no.</td><td>TN 58 AB 1234</td>')
    expect(html).toContain('<td class="muted">E-way bill no.</td><td>351002345678</td>')
    expect(html).toContain('<td class="muted">PO date</td><td>10-11-2026</td>')
    expect(html).toContain('Aadhaar: 1234 5678 9012')
    expect(html).not.toContain('Hidden')
    expect(html).toContain('<div class="small details">Colour: Black</div>')
    expect(html).toMatch(/<td>12-11-2026 \d{2}:\d{2} [AP]M<\/td>/)
    const noTime = invoiceHtml({ type: 'SALE_INVOICE', invoice: full, business: getBusiness(db), bank: null, paper: 'A4', gstRegistered: true })
    expect(noTime).toContain('<td>12-11-2026</td>')
  })
})
