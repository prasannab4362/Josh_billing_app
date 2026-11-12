import { useEffect, useState } from 'react'
import type { Item, StockSummary } from '@shared/models'
import { formatINR, toPaise } from '@shared/money'
import { formatQty, toMilli } from '@shared/qty'
import { todayLocal } from '@shared/fy'
import { api, errorMessage } from '../../api'
import { Banner, DateInput, Field, Modal, TextInput } from '../../components/Field'

/** Add or remove stock outside of bills: damage, count corrections, samples. */
export function AdjustStockForm({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const [direction, setDirection] = useState<'add' | 'remove'>('remove')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const unit = item.baseUnitShort

  const save = async () => {
    setFailure(null)
    let milli: number
    let rate: number | null = null
    try {
      milli = toMilli(qty)
      if (direction === 'add' && cost.trim()) rate = toPaise(cost)
    } catch {
      return setFailure('Enter the quantity and cost as numbers')
    }
    if (milli <= 0) return setFailure('Enter the quantity')
    try {
      await api.createAdjustment({ itemId: item.id, date, qtyChange: direction === 'add' ? milli : -milli, rate, reason })
      onSaved()
    } catch (e) {
      setFailure(errorMessage(e))
    }
  }

  return (
    <Modal
      title={`Adjust stock · ${item.name}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save adjustment</button></>}
    >
      {failure && <Banner kind="error">{failure}</Banner>}
      <p className="muted">In stock now: {formatQty(item.stockQty)} {unit}. Use this for damage, losses or a stock count — not for buying or selling.</p>
      <div className="form-grid">
        <Field label="Change" group>
          <div className="seg">
            <button type="button" className={direction === 'remove' ? 'on' : ''} onClick={() => setDirection('remove')}>Reduce stock</button>
            <button type="button" className={direction === 'add' ? 'on' : ''} onClick={() => setDirection('add')}>Add stock</button>
          </div>
        </Field>
        <Field label={`Quantity (${unit || 'units'})`} required>
          <TextInput value={qty} onChange={setQty} inputMode="decimal" autoFocus />
        </Field>
        {direction === 'add' && (
          <Field label="Cost per unit (₹)" hint="Leave empty to use the current average cost">
            <TextInput value={cost} onChange={setCost} inputMode="decimal" />
          </Field>
        )}
        <Field label="Date"><DateInput value={date} onChange={setDate} /></Field>
        <Field label="Reason"><TextInput value={reason} onChange={setReason} placeholder="e.g. Damaged, Stock count" /></Field>
      </div>
    </Modal>
  )
}

/** Quantity and value of every stocked item on a chosen date. */
export function StockSummaryView() {
  const [asOf, setAsOf] = useState(todayLocal())
  const [lowOnly, setLowOnly] = useState(false)
  const [data, setData] = useState<StockSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!asOf) return
    api.stockSummary(asOf).then((d) => { setData(d); setError(null) }, (e) => setError(errorMessage(e)))
  }, [asOf])

  const rows = data ? data.rows.filter((r) => !lowOnly || r.low) : []
  return (
    <div>
      <div className="toolbar">
        <label className="muted">Stock as of</label>
        <input type="date" className="input" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        <label className="toggle"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      {data && (
        <>
          <div className="stats">
            <div className="stat"><div className="label">Stock value (at cost)</div><div className="value">{formatINR(data.totalValue)}</div></div>
            <div className="stat"><div className="label">At sale price</div><div className="value">{formatINR(data.totalSaleValue)}</div></div>
            <div className="stat"><div className="label">Low stock items</div><div className={data.lowCount ? 'value pay' : 'value'}>{data.lowCount}</div></div>
          </div>
          <div className="card wide" style={{ maxWidth: 'none', padding: 0 }}>
            <table className="table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="amount">Quantity</th>
                  <th className="amount">Avg. cost</th>
                  <th className="amount">Stock value</th>
                  <th className="amount">Sale price</th>
                  <th className="amount">Sale value</th>
                  <th className="amount">Alert below</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={8} className="empty">No stocked items{lowOnly ? ' are low' : ''}.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.itemId}>
                    <td>{r.name}{r.low && <span className="badge warn">low stock</span>}</td>
                    <td>{r.category || '—'}</td>
                    <td className={r.low || r.qty < 0 ? 'amount pay' : 'amount'}>{formatQty(r.qty)} {r.unit}</td>
                    <td className="amount">{formatINR(r.avgCost)}</td>
                    <td className="amount">{formatINR(r.value)}</td>
                    <td className="amount">{formatINR(r.salePrice)}</td>
                    <td className="amount">{formatINR(r.saleValue)}</td>
                    <td className="amount">{r.lowStockQty !== null ? `${formatQty(r.lowStockQty)} ${r.unit}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4}><strong>Total</strong></td>
                    <td className="amount"><strong>{formatINR(rows.reduce((s, r) => s + r.value, 0))}</strong></td>
                    <td />
                    <td className="amount"><strong>{formatINR(rows.reduce((s, r) => s + r.saleValue, 0))}</strong></td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  )
}
