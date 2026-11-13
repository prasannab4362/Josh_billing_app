import { useEffect, useMemo, useState } from 'react'
import type { Business, PaymentDirection, PaymentSummary } from '@shared/models'
import { formatINR } from '@shared/money'
import { api, errorMessage } from '../../api'
import { Icon, PageTitle } from '../../components/Icon'
import { Banner } from '../../components/Field'
import { PERIODS, periodRange, type PeriodKey } from '../../periods'
import { MODES, PaymentForm } from './PaymentForm'

const MODE_LABEL = Object.fromEntries(MODES.map((m) => [m.value, m.label]))

export function PaymentsPage({ business, startNew }: { business: Business; startNew?: PaymentDirection }) {
  const [direction, setDirection] = useState<PaymentDirection>(startNew ?? 'in')
  const [period, setPeriod] = useState<PeriodKey>('fy')
  const [search, setSearch] = useState('')
  const [list, setList] = useState<PaymentSummary[]>([])
  const [editing, setEditing] = useState<{ id: string | null } | null>(startNew ? { id: null } : null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const load = () =>
    api
      .listPayments({ ...periodRange(period, business.fyStartMonth), direction })
      .then(setList, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  useEffect(() => {
    load()
  }, [direction, period])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter((p) => !q || p.number.toLowerCase().includes(q) || p.partyName.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q))
  }, [list, search])
  const total = list.reduce((s, p) => s + p.amount, 0)
  const unallocated = list.reduce((s, p) => s + p.unallocated, 0)
  const isIn = direction === 'in'

  return (
    <div>
      <div className="page-head">
        <PageTitle icon="wallet" tone="green" title="Payments" sub="Money received and paid, set against bills" />
        <span className="spacer" />
        <button className="btn" onClick={() => { setDirection('out'); setEditing({ id: null }) }}><Icon name="arrowOut" size={17} />Payment out</button>
        <button className="btn primary" onClick={() => { setDirection('in'); setEditing({ id: null }) }}><Icon name="arrowIn" size={17} />Payment in</button>
      </div>
      <nav className="tabs">
        <button className={isIn ? 'tab active' : 'tab'} onClick={() => setDirection('in')}><Icon name="arrowIn" size={16} />Received</button>
        <button className={isIn ? 'tab' : 'tab active'} onClick={() => setDirection('out')}><Icon name="arrowOut" size={16} />Paid</button>
      </nav>
      <div className="stats">
        <div className="stat">
          <div className="label">{isIn ? 'Total received' : 'Total paid'}</div>
          <div className={isIn ? 'value receive' : 'value pay'}>{formatINR(total)}</div>
        </div>
        <div className="stat">
          <div className="label">{isIn ? 'Advances not yet set against invoices' : 'Not yet set against bills'}</div>
          <div className="value">{formatINR(unallocated)}</div>
        </div>
      </div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" size={16} />
          <input className="input search" placeholder="Search number, party or reference" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      <div className="card wide" style={{ maxWidth: 'none', padding: 0 }}>
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>No.</th>
              <th>Party</th>
              <th>Account</th>
              <th>Mode</th>
              <th className="amount">Amount</th>
              <th className="amount">Unallocated</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} className="empty">{list.length ? 'No payments match' : 'No payments in this period.'}</td></tr>
            )}
            {shown.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => setEditing({ id: p.id })}>
                <td>{p.date}</td>
                <td>
                  {p.number}
                  {p.sourceDocId && <span className="badge">on {p.sourceDocNumber}</span>}
                </td>
                <td>{p.partyName}</td>
                <td>{p.accountName}</td>
                <td>{MODE_LABEL[p.mode]}{p.reference && <span className="muted"> · {p.reference}</span>}</td>
                <td className="amount">{formatINR(p.amount)}</td>
                <td className="amount">{p.unallocated ? formatINR(p.unallocated) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <PaymentForm
          direction={direction}
          paymentId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setEditing(null)
            setMessage({ kind: 'success', text: p ? `Payment ${p.number} saved` : 'Payment deleted' })
            load()
          }}
        />
      )}
    </div>
  )
}
