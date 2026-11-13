import { useEffect, useState } from 'react'
import type { BillType, Business, PaymentDirection } from '@shared/models'
import type { DashboardData } from '@shared/reports'
import { formatINR } from '@shared/money'
import { formatQty } from '@shared/qty'
import { api, errorMessage } from '../api'
import { Banner } from '../components/Field'
import { EmptyState, Icon, IconTile, type IconName, type Tone } from '../components/Icon'

export type Page =
  | 'Dashboard' | 'Parties' | 'Items' | 'Sale' | 'Payments' | 'Purchase' | 'Cash & Bank' | 'Expenses' | 'Reports' | 'Grow' | 'Settings'

export type Go = (
  page: Page,
  open?: { id?: string; new?: boolean; type?: BillType; direction?: PaymentDirection }
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

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function SalesChart({ days }: { days: DashboardData['salesByDay'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 760
  const H = 210
  const top = 14
  const bottom = 24
  const left = 54
  const max = Math.max(...days.map((d) => d.total), 1)
  // A round axis maximum: 1, 2 or 5 × a power of ten.
  const pow = 10 ** Math.floor(Math.log10(max))
  const axisMax = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= max) ?? max
  const plotH = H - top - bottom
  const slot = (W - left) / days.length
  const barW = Math.max(slot - 6, 2)
  const y = (v: number) => top + plotH - (v / axisMax) * plotH
  const total = days.reduce((s, d) => s + d.total, 0)
  const activeDays = days.filter((d) => d.total > 0).length
  const best = days.reduce((b, d) => (d.total > b.total ? d : b), days[0])
  const h = hover !== null ? days[hover] : null

  return (
    <div className="chart">
      <div className="chart-head">
        <IconTile name="trendUp" tone="accent" size="sm" />
        <div>
          <strong>Sales, last 30 days</strong>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {activeDays} day{activeDays === 1 ? '' : 's'} with sales
            {best && best.total > 0 ? ` · best day ${dayLabel(best.date)} (${formatINR(best.total)})` : ''}
          </div>
        </div>
        <span className="spacer" />
        {h ? (
          <span className="chart-tip"><span className="muted">{dayLabel(h.date)}</span> {formatINR(h.total)}</span>
        ) : (
          <span className="chart-total">{formatINR(total)}</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily sales for the last 30 days, ${formatINR(total)} in total`} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={y(axisMax * f)} y2={y(axisMax * f)} className="grid" />
            <text x={left - 10} y={y(axisMax * f) + 4} className="axis" textAnchor="end">{shortINR(axisMax * f)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = left + i * slot + (slot - barW) / 2
          const bh = d.total > 0 ? Math.max(plotH - (y(d.total) - top), 3) : 0
          const r = Math.min(5, barW / 2, bh)
          const by = top + plotH - bh
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={left + i * slot} y={top} width={slot} height={plotH} rx={6} className={hover === i ? 'hover-col on' : 'hover-col'} />
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

interface KpiProps {
  icon: IconName
  tone: Tone
  label: string
  value: string
  valueClass?: string
  sub: string
  onClick: () => void
}

function Kpi({ icon, tone, label, value, valueClass, sub, onClick }: KpiProps) {
  return (
    <button className="stat link kpi" onClick={onClick}>
      <div className="kpi-top">
        <IconTile name={icon} tone={tone} size="sm" />
        <span className="label">{label}</span>
        <Icon name="arrowOut" size={16} className="kpi-go" />
      </div>
      <div className={valueClass ? `value ${valueClass}` : 'value'}>{value}</div>
      <div className="sub">{sub}</div>
    </button>
  )
}

const QUICK: { icon: IconName; tone: Tone; label: string; hint: string; go: Parameters<Go> }[] = [
  { icon: 'receipt', tone: 'accent', label: 'Sale invoice', hint: 'Bill a customer', go: ['Sale', { new: true, type: 'SALE_INVOICE' }] },
  { icon: 'arrowIn', tone: 'green', label: 'Receive money', hint: 'Payment in', go: ['Payments', { new: true, direction: 'in' }] },
  { icon: 'cart', tone: 'violet', label: 'Purchase bill', hint: 'Stock coming in', go: ['Purchase', { new: true, type: 'PURCHASE_BILL' }] },
  { icon: 'arrowOut', tone: 'red', label: 'Pay supplier', hint: 'Payment out', go: ['Payments', { new: true, direction: 'out' }] },
  { icon: 'cash', tone: 'amber', label: 'Expense', hint: 'Rent, salary, bills', go: ['Expenses', { new: true }] },
  { icon: 'file', tone: 'teal', label: 'Estimate', hint: 'Quote a price', go: ['Sale', { new: true, type: 'ESTIMATE' }] }
]

export function Dashboard({ business, go }: { business: Business; go: Go }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.dashboard().then(setData, (e) => setError(errorMessage(e)))
  }, [business.id])

  const todayText = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div>
      <section className="hero">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>{greeting()}, {business.name}</h1>
          <div className="hero-sub">
            {todayText}
            {data ? ` · ${formatINR(data.todaySales)} sold today in ${data.todaySalesCount} invoice${data.todaySalesCount === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <span className="spacer" />
        <div className="hero-actions">
          <button className="btn" onClick={() => go('Reports')}><Icon name="chart" size={17} /> Reports</button>
          <button className="btn" onClick={() => go('Purchase', { new: true, type: 'PURCHASE_BILL' })}><Icon name="cart" size={17} /> New purchase</button>
          <button className="btn primary" onClick={() => go('Sale', { new: true, type: 'SALE_INVOICE' })}>
            <Icon name="plus" size={17} /> New invoice <span className="kbd">Alt S</span>
          </button>
        </div>
      </section>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="quick">
        {QUICK.map((q) => (
          <button key={q.label} className="quick-btn" onClick={() => go(...q.go)}>
            <IconTile name={q.icon} tone={q.tone} size="sm" />
            <span>
              {q.label}
              <small>{q.hint}</small>
            </span>
          </button>
        ))}
      </div>

      {data && (
        <>
          <div className="stats">
            <Kpi
              icon="receipt" tone="accent" label="Today's sales" value={formatINR(data.todaySales)}
              sub={`${data.todaySalesCount} invoice${data.todaySalesCount === 1 ? '' : 's'} · ${formatINR(data.monthSales)} this month`}
              onClick={() => go('Sale')}
            />
            <Kpi
              icon="arrowIn" tone="green" label="To receive" value={formatINR(data.receivable)} valueClass="receive"
              sub="from customers" onClick={() => go('Reports', { id: 'receivable' })}
            />
            <Kpi
              icon="arrowOut" tone="red" label="To pay" value={formatINR(data.payable)} valueClass="pay"
              sub={`to suppliers · ${formatINR(data.monthPurchases)} bought this month`}
              onClick={() => go('Reports', { id: 'payable' })}
            />
            <Kpi
              icon="bank" tone="violet" label="Cash & bank" value={formatINR(data.cashBank)} valueClass={data.cashBank < 0 ? 'pay' : undefined}
              sub={`${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'}`} onClick={() => go('Cash & Bank')}
            />
          </div>

          <SalesChart days={data.salesByDay} />

          <div className="dash-grid">
            <div className="detail">
              <div className="panel-head">
                <IconTile name="clock" tone="red" size="sm" />
                <div>
                  <h2>Overdue invoices</h2>
                  <span className="muted">Past their due date, oldest first</span>
                </div>
                <span className="spacer" />
                {data.overdue.count > 0 && <span className="count-pill">{formatINR(data.overdue.total)} · {data.overdue.count}</span>}
              </div>
              {data.overdue.count === 0 ? (
                <EmptyState icon="checkCircle" title="Nothing overdue">Every invoice is paid or still within its due date.</EmptyState>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Invoice</th><th>Party</th><th>Due</th><th className="amount">Balance</th></tr>
                  </thead>
                  <tbody>
                    {data.overdue.top.map((i) => (
                      <tr key={i.id} className="clickable" onClick={() => go('Sale', { id: i.id })}>
                        <td><strong>{i.number}</strong></td>
                        <td>{i.partyName}</td>
                        <td className="nowrap muted">{i.dueDate}</td>
                        <td className="amount pay">{formatINR(i.balanceDue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.overdue.count > data.overdue.top.length && (
                <button className="btn small" onClick={() => go('Reports', { id: 'receivable' })}>
                  See all {data.overdue.count} <Icon name="arrowRight" size={14} />
                </button>
              )}
            </div>

            <div className="detail">
              <div className="panel-head">
                <IconTile name="box" tone="amber" size="sm" />
                <div>
                  <h2>Low stock</h2>
                  <span className="muted">At or below the alert level</span>
                </div>
                <span className="spacer" />
                {data.lowStock.length > 0 && <span className="count-pill">{data.lowStock.length} item{data.lowStock.length === 1 ? '' : 's'}</span>}
              </div>
              {data.lowStock.length === 0 ? (
                <EmptyState icon="checkCircle" title="Stock looks healthy">All items are above their alert level.</EmptyState>
              ) : (
                <table className="table">
                  <thead>
                    <tr><th>Item</th><th className="amount">In stock</th><th>Level</th></tr>
                  </thead>
                  <tbody>
                    {data.lowStock.slice(0, 8).map((s) => (
                      <tr key={s.itemId} className="clickable" onClick={() => go('Items')}>
                        <td><strong>{s.name}</strong><div className="muted" style={{ fontSize: 12 }}>alert below {formatQty(s.lowStockQty)} {s.unit}</div></td>
                        <td className="amount pay">{formatQty(s.qty)} {s.unit}</td>
                        <td style={{ width: 110 }}>
                          <div className="meter"><i style={{ width: `${s.lowStockQty > 0 ? Math.max(4, Math.min(100, (Math.max(s.qty, 0) / s.lowStockQty) * 100)) : 4}%` }} /></div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="detail">
              <div className="panel-head">
                <IconTile name="wallet" tone="violet" size="sm" />
                <div>
                  <h2>Money in hand</h2>
                  <span className="muted">Cash, bank and wallet balances</span>
                </div>
                <span className="spacer" />
                <button className="btn small ghost" onClick={() => go('Cash & Bank')}>Open <Icon name="arrowRight" size={14} /></button>
              </div>
              <div className="acct-list">
                {data.accounts.map((a) => (
                  <div key={a.id} className="acct-row">
                    <IconTile name={a.kind === 'cash' ? 'cash' : a.kind === 'bank' ? 'bank' : 'wallet'} tone={a.kind === 'cash' ? 'green' : 'slate'} size="sm" />
                    <div className="grow">
                      <strong>{a.name}</strong>
                      <small>{a.kind === 'cash' ? 'Cash' : a.kind === 'bank' ? 'Bank account' : 'UPI / wallet'}</small>
                    </div>
                    <strong className={a.balance < 0 ? 'amount pay' : 'amount'}>{formatINR(a.balance)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
