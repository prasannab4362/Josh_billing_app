// The website end to end over real HTTP: accounts, sign-in, what each person may reach, and files in and out.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { openAccounts, type AccountsDB } from './accounts'
import { createWebServer } from './app'
import type { BusinessPool } from './pool'

let dir: string
let server: Server
let pool: BusinessPool
let accounts: AccountsDB
let base: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'jb-web-'))
  const site = join(dir, 'site')
  mkdirSync(site)
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>Josh Books</title>')
  writeFileSync(join(dir, 'secret.txt'), 'not for the web')
  accounts = openAccounts(join(dir, 'accounts.db'))
  const made = createWebServer({ accounts, dataDir: join(dir, 'data'), staticDir: site, signupOpen: true, trustProxy: false, version: 'test' })
  server = made.server
  pool = made.pool
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((ok) => server.close(ok))
  pool.closeAll()
  accounts.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A browser: keeps its sign-in cookie. */
class Browser {
  cookie = ''
  async post(path: string, body: unknown, headers: Record<string, string> = { 'x-josh-books': '1' }) {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: JSON.stringify(body)
    })
    const set = r.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]!
    return { status: r.status, body: (await r.json()) as Record<string, unknown>, setCookie: set }
  }
  async call(method: string, ...args: unknown[]) {
    const r = await this.post(`/api/${method}`, { args })
    if (r.status !== 200) throw new Error(String(r.body.error))
    return r.body.value as any
  }
  async me() {
    const r = await fetch(base + '/auth/me', { headers: this.cookie ? { Cookie: this.cookie } : {} })
    return (await r.json()) as { user: { email: string } | null; role: string | null }
  }
}

const shop = (name: string) => ({
  profile: { ...EMPTY_TEST_PROFILE, name, stateCode: '33', city: 'Chennai', fyStartMonth: 4 },
  preferences: { gstRegistered: false, pricesIncludeTax: true, paperSize: 'A4', roundOff: true },
  bankAccount: null
})

const owner = new Browser()
const other = new Browser()
const staff = new Browser()
let bizId = ''
let pcs = ''

describe('accounts', () => {
  it('signs up with email and password; weak passwords and taken emails are refused', async () => {
    expect((await owner.post('/auth/signup', { name: 'Test Owner', email: 'owner@example.test', password: 'short' })).body.error).toMatch(/8 characters/)
    expect((await owner.post('/auth/signup', { name: 'Test Owner', email: 'not-an-email', password: 'Good-pass-123' })).body.error).toMatch(/valid email/)
    const r = await owner.post('/auth/signup', { name: 'Test Owner', email: 'Owner@Example.test', password: 'Good-pass-123' })
    expect(r.status).toBe(200)
    expect(r.setCookie).toMatch(/HttpOnly/)
    expect(r.setCookie).toMatch(/SameSite=Strict/)
    expect((await owner.me()).user?.email).toBe('owner@example.test')
    const again = await new Browser().post('/auth/signup', { name: 'X', email: 'owner@example.test', password: 'Another-pass-1' })
    expect(again.body.error).toMatch(/already exists/)
    // Only a hash is kept.
    const row = accounts.prepare('SELECT password_hash FROM web_user WHERE email = ?').get('owner@example.test') as { password_hash: string }
    expect(row.password_hash).toMatch(/^scrypt\$/)
    expect(row.password_hash).not.toContain('Good-pass-123')
  })

  it('refuses calls from other sites and calls without sign-in', async () => {
    expect((await owner.post('/api/listBusinesses', { args: [] }, {})).status).toBe(403)
    expect((await owner.post('/api/listBusinesses', { args: [] }, { 'x-josh-books': '1', Origin: 'https://evil.example' })).status).toBe(403)
    const stranger = await new Browser().post('/api/listBusinesses', { args: [] })
    expect(stranger.status).toBe(401)
    expect((await owner.post('/api/notAMethod', { args: [] })).status).toBe(404)
  })

  it('locks an account for a while after 5 wrong passwords', async () => {
    const b = new Browser()
    await b.post('/auth/signup', { name: 'Lock Test', email: 'lock@example.test', password: 'Right-pass-123' })
    const guess = new Browser()
    for (let i = 0; i < 4; i++) expect((await guess.post('/auth/login', { email: 'lock@example.test', password: 'wrong-pass' })).body.error).toBe('Wrong email or password')
    expect((await guess.post('/auth/login', { email: 'lock@example.test', password: 'wrong-pass' })).body.error).toMatch(/Too many/)
    expect((await guess.post('/auth/login', { email: 'lock@example.test', password: 'Right-pass-123' })).body.error).toMatch(/Too many/)
    expect((await guess.post('/auth/login', { email: 'nobody@example.test', password: 'whatever-1' })).body.error).toBe('Wrong email or password')
  })
})

describe('a business on the website', () => {
  it('is created, used with the same rules as the desktop, and listed only for its people', async () => {
    const b = await owner.call('createBusiness', shop('Test Only Web Store'))
    bizId = b.id
    expect((await owner.me()).role).toBe('owner')
    pcs = (await owner.call('listUnits')).find((u: { short: string }) => u.short === 'pcs').id
    await owner.call('createItem', {
      name: 'Web Kurti', code: '', kind: 'goods', category: '', hsnSac: '', taxRateId: null, priceIncludesTax: true, salePrice: 79_900,
      purchasePrice: 50_000, mrp: null, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: pcs, altUnitId: null, altConversion: null,
      trackStock: true, openingQty: 5_000, openingRate: 50_000, openingDate: '2026-04-01', lowStockQty: null
    })
    expect((await owner.call('listItems')).map((i: { name: string }) => i.name)).toEqual(['Web Kurti'])
    expect((await owner.call('listBusinesses')).map((x: { name: string }) => x.name)).toEqual(['Test Only Web Store'])
  })

  it("keeps one account's businesses away from another", async () => {
    await other.post('/auth/signup', { name: 'Other Shop', email: 'other@example.test', password: 'Second-shop-123' })
    expect(await other.call('listBusinesses')).toEqual([])
    await expect(other.call('openBusiness', bizId)).rejects.toThrow(/not found/)
    await expect(other.call('listItems')).rejects.toThrow(/Open a business/)
    expect((await other.post('/auth/team', {})).body.error).toMatch(/Open a business/)
  })

  it('gives staff only the staff calls, and the owner can take access away', async () => {
    expect((await other.post('/auth/team/add', { name: 'X', email: 'x@example.test', password: 'Xx-pass-1234' })).status).toBe(400)
    const added = await owner.post('/auth/team/add', { name: 'Test Staff', email: 'staff@example.test', password: 'Counter-pass-77' })
    expect(added.status).toBe(200)
    expect((await owner.post('/auth/team', {})).body).toHaveLength(2)

    await staff.post('/auth/login', { email: 'staff@example.test', password: 'Counter-pass-77' })
    await staff.call('openBusiness', bizId)
    expect((await staff.me()).role).toBe('staff')
    expect(await staff.call('listItems')).toHaveLength(1)
    await expect(staff.call('dashboard')).rejects.toThrow(/Only the owner/)
    await expect(staff.call('listBills', 'PURCHASE_BILL', {})).rejects.toThrow(/Only the owner/)
    await expect(staff.call('backupNow')).rejects.toThrow(/Only the owner/)
    expect((await staff.post('/auth/team', {})).body.error).toMatch(/Only the owner/)

    const staffId = (await owner.post('/auth/team', {})).body as unknown as { userId: string; role: string }[]
    const id = (staffId as { userId: string; role: string }[]).find((m) => m.role === 'staff')!.userId
    expect((await owner.post('/auth/team/remove', { userId: id })).status).toBe(200)
    await expect(staff.call('listItems')).rejects.toThrow(/Open a business/)
    await expect(staff.call('openBusiness', bizId)).rejects.toThrow(/not found/)
  })

  it('records who made each change', async () => {
    const log = await owner.call('listAudit', {})
    expect(log.some((e: { by: string; label: string }) => e.by === 'owner@example.test' && /Web Kurti/.test(e.label))).toBe(true)
  })
})

describe('files and printing', () => {
  it('sends Excel files and prints as things for the browser to do', async () => {
    const x = await owner.call('exportToExcel', 'items')
    expect(x.__web).toBe('download')
    expect(x.name).toMatch(/items .*\.xlsx$/)
    expect(Buffer.from(x.base64, 'base64').subarray(0, 2).toString()).toBe('PK')
    const report = await owner.call('printReport', { title: 'Test', subtitle: '', sections: [] })
    expect(report.__web).toBe('print')
    await expect(owner.call('openWeb', 'https://evil.example/steal')).rejects.toThrow(/cannot be opened/)
    const wa = await owner.call('openWhatsApp', '9000000001', 'Hello')
    expect(wa).toMatchObject({ __web: 'open' })
    expect(wa.url).toMatch(/^https:\/\/wa\.me\//)
  })

  it('downloads a backup and brings it back as a new business', async () => {
    const backup = await owner.call('backupNow')
    expect(backup.__web).toBe('download')
    const info = await owner.post('/api/uploadBackupFile', { args: [], file: { name: 'shop.db', base64: backup.base64 } })
    expect(info.status).toBe(200)
    const v = info.body.value as { path: string; businessName: string; invoices: number }
    expect(v.businessName).toBe('Test Only Web Store')
    expect(v.path).toMatch(/^file:/) // never a path on the server
    // Another person cannot use that file id.
    await expect(other.call('importBackup', v.path)).rejects.toThrow(/again/)
    const copy = await owner.call('importBackup', v.path)
    expect(copy.id).not.toBe(bizId)
    expect((await owner.call('listItems')).map((i: { name: string }) => i.name)).toEqual(['Web Kurti'])
    expect(await owner.call('listBusinesses')).toHaveLength(2)
  })

  it('refuses a file that is not a backup', async () => {
    const r = await owner.post('/api/uploadBackupFile', { args: [], file: { name: 'x.db', base64: Buffer.from('hello').toString('base64') } })
    expect(r.body.error).toMatch(/not a backup/)
  })
})

describe('pages and sign-out', () => {
  it('serves the app with security headers and nothing outside it', async () => {
    const r = await fetch(base + '/')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/)
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    for (const p of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt']) {
      expect((await fetch(base + p)).status).toBe(404)
    }
  })

  it('a new password ends the other sign-ins; signing out ends this one', async () => {
    const second = new Browser()
    await second.post('/auth/login', { email: 'owner@example.test', password: 'Good-pass-123' })
    expect((await second.me()).user).not.toBeNull()
    await expect(owner.call('changeMyPassword', 'wrong-current', 'New-pass-4567')).rejects.toThrow(/current password is wrong/)
    await owner.call('changeMyPassword', 'Good-pass-123', 'New-pass-4567')
    expect((await second.me()).user).toBeNull()
    expect((await owner.me()).user).not.toBeNull()
    const out = await owner.post('/auth/logout', {})
    expect(out.setCookie).toMatch(/Max-Age=0/)
    expect((await new Browser().post('/auth/login', { email: 'owner@example.test', password: 'New-pass-4567' })).status).toBe(200)
  })
})
