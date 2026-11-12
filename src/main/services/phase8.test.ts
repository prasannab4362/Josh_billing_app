import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InvoiceInput, InvoiceLineInput } from '@shared/models'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openDatabase, type DB } from '../db/connection'
import { Session } from '../session'
import { createAccount, createTransfer, deleteTransfer } from './accounts'
import { listAudit } from './auditLog'
import { setupBusiness } from './business'
import { deleteExpense, saveExpense } from './expenses'
import { createAdjustment, deleteAdjustment } from './inventory'
import { deleteBill, getBill, saveBill } from './invoices'
import { createItem, deleteItem, getItem, listItems } from './items'
import { accountBalance, bankAccount } from './ledger'
import { createParty, deleteParty, getParty, listParties } from './parties'
import { deletePayment, getPayment, savePayment } from './payments'
import { listBin, restoreFromBin } from './recycleBin'
import { CASH_ACCOUNT_ID } from './seed'
import { listTaxRates } from './taxRates'
import { listUnits } from './units'

let db: DB
let ravi: string
let rice: string
let gst5: string
const ledgerTotal = () => (db.prepare('SELECT COALESCE(SUM(debit - credit), 0) AS n FROM ledger_entry').get() as { n: number }).n
const cash = () => accountBalance(db, bankAccount(CASH_ACCOUNT_ID))
const base = {
  phone: '', email: '', gstin: '', billingAddress: '', shippingAddress: '', openingBalance: 0, openingDate: '',
  creditLimit: null, paymentTermDays: null, group: '', stateCode: '27'
}
const itemInput = {
  name: 'Rice', code: 'R1', kind: 'goods' as const, category: '', hsnSac: '1006', taxRateId: '', priceIncludesTax: false,
  salePrice: 10_000, purchasePrice: 8000, mrp: null, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: '',
  altUnitId: null, altConversion: null, trackStock: true, openingQty: 100_000, openingRate: 8000, openingDate: '2025-04-01',
  lowStockQty: null
}
const line = (over: Partial<InvoiceLineInput> = {}): InvoiceLineInput => ({
  itemId: rice, description: '', qty: 10_000, unitId: null, unitFactor: 1000, rate: 10_000, discountPctBp: 0,
  discountAmount: 0, taxRateId: gst5, hsnSac: '', ...over
})
const doc = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  partyId: ravi, walkInName: '', number: '', date: '2025-07-10', dueDate: '', placeOfSupply: '',
  pricesIncludeTax: false, lines: [line()], charges: [], received: null, notes: '', terms: '', ...over
})

describe('recycle bin', () => {
  beforeEach(() => {
    db = openDatabase(':memory:')
    setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '27' }, preferences: { roundOff: false } }, '2025-04-01')
    gst5 = listTaxRates(db).find((t) => t.name === 'GST 5%')!.id
    const kg = listUnits(db).find((u) => u.short === 'kg')!.id
    ravi = createParty(db, { ...base, name: 'Ravi', kind: 'customer' }).id
    rice = createItem(db, { ...itemInput, taxRateId: gst5, baseUnitId: kg }).id
  })
  afterEach(() => db.close())

  it('brings back a deleted invoice with its number, stock, balance and the money taken on it', () => {
    const inv = saveBill(db, 'SALE_INVOICE', null, doc({ received: { amount: 50_000, accountId: CASH_ACCOUNT_ID, mode: 'cash', reference: '' } }))
    deleteBill(db, 'SALE_INVOICE', inv.id)
    expect(getItem(db, rice).stockQty).toBe(100_000)
    expect(cash()).toBe(0)
    const bin = listBin(db)
    expect(bin).toMatchObject([{ kind: 'bill', billType: 'SALE_INVOICE', what: 'Invoice', title: 'INV/25-26/1', detail: 'Ravi', amount: 105_000 }])

    restoreFromBin(db, 'bill', inv.id)
    expect(getBill(db, 'SALE_INVOICE', inv.id)).toMatchObject({ number: 'INV/25-26/1', paidAmount: 50_000, balanceDue: 55_000, received: { number: 'RCPT/25-26/1' } })
    expect(getItem(db, rice).stockQty).toBe(90_000)
    expect(getParty(db, ravi).balance).toBe(55_000)
    expect(cash()).toBe(50_000)
    expect(ledgerTotal()).toBe(0)
    expect(listBin(db)).toEqual([])
    expect(listAudit(db, { entityId: inv.id }).map((a) => a.action)).toContain('restore')
    expect(() => restoreFromBin(db, 'bill', inv.id)).toThrow(/no longer in the recycle bin/)
  })

  it('brings back a payment set against the same bill', () => {
    const inv = saveBill(db, 'SALE_INVOICE', null, doc())
    const p = savePayment(db, null, {
      direction: 'in', partyId: ravi, number: '', date: '2025-07-15', amount: 105_000, accountId: CASH_ACCOUNT_ID, mode: 'upi',
      reference: 'UTR1', notes: '', allocations: [{ documentId: inv.id, amount: 105_000 }]
    })
    deletePayment(db, p.id)
    expect(getBill(db, 'SALE_INVOICE', inv.id).status).not.toBe('paid')
    expect(listBin(db)).toMatchObject([{ kind: 'payment', what: 'Payment received', title: p.number, detail: 'Ravi' }])
    restoreFromBin(db, 'payment', p.id)
    expect(getBill(db, 'SALE_INVOICE', inv.id).status).toBe('paid')
    expect(getPayment(db, p.id)).toMatchObject({ number: p.number, reference: 'UTR1', allocated: 105_000 })
    expect(getParty(db, ravi).balance).toBe(0)
  })

  it('brings back expenses, transfers and stock adjustments', () => {
    const e = saveExpense(db, null, {
      date: '2025-07-31', category: 'Rent', amount: 500_000, taxRateId: null, accountId: CASH_ACCOUNT_ID, paidTo: '', reference: '', notes: ''
    })
    const wallet = createAccount(db, { kind: 'upi_wallet', name: 'PhonePe', bankName: '', accountNo: '', ifsc: '', upiId: '', openingBalance: 0, openingDate: '', isDefaultForPrint: false })
    const t = createTransfer(db, { fromAccountId: CASH_ACCOUNT_ID, toAccountId: wallet.id, amount: 20_000, date: '2025-07-31', notes: '' })
    const a = createAdjustment(db, { itemId: rice, date: '2025-07-31', qtyChange: -2000, rate: null, reason: 'Damaged' })
    deleteExpense(db, e.id)
    deleteTransfer(db, t)
    deleteAdjustment(db, a)
    expect(listBin(db).map((x) => x.kind).sort()).toEqual(['adjustment', 'expense', 'transfer'])
    expect(cash()).toBe(0)

    for (const x of listBin(db)) restoreFromBin(db, x.kind, x.id)
    expect(accountBalance(db, 'expense')).toBe(500_000)
    expect(cash()).toBe(-520_000)
    expect(accountBalance(db, bankAccount(wallet.id))).toBe(20_000)
    expect(getItem(db, rice).stockQty).toBe(98_000)
    expect(ledgerTotal()).toBe(0)
  })

  it('brings back parties with their opening balance and items with their opening stock', () => {
    const old = createParty(db, { ...base, name: 'Old Customer', kind: 'customer', openingBalance: 300_000, openingDate: '2025-04-01' })
    const kg = listUnits(db).find((u) => u.short === 'kg')!.id
    const dal = createItem(db, { ...itemInput, name: 'Dal', code: 'D1', taxRateId: gst5, baseUnitId: kg, openingQty: 5000 })
    deleteParty(db, old.id)
    deleteItem(db, dal.id)
    expect(listParties(db).map((p) => p.name)).toEqual(['Ravi'])

    restoreFromBin(db, 'party', old.id)
    restoreFromBin(db, 'item', dal.id)
    expect(getParty(db, old.id).balance).toBe(300_000)
    expect(getItem(db, dal.id).stockQty).toBe(5000)
    expect(listItems(db)).toHaveLength(2)

    // A new record with the same name blocks the restore instead of making a duplicate.
    deleteParty(db, old.id)
    createParty(db, { ...base, name: 'Old Customer', kind: 'customer' })
    expect(() => restoreFromBin(db, 'party', old.id)).toThrow(/already called Old Customer/)
  })

  it('reopens a deleted estimate', () => {
    const est = saveBill(db, 'ESTIMATE', null, doc())
    deleteBill(db, 'ESTIMATE', est.id)
    restoreFromBin(db, 'bill', est.id)
    expect(getBill(db, 'ESTIMATE', est.id)).toMatchObject({ number: 'EST/25-26/1', status: 'open' })
    expect(getItem(db, rice).stockQty).toBe(100_000)
  })
})

describe('change history', () => {
  beforeEach(() => {
    db = openDatabase(':memory:')
    setupBusiness(db, 'b1', { profile: { ...EMPTY_TEST_PROFILE, name: 'Shop', stateCode: '27' }, preferences: { roundOff: false } }, '2025-04-01')
    gst5 = listTaxRates(db).find((t) => t.name === 'GST 5%')!.id
    const kg = listUnits(db).find((u) => u.short === 'kg')!.id
    ravi = createParty(db, { ...base, name: 'Ravi', kind: 'customer' }).id
    rice = createItem(db, { ...itemInput, taxRateId: gst5, baseUnitId: kg }).id
  })
  afterEach(() => db.close())

  it('names each record and filters by kind, record and text', () => {
    const inv = saveBill(db, 'SALE_INVOICE', null, doc())
    saveBill(db, 'SALE_INVOICE', inv.id, doc({ notes: 'Deliver Monday' }))
    const all = listAudit(db)
    expect(all[0]).toMatchObject({ entity: 'document', action: 'update', label: 'Invoice INV/25-26/1' })
    expect(all[0].before).toMatchObject({ notes: '' })
    expect(all[0].after).toMatchObject({ notes: 'Deliver Monday' })
    expect(listAudit(db, { entity: 'party' }).map((a) => a.label)).toEqual(['Party Ravi'])
    expect(listAudit(db, { entity: 'item' })[0].label).toBe('Item Rice')
    expect(listAudit(db, { entityId: inv.id })).toHaveLength(2)
    expect(listAudit(db, { search: 'monday' })).toHaveLength(1)
    expect(listAudit(db, { from: '2999-01-01' })).toEqual([])
  })
})

describe('backups', () => {
  let dir: string
  let session: Session
  const profile = { ...EMPTY_TEST_PROFILE, name: 'Shop A', stateCode: '27' }
  const party = (name: string) => createParty(session.requireDb(), { ...base, name, kind: 'customer' })
  const names = () => listParties(session.requireDb()).map((p) => p.name).sort()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'billing-backup-'))
    session = new Session(dir)
  })
  afterEach(() => {
    session.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('saves a copy and restores it, keeping a safety copy of what was replaced', async () => {
    const biz = session.create({ profile, preferences: {} })
    party('Ravi')
    const file = join(dir, 'my-backup.db')
    await session.backupTo(file)
    expect(existsSync(file + '-wal')).toBe(false)
    party('Meena')

    expect(session.inspectBackup(file)).toMatchObject({ businessName: 'Shop A', sameBusiness: true, parties: 1 })
    const { business, safetyCopy } = await session.restore(file)
    expect(business.id).toBe(biz.id)
    expect(names()).toEqual(['Ravi'])
    expect(session.inspectBackup(safetyCopy).parties).toBe(2)
    expect(session.listBackups().map((b) => b.kind)).toEqual(['safety'])

    // The safety copy undoes the restore.
    await session.restore(safetyCopy)
    expect(names()).toEqual(['Meena', 'Ravi'])
  })

  it('opens a backup as a separate business', async () => {
    const a = session.create({ profile, preferences: {} })
    party('Ravi')
    const file = join(dir, 'copy.db')
    await session.backupTo(file)
    const b = session.importBackup(file)
    expect(b.id).not.toBe(a.id)
    expect(b.name).toBe('Shop A')
    expect(names()).toEqual(['Ravi'])
    expect(session.registry.list()).toHaveLength(2)
    expect(session.current()?.id).toBe(b.id)
  })

  it('takes one automatic backup a day and keeps the last seven', async () => {
    session.create({ profile, preferences: {} })
    expect(await session.autoBackup('2025-07-01')).toMatch(/auto-2025-07-01\.db$/)
    expect(await session.autoBackup('2025-07-01')).toBeNull()
    for (let d = 2; d <= 10; d++) await session.autoBackup(`2025-07-${String(d).padStart(2, '0')}`)
    const files = readdirSync(session.backupDir()).sort()
    expect(files).toHaveLength(7)
    expect(files[0]).toBe('auto-2025-07-04.db')
  })

  it('refuses files that are not backups, or come from a newer app', async () => {
    session.create({ profile, preferences: {} })
    const text = join(dir, 'notes.db')
    writeFileSync(text, 'hello')
    expect(() => session.inspectBackup(text)).toThrow(/not a backup/)
    const newer = join(dir, 'newer.db')
    const raw = new Database(newer)
    raw.exec(`CREATE TABLE business (id TEXT, name TEXT); INSERT INTO business VALUES ('x', 'Future'); PRAGMA user_version = 99;`)
    raw.close()
    expect(() => session.inspectBackup(newer)).toThrow(/newer version/)
    await expect(session.restore(newer)).rejects.toThrow(/newer version/)
    expect(session.isOpen).toBe(true)
  })
})
