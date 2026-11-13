import { useEffect, useMemo, useState } from 'react'
import type { Item, StockMovement } from '@shared/models'
import { formatINR } from '@shared/money'
import { formatQty } from '@shared/qty'
import { api, errorMessage } from '../../api'
import { Icon, PageTitle } from '../../components/Icon'
import { Banner } from '../../components/Field'
import { ItemForm } from './ItemForm'
import { AdjustStockForm, StockSummaryView } from './StockViews'
import { LabelsModal } from './LabelsModal'
import { BulkUpdateModal } from './BulkUpdateModal'
import { ImportModal } from '../../components/ImportModal'
import { barcodeSvg } from '@shared/barcode'
import { qrSvg } from '@shared/qr'

type Filter = 'all' | 'goods' | 'service' | 'low' | 'inactive'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All items' },
  { key: 'goods', label: 'Products' },
  { key: 'service', label: 'Services' },
  { key: 'low', label: 'Low stock' },
  { key: 'inactive', label: 'Inactive' }
]

const isLow = (i: Item) => i.trackStock && i.lowStockQty !== null && i.stockQty <= i.lowStockQty

function matches(i: Item, filter: Filter, category: string, search: string): boolean {
  if (filter === 'inactive' ? i.isActive : !i.isActive) return false
  if (filter === 'goods' && i.kind !== 'goods') return false
  if (filter === 'service' && i.kind !== 'service') return false
  if (filter === 'low' && !isLow(i)) return false
  if (category && i.category !== category) return false
  if (!search) return true
  const q = search.toLowerCase()
  return i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || i.hsnSac.includes(q) || i.barcode.includes(q)
}


export function ItemsPage({ startNew = false }: { startNew?: boolean }) {
  const [tab, setTab] = useState<'items' | 'summary'>('items')
  return (
    <div>
      <div className="page-head">
        <PageTitle icon="box" tone="amber" title="Items" sub="Products, services, prices and stock" />
      </div>
      <nav className="tabs">
        <button className={tab === 'items' ? 'tab active' : 'tab'} onClick={() => setTab('items')}><Icon name="list" size={16} />Items</button>
        <button className={tab === 'summary' ? 'tab active' : 'tab'} onClick={() => setTab('summary')}><Icon name="chart" size={16} />Stock summary</button>
      </nav>
      {tab === 'items' ? <ItemsList startNew={startNew} /> : <StockSummaryView />}
    </div>
  )
}

function ItemsList({ startNew }: { startNew: boolean }) {
  const [items, setItems] = useState<Item[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [editing, setEditing] = useState<Item | 'new' | null>(startNew ? 'new' : null)
  const [adjusting, setAdjusting] = useState<Item | null>(null)
  const [labelsFor, setLabelsFor] = useState<string[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const load = () => api.listItems().then(setItems, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  useEffect(() => {
    load()
  }, [])

  const selected = items.find((i) => i.id === selectedId) ?? null
  useEffect(() => {
    if (!selected || !selected.trackStock) return setMovements([])
    api.listStockMovements(selected.id).then(setMovements, () => setMovements([]))
  }, [selected?.id, selected?.updatedAt, selected?.stockQty])

  useEffect(() => {
    setPhoto(null)
    if (selected?.hasImage) api.getItemImage(selected.id).then(setPhoto, () => setPhoto(null))
  }, [selected?.id, selected?.updatedAt])

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items])
  const shown = useMemo(
    () => items.filter((i) => matches(i, filter, category, search.trim())),
    [items, filter, category, search]
  )
  const active = items.filter((i) => i.isActive)
  const stockValue = active.reduce((s, i) => s + i.stockValue, 0)
  const lowCount = active.filter(isLow).length

  const saved = (i: Item) => {
    setEditing(null)
    setSelectedId(i.id)
    setMessage({ kind: 'success', text: `${i.name} saved` })
    load()
  }

  const toggleActive = async (i: Item) => {
    try {
      await api.setItemActive(i.id, !i.isActive)
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const remove = async (i: Item) => {
    if (!window.confirm(`Delete ${i.name}?`)) return
    try {
      await api.deleteItem(i.id)
      setSelectedId(null)
      setMessage({ kind: 'success', text: `${i.name} deleted` })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const undoAdjustment = async (id: string) => {
    if (!window.confirm('Undo this stock adjustment?')) return
    try {
      await api.deleteAdjustment(id)
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const exportExcel = async () => {
    try {
      const path = await api.exportToExcel('items')
      if (path) setMessage({ kind: 'success', text: `Saved ${path}` })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const qty = (i: Item) => (i.trackStock ? `${formatQty(i.stockQty)} ${i.baseUnitShort}`.trim() : '—')

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" size={17} />Import from Excel</button>
        <button className="btn" onClick={exportExcel}><Icon name="download" size={17} />Export to Excel</button>
        <button className="btn" onClick={() => setBulk(true)} disabled={!items.length}><Icon name="layers" size={17} />Bulk update</button>
        <button className="btn" onClick={() => setLabelsFor([])}><Icon name="barcode" size={17} />Print labels</button>
        <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={17} />Add item</button>
      </div>
      <div className="stats">
        <div className="stat">
          <div className="label">Stock value</div>
          <div className="value">{formatINR(stockValue)}</div>
        </div>
        <div className="stat">
          <div className="label">Low stock</div>
          <div className={lowCount ? 'value pay' : 'value'}>{lowCount}</div>
        </div>
        <div className="stat">
          <div className="label">Items</div>
          <div className="value">{active.length}</div>
        </div>
      </div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}

      <div className="toolbar">
        <div className="search-wrap">
          <Icon name="search" size={16} />
          <input className="input search" placeholder="Search name, code, barcode or HSN" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          {FILTERS.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="card wide" style={{ maxWidth: 'none', padding: 0 }}>
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Code</th>
              <th>HSN/SAC</th>
              <th>GST</th>
              <th className="amount">Sale price</th>
              <th className="amount">Purchase price</th>
              <th className="amount">In stock</th>
              <th className="amount">Stock value</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  {items.length ? 'No items match' : 'No items yet. Add the products and services you sell.'}
                </td>
              </tr>
            )}
            {shown.map((i) => (
              <tr
                key={i.id}
                className={['clickable', i.id === selectedId ? 'selected' : '', i.isActive ? '' : 'inactive'].join(' ')}
                onClick={() => setSelectedId(i.id === selectedId ? null : i.id)}
              >
                <td>
                  {i.name}
                  {i.kind === 'service' && <span className="badge">service</span>}
                  {isLow(i) && <span className="badge warn">low stock</span>}
                  {i.category && <div className="muted" style={{ fontSize: 12 }}>{i.category}</div>}
                </td>
                <td>{i.code || '—'}</td>
                <td>{i.hsnSac || '—'}</td>
                <td>{i.taxRateName.replace(/^GST /, '') || '—'}</td>
                <td className="amount">
                  {formatINR(i.salePrice)}
                  {i.priceIncludesTax && <span className="muted" style={{ fontSize: 11 }}> incl.</span>}
                </td>
                <td className="amount">{formatINR(i.purchasePrice)}</td>
                <td className={isLow(i) ? 'amount pay' : 'amount'}>{qty(i)}</td>
                <td className="amount">{i.trackStock ? formatINR(i.stockValue) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="detail" style={{ marginTop: 16 }}>
          <div className="detail-head">
            <div>
              <h2>{selected.name}</h2>
              <span className="muted">
                {selected.kind === 'goods' ? 'Product' : 'Service'}
                {selected.category && ` · ${selected.category}`}
              </span>
            </div>
            <span className="spacer" />
            <button className="btn small" onClick={() => setLabelsFor([selected.id])}><Icon name="barcode" size={15} />Print labels</button>
            {selected.trackStock && <button className="btn small" onClick={() => setAdjusting(selected)}>Adjust stock</button>}
            <button className="btn small" onClick={() => setEditing(selected)}><Icon name="edit" size={16} />Edit</button>
            <button className="btn small" onClick={() => toggleActive(selected)}>
              {selected.isActive ? 'Mark inactive' : 'Mark active'}
            </button>
            {!selected.hasTransactions && <button className="btn small" onClick={() => remove(selected)}>Delete</button>}
          </div>
          {(photo || selected.barcode || selected.description) && (
            <div className="item-extras">
              {photo && <img className="item-photo" src={photo} alt={selected.name} />}
              <div>
                {selected.description && <p className="desc">{selected.description}</p>}
                {selected.barcode && (
                  <div className="codes-row">
                    <div className="item-barcode">
                      <div dangerouslySetInnerHTML={{ __html: barcodeSvg(selected.barcode) }} />
                      <span className="mono">{selected.barcode}</span>
                    </div>
                    <div className="item-qr" title="QR code of the barcode" dangerouslySetInnerHTML={{ __html: qrSvg(selected.barcode) }} />
                  </div>
                )}
              </div>
            </div>
          )}
          <dl className="facts">
            <div>
              <dt>MRP</dt>
              <dd>{selected.mrp !== null ? formatINR(selected.mrp) : '—'}</dd>
            </div>
            <div>
              <dt>Wholesale</dt>
              <dd>
                {selected.wholesalePrice !== null
                  ? `${formatINR(selected.wholesalePrice)} from ${formatQty(selected.wholesaleMinQty ?? 0)} ${selected.baseUnitShort}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Low stock alert</dt>
              <dd>{selected.lowStockQty !== null ? `${formatQty(selected.lowStockQty)} ${selected.baseUnitShort}` : 'Off'}</dd>
            </div>
          </dl>
          {selected.trackStock && (
            <>
              <h3>Stock movements</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Details</th>
                    <th>No.</th>
                    <th className="amount">Change</th>
                    <th className="amount">Rate</th>
                    <th className="amount">Stock after</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {movements.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">No stock movements yet.</td>
                    </tr>
                  )}
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td>{m.date}</td>
                      <td>{m.label}</td>
                      <td>{m.number}</td>
                      <td className={m.qtyChange < 0 ? 'amount pay' : 'amount receive'}>
                        {m.qtyChange > 0 ? '+' : ''}{formatQty(m.qtyChange)}
                      </td>
                      <td className="amount">{formatINR(m.rate)}</td>
                      <td className="amount">{formatQty(m.runningQty)} {selected.baseUnitShort}</td>
                      <td>
                        {m.sourceType === 'adjustment' && (
                          <button className="chip-x" title="Undo adjustment" onClick={() => undoAdjustment(m.sourceId)}>×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {adjusting && (
        <AdjustStockForm
          item={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null)
            setMessage({ kind: 'success', text: 'Stock adjusted' })
            load()
          }}
        />
      )}
      {importing && <ImportModal kind="items" onClose={() => setImporting(false)} onImported={load} />}
      {bulk && <BulkUpdateModal items={items} onClose={() => setBulk(false)} onSaved={load} />}
      {labelsFor && (
        <LabelsModal items={items} preselect={labelsFor} onClose={() => setLabelsFor(null)} onItemsChanged={load} />
      )}
      {editing && <ItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  )
}
