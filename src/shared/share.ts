// Sharing with customers: the product catalogue page, WhatsApp message texts and links.
import type { Business, Invoice, MoneyAccount, Party } from './models'
import { BILL_INFO, type BillType } from './billTypes'
import { formatINR } from './money'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmtDate = (iso: string) => (iso ? iso.split('-').reverse().join('-') : '')

// ---------- Catalogue ----------

export interface CatalogueItem {
  name: string
  description: string
  category: string
  /** Price the customer pays, GST included, paise. */
  price: number
  mrp: number | null
  unit: string
  photo: string | null
}

export interface CatalogueOptions {
  title: string
  /** Shown under the title, e.g. "Prices valid till 30 November". */
  note: string
  columns: 2 | 3 | 4
  showPrice: boolean
  showMrp: boolean
  showDescription: boolean
  /** Group items under their category headings. */
  byCategory: boolean
}

export const DEFAULT_CATALOGUE: CatalogueOptions = {
  title: 'Our products', note: '', columns: 3, showPrice: true, showMrp: true, showDescription: true, byCategory: true
}

/** An A4 catalogue: business header, then item cards in a grid, grouped by category if asked. */
export function catalogueHtml(items: CatalogueItem[], o: CatalogueOptions, b: Pick<Business, 'name' | 'phone' | 'address' | 'city' | 'logo' | 'gstin'>): string {
  const card = (i: CatalogueItem) => {
    const off = o.showMrp && i.mrp && i.mrp > i.price ? Math.round(((i.mrp - i.price) / i.mrp) * 100) : 0
    return `<div class="card">
      <div class="ph">${i.photo ? `<img src="${i.photo}" alt="">` : `<span>${esc(i.name.slice(0, 1).toUpperCase())}</span>`}</div>
      <div class="nm">${esc(i.name)}</div>
      ${o.showDescription && i.description ? `<div class="ds">${esc(i.description)}</div>` : ''}
      ${o.showPrice ? `<div class="pr"><b>${formatINR(i.price)}</b>${i.unit ? `<small>/${esc(i.unit)}</small>` : ''}${o.showMrp && i.mrp && i.mrp > i.price ? ` <s>${formatINR(i.mrp)}</s>` : ''}</div>` : ''}
      ${off ? `<div class="off">${off}% off</div>` : ''}
    </div>`
  }
  const groups = new Map<string, CatalogueItem[]>()
  for (const i of items) {
    const g = o.byCategory ? i.category || 'Other items' : ''
    groups.set(g, [...(groups.get(g) ?? []), i])
  }
  const body = [...groups.entries()]
    .map(([g, list]) => `${g ? `<h2>${esc(g)}</h2>` : ''}<div class="grid">${list.map(card).join('')}</div>`)
    .join('')
  const contact = [b.phone && `☎ ${esc(b.phone)}`, [b.address, b.city].filter(Boolean).map(esc).join(', '), b.gstin && `GSTIN ${esc(b.gstin)}`].filter(Boolean).join(' · ')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; margin: 0; }
body { font-family: 'Segoe UI', 'Nirmala UI', Arial, sans-serif; color: #1f2328; font-size: 12px; }
header { display: flex; gap: 16px; align-items: center; border-bottom: 3px solid #1f2937; padding-bottom: 10px; margin-bottom: 8px; }
header img { max-width: 110px; max-height: 70px; object-fit: contain; }
header h1 { font-size: 22px; }
header .c { color: #555; margin-top: 3px; }
.title { font-size: 18px; font-weight: 700; margin: 10px 0 2px; }
.note { color: #555; margin-bottom: 6px; }
h2 { font-size: 14px; margin: 14px 0 6px; padding: 4px 8px; background: #f1f3f5; border-radius: 4px; break-after: avoid; }
.grid { display: grid; grid-template-columns: repeat(${o.columns}, 1fr); gap: 10px; }
.card { border: 1px solid #dee2e6; border-radius: 8px; padding: 8px; break-inside: avoid; display: flex; flex-direction: column; gap: 4px; }
.ph { height: ${o.columns === 4 ? 100 : o.columns === 3 ? 130 : 180}px; background: #f8f9fa; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.ph img { max-width: 100%; max-height: 100%; object-fit: contain; }
.ph span { font-size: 42px; font-weight: 800; color: #adb5bd; }
.nm { font-weight: 700; font-size: 13px; }
.ds { color: #555; font-size: 11px; white-space: pre-line; }
.pr b { font-size: 15px; }
.pr small { color: #666; }
.pr s { color: #888; margin-left: 4px; }
.off { align-self: flex-start; background: #e03131; color: #fff; font-weight: 700; font-size: 11px; padding: 1px 8px; border-radius: 10px; }
footer { margin-top: 14px; color: #666; text-align: center; }
</style></head><body>
<header>${b.logo ? `<img src="${b.logo}" alt="">` : ''}<div><h1>${esc(b.name)}</h1><div class="c">${contact}</div></div></header>
<div class="title">${esc(o.title)}</div>${o.note.trim() ? `<div class="note">${esc(o.note.trim())}</div>` : ''}
${body || '<p>No items chosen.</p>'}
<footer>Prices include GST. Order on WhatsApp${b.phone ? `: ${esc(b.phone)}` : ''}.</footer>
</body></html>`
}

// ---------- WhatsApp ----------

/** Indian mobile number → digits for wa.me (91 + 10 digits); '' when it is not a mobile number. */
export function whatsappNumber(phone: string): string {
  const d = phone.replace(/\D/g, '').replace(/^0+/, '')
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`
  if (/^91[6-9]\d{9}$/.test(d)) return d
  return ''
}

/** A wa.me link that opens WhatsApp with the message typed in (to the number, or asking whom to send to). */
export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(text)}`
}

/** The message sent with a bill. */
export function billMessage(type: BillType, inv: Invoice, b: Pick<Business, 'name' | 'phone'>, bank: MoneyAccount | null): string {
  const info = BILL_INFO[type]
  const lines = [
    `Dear ${inv.party.name},`,
    '',
    `${info.noun} ${inv.number ? `${inv.number} ` : ''}dated ${fmtDate(inv.date)}: ${formatINR(inv.grandTotal)}.`
  ]
  if (info.posts && !info.returnOf) {
    if (inv.paidAmount) lines.push(`${info.paidWord || 'Received'}: ${formatINR(inv.paidAmount)}.`)
    if (inv.balanceDue > 0) lines.push(`Balance due: ${formatINR(inv.balanceDue)}${inv.dueDate && inv.dueDate !== inv.date ? ` by ${fmtDate(inv.dueDate)}` : ''}.`)
    if (inv.balanceDue > 0 && info.side === 'sale' && bank?.upiId) lines.push(`Pay by UPI to ${bank.upiId}.`)
  }
  lines.push('', `The ${info.noun.toLowerCase()} PDF is attached.`, '', `Thank you,`, b.name + (b.phone ? ` (${b.phone})` : ''))
  return lines.join('\n')
}

/** A friendly reminder of what a party owes (or, for a supplier, what we owe is not sent). */
export function reminderMessage(p: Pick<Party, 'name' | 'balance'>, b: Pick<Business, 'name' | 'phone'>, bank: MoneyAccount | null): string {
  const lines = [`Dear ${p.name},`, '', `This is a gentle reminder that ${formatINR(p.balance)} is due to ${b.name}.`]
  if (bank?.upiId) lines.push(`You can pay by UPI to ${bank.upiId}.`)
  if (bank?.accountNo) lines.push(`Bank: ${[bank.bankName, `A/c ${bank.accountNo}`, bank.ifsc && `IFSC ${bank.ifsc}`].filter(Boolean).join(', ')}.`)
  lines.push('', 'Please ignore if already paid. Thank you!', b.name + (b.phone ? ` (${b.phone})` : ''))
  return lines.join('\n')
}

/** Business details laid out for copying into a Google Business Profile. */
export function googleProfileFields(b: Business): { label: string; value: string; hint: string }[] {
  return [
    { label: 'Business name', value: b.name, hint: 'Use the name on your shop board.' },
    { label: 'Phone', value: b.phone ? `+91 ${b.phone}` : '', hint: 'Customers can call or WhatsApp you.' },
    { label: 'Address', value: [b.address, b.city, b.pincode].filter(Boolean).join(', '), hint: 'Google may send a postcard or ask for a video to verify it.' },
    { label: 'Email', value: b.email, hint: '' },
    { label: 'GSTIN', value: b.gstin, hint: 'Not shown on Google, but handy if asked for proof of business.' }
  ]
}

export const GOOGLE_BUSINESS_URL = 'https://www.google.com/business/'

/**
 * The only web pages the app opens in the browser: a WhatsApp chat (wa.me), Google Business, and Google review
 * or map links for the business. Parsed rather than matched by prefix, so redirect pages (google.com/url?q=…),
 * other ports, user names inside links and look-alike hosts are all refused.
 */
export function isSafeExternalUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(String(raw ?? ''))
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const path = u.pathname
  switch (u.hostname) {
    case 'wa.me': return /^\/\d{0,15}$/.test(path)
    case 'www.google.com': return path === '/business/' || path.startsWith('/business/') || path.startsWith('/maps/place/')
    case 'business.google.com': return true
    case 'g.page': return /^\/(r\/)?[A-Za-z0-9_-]+(\/review)?\/?$/.test(path)
    case 'search.google.com': return path === '/local/writereview' || path === '/local/reviews'
    case 'maps.app.goo.gl': return /^\/[A-Za-z0-9_-]+$/.test(path)
    default: return false
  }
}
