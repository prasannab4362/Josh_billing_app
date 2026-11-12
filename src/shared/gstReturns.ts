// GSTR-1 (outward supplies, invoice by invoice) and GSTR-3B (monthly summary and tax payment).
// Money is paise; quantities milli-units; rates basis points.

export interface TaxAmounts {
  taxable: number
  igst: number
  cgst: number
  sgst: number
  cess: number
}

export interface RateRow extends TaxAmounts {
  rateBp: number
}

/** One invoice or note with its taxable value split by GST rate (rate > 0 only). */
export interface ReturnDoc {
  id: string
  number: string
  date: string
  partyName: string
  gstin: string
  /** Place of supply, state code. */
  pos: string
  supply: 'intra' | 'inter'
  value: number
  rates: RateRow[]
}

export interface B2csRow extends TaxAmounts {
  supply: 'intra' | 'inter'
  pos: string
  rateBp: number
}

export interface NilRow {
  /** e.g. "Inter-state to registered persons". */
  description: string
  supply: 'INTRB2B' | 'INTRAB2B' | 'INTRB2C' | 'INTRAB2C'
  nil: number
  exempt: number
  nonGst: number
}

export interface HsnRow extends TaxAmounts {
  hsn: string
  description: string
  /** GST unit quantity code, e.g. KGS, NOS. */
  uqc: string
  qty: number
  rateBp: number
  /** Since 2025 the HSN summary is reported separately for B2B and B2C. */
  b2b: boolean
}

export interface DocSeriesRow {
  nature: string
  docNum: number
  from: string
  to: string
  total: number
  cancelled: number
}

export interface Gstr1 {
  /** Return period as MMYYYY, from the end date. */
  period: string
  from: string
  to: string
  gstin: string
  b2b: ReturnDoc[]
  b2cl: ReturnDoc[]
  b2cs: B2csRow[]
  /** Credit notes to registered customers. */
  cdnr: ReturnDoc[]
  /** Credit notes to unregistered customers against large inter-state invoices. */
  cdnur: ReturnDoc[]
  nil: NilRow[]
  hsn: HsnRow[]
  docs: DocSeriesRow[]
  totals: TaxAmounts
  /** Things to look at before filing, e.g. a customer GSTIN that looks wrong. */
  warnings: string[]
}

export interface PosRow {
  pos: string
  taxable: number
  igst: number
}

export interface TaxHeads {
  igst: number
  cgst: number
  sgst: number
  cess: number
}

export interface SetOff {
  head: keyof TaxHeads
  liability: number
  /** Paid using input credit of each head. */
  fromIgst: number
  fromCgst: number
  fromSgst: number
  fromCess: number
  cash: number
}

export interface Gstr3b {
  period: string
  from: string
  to: string
  /** 3.1(a) Outward taxable supplies (other than zero-rated, nil-rated and exempted). */
  outwardTaxable: TaxAmounts
  /** 3.1(c) Nil-rated and exempted outward supplies. */
  outwardNilExempt: number
  /** 3.1(e) Non-GST outward supplies. */
  outwardNonGst: number
  /** 3.2 Inter-state supplies to unregistered persons, by place of supply. */
  interStateUnregistered: PosRow[]
  /** 4(A)(5) All other ITC. */
  itc: TaxHeads
  /** 5 Inward nil/exempt/non-GST supplies. */
  inwardExempt: { inter: number; intra: number }
  /** 6.1 How the tax is paid: input credit first, the rest in cash. */
  setOff: SetOff[]
  cashPayable: number
  /** Input credit left over, carried to next month. */
  creditCarriedForward: TaxHeads
}
