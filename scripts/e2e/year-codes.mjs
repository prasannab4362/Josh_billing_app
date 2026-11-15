// Year-letter barcode numbers with sizes (EE-00001~1, ~2, ~3): sets the numbering in the real labels window, adds
// sizes through the item's "Add sizes" window, prints garment tags with a barcode and a QR code, reads every printed
// code back, and bills by scanning. Pictures go to <out>/yearcodes; docs/setup-guide uses them.
// Usage: node scripts/e2e/year-codes.mjs <output folder>   (start the app first; needs Python + OpenCV)
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connect, mainEval, sleep, stubDialogs } from './harness.mjs'

const out = resolve(process.argv[2] ?? 'e2e-out', 'yearcodes')
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
const setVal = (selector, value) => js(`const el = ${selector}; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))`)
const clickText = (selector, text) => js(`const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.innerText.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error('no ' + ${JSON.stringify(text)}); b.click()`)
const today = await js(`const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)`)
const fy = (() => {
  const [y, m] = today.split('-').map(Number)
  const s = m >= 4 ? y : y - 1
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`
})()

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
const TRIM = [
  'import cv2,sys',
  'for p in sys.argv[1:]:',
  '  i=cv2.imread(p); g=cv2.cvtColor(i,cv2.COLOR_BGR2GRAY); ys,xs=(g<245).nonzero()',
  '  if len(xs): cv2.imwrite(p, i[max(0,ys.min()-12):ys.max()+12, max(0,xs.min()-12):xs.max()+12])'
].join('\n')
const trim = (paths) => execFileSync('python', ['-I', '-c', TRIM, ...paths])
const readCodes = (paths) => JSON.parse(execFileSync('python', ['-I', resolve('scripts/e2e/read-codes.py'), ...paths], { encoding: 'utf8', maxBuffer: 1 << 24 }))

// ---------- A test textile shop ----------
const name = `Test Only Textiles ${Date.now() % 1000}`
await api('createBusiness', {
  profile: { name, legalName: '', gstin: '', pan: '', stateCode: '33', address: 'Bazaar Street', city: 'Chennai', pincode: '600001', phone: '9000000078',
    email: '', businessType: 'Retail', category: 'Garments', fyStartMonth: 4 },
  preferences: { gstRegistered: false, pricesIncludeTax: true, paperSize: 'thermal80', roundOff: true }, bankAccount: null
})
const f = await api('getFeatures')
await api('saveFeatures', { ...f, itemFields: f.itemFields.map((x, i) => (i === 0 ? { on: true, label: 'Size', print: true } : i === 1 ? { on: true, label: 'Colour', print: true } : { ...x, on: false })) })
const pcs = (await api('listUnits')).find((u) => u.short === 'pcs').id
const item = (n, sale, mrp, own) => ({
  name: n, code: '', kind: 'goods', category: 'Kurtis', hsnSac: '6204', taxRateId: null, priceIncludesTax: true, salePrice: sale, purchasePrice: Math.round(sale * 0.6),
  mrp, wholesalePrice: null, wholesaleMinQty: null, baseUnitId: pcs, altUnitId: null, altConversion: null, trackStock: true, openingQty: 10_000,
  openingRate: Math.round(sale * 0.6), openingDate: today, lowStockQty: null, barcode: '', customFields: own
})
const kurti = await api('createItem', item('Cotton Kurti', 79_900, 89_900, ['S', 'Blue', '', '']))
const saree = await api('createItem', item('Silk Saree', 249_900, 299_900, ['Free size', 'Red', '', '']))

await evaluate('location.reload()')
await sleep(2500)
await clickText('.sidebar .nav', 'Items')
await sleep(900)

// ---------- Year letters chosen in the labels window ----------
await clickText('.toolbar button', 'Print labels')
await sleep(700)
await clickText('.modal .code-format .seg button', 'Year letters')
await sleep(200)
await setVal(`document.querySelector('.modal input[aria-label="Year letters"]')`, 'ee')
await sleep(300)
const hint = await js(`return document.querySelector('.modal .code-format').innerText`)
ok(hint.includes('EE-00001~1') && hint.includes(`(${fy}) codes start with EE`) && /next year .* with EF/.test(hint), `numbering box shows EE this year and EF next year: ${hint.replace(/\s+/g, ' ').slice(0, 160)}`)
await js(`document.querySelector('.code-format')?.scrollIntoView({ block: 'center' })`)
await sleep(300)
await app.shot('numbering-year-letters')
await clickText('.modal .code-format button', 'Save numbering')
await sleep(500)
const fmt = await api('getCodeFormat')
ok(fmt.kind === 'yearly' && fmt.startCode === 'EE' && fmt.startFy === fy && fmt.sizeNumbers && !fmt.restartEachYear, `saved: ${JSON.stringify(fmt)}`)
await clickText('.modal-foot button', 'Close')
await sleep(300)

const n = await api('assignBarcodes', [kurti.id, saree.id])
const kCode = (await api('getItem', kurti.id)).barcode
const sCode = (await api('getItem', saree.id)).barcode
ok(n === 2 && kCode === 'EE-00001~1' && sCode === 'EE-00002~1', `Create barcodes gave ${kCode}, ${sCode}`)

// ---------- Add sizes through the item page ----------
await evaluate('location.reload()')
await sleep(2500)
await clickText('.sidebar .nav', 'Items')
await sleep(900)
await js(`[...document.querySelectorAll('tr.clickable')].find((r) => r.innerText.startsWith('Cotton Kurti')).click()`)
await sleep(500)
await clickText('.detail-head button', 'Add sizes')
await sleep(500)
for (const s of ['M', 'L', 'XL']) await clickText('.modal .chips button', s)
await sleep(200)
await setVal(`document.querySelector('.modal input[aria-label="Price 3"]')`, '849')
await sleep(300)
await app.shot('add-sizes-window')
await clickText('.modal-foot button', 'Add 3 sizes')
await sleep(1200)
const banner = await js(`return document.querySelector('.banner')?.innerText ?? ''`)
const all = await api('listItems')
const sized = ['M', 'L', 'XL'].map((s) => all.find((i) => i.name === `Cotton Kurti (${s})`))
ok(sized.every(Boolean), `three size items made: ${sized.map((i) => i?.name).join(', ')}`)
ok(sized.map((i) => i?.barcode).join() === 'EE-00001~2,EE-00001~3,EE-00001~4', `sizes share product number 00001: ${sized.map((i) => i?.barcode).join(', ')}`)
ok(sized.map((i) => i?.customFields?.[0]).join() === 'M,L,XL' && sized.every((i) => i?.customFields?.[1] === 'Blue'), 'Size field filled, colour copied')
ok(sized[2]?.salePrice === 84_900 && sized[0]?.salePrice === 79_900, 'XL has its own price ₹849, others ₹799')
ok(/Added Cotton Kurti \(M\)/.test(banner), `message: ${banner}`)
await app.shot('sizes-added')
const next = await api('generateBarcode')
ok(next === 'EE-00003~1', `next new product is ${next} (sizes do not use up product numbers)`)

// ---------- Garment tags for every size, barcode and QR; read them back ----------
const tagIds = [kurti.id, ...sized.map((i) => i.id), saree.id]
const wanted = ['EE-00001~1', 'EE-00001~2', 'EE-00001~3', 'EE-00001~4', 'EE-00002~1']
const pictures = []
for (const symbol of ['barcode', 'qr']) {
  const options = {
    layout: 'roll-2x50x38', custom: { width: 50, height: 25, across: 1, gap: 2 }, style: 'garment', symbol, showCode: true,
    header: { field: 'business', text: '' }, lines: [{ field: 'name', text: '' }, { field: 'own1', text: '' }, { field: 'own2', text: '' }, { field: 'price', text: '' }], skip: 0
  }
  const html = await api('previewLabels', { items: tagIds.map((itemId) => ({ itemId, copies: 1 })), options })
  ok(wanted.every((c) => html.includes(c)), `${symbol}: all five codes on the tags`)
  pictures.push({ symbol, path: await renderPng(html, `tags-${symbol}`, Math.ceil(102 * 3.78 * 4) + 60, 4) })
  trim([await renderPng(html, `guide-tags-${symbol}`, Math.ceil(102 * 3.78 * 2.2) + 30, 2.2)])
}
const read = readCodes(pictures.map((p) => p.path))
for (const p of pictures) {
  const got = read[p.path]
  const seen = new Set([...(got.barcodes ?? []), ...(got.qr ?? []), ...(got.code128 ?? [])])
  ok(wanted.every((c) => seen.has(c)), `${p.symbol}: every printed code scans back (${[...seen].sort().join(', ') || 'none read'})`)
}

// ---------- Billing by scanning: two sizes of one product are told apart ----------
await clickText('.sidebar .nav', 'Sale')
await sleep(800)
await clickText('.page-head button', 'New invoice')
await sleep(1500)
const scan = async (code) => {
  await js(`const el = document.querySelector('input[aria-label="Scan barcode"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(code)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await sleep(350)
  return js(`return document.querySelector('.scan-box span')?.innerText ?? ''`)
}
const s1 = await scan('EE-00001~1')
const s2 = await scan('EE-00001~4')
const s3 = await scan('EE-00001~4')
const s4 = await scan('EE-00002~1')
ok(/Cotton Kurti$|Cotton Kurti\b(?! \()/.test(s1) && /Cotton Kurti \(XL\)/.test(s2) && /× 2/.test(s3) && /Silk Saree/.test(s4), `scans: "${s1}" / "${s2}" / "${s3}" / "${s4}"`)
await app.shot('scan-billing-sizes')
await clickText('.page-head button', 'Save')
await sleep(1500)
const bill = (await api('listBills', 'SALE_INVOICE', {}))[0]
ok(bill.grandTotal === 79_900 + 84_900 * 2 + 249_900, `bill: S ₹799 + XL ₹849 × 2 + saree ₹2,499 = ₹${bill.grandTotal / 100}`)
const xl = await api('getItem', sized[2].id)
ok(xl.stockQty === -2_000, `stock is kept per size: XL went to ${xl.stockQty / 1000}`)

const failed = results.filter((r) => !r.ok)
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2))
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
for (const x of failed) console.log(`FAILED ${x.check}`)
for (const l of app.log) console.log(l)
app.close()
