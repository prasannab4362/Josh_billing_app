// Importing items and parties from a spreadsheet: the columns each template has, and the result
// of checking a file before anything is saved.

export type ImportKind = 'items' | 'parties'

export interface ImportColumn {
  key: string
  title: string
  required?: boolean
  /** What to put in it, shown in the template's "How to fill" sheet. */
  hint: string
  /** Other headings accepted for this column (compared ignoring case, spaces and symbols). */
  aliases: string[]
}

export const ITEM_COLUMNS: ImportColumn[] = [
  { key: 'name', title: 'Item name', required: true, hint: 'Required. Matched with existing items to update them.', aliases: ['name', 'item', 'product', 'product name'] },
  { key: 'code', title: 'Item code', hint: 'Optional, unique. Existing items are matched by code first.', aliases: ['code', 'sku', 'item code'] },
  { key: 'barcode', title: 'Barcode', hint: 'Optional, unique.', aliases: ['ean', 'barcode no'] },
  { key: 'category', title: 'Category', hint: 'Created if new.', aliases: ['group', 'item category'] },
  { key: 'kind', title: 'Type', hint: 'Goods or Service. Blank = Goods.', aliases: ['item type', 'product or service'] },
  { key: 'hsn', title: 'HSN/SAC', hint: '4, 6 or 8 digits.', aliases: ['hsn', 'sac', 'hsn code', 'hsn sac code'] },
  { key: 'unit', title: 'Unit', hint: 'Short name such as pcs, kg, box (from Settings › Units). Blank = pcs.', aliases: ['uom', 'units', 'base unit'] },
  { key: 'salePrice', title: 'Sale price', hint: 'Rupees, e.g. 450 or 450.50.', aliases: ['selling price', 'price', 'rate', 'sale rate'] },
  { key: 'purchasePrice', title: 'Purchase price', hint: 'Rupees.', aliases: ['cost', 'cost price', 'purchase rate', 'buying price'] },
  { key: 'mrp', title: 'MRP', hint: 'Rupees. Optional.', aliases: ['max retail price'] },
  { key: 'gst', title: 'GST %', hint: '0, 5, 12, 18 or 28 (or a tax rate name). Blank = no tax rate.', aliases: ['gst', 'tax', 'tax rate', 'gst rate', 'tax %'] },
  { key: 'includesTax', title: 'Price includes GST', hint: 'Yes or No. Blank = your setting.', aliases: ['inclusive', 'tax inclusive', 'price includes tax', 'including tax'] },
  { key: 'wholesalePrice', title: 'Wholesale price', hint: 'Rupees. Optional.', aliases: ['wholesale'] },
  { key: 'wholesaleMinQty', title: 'Wholesale min qty', hint: 'Needed with a wholesale price.', aliases: ['min wholesale qty', 'minimum wholesale quantity'] },
  { key: 'openingQty', title: 'Opening stock', hint: 'Quantity in stock now. Goods only.', aliases: ['stock', 'opening quantity', 'quantity', 'qty', 'current stock'] },
  { key: 'openingRate', title: 'Opening stock rate', hint: 'Cost per unit of that stock. Blank = purchase price.', aliases: ['stock rate', 'at price'] },
  { key: 'lowStock', title: 'Low stock alert', hint: 'Warn when stock falls to this.', aliases: ['min stock', 'minimum stock', 'reorder level'] },
  { key: 'description', title: 'Description', hint: 'Printed under the item name on bills.', aliases: ['details', 'item description'] }
]

export const PARTY_COLUMNS: ImportColumn[] = [
  { key: 'name', title: 'Party name', required: true, hint: 'Required. Matched with existing parties to update them.', aliases: ['name', 'customer', 'supplier', 'customer name', 'party'] },
  { key: 'kind', title: 'Type', hint: 'Customer, Supplier or Both. Blank = Customer.', aliases: ['party type'] },
  { key: 'phone', title: 'Phone', hint: '10-digit mobile number.', aliases: ['mobile', 'phone number', 'contact', 'contact number', 'mobile number'] },
  { key: 'email', title: 'Email', hint: 'Optional.', aliases: ['email id', 'mail'] },
  { key: 'gstin', title: 'GSTIN', hint: 'Optional. Fills the state when it is blank.', aliases: ['gst number', 'gst no', 'gstin no'] },
  { key: 'state', title: 'State', hint: 'State name or 2-digit code, e.g. Tamil Nadu or 33.', aliases: ['state name', 'place of supply'] },
  { key: 'address', title: 'Billing address', hint: 'Optional.', aliases: ['address'] },
  { key: 'shipping', title: 'Shipping address', hint: 'Optional.', aliases: ['delivery address'] },
  { key: 'opening', title: 'Opening balance', hint: 'Rupees. Use the next column to say who owes whom.', aliases: ['balance', 'opening', 'due'] },
  { key: 'balanceType', title: 'Balance type', hint: 'To receive (they owe you) or To pay (you owe them). Blank = To receive; a minus amount = To pay.', aliases: ['receive or pay', 'dr cr', 'balance side'] },
  { key: 'creditLimit', title: 'Credit limit', hint: 'Rupees. Optional.', aliases: [] },
  { key: 'creditDays', title: 'Credit days', hint: 'Payment term in days, 0 to 365.', aliases: ['payment terms', 'due days', 'payment term days'] },
  { key: 'group', title: 'Group', hint: 'Optional, created if new.', aliases: ['party group'] }
]

export const IMPORT_COLUMNS: Record<ImportKind, ImportColumn[]> = { items: ITEM_COLUMNS, parties: PARTY_COLUMNS }

/** Heading text for matching: lower case, letters and digits only. */
export const headingKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, '')

/** Which column each heading in the file is, by position (null = not one we know). */
export function matchHeadings(kind: ImportKind, headings: string[]): (string | null)[] {
  const cols = IMPORT_COLUMNS[kind]
  const lookup = new Map<string, string>()
  for (const c of cols) for (const h of [c.title, c.key, ...c.aliases]) lookup.set(headingKey(h), c.key)
  const seen = new Set<string>()
  return headings.map((h) => {
    const key = lookup.get(headingKey(h ?? '')) ?? null
    if (!key || seen.has(key)) return null
    seen.add(key)
    return key
  })
}

export interface ImportRowResult {
  /** Row number as Excel shows it. */
  row: number
  name: string
  action: 'create' | 'update' | 'error'
  errors: string[]
  /** What changes on an update, e.g. "Sale price ₹430.00 → ₹450.00". */
  changes: string[]
}

export interface ImportPreview {
  kind: ImportKind
  fileName: string
  /** Column titles found in the file, and headings that were not understood (ignored). */
  columns: string[]
  ignored: string[]
  rows: ImportRowResult[]
  creates: number
  updates: number
  errors: number
  /** Hands the checked rows to commitImport. */
  token: string
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
}

// ---------- Bulk update of items ----------

/** Fields that can be changed for many items at once. Money in paise, quantities in milli-units. */
export interface ItemBulkChange {
  id: string
  salePrice?: number
  purchasePrice?: number
  mrp?: number | null
  wholesalePrice?: number | null
  wholesaleMinQty?: number | null
  taxRateId?: string | null
  priceIncludesTax?: boolean
  hsnSac?: string
  category?: string
  lowStockQty?: number | null
}
