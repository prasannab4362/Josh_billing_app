// Textile and wholesale checks in the running app: the counter (POS) and the sale invoice editor must give the
// same wholesale prices, GST and totals, and the saved bills must match what was on screen.
// Usage: node scripts/e2e/textile-wholesale.mjs <output folder>   (app started as in README.md, a business open)
import { connect, stubDialogs, sleep } from './harness.mjs'

const out = process.argv[2] ?? 'e2e-out'
const app = await connect(out)
const { click, waitFor, text, api, check, shot, evaluate } = app
await stubDialogs(out)
const sfx = String(Date.now() % 100000)
const setValue = (sel, v) => app.setValue(`document.querySelector(${JSON.stringify(sel)})`, v)
const key = (k, extra = {}) => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ...${JSON.stringify(extra)} }))`)
const enterIn = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
const prefs = await api('getPreferences()')
await api(`savePreferences({ pricesIncludeTax: false, roundOff: true })`)

const units = await api('listUnits()')
const rates = await api('listTaxRates()')
const pcs = units.find((u) => u.short === 'pcs').id
const gst5 = rates.find((r) => r.name === 'GST 5%').id
const base = { kind: 'goods', category: 'Textiles', hsnSac: '6109', taxRateId: gst5, priceIncludesTax: false, purchasePrice: 25000, mrp: null, baseUnitId: pcs,
  altUnitId: null, altConversion: null, trackStock: true, openingQty: 1000000, openingRate: 25000, openingDate: '2026-04-01', lowStockQty: null }
const mk = async (name, over) => api(`createItem(${JSON.stringify({ ...base, name: `${name} ${sfx}`, code: '', barcode: await api('generateBarcode()'), salePrice: 45000, wholesalePrice: 38000, wholesaleMinQty: 15000, ...over })})`)
const shirtM = await mk('Shirt M', {})
const shirtL = await mk('Shirt L', {})
const saree = await mk('Silk saree', { priceIncludesTax: true, salePrice: 199900, wholesalePrice: 159900, wholesaleMinQty: 6000 })

const lastBill = async () => {
  const list = await api(`listBills('SALE_INVOICE', {})`)
  const b = list.sort((a, c) => c.number.localeCompare(a.number, undefined, { numeric: true }))[0]
  return api(`getBill('SALE_INVOICE', ${JSON.stringify(b.id)})`)
}
const scan = async (code) => {
  await setValue('input[aria-label="Scan or search items"]', code)
  await enterIn('input[aria-label="Scan or search items"]')
  await sleep(250)
}
const setQty = async (name, qty) => {
  await evaluate(`(() => { const el = document.querySelector('input[aria-label="Quantity of ${name}"]'); el.focus(); el.value = ${JSON.stringify(String(qty))}; el.blur() })()`)
  await sleep(250)
}
const posRows = () => evaluate(`[...document.querySelectorAll('.pos-lines tbody tr')].map((r) => [...r.cells].map((c) => c.innerText.trim().replace(/\\s+/g, ' ')))`)

// ---------- POS ----------
await click('POS')
await waitFor('Ready for the next customer')
await scan(shirtM.barcode)
await scan(shirtL.barcode)
await setQty(`Shirt M ${sfx}`, 10)
await setQty(`Shirt L ${sfx}`, 8)
let t = await text()
check(t.includes('18 pieces across 2 items') && t.includes('Use wholesale prices'), 'POS: 10 of size M + 8 of size L suggests wholesale for the bulk order')
check((await posRows())[0][5] === '₹450.00', 'POS: each size is retail on its own (₹450) until the bill is made wholesale')
check(t.includes('Wholesale ₹380.00 from 15 pcs: add 5 more'), 'POS: the line says how many more pieces reach the wholesale price')
await click('Use wholesale prices')
await sleep(300)
const rows = await posRows()
check(rows[0][5] === '₹380.00' && rows[1][5] === '₹380.00' && rows[0][2].includes('wholesale'), 'POS: "Use wholesale prices" gives ₹380 on both sizes')
const total = await evaluate(`document.querySelector('.pos-total b').innerText`)
check(total === 'Total ₹7,182.00', `POS: 18 × ₹380 + 5% GST = ${total}`)
await shot('70-pos-wholesale-bill')
await key('s', { ctrlKey: true })
await waitFor('saved for')
let bill = await lastBill()
check(bill.grandTotal === 718200 && bill.lines.every((l) => l.rate === 38000), 'POS: the saved invoice has ₹380 rates and the same total ₹7,182')

// Exactly at the minimum, with the + button, and fractional-safe typing.
await scan(shirtM.barcode)
await setQty(`Shirt M ${sfx}`, 14)
check((await posRows())[0][5] === '₹450.00' && (await text()).includes('add 1 more'), 'POS: 14 pieces is still retail, "add 1 more" shown')
await evaluate(`document.querySelector('button[aria-label="More Shirt M ${sfx}"]').click()`)
await sleep(250)
check((await posRows())[0][5] === '₹380.00', 'POS: the + button takes it to 15 pieces and the wholesale price')
await evaluate(`document.querySelector('button[aria-label="Less Shirt M ${sfx}"]').click()`)
await sleep(250)
check((await posRows())[0][5] === '₹450.00', 'POS: the − button takes it back to 14 and retail')
await setQty(`Shirt M ${sfx}`, 'abc')
check((await evaluate(`document.querySelector('input[aria-label="Quantity of Shirt M ${sfx}"]').value`)) === '14', 'POS: a typed quantity that is not a number is ignored (stays 14)')

// Tax-inclusive saree, wholesale from 6.
await evaluate(`window.confirm = () => true`) // closing a bill with items asks first; answer yes
await key('w', { ctrlKey: true })
await sleep(300)
await scan(saree.barcode)
await setQty(`Silk saree ${sfx}`, 6)
const sareeTotal = await evaluate(`document.querySelector('.pos-total b').innerText`)
check(sareeTotal === 'Total ₹9,594.00', `POS: tax-inclusive saree, 6 at the wholesale ₹1,599 (GST included) = ${sareeTotal}`)
await key('s', { ctrlKey: true })
await waitFor('saved for')
bill = await lastBill()
check(bill.grandTotal === 959400, 'POS: saved saree bill is ₹9,594.00')

// ---------- Sale invoice editor ----------
await click('Sale')
await waitFor('New invoice')
await click('New invoice')
await waitFor('Additional charges')
await sleep(600)
const scanBox = 'input[aria-label="Scan barcode"]'
const editorScan = async (code) => {
  await setValue(scanBox, code)
  await enterIn(scanBox)
  await sleep(300)
}
const rowInputs = (n) => evaluate(`[...document.querySelectorAll('.lines tbody tr:not(.details-row)')][${n}] ? [...[...document.querySelectorAll('.lines tbody tr:not(.details-row)')][${n}].querySelectorAll('input')].map((i) => i.value) : null`)
const setRowQty = async (n, q) => {
  await app.setValue(`[...document.querySelectorAll('.lines tbody tr:not(.details-row)')][${n}].querySelectorAll('input')[2]`, String(q))
  await sleep(250)
}
await editorScan(shirtM.barcode)
await setRowQty(0, 14)
check((await rowInputs(0))[3] === '450', `Invoice: 14 pieces is retail ₹450 (${(await rowInputs(0))[3]})`)
await setRowQty(0, 15)
check((await rowInputs(0))[3] === '380', `Invoice: 15 pieces switches to wholesale ₹380 (${(await rowInputs(0))[3]})`)
await setRowQty(0, 8)
await editorScan(shirtL.barcode)
await setRowQty(1, 10)
t = await text()
check(t.includes('18 pcs across 2 items') && t.includes('Use wholesale rates'), 'Invoice: the same bulk suggestion as the counter')
await shot('71-invoice-wholesale-hint')
await click('Use wholesale rates')
await sleep(300)
check((await rowInputs(0))[3] === '380' && (await rowInputs(1))[3] === '380', 'Invoice: "Use wholesale rates" gives ₹380 on both sizes')
await click('Retail')
await sleep(300)
check((await rowInputs(0))[3] === '450' && (await rowInputs(1))[3] === '450', 'Invoice: switching back to Retail restores ₹450')
await click('Wholesale bill')
await sleep(300)
await click('Save')
await waitFor('saved')
bill = await lastBill()
check(bill.grandTotal === 718200 && bill.lines.length === 2 && bill.lines.every((l) => l.rate === 38000), `Invoice: saved bill ${bill.number} = ₹7,182 at ₹380, identical to the counter's bill`)
console.log(app.log.filter((l) => l.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL OK')
await api(`savePreferences(${JSON.stringify({ pricesIncludeTax: prefs.pricesIncludeTax, roundOff: prefs.roundOff })})`)
app.close()
