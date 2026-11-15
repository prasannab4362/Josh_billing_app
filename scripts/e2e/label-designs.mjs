// Label designs: prints every design (with a barcode and with a QR code) for a test garment shop whose items
// are numbered like its old tags (472-00001~1), reads every printed code back, and bills by scanning one.
// Pictures go to <out>/designs; docs/setup-guide uses them.
// Usage: node scripts/e2e/label-designs.mjs <output folder>   (start the app first; needs Python + OpenCV)
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connect, mainEval, sleep, stubDialogs } from './harness.mjs'

const out = resolve(process.argv[2] ?? 'e2e-out', 'designs')
mkdirSync(out, { recursive: true })
const app = await connect(out)
const { evaluate, check } = app
await stubDialogs(resolve(process.argv[2] ?? 'e2e-out'))
const results = []
const ok = (cond, msg) => {
  check(cond, msg)
  results.push({ check: msg, ok: !!cond })
}
const api = (method, ...args) => evaluate(`window.api.${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
const js = (body) => evaluate(`(async () => { ${body} })()`)
const today = await js(`const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)`)

async function renderPng(html, file, width, zoom) {
  const data = await mainEval(`globalThis.__E = require('electron'), (async () => {
    const w = new __E.BrowserWindow({ show: false, width: ${width}, height: 900, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true } })
    try {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(html)}))
      await w.webContents.executeJavaScript("document.documentElement.style.zoom = '${zoom}'")
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
/** Cut the empty white space under (and beside) the labels, for the guide's pictures. */
const TRIM = [
  'import cv2,sys',
  'for p in sys.argv[1:]:',
  '  i=cv2.imread(p); g=cv2.cvtColor(i,cv2.COLOR_BGR2GRAY); ys,xs=(g<245).nonzero()',
  '  if len(xs): cv2.imwrite(p, i[max(0,ys.min()-12):ys.max()+12, max(0,xs.min()-12):xs.max()+12])'
].join('\n')
const trim = (paths) => execFileSync('python', ['-I', '-c', TRIM, ...paths])
const readCodes = (paths) => JSON.parse(execFileSync('python', ['-I', resolve('scripts/e2e/read-codes.py'), ...paths], { encoding: 'utf8', maxBuffer: 1 << 24 }))

// ---------- A test garment shop like the client's ----------
const name = `Test Only Garments ${Date.now() % 1000}`
await api('createBusiness', {
  profile: { name, legalName: '', gstin: '', pan: '', stateCode: '33', address: 'Bazaar Street', city: 'Chennai', pincode: '600001', phone: '9000000077',
    email: '', businessType: 'Retail', category: 'Garments', fyStartMonth: 4 },
  preferences: { gstRegistered: false, pricesIncludeTax: true, paperSize: 'thermal80', roundOff: true }, bankAccount: null
})
const f = await api('getFeatures')
await api('saveFeatures', { ...f, itemFields: f.itemFields.map((x, i) => (i === 0 ? { on: true, label: 'Size', print: true } : i === 1 ? { on: true, label: 'Colour', print: true } : { ...x, on: false })) })
const pcs = (await api('listUnits')).find((u) => u.short === 'pcs').id
const item = (n, sale, mrp, own) => ({
  name: n, code: '', kind: 'goods', category: 'Bags', hsnSac: '4202', taxRateId: null, priceIncludesTax: true, salePrice: sale, purchasePrice: Math.round(sale * 0.6),
  mrp, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: pcs, altUnitId: null, altConversion: null, trackStock: true, openingQty: 20_000,
  openingRate: Math.round(sale * 0.6), openingDate: today, lowStockQty: null, barcode: '', customFields: own
})
// Numbering like the client's tags.
const fmt = await api('saveCodeFormat', { kind: 'pattern', prefix: '472-', digits: 5, suffix: '~1' })
ok(fmt.kind === 'pattern', 'own numbering 472- + 5 digits + ~1 saved')
const bag = await api('createItem', item('Swami Jolna Bag', 123_000, 149_900, ['Free size', 'Maroon']))
const kurti = await api('createItem', item('Cotton Kurti', 79_900, 89_900, ['L', 'Blue']))
const n = await api('assignBarcodes', [bag.id, kurti.id])
const codes = [(await api('getItem', bag.id)).barcode, (await api('getItem', kurti.id)).barcode]
ok(n === 2 && codes[0] === '472-00001~1' && codes[1] === '472-00002~1', `Create barcodes gave ${codes.join(', ')}`)
const typed = await api('generateBarcode')
ok(typed === '472-00003~1', `Create (item form) offers the next number ${typed}`)

// ---------- Every design, with a barcode and a QR code ----------
const STYLES = ['classic', 'garment', 'priceTag', 'shelf', 'boxed', 'jewellery', 'codeOnly', 'food']
const sizeFor = { jewellery: 'roll-jewel-100x15', shelf: 'roll-2x50x25', garment: 'roll-2x50x38', priceTag: 'roll-2x50x38', food: 'roll-2x50x38', codeOnly: 'roll-2x50x25' }
const widthMm = { 'roll-2x50x25': 102, 'roll-2x50x38': 102, 'roll-jewel-100x15': 100 }
const lines = (style) => (style === 'jewellery'
  ? [{ field: 'name', text: '' }, { field: 'own1', text: '' }, { field: 'price', text: '' }, { field: 'none', text: '' }]
  : style === 'food'
    ? [{ field: 'name', text: '' }, { field: 'price', text: '' }, { field: 'none', text: '' }, { field: 'none', text: '' }]
    : [{ field: 'name', text: '' }, { field: 'own1', text: '' }, { field: 'price', text: '' }, { field: 'mrp', text: '' }])
const pictures = []
for (const style of STYLES) {
  for (const symbol of ['barcode', 'qr']) {
    const layout = sizeFor[style] ?? 'roll-2x50x38'
    const options = { layout, custom: { width: 50, height: 25, across: 1, gap: 2 }, style, symbol, showCode: true, header: { field: 'business', text: '' }, lines: lines(style), skip: 0 }
    const extra = style === 'food' ? { mfg: today, exp: `${Number(today.slice(0, 4)) + 1}${today.slice(4, 7)}` } : undefined
    const req = { items: [{ itemId: bag.id, copies: 1, extra }, { itemId: kurti.id, copies: 1, extra }], options }
    const html = await api('previewLabels', req)
    ok(html.includes('class="label') && !html.includes('undefined'), `${style} / ${symbol}: labels drawn`)
    const zoom = 4
    const width = Math.ceil(widthMm[layout] * 3.78 * zoom) + 60
    pictures.push({ style, symbol, path: await renderPng(html, `${style}-${symbol}`, width, zoom) })
    // A smaller copy for the guide.
    trim([await renderPng(html, `guide-${style}-${symbol}`, Math.ceil(widthMm[layout] * 3.78 * 2.2) + 30, 2.2)])
  }
}
const read = readCodes(pictures.map((p) => p.path))
for (const p of pictures) {
  const got = read[p.path]
  const all = new Set([...(got.barcodes ?? []), ...(got.qr ?? []), ...(got.code128 ?? [])])
  ok(codes.every((c) => all.has(c)), `${p.style} / ${p.symbol}: both printed codes scan back (${[...all].join(', ') || 'none read'})`)
}

// ---------- The labels window: design picker and numbering ----------
await evaluate('location.reload()')
await sleep(2500)
await js(`[...document.querySelectorAll('.sidebar .nav')].find((b) => b.innerText.trim().startsWith('Items')).click()`)
await sleep(900)
await js(`[...document.querySelectorAll('.toolbar button')].find((b) => b.innerText.includes('Print labels')).click()`)
await sleep(600)
await js(`for (const el of document.querySelectorAll('.modal .labels-items input.labels-qty')) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2'); el.dispatchEvent(new Event('input', { bubbles: true })) }`)
await js(`[...document.querySelectorAll('.label-style')].find((b) => b.innerText.includes('Garment tag')).click()`)
await js(`[...document.querySelectorAll('.modal .seg button')].find((b) => b.innerText.trim() === 'QR code').click()`)
await js(`const s = document.querySelector('.modal select.input'); const o = [...s.options].find((x) => x.text.includes('50 × 38')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true }))`)
await sleep(1800)
await app.shot('labels-window-designs')
await js(`document.querySelector('.code-format')?.scrollIntoView({ block: 'center' })`)
await sleep(500)
await app.shot('labels-window-numbering')
const saved = await api('getLabelDesign')
ok(saved.style === 'garment' && saved.symbol === 'qr', 'chosen design (Garment tag, QR) is remembered')
await js(`[...document.querySelectorAll('.modal-foot button')].find((b) => b.innerText.trim() === 'Close').click()`)

// ---------- Billing by scanning the client-style code ----------
await js(`[...document.querySelectorAll('.sidebar .nav')].find((b) => b.innerText.trim().startsWith('Sale')).click()`)
await sleep(800)
await js(`[...document.querySelectorAll('.page-head button')].find((b) => b.innerText.includes('New invoice')).click()`)
await sleep(1500)
const scan = async (code) => {
  await js(`const el = document.querySelector('input[aria-label="Scan barcode"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(code)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await sleep(300)
  return js(`return document.querySelector('.scan-box span')?.innerText ?? ''`)
}
const n1 = await scan('472-00001~1')
const n2 = await scan('472-00001~1')
const n3 = await scan('472-00002~1')
ok(/Swami Jolna Bag/.test(n1) && /× 2/.test(n2) && /Cotton Kurti/.test(n3), `scanning 472-00001~1 twice and 472-00002~1: "${n1}" / "${n2}" / "${n3}"`)
await app.shot('scan-billing-472')
await js(`[...document.querySelectorAll('.page-head button')].find((b) => b.innerText.trim().startsWith('Save')).click()`)
await sleep(1500)
const bill = (await api('listBills', 'SALE_INVOICE', {}))[0]
ok(bill.grandTotal === 123_000 * 2 + 79_900, `bill saved: ₹${bill.grandTotal / 100}`)

const failed = results.filter((r) => !r.ok)
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2))
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
for (const x of failed) console.log(`FAILED ${x.check}`)
app.close()
