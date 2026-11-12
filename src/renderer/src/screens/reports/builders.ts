// Turn report data into the table layout shared by the screen, print/PDF and CSV.
import type { BillType, StockSummary } from '@shared/models'
import { formatPercent } from '@shared/money'
import { stateName } from '@shared/states'
import type { Gstr1, Gstr3b, ReturnDoc, TaxAmounts } from '@shared/gstReturns'
import type { ReportDoc, ReportRow, ReportSection } from '@shared/reportDoc'
import { AGE_BUCKETS, type Ageing, type DayBook, type GstSide, type GstSummary, type ItemSales, type ProfitLoss, type Register } from '@shared/reports'

/** Leave out the named money columns when every row and the total are zero (e.g. IGST for a local shop). */
function dropZeroColumns(doc: ReportDoc, labels: string[]): ReportDoc {
  for (const s of doc.sections) {
    const drop = s.columns
      .map((c, i) => (labels.includes(c.label) && s.rows.every((r) => !r.cells[i]) && !s.total?.[i] ? i : -1))
      .filter((i) => i >= 0)
    if (!drop.length) continue
    const keep = <T,>(list: T[]) => list.filter((_, i) => !drop.includes(i))
    s.columns = keep(s.columns)
    s.rows = s.rows.map((r) => ({ ...r, cells: keep(r.cells) }))
    if (s.total) s.total = keep(s.total)
  }
  return doc
}

const STATUS: Record<string, string> = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid', overdue: 'Overdue' }

export function registerDoc(type: BillType, r: Register, subtitle: string): ReportDoc {
  const sale = type === 'SALE_INVOICE'
  const t = r.totals
  return dropZeroColumns({
    title: sale ? 'Sale register' : 'Purchase register',
    subtitle,
    sections: [{
      columns: [
        { label: 'Date' }, { label: sale ? 'Invoice' : 'Bill no.' }, { label: sale ? 'Party' : 'Supplier' }, { label: 'GSTIN' },
        { label: 'Taxable', kind: 'money' }, { label: 'CGST', kind: 'money' }, { label: 'SGST', kind: 'money' },
        { label: 'IGST', kind: 'money' }, { label: 'Cess', kind: 'money' }, { label: 'Total', kind: 'money' },
        { label: sale ? 'Received' : 'Paid', kind: 'money' }, { label: 'Balance', kind: 'money' }, { label: 'Status' }
      ],
      rows: r.rows.map((x) => ({
        cells: [x.date, x.number, x.partyName, x.gstin, x.taxable, x.cgst, x.sgst, x.igst, x.cess, x.total, x.paid, x.balance, STATUS[x.status]],
        link: { kind: sale ? 'sale' : 'purchase', id: x.id }
      })),
      total: [`${r.rows.length} ${sale ? 'invoices' : 'bills'}`, null, null, null, t.taxable, t.cgst, t.sgst, t.igst, t.cess, t.total, t.paid, t.balance, null],
      empty: sale ? 'No sale invoices in this period' : 'No purchase bills in this period'
    }]
  }, ['IGST', 'Cess'])
}

const DAYBOOK_LINK: Partial<Record<DayBook['rows'][number]['kind'], { kind: 'sale' | 'purchase' | 'expense'; billType?: string }>> = {
  sale: { kind: 'sale', billType: 'SALE_INVOICE' },
  sale_return: { kind: 'sale', billType: 'SALE_RETURN' },
  purchase: { kind: 'purchase', billType: 'PURCHASE_BILL' },
  purchase_return: { kind: 'purchase', billType: 'PURCHASE_RETURN' },
  expense: { kind: 'expense' }
}

export function dayBookDoc(b: DayBook, subtitle: string): ReportDoc {
  return {
    title: 'Day book',
    subtitle,
    sections: [{
      columns: [
        { label: 'Date' }, { label: 'Entry' }, { label: 'No.' }, { label: 'Party' }, { label: 'Amount', kind: 'money' },
        { label: 'Money in', kind: 'money' }, { label: 'Money out', kind: 'money' }
      ],
      rows: b.rows.map((r): ReportRow => ({
        cells: [r.date, r.label, r.number, r.party, r.amount, r.moneyIn || null, r.moneyOut || null],
        link: DAYBOOK_LINK[r.kind] ? { ...DAYBOOK_LINK[r.kind]!, id: r.sourceId } : undefined
      })),
      total: [`${b.rows.length} entries`, null, null, null, null, b.moneyIn, b.moneyOut],
      empty: 'Nothing was entered in this period'
    }]
  }
}

export function ageingDoc(a: Ageing): ReportDoc {
  const rec = a.side === 'receivable'
  return {
    title: rec ? 'Receivables ageing' : 'Payables ageing',
    subtitle: `As of ${a.asOf} · by days past the due date`,
    sections: [{
      columns: [
        { label: rec ? 'Customer' : 'Supplier' }, { label: 'Phone' },
        ...AGE_BUCKETS.map((label) => ({ label, kind: 'money' as const })),
        { label: 'On account', kind: 'money' }, { label: rec ? 'Total to receive' : 'Total to pay', kind: 'money' }
      ],
      rows: a.rows.map((r) => ({
        cells: [r.name, r.phone, ...r.buckets.map((n) => n || null), r.onAccount || null, r.total],
        link: r.partyId ? { kind: 'party', id: r.partyId } : undefined
      })),
      total: ['Total', null, ...a.totals.buckets, a.totals.onAccount, a.totals.total],
      empty: rec ? 'Nobody owes you money' : 'You owe nothing to suppliers'
    }]
  }
}

export function profitLossDoc(p: ProfitLoss, subtitle: string): ReportDoc {
  const row = (label: string, amount: number, strong = false): ReportRow => ({ cells: [label, amount], strong })
  return {
    title: 'Profit & loss',
    subtitle,
    sections: [
      {
        heading: 'Trading',
        columns: [{ label: '' }, { label: 'Amount', kind: 'money' }],
        rows: [
          row('Sales (before GST, less returns)', p.sales),
          row('Opening stock', p.openingStock),
          row('+ Purchases (before GST, less returns)', p.purchases),
          row('− Closing stock', p.closingStock),
          row('Cost of goods sold', p.costOfGoodsSold, true),
          row(p.grossProfit >= 0 ? 'Gross profit' : 'Gross loss', p.grossProfit, true)
        ]
      },
      {
        heading: 'Expenses and other',
        columns: [{ label: '' }, { label: 'Amount', kind: 'money' }],
        rows: [
          row('Round-off on bills', p.roundOff),
          ...p.expenses.map((e) => row(`− ${e.category}`, e.amount)),
          row('Total expenses', p.totalExpenses, true),
          row(p.netProfit >= 0 ? 'Net profit' : 'Net loss', p.netProfit, true)
        ]
      }
    ]
  }
}

function gstSection(heading: string, s: GstSide, empty: string) {
  return {
    heading: `${heading} · ${s.bills} bill${s.bills === 1 ? '' : 's'}`,
    columns: [
      { label: 'GST rate' }, { label: 'Taxable value', kind: 'money' as const }, { label: 'CGST', kind: 'money' as const },
      { label: 'SGST', kind: 'money' as const }, { label: 'IGST', kind: 'money' as const }, { label: 'Cess', kind: 'money' as const },
      { label: 'Total tax', kind: 'money' as const }
    ],
    rows: s.byRate.map((r) => ({
      cells: [r.rateBp === 0 ? '0% / exempt' : formatPercent(r.rateBp), r.taxable, r.cgst, r.sgst, r.igst, r.cess, r.cgst + r.sgst + r.igst + r.cess]
    })),
    total: ['Total', s.taxable, s.cgst, s.sgst, s.igst, s.cess, s.cgst + s.sgst + s.igst + s.cess],
    empty
  }
}

export function gstDoc(g: GstSummary, subtitle: string): ReportDoc {
  const n = g.net
  return dropZeroColumns({
    title: 'GST summary',
    subtitle,
    sections: [
      gstSection('Output tax on sales', g.outward, 'No sales in this period'),
      gstSection('Input tax credit on purchases', g.inward, 'No purchases in this period'),
      {
        heading: 'Net GST (output − input)',
        columns: [{ label: '' }, { label: 'CGST', kind: 'money' }, { label: 'SGST', kind: 'money' }, { label: 'IGST', kind: 'money' }, { label: 'Cess', kind: 'money' }, { label: 'Total', kind: 'money' }],
        rows: [{ cells: [n.total >= 0 ? 'Payable' : 'Credit carried forward', n.cgst, n.sgst, n.igst, n.cess, n.total], strong: true }]
      }
    ]
  }, ['Cess'])
}

export function itemSalesDoc(s: ItemSales, subtitle: string): ReportDoc {
  const margin = (profit: number, sales: number) => (sales ? `${((profit / sales) * 100).toFixed(1)}%` : '')
  return {
    title: 'Item-wise sales & profit',
    subtitle: `${subtitle} · cost at average purchase price`,
    sections: [{
      columns: [
        { label: 'Item' }, { label: 'Qty sold', kind: 'qty' }, { label: 'Unit' }, { label: 'Sales (before GST)', kind: 'money' },
        { label: 'Cost', kind: 'money' }, { label: 'Profit', kind: 'money' }, { label: 'Margin', kind: 'number' }
      ],
      rows: s.rows.map((r) => ({ cells: [r.name, r.qty, r.unit, r.sales, r.cost, r.profit, margin(r.profit, r.sales)] })),
      total: ['Total', null, null, s.sales, s.cost, s.profit, margin(s.profit, s.sales)],
      empty: 'No sales in this period'
    }]
  }
}

export function stockDoc(s: StockSummary): ReportDoc {
  return {
    title: 'Stock summary',
    subtitle: `As of ${s.asOf} · valued at average cost`,
    sections: [{
      columns: [
        { label: 'Item' }, { label: 'Category' }, { label: 'Quantity', kind: 'qty' }, { label: 'Unit' }, { label: 'Avg. cost', kind: 'money' },
        { label: 'Stock value', kind: 'money' }, { label: 'Sale value', kind: 'money' }, { label: 'Low stock' }
      ],
      rows: s.rows.map((r) => ({ cells: [r.name, r.category, r.qty, r.unit, r.avgCost, r.value, r.saleValue, r.low ? 'Low' : ''] })),
      total: ['Total', null, null, null, null, s.totalValue, s.totalSaleValue, s.lowCount ? `${s.lowCount} low` : ''],
      empty: 'No items track stock'
    }]
  }
}

// ---------- GST returns ----------

const posName = (code: string) => (code ? `${code}-${stateName(code)}` : '')
const rateText = (bp: number) => formatPercent(bp)
const TAX_COLS = [
  { label: 'Taxable', kind: 'money' as const }, { label: 'IGST', kind: 'money' as const }, { label: 'CGST', kind: 'money' as const },
  { label: 'SGST', kind: 'money' as const }, { label: 'Cess', kind: 'money' as const }
]
const taxCells = (t: TaxAmounts) => [t.taxable, t.igst, t.cgst, t.sgst, t.cess]
const sumTax = (rows: TaxAmounts[]) =>
  rows.reduce((s, r) => ({ taxable: s.taxable + r.taxable, igst: s.igst + r.igst, cgst: s.cgst + r.cgst, sgst: s.sgst + r.sgst, cess: s.cess + r.cess }), {
    taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0
  })

function docSection(heading: string, docs: ReturnDoc[], withGstin: boolean, kind: 'sale' | 'note', empty: string): ReportSection {
  return {
    heading: `${heading} · ${docs.length}`,
    columns: [
      ...(withGstin ? [{ label: 'GSTIN' }, { label: 'Customer' }] : []),
      { label: kind === 'sale' ? 'Invoice' : 'Note' }, { label: 'Date' }, { label: 'Value', kind: 'money' as const },
      { label: 'Place of supply' }, { label: 'Rate' }, ...TAX_COLS
    ],
    rows: docs.flatMap((d) =>
      d.rates.map((r, i) => ({
        cells: [
          ...(withGstin ? [i ? '' : d.gstin, i ? '' : d.partyName] : []),
          i ? '' : d.number, i ? '' : d.date, i ? null : d.value, i ? '' : posName(d.pos), rateText(r.rateBp), ...taxCells(r)
        ],
        link: { kind: 'sale' as const, id: d.id, billType: kind === 'sale' ? 'SALE_INVOICE' : 'SALE_RETURN' }
      }))
    ),
    total: [
      ...(withGstin ? ['Total', null] : ['Total']), ...(withGstin ? [null] : []), null,
      docs.reduce((s, d) => s + d.value, 0), null, null, ...taxCells(sumTax(docs.flatMap((d) => d.rates)))
    ],
    empty
  }
}

export function gstr1Doc(g: Gstr1, subtitle: string): ReportDoc {
  return {
    title: 'GSTR-1',
    subtitle: `${subtitle} · return period ${g.period.slice(0, 2)}/${g.period.slice(2)}${g.gstin ? ` · GSTIN ${g.gstin}` : ''}`,
    notes: g.warnings,
    sections: [
      docSection('4A · B2B invoices (registered customers)', g.b2b, true, 'sale', 'No sales to registered customers'),
      docSection('5 · B2C large (inter-state to unregistered, over ₹1 lakh)', g.b2cl, false, 'sale', 'None'),
      {
        heading: '7 · B2C others (unregistered customers, net of their credit notes)',
        columns: [{ label: 'Type' }, { label: 'Place of supply' }, { label: 'Rate' }, ...TAX_COLS],
        rows: g.b2cs.map((r) => ({ cells: [r.supply === 'inter' ? 'Inter-state' : 'Intra-state', posName(r.pos), rateText(r.rateBp), ...taxCells(r)] })),
        total: ['Total', null, null, ...taxCells(sumTax(g.b2cs))],
        empty: 'None'
      },
      docSection('9B · Credit notes to registered customers (CDNR)', g.cdnr, true, 'note', 'None'),
      ...(g.cdnur.length ? [docSection('9B · Credit notes to unregistered customers (CDNUR)', g.cdnur, false, 'note', 'None')] : []),
      {
        heading: '8 · Nil-rated, exempted and non-GST supplies',
        columns: [{ label: 'Supply' }, { label: 'Nil rated', kind: 'money' }, { label: 'Exempted', kind: 'money' }, { label: 'Non-GST', kind: 'money' }],
        rows: g.nil.map((n) => ({ cells: [n.description, n.nil, n.exempt, n.nonGst] })),
        empty: 'None'
      },
      {
        heading: '12 · HSN summary',
        columns: [{ label: 'Table' }, { label: 'HSN/SAC' }, { label: 'Description' }, { label: 'UQC' }, { label: 'Qty', kind: 'qty' }, { label: 'Rate' }, ...TAX_COLS],
        rows: g.hsn.map((h) => ({ cells: [h.b2b ? 'B2B' : 'B2C', h.hsn || '(missing)', h.description, h.uqc, h.uqc === 'NA' ? null : h.qty, rateText(h.rateBp), ...taxCells(h)] })),
        total: ['Total', null, null, null, null, null, ...taxCells(sumTax(g.hsn))],
        empty: 'None'
      },
      {
        heading: '13 · Documents issued',
        columns: [{ label: 'Nature of document' }, { label: 'From' }, { label: 'To' }, { label: 'Total', kind: 'number' }, { label: 'Cancelled', kind: 'number' }, { label: 'Net issued', kind: 'number' }],
        rows: g.docs.map((d) => ({ cells: [d.nature, d.from, d.to, d.total, d.cancelled, d.total - d.cancelled] })),
        empty: 'None'
      }
    ]
  }
}

export function gstr3bDoc(g: Gstr3b, subtitle: string): ReportDoc {
  const none = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
  const valueOnly = (v: number) => ({ ...none, taxable: v })
  return {
    title: 'GSTR-3B',
    subtitle: `${subtitle} · return period ${g.period.slice(0, 2)}/${g.period.slice(2)}`,
    sections: [
      {
        heading: '3.1 · Outward supplies',
        columns: [{ label: 'Nature of supplies' }, { label: 'Total taxable value', kind: 'money' }, ...TAX_COLS.slice(1)],
        rows: [
          { cells: ['(a) Outward taxable supplies (other than zero-rated, nil-rated and exempted)', ...taxCells(g.outwardTaxable)] },
          { cells: ['(b) Outward taxable supplies (zero-rated)', ...taxCells(none)] },
          { cells: ['(c) Other outward supplies (nil-rated, exempted)', ...taxCells(valueOnly(g.outwardNilExempt))] },
          { cells: ['(d) Inward supplies (liable to reverse charge)', ...taxCells(none)] },
          { cells: ['(e) Non-GST outward supplies', ...taxCells(valueOnly(g.outwardNonGst))] }
        ]
      },
      {
        heading: '3.2 · Inter-state supplies to unregistered persons',
        columns: [{ label: 'Place of supply' }, { label: 'Taxable value', kind: 'money' }, { label: 'IGST', kind: 'money' }],
        rows: g.interStateUnregistered.map((p) => ({ cells: [posName(p.pos), p.taxable, p.igst] })),
        empty: 'None'
      },
      {
        heading: '4 · Eligible ITC',
        columns: [{ label: 'Details' }, { label: 'IGST', kind: 'money' }, { label: 'CGST', kind: 'money' }, { label: 'SGST', kind: 'money' }, { label: 'Cess', kind: 'money' }],
        rows: [
          { cells: ['(A)(5) All other ITC (purchases and expenses, less debit notes)', g.itc.igst, g.itc.cgst, g.itc.sgst, g.itc.cess] },
          { cells: ['(B) ITC reversed', 0, 0, 0, 0] },
          { cells: ['(C) Net ITC available', g.itc.igst, g.itc.cgst, g.itc.sgst, g.itc.cess], strong: true }
        ]
      },
      {
        heading: '5 · Exempt, nil-rated and non-GST inward supplies',
        columns: [{ label: 'Nature of supplies' }, { label: 'Inter-state', kind: 'money' }, { label: 'Intra-state', kind: 'money' }],
        rows: [{ cells: ['From suppliers (nil-rated, exempted, non-GST)', g.inwardExempt.inter, g.inwardExempt.intra] }]
      },
      {
        heading: '6.1 · Payment of tax',
        columns: [
          { label: 'Tax' }, { label: 'Tax payable', kind: 'money' }, { label: 'Paid from IGST credit', kind: 'money' },
          { label: 'From CGST credit', kind: 'money' }, { label: 'From SGST credit', kind: 'money' }, { label: 'From cess credit', kind: 'money' },
          { label: 'Paid in cash', kind: 'money' }
        ],
        rows: g.setOff.map((r) => ({ cells: [r.head.toUpperCase(), r.liability, r.fromIgst, r.fromCgst, r.fromSgst, r.fromCess, r.cash] })),
        total: ['Total', g.setOff.reduce((s, r) => s + r.liability, 0), null, null, null, null, g.cashPayable]
      },
      {
        heading: 'Input credit carried forward',
        columns: [{ label: '' }, { label: 'IGST', kind: 'money' }, { label: 'CGST', kind: 'money' }, { label: 'SGST', kind: 'money' }, { label: 'Cess', kind: 'money' }],
        rows: [{ cells: ['To next month', g.creditCarriedForward.igst, g.creditCarriedForward.cgst, g.creditCarriedForward.sgst, g.creditCarriedForward.cess] }]
      }
    ]
  }
}
