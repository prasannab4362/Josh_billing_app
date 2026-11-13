// Logo and signature: uploads both through Settings › Business (the real buttons, as a file would be picked),
// then checks they print on the A4 and A5 invoice and on 80 mm and 58 mm bills, with the signature on small
// bills only when "Signature on small (thermal) bills too" is switched on. Saves pictures for the guide.
// Usage: node scripts/e2e/logo-signature.mjs <output folder>   (start the app and run shop-tour.mjs first)
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connect, mainEval, sleep, stubDialogs } from './harness.mjs'

const outRoot = resolve(process.argv[2] ?? 'e2e-out')
const out = `${outRoot}/logo`
mkdirSync(out, { recursive: true })
const app = await connect(out)
const { evaluate, check } = app
await stubDialogs(outRoot)
const results = []
const ok = (cond, msg) => {
  check(cond, msg)
  results.push({ check: msg, ok: !!cond })
}
const js = (body) => evaluate(`(async () => { ${body} })()`)
const api = (method, ...args) => evaluate(`window.api.${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
const nav = (page) => js(`[...document.querySelectorAll('.sidebar .nav')].find((b) => b.innerText.trim().startsWith(${JSON.stringify(page)})).click()`)
const clickText = (text, scope = '') =>
  js(`const b = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((x) => x.innerText.trim() === ${JSON.stringify(text)} || x.innerText.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click()`)

async function renderPng(html, file, width, zoom = 1) {
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
  writeFileSync(`${out}/${file}.png`, Buffer.from(data.split(',')[1], 'base64'))
}

// Open the clothing shop made by shop-tour.mjs (it has a saved bill and a UPI account).
const biz = (await api('listBusinesses')).filter((b) => b.name.startsWith('Test Trends Fashion')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
if (!biz) throw new Error('Run scripts/e2e/shop-tour.mjs first')
await api('openBusiness', biz.id)
await evaluate('location.reload()')
await sleep(2500)
// Start without pictures, as a new shop would.
await api('setBusinessImage', 'logo', null)
await api('setBusinessImage', 'signature', null)
const startPrint = await api('getPrintSettings')
await api('savePrintSettings', { ...startPrint, show: { ...startPrint.show, logo: true, signature: true, signatureOnBill: false } })

// Made-up pictures drawn in the page: a 1200 × 600 logo (PNG) and a signature photographed on white paper,
// 1600 × 600 JPEG with no file type and a .jpg name, as some phones send it.
await js(`
  const logo = document.createElement('canvas'); logo.width = 1200; logo.height = 600
  let g = logo.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 600)
  const grad = g.createLinearGradient(0, 0, 600, 600); grad.addColorStop(0, '#7c3aed'); grad.addColorStop(1, '#db2777')
  g.fillStyle = grad; g.beginPath(); g.arc(300, 300, 240, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#fff'; g.font = 'bold 230px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TF', 300, 315)
  g.fillStyle = '#3b0764'; g.textAlign = 'left'; g.font = 'bold 150px Georgia'; g.fillText('Trends', 590, 250)
  g.font = '80px Georgia'; g.fillStyle = '#6b21a8'; g.fillText('FASHION', 600, 400)
  const sign = document.createElement('canvas'); sign.width = 1600; sign.height = 600
  g = sign.getContext('2d')
  g.fillStyle = '#f7f6f2'; g.fillRect(0, 0, 1600, 600)
  g.strokeStyle = '#1e3a8a'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round'
  g.beginPath(); g.moveTo(180, 380)
  g.bezierCurveTo(260, 120, 340, 120, 330, 330); g.bezierCurveTo(320, 470, 420, 230, 480, 300)
  g.bezierCurveTo(540, 370, 560, 220, 640, 300); g.bezierCurveTo(700, 360, 720, 250, 800, 290)
  g.bezierCurveTo(880, 330, 900, 180, 980, 260); g.bezierCurveTo(1060, 340, 1100, 300, 1180, 280)
  g.bezierCurveTo(1260, 260, 1320, 330, 1420, 250); g.stroke()
  g.lineWidth = 8; g.beginPath(); g.moveTo(240, 440); g.bezierCurveTo(600, 400, 1000, 470, 1380, 420); g.stroke()
  const blob = (c, type) => new Promise((r) => c.toBlob(r, type, 0.9))
  window.__files = {
    logo: new File([await blob(logo, 'image/png')], 'trends-logo.png', { type: 'image/png' }),
    sign: new File([await blob(sign, 'image/jpeg')], 'signature-photo.jpg', { type: '' })
  }
  // Answer the next "choose a file" window with the queued picture, as if the owner picked it.
  if (!window.__clickPatched) {
    const click = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file' && window.__nextFile) {
        const dt = new DataTransfer(); dt.items.add(window.__nextFile); window.__nextFile = null
        this.files = dt.files
        setTimeout(() => this.dispatchEvent(new Event('change')), 50)
        return
      }
      return click.call(this)
    }
    window.__clickPatched = true
  }
`)

await nav('Settings')
await sleep(600)
await clickText('Business', '.report-nav')
await sleep(700)
await app.shot('business-no-pictures')
await js(`window.__nextFile = window.__files.logo; document.querySelector('button[title="Upload logo"]').click()`)
await sleep(1800)
await js(`window.__nextFile = window.__files.sign; document.querySelector('button[title="Upload signature"]').click()`)
await sleep(1800)
const b = await api('currentBusiness')
ok(b.logo.startsWith('data:image/png;base64,'), 'logo uploaded through Settings › Business and kept as a PNG')
ok(b.signature.startsWith('data:image/png;base64,'), 'signature photo (JPEG with no file type) uploaded and kept as a PNG')
const dims = await js(`
  const size = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src })
  return { logo: await size(${JSON.stringify(b.logo)}), sign: await size(${JSON.stringify(b.signature)}) }`)
ok(dims.logo[0] <= 600 && dims.logo[1] <= 300, `logo shrunk to fit 600 × 300 (now ${dims.logo.join(' × ')})`)
ok(dims.sign[0] <= 500 && dims.sign[1] <= 160, `signature shrunk to fit 500 × 160 (now ${dims.sign.join(' × ')})`)
const ink = await js(`
  const i = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = ${JSON.stringify(b.signature)} })
  const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight
  const g = c.getContext('2d'); g.drawImage(i, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data
  let clear = 0, solid = 0
  for (let k = 3; k < d.length; k += 4) { if (d[k] === 0) clear++; else if (d[k] > 200) solid++ }
  return { clear: clear / (d.length / 4), solid, corner: d[3] }`)
ok(ink.corner === 0 && ink.clear > 0.7 && ink.solid > 100, `signature paper removed: ${Math.round(ink.clear * 100)}% transparent, ${ink.solid} solid ink pixels`)
ok(b.logo.length < 400_000 && b.signature.length < 400_000, `pictures kept small inside the business file (${Math.round(b.logo.length / 1024)} KB, ${Math.round(b.signature.length / 1024)} KB)`)
await js(`document.querySelector('.content').scrollTo(0, 0)`)
await sleep(500)
await app.shot('business-logo-signature')

// Remove and upload again (the Remove and Change buttons).
await js(`[...document.querySelectorAll('.image-picker')][1].querySelectorAll('button.btn')[1].click()`)
await sleep(1200)
ok((await api('currentBusiness')).signature === '', 'Remove takes the signature off')
await js(`window.__nextFile = window.__files.sign; document.querySelector('button[title="Upload signature"]').click()`)
await sleep(1800)
ok((await api('currentBusiness')).signature.startsWith('data:image/png'), 'signature uploaded again')

// Print settings: the preview shows the logo; switch on the signature for small bills.
await clickText('Print', '.report-nav')
await sleep(1500)
await app.shot('print-settings-logo')
const ps = await api('getPrintSettings')
ok(ps.show.logo && ps.show.signature && !ps.show.signatureOnBill, 'by default: logo and signature on, signature on small bills off')

// The latest sale bill, printed every way.
const bill = (await api('listBills', 'SALE_INVOICE', {}))[0]
const current = await api('currentBusiness')
const has = (html, src) => html.includes(src)
for (const paper of ['A4', 'A5', 'thermal80', 'thermal58']) {
  const data = await api('getBillPrint', 'SALE_INVOICE', bill.id, paper)
  ok(data.business.logo === current.logo && data.business.signature === current.signature, `${paper}: bill data carries the logo and signature`)
}
await nav('Sale')
await sleep(800)
await js(`document.querySelector('.table tbody tr.clickable')?.click()`)
await sleep(1500)
const view = async (label, file, width, zoom) => {
  await clickText(label, '.print-as')
  await sleep(900)
  const html = await js(`return document.querySelector('iframe.invoice-preview').srcdoc`)
  await renderPng(html, file, width, zoom)
  return html
}
const a4 = await view('Invoice A4', 'invoice-a4', 860, 1)
await app.shot('bill-view-a4-logo')
ok(has(a4, current.logo) && /<div class="sign[^"]*"><div>For /.test(a4) && has(a4, current.signature), 'A4 invoice: logo at the top, signature above "Authorised signatory"')
const a5 = await view('Invoice A5', 'invoice-a5', 640, 1)
ok(has(a5, current.logo) && has(a5, current.signature), 'A5 invoice: logo and signature')
const r80 = await view('Bill 80 mm', 'bill-80mm-default', 380, 1.15)
ok(has(r80, current.logo) && r80.includes('class="sign hide-thermal"'), '80 mm bill: logo printed; signature left off (default)')

// Switch on the signature for small bills in Settings › Print (the real switch), then print again.
await nav('Settings')
await sleep(600)
await clickText('Print', '.report-nav')
await sleep(1200)
await js(`const l = [...document.querySelectorAll('label.toggle')].find((x) => x.innerText.includes('Signature on small')); l.scrollIntoView({ block: 'center' }); l.querySelector('input').click()`)
await sleep(600)
await app.shot('print-settings-signature-on-bill')
await clickText('Save print settings')
await sleep(1000)
ok((await api('getPrintSettings')).show.signatureOnBill === true, 'switch "Signature on small (thermal) bills too" saved')
await nav('Sale')
await sleep(800)
await js(`document.querySelector('.table tbody tr.clickable')?.click()`)
await sleep(1500)
const s80 = await view('Bill 80 mm', 'bill-80mm-signed', 380, 1.15)
await app.shot('bill-view-80mm-logo-signature')
ok(has(s80, current.logo) && s80.includes('<div class="sign"><div>For ') && has(s80, current.signature), '80 mm bill: logo and signature')
const s58 = await view('Bill 58 mm', 'bill-58mm-signed', 300, 1.15)
ok(has(s58, current.logo) && has(s58, current.signature), '58 mm bill: logo and signature')
for (const paper of ['A4', 'thermal80']) {
  const path = await api('exportBillPdf', 'SALE_INVOICE', bill.id, paper)
  ok(!!path, `PDF with logo and signature saved (${paper === 'A4' ? 'A4 invoice' : '80 mm bill'})`)
}

const failed = results.filter((r) => !r.ok)
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2))
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
for (const f of failed) console.log(`FAILED ${f.check}`)
app.close()
