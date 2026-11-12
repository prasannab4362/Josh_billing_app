// GSTR-1 and GSTR-3B, built from sale invoices, credit notes, purchase bills, debit notes and expenses.
// Credit notes to unregistered customers reduce B2CS (or go to CDNUR for large inter-state sales);
// credit notes to registered customers go to CDNR. GSTR-3B nets them all.
import type {
  B2csRow, DocSeriesRow, Gstr1, Gstr3b, HsnRow, NilRow, PosRow, RateRow, ReturnDoc, SetOff, TaxAmounts, TaxHeads
} from '@shared/gstReturns'
import { isValidGstin } from '@shared/gstin'
import { splitHalves } from '@shared/money'
import { toBaseUnits } from '@shared/qty'
import type { Period } from '@shared/ipc'
import type { DB } from '../db/connection'
import { UserError } from '../util'
import { getBusiness } from './business'

const DATE = /^\d{4}-\d{2}-\d{2}$/
/** B2CL: inter-state invoices to unregistered buyers above this value are reported one by one. */
export const B2CL_LIMIT = 10_000_000 // ₹1,00,000

/** Our unit short names → GST unit quantity codes. */
const UQC: Record<string, string> = {
  pcs: 'PCS', nos: 'NOS', box: 'BOX', pkt: 'PAC', dzn: 'DOZ', set: 'SET', pair: 'PRS', kg: 'KGS', g: 'GMS', qtl: 'QTL',
  ton: 'TON', ltr: 'LTR', ml: 'MLT', m: 'MTR', cm: 'CMS', ft: 'OTH', sqft: 'SQF', bag: 'BAG', btl: 'BTL', roll: 'ROL'
}
export const uqcFor = (unit: string | null, service: boolean) => (service ? 'NA' : UQC[(unit ?? '').toLowerCase()] ?? 'OTH')

function range(period: Period): { from: string; to: string } {
  const { from, to } = period
  if (!from || !to || !DATE.test(from) || !DATE.test(to)) throw new UserError('Choose the return period')
  if (from > to) throw new UserError('The start date is after the end date')
  return { from, to }
}
const fp = (to: string) => `${to.slice(5, 7)}${to.slice(0, 4)}`
const zero = (): TaxAmounts => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 })
const add = (t: TaxAmounts, s: TaxAmounts, sign = 1) => {
  t.taxable += sign * s.taxable
  t.igst += sign * s.igst
  t.cgst += sign * s.cgst
  t.sgst += sign * s.sgst
  t.cess += sign * s.cess
}

interface Line {
  doc_id: string
  doc_type: string
  number: string | null
  date: string
  party_snapshot: string
  place_of_supply: string
  supply_type: 'intra' | 'inter'
  grand_total: number
  taxable: number
  rate: number
  cgst: number
  sgst: number
  igst: number
  cess: number
  kind: string
  hsn: string | null
  qty: number
  unit_factor: number
  description: string | null
  item_kind: string | null
  unit: string | null
  is_charge: number
}

interface Doc {
  id: string
  type: string
  number: string
  date: string
  name: string
  gstin: string
  pos: string
  supply: 'intra' | 'inter'
  value: number
  rates: Map<number, RateRow>
  nil: number
  exempt: number
  nonGst: number
  lines: Line[]
}

/** Lines and charges of the given document types in the period, grouped per document. */
function loadDocs(db: DB, types: string[], from: string, to: string): Doc[] {
  const list = types.map((t) => `'${t}'`).join(',')
  const rows = db
    .prepare(
      `SELECT d.id AS doc_id, d.doc_type, d.number, d.date, d.party_snapshot, d.place_of_supply, d.supply_type, d.grand_total,
              l.taxable_amount AS taxable, l.tax_rate_bp AS rate, l.cgst, l.sgst, l.igst, l.cess, COALESCE(t.kind, 'none') AS kind,
              COALESCE(NULLIF(l.hsn_sac, ''), i.hsn_sac) AS hsn, l.qty, l.unit_factor, COALESCE(i.name, l.description) AS description,
              i.kind AS item_kind, u.short AS unit, 0 AS is_charge, l.line_no AS ord
       FROM document d JOIN document_line l ON l.document_id = d.id
       LEFT JOIN tax_rate t ON t.id = l.tax_rate_id LEFT JOIN item i ON i.id = l.item_id LEFT JOIN unit u ON u.id = i.base_unit_id
       WHERE d.doc_type IN (${list}) AND d.deleted_at IS NULL AND d.date BETWEEN @from AND @to
       UNION ALL
       SELECT d.id, d.doc_type, d.number, d.date, d.party_snapshot, d.place_of_supply, d.supply_type, d.grand_total,
              c.amount, CASE WHEN c.tax_amount > 0 THEN COALESCE(t.rate_bp, 0) ELSE 0 END, c.tax_amount, 0, 0, 0, COALESCE(t.kind, 'none'),
              NULL, 0, 1000, c.name, 'service', NULL, 1, 1000 + c.rowid
       FROM document d JOIN document_charge c ON c.document_id = d.id LEFT JOIN tax_rate t ON t.id = c.tax_rate_id
       WHERE d.doc_type IN (${list}) AND d.deleted_at IS NULL AND d.date BETWEEN @from AND @to
       ORDER BY 4, 3, 1, ord`
    )
    .all({ from, to }) as (Line & { ord: number })[]

  const docs = new Map<string, Doc>()
  for (const r of rows) {
    if (r.is_charge) {
      // A charge keeps only its tax total (read into cgst above); split it the way the bill did.
      const tax = r.cgst
      if (r.supply_type === 'intra') ({ cgst: r.cgst, sgst: r.sgst } = splitHalves(tax))
      else (r.cgst = 0), (r.igst = tax)
    }
    let d = docs.get(r.doc_id)
    if (!d) {
      const snap = JSON.parse(r.party_snapshot) as { name: string; gstin?: string; paidTo?: string }
      d = {
        id: r.doc_id, type: r.doc_type, number: r.number ?? '', date: r.date, name: snap.name, gstin: (snap.gstin ?? '').toUpperCase(),
        pos: r.place_of_supply, supply: r.supply_type, value: r.grand_total, rates: new Map(), nil: 0, exempt: 0, nonGst: 0, lines: []
      }
      docs.set(r.doc_id, d)
    }
    d.lines.push(r)
    if (r.rate > 0) {
      let g = d.rates.get(r.rate)
      if (!g) d.rates.set(r.rate, (g = { rateBp: r.rate, ...zero() }))
      add(g, r)
    } else if (r.kind === 'exempt') d.exempt += r.taxable
    else if (r.kind === 'non_gst') d.nonGst += r.taxable
    else d.nil += r.taxable // GST 0%, nil-rated, or no rate chosen
  }
  return [...docs.values()]
}

const toReturnDoc = (d: Doc): ReturnDoc => ({
  id: d.id, number: d.number, date: d.date, partyName: d.name, gstin: d.gstin, pos: d.pos, supply: d.supply, value: d.value,
  rates: [...d.rates.values()].sort((a, b) => a.rateBp - b.rateBp)
})

function docSeries(db: DB, type: string, nature: string, docNum: number, from: string, to: string): DocSeriesRow[] {
  const rows = db
    .prepare('SELECT number, deleted_at FROM document WHERE doc_type = ? AND number IS NOT NULL AND date BETWEEN ? AND ?')
    .all(type, from, to) as { number: string; deleted_at: string | null }[]
  const byPrefix = new Map<string, { n: number; number: string; deleted: boolean }[]>()
  for (const r of rows) {
    const m = /^(.*?)(\d+)$/.exec(r.number)
    const prefix = m ? m[1] : r.number
    const list = byPrefix.get(prefix) ?? []
    list.push({ n: m ? Number(m[2]) : 0, number: r.number, deleted: !!r.deleted_at })
    byPrefix.set(prefix, list)
  }
  return [...byPrefix.values()].map((list) => {
    list.sort((a, b) => a.n - b.n)
    return { nature, docNum, from: list[0].number, to: list[list.length - 1].number, total: list.length, cancelled: list.filter((x) => x.deleted).length }
  })
}

export function gstr1(db: DB, period: Period): Gstr1 {
  const { from, to } = range(period)
  const business = getBusiness(db)
  const warnings: string[] = []
  const docs = loadDocs(db, ['SALE_INVOICE', 'SALE_RETURN'], from, to)

  const b2b: ReturnDoc[] = []
  const b2cl: ReturnDoc[] = []
  const cdnr: ReturnDoc[] = []
  const cdnur: ReturnDoc[] = []
  const b2cs = new Map<string, B2csRow>()
  const nil = new Map<NilRow['supply'], NilRow>()
  const hsn = new Map<string, HsnRow>()
  const totals = zero()
  let missingHsn = 0
  let charges = false
  let untaxedCharges = 0

  for (const d of docs) {
    const credit = d.type === 'SALE_RETURN'
    const sign = credit ? -1 : 1
    const registered = d.gstin !== ''
    if (registered && !isValidGstin(d.gstin)) warnings.push(`${d.number}: customer GSTIN ${d.gstin} does not look valid`)
    const large = !registered && d.supply === 'inter' && d.value > B2CL_LIMIT
    const taxable = d.rates.size > 0
    for (const r of d.rates.values()) add(totals, r, sign)

    if (taxable) {
      if (registered) (credit ? cdnr : b2b).push(toReturnDoc(d))
      else if (large) (credit ? cdnur : b2cl).push(toReturnDoc(d))
      else {
        for (const r of d.rates.values()) {
          const key = `${d.supply}|${d.pos}|${r.rateBp}`
          let g = b2cs.get(key)
          if (!g) b2cs.set(key, (g = { supply: d.supply, pos: d.pos, rateBp: r.rateBp, ...zero() }))
          add(g, r, sign)
        }
      }
    }

    if (d.nil || d.exempt || d.nonGst) {
      const supply = `${d.supply === 'inter' ? 'INTR' : 'INTRA'}${registered ? 'B2B' : 'B2C'}` as NilRow['supply']
      const label = `${d.supply === 'inter' ? 'Inter' : 'Intra'}-state to ${registered ? 'registered' : 'unregistered'} persons`
      let n = nil.get(supply)
      if (!n) nil.set(supply, (n = { description: label, supply, nil: 0, exempt: 0, nonGst: 0 }))
      n.nil += sign * d.nil
      n.exempt += sign * d.exempt
      n.nonGst += sign * d.nonGst
    }

    if (registered && business.gstin && d.gstin === business.gstin.toUpperCase()) warnings.push(`${d.number}: the customer GSTIN is your own GSTIN`)
    for (const l of d.lines) {
      if (l.is_charge) {
        charges = true
        if (l.rate === 0 && l.kind === 'none') untaxedCharges++
        continue
      }
      if (!l.hsn) missingHsn++
      const service = l.item_kind === 'service' || /^99/.test(l.hsn ?? '')
      const uqc = uqcFor(l.unit, service)
      const key = `${registered ? 'b2b' : 'b2c'}|${l.hsn ?? ''}|${uqc}|${l.rate}`
      let h = hsn.get(key)
      if (!h) hsn.set(key, (h = { hsn: l.hsn ?? '', description: l.description ?? '', uqc, qty: 0, rateBp: l.rate, b2b: registered, ...zero() }))
      h.qty += sign * (service ? 0 : toBaseUnits(l.qty, l.unit_factor))
      add(h, l, sign)
    }
  }
  if (missingHsn) warnings.push(`${missingHsn} line${missingHsn === 1 ? ' has' : 's have'} no HSN/SAC code. Add it to the items and the bills.`)
  if (untaxedCharges) {
    warnings.push(
      `${untaxedCharges} additional charge${untaxedCharges === 1 ? ' has' : 's have'} no GST rate and ${untaxedCharges === 1 ? 'is' : 'are'} shown as nil-rated. ` +
        'Delivery or packing charged with goods usually takes the GST rate of the goods.'
    )
  }
  if (charges) warnings.push('Additional charges (delivery, packing…) are in the totals but not in the HSN summary. Add them under their SAC code when filing.')
  if (!business.gstin) warnings.push('Add your business GSTIN in Settings › Business before exporting the JSON.')

  return {
    period: fp(to), from, to, gstin: business.gstin,
    b2b, b2cl, cdnr, cdnur,
    b2cs: [...b2cs.values()].filter((r) => r.taxable !== 0).sort((a, b) => a.pos.localeCompare(b.pos) || a.rateBp - b.rateBp),
    nil: [...nil.values()],
    hsn: [...hsn.values()].sort((a, b) => Number(b.b2b) - Number(a.b2b) || a.hsn.localeCompare(b.hsn) || a.rateBp - b.rateBp),
    docs: [
      ...docSeries(db, 'SALE_INVOICE', 'Invoices for outward supply', 1, from, to),
      ...docSeries(db, 'SALE_RETURN', 'Credit notes', 5, from, to),
      ...docSeries(db, 'DELIVERY_CHALLAN', 'Delivery challans (other cases)', 12, from, to)
    ],
    totals,
    warnings
  }
}

/** Use input credit against tax due in the order the GST rules allow; the rest is paid in cash. */
export function setOffTax(liability: TaxHeads, credit: TaxHeads): { rows: SetOff[]; cash: number; left: TaxHeads } {
  const due = { igst: Math.max(liability.igst, 0), cgst: Math.max(liability.cgst, 0), sgst: Math.max(liability.sgst, 0), cess: Math.max(liability.cess, 0) }
  const left = { igst: Math.max(credit.igst, 0), cgst: Math.max(credit.cgst, 0), sgst: Math.max(credit.sgst, 0), cess: Math.max(credit.cess, 0) }
  const rows: Record<keyof TaxHeads, SetOff> = {
    igst: { head: 'igst', liability: due.igst, fromIgst: 0, fromCgst: 0, fromSgst: 0, fromCess: 0, cash: 0 },
    cgst: { head: 'cgst', liability: due.cgst, fromIgst: 0, fromCgst: 0, fromSgst: 0, fromCess: 0, cash: 0 },
    sgst: { head: 'sgst', liability: due.sgst, fromIgst: 0, fromCgst: 0, fromSgst: 0, fromCess: 0, cash: 0 },
    cess: { head: 'cess', liability: due.cess, fromIgst: 0, fromCgst: 0, fromSgst: 0, fromCess: 0, cash: 0 }
  }
  const use = (from: keyof TaxHeads, against: keyof TaxHeads) => {
    const n = Math.min(left[from], due[against])
    left[from] -= n
    due[against] -= n
    const field = `from${from[0].toUpperCase()}${from.slice(1)}` as 'fromIgst'
    rows[against][field] += n
  }
  // IGST credit goes first (to IGST, then CGST, then SGST); CGST and SGST credit then cover their own
  // head and IGST, never each other; cess only pays cess.
  use('igst', 'igst')
  use('igst', 'cgst')
  use('igst', 'sgst')
  use('cgst', 'cgst')
  use('cgst', 'igst')
  use('sgst', 'sgst')
  use('sgst', 'igst')
  use('cess', 'cess')
  for (const h of ['igst', 'cgst', 'sgst', 'cess'] as const) rows[h].cash = due[h]
  return { rows: Object.values(rows), cash: due.igst + due.cgst + due.sgst + due.cess, left }
}

export function gstr3b(db: DB, period: Period): Gstr3b {
  const { from, to } = range(period)
  const outward = loadDocs(db, ['SALE_INVOICE', 'SALE_RETURN'], from, to)
  const outwardTaxable = zero()
  let outwardNilExempt = 0
  let outwardNonGst = 0
  const byPos = new Map<string, PosRow>()
  for (const d of outward) {
    const sign = d.type === 'SALE_RETURN' ? -1 : 1
    for (const r of d.rates.values()) {
      add(outwardTaxable, r, sign)
      if (d.supply === 'inter' && !d.gstin) {
        const p = byPos.get(d.pos) ?? { pos: d.pos, taxable: 0, igst: 0 }
        p.taxable += sign * r.taxable
        p.igst += sign * r.igst
        byPos.set(d.pos, p)
      }
    }
    outwardNilExempt += sign * (d.nil + d.exempt)
    outwardNonGst += sign * d.nonGst
  }

  const inward = loadDocs(db, ['PURCHASE_BILL', 'EXPENSE', 'PURCHASE_RETURN'], from, to)
  const itcAmounts = zero()
  const inwardExempt = { inter: 0, intra: 0 }
  for (const d of inward) {
    const sign = d.type === 'PURCHASE_RETURN' ? -1 : 1
    for (const r of d.rates.values()) add(itcAmounts, r, sign)
    inwardExempt[d.supply] += sign * (d.nil + d.exempt + d.nonGst)
  }
  const itc: TaxHeads = { igst: itcAmounts.igst, cgst: itcAmounts.cgst, sgst: itcAmounts.sgst, cess: itcAmounts.cess }
  const { rows, cash, left } = setOffTax(outwardTaxable, itc)

  return {
    period: fp(to), from, to, outwardTaxable, outwardNilExempt, outwardNonGst,
    interStateUnregistered: [...byPos.values()].filter((p) => p.taxable !== 0).sort((a, b) => a.pos.localeCompare(b.pos)),
    itc, inwardExempt, setOff: rows, cashPayable: cash, creditCarriedForward: left
  }
}
