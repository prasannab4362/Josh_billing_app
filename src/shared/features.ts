// Optional parts of bills and records, switched on in Settings: transport and PO details,
// the time on prints, profit while billing, and fields of the business's own for parties and items.

export interface CustomField {
  on: boolean
  label: string
  /** Print it on invoices (under the party, or under the item). */
  print: boolean
}

export interface FeatureSettings {
  /** Print the time the bill was made next to its date. */
  showTime: boolean
  /** Show the profit on a sale invoice while making it (sale price minus purchase price). */
  showProfit: boolean
  /** Transporter, vehicle no., e-way bill no. and delivery date on bills. */
  transport: boolean
  /** Customer's purchase order number and date on sale bills. */
  poDetails: boolean
  partyFields: CustomField[]
  itemFields: CustomField[]
}

export const CUSTOM_FIELD_COUNT = 4

const blankFields = (): CustomField[] => Array.from({ length: CUSTOM_FIELD_COUNT }, () => ({ on: false, label: '', print: true }))

export const DEFAULT_FEATURES: FeatureSettings = {
  showTime: false,
  showProfit: false,
  transport: false,
  poDetails: false,
  partyFields: blankFields(),
  itemFields: blankFields()
}

export function completeFeatures(saved: Partial<FeatureSettings> | null | undefined): FeatureSettings {
  const s = saved ?? {}
  const fields = (list: CustomField[] | undefined) =>
    blankFields().map((d, i) => {
      const f = list?.[i]
      return f ? { on: !!f.on && !!String(f.label ?? '').trim(), label: String(f.label ?? '').trim().slice(0, 30), print: f.print !== false } : d
    })
  return {
    showTime: !!s.showTime,
    showProfit: !!s.showProfit,
    transport: !!s.transport,
    poDetails: !!s.poDetails,
    partyFields: fields(s.partyFields),
    itemFields: fields(s.itemFields)
  }
}

/** Transport and purchase-order details on a bill. */
export interface BillExtra {
  transportName?: string
  vehicleNo?: string
  ewayBillNo?: string
  deliveryDate?: string
  poNumber?: string
  poDate?: string
}
export const BILL_EXTRA_LABELS: Record<keyof BillExtra, string> = {
  transportName: 'Transport',
  vehicleNo: 'Vehicle no.',
  ewayBillNo: 'E-way bill no.',
  deliveryDate: 'Delivery date',
  poNumber: 'PO no.',
  poDate: 'PO date'
}
export const TRANSPORT_KEYS: (keyof BillExtra)[] = ['transportName', 'vehicleNo', 'ewayBillNo', 'deliveryDate']
export const PO_KEYS: (keyof BillExtra)[] = ['poNumber', 'poDate']

/** A problem with a bill's extra details, or ''. */
export function billExtraError(e: BillExtra | null | undefined): string {
  if (!e) return ''
  if (typeof e !== 'object') return 'Invalid transport details'
  for (const [k, v] of Object.entries(e)) {
    if (!(k in BILL_EXTRA_LABELS)) return `Unknown detail "${k}"`
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string' || v.length > 60) return `${BILL_EXTRA_LABELS[k as keyof BillExtra]} can be at most 60 characters`
  }
  if (e.ewayBillNo && !/^\d{12}$/.test(e.ewayBillNo.replace(/\s/g, ''))) return 'E-way bill number has 12 digits'
  for (const k of ['deliveryDate', 'poDate'] as const) {
    if (e[k] && !/^\d{4}-\d{2}-\d{2}$/.test(e[k]!)) return `${BILL_EXTRA_LABELS[k]} must be a date`
  }
  return ''
}

export function cleanBillExtra(e: BillExtra | null | undefined): BillExtra | null {
  if (!e) return null
  const out: BillExtra = {}
  for (const k of Object.keys(BILL_EXTRA_LABELS) as (keyof BillExtra)[]) {
    const v = e[k]?.trim()
    if (v) out[k] = k === 'ewayBillNo' ? v.replace(/\s/g, '') : k === 'vehicleNo' ? v.toUpperCase() : v
  }
  return Object.keys(out).length ? out : null
}

/** Values of a record's own fields, by position; checks their length. */
export function cleanCustomValues(values: string[] | null | undefined): string[] | null {
  if (!values) return null
  if (!Array.isArray(values) || values.length > CUSTOM_FIELD_COUNT) throw new Error('Invalid extra fields')
  const out = values.map((v) => {
    const t = String(v ?? '').trim()
    if (t.length > 100) throw new Error('Extra fields can be at most 100 characters')
    return t
  })
  return out.some(Boolean) ? out : null
}

/** "Label: value" for each switched-on field with a value (and printing on, when asked). */
export function customFieldLines(fields: CustomField[], values: string[] | null | undefined, forPrint: boolean): string[] {
  if (!values) return []
  return fields
    .map((f, i) => (f.on && (!forPrint || f.print) && values[i] ? `${f.label}: ${values[i]}` : ''))
    .filter(Boolean)
}
