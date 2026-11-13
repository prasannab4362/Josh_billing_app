import { useEffect, useState } from 'react'
import type { BillType, Business } from '@shared/models'
import { formatCell, isNumeric, type ReportDoc, type ReportRow } from '@shared/reportDoc'
import { todayLocal } from '@shared/fy'
import { api, errorMessage } from '../../api'
import { Banner } from '../../components/Field'
import { Icon, PageTitle, type IconName } from '../../components/Icon'
import { PERIODS, periodRange, type PeriodKey } from '../../periods'
import type { Go } from '../Dashboard'
import { ageingDoc, dayBookDoc, gstDoc, gstr1Doc, gstr3bDoc, itemSalesDoc, profitLossDoc, registerDoc, stockDoc } from './builders'

const REPORT_ICON: Record<string, IconName> = {
  sales: 'receipt', purchases: 'cart', daybook: 'calendar', receivable: 'arrowIn', payable: 'arrowOut', pl: 'trendUp',
  gst: 'percent', gstr1: 'file', gstr3b: 'shield', items: 'tag', stock: 'box'
}

export type ReportKey = 'sales' | 'purchases' | 'daybook' | 'receivable' | 'payable' | 'pl' | 'gst' | 'gstr1' | 'gstr3b' | 'items' | 'stock'

const REPORTS: { key: ReportKey; label: string; group: string; period: 'range' | 'none' | 'asOf' }[] = [
  { key: 'sales', label: 'Sale register', group: 'Transactions', period: 'range' },
  { key: 'purchases', label: 'Purchase register', group: 'Transactions', period: 'range' },
  { key: 'daybook', label: 'Day book', group: 'Transactions', period: 'range' },
  { key: 'receivable', label: 'Receivables ageing', group: 'Parties', period: 'none' },
  { key: 'payable', label: 'Payables ageing', group: 'Parties', period: 'none' },
  { key: 'pl', label: 'Profit & loss', group: 'Accounts', period: 'range' },
  { key: 'gst', label: 'GST summary', group: 'Accounts', period: 'range' },
  { key: 'gstr1', label: 'GSTR-1', group: 'GST returns', period: 'range' },
  { key: 'gstr3b', label: 'GSTR-3B', group: 'GST returns', period: 'range' },
  { key: 'items', label: 'Item-wise sales & profit', group: 'Stock', period: 'range' },
  { key: 'stock', label: 'Stock summary', group: 'Stock', period: 'asOf' }
]

type Choice = PeriodKey | 'today' | 'custom'
const CHOICES: { key: Choice; label: string }[] = [{ key: 'today', label: 'Today' }, ...PERIODS, { key: 'custom', label: 'Custom dates' }]

const prettyDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function describe(from: string, to: string): string {
  if (!from && !to) return 'All dates'
  if (from === to) return prettyDate(from)
  return `${from ? prettyDate(from) : 'Start'} – ${to ? prettyDate(to) : 'today'}`
}

async function build(key: ReportKey, from: string, to: string): Promise<ReportDoc> {
  const period = { from: from || undefined, to: to || undefined }
  const sub = describe(from, to)
  switch (key) {
    case 'sales': return registerDoc('SALE_INVOICE', await api.billRegister('SALE_INVOICE', period), sub)
    case 'purchases': return registerDoc('PURCHASE_BILL', await api.billRegister('PURCHASE_BILL', period), sub)
    case 'daybook': return dayBookDoc(await api.dayBook(period), sub)
    case 'receivable': return ageingDoc(await api.ageing('receivable'))
    case 'payable': return ageingDoc(await api.ageing('payable'))
    case 'pl': return profitLossDoc(await api.profitLoss(period), sub)
    case 'gst': return gstDoc(await api.gstSummary(period), sub)
    case 'gstr1': return gstr1Doc(await api.gstr1(period), sub)
    case 'gstr3b': return gstr3bDoc(await api.gstr3b(period), sub)
    case 'items': return itemSalesDoc(await api.itemSales(period), sub)
    case 'stock': return stockDoc(await api.stockSummary(to || todayLocal()))
  }
}

export function ReportsPage({ business, initial, go }: { business: Business; initial?: ReportKey; go: Go }) {
  const [key, setKey] = useState<ReportKey>(initial ?? 'sales')
  const [choice, setChoice] = useState<Choice>('month')
  const start = periodRange('month', business.fyStartMonth)
  const [from, setFrom] = useState(start.from ?? '')
  const [to, setTo] = useState(start.to ?? '')
  const [doc, setDoc] = useState<ReportDoc | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const report = REPORTS.find((r) => r.key === key)!

  const pick = (c: Choice) => {
    setChoice(c)
    if (c === 'custom') return
    const r = c === 'today' ? { from: todayLocal(), to: todayLocal() } : periodRange(c, business.fyStartMonth)
    setFrom(r.from ?? '')
    setTo(r.to ?? '')
  }

  useEffect(() => {
    let live = true
    setMessage(null)
    build(key, from, report.period === 'asOf' ? to || todayLocal() : to).then(
      (d) => live && setDoc(d),
      (e) => live && (setDoc(null), setMessage({ kind: 'error', text: errorMessage(e) }))
    )
    return () => { live = false }
  }, [key, from, to])

  const run = async (what: 'pdf' | 'csv' | 'print' | 'json') => {
    if (!doc) return
    setBusy(true)
    try {
      if (what === 'json') {
        const path = await api.exportGstr1Json({ from: from || undefined, to: to || undefined })
        if (path) setMessage({ kind: 'success', text: `Saved ${path}. Check it in the GST offline tool before uploading.` })
      } else if (what === 'print') await api.printReport(doc)
      else {
        const path = await api.exportReport(doc, what)
        if (path) setMessage({ kind: 'success', text: `Saved ${path}` })
      }
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const open = (r: ReportRow) => {
    if (!r.link) return
    if (r.link.kind === 'party') go('Parties', { id: r.link.id })
    else if (r.link.kind === 'expense') go('Expenses')
    else go(r.link.kind === 'sale' ? 'Sale' : 'Purchase', { id: r.link.id, type: r.link.billType as BillType | undefined })
  }

  const groups = [...new Set(REPORTS.map((r) => r.group))]
  return (
    <div className="reports">
      <nav className="report-nav">
        {groups.map((g) => (
          <div key={g}>
            <div className="menu-label">{g}</div>
            {REPORTS.filter((r) => r.group === g).map((r) => (
              <button key={r.key} className={r.key === key ? 'nav active' : 'nav'} onClick={() => setKey(r.key)}><Icon name={REPORT_ICON[r.key] ?? 'chart'} size={17} />{r.label}</button>
            ))}
          </div>
        ))}
      </nav>
      <div className="report-body">
        <div className="page-head">
          <PageTitle icon={REPORT_ICON[key] ?? 'chart'} title={report.label} sub={report.group} />
          <span className="spacer" />
          {key === 'gstr1' && <button className="btn primary" disabled={!doc || busy} onClick={() => run('json')}><Icon name="download" size={17} />JSON for GST portal</button>}
          <button className="btn" disabled={!doc || busy} onClick={() => run('print')}><Icon name="printer" size={17} />Print</button>
          <button className="btn" disabled={!doc || busy} onClick={() => run('pdf')}><Icon name="file" size={17} />PDF</button>
          <button className="btn" disabled={!doc || busy} onClick={() => run('csv')}><Icon name="sheet" size={17} />Excel (CSV)</button>
        </div>
        {report.period === 'range' && (
          <div className="toolbar">
            <select className="input" value={choice} onChange={(e) => pick(e.target.value as Choice)} aria-label="Period">
              {CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <input type="date" className="input" value={from} aria-label="From" onChange={(e) => { setChoice('custom'); setFrom(e.target.value) }} />
            <span className="muted">to</span>
            <input type="date" className="input" value={to} aria-label="To" onChange={(e) => { setChoice('custom'); setTo(e.target.value) }} />
          </div>
        )}
        {report.period === 'asOf' && (
          <div className="toolbar">
            <label className="muted">Stock as of</label>
            <input type="date" className="input" value={to || todayLocal()} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        {message && <Banner kind={message.kind}>{message.text}</Banner>}
        {doc?.notes?.map((n) => <Banner key={n} kind="error">{n}</Banner>)}
        {doc && <ReportView doc={doc} onOpen={open} />}
      </div>
    </div>
  )
}

function ReportView({ doc, onOpen }: { doc: ReportDoc; onOpen: (r: ReportRow) => void }) {
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>{doc.subtitle}</p>
      {doc.sections.map((s, si) => {
        const cls = (i: number) => (isNumeric(s.columns[i]?.kind) ? 'amount' : '')
        const cell = (c: string | number | null, i: number) => {
          const text = formatCell(c, s.columns[i]?.kind)
          return typeof c === 'number' && c < 0 && s.columns[i]?.kind === 'money' ? <span className="pay">{text}</span> : text
        }
        return (
          <div key={si} className="card wide report-card">
            {s.heading && <h3>{s.heading}</h3>}
            <div className="report-scroll">
              <table className="table" style={{ margin: 0 }}>
                <thead>
                  <tr>{s.columns.map((c, i) => <th key={i} className={cls(i)}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {s.rows.length === 0 && <tr><td colSpan={s.columns.length} className="empty">{s.empty ?? 'Nothing in this period'}</td></tr>}
                  {s.rows.map((r, ri) => (
                    <tr key={ri} className={[r.link ? 'clickable' : '', r.strong ? 'strong' : ''].join(' ')} onClick={() => onOpen(r)}>
                      {r.cells.map((c, i) => <td key={i} className={[cls(i), i === 0 ? 'nowrap' : ''].join(' ')}>{cell(c, i)}</td>)}
                    </tr>
                  ))}
                </tbody>
                {s.total && s.rows.length > 0 && (
                  <tfoot>
                    <tr>{s.total.map((c, i) => <td key={i} className={cls(i)}><strong>{cell(c, i)}</strong></td>)}</tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

