import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invoiceHtml } from '@shared/invoiceHtml'
import { completeItemFields, detailDate, detailsText, DEFAULT_ITEM_FIELDS, lineDetailsError } from '@shared/itemFields'
import type { InvoiceInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { getBusiness, setupBusiness } from './business'
import { deleteBill, getBill, saveBill } from './invoices'
import { createItem } from './items'
import { getItemFields, saveItemFields } from './printDesign'
import { listBin, restoreFromBin } from './recycleBin'
import { listUnits } from './units'

let db: DB
let itemId: string
beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Medicals', stateCode: '33' }, preferences: {} }, '2026-04-01')
  itemId = createItem(db, {
    name: 'Paracetamol 500', code: '', kind: 'goods', category: '', hsnSac: '3004', taxRateId: null, priceIncludesTax: true, salePrice: 3_000,
    purchasePrice: 2_000, mrp: null, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: listUnits(db).find((u) => u.short === 'pcs')!.id,
    altUnitId: null, altConversion: null, trackStock: true, openingQty: 100_000, openingRate: 2_000, openingDate: '2026-04-01', lowStockQty: null
  }).id
})
afterEach(() => db.close())

const bill = (details: InvoiceInput['lines'][number]['details']): InvoiceInput => ({
  partyId: null, walkInName: '', number: '', date: '2026-11-12', dueDate: '', placeOfSupply: '', pricesIncludeTax: true,
  lines: [{ itemId, description: '', qty: 2000, unitId: null, unitFactor: 1000, rate: 3_000, discountPctBp: 0, discountAmount: 0, taxRateId: null, hsnSac: '', details }],
  charges: [], received: { amount: 6_000, accountId: 'cash', mode: 'cash', reference: '' }, notes: '', terms: ''
})

describe('item details on bill lines', () => {
  it('are saved on the line, blanks dropped, and come back with the bill', () => {
    const inv = saveBill(db, 'SALE_INVOICE', null, bill({ batch: ' B12 ', mfg: '2026-10-05', exp: '2027-09', model: '', serial: undefined }))
    expect(getBill(db, 'SALE_INVOICE', inv.id).lines[0].details).toEqual({ batch: 'B12', mfg: '2026-10-05', exp: '2027-09' })
    const plain = saveBill(db, 'SALE_INVOICE', null, bill(null))
    expect(getBill(db, 'SALE_INVOICE', plain.id).lines[0].details).toBeNull()
  })

  it('refuse bad dates, long text, unknown keys and expiry before manufacture', () => {
    expect(() => saveBill(db, 'SALE_INVOICE', null, bill({ exp: 'next year' }))).toThrow(/Line 1: Exp. date must be a date/)
    expect(() => saveBill(db, 'SALE_INVOICE', null, bill({ batch: 'x'.repeat(41) }))).toThrow(/at most 40/)
    expect(() => saveBill(db, 'SALE_INVOICE', null, bill({ colour: 'red' } as never))).toThrow(/Unknown item detail/)
    expect(lineDetailsError({ mfg: '2026-11-01', exp: '2026-10' })).toMatch(/before the manufacturing/)
  })

  it('survive deleting and restoring the bill', () => {
    const inv = saveBill(db, 'SALE_INVOICE', null, bill({ serial: 'IMEI 3569' }))
    deleteBill(db, 'SALE_INVOICE', inv.id)
    const entry = listBin(db).find((e) => e.id === inv.id)!
    restoreFromBin(db, entry.kind, entry.id)
    expect(getBill(db, 'SALE_INVOICE', inv.id).lines[0].details).toEqual({ serial: 'IMEI 3569' })
  })

  it('print under the item name, with the business’s names and date formats', () => {
    const fields = saveItemFields(db, completeItemFields({ fields: { ...DEFAULT_ITEM_FIELDS.fields, batch: { on: true, label: 'Lot' } }, expFormat: 'mm/yyyy', mfgFormat: 'dd/mm/yyyy' }))
    expect(getItemFields(db).fields.batch).toEqual({ on: true, label: 'Lot' })
    expect(detailsText({ batch: 'B12', exp: '2027-09-30', mfg: '2026-10-05', size: 'M' }, fields)).toBe('Lot: B12 · Mfg. date: 05/10/2026 · Exp. date: 09/2027 · Size: M')
    expect(detailDate('2027-09', 'dd/mm/yyyy')).toBe('09/2027')
    const inv = saveBill(db, 'SALE_INVOICE', null, bill({ batch: 'B12', exp: '2027-09' }))
    const html = invoiceHtml({ type: 'SALE_INVOICE', invoice: getBill(db, 'SALE_INVOICE', inv.id), business: getBusiness(db), bank: null, paper: 'A4', gstRegistered: true, itemFields: fields })
    expect(html).toContain('<div class="small details">Lot: B12 · Exp. date: 09/2027</div>')
    const off = invoiceHtml({ type: 'SALE_INVOICE', invoice: getBill(db, 'SALE_INVOICE', inv.id), business: getBusiness(db), bank: null, paper: 'thermal58', gstRegistered: true, itemFields: fields, design: { show: { itemDetails: false } as never } })
    expect(off).not.toContain('Lot: B12')
  })
})
