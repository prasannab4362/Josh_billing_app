// POS counter billing and the bill share panel (24 checks).
// Usage: node scripts/e2e/pos-share.mjs <output folder>   (app started as in README.md, a business open)
// Links and prints are recorded instead of opening apps or printer dialogs.
import { existsSync, readFileSync } from 'node:fs'
import { connect, mainEval, stubDialogs, sleep } from './harness.mjs'

const out = process.argv[2].split('\\').join('/')
const app = await connect(out)
const { click, waitFor, text, api, check, shot, evaluate } = app
const setValue = (sel, v) => app.setValue(`document.querySelector(${JSON.stringify(sel)})`, v)
await stubDialogs(out)
// Record links and prints instead of opening apps or printer dialogs.
await mainEval(`(() => { const { shell, app, BrowserWindow } = require('electron'); globalThis.__opened = []; globalThis.__printed = 0;
  shell.openExternal = async (u) => { globalThis.__opened.push(u) }; shell.showItemInFolder = () => {};
  app.setPath('documents', ${JSON.stringify(out)});
  const tmp = new BrowserWindow({ show: false }); const proto = Object.getPrototypeOf(tmp.webContents); tmp.destroy();
  proto.print = function (opts, cb) { globalThis.__printed++; cb && cb(true, '') };
  return 1 })()`)
const opened = async () => JSON.parse(await mainEval('JSON.stringify(globalThis.__opened)'))
const sfx = String(Date.now() % 100000)
const key = (k, extra = {}) => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ...${JSON.stringify(extra)} }))`)
const enterIn = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)

// Test items: a shirt with a wholesale price from 15 pieces, and a dhoti.
const units = await api('listUnits()')
const rates = await api('listTaxRates()')
const pcs = units.find((u) => u.short === 'pcs').id
const gst5 = rates.find((r) => r.name === 'GST 5%').id
const base = { kind: 'goods', category: 'Clothing', hsnSac: '6109', taxRateId: gst5, priceIncludesTax: false, purchasePrice: 20000, mrp: 49900,
  baseUnitId: pcs, altUnitId: null, altConversion: null, trackStock: true, openingQty: 500000, openingRate: 20000, openingDate: '2026-04-01', lowStockQty: null }
const barcode = await api('generateBarcode()')
const shirt = await api(`createItem(${JSON.stringify({ ...base, name: `POS Shirt ${sfx}`, code: `PS-${sfx}`, barcode, salePrice: 43000, wholesalePrice: 38000, wholesaleMinQty: 15000 })})`)
const dhoti = await api(`createItem(${JSON.stringify({ ...base, name: `POS Dhoti ${sfx}`, code: '', salePrice: 35000, wholesalePrice: null, wholesaleMinQty: null })})`)

await click('POS')
await waitFor('Ready for the next customer')
await sleep(500)
check((await text()).includes('Counter (POS)'), 'Counter (POS) page opens from the sidebar')

// Scan the shirt twice, search the dhoti by name.
for (let i = 0; i < 2; i++) {
  await setValue('input[aria-label="Scan or search items"]', barcode)
  await enterIn('input[aria-label="Scan or search items"]')
  await sleep(200)
}
await setValue('input[aria-label="Scan or search items"]', `POS Dhoti ${sfx}`.slice(0, 9))
await sleep(300)
check(await evaluate(`document.querySelectorAll('.pos-suggest button').length >= 1`), 'typing a name shows matching items')
await setValue('input[aria-label="Scan or search items"]', `POS Dhoti ${sfx}`)
await sleep(200)
await enterIn('input[aria-label="Scan or search items"]')
await sleep(300)
const rows = () => evaluate(`[...document.querySelectorAll('.pos-lines tbody tr')].map((r) => [...r.cells].map((c) => c.innerText.trim()))`)
let r = await rows()
const qtyOf = (n) => evaluate(`[...document.querySelectorAll('.pos-lines tbody tr')][${n}].querySelector('input').value`)
check(r.length === 2 && (await qtyOf(0)) === '2' && r[0][5] === '₹430.00', `scan twice: one line, quantity 2 at ₹430 (${JSON.stringify(r[0])})`)

// F2 on the shirt: 15 pieces → wholesale ₹380.
await evaluate(`[...document.querySelectorAll('.pos-lines tbody tr')][0].click()`)
await key('F2')
await waitFor('Change POS Shirt')
await setValue('input[aria-label="Quantity"]', '15')
await sleep(200)
await click('Save', '.modal')
await sleep(300)
r = await rows()
check((await qtyOf(0)) === '15' && r[0][5] === '₹380.00' && r[0][2].includes('wholesale'), `15 pieces switch to the wholesale price ₹380 (${r[0][2]} ${r[0][5]})`)

// F9 bill discount 10%, F8 packing charge ₹20, F12 remarks.
await key('F9')
await waitFor('Bill discount')
await setValue('input[aria-label="Bill discount"]', '10')
await click('Save', '.modal')
await sleep(200)
await key('F8')
await waitFor('Additional charge')
await setValue('input[aria-label="Charge amount"]', '20')
await click('Add', '.modal')
await sleep(200)
await key('F12')
await waitFor('Remarks')
await setValue('input[aria-label="Remarks"]', 'Gift pack')
await click('Save', '.modal')
await sleep(300)
await evaluate(`[...document.querySelectorAll('button.link-btn')].find((b) => b.innerText.includes('breakup')).click()`)
await sleep(200)
const totalText = await evaluate(`document.querySelector('.pos-total b').innerText`)
// 15 × 380 + 1 × 350 = 6050, less 10% = 5445; GST 5% = 272.25; + packing 20 = 5737.25 → 5737.
check(totalText === 'Total ₹5,737.00', `total with wholesale, 10% discount, GST and packing, rounded off: ${totalText}`)
const bd = await evaluate(`document.querySelector('.pos-total dl').innerText`)
check(bd.includes('CGST') && bd.includes('Round off') && bd.includes('Packing'), 'full breakup shows CGST/SGST, packing and round off')
await shot('67-pos-bill')

// A walk-in must pay in full.
await setValue('input[aria-label="Amount received"]', '5000')
await sleep(200)
check((await text()).includes('still to take'), 'shows the balance still to take from a walk-in')
await key('s', { ctrlKey: true })
await sleep(500)
check((await text()).includes('Choose a customer to give credit'), 'a walk-in short payment is refused')
// Take 6000 → change 263.
await setValue('input[aria-label="Amount received"]', '6000')
await sleep(200)
check((await evaluate(`document.querySelector('.pos-change').innerText`)).includes('₹263.00'), 'change to return ₹263.00')
await key('p', { ctrlKey: true })
await waitFor('Give back ₹263.00')
await sleep(800)
const printed = await mainEval('globalThis.__printed')
const bills = await api(`listBills('SALE_INVOICE', {})`)
const last = bills.sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }))[0]
const full = await api(`getBill('SALE_INVOICE', ${JSON.stringify(last.id)})`)
check(full.grandTotal === 573700 && full.paidAmount === 573700 && full.notes === 'Gift pack' && full.charges[0]?.amount === 2000, `saved as sale invoice ${full.number}: ₹5,737 paid, remarks and charge kept`)
check(printed >= 1, `Ctrl+P printed the bill (${printed} print job)`)
check(await evaluate(`!!document.querySelector('.pos-empty')`), 'the counter starts a fresh bill after saving')
const after = await api(`getItem(${JSON.stringify(shirt.id)})`)
check(after.stockQty === 485000, `stock went down by 15 (${after.stockQty / 1000})`)

// Two bills at once.
await key('t', { ctrlKey: true })
await sleep(300)
check((await evaluate(`document.querySelectorAll('.pos-tab').length`)) === 2, 'Ctrl+T opens a second bill')
await key('w', { ctrlKey: true })
await sleep(300)
check((await evaluate(`document.querySelectorAll('.pos-tab').length`)) === 1, 'Ctrl+W closes it')

// Credit sale to a saved customer.
let party = (await api('listParties()')).find((p) => p.kind !== 'supplier' && p.phone)
if (!party) party = await api(`createParty(${JSON.stringify({ name: `Counter Customer ${sfx}`, kind: 'customer', phone: '9876501234', email: '', gstin: '', stateCode: '', billingAddress: '', shippingAddress: '', openingBalance: 0, openingDate: '', creditLimit: null, paymentTermDays: null, group: '' })})`)
await setValue('input[aria-label="Scan or search items"]', barcode)
await enterIn('input[aria-label="Scan or search items"]')
await sleep(200)
await setValue('input[aria-label="Customer"]', `${party.name}${party.phone ? ` · ${party.phone}` : ''}`)
await setValue('input[aria-label="Amount received"]', '100')
await sleep(300)
check((await text()).includes('Balance on credit'), `credit allowed for ${party.name}`)
await key('s', { ctrlKey: true })
await waitFor('saved for')
const credit = (await api(`listBills('SALE_INVOICE', {})`)).find((b) => b.partyId === party.id && b.paidAmount === 10000)
check(!!credit && credit.balanceDue > 0, 'credit bill saved with a balance due')

// Share panel on the saved invoice.
await click('Sale')
await waitFor('New invoice')
await sleep(400)
await evaluate(`[...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(${JSON.stringify(credit.number)})).click()`)
await waitFor('Text message')
await shot('68-share-panel')
for (const [btn, starts] of [['Gmail', 'https://mail.google.com/mail/?view=cm'], ['Email app', 'mailto:'], ['Text message', 'sms:'], ['WhatsApp', 'https://wa.me/']]) {
  await evaluate(`[...document.querySelectorAll('.share-grid button')].find((b) => b.innerText.startsWith(${JSON.stringify(btn)})).click()`)
  await waitFor(`Send by ${btn}`)
  await click(`Open ${btn}`, '.modal')
  await waitFor('Opened')
  const u = (await opened()).at(-1) || ''
  check(u.startsWith(starts) && decodeURIComponent(u).includes(credit.number), `${btn}: opens ${starts}… with the bill number`)
  await click('Close', '.modal')
  await sleep(200)
}
const shared = `${out}/Billing App/Shared`
check(existsSync(shared), 'bill PDFs saved in Documents\\Billing App\\Shared for attaching')
const before = await mainEval('globalThis.__printed')
await evaluate(`[...document.querySelectorAll('.share-grid button')].find((b) => b.innerText.startsWith('Print bill')).click()`)
await sleep(1500)
await evaluate(`[...document.querySelectorAll('.share-grid button')].find((b) => b.innerText.startsWith('Print invoice')).click()`)
await sleep(1500)
check((await mainEval('globalThis.__printed')) - before === 2, 'Print bill (thermal) and Print invoice (sheet) each print')
await evaluate(`[...document.querySelectorAll('.share-grid button')].find((b) => b.innerText.startsWith('Download PDF')).click()`)
await waitFor('PDF saved to')
const pdf = (await text()).match(/PDF saved to (.+\.pdf)/)?.[1]
check(pdf && readFileSync(pdf).subarray(0, 4).toString() === '%PDF', 'Download PDF saves a PDF')
console.log(app.log.filter((l) => l.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL OK')
app.close()
