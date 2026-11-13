// Shop tour: barcodes, QR codes, labels and billing by scanning, for six kinds of shop, in the real app.
// For each shop it sets up a made-up business, creates barcodes, designs and renders its labels (and proves
// each printed code scans by reading it back with OpenCV), bills by typing the codes into the scan box as a
// scanner would, and prints the bill both as a counter receipt and as an A4 GST invoice. Screenshots of
// every step go to <out>/tour; docs/setup-guide uses them.
// Usage: node scripts/e2e/shop-tour.mjs <output folder>   (start the app first; see README.md; needs Python + OpenCV)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connect, mainEval, sleep, stubDialogs } from './harness.mjs'

const out = resolve(process.argv[2] ?? 'e2e-out', 'tour')
mkdirSync(out, { recursive: true })
const app = await connect(out)
const { evaluate, check, waitFor } = app
await stubDialogs(resolve(process.argv[2] ?? 'e2e-out'))
const results = []
const ok = (shop, cond, msg) => {
  check(cond, `${shop}: ${msg}`)
  results.push({ shop, check: msg, ok: !!cond })
}
const api = (method, ...args) => evaluate(`window.api.${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
const js = (body) => evaluate(`(async () => { ${body} })()`)
const today = await js(`const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)`)
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const gstin = (state, pan) => {
  const f = `${state}${pan}1Z`
  let s = 0
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(f[i]) * (i % 2 ? 2 : 1)
    s += Math.floor(p / 36) + (p % 36)
  }
  return f + CHARS[(36 - (s % 36)) % 36]
}

// ---------- Screens ----------
const shot = async (name) => {
  await sleep(500)
  await app.shot(name)
}
const nav = (page) => js(`[...document.querySelectorAll('.sidebar .nav')].find((b) => b.innerText.trim().startsWith(${JSON.stringify(page)})).click()`)
const clickText = (text, scope = '') =>
  js(`const b = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((x) => x.innerText.trim() === ${JSON.stringify(text)} || x.innerText.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click()`)
const setValue = (selector, value, index = 0) =>
  js(`const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) throw new Error('no ' + ${JSON.stringify(selector)});
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))`)
async function scan(code) {
  await setValue('input[aria-label="Scan barcode"]', code)
  await js(`document.querySelector('input[aria-label="Scan barcode"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await sleep(250)
  return js(`return document.querySelector('.scan-box span')?.innerText ?? ''`)
}
/** Change the quantity on the bill line of an item (after scanning it once). */
const setLineQty = (itemName, qty) =>
  js(`const row = [...document.querySelectorAll('.table.lines tbody tr')].find((r) => r.querySelector('input')?.value === ${JSON.stringify(itemName)});
    if (!row) throw new Error('no line ' + ${JSON.stringify(itemName)});
    const el = row.querySelector('input.num');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(qty)});
    el.dispatchEvent(new Event('input', { bubbles: true }))`)
const reopen = async () => {
  await evaluate('location.reload()')
  await sleep(2500)
}

// ---------- Pictures ----------
/** Draw an HTML page in an offscreen window and save it as a PNG; returns the file path. */
async function renderPng(html, file, width, zoom = 1) {
  const data = await mainEval(`globalThis.__E = require('electron'), (async () => {
    const w = new __E.BrowserWindow({ show: false, width: ${width}, height: 900, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true } })
    try {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(html)}))
      await w.webContents.executeJavaScript("document.documentElement.style.zoom = '${zoom}'; document.body.style.background = document.body.style.background || '#fff'")
      await new Promise((r) => setTimeout(r, 400))
      const h = Math.min(7000, await w.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight) + 8'))
      w.setContentSize(${width}, h)
      await new Promise((r) => setTimeout(r, 300))
      const img = await w.webContents.capturePage({ x: 0, y: 0, width: ${width}, height: h })
      return img.toDataURL()
    } finally { w.destroy() }
  })()`)
  const path = `${out}/${file}.png`
  writeFileSync(path, Buffer.from(data.split(',')[1], 'base64'))
  return path
}
function readCodes(paths) {
  const json = execFileSync('python', ['-I', resolve('scripts/e2e/read-codes.py'), ...paths], { encoding: 'utf8' })
  return JSON.parse(json)
}
/** Printed page width of each roll layout, millimetres (see LABEL_LAYOUTS in shared/labels.ts). */
const ROLL_WIDTH = { 'roll-50x25': 50, 'roll-2x50x25': 102, 'roll-38x25': 38, 'roll-2x38x25': 78, 'roll-100x50': 100 }
/** Render labels at a size a phone camera or scanner would see them. The whole page is kept as a picture for the
 *  guide; then each item's label is drawn on its own and read back, as a scanner reads one label at a time. */
async function labelsCheck(shop, file, req, expectBar, expectQr) {
  const sheet = req.options.layout.startsWith('a4')
  // Window as wide as the zoomed page (mm → px at 96 dpi), so nothing is cut off or squeezed.
  const mm = sheet ? 210 : ROLL_WIDTH[req.options.layout] ?? req.options.custom.width * req.options.custom.across + 2 * (req.options.custom.across - 1)
  const zoom = sheet ? 2 : 3
  const width = Math.ceil(mm * 3.78 * zoom) + 60
  const page = await renderPng(await api('previewLabels', req), file, width, zoom)
  const singles = []
  for (const [n, r] of req.items.entries()) {
    const html = await api('previewLabels', { ...req, items: [{ ...r, copies: 1 }] })
    singles.push(await renderPng(html, `${file}-item${n + 1}`, width, zoom))
  }
  const got = readCodes(singles)
  const bars = new Set(Object.values(got).flatMap((g) => g.barcodes))
  const qrs = new Set(Object.values(got).flatMap((g) => g.qr))
  for (const c of expectBar) ok(shop, bars.has(c), `barcode ${c} on the printed label scans (${file})`)
  for (const c of expectQr) ok(shop, qrs.has(c), `QR code "${c}" on the printed label scans (${file})`)
  return page
}

// ---------- Setting up ----------
async function newBusiness(name, stateCode, gst, prefs, extra) {
  const existing = (await api('listBusinesses')).find((b) => b.name === name)
  const finalName = existing ? `${name} ${Date.now() % 1000}` : name
  const b = await api('createBusiness', {
    profile: { name: finalName, legalName: '', gstin: gst, pan: '', stateCode, address: extra.address, city: extra.city, pincode: extra.pincode,
      phone: extra.phone ?? '9000000088', email: '', businessType: extra.type ?? 'Retail', category: extra.category ?? '', fyStartMonth: 4 },
    preferences: { gstRegistered: !!gst, roundOff: true, ...prefs },
    bankAccount: extra.upi ? { kind: 'upi_wallet', name: 'Shop UPI', bankName: '', accountNo: '', ifsc: '', upiId: extra.upi, openingBalance: 0, isDefaultForPrint: true } : null
  })
  return b
}
const unitId = async (short, name) => (await api('listUnits')).find((u) => u.short === short)?.id ?? (await api('createUnit', name ?? short, short)).id
const rate = async (name) => (await api('listTaxRates')).find((t) => t.name === name)?.id ?? (await api('createTaxRate', { name, kind: 'gst', rateBp: Math.round(parseFloat(name.replace(/[^\d.]/g, '')) * 100), cessBp: 0 })).id
const item = (o) => ({
  name: o.name, code: o.code ?? '', kind: 'goods', category: o.category ?? '', hsnSac: o.hsn ?? '', taxRateId: o.tax ?? null, priceIncludesTax: !!o.incl,
  salePrice: o.sale, purchasePrice: o.buy ?? Math.round(o.sale * 0.7), mrp: o.mrp ?? null, wholesalePrice: o.wholesale ?? null, wholesaleMinQty: o.wholesaleMin ?? null,
  baseUnitId: o.unit, altUnitId: o.alt ?? null, altConversion: o.altConv ?? null, trackStock: true, openingQty: o.open ?? 50_000, openingRate: o.buy ?? Math.round(o.sale * 0.7),
  openingDate: today, lowStockQty: o.low ?? null, barcode: o.barcode ?? '', description: o.description ?? '', customFields: o.own ?? null
})
const party = (o) => ({
  name: o.name, kind: o.kind ?? 'customer', phone: o.phone ?? '', email: '', gstin: o.gstin ?? '', stateCode: o.state, billingAddress: o.address ?? '',
  shippingAddress: '', openingBalance: 0, openingDate: today, creditLimit: null, paymentTermDays: o.terms ?? null, group: ''
})
async function ownFields(labels) {
  const f = await api('getFeatures')
  await api('saveFeatures', { ...f, itemFields: f.itemFields.map((x, i) => (labels[i] ? { on: true, label: labels[i], print: true } : { ...x, on: false })) })
}
const design = (o) => ({
  layout: o.layout, custom: o.custom ?? { width: 50, height: 25, across: 1, gap: 2 }, sizeId: o.sizeId, symbol: o.symbol ?? 'barcode', showCode: true,
  header: { field: o.header ?? 'business', text: '' },
  lines: [...o.lines.map((f) => (typeof f === 'string' ? { field: f, text: '' } : f)), ...Array(4).fill({ field: 'none', text: '' })].slice(0, 4)
})

/** Open the bill just saved, print it both ways (receipt and A4 invoice) and keep pictures of both. */
async function printBoth(shop, prefix, type, id, wantInvoiceTitle) {
  await waitFor('Print as')
  await sleep(800)
  await clickText('Bill 80 mm', '.print-as')
  await sleep(900)
  await shot(`${prefix}-bill-view-receipt`)
  const receipt = await js(`return document.querySelector('iframe.invoice-preview').srcdoc`)
  await renderPng(receipt, `${prefix}-receipt`, 380, 1.15)
  ok(shop, /80mm/.test(receipt), 'counter bill drawn for an 80 mm printer')
  await clickText('Invoice A4', '.print-as')
  await sleep(900)
  await shot(`${prefix}-bill-view-invoice`)
  const invoice = await js(`return document.querySelector('iframe.invoice-preview').srcdoc`)
  await renderPng(invoice, `${prefix}-invoice`, 860, 1)
  ok(shop, invoice.includes(wantInvoiceTitle), `A4 invoice says "${wantInvoiceTitle}"`)
  for (const paper of ['thermal80', 'A4']) {
    const path = await api('exportBillPdf', type, id, paper)
    ok(shop, !!path && existsSync(path) && statSync(path).size > 4000, `PDF saved as ${paper === 'A4' ? 'A4 invoice' : '80 mm bill'}`)
  }
}

/** New sale invoice screen; returns once the scan box is ready. */
async function newSale() {
  await nav('Sale')
  await sleep(700)
  await clickText('New invoice', '.page-head')
  await waitFor('Additional charges')
  await sleep(600)
}
const latestBill = async (type = 'SALE_INVOICE') => (await api('listBills', type, {}))[0]

// =====================================================================================================
// 1a. CLOTHING RETAIL: size and colour on labels, scanning at the counter, receipt and invoice.
{
  const S = 'Clothing retail'
  await newBusiness('Test Trends Fashion', '33', gstin('33', 'TRFPA2101A'), { pricesIncludeTax: true, paperSize: 'thermal80' },
    { address: '45 Ranganathan Street, T. Nagar', city: 'Chennai', pincode: '600017', upi: 'trendsfashion@upi', category: 'Garments' })
  await ownFields(['Size', 'Colour', 'Fabric'])
  const pcs = await unitId('pcs')
  const g5 = await rate('GST 5%')
  const g18 = await rate('GST 18%')
  const shirt = await api('createItem', item({ name: 'Men Cotton Shirt', hsn: '6205', tax: g5, incl: true, sale: 89_900, mrp: 99_900, unit: pcs, category: 'Men', own: ['M', 'Navy Blue', 'Cotton', ''] }))
  const kurti = await api('createItem', item({ name: 'Ladies Kurti', hsn: '6211', tax: g5, incl: true, sale: 79_900, mrp: 79_900, unit: pcs, category: 'Women', own: ['L', 'Maroon', 'Rayon', ''] }))
  const tee = await api('createItem', item({ name: 'Kids T-Shirt', hsn: '6109', tax: g5, incl: true, sale: 34_900, mrp: 39_900, unit: pcs, category: 'Kids', own: ['8-9 Y', 'Yellow', 'Cotton', ''] }))
  const saree = await api('createItem', item({ name: 'Kanchi Silk Saree', hsn: '5007', tax: g5, incl: true, sale: 450_000, mrp: 450_000, unit: pcs, category: 'Sarees', own: ['', 'Peacock Green', 'Silk', ''] }))
  const jeans = await api('createItem', item({ name: 'Slim Fit Jeans', code: 'JN-32-BLU', hsn: '6203', tax: g5, incl: true, sale: 129_900, mrp: 149_900, unit: pcs, category: 'Men', own: ['32', 'Dark Blue', 'Denim', ''] }))
  void g18
  // Barcodes for everything except the jeans, which keep their item code (printed as a QR code).
  const made = await api('assignBarcodes', [shirt.id, kurti.id, tee.id, saree.id])
  ok(S, made === 4, 'in-store barcodes created for 4 items')
  const items = Object.fromEntries((await api('listItems')).map((i) => [i.name, i]))
  await api('saveLabelDesign', design({ layout: 'roll-2x50x25', lines: ['name', 'own1', 'own2', 'price'] }))

  // Screens: settings for own fields, items list, item form, labels window.
  await reopen()
  await nav('Settings')
  await sleep(600)
  await clickText('Extra fields', '.report-nav')
  await sleep(700)
  await js(`[...document.querySelectorAll('h2, h3, .section-title')].find((h) => /own fields/i.test(h.innerText))?.scrollIntoView({ block: 'start' })`)
  await shot('clothing-own-fields')
  await nav('Items')
  await sleep(900)
  await shot('clothing-items')
  await js(`[...document.querySelectorAll('.table tbody tr')].find((r) => r.innerText.includes('Men Cotton Shirt'))?.click()`)
  await sleep(600)
  await clickText('Edit')
  await sleep(800)
  await js(`[...document.querySelectorAll('.modal .field-label')].find((l) => /barcode/i.test(l.innerText))?.scrollIntoView({ block: 'center' })`)
  await shot('clothing-item-form-barcode')
  await clickText('Cancel', '.modal')
  await sleep(400)
  await clickText('Print labels', '.toolbar')
  await sleep(500)
  await js(`for (const el of document.querySelectorAll('.modal .labels-items input.labels-qty')) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2'); el.dispatchEvent(new Event('input', { bubbles: true })) }`)
  await sleep(1500)
  await shot('clothing-labels-window')
  await clickText('Close', '.modal-foot')

  const tags = await labelsCheck(S, 'clothing-labels-barcode', {
    items: ['Men Cotton Shirt', 'Ladies Kurti', 'Kids T-Shirt', 'Kanchi Silk Saree'].map((n) => ({ itemId: items[n].id, copies: 2 })),
    options: { ...design({ layout: 'roll-2x50x25', lines: ['name', 'own1', 'own2', 'price'] }), skip: 0 }
  }, ['Men Cotton Shirt', 'Ladies Kurti', 'Kids T-Shirt', 'Kanchi Silk Saree'].map((n) => items[n].barcode), [])
  const tagHtml = await api('previewLabels', { items: [{ itemId: items['Men Cotton Shirt'].id, copies: 1 }], options: { ...design({ layout: 'roll-2x50x25', lines: ['name', 'own1', 'own2', 'price'] }), skip: 0 } })
  ok(S, tagHtml.includes('Size: M') && tagHtml.includes('Colour: Navy Blue'), 'size and colour printed on the tag')
  await labelsCheck(S, 'clothing-labels-qr', {
    items: [{ itemId: jeans.id, copies: 2 }, { itemId: items['Men Cotton Shirt'].id, copies: 1 }],
    options: { ...design({ layout: 'roll-50x25', symbol: 'qr', lines: ['name', 'own1', 'own2', 'price'] }), skip: 0 }
  }, [], ['JN-32-BLU', items['Men Cotton Shirt'].barcode])
  void tags

  // Billing by scanning: two shirts (scanned twice), a kurti, jeans by its QR (item code), a kids tee.
  await newSale()
  const notes = []
  for (const code of [items['Men Cotton Shirt'].barcode, items['Men Cotton Shirt'].barcode, items['Ladies Kurti'].barcode, 'JN-32-BLU', items['Kids T-Shirt'].barcode]) notes.push(await scan(code))
  ok(S, notes[1].includes('× 2'), `scanning the same shirt again adds one more ("${notes[1]}")`)
  ok(S, notes[3].includes('Slim Fit Jeans'), 'QR code (item code) found the jeans')
  const unknown = await scan('2999999999999')
  ok(S, /No item has/.test(unknown), `an unknown barcode is reported, not added ("${unknown}")`)
  await shot('clothing-scan-billing')
  await clickText('Save', '.page-head')
  const bill = await latestBill()
  const full = await api('getBill', 'SALE_INVOICE', bill.id)
  ok(S, full.lines.map((l) => `${l.itemName}×${l.qty / 1000}`).join(', ') === 'Men Cotton Shirt×2, Ladies Kurti×1, Slim Fit Jeans×1, Kids T-Shirt×1', `bill lines: ${full.lines.map((l) => `${l.itemName}×${l.qty / 1000}`).join(', ')}`)
  ok(S, full.grandTotal === 89_900 * 2 + 79_900 + 129_900 + 34_900 && full.status === 'paid', `walk-in total ₹${full.grandTotal / 100} at MRP, paid`)
  await printBoth(S, 'clothing', 'SALE_INVOICE', bill.id, 'TAX INVOICE')
}

// 1b. CLOTHING WHOLESALE: sets of 12, carton labels on A4 sheets, GST invoice to a shop in another state.
{
  const S = 'Clothing wholesale'
  await newBusiness('Test Tiruppur Knit Wholesale', '33', gstin('33', 'TKWPA2202B'), { pricesIncludeTax: false, paperSize: 'A4' },
    { address: 'SF 12, Avinashi Road', city: 'Tiruppur', pincode: '641602', type: 'Wholesale', category: 'Garments' })
  await ownFields(['Size range', 'Colour', 'Pack'])
  const f = await api('getFeatures')
  await api('saveFeatures', { ...f, transport: true })
  const pcs = await unitId('pcs')
  const dzn = await unitId('dzn')
  const g5 = await rate('GST 5%')
  const polo = await api('createItem', item({ name: 'Polo T-Shirt Assorted', hsn: '6105', tax: g5, sale: 32_000, wholesale: 28_000, wholesaleMin: 120_000, unit: pcs, alt: dzn, altConv: 12_000, open: 1_200_000, own: ['S-XXL', 'Assorted', '12 pcs/set'] }))
  const vest = await api('createItem', item({ name: 'Men Vest RN', hsn: '6109', tax: g5, sale: 9_500, wholesale: 8_500, wholesaleMin: 240_000, unit: pcs, alt: dzn, altConv: 12_000, open: 2_400_000, own: ['80-100', 'White', '12 pcs/box'] }))
  await api('assignBarcodes', [polo.id, vest.id])
  const items = Object.fromEntries((await api('listItems')).map((i) => [i.name, i]))
  const shop = await api('createParty', party({ name: 'Bengaluru Garments Retail', gstin: gstin('29', 'BGRPB2303C'), state: '29', address: 'Chickpet, Bengaluru', terms: 30 }))
  await api('saveLabelDesign', design({ layout: 'a4-24', lines: ['name', 'own1', 'own3', 'code'] }))
  await labelsCheck(S, 'wholesale-carton-labels', {
    items: [{ itemId: polo.id, copies: 6 }, { itemId: vest.id, copies: 6 }],
    options: { ...design({ layout: 'a4-24', lines: ['name', 'own1', 'own3', 'price'] }), skip: 0 }
  }, [items['Polo T-Shirt Assorted'].barcode, items['Men Vest RN'].barcode], [])
  await reopen()
  await newSale()
  await setValue('.editor-head select', shop.id)
  await sleep(500)
  await scan(items['Polo T-Shirt Assorted'].barcode)
  await scan(items['Men Vest RN'].barcode)
  // Wholesale: change scanned pieces to dozens: 10 dozen polos, 25 dozen vests.
  await js(`for (const [name, qty] of [['Polo T-Shirt Assorted', '10'], ['Men Vest RN', '25']]) {
    const row = [...document.querySelectorAll('.table.lines tbody tr')].find((r) => r.querySelector('input')?.value === name);
    const sel = row.querySelector('td:nth-child(5) select');
    const opt = [...sel.options].find((o) => o.text === 'dzn');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value); sel.dispatchEvent(new Event('change', { bubbles: true }));
  }`)
  await sleep(300)
  await setLineQty('Polo T-Shirt Assorted', '10')
  await setLineQty('Men Vest RN', '25')
  await sleep(500)
  await js(`const t = [...document.querySelectorAll('.field-label')].find((l) => /transport/i.test(l.innerText)); t?.scrollIntoView({ block: 'center' })`)
  await shot('wholesale-scan-billing')
  await clickText('Save', '.page-head')
  const bill = await latestBill()
  const full = await api('getBill', 'SALE_INVOICE', bill.id)
  ok(S, full.lines[0].unitShort === 'dzn' && full.lines[0].qty === 10_000 && full.lines[1].qty === 25_000, 'scanned items billed in dozens (10 dzn + 25 dzn)')
  ok(S, full.lines[0].rate === 28_000 * 12 && full.lines[1].rate === 8_500 * 12, 'wholesale price used for the dozens (₹280 and ₹85 a piece)')
  ok(S, full.supplyType === 'inter' && full.igst === Math.round((10 * 336_000 + 25 * 102_000) * 0.05), `IGST ₹${full.igst / 100} to a Karnataka shop`)
  ok(S, (await api('getItem', polo.id)).stockQty === 1_200_000 - 120_000, 'stock falls by 120 pieces of polo')
  await printBoth(S, 'wholesale', 'SALE_INVOICE', bill.id, 'TAX INVOICE')
}

// 2a. MALLIGAI KADAI: not GST-registered, packed staples with A4 sticker-sheet labels, small 58 mm bills.
{
  const S = 'Malligai kadai'
  await newBusiness('Test Sri Murugan Malligai', '33', '', { pricesIncludeTax: true, paperSize: 'thermal58' },
    { address: '7 East Masi Street', city: 'Madurai', pincode: '625001', category: 'Grocery' })
  const pkt = await unitId('pkt')
  const kg = await unitId('kg')
  const rice = await api('createItem', item({ name: 'Ponni Rice 1kg', sale: 6_200, unit: pkt, open: 100_000, category: 'Rice' }))
  const dal = await api('createItem', item({ name: 'Toor Dal 500g', sale: 7_800, unit: pkt, open: 60_000, category: 'Dal' }))
  const sugar = await api('createItem', item({ name: 'Sugar 1kg', sale: 4_600, unit: pkt, open: 80_000, category: 'Sugar' }))
  const tamarind = await api('createItem', item({ name: 'Tamarind 250g', sale: 5_500, unit: pkt, open: 40_000, category: 'Spices' }))
  const ghee = await api('createItem', item({ name: 'Ghee 200ml', code: 'GHEE200', sale: 15_500, mrp: 16_000, unit: pkt, open: 24_000, category: 'Oil & ghee' }))
  const loose = await api('createItem', item({ name: 'Groundnut (loose)', code: 'GNUT', sale: 14_000, unit: kg, open: 30_000, category: 'Loose' }))
  await api('assignBarcodes', [rice.id, dal.id, sugar.id, tamarind.id])
  const items = Object.fromEntries((await api('listItems')).map((i) => [i.name, i]))
  await api('saveLabelDesign', design({ layout: 'a4-65', header: 'none', lines: ['name', 'price'] }))
  await labelsCheck(S, 'malligai-sheet-labels', {
    items: ['Ponni Rice 1kg', 'Toor Dal 500g', 'Sugar 1kg', 'Tamarind 250g'].map((n) => ({ itemId: items[n].id, copies: 5 })),
    options: { ...design({ layout: 'a4-65', header: 'none', lines: ['name', 'price'] }), skip: 0 }
  }, ['Ponni Rice 1kg', 'Toor Dal 500g', 'Sugar 1kg', 'Tamarind 250g'].map((n) => items[n].barcode), [])
  await reopen()
  await newSale()
  for (const c of [items['Ponni Rice 1kg'].barcode, items['Ponni Rice 1kg'].barcode, items['Toor Dal 500g'].barcode, items['Sugar 1kg'].barcode, 'ghee200', 'GNUT']) await scan(c)
  await setLineQty('Groundnut (loose)', '0.75')
  await sleep(400)
  await shot('malligai-scan-billing')
  await clickText('Save', '.page-head')
  const bill = await latestBill()
  const full = await api('getBill', 'SALE_INVOICE', bill.id)
  ok(S, full.lines.some((l) => l.itemName === 'Ghee 200ml'), 'item code typed in small letters (ghee200) still found the ghee')
  ok(S, full.grandTotal === 6_200 * 2 + 7_800 + 4_600 + 15_500 + 10_500 && full.cgst + full.sgst + full.igst === 0, `total ₹${full.grandTotal / 100}, no GST (shop not registered)`)
  ok(S, (await api('getItem', loose.id)).stockQty === 30_000 - 750, 'loose groundnut: 750 g taken from stock')
  await waitFor('Print as')
  await clickText('Bill 58 mm', '.print-as')
  await sleep(900)
  await shot('malligai-bill-view-receipt')
  const receipt = await js(`return document.querySelector('iframe.invoice-preview').srcdoc`)
  await renderPng(receipt, 'malligai-receipt', 300, 1.15)
  ok(S, /58mm/.test(receipt) && !/TAX INVOICE/.test(receipt), 'small 58 mm bill, without "Tax invoice" (not registered)')
}

// 2b. SUPERMARKET: MRP and "you save" on shelf labels of a custom size, fast scanning, both prints.
{
  const S = 'Supermarket'
  await newBusiness('Test FreshMart Supermarket', '33', gstin('33', 'FRMPA2404D'), { pricesIncludeTax: true, paperSize: 'thermal80' },
    { address: '120 DB Road, RS Puram', city: 'Coimbatore', pincode: '641002', upi: 'freshmart@upi', category: 'Supermarket' })
  const pcs = await unitId('pcs')
  const g5 = await rate('GST 5%')
  const g18 = await rate('GST 18%')
  const nil = await rate('GST 0%')
  const list = [
    ['Marie Biscuits 250g', 3_000, 3_500, g5, '1905'], ['Herbal Shampoo 180ml', 16_500, 19_900, g18, '3305'], ['Detergent Powder 1kg', 11_500, 13_000, g18, '3402'],
    ['Wheat Atta 5kg', 24_900, 28_500, g5, '1101'], ['Toned Milk 500ml', 2_800, 2_800, nil, '0401'], ['Dark Chocolate 80g', 9_900, 12_000, g5, '1806']
  ]
  const ids = []
  for (const [name, sale, mrp, tax, hsn] of list) ids.push((await api('createItem', item({ name, sale, mrp, tax, hsn, incl: true, unit: pcs, open: 100_000, low: 10_000 }))).id)
  await api('assignBarcodes', ids)
  const items = Object.fromEntries((await api('listItems')).map((i) => [i.name, i]))
  const size = await api('saveLabelSize', null, 'Shelf strip 60 x 30', { width: 60, height: 30, across: 1, gap: 2 })
  ok(S, !!size.id, 'own label size "Shelf strip 60 x 30" saved')
  const shelf = design({ layout: 'roll-custom', custom: { width: 60, height: 30, across: 1, gap: 2 }, sizeId: size.id, header: 'business', lines: ['name', 'price', 'mrp', 'saving'] })
  await api('saveLabelDesign', shelf)
  await labelsCheck(S, 'supermarket-shelf-labels', { items: ids.map((id) => ({ itemId: id, copies: 1 })), options: { ...shelf, skip: 0 } }, ids.map((id) => Object.values(items).find((i) => i.id === id).barcode), [])
  const shelfHtml = await api('previewLabels', { items: [{ itemId: ids[1], copies: 1 }], options: { ...shelf, skip: 0 } })
  ok(S, shelfHtml.includes('MRP ₹199.00') && shelfHtml.includes('You save ₹34.00'), 'MRP and "You save ₹34.00" on the shelf label')
  await reopen()
  await nav('Items')
  await sleep(800)
  await clickText('Print labels', '.toolbar')
  await sleep(500)
  await js(`for (const el of document.querySelectorAll('.modal .labels-items input.labels-qty')) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '1'); el.dispatchEvent(new Event('input', { bubbles: true })) }`)
  await sleep(1500)
  await shot('supermarket-labels-window')
  await clickText('Change size', '.modal')
  await sleep(700)
  await shot('supermarket-custom-size')
  await js(`[...document.querySelectorAll('.modal')].at(-1).querySelector('.modal-foot .btn')?.click()`)
  await sleep(300)
  await clickText('Close', '.modal-foot')
  await newSale()
  for (const n of ['Marie Biscuits 250g', 'Marie Biscuits 250g', 'Marie Biscuits 250g', 'Herbal Shampoo 180ml', 'Detergent Powder 1kg', 'Wheat Atta 5kg', 'Toned Milk 500ml', 'Toned Milk 500ml', 'Dark Chocolate 80g']) await scan(items[n].barcode)
  await shot('supermarket-scan-billing')
  await clickText('Save', '.page-head')
  const bill = await latestBill()
  const full = await api('getBill', 'SALE_INVOICE', bill.id)
  const want = 3_000 * 3 + 16_500 + 11_500 + 24_900 + 2_800 * 2 + 9_900
  ok(S, full.lines.length === 6 && full.grandTotal === want, `9 scans became 6 lines, total ₹${full.grandTotal / 100} (₹${want / 100} expected)`)
  ok(S, full.lines.find((l) => l.itemName === 'Toned Milk 500ml').cgst === 0, 'milk carries no GST, the rest at their own rates')
  await printBoth(S, 'supermarket', 'SALE_INVOICE', bill.id, 'TAX INVOICE')
}

// 3a. GOLD COVERING: QR labels with design numbers, a counter bill and a GST bill (B2B) to a reseller.
{
  const S = 'Gold covering'
  await newBusiness('Test Lakshmi Gold Covering', '33', gstin('33', 'LGCPA2505E'), { pricesIncludeTax: true, paperSize: 'thermal80' },
    { address: '18 Big Bazaar Street', city: 'Tiruchirappalli', pincode: '620008', upi: 'lakshmigc@upi', category: 'Imitation jewellery' })
  await ownFields(['Design no.', 'Finish'])
  const pcs = await unitId('pcs')
  const set = await unitId('set')
  const g3 = await rate('GST 3%')
  const bangle = await api('createItem', item({ name: 'Covering Bangles (pair)', hsn: '7117', tax: g3, incl: true, sale: 45_000, mrp: 45_000, wholesale: 32_000, wholesaleMin: 12_000, unit: pcs, open: 120_000, own: ['D-101', 'Micro gold'] }))
  const neck = await api('createItem', item({ name: 'Temple Necklace Set', hsn: '7117', tax: g3, incl: true, sale: 185_000, mrp: 185_000, wholesale: 140_000, wholesaleMin: 6_000, unit: set, open: 30_000, own: ['D-220', 'Antique'] }))
  const chain = await api('createItem', item({ name: 'One Gram Chain 24in', code: 'GC-C24', hsn: '7117', tax: g3, incl: true, sale: 65_000, mrp: 65_000, unit: pcs, open: 50_000, own: ['D-305', '1 gram gold'] }))
  await api('assignBarcodes', [bangle.id, neck.id])
  const items = Object.fromEntries((await api('listItems')).map((i) => [i.name, i]))
  const qrDesign = design({ layout: 'roll-2x38x25', symbol: 'qr', header: 'none', lines: ['name', 'own1', 'price'] })
  await api('saveLabelDesign', qrDesign)
  await labelsCheck(S, 'goldcovering-qr-labels', {
    items: [{ itemId: bangle.id, copies: 2 }, { itemId: neck.id, copies: 2 }, { itemId: chain.id, copies: 2 }], options: { ...qrDesign, skip: 0 }
  }, [], [items['Covering Bangles (pair)'].barcode, items['Temple Necklace Set'].barcode, 'GC-C24'])
  const qrHtml = await api('previewLabels', { items: [{ itemId: neck.id, copies: 1 }], options: { ...qrDesign, skip: 0 } })
  ok(S, qrHtml.includes('>D-220<'), 'design number D-220 printed on the QR label (value alone: the name is long)')
  const reseller = await api('createParty', party({ name: 'Sri Devi Fancy Stores', gstin: gstin('33', 'SDFPB2606F'), state: '33', address: 'Main Road, Karur', terms: 15 }))
  await reopen()
  // Counter bill from QR scans.
  await newSale()
  for (const c of [items['Covering Bangles (pair)'].barcode, items['Temple Necklace Set'].barcode, 'GC-C24']) await scan(c)
  await shot('goldcovering-scan-billing')
  await clickText('Save', '.page-head')
  const counter = await latestBill()
  ok(S, counter.grandTotal === 45_000 + 185_000 + 65_000, `counter bill ₹${counter.grandTotal / 100} at MRP`)
  await printBoth(S, 'goldcovering', 'SALE_INVOICE', counter.id, 'TAX INVOICE')
  // GST bill (B2B) to a reseller at the wholesale price, scanned then quantity typed.
  await newSale()
  await setValue('.editor-head select', reseller.id)
  await sleep(400)
  await scan(items['Covering Bangles (pair)'].barcode)
  await scan(items['Temple Necklace Set'].barcode)
  await setLineQty('Covering Bangles (pair)', '24')
  await setLineQty('Temple Necklace Set', '6')
  await sleep(500)
  await shot('goldcovering-gst-bill-editor')
  await clickText('Save', '.page-head')
  const b2b = await latestBill()
  const full = await api('getBill', 'SALE_INVOICE', b2b.id)
  ok(S, full.lines[0].rate === 32_000 && full.lines[1].rate === 140_000, 'reseller gets the wholesale price from 12 pairs / 6 sets')
  ok(S, full.party.gstin === reseller.gstin && full.cgst > 0 && Math.abs(full.cgst - full.sgst) <= 1, `GST bill with the reseller's GSTIN, CGST ₹${full.cgst / 100} + SGST ₹${full.sgst / 100}`)
  await waitFor('Print as')
  await clickText('Invoice A4', '.print-as')
  await sleep(900)
  await shot('goldcovering-gst-bill-view')
  const inv = await js(`return document.querySelector('iframe.invoice-preview').srcdoc`)
  await renderPng(inv, 'goldcovering-gst-invoice', 860, 1)
  ok(S, inv.includes(reseller.gstin) && /HSN|7117/.test(inv), 'A4 GST bill shows buyer GSTIN and HSN 7117')
}

// 3b. FOOD SHOP (sweets and snacks): labels with packing and best-before dates typed per batch, counter billing.
{
  const S = 'Food shop'
  await newBusiness('Test Annapoorna Sweets', '33', gstin('33', 'ANSPA2707G'), { pricesIncludeTax: true, paperSize: 'thermal58' },
    { address: '3 Car Street', city: 'Tirunelveli', pincode: '627006', upi: 'annapoorna@upi', category: 'Sweets and snacks' })
  const pcs = await unitId('pcs')
  const box = await unitId('box')
  const kg = await unitId('kg')
  const g5 = await rate('GST 5%')
  const halwa = await api('createItem', item({ name: 'Tirunelveli Halwa 500g box', hsn: '1704', tax: g5, incl: true, sale: 30_000, unit: box, open: 40_000 }))
  const mixture = await api('createItem', item({ name: 'Kara Mixture 250g', hsn: '2106', tax: g5, incl: true, sale: 9_000, unit: pcs, open: 60_000 }))
  const mysore = await api('createItem', item({ name: 'Mysore Pak (loose)', code: 'MPAK', hsn: '1704', tax: g5, incl: true, sale: 64_000, unit: kg, open: 15_000 }))
  await api('assignBarcodes', [halwa.id, mixture.id])
  const items = Object.fromEntries((await api('listItems')).map((i) => [i.name, i]))
  const foodLabel = design({ layout: 'roll-50x25', header: 'business', lines: ['name', 'price', 'mfg', 'exp'] })
  await api('saveLabelDesign', foodLabel)
  const req = {
    items: [
      { itemId: halwa.id, copies: 3, extra: { mfg: `${today.slice(0, 7)}-${today.slice(8)}`, exp: `${today.slice(0, 7)}` } },
      { itemId: mixture.id, copies: 3, extra: { mfg: `${today.slice(0, 7)}-${today.slice(8)}`, exp: `${today.slice(0, 7)}` } }
    ],
    options: { ...foodLabel, skip: 0 }
  }
  await labelsCheck(S, 'food-labels', req, [items['Tirunelveli Halwa 500g box'].barcode, items['Kara Mixture 250g'].barcode], [])
  const foodHtml = await api('previewLabels', req)
  ok(S, /Mfg: \d{2}\/\d{2}\/\d{4}/.test(foodHtml) && /Exp: \d{2}\/\d{4}/.test(foodHtml), 'packing date and best-before printed on each packet label')
  await reopen()
  await nav('Items')
  await sleep(800)
  await clickText('Print labels', '.toolbar')
  await sleep(500)
  await js(`for (const el of document.querySelectorAll('.modal .labels-items input.labels-qty')) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2'); el.dispatchEvent(new Event('input', { bubbles: true })) }`)
  await sleep(1500)
  await shot('food-labels-window')
  await clickText('Close', '.modal-foot')
  await newSale()
  for (const c of [items['Tirunelveli Halwa 500g box'].barcode, items['Tirunelveli Halwa 500g box'].barcode, items['Kara Mixture 250g'].barcode, 'MPAK']) await scan(c)
  await setLineQty('Mysore Pak (loose)', '0.25')
  await sleep(400)
  await shot('food-scan-billing')
  await clickText('Save', '.page-head')
  const bill = await latestBill()
  ok(S, bill.grandTotal === 30_000 * 2 + 9_000 + 16_000, `counter bill ₹${bill.grandTotal / 100} (2 halwa boxes, mixture, 250 g Mysore pak)`)
  await printBoth(S, 'food', 'SALE_INVOICE', bill.id, 'TAX INVOICE')
}

// ---------- General screens for the guide ----------
{
  await nav('Settings')
  await sleep(600)
  await clickText('Preferences', '.report-nav')
  await sleep(700)
  await shot('settings-preferences')
  await clickText('Print', '.report-nav')
  await sleep(1500)
  await shot('settings-print')
  await clickText('Business', '.report-nav')
  await sleep(700)
  await shot('settings-business')
}

const failed = results.filter((r) => !r.ok)
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2))
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
for (const f of failed) console.log(`FAILED ${f.shop}: ${f.check}`)
const demo = (await api('listBusinesses')).find((b) => b.name === 'Sunrise Traders')
if (demo) await api('openBusiness', demo.id)
await evaluate('location.reload()')
app.close()
