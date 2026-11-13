// The printed invoice, as one self-contained HTML page. Used for the on-screen preview,
// for printing and for PDF export, so all three always match. Its look comes from the
// business's print settings: layout, colour, text size and which parts are shown.

import { BILL_INFO } from './billTypes'
import type { BillType, Business, Invoice, MoneyAccount, PaperSize } from './models'
import { formatINR, formatPercent, splitHalves } from './money'
import { completePrintSettings, upiPayLink, type PrintSettings } from './printSettings'
import { completeItemFields, detailsText, type ItemFieldSettings } from './itemFields'
import { BILL_EXTRA_LABELS, completeFeatures, customFieldLines, type BillExtra, type FeatureSettings } from './features'
import { qrSvg } from './qr'
import { formatQty } from './qty'
import { stateName } from './states'
import { amountInWords } from './tax'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const money = (p: number) => formatINR(p, { symbol: false })
const lines = (s: string) => esc(s).replace(/\n/g, '<br>')
const fmtDate = (iso: string) => (iso ? iso.split('-').reverse().join('-') : '')

export interface InvoicePrintData {
  type: BillType
  invoice: Invoice
  business: Business
  bank: MoneyAccount | null
  paper: PaperSize
  gstRegistered: boolean
  /** How it looks; the defaults when left out. */
  design?: Partial<PrintSettings>
  /** Names and date formats of line details. */
  itemFields?: Partial<ItemFieldSettings>
  /** Time on prints and the business's own party and item fields. */
  features?: Partial<FeatureSettings>
  /** The party's own field values, from its record. */
  partyCustomFields?: string[] | null
}

function taxSummary(inv: Invoice): { rateBp: number; taxable: number; cgst: number; sgst: number; igst: number; cess: number }[] {
  const groups = new Map<number, { rateBp: number; taxable: number; cgst: number; sgst: number; igst: number; cess: number }>()
  const add = (rateBp: number, taxable: number, cgst: number, sgst: number, igst: number, cess: number) => {
    const g = groups.get(rateBp) ?? { rateBp, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }
    g.taxable += taxable
    g.cgst += cgst
    g.sgst += sgst
    g.igst += igst
    g.cess += cess
    groups.set(rateBp, g)
  }
  for (const l of inv.lines) add(l.taxRateBp, l.taxable, l.cgst, l.sgst, l.igst, l.cess)
  for (const c of inv.charges) {
    const { cgst, sgst } = inv.supplyType === 'intra' ? splitHalves(c.tax) : { cgst: 0, sgst: 0 }
    add(c.taxRateBp, c.amount, cgst, sgst, inv.supplyType === 'inter' ? c.tax : 0, 0)
  }
  return [...groups.values()].sort((a, b) => a.rateBp - b.rateBp)
}

const SIZES = { small: 11, medium: 12, large: 13.5 }

const STYLE = `
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #111; background: #fff; }
.page { padding: 28px 32px; max-width: 800px; margin: 0 auto; }
.doc-title { display: none; text-align: center; font-weight: 700; letter-spacing: 0.1em; font-size: 1.25em; margin-bottom: 8px; color: var(--accent); }
.top { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid var(--accent); padding-bottom: 12px; }
.biz { display: flex; gap: 14px; align-items: flex-start; }
.biz h1 { font-size: 1.7em; margin: 0 0 4px; color: var(--accent); }
.logo { max-width: 150px; max-height: 80px; object-fit: contain; }
.sign img { max-width: 180px; max-height: 60px; object-fit: contain; display: block; margin: 6px 0 -34px auto; }
.desc { white-space: pre-line; }
.details { color: #333; }
.title { text-align: right; }
.title h2 { margin: 0 0 6px; font-size: 1.35em; letter-spacing: 0.08em; color: var(--accent); }
.muted { color: #555; }
.meta td { padding: 1px 0 1px 12px; }
.parties { display: flex; gap: 24px; margin: 14px 0; }
.parties > div { flex: 1; }
.label { font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.06em; color: #666; margin-bottom: 3px; }
table.items { width: 100%; border-collapse: collapse; margin-top: 8px; }
table.items th { background: var(--accent-soft); text-align: left; font-size: 0.92em; padding: 6px; border-bottom: 1px solid #ccc; }
table.items td { padding: 6px; border-bottom: 1px solid #e6e6e6; vertical-align: top; }
.r, table.items th.r { text-align: right; white-space: nowrap; }
.bottom { display: flex; gap: 24px; margin-top: 12px; align-items: flex-start; }
.bottom > .left { flex: 1; }
table.totals { min-width: 260px; border-collapse: collapse; }
table.totals td { padding: 3px 6px; }
table.totals tr.grand td { border-top: 2px solid var(--accent); font-weight: 700; font-size: 1.17em; padding-top: 6px; }
table.summary { border-collapse: collapse; margin-top: 6px; font-size: 0.92em; }
table.summary th, table.summary td { border: 1px solid #ddd; padding: 3px 6px; }
.words { margin: 10px 0; }
.pay { display: flex; gap: 12px; align-items: flex-start; margin-top: 12px; }
.upi { width: 96px; text-align: center; font-size: 0.8em; color: #444; }
.upi svg { width: 96px; height: 96px; display: block; }
.sign { margin-top: 36px; text-align: right; }
.sign .line { margin-top: 40px; border-top: 1px solid #999; display: inline-block; padding-top: 4px; min-width: 180px; text-align: center; }
.footer { margin-top: 18px; text-align: center; color: #444; }
.small { font-size: 0.92em; }

/* Boxed: bordered sections and a full grid. */
.theme-boxed .doc-title { display: block; border: 1px solid #333; border-bottom: 0; padding: 6px; margin: 0; }
.theme-boxed .title h2 { display: none; }
.theme-boxed .top { border: 1px solid #333; padding: 10px; }
.theme-boxed .parties { border: 1px solid #333; border-top: 0; margin: 0; gap: 0; }
.theme-boxed .parties > div { padding: 8px 10px; }
.theme-boxed .parties > div + div { border-left: 1px solid #333; }
.theme-boxed table.items { margin: 0; }
.theme-boxed table.items th, .theme-boxed table.items td { border: 1px solid #333; }
.theme-boxed .bottom { border: 1px solid #333; border-top: 0; margin: 0; padding: 8px 10px; }
.theme-boxed table.totals td { border-bottom: 1px solid #ddd; }
.theme-boxed .sign { border: 1px solid #333; border-top: 0; margin: 0; padding: 8px 10px 10px; }

/* Modern: a coloured header band. */
.theme-modern .page { padding-top: 0; }
.theme-modern .top { background: var(--accent); color: #fff; border: 0; padding: 18px 20px; margin: 0 -32px; border-radius: 0 0 6px 6px; }
.theme-modern .top .muted, .theme-modern .top .biz h1, .theme-modern .top .title h2 { color: #fff; }
.theme-modern .top .muted { opacity: 0.85; }
.theme-modern .logo { background: #fff; border-radius: 4px; padding: 3px; }
.theme-modern table.items th { background: var(--accent); color: #fff; border: 0; }
.theme-modern table.items tbody tr:nth-child(even) td { background: #f7f8fa; }

/* Compact: tight spacing. */
.theme-compact .page { padding: 14px 16px; }
.theme-compact .top { padding-bottom: 6px; }
.theme-compact .parties { margin: 8px 0; }
.theme-compact table.items th, .theme-compact table.items td { padding: 3px 4px; }
.theme-compact .sign { margin-top: 18px; }
.theme-compact .sign .line { margin-top: 26px; }

/* Thermal receipts: one narrow column. */
.thermal .page { padding: 8px; max-width: none; }
.thermal .top, .thermal .parties, .thermal .bottom, .thermal .pay { display: block; }
.thermal .top { border-bottom: 1px dashed #000; }
.thermal .title { text-align: left; margin-top: 6px; }
.thermal .biz { display: block; text-align: center; }
.thermal .biz h1 { color: #000; font-size: 1.4em; }
.thermal .title h2 { color: #000; font-size: 1.1em; }
.thermal .logo { max-width: 60%; max-height: 50px; margin: 0 auto 4px; display: block; }
.thermal .sign { text-align: center; margin-top: 10px; }
.thermal .sign img { max-width: 70%; max-height: 40px; margin: 4px auto -22px; }
.thermal .sign .line { margin-top: 26px; min-width: 60%; }
.thermal .hide-thermal { display: none; }
.thermal table.items th { background: none; border-bottom: 1px dashed #000; color: #000; padding: 3px 2px; }
.thermal table.items td { padding: 3px 2px; border-bottom: 0; }
.thermal table.totals { width: 100%; min-width: 0; }
.thermal table.totals tr.grand td { border-top: 1px dashed #000; }
.thermal .upi { margin: 8px auto 0; }
.thermal .footer { border-top: 1px dashed #000; padding-top: 6px; }
.thermal .item-line td { padding-top: 0; }
@media print { .page { padding: 0; } .theme-modern .top { margin: 0; } }
`

/** Colour mixed with white, for soft table headings. */
function soften(hex: string, keep: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * keep + 255 * (1 - keep))
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`
}

export function invoiceHtml(d: InvoicePrintData): string {
  const { invoice: inv, business: b } = d
  const s = completePrintSettings(d.design)
  const show = s.show
  const fields = completeItemFields(d.itemFields)
  const features = completeFeatures(d.features)
  // The time the bill was made, in local time, e.g. 04:35 PM.
  const time = features.showTime && inv.createdAt
    ? new Date(inv.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()
    : ''
  const extraRows = inv.extra
    ? (Object.keys(BILL_EXTRA_LABELS) as (keyof BillExtra)[])
        .filter((k) => inv.extra![k])
        .map((k) => `<tr><td class="muted">${BILL_EXTRA_LABELS[k]}</td><td>${esc(k === 'deliveryDate' || k === 'poDate' ? fmtDate(inv.extra![k]!) : inv.extra![k]!)}</td></tr>`)
        .join('')
    : ''
  const thermal = d.paper === 'thermal80' || d.paper === 'thermal58'
  const width = d.paper === 'thermal58' ? '58mm' : d.paper === 'thermal80' ? '80mm' : null
  const pageCss = width ? `@page { size: ${width} auto; margin: 3mm; }` : `@page { size: ${d.paper}; margin: ${s.theme === 'compact' ? 8 : 12}mm; }`
  const intra = inv.supplyType === 'intra'
  const showTax = d.gstRegistered && inv.cgst + inv.sgst + inv.igst + inv.cess > 0
  const hasDiscount = inv.discountTotal > 0 && show.discountColumn
  const taxCol = showTax && show.taxColumn
  const info = BILL_INFO[d.type]
  const purchase = info.side === 'purchase'
  const title = d.type === 'SALE_INVOICE' ? (d.gstRegistered ? 'TAX INVOICE' : 'INVOICE') : info.printTitle
  // Due date means "pay by" on invoices and bills, "valid till" on estimates, and nothing elsewhere.
  const dueLabel = d.type === 'ESTIMATE' ? 'Valid till' : d.type === 'SALE_INVOICE' || d.type === 'PURCHASE_BILL' ? 'Due date' : ''
  const refs = inv.links
    .filter((l) => l.direction === 'from')
    .map((l) => `<tr><td class="muted">${l.kind === 'returned' ? 'Against' : 'Ref.'}</td><td>${esc(l.number)} · ${fmtDate(l.date)}</td></tr>`)
    .join('')

  const bizLines = [
    show.businessAddress && b.address && lines(b.address),
    show.businessAddress && [b.city, b.pincode].filter(Boolean).map(esc).join(' - '),
    show.businessPhone && b.phone && `Phone: ${esc(b.phone)}`,
    show.businessEmail && b.email && esc(b.email),
    show.businessGstin && b.gstin && `<strong>GSTIN: ${esc(b.gstin)}</strong>`,
    `State: ${esc(stateName(b.stateCode))} (${esc(b.stateCode)})`
  ].filter(Boolean)

  const p = inv.party
  const partyLines = [
    `<strong>${esc(p.name)}</strong>`,
    p.billingAddress && lines(p.billingAddress),
    show.partyPhone && p.phone && `Phone: ${esc(p.phone)}`,
    show.partyGstin && p.gstin && `GSTIN: ${esc(p.gstin)}`,
    p.stateCode && `State: ${esc(stateName(p.stateCode))} (${esc(p.stateCode)})`,
    ...customFieldLines(features.partyFields, d.partyCustomFields, true).map(esc)
  ].filter(Boolean)

  const itemised = thermal && s.thermalTheme === 'itemised'
  const serial = show.serialNo && !thermal
  const rows = inv.lines
    .map((l, i) => {
      const name = esc(l.description || l.itemName)
      // The item's own description, when it adds something to the name.
      const desc = show.itemDescription && l.itemId && l.itemDescription && l.itemDescription !== l.description ? `<div class="muted small desc">${lines(l.itemDescription)}</div>` : ''
      const hsn = show.hsn && l.hsnSac ? `<div class="muted small">HSN/SAC ${esc(l.hsnSac)}</div>` : ''
      const det = show.itemDetails ? detailsText(l.details, fields) : ''
      const own = customFieldLines(features.itemFields, l.itemCustomFields, true).join(' · ')
      const details = det || own ? `<div class="small details">${esc([det, own].filter(Boolean).join(' · '))}</div>` : ''
      const qty = `${formatQty(l.qty)} ${esc(l.unitShort)}`.trim()
      const disc = l.discountPctBp > 0 ? formatPercent(l.discountPctBp) : l.discountAmount > 0 ? money(l.discountAmount) : ''
      if (itemised) {
        const extra = [show.hsn && l.hsnSac && `HSN ${esc(l.hsnSac)}`, showTax && `GST ${formatPercent(l.taxRateBp)}`, disc && `Disc. ${disc}`].filter(Boolean).join(' · ')
        return `<tr><td colspan="3"><strong>${i + 1}. ${name}</strong>${desc}${details}</td></tr>
        <tr class="item-line"><td class="muted">${qty} × ${money(l.rate)}${extra ? `<div class="small">${extra}</div>` : ''}</td><td></td><td class="r">${money(l.total)}</td></tr>`
      }
      return `<tr>
        ${serial ? `<td>${i + 1}</td>` : ''}
        <td>${name}${desc}${details}${thermal ? '' : hsn}</td>
        <td class="r">${qty}</td>
        <td class="r">${money(l.rate)}</td>
        ${hasDiscount ? `<td class="r hide-thermal">${disc}</td>` : ''}
        ${taxCol ? `<td class="r hide-thermal">${formatPercent(l.taxRateBp)}</td>` : ''}
        <td class="r">${money(l.total)}</td>
      </tr>`
    })
    .join('')
  const head = itemised
    ? '<th colspan="2">Item</th><th class="r">Amount</th>'
    : `${serial ? '<th>#</th>' : ''}<th>Item</th><th class="r">Qty</th><th class="r">Rate</th>
      ${hasDiscount ? '<th class="r hide-thermal">Disc.</th>' : ''}
      ${taxCol ? '<th class="r hide-thermal">GST</th>' : ''}
      <th class="r">Amount</th>`

  const totals: [string, number][] = []
  totals.push([inv.pricesIncludeTax ? 'Taxable value' : 'Sub total', inv.taxableTotal])
  if (inv.discountTotal > 0 && !inv.pricesIncludeTax) totals.unshift(['Gross amount', inv.subtotal], ['Discount', -inv.discountTotal])
  for (const c of inv.charges) totals.push([c.name, c.amount])
  if (showTax) {
    if (intra) totals.push(['CGST', inv.cgst], ['SGST', inv.sgst])
    else totals.push(['IGST', inv.igst])
    if (inv.cess) totals.push(['Cess', inv.cess])
  }
  if (inv.roundOff) totals.push(['Round off', inv.roundOff])

  const summary = showTax && show.taxSummary
    ? `<div class="hide-thermal"><div class="label" style="margin-top:12px">Tax summary</div>
       <table class="summary"><tr><th>GST rate</th><th>Taxable</th>${intra ? '<th>CGST</th><th>SGST</th>' : '<th>IGST</th>'}${inv.cess ? '<th>Cess</th>' : ''}</tr>
       ${taxSummary(inv)
         .map(
           (g) => `<tr><td>${formatPercent(g.rateBp)}</td><td class="r">${money(g.taxable)}</td>${
             intra ? `<td class="r">${money(g.cgst)}</td><td class="r">${money(g.sgst)}</td>` : `<td class="r">${money(g.igst)}</td>`
           }${inv.cess ? `<td class="r">${money(g.cess)}</td>` : ''}</tr>`
         )
         .join('')}</table></div>`
    : ''

  const bank = show.bankDetails && d.bank && !purchase
    ? `<div><div class="label" style="margin-top:12px">Bank details</div><div class="small">${[
        d.bank.bankName && esc(d.bank.bankName),
        d.bank.accountNo && `A/c: ${esc(d.bank.accountNo)}`,
        d.bank.ifsc && `IFSC: ${esc(d.bank.ifsc)}`,
        d.bank.upiId && `UPI: ${esc(d.bank.upiId)}`
      ]
        .filter(Boolean)
        .join('<br>')}</div></div>`
    : ''
  // A QR code customers scan with any UPI app to pay what is due.
  const due = inv.balanceDue
  const upi = show.upiQr && d.bank?.upiId && !purchase && !info.returnOf && due > 0
    ? `<div class="upi">${qrSvg(upiPayLink(d.bank.upiId, b.name, due, inv.number ? `${info.noun} ${inv.number}` : info.noun))}Scan to pay ${formatINR(due)}</div>`
    : ''

  const bodyClass = [thermal ? `thermal th-${s.thermalTheme}` : `theme-${s.theme}`].join(' ')
  const vars = `:root { --accent: ${thermal ? '#000' : s.colour}; --accent-soft: ${thermal ? 'transparent' : soften(s.colour, 0.12)}; } body { font-size: ${SIZES[s.textSize] - (thermal ? 1 : 0)}px; }`

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number || title)}</title>
<style>${pageCss}${STYLE}${vars}</style></head>
<body class="${bodyClass}"><div class="page">
  <div class="doc-title">${title}</div>
  <div class="top">
    <div class="biz">${show.logo && b.logo ? `<img class="logo" src="${b.logo}" alt="">` : ''}<div><h1>${esc(b.name)}</h1><div class="small">${bizLines.join('<br>')}</div></div></div>
    <div class="title"><h2>${title}</h2>
      <table class="meta">
        <tr><td class="muted">${esc(info.noun)} no.</td><td><strong>${esc(inv.number)}</strong></td></tr>
        <tr><td class="muted">Date</td><td>${fmtDate(inv.date)}${time ? ` ${time}` : ''}</td></tr>
        ${dueLabel && inv.dueDate && inv.dueDate !== inv.date ? `<tr><td class="muted">${dueLabel}</td><td>${fmtDate(inv.dueDate)}</td></tr>` : ''}
        ${refs}
        ${extraRows}
        ${d.gstRegistered ? `<tr><td class="muted">Place of supply</td><td>${esc(stateName(inv.placeOfSupply))}</td></tr>` : ''}
      </table>
    </div>
  </div>
  <div class="parties">
    <div><div class="label">${purchase ? 'Supplier' : 'Bill to'}</div>${partyLines.join('<br>')}</div>
    ${show.shipTo && p.shippingAddress ? `<div><div class="label">Ship to</div>${lines(p.shippingAddress)}</div>` : ''}
  </div>
  <table class="items">
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="bottom">
    <div class="left">
      ${show.amountInWords ? `<div class="words"><div class="label">Amount in words</div>${amountInWords(inv.grandTotal)}</div>` : ''}
      ${summary}
      ${bank || upi ? `<div class="pay">${thermal ? '' : upi}${bank}</div>` : ''}
      ${show.notes && inv.notes ? `<div class="label" style="margin-top:12px">Notes</div><div class="small">${lines(inv.notes)}</div>` : ''}
      ${show.terms && inv.terms ? `<div class="label" style="margin-top:12px">Terms &amp; conditions</div><div class="small">${lines(inv.terms)}</div>` : ''}
    </div>
    <table class="totals">
      ${totals.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${money(v)}</td></tr>`).join('')}
      <tr class="grand"><td>Total</td><td class="r">${formatINR(inv.grandTotal)}</td></tr>
      ${show.receivedBalance && inv.paidAmount ? `<tr><td>${esc(info.paidWord || 'Received')}</td><td class="r">${money(inv.paidAmount)}</td></tr>
      <tr><td><strong>Balance</strong></td><td class="r"><strong>${money(inv.balanceDue)}</strong></td></tr>` : ''}
    </table>
    ${thermal ? upi : ''}
  </div>
  ${show.signature ? `<div class="sign${show.signatureOnBill ? '' : ' hide-thermal'}"><div>For ${esc(b.name)}</div>${b.signature ? `<img src="${b.signature}" alt="">` : ''}<div class="line">Authorised signatory</div></div>` : ''}
  ${s.footer.trim() ? `<div class="footer">${lines(s.footer.trim())}</div>` : ''}
</div></body></html>`
}
