// How invoices look when printed: layout, colour, text size and which parts are shown.
// Stored per business; the same settings drive the preview, printing and PDFs.

export type InvoiceTheme = 'classic' | 'boxed' | 'modern' | 'compact'
export type ThermalTheme = 'standard' | 'itemised'
export type TextSize = 'small' | 'medium' | 'large'

export const INVOICE_THEMES: Record<InvoiceTheme, { name: string; hint: string }> = {
  classic: { name: 'Classic', hint: 'Business on the left, invoice details on the right, light lines' },
  boxed: { name: 'Boxed', hint: 'Every section in a bordered box, full grid in the item table' },
  modern: { name: 'Modern', hint: 'Coloured header band and table heading' },
  compact: { name: 'Compact', hint: 'Small margins and tight rows, fits more items on a page' }
}
export const THERMAL_THEMES: Record<ThermalTheme, { name: string; hint: string }> = {
  standard: { name: 'Standard', hint: 'Item, qty, rate and amount on one line' },
  itemised: { name: 'Itemised', hint: 'Each item on its own line, with HSN and GST under it' }
}
export const ACCENT_COLOURS = ['#1f2937', '#1d4ed8', '#047857', '#b91c1c', '#7c3aed', '#c2410c', '#0e7490', '#be185d']

/** Parts of the invoice that can be left off. */
export interface PrintShow {
  logo: boolean
  businessAddress: boolean
  businessPhone: boolean
  businessEmail: boolean
  businessGstin: boolean
  partyPhone: boolean
  partyGstin: boolean
  shipTo: boolean
  serialNo: boolean
  hsn: boolean
  itemDescription: boolean
  /** Batch, dates, model, size and serial typed on the line. */
  itemDetails: boolean
  discountColumn: boolean
  taxColumn: boolean
  taxSummary: boolean
  amountInWords: boolean
  receivedBalance: boolean
  bankDetails: boolean
  /** A UPI QR code for the balance due, when the printed account has a UPI ID. */
  upiQr: boolean
  notes: boolean
  terms: boolean
  signature: boolean
}

export interface PrintSettings {
  theme: InvoiceTheme
  colour: string
  textSize: TextSize
  thermalTheme: ThermalTheme
  show: PrintShow
  /** Printed at the bottom of every invoice, e.g. "Thank you for shopping with us". */
  footer: string
  /** Filled into new sale invoices; can be changed on each bill. */
  defaultTerms: string
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  theme: 'classic',
  colour: '#1f2937',
  textSize: 'medium',
  thermalTheme: 'standard',
  show: {
    logo: true, businessAddress: true, businessPhone: true, businessEmail: true, businessGstin: true,
    partyPhone: true, partyGstin: true, shipTo: true, serialNo: true, hsn: true, itemDescription: true, itemDetails: true,
    discountColumn: true, taxColumn: true, taxSummary: true, amountInWords: true, receivedBalance: true,
    bankDetails: true, upiQr: true, notes: true, terms: true, signature: true
  },
  footer: '',
  defaultTerms: ''
}

export const SHOW_LABELS: Record<keyof PrintShow, string> = {
  logo: 'Logo',
  businessAddress: 'Business address',
  businessPhone: 'Business phone',
  businessEmail: 'Business email',
  businessGstin: 'Business GSTIN',
  partyPhone: 'Party phone',
  partyGstin: 'Party GSTIN',
  shipTo: 'Shipping address',
  serialNo: 'Serial number column (#)',
  hsn: 'HSN/SAC under items',
  itemDescription: 'Item description',
  itemDetails: 'Batch, dates, model, size, serial',
  discountColumn: 'Discount column',
  taxColumn: 'GST % column',
  taxSummary: 'Tax summary table',
  amountInWords: 'Amount in words',
  receivedBalance: 'Received and balance',
  bankDetails: 'Bank details',
  upiQr: 'UPI QR code to pay',
  notes: 'Notes',
  terms: 'Terms and conditions',
  signature: 'Signature and signatory'
}

/** Settings as saved, with anything missing (older saves, new switches) filled from the defaults. */
export function completePrintSettings(saved: Partial<PrintSettings> | null | undefined): PrintSettings {
  const s = saved ?? {}
  return {
    ...DEFAULT_PRINT_SETTINGS,
    ...s,
    theme: s.theme && s.theme in INVOICE_THEMES ? s.theme : DEFAULT_PRINT_SETTINGS.theme,
    thermalTheme: s.thermalTheme && s.thermalTheme in THERMAL_THEMES ? s.thermalTheme : DEFAULT_PRINT_SETTINGS.thermalTheme,
    colour: typeof s.colour === 'string' && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : DEFAULT_PRINT_SETTINGS.colour,
    show: { ...DEFAULT_PRINT_SETTINGS.show, ...(s.show ?? {}) }
  }
}

/** A problem with settings to be saved, or ''. */
export function printSettingsError(s: PrintSettings): string {
  if (!(s.theme in INVOICE_THEMES)) return 'Choose a layout'
  if (!(s.thermalTheme in THERMAL_THEMES)) return 'Choose a receipt layout'
  if (!/^#[0-9a-f]{6}$/i.test(s.colour)) return 'Choose a colour'
  if (!['small', 'medium', 'large'].includes(s.textSize)) return 'Choose a text size'
  if (s.footer.length > 200) return 'Footer can be at most 200 characters'
  if (s.defaultTerms.length > 2000) return 'Terms can be at most 2000 characters'
  for (const k of Object.keys(DEFAULT_PRINT_SETTINGS.show)) if (typeof s.show[k as keyof PrintShow] !== 'boolean') return 'Choose what to print'
  return ''
}

/** A UPI payment link (NPCI format) for an amount in paise; scanning its QR code opens any UPI app ready to pay. */
export function upiPayLink(upiId: string, payee: string, paise: number, note: string): string {
  const q = new URLSearchParams({ pa: upiId.trim(), pn: payee.slice(0, 50), am: (paise / 100).toFixed(2), cu: 'INR', tn: note.slice(0, 50) })
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`
}
