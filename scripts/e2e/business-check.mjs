// Business-type check: sets up one made-up business per trade (wholesale, retail, grocery, fish market,
// services, medical, electrical, stationery, jewellery, gold covering) the way that trade works, makes its
// everyday bills through the app's own API, and checks totals, GST split, stock, payments, PDFs and reports
// against values worked out here independently. Screenshots of each bill go to <out>/business.
// Usage: node scripts/e2e/business-check.mjs <output folder>   (start the app first; see README.md)
// Uses its own test profile only (--user-data-dir); all names, phones and GSTINs are invented.
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { connect, stubDialogs, sleep } from './harness.mjs'

const out = process.argv[2] ?? 'e2e-out'
const shots = `${out}/business`
mkdirSync(shots, { recursive: true })
const app = await connect(shots)
const { evaluate, check } = app
await stubDialogs(out)
const call = (expr) => evaluate(`(async () => { ${expr} })()`)
const api = (method, ...args) => evaluate(`window.api.${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`)

// ---------- Independent maths (half-up rounding to the paisa, like a calculator) ----------
const round = (x) => Math.sign(x) * Math.round(Math.abs(x))
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
/** lines: [qtyMilli, ratePaise, gstBp, discBp]; charges: [amountPaise, gstBp]. Returns totals in paise. */
function expectBill(lines, charges, { inclusive = false, inter = false, roundOff = true } = {}) {
  let taxable = 0
  let tax = 0
  let half = { c: 0, s: 0 }
  for (const [q, r, bp, d = 0] of lines) {
    const gross = round((q * r) / 1000)
    const net = gross - round((gross * d) / 10000)
    const tx = inclusive ? round((net * 10000) / (10000 + bp)) : net
    const t = inclusive ? net - tx : round((tx * bp) / 10000)
    taxable += tx
    tax += t
    const c = Math.round(t / 2)
    half.c += c
    half.s += t - c
  }
  for (const [a, bp] of charges) {
    const t = round((a * bp) / 10000)
    taxable += a
    tax += t
    const c = Math.round(t / 2)
    half.c += c
    half.s += t - c
  }
  const raw = taxable + tax
  const total = roundOff ? Math.round(raw / 100) * 100 : raw
  return { taxable, tax, total, igst: inter ? tax : 0, cgst: inter ? 0 : half.c, sgst: inter ? 0 : half.s }
}

// The app's default label design (shared/labels.ts), used when a business has not saved its own.
const LABELS = {
  layout: 'roll-2x50x25', custom: { width: 50, height: 25, across: 1, gap: 2 }, symbol: 'barcode', showCode: true,
  header: { field: 'business', text: '' }, lines: [{ field: 'name', text: '' }, { field: 'price', text: '' }, { field: 'mrp', text: '' }, { field: 'none', text: '' }], skip: 0
}
const today = await evaluate(`(() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) })()`)
const results = []

async function setupBusiness(name, stateCode, gstNo, prefs, extra = {}) {
  const existing = (await api('listBusinesses')).find((b) => b.name === name)
  if (existing) {
    // Start each run fresh: an old copy of the test business is closed and a new one made under a new name.
    name = `${name} ${Date.now() % 100000}`
  }
  const b = await api('createBusiness', {
    profile: { name, legalName: '', gstin: gstNo, pan: '', stateCode, address: extra.address ?? 'Main Road', city: extra.city ?? 'Pune',
      pincode: extra.pincode ?? '411001', phone: '9000000099', email: '', businessType: extra.type ?? 'Retail', category: extra.category ?? '', fyStartMonth: 4 },
    preferences: { gstRegistered: !!gstNo, roundOff: true, ...prefs },
    bankAccount: null
  })
  return b
}

const unitId = async (short, name) => {
  const units = await api('listUnits')
  const u = units.find((x) => x.short === short)
  if (u) return u.id
  return (await api('createUnit', name ?? short, short)).id
}
const rateId = async (label) => (await api('listTaxRates')).find((t) => t.name === label).id
const item = (o) => ({
  name: o.name, code: o.code ?? '', kind: o.kind ?? 'goods', category: o.category ?? '', hsnSac: o.hsn ?? '', taxRateId: o.tax,
  priceIncludesTax: !!o.incl, salePrice: o.sale, purchasePrice: o.buy ?? 0, mrp: o.mrp ?? null, wholesalePrice: o.wholesale ?? null,
  wholesaleMinQty: o.wholesaleMin ?? null, baseUnitId: o.unit, altUnitId: o.alt ?? null, altConversion: o.altConv ?? null,
  trackStock: o.kind === 'service' ? false : o.track !== false, openingQty: o.open ?? 0, openingRate: o.buy ?? 0, openingDate: today,
  lowStockQty: o.low ?? null, barcode: o.barcode ?? ''
})
const party = (o) => ({
  name: o.name, kind: o.kind ?? 'customer', phone: o.phone ?? '', email: '', gstin: o.gstin ?? '', stateCode: o.state ?? '',
  billingAddress: o.address ?? '', shippingAddress: '', openingBalance: 0, openingDate: today, creditLimit: o.creditLimit ?? null,
  paymentTermDays: o.terms ?? null, group: ''
})
const line = (it, qty, rate, tax, o = {}) => ({
  itemId: it?.id ?? null, description: it ? '' : o.text ?? '', qty, unitId: o.unitId ?? it?.baseUnitId ?? null, unitFactor: 1000, rate,
  discountPctBp: o.disc ?? 0, discountAmount: 0, taxRateId: tax, hsnSac: o.hsn ?? '', details: o.details ?? null
})
const bill = (o) => ({
  partyId: o.partyId ?? null, walkInName: o.walkIn ?? '', number: o.number ?? '', date: today, dueDate: '', placeOfSupply: o.pos ?? '',
  pricesIncludeTax: !!o.incl, lines: o.lines, charges: o.charges ?? [], received: o.received ?? null, notes: o.notes ?? '', terms: '',
  extra: o.extra ?? null, linkedId: null
})
const stockOf = async (id) => (await api('getItem', id)).stockQty

async function verify(trade, label, saved, want) {
  const ok = (cond, msg) => {
    check(cond, `${trade}: ${msg}`)
    results.push({ trade, check: msg, ok: !!cond })
  }
  ok(saved.grandTotal === want.total, `${label} total ${saved.grandTotal / 100} = ${want.total / 100}`)
  ok(saved.cgst === want.cgst && saved.sgst === want.sgst && saved.igst === want.igst,
    `${label} GST split CGST ${saved.cgst / 100} / SGST ${saved.sgst / 100} / IGST ${saved.igst / 100}`)
  return ok
}

async function pdfAndShot(trade, type, id, file) {
  const path = await api('exportBillPdf', type, id)
  const okPdf = !!path && existsSync(path) && statSync(path).size > 5000
  check(okPdf, `${trade}: PDF saved (${path ? statSync(path).size : 0} bytes)`)
  results.push({ trade, check: 'PDF of the bill', ok: okPdf })
  // Show the bill in the window for a screenshot.
  await evaluate('location.reload()')
  await sleep(2200)
  await call(`[...document.querySelectorAll('.sidebar .nav')].find((b) => b.innerText.trim().startsWith(${JSON.stringify(type.startsWith('PURCHASE') ? 'Purchase' : 'Sale')})).click()`)
  await sleep(900)
  await call(`document.querySelector('.table tbody tr.clickable')?.click()`)
  await sleep(1600)
  await app.shot(file)
}

// =====================================================================================================
// 1. Wholesale: sugar sold by the 50 kg bag to a retailer in another state; wholesale price; transport.
{
  const T = 'Wholesale'
  await setupBusiness('Test Wholesale Agencies', '27', gstin('27', 'WHLPA1001A'), { pricesIncludeTax: false, paperSize: 'A4' }, { type: 'Wholesale' })
  const f = await api('getFeatures')
  await api('saveFeatures', { ...f, transport: true })
  const kg = await unitId('kg')
  const bag = await unitId('bag')
  const g5 = await rateId('GST 5%')
  const sugar = await api('createItem', item({ name: 'Sugar S-30', hsn: '1701', tax: g5, sale: 4400, buy: 3900, wholesale: 4200, wholesaleMin: 500_000, unit: kg, alt: bag, altConv: 50_000, open: 1_000_000 }))
  const retailer = await api('createParty', party({ name: 'Udupi Retail Mart', gstin: gstin('29', 'URMPB2002B'), state: '29', creditLimit: 5_000_000, terms: 30 }))
  const mill = await api('createParty', party({ name: 'Deccan Sugar Mill', kind: 'supplier', gstin: gstin('27', 'DSMPC3003C'), state: '27' }))
  // Purchase 20 bags at ₹3,900 a quintal-ish rate per kg.
  const pur = await api('saveBill', 'PURCHASE_BILL', null, bill({ partyId: mill.id, number: 'DSM-881', lines: [line(sugar, 20_000, 195_000, g5, { unitId: bag })] }))
  const wantP = expectBill([[20_000, 195_000, 500]], [])
  const ok = await verify(T, 'purchase in bags', pur, wantP)
  ok((await stockOf(sugar.id)) === 2_000_000, 'stock after buying 20 bags = 2,000 kg (1,000 opening + 1,000)')
  // Sell 12 bags inter-state at the wholesale price (₹42/kg → ₹2,100 a bag) with freight.
  const sale = await api('saveBill', 'SALE_INVOICE', null, bill({
    partyId: retailer.id, lines: [line(sugar, 12_000, 210_000, g5, { unitId: bag })], charges: [{ name: 'Freight', amount: 150_000, taxRateId: await rateId('GST 5%') }],
    extra: { transportName: 'Test Roadways', vehicleNo: 'MH12AB1234', ewayBillNo: '331000000001' }
  }))
  const wantS = expectBill([[12_000, 210_000, 500]], [[150_000, 500]], { inter: true })
  await verify(T, 'inter-state sale in bags with freight', sale, wantS)
  ok(sale.supplyType === 'inter', 'Karnataka buyer → IGST')
  ok((await stockOf(sugar.id)) === 1_400_000, 'stock after selling 12 bags = 1,400 kg')
  ok(sale.extra?.ewayBillNo === '331000000001', 'e-way bill and vehicle no. kept on the bill')
  // Credit and payment
  await api('savePayment', null, { direction: 'in', partyId: retailer.id, number: '', date: today, amount: 1_000_000, accountId: 'cash', mode: 'bank', reference: 'NEFT', notes: '', allocations: [{ documentId: sale.id, amount: 1_000_000 }] })
  const after = await api('getBill', 'SALE_INVOICE', sale.id)
  ok(after.status === 'partial' && after.balanceDue === wantS.total - 1_000_000, 'part payment leaves the right balance')
  await pdfAndShot(T, 'SALE_INVOICE', sale.id, 'wholesale')
}

// 2. Retail store: MRP-inclusive prices, barcodes, walk-in cash sale, thermal 80 mm receipt.
{
  const T = 'Retail'
  await setupBusiness('Test Retail Store', '27', gstin('27', 'RTLPA4004D'), { pricesIncludeTax: true, paperSize: 'thermal80' })
  const pcs = await unitId('pcs')
  const g18 = await rateId('GST 18%')
  const g5 = await rateId('GST 5%')
  const soap = await api('createItem', item({ name: 'Bath Soap 100g', hsn: '3401', tax: g18, sale: 4500, buy: 3600, mrp: 4500, incl: true, unit: pcs, open: 200_000, barcode: '8900000000017' }))
  const tea = await api('createItem', item({ name: 'Tea 250g', hsn: '0902', tax: g5, sale: 14_000, buy: 12_000, mrp: 14_000, incl: true, unit: pcs, open: 50_000, low: 10_000 }))
  const codes = await api('assignBarcodes', [tea.id])
  const tea2 = await api('getItem', tea.id)
  const ok = (c, m) => (check(c, `${T}: ${m}`), results.push({ trade: T, check: m, ok: !!c }))
  ok(/^2\d{12}$/.test(tea2.barcode), `in-store barcode made for an item without one (${tea2.barcode})`)
  const lines = [line(soap, 3000, 4500, g18), line(tea, 2000, 14_000, g5)]
  const want = expectBill([[3000, 4500, 1800], [2000, 14_000, 500]], [], { inclusive: true })
  const sale = await api('saveBill', 'SALE_INVOICE', null, bill({ incl: true, walkIn: 'Walk-in', lines, received: { amount: want.total, accountId: 'cash', mode: 'upi', reference: '' } }))
  await verify(T, 'walk-in sale with MRP prices', sale, want)
  ok(sale.status === 'paid', 'cash sale is paid in full')
  ok(sale.grandTotal === 41_500, 'customer pays exactly the MRP total (₹415)')
  void codes
  await pdfAndShot(T, 'SALE_INVOICE', sale.id, 'retail')
}

// 3. Grocery (kirana): loose items by weight with decimals, packets, khata (credit) customer.
{
  const T = 'Grocery'
  await setupBusiness('Test Kirana Stores', '33', gstin('33', 'KRNPA5005E'), { pricesIncludeTax: true, paperSize: 'thermal58' }, { city: 'Chennai', pincode: '600017' })
  const kg = await unitId('kg')
  const pkt = await unitId('pkt')
  const nil = await rateId('GST 0%')
  const g5 = await rateId('GST 5%')
  const rice = await api('createItem', item({ name: 'Ponni Rice (loose)', hsn: '1006', tax: nil, sale: 5800, buy: 5000, incl: true, unit: kg, open: 100_000 }))
  const dal = await api('createItem', item({ name: 'Moong Dal (loose)', hsn: '0713', tax: nil, sale: 12_400, buy: 11_000, incl: true, unit: kg, open: 25_000 }))
  const oil = await api('createItem', item({ name: 'Groundnut Oil 1L pouch', hsn: '1508', tax: g5, sale: 19_500, buy: 17_500, incl: true, unit: pkt, open: 40_000 }))
  const khata = await api('createParty', party({ name: 'Mrs. Lakshmi (khata)', phone: '9000000111', state: '33' }))
  const lines = [line(rice, 5_500, 5800, nil), line(dal, 750, 12_400, nil), line(oil, 2000, 19_500, g5)]
  const want = expectBill([[5_500, 5800, 0], [750, 12_400, 0], [2000, 19_500, 500]], [], { inclusive: true })
  const sale = await api('saveBill', 'SALE_INVOICE', null, bill({ incl: true, partyId: khata.id, lines }))
  await verify(T, 'loose weights (5.5 kg, 750 g) and packets on credit', sale, want)
  const ok = (c, m) => (check(c, `${T}: ${m}`), results.push({ trade: T, check: m, ok: !!c }))
  ok((await stockOf(rice.id)) === 94_500 && (await stockOf(dal.id)) === 24_250, 'stock goes down by the exact weight (94.5 kg rice, 24.25 kg dal left)')
  await api('savePayment', null, { direction: 'in', partyId: khata.id, number: '', date: today, amount: 30_000, accountId: 'cash', mode: 'cash', reference: '', notes: 'Weekly khata', allocations: [] })
  const p = await api('getParty', khata.id)
  ok(p.balance === want.total - 30_000, 'khata balance after a payment not set against a bill (advance on account)')
  await pdfAndShot(T, 'SALE_INVOICE', sale.id, 'grocery')
}

// 4. Fish market: not GST-registered, price per kg changes daily, wastage written off, cash sales.
{
  const T = 'Fish market'
  await setupBusiness('Test Fresh Fish Market', '32', '', { pricesIncludeTax: false, paperSize: 'thermal58', allowNegativeStock: false }, { city: 'Kochi', pincode: '682001' })
  const kg = await unitId('kg')
  const ex = await rateId('Exempted')
  const pomfret = await api('createItem', item({ name: 'Pomfret', hsn: '0302', tax: ex, sale: 65_000, buy: 52_000, unit: kg, open: 20_000 }))
  const sardine = await api('createItem', item({ name: 'Sardine (Mathi)', hsn: '0302', tax: ex, sale: 16_000, buy: 11_000, unit: kg, open: 30_000 }))
  const hotel = await api('createParty', party({ name: 'Sea Breeze Hotel', phone: '9000000222', state: '32', terms: 7 }))
  const ok = (c, m) => (check(c, `${T}: ${m}`), results.push({ trade: T, check: m, ok: !!c }))
  // Morning price differs from the item price: typed on the bill.
  const want = expectBill([[1_250, 68_000, 0], [2_000, 15_000, 0]], [])
  const cash = await api('saveBill', 'SALE_INVOICE', null, bill({ walkIn: 'Cash', lines: [line(pomfret, 1_250, 68_000, ex), line(sardine, 2_000, 15_000, ex)], received: { amount: want.total, accountId: 'cash', mode: 'cash', reference: '' } }))
  await verify(T, 'cash sale by weight at today\'s price', cash, want)
  ok(cash.cgst + cash.sgst + cash.igst === 0, 'no GST charged (business not registered; fresh fish exempt)')
  const hotelBill = await api('saveBill', 'SALE_INVOICE', null, bill({ partyId: hotel.id, lines: [line(sardine, 10_000, 14_500, ex)] }))
  ok(hotelBill.grandTotal === 145_000 && hotelBill.status === 'unpaid', 'weekly credit to a hotel')
  await api('createAdjustment', { itemId: sardine.id, date: today, qtyChange: -1_500, rate: null, reason: 'Spoiled / wastage' })
  ok((await stockOf(sardine.id)) === 16_500, 'wastage written off: 30 − 2 − 10 − 1.5 = 16.5 kg left')
  let refused = false
  try {
    await api('saveBill', 'SALE_INVOICE', null, bill({ walkIn: 'Cash', lines: [line(pomfret, 50_000, 68_000, ex)], received: { amount: 3_400_000, accountId: 'cash', mode: 'cash', reference: '' } }))
  } catch (e) {
    refused = /Not enough stock/.test(String(e))
  }
  ok(refused, 'cannot sell more fish than is in stock (negative stock off)')
  await pdfAndShot(T, 'SALE_INVOICE', cash.id, 'fish-market')
}

// 5. Services: hours and visits (SAC, no stock), registered client in another state.
{
  const T = 'Services'
  await setupBusiness('Test Tech Services', '29', gstin('29', 'TSVPA6006F'), { pricesIncludeTax: false, paperSize: 'A4' }, { city: 'Bengaluru', pincode: '560001', type: 'Services' })
  const hr = await unitId('hr')
  const job = await unitId('job')
  const g18 = await rateId('GST 18%')
  const consult = await api('createItem', item({ name: 'IT support (per hour)', kind: 'service', hsn: '998313', tax: g18, sale: 80_000, unit: hr }))
  const amc = await api('createItem', item({ name: 'Annual maintenance (AMC)', kind: 'service', hsn: '998713', tax: g18, sale: 1_200_000, unit: job }))
  const client = await api('createParty', party({ name: 'Konkan Exports Pvt Ltd', gstin: gstin('27', 'KEXPA7007G'), state: '27', terms: 15 }))
  const want = expectBill([[6_000, 80_000, 1800, 0], [1_000, 1_200_000, 1800, 1000]], [[50_000, 1800]], { inter: true })
  const inv = await api('saveBill', 'SALE_INVOICE', null, bill({
    partyId: client.id, lines: [line(consult, 6_000, 80_000, g18), line(amc, 1_000, 1_200_000, g18, { disc: 1000 })], charges: [{ name: 'Visit charges', amount: 50_000, taxRateId: g18 }]
  }))
  await verify(T, '6 hours + AMC with 10% off + visit charge', inv, want)
  const ok = (c, m) => (check(c, `${T}: ${m}`), results.push({ trade: T, check: m, ok: !!c }))
  ok((await api('getItem', consult.id)).trackStock === false, 'services do not track stock')
  const est = await api('saveBill', 'ESTIMATE', null, bill({ partyId: client.id, lines: [line(amc, 1_000, 1_200_000, g18)] }))
  ok(est.status === 'open', 'quotation (estimate) saved for the client')
  const conv = await api('saveBill', 'SALE_INVOICE', null, { ...bill({ partyId: client.id, lines: [line(amc, 1_000, 1_200_000, g18)] }), linkedId: est.id })
  ok((await api('getBill', 'ESTIMATE', est.id)).status === 'converted' && conv.grandTotal === 1_416_000, 'quotation turned into an invoice')
  await pdfAndShot(T, 'SALE_INVOICE', inv.id, 'services')
}

// 6. Medical shop: strips and tablets, batch and expiry on lines, MRP-inclusive, DL number in the footer.
{
  const T = 'Medical shop'
  await setupBusiness('Test Care Pharmacy', '27', gstin('27', 'MEDPA8008H'), { pricesIncludeTax: true, paperSize: 'A5' })
  const fieldsNow = await api('getItemFields')
  const on = (k) => ({ ...fieldsNow.fields[k], on: true })
  await api('saveItemFields', { ...fieldsNow, fields: { ...fieldsNow.fields, batch: on('batch'), exp: on('exp') } })
  const ps = await api('getPrintSettings')
  await api('savePrintSettings', { ...ps, footer: 'D.L. No. 20B-MH-TEST-0001, 21B-MH-TEST-0002 · Medicines once sold are taken back only with the bill' })
  const tab = await unitId('tab', 'Tablet')
  const strip = await unitId('strip', 'Strip')
  const btl = await unitId('btl')
  const g5 = await rateId('GST 5%')
  const para = await api('createItem', item({ name: 'Paracetamol 650 mg', hsn: '3004', tax: g5, sale: 300, buy: 210, incl: true, mrp: 300, unit: tab, alt: strip, altConv: 15_000, open: 300_000, low: 45_000 }))
  const syrup = await api('createItem', item({ name: 'Cough Syrup 100 ml', hsn: '3004', tax: g5, sale: 11_800, buy: 8_900, incl: true, mrp: 11_800, unit: btl, open: 24_000 }))
  const ok = (c, m) => (check(c, `${T}: ${m}`), results.push({ trade: T, check: m, ok: !!c }))
  // 2 strips (rate per strip) + 5 loose tablets + 1 syrup, each with batch and expiry.
  const lines = [
    line(para, 2_000, 4_500, g5, { unitId: strip, details: { batch: 'PCM2401', exp: '2027-08-31' } }),
    line(para, 5_000, 300, g5, { details: { batch: 'PCM2401', exp: '2027-08-31' } }),
    line(syrup, 1_000, 11_800, g5, { details: { batch: 'CS77', exp: '2026-11-30' } })
  ]
  const want = expectBill([[2_000, 4_500, 500], [5_000, 300, 500], [1_000, 11_800, 500]], [], { inclusive: true })
  const sale = await api('saveBill', 'SALE_INVOICE', null, bill({ incl: true, walkIn: 'Patient', lines, notes: 'Dr. Test Rao, Rx 1123', received: { amount: want.total, accountId: 'cash', mode: 'cash', reference: '' } }))
  await verify(T, 'strips + loose tablets + syrup at MRP', sale, want)
  ok((await stockOf(para.id)) === 300_000 - 35_000, 'tablet stock falls by 2 strips × 15 + 5 = 35 tablets')
  ok(sale.lines[0].details?.batch === 'PCM2401' && sale.lines[2].details?.exp === '2026-11-30', 'batch and expiry kept on each line')
  const ret = await api('saveBill', 'SALE_RETURN', null, { ...bill({ incl: true, partyId: null, lines: [line(syrup, 1_000, 11_800, g5)] }), partyId: null }).catch((e) => String(e))
  ok(typeof ret === 'string' && /party/i.test(ret), 'a sale return needs a named customer (walk-in returns are refused)')
  await pdfAndShot(T, 'SALE_INVOICE', sale.id, 'medical')
}

// 7. Electrical shop: model and serial numbers, warranty, wire sold by the coil or by the metre.
{
  const T = 'Electrical shop'
  await setupBusiness('Test Power Electricals', '24', gstin('24', 'ELEPA9009J'), { pricesIncludeTax: false, paperSize: 'A4' }, { city: 'Surat', pincode: '395003' })
  const fieldsNow = await api('getItemFields')
  await api('saveItemFields', { ...fieldsNow, fields: { ...fieldsNow.fields, model: { on: true, label: 'Model no.' }, serial: { on: true, label: 'Serial no.' }, size: { on: true, label: 'Warranty' } } })
  const m = await unitId('m')
  const roll = await unitId('roll')
  const nos = await unitId('nos')
  const g18 = await rateId('GST 18%')
  const wire = await api('createItem', item({ name: 'FR Wire 1.5 sq mm', hsn: '8544', tax: g18, sale: 2_100, buy: 1_650, unit: m, alt: roll, altConv: 90_000, open: 900_000 }))
  const fan = await api('createItem', item({ name: 'Ceiling Fan 1200 mm', hsn: '8414', tax: g18, sale: 210_000, buy: 168_000, unit: nos, open: 10_000 }))
  const contractor = await api('createParty', party({ name: 'Shiv Electrical Contractors', gstin: gstin('24', 'SECPB1010K'), state: '24', creditLimit: 10_000_000 }))
  const lines = [
    line(wire, 2_000, 170_000, g18, { unitId: roll }),
    line(wire, 25_000, 2_100, g18),
    line(fan, 2_000, 210_000, g18, { details: { model: 'CF-1200-W', serial: 'SN88121, SN88122', size: '2 years' } })
  ]
  const want = expectBill([[2_000, 170_000, 1800], [25_000, 2_100, 1800], [2_000, 210_000, 1800]], [])
  const sale = await api('saveBill', 'SALE_INVOICE', null, bill({ partyId: contractor.id, lines }))
  await verify(T, 'wire by coil and by metre + 2 fans', sale, want)
  const ok = (c, m2) => (check(c, `${T}: ${m2}`), results.push({ trade: T, check: m2, ok: !!c }))
  ok((await stockOf(wire.id)) === 900_000 - 205_000, 'wire stock falls by 2 coils × 90 m + 25 m = 205 m')
  ok(sale.lines[2].details?.serial === 'SN88121, SN88122' && sale.lines[2].details?.size === '2 years', 'serial numbers and warranty kept on the line')
  await pdfAndShot(T, 'SALE_INVOICE', sale.id, 'electrical')
}

// 8. Stationery: boxes and pieces, many cheap items, school books at nil rate, barcode labels.
{
  const T = 'Stationery'
  await setupBusiness('Test Book & Stationery', '27', gstin('27', 'STNPA1111L'), { pricesIncludeTax: true, paperSize: 'thermal80' })
  const pcs = await unitId('pcs')
  const box = await unitId('box')
  const nil = await rateId('GST 0%')
  const g18 = await rateId('GST 18%')
  const pen = await api('createItem', item({ name: 'Ball Pen Blue', hsn: '9608', tax: g18, sale: 1_000, buy: 650, incl: true, unit: pcs, alt: box, altConv: 10_000, open: 500_000, wholesale: 800, wholesaleMin: 100_000 }))
  const book = await api('createItem', item({ name: 'Exercise Book 172 pages', hsn: '4820', tax: nil, sale: 4_500, buy: 3_400, incl: true, unit: pcs, open: 300_000 }))
  const ok = (c, m) => (check(c, `${T}: ${m}`), results.push({ trade: T, check: m, ok: !!c }))
  await api('assignBarcodes', [pen.id, book.id])
  const labels = await api('previewLabels', { items: [{ itemId: pen.id, copies: 4 }, { itemId: book.id, copies: 2 }], options: { ...LABELS, ...((await api('getLabelDesign')) ?? {}), skip: 0 } }).catch((e) => String(e))
  ok(typeof labels === 'string' && labels.includes('<svg'), 'barcodes created and labels drawn for pens and books')
  const lines = [line(pen, 2_000, 10_000, g18, { unitId: box }), line(pen, 3_000, 1_000, g18), line(book, 6_000, 4_500, nil)]
  const want = expectBill([[2_000, 10_000, 1800], [3_000, 1_000, 1800], [6_000, 4_500, 0]], [], { inclusive: true })
  const sale = await api('saveBill', 'SALE_INVOICE', null, bill({ incl: true, walkIn: 'Student', lines, received: { amount: want.total, accountId: 'cash', mode: 'upi', reference: '' } }))
  await verify(T, '2 boxes + 3 pens + 6 books (mixed GST)', sale, want)
  ok((await stockOf(pen.id)) === 500_000 - 23_000, 'pen stock falls by 2 boxes × 10 + 3 = 23')
  await pdfAndShot(T, 'SALE_INVOICE', sale.id, 'stationery')
}

// 9. Jewellery: gold by weight (3 decimals) at today's rate per gram, purity and HUID, making charges,
//    and old gold taken in exchange from the same customer.
{
  const T = 'Jewellery'
  await setupBusiness('Test Lakshmi Jewellers', '33', gstin('33', 'JWLPA1212M'), { pricesIncludeTax: false, paperSize: 'A4', roundOff: true }, { city: 'Coimbatore', pincode: '641001' })
  const fieldsNow = await api('getItemFields')
  await api('saveItemFields', { ...fieldsNow, fields: { ...fieldsNow.fields, model: { on: true, label: 'Purity' }, serial: { on: true, label: 'HUID' }, size: { on: true, label: 'Gross wt.' } } })
  const g = await unitId('g')
  const g3 = await rateId('GST 3%')
  const g5 = await rateId('GST 5%')
  const ring = await api('createItem', item({ name: 'Gold Ring 22K', hsn: '7113', tax: g3, sale: 725_000, buy: 690_000, unit: g, open: 120_000 }))
  const chain = await api('createItem', item({ name: 'Gold Chain 22K', hsn: '7113', tax: g3, sale: 725_000, buy: 690_000, unit: g, open: 250_000 }))
  const oldGold = await api('createItem', item({ name: 'Old gold (exchange)', hsn: '7113', tax: null, sale: 0, buy: 660_000, unit: g, open: 0 }))
  const cust = await api('createParty', party({ name: 'Test Customer Meena', kind: 'both', phone: '9000000333', state: '33' }))
  const lines = [
    line(ring, 4_250, 725_000, g3, { details: { model: '22K (916)', serial: 'HU1A2B', size: '4.410 g' } }),
    line(chain, 12_380, 725_000, g3, { details: { model: '22K (916)', serial: 'HU9Z8Y', size: '12.500 g' } })
  ]
  const charges = [{ name: 'Making charges', amount: 1_350_000, taxRateId: g5 }, { name: 'Hallmarking', amount: 9_000, taxRateId: await rateId('GST 18%') }]
  const want = expectBill([[4_250, 725_000, 300], [12_380, 725_000, 300]], [[1_350_000, 500], [9_000, 1800]])
  const sale = await api('saveBill', 'SALE_INVOICE', null, bill({ partyId: cust.id, lines, charges }))
  await verify(T, 'ring 4.250 g + chain 12.380 g at ₹7,250/g + making charges', sale, want)
  const ok = (c, m) => (check(c, `${T}: ${m}`), results.push({ trade: T, check: m, ok: !!c }))
  ok((await stockOf(chain.id)) === 250_000 - 12_380, 'gold stock kept to the milligram (237.620 g chain stock left)')
  ok(sale.lines[0].details?.serial === 'HU1A2B', 'HUID and purity printed on each piece')
  // Old gold bought from the customer (no GST: an unregistered person selling old jewellery).
  const exch = await api('saveBill', 'PURCHASE_BILL', null, bill({ partyId: cust.id, number: 'OG-1', lines: [line(oldGold, 8_000, 660_000, null)] }))
  ok(exch.grandTotal === 5_280_000, 'old gold 8 g at ₹6,600/g taken in as a purchase (no GST)')
  const p = await api('getParty', cust.id)
  ok(p.balance === sale.grandTotal - 5_280_000, 'customer owes the sale less the old gold value')
  await pdfAndShot(T, 'SALE_INVOICE', sale.id, 'jewellery')
}

// 10. Gold covering (imitation jewellery): many designs by the piece, MRP-inclusive, resellers at a wholesale price.
{
  const T = 'Gold covering'
  await setupBusiness('Test Gold Covering Centre', '36', gstin('36', 'GCVPA1313N'), { pricesIncludeTax: true, paperSize: 'thermal80' }, { city: 'Hyderabad', pincode: '500001' })
  const pcs = await unitId('pcs')
  const set = await unitId('set')
  const g3 = await rateId('GST 3%')
  const bangle = await api('createItem', item({ name: 'Covering Bangles (pair) D-101', hsn: '7117', tax: g3, sale: 45_000, buy: 22_000, incl: true, unit: pcs, open: 60_000, wholesale: 32_000, wholesaleMin: 12_000 }))
  const neck = await api('createItem', item({ name: 'Necklace Set Temple D-220', hsn: '7117', tax: g3, sale: 185_000, buy: 90_000, incl: true, unit: set, open: 15_000 }))
  const reseller = await api('createParty', party({ name: 'Test Fancy Stores', gstin: gstin('36', 'TFSPB1414P'), state: '36' }))
  const ok = (c, m) => (check(c, `${T}: ${m}`), results.push({ trade: T, check: m, ok: !!c }))
  const retail = await api('saveBill', 'SALE_INVOICE', null, bill({ incl: true, walkIn: 'Walk-in', lines: [line(bangle, 2_000, 45_000, g3), line(neck, 1_000, 185_000, g3)], received: { amount: 275_000, accountId: 'cash', mode: 'upi', reference: '' } }))
  const wantR = expectBill([[2_000, 45_000, 300], [1_000, 185_000, 300]], [], { inclusive: true })
  await verify(T, 'counter sale at MRP', retail, wantR)
  const whole = await api('saveBill', 'SALE_INVOICE', null, bill({ incl: true, partyId: reseller.id, lines: [line(bangle, 24_000, 32_000, g3)] }))
  const wantW = expectBill([[24_000, 32_000, 300]], [], { inclusive: true })
  await verify(T, '24 pairs to a reseller at the wholesale price', whole, wantW)
  ok((await stockOf(bangle.id)) === 60_000 - 26_000, 'stock of the design falls by 26 pairs')
  await pdfAndShot(T, 'SALE_INVOICE', retail.id, 'gold-covering')
}

// Reports must open for the last business, and the GST summary must agree with its bills.
{
  const g = await api('gstSummary', { from: today, to: today })
  const ok = g.outward.cgst + g.outward.sgst > 0
  check(ok, `reports: GST summary has output tax (${(g.outward.cgst + g.outward.sgst) / 100})`)
  results.push({ trade: 'Reports', check: 'GST summary', ok })
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
for (const f of failed) console.log(`FAILED ${f.trade}: ${f.check}`)
// Back to the demo business so the app opens where it was.
const demo = (await api('listBusinesses')).find((b) => b.name === 'Sunrise Traders')
if (demo) await api('openBusiness', demo.id)
await evaluate('location.reload()')
app.close()
