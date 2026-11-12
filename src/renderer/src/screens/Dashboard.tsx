import { useEffect, useState } from 'react'
import type { BillType, Business } from '@shared/models'
import type { DashboardData } from '@shared/reports'
import { formatINR } from '@shared/money'
import { formatQty } from '@shared/qty'
import { api, errorMessage } from '../api'
import { Banner } from '../components/Field'

export type Go = (
  page: 'Sale' | 'Purchase' | 'Parties' | 'Items' | 'Cash & Bank' | 'Reports' | 'Expenses',
  open?: { id?: string; new?: boolean; type?: BillType }
) => void

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Rupees without paise for chart axes: ₹12,500 → "₹12.5k". */
function shortINR(paise: number): string {
  const r = paise / 100
  if (r >= 1e7) return `₹${+(r / 1e7).toFixed(1)}Cr`
  if (r >= 1e5) return `₹${+(r / 1e5).toFixed(1)}L`
  if (r >= 1e3) return `₹${+(r / 1e3).toFixed(1)}k`
  return `₹${Math.round(r)}`
}

function SalesChart({ days }: { days: DashboardData['salesByDay'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 720
  const H = 180
  const top = 12
  const bottom = 22
  const left = 52
  const max = Math.max(...days.map((d) => d.total), 1)
  // A round axis maximum: 1, 2 or 5 × a power of ten.
  const pow = 10 ** Math.floor(Math.log10(max))
  const axisMax = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= max) ?? max
  const plotH = H - top - bottom
  const slot = (W - left) / days.length
  const barW = Math.max(slot - 4, 2)
  const y = (v: number) => top + plotH - (v / axisMax) * plotH
  const total = days.reduce((s, d) => s + d.total, 0)
  const h = hover !== null ? days[hover] : null

  return (
    <div className="chart">
      <div className="chart-head">
        <strong>Sales, last 30 days</strong>
        <span className="muted">{formatINR(total)} total</span>
        <span className="spacer" />
        {h && <span className="chart-tip"><span className="muted">{dayLabel(h.date)}</span> {formatINR(h.total)}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily sales for the last 30 days, ${formatINR(total)} in total`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={y(axisMax * f)} y2={y(axisMax * f)} className="grid" />
            <text x={left - 8} y={y(axisMax * f) + 4} className="axis" textAnchor="end">{shortINR(axisMax * f)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = left + i * slot + (slot - barW) / 2
          const bh = d.total > 0 ? Math.max(plotH - (y(d.total) - top), 2) : 0
          const r = Math.min(4, barW / 2, bh)
          const by = top + plotH - bh
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={left + i * slot} y={top} width={slot} height={plotH} fill="transparent" />
              {bh > 0 && (
                <path
                  className={hover === i ? 'bar on' : 'bar'}
                  d={`M${x},${top + plotH} V${by + r} Q${x},${by} ${x + r},${by} H${x + barW - r} Q${x + barW},${by} ${x + barW},${by + r} V${top + plotH} Z`}
                />
              )}
              {((i % 7 === 0 && i < days.length - 4) || i === days.length - 1) && (
                <text x={i === days.length - 1 ? W : x + barW / 2} y={H - 6} className="axis" textAnchor={i === days.length - 1 ? 'end' : 'middle'}>{i === days.length - 1 ? 'Today' : dayLabel(d.date)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function Dashboard({ business, go }: { business: Business; go: Go }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.dashboard().then(setData, (e) => setError(errorMessage(e)))
  }, [business.id])

  return (
    <div>
      <div className="page-head">
        <h1>{business.name}</h1>
        <span className="spacer" />
        <button className="btn" onClick={() => go('Purchase', { new: true })}>+ New purchase</button>
        <button className="btn primary" onClick={() => go('Sale', { new: true })}>+ New invoice</button>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      {data && (
        <>
          <div className="stats">
            <button className="stat link" onClick={() => go('Sale')}>
              <div className="label">Today's sales</div>
              <div className="value">{formatINR(data.todaySales)}</div>
              <div className="sub">{data.todaySalesCount} invoice{data.todaySalesCount === 1 ? '' : 's'} · {formatINR(data.monthSales)} this month</div>
            </button>
            <button className="stat link" onClick={() => go('Reports', { id: 'receivable' })}>
              <div className="label">To receive</div>
              <div className="value receive">{formatINR(data.receivable)}</div>
              <div className="sub">from customers</div>
            </button>
            <button className="stat link" onClick={() => go('Reports', { id: 'payable' })}>
              <div className="label">To pay</div>
              <div className="value pay">{formatINR(data.payable)}</div>
              <div className="sub">to suppliers · {formatINR(data.monthPurchases)} bought this month</div>
            </button>
            <button className="stat link" onClick={() => go('Cash & Bank')}>
              <div className="label">Cash & bank</div>
              <div className={data.cashBank < 0 ? 'value pay' : 'value'}>{formatINR(data.cashBank)}</div>
              <div className="sub">{data.accounts.map((a) => `${a.name} ${formatINR(a.balance)}`).join(' · ')}</div>
            </button>
          </div>

          <SalesChart days={data.salesByDay} />

          <div className="dash-grid">
            <div className="detail">
              <div className="detail-head">
                <h2>Overdue invoices</h2>
                <span className="spacer" />
                {data.overdue.count > 0 && <span className="pay"><strong>{formatINR(data.overdue.total)}</strong> · {data.overdue.count}</span>}
              </div>
              {data.overdue.count === 0 ? (
                <p className="muted">Nothing overdue.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Invoice</th><th>Party</th><th>Due</th><th className="amount">Balance</th></tr>
                  </thead>
                  <tbody>
                    {data.overdue.top.map((i) => (
                      <tr key={i.id} className="clickable" onClick={() => go('Sale', { id: i.id })}>
                        <td>{i.number}</td>
                        <td>{i.partyName}</td>
                        <td className="nowrap">{i.dueDate}</td>
                        <td className="amount pay">{formatINR(i.balanceDue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.overdue.count > data.overdue.top.length && (
                <button className="btn small" onClick={() => go('Reports', { id: 'receivable' })}>See all {data.overdue.count}</button>
              )}
            </div>
            <div className="detail">
              <div className="detail-head">
                <h2>Low stock</h2>
                <span className="spacer" />
                {data.lowStock.length > 0 && <span className="pay">{data.lowStock.length} item{data.lowStock.length === 1 ? '' : 's'}</span>}
              </div>
              {data.lowStock.length === 0 ? (
                <p className="muted">All items are above their alert level.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Item</th><th className="amount">In stock</th><th className="amount">Alert below</th></tr>
                  </thead>
                  <tbody>
                    {data.lowStock.slice(0, 8).map((s) => (
                      <tr key={s.itemId} className="clickable" onClick={() => go('Items')}>
                        <td>{s.name}</td>
                        <td className="amount pay">{formatQty(s.qty)} {s.unit}</td>
                        <td className="amount">{formatQty(s.lowStockQty)} {s.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
