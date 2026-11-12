import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gstinCheckChar } from '@shared/gstin'
import { gstr1Json } from '@shared/gstr1Json'
import type { InvoiceInput, InvoiceLineInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { setupBusiness } from './business'
import { saveExpense } from './expenses'
import { gstr1, gstr3b, setOffTax } from './gstReturns'
import { saveBill } from './invoices'
import { createItem } from './items'
import { createParty } from './parties'
import { CASH_ACCOUNT_ID } from './seed'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

// July 2025 for a Maharashtra (27) shop:
//  INV1 Mehta (registered, 27)   10 kg rice × ₹100 @5%            → B2B intra
//  INV2 Karna (registered, 29)   consulting ₹2,000 @18%            → B2B inter
//  INV3 Ravi (unregistered, 27)  5 kg rice ₹500 + 2 L milk ₹100 nil → B2CS + nil
//  INV4 Delhi buyer (unreg., 07) 1,100 kg rice ₹1,10,000           → B2CL (over ₹1 lakh)
//  INV5 Delhi buyer               10 kg rice ₹1,000                → B2CS inter
//  CN1  Mehta returns 2 kg (₹200)                                   → CDNR
//  CN2  Ravi returns 1 kg (₹100)                                    → reduces B2CS
//  Purchase 100 kg × ₹80 @5%, debit note 10 kg, electricity ₹1,000 @18% → ITC
const MEHTA_GSTIN = '27AAPFU0939F1ZV'
const KARNA_GSTIN = '29AAPFU0939F1Z' + gstinCheckChar('29AAPFU0939F1Z')
const OUR_GSTIN = '27AAACR5055K1Z' + gstinCheckChar('27AAACR5055K1Z')
const JULY = { from: '2025-07-01', to: '2025-07-31' }
let db: DB
let ids: Record<string, string>

const line = (itemId: string, qty: number, rate: number, taxRateId: string): InvoiceLineInput => ({
  itemId, description: '', qty, unitId: null, unitFactor: 1000, rate, discountPctBp: 0, discountAmount: 0, taxRateId, hsnSac: ''
})
const doc = (partyId: string, lines: InvoiceLineInput[], over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  partyId, walkInName: '', number: '', date: '2025-07-10', dueDate: '', placeOfSupply: '', pricesIncludeTax: false,
  lines, charges: [], received: null, notes: '', terms: '', ...over
})

beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '27', gstin: OUR_GSTIN }, preferences: { roundOff: false } }, '2025-04-01')
  const rate = (name: string) => listTaxRates(db).find((t) => t.name === name)!.id
  const unit = (short: string) => listUnits(db).find((u) => u.short === short)!.id
  const gst5 = rate('GST 5%')
  const gst18 = rate('GST 18%')
  const nilRate = rate('Nil rated')
  const p = { phone: '', email: '', billingAddress: '', shippingAddress: '', openingBalance: 0, openingDate: '', creditLimit: null, paymentTermDays: null, group: '' }
  const party = (name: string, stateCode: string, gstin: string, kind: 'customer' | 'supplier' = 'customer') => createParty(db, { ...p, name, kind, stateCode, gstin }).id
  const item = (name: string, kind: 'goods' | 'service', hsnSac: string, taxRateId: string, baseUnitId: string | null, openingQty: number) =>
    createItem(db, {
      name, code: '', kind, category: '', hsnSac, taxRateId, priceIncludesTax: false, salePrice: 10_000, purchasePrice: 8000, mrp: null,
      wholesalePrice: null, wholesaleMinQty: null, baseUnitId, altUnitId: null, altConversion: null, trackStock: kind === 'goods',
      openingQty, openingRate: 8000, openingDate: '2025-04-01', lowStockQty: null
    }).id
  ids = {
    gst5, gst18, nilRate,
    mehta: party('Mehta', '27', MEHTA_GSTIN),
    karna: party('Karna', '29', KARNA_GSTIN),
    ravi: party('Ravi', '27', ''),
    delhi: party('Delhi Buyer', '07', ''),
    mill: party('Local Mill', '27', MEHTA_GSTIN, 'supplier'),
    rice: item('Rice', 'goods', '1006', gst5, unit('kg'), 2_000_000),
    consult: item('Consulting', 'service', '998311', gst18, null, 0),
    milk: item('Milk', 'goods', '0401', nilRate, unit('ltr'), 100_000)
  }
  const { rice, consult, milk } = ids
  saveBill(db, 'SALE_INVOICE', null, doc(ids.mehta, [line(rice, 10_000, 10_000, gst5)]))
  saveBill(db, 'SALE_INVOICE', null, doc(ids.karna, [line(consult, 1000, 200_000, gst18)]))
  saveBill(db, 'SALE_INVOICE', null, doc(ids.ravi, [line(rice, 5000, 10_000, gst5), line(milk, 2000, 5000, nilRate)]))
  saveBill(db, 'SALE_INVOICE', null, doc(ids.delhi, [line(rice, 1_100_000, 10_000, gst5)]))
  saveBill(db, 'SALE_INVOICE', null, doc(ids.delhi, [line(rice, 10_000, 10_000, gst5)], { date: '2025-07-20' }))
  saveBill(db, 'SALE_RETURN', null, doc(ids.mehta, [line(rice, 2000, 10_000, gst5)], { date: '2025-07-25' }))
  saveBill(db, 'SALE_RETURN', null, doc(ids.ravi, [line(rice, 1000, 10_000, gst5)], { date: '2025-07-26' }))
  saveBill(db, 'PURCHASE_BILL', null, doc(ids.mill, [line(rice, 100_000, 8000, gst5)], { number: 'LM-1', date: '2025-07-05' }))
  saveBill(db, 'PURCHASE_RETURN', null, doc(ids.mill, [line(rice, 10_000, 8000, gst5)], { date: '2025-07-06' }))
  saveExpense(db, null, { date: '2025-07-31', category: 'Electricity', amount: 100_000, taxRateId: gst18, accountId: CASH_ACCOUNT_ID, paidTo: '', reference: '', notes: '' })
  // Outside the period: must not count.
  saveBill(db, 'SALE_INVOICE', null, doc(ids.mehta, [line(rice, 1000, 10_000, gst5)], { date: '2025-08-01' }))
})
afterEach(() => db.close())

describe('GSTR-1', () => {
  it('puts each sale in its table', () => {
    const g = gstr1(db, JULY)
    expect(g).toMatchObject({ period: '072025', gstin: OUR_GSTIN })
    expect(g.b2b.map((d) => [d.number, d.gstin, d.supply])).toEqual([
      ['INV/25-26/1', MEHTA_GSTIN, 'intra'],
      ['INV/25-26/2', KARNA_GSTIN, 'inter']
    ])
    expect(g.b2b[0].rates).toEqual([{ rateBp: 500, taxable: 100_000, igst: 0, cgst: 2500, sgst: 2500, cess: 0 }])
    expect(g.b2b[1].rates).toEqual([{ rateBp: 1800, taxable: 200_000, igst: 36_000, cgst: 0, sgst: 0, cess: 0 }])
    expect(g.b2cl.map((d) => [d.number, d.pos, d.value])).toEqual([['INV/25-26/4', '07', 11_550_000]])
    expect(g.b2cs).toEqual([
      { supply: 'inter', pos: '07', rateBp: 500, taxable: 100_000, igst: 5000, cgst: 0, sgst: 0, cess: 0 },
      { supply: 'intra', pos: '27', rateBp: 500, taxable: 40_000, igst: 0, cgst: 1000, sgst: 1000, cess: 0 }
    ])
    expect(g.cdnr.map((d) => [d.number, d.gstin, d.rates[0].taxable])).toEqual([['CN/25-26/1', MEHTA_GSTIN, 20_000]])
    expect(g.cdnur).toEqual([])
    expect(g.nil).toEqual([{ description: 'Intra-state to unregistered persons', supply: 'INTRAB2C', nil: 10_000, exempt: 0, nonGst: 0 }])
    expect(g.totals.taxable).toBe(100_000 + 200_000 + 50_000 + 11_000_000 + 100_000 - 20_000 - 10_000)
  })

  it('summarises by HSN (B2B and B2C apart) and lists the document series', () => {
    const g = gstr1(db, JULY)
    expect(g.hsn.map((h) => [h.b2b, h.hsn, h.uqc, h.qty, h.rateBp, h.taxable])).toEqual([
      [true, '1006', 'KGS', 8000, 500, 80_000],
      [true, '998311', 'NA', 0, 1800, 200_000],
      [false, '0401', 'LTR', 2000, 0, 10_000],
      [false, '1006', 'KGS', 1_114_000, 500, 11_140_000]
    ])
    expect(g.docs).toEqual([
      { nature: 'Invoices for outward supply', docNum: 1, from: 'INV/25-26/1', to: 'INV/25-26/5', total: 5, cancelled: 0 },
      { nature: 'Credit notes', docNum: 5, from: 'CN/25-26/1', to: 'CN/25-26/2', total: 2, cancelled: 0 }
    ])
    expect(g.warnings).toEqual([])
  })

  it('exports JSON in the offline-tool layout', () => {
    const j = gstr1Json(gstr1(db, JULY)) as Record<string, any>
    expect(j).toMatchObject({ gstin: OUR_GSTIN, fp: '072025' })
    expect(j.b2b[0]).toEqual({
      ctin: MEHTA_GSTIN,
      inv: [{ inum: 'INV/25-26/1', idt: '10-07-2025', val: 1050, pos: '27', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 5, txval: 1000, camt: 25, samt: 25, csamt: 0 } }] }]
    })
    expect(j.b2b[1].inv[0].itms[0].itm_det).toEqual({ rt: 18, txval: 2000, iamt: 360, csamt: 0 })
    expect(j.b2cl[0]).toMatchObject({ pos: '07', inv: [{ inum: 'INV/25-26/4', val: 115_500 }] })
    expect(j.b2cs).toContainEqual({ sply_ty: 'INTRA', pos: '27', typ: 'OE', rt: 5, txval: 400, camt: 10, samt: 10, csamt: 0 })
    expect(j.cdnr[0].nt[0]).toMatchObject({ ntty: 'C', nt_num: 'CN/25-26/1', nt_dt: '25-07-2025', val: 210 })
    expect(j.nil.inv).toEqual([{ sply_ty: 'INTRAB2C', expt_amt: 0, nil_amt: 100, ngsup_amt: 0 }])
    expect(j.hsn.hsn_b2b[0]).toMatchObject({ hsn_sc: '1006', uqc: 'KGS', qty: 8, rt: 5, txval: 800 })
    expect(j.doc_issue.doc_det.map((d: any) => d.doc_num)).toEqual([1, 5])
    expect(j.cdnur).toBeUndefined()
  })

  it('warns about missing HSN codes and doubtful customer GSTINs', () => {
    db.prepare(`UPDATE party SET gstin = '27AAPFU0939F1ZX' WHERE id = ?`).run(ids.mehta)
    saveBill(db, 'SALE_INVOICE', null, doc(ids.mehta, [{ ...line(ids.rice, 1000, 10_000, ids.gst5), itemId: null, description: 'Loose rice' }], { date: '2025-07-28' }))
    const w = gstr1(db, JULY).warnings
    expect(w.some((x) => /INV\/25-26\/7: customer GSTIN .* does not look valid/.test(x))).toBe(true)
    expect(w).toContain('1 line has no HSN/SAC code. Add it to the items and the bills.')
  })
})

describe('GSTR-3B', () => {
  it('nets returns, lists inter-state sales to unregistered buyers and takes ITC', () => {
    const g = gstr3b(db, JULY)
    expect(g.outwardTaxable).toEqual({ taxable: 11_420_000, igst: 591_000, cgst: 3000, sgst: 3000, cess: 0 })
    expect(g.outwardNilExempt).toBe(10_000)
    expect(g.interStateUnregistered).toEqual([{ pos: '07', taxable: 11_100_000, igst: 555_000 }])
    // Purchase 20,000 + electricity 9,000 − debit note 2,000 (paise of CGST; SGST the same).
    expect(g.itc).toEqual({ igst: 0, cgst: 27_000, sgst: 27_000, cess: 0 })
  })

  it('uses CGST and SGST credit on their own head first, then on IGST; the rest is cash', () => {
    const g = gstr3b(db, JULY)
    const igst = g.setOff.find((r) => r.head === 'igst')!
    expect(igst).toEqual({ head: 'igst', liability: 591_000, fromIgst: 0, fromCgst: 24_000, fromSgst: 24_000, fromCess: 0, cash: 543_000 })
    expect(g.setOff.find((r) => r.head === 'cgst')).toMatchObject({ fromCgst: 3000, cash: 0 })
    expect(g.cashPayable).toBe(543_000)
    expect(g.creditCarriedForward).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 })
  })
})

describe('tax set-off order', () => {
  it('spends IGST credit first, and never CGST credit on SGST', () => {
    const r = setOffTax({ igst: 100, cgst: 50, sgst: 50, cess: 0 }, { igst: 180, cgst: 0, sgst: 30, cess: 0 })
    expect(r.rows.map((x) => [x.head, x.fromIgst, x.fromSgst, x.cash])).toEqual([
      ['igst', 100, 0, 0], ['cgst', 50, 0, 0], ['sgst', 30, 20, 0], ['cess', 0, 0, 0]
    ])
    expect(r.left).toEqual({ igst: 0, cgst: 0, sgst: 10, cess: 0 })
    const c = setOffTax({ igst: 0, cgst: 0, sgst: 100, cess: 0 }, { igst: 0, cgst: 500, sgst: 0, cess: 0 })
    expect(c).toMatchObject({ cash: 100, left: { cgst: 500 } })
  })
})
