// GSTR-1 as JSON in the layout used by the GST portal's offline tool. Amounts are rupees with two
// decimals, dates dd-mm-yyyy, rates in percent. Check the file in the offline tool before uploading.
import type { Gstr1, RateRow, ReturnDoc } from './gstReturns'

const rs = (paise: number) => Math.round(paise) / 100
const dmy = (iso: string) => iso.split('-').reverse().join('-')
const pct = (bp: number) => bp / 100

function itms(rates: RateRow[], inter: boolean) {
  return rates.map((r, i) => ({
    num: i + 1,
    itm_det: inter
      ? { rt: pct(r.rateBp), txval: rs(r.taxable), iamt: rs(r.igst), csamt: rs(r.cess) }
      : { rt: pct(r.rateBp), txval: rs(r.taxable), camt: rs(r.cgst), samt: rs(r.sgst), csamt: rs(r.cess) }
  }))
}
const isInter = (d: ReturnDoc) => d.supply === 'inter'

/** Group documents by customer GSTIN, as B2B and CDNR need. */
function byGstin(docs: ReturnDoc[]): Map<string, ReturnDoc[]> {
  const m = new Map<string, ReturnDoc[]>()
  for (const d of docs) m.set(d.gstin, [...(m.get(d.gstin) ?? []), d])
  return m
}

export function gstr1Json(g: Gstr1): Record<string, unknown> {
  const out: Record<string, unknown> = { gstin: g.gstin, fp: g.period }

  if (g.b2b.length) {
    out.b2b = [...byGstin(g.b2b)].map(([ctin, docs]) => ({
      ctin,
      inv: docs.map((d) => ({
        inum: d.number, idt: dmy(d.date), val: rs(d.value), pos: d.pos, rchrg: 'N', inv_typ: 'R', itms: itms(d.rates, isInter(d))
      }))
    }))
  }
  if (g.b2cl.length) {
    const byPos = new Map<string, ReturnDoc[]>()
    for (const d of g.b2cl) byPos.set(d.pos, [...(byPos.get(d.pos) ?? []), d])
    out.b2cl = [...byPos].map(([pos, docs]) => ({
      pos,
      inv: docs.map((d) => ({ inum: d.number, idt: dmy(d.date), val: rs(d.value), itms: itms(d.rates, true) }))
    }))
  }
  if (g.b2cs.length) {
    out.b2cs = g.b2cs.map((r) => ({
      sply_ty: r.supply === 'inter' ? 'INTER' : 'INTRA', pos: r.pos, typ: 'OE', rt: pct(r.rateBp), txval: rs(r.taxable),
      ...(r.supply === 'inter' ? { iamt: rs(r.igst) } : { camt: rs(r.cgst), samt: rs(r.sgst) }), csamt: rs(r.cess)
    }))
  }
  if (g.cdnr.length) {
    out.cdnr = [...byGstin(g.cdnr)].map(([ctin, docs]) => ({
      ctin,
      nt: docs.map((d) => ({
        ntty: 'C', nt_num: d.number, nt_dt: dmy(d.date), val: rs(d.value), pos: d.pos, rchrg: 'N', inv_typ: 'R', itms: itms(d.rates, isInter(d))
      }))
    }))
  }
  if (g.cdnur.length) {
    out.cdnur = g.cdnur.map((d) => ({ typ: 'B2CL', ntty: 'C', nt_num: d.number, nt_dt: dmy(d.date), val: rs(d.value), pos: d.pos, itms: itms(d.rates, true) }))
  }
  if (g.nil.length) {
    out.nil = { inv: g.nil.map((n) => ({ sply_ty: n.supply, expt_amt: rs(n.exempt), nil_amt: rs(n.nil), ngsup_amt: rs(n.nonGst) })) }
  }
  if (g.hsn.length) {
    const rows = (b2b: boolean) =>
      g.hsn
        .filter((h) => h.b2b === b2b)
        .map((h, i) => ({
          num: i + 1, hsn_sc: h.hsn, desc: h.description.slice(0, 30), uqc: h.uqc, qty: h.qty / 1000, rt: pct(h.rateBp),
          txval: rs(h.taxable), iamt: rs(h.igst), camt: rs(h.cgst), samt: rs(h.sgst), csamt: rs(h.cess)
        }))
    out.hsn = { hsn_b2b: rows(true), hsn_b2c: rows(false) }
  }
  if (g.docs.length) {
    const byNum = new Map<number, typeof g.docs>()
    for (const d of g.docs) byNum.set(d.docNum, [...(byNum.get(d.docNum) ?? []), d])
    out.doc_issue = {
      doc_det: [...byNum].map(([doc_num, docs]) => ({
        doc_num,
        docs: docs.map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.total - d.cancelled }))
      }))
    }
  }
  return out
}
