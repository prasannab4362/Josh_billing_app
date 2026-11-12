import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ItemInput, PartyInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { setupBusiness } from './business'
import { createItem, deleteItem, getItem, listItemCategories, listItems, updateItem } from './items'
import { accountBalance, OPENING_EQUITY, partyAccount } from './ledger'
import { createParty, deleteParty, getParty, listParties, listPartyGroups, setPartyActive, updateParty } from './parties'
import { addMovement, listMovements, rebuildAllStock, rebuildItemStock } from './stock'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

let db: DB
const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n

beforeEach(() => {
  db = openDatabase(':memory:')
  setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '27' }, preferences: {} }, '2025-07-01')
})
afterEach(() => db.close())

const party = (over: Partial<PartyInput> = {}): PartyInput => ({
  name: 'Ravi Kumar',
  kind: 'customer',
  phone: '',
  email: '',
  gstin: '',
  stateCode: '',
  billingAddress: '',
  shippingAddress: '',
  openingBalance: 0,
  openingDate: '',
  creditLimit: null,
  paymentTermDays: null,
  group: '',
  ...over
})

describe('parties', () => {
  it('creates a party and fills the state from its GSTIN', () => {
    const p = createParty(db, party({ gstin: '27aapfu0939f1zv', phone: '+91 98765-43210' }))
    expect(p.stateCode).toBe('27')
    expect(p.gstin).toBe('27AAPFU0939F1ZV')
    expect(p.phone).toBe('9876543210')
    expect(p.balance).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM audit_log WHERE entity = ?', 'party')).toBe(1)
  })

  it('posts a receivable opening balance as a balanced ledger entry', () => {
    const p = createParty(db, party({ openingBalance: 150000, openingDate: '2025-04-01' }))
    expect(p.balance).toBe(150000)
    expect(accountBalance(db, partyAccount(p.id))).toBe(150000)
    expect(accountBalance(db, OPENING_EQUITY)).toBe(-150000)
  })

  it('posts a payable balance as a credit and replaces it on edit', () => {
    const p = createParty(db, party({ kind: 'supplier', openingBalance: -50000, openingDate: '2025-04-01' }))
    expect(getParty(db, p.id).balance).toBe(-50000)
    const edited = updateParty(db, p.id, party({ kind: 'supplier', openingBalance: 20000, openingDate: '2025-04-01' }))
    expect(edited.balance).toBe(20000)
    expect(count('SELECT COUNT(*) AS n FROM ledger_entry WHERE source_id = ?', p.id)).toBe(2)
    updateParty(db, p.id, party({ kind: 'supplier' }))
    expect(count('SELECT COUNT(*) AS n FROM ledger_entry WHERE source_id = ?', p.id)).toBe(0)
  })

  it('needs a date when there is an opening balance', () => {
    expect(() => createParty(db, party({ openingBalance: 100 }))).toThrow(/date/)
  })

  it('rejects bad input and duplicate names', () => {
    expect(() => createParty(db, party({ name: ' ' }))).toThrow(/required/)
    expect(() => createParty(db, party({ gstin: '27AAPFU0939F1ZX' }))).toThrow(/check digit/)
    expect(() => createParty(db, party({ gstin: '27AAPFU0939F1ZV', stateCode: '29' }))).toThrow(/does not match/)
    expect(() => createParty(db, party({ paymentTermDays: 400 }))).toThrow(/365/)
    createParty(db, party())
    expect(() => createParty(db, party({ name: 'ravi kumar' }))).toThrow(/already exists/)
  })

  it('creates groups on the fly', () => {
    createParty(db, party({ group: 'Wholesale' }))
    createParty(db, party({ name: 'B', group: 'wholesale' }))
    expect(listPartyGroups(db)).toEqual(['Wholesale'])
  })

  it('soft-deletes an unused party and removes its opening entry', () => {
    const p = createParty(db, party({ openingBalance: 1000, openingDate: '2025-04-01' }))
    deleteParty(db, p.id)
    expect(listParties(db)).toEqual([])
    expect(accountBalance(db, OPENING_EQUITY)).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM party WHERE deleted_at IS NOT NULL')).toBe(1)
    // the name can be used again
    createParty(db, party())
  })

  it('refuses to delete a party with invoices but allows deactivating', () => {
    const p = createParty(db, party())
    db.prepare(
      `INSERT INTO document (id, doc_type, number, date, party_id, created_at, updated_at)
       VALUES ('d1','SALE_INVOICE','INV/1','2025-07-01',?,'x','x')`
    ).run(p.id)
    expect(getParty(db, p.id).hasTransactions).toBe(true)
    expect(() => deleteParty(db, p.id)).toThrow(/inactive/)
    expect(setPartyActive(db, p.id, false).isActive).toBe(false)
  })
})

describe('items', () => {
  let pcs: string
  let box: string
  let gst18: string

  beforeEach(() => {
    const units = listUnits(db)
    pcs = units.find((u) => u.short === 'pcs')!.id
    box = units.find((u) => u.short === 'box')!.id
    gst18 = listTaxRates(db).find((t) => t.name === 'GST 18%')!.id
  })

  const item = (over: Partial<ItemInput> = {}): ItemInput => ({
    name: 'Blue Pen',
    code: '',
    kind: 'goods',
    category: '',
    hsnSac: '9608',
    taxRateId: gst18,
    priceIncludesTax: false,
    salePrice: 1000,
    purchasePrice: 700,
    mrp: null,
    wholesalePrice: null,
    wholesaleMinQty: null,
    baseUnitId: pcs,
    altUnitId: null,
    altConversion: null,
    trackStock: true,
    openingQty: 0,
    openingRate: 0,
    openingDate: '',
    lowStockQty: null,
    ...over
  })

  it('creates an item with opening stock as a stock movement', () => {
    const i = createItem(db, item({ openingQty: 100_000, openingRate: 700, openingDate: '2025-04-01', category: 'Stationery' }))
    expect(i.stockQty).toBe(100_000)
    expect(i.stockValue).toBe(70_000) // 100 pcs × ₹7
    expect(i.baseUnitShort).toBe('pcs')
    expect(i.taxRateName).toBe('GST 18%')
    expect(listItemCategories(db)).toEqual(['Stationery'])
    expect(listMovements(db, i.id)).toMatchObject([{ qtyChange: 100_000, sourceType: 'opening', runningQty: 100_000 }])
  })

  it('replaces opening stock on edit', () => {
    const i = createItem(db, item({ openingQty: 10_000, openingRate: 700, openingDate: '2025-04-01' }))
    const e = updateItem(db, i.id, item({ openingQty: 25_500, openingRate: 800, openingDate: '2025-04-01' }))
    expect(e.stockQty).toBe(25_500)
    expect(e.stockValue).toBe(20_400)
    expect(listMovements(db, i.id)).toHaveLength(1)
  })

  it('stores services without stock', () => {
    const s = createItem(db, item({ name: 'Repair', kind: 'service', hsnSac: '998719', openingQty: 5000, openingDate: '2025-04-01' }))
    expect(s.trackStock).toBe(false)
    expect(s.openingQty).toBe(0)
    expect(listMovements(db, s.id)).toEqual([])
  })

  it('validates units, HSN, prices and duplicates', () => {
    expect(() => createItem(db, item({ hsnSac: '12' }))).toThrow(/HSN/)
    expect(() => createItem(db, item({ salePrice: -1 }))).toThrow(/price/)
    expect(() => createItem(db, item({ altUnitId: pcs }))).toThrow(/differ/)
    expect(() => createItem(db, item({ altUnitId: box }))).toThrow(/main units make/)
    expect(() => createItem(db, item({ openingQty: 1000 }))).toThrow(/date/)
    expect(() => createItem(db, item({ wholesalePrice: 900 }))).toThrow(/Minimum/)
    const ok = createItem(db, item({ code: 'P1', altUnitId: box, altConversion: 12_000 }))
    expect(ok.altConversion).toBe(12_000)
    expect(() => createItem(db, item({ name: 'blue pen' }))).toThrow(/already exists/)
    expect(() => createItem(db, item({ name: 'Red Pen', code: 'p1' }))).toThrow(/already used/)
  })

  it('average cost value follows purchases and sales', () => {
    const i = createItem(db, item({ openingQty: 10_000, openingRate: 600, openingDate: '2025-04-01' }))
    addMovement(db, i.id, '2025-05-01', 10_000, 800, 'adjustment', 'adj1') // avg ₹7
    addMovement(db, i.id, '2025-05-02', -5_000, 0, 'adjustment', 'adj2')
    rebuildItemStock(db, i.id)
    expect(getItem(db, i.id)).toMatchObject({ stockQty: 15_000, stockValue: 10_500, hasTransactions: true })
    db.prepare('DELETE FROM item_stock').run()
    rebuildAllStock(db)
    expect(getItem(db, i.id).stockQty).toBe(15_000)
  })

  it('protects items that have been used', () => {
    const i = createItem(db, item({ openingQty: 10_000, openingRate: 600, openingDate: '2025-04-01' }))
    addMovement(db, i.id, '2025-05-01', -1000, 0, 'adjustment', 'adj1')
    expect(() => updateItem(db, i.id, item({ trackStock: false }))).toThrow(/cannot be turned off/)
    expect(() => updateItem(db, i.id, item({ baseUnitId: box }))).toThrow(/main unit/)
    expect(() => deleteItem(db, i.id)).toThrow(/inactive/)
  })

  it('soft-deletes an unused item and frees its name and unit', () => {
    const i = createItem(db, item({ openingQty: 10_000, openingRate: 600, openingDate: '2025-04-01' }))
    deleteItem(db, i.id)
    expect(listItems(db)).toEqual([])
    expect(count('SELECT COUNT(*) AS n FROM stock_movement')).toBe(0)
    createItem(db, item())
  })
})
