import { useEffect, useMemo, useState } from 'react'
import type { ItemBulkChange } from '@shared/imports'
import type { Item, TaxRate } from '@shared/models'
import { divRound, toPaise } from '@shared/money'
import { formatQty, toMilli } from '@shared/qty'
import { api, errorMessage } from '../../api'
import { Banner, Modal } from '../../components/Field'

interface Props {
  items: Item[]
  onClose: () => void
  onSaved: () => void
}

type Tab = 'pricing' | 'tax' | 'stock'
type Field = 'salePrice' | 'purchasePrice' | 'mrp' | 'wholesalePrice' | 'wholesaleMinQty' | 'priceIncludesTax' | 'taxRateId' | 'hsnSac' | 'category' | 'lowStockQty'

const COLUMNS: Record<Tab, { field: Field; title: string; kind: 'money' | 'qty' | 'text' | 'tax' | 'yesno' }[]> = {
  pricing: [
    { field: 'salePrice', title: 'Sale price', kind: 'money' },
    { field: 'purchasePrice', title: 'Purchase price', kind: 'money' },
    { field: 'mrp', title: 'MRP', kind: 'money' },
    { field: 'wholesalePrice', title: 'Wholesale price', kind: 'money' },
    { field: 'wholesaleMinQty', title: 'Wholesale min qty', kind: 'qty' },
    { field: 'priceIncludesTax', title: 'Price incl. GST', kind: 'yesno' }
  ],
  tax: [
    { field: 'taxRateId', title: 'GST rate', kind: 'tax' },
    { field: 'hsnSac', title: 'HSN/SAC', kind: 'text' },
    { field: 'category', title: 'Category', kind: 'text' },
    { field: 'priceIncludesTax', title: 'Price incl. GST', kind: 'yesno' }
  ],
  stock: [
    { field: 'lowStockQty', title: 'Low stock alert', kind: 'qty' },
    { field: 'category', title: 'Category', kind: 'text' }
  ]
}

const rupees = (p: number | null) => (p === null ? '' : (p / 100).toFixed(2).replace(/\.00$/, ''))
/** The item's value as the text shown in its cell. */
function cellText(i: Item, f: Field): string {
  switch (f) {
    case 'salePrice': case 'purchasePrice': case 'mrp': case 'wholesalePrice': return rupees(i[f])
    case 'wholesaleMinQty': case 'lowStockQty': return i[f] === null ? '' : formatQty(i[f]!)
    case 'priceIncludesTax': return i.priceIncludesTax ? 'yes' : 'no'
    case 'taxRateId': return i.taxRateId ?? ''
    default: return i[f]
  }
}

/** Parse an edited cell into the change; throws a short message when it is not valid. */
function parse(f: Field, text: string): Partial<ItemBulkChange> {
  const t = text.trim()
  switch (f) {
    case 'salePrice': case 'purchasePrice': return { [f]: t === '' ? 0 : toPaise(t) }
    case 'mrp': case 'wholesalePrice': return { [f]: t === '' ? null : toPaise(t) }
    case 'wholesaleMinQty': case 'lowStockQty': return { [f]: t === '' ? null : toMilli(t) }
    case 'priceIncludesTax': return { priceIncludesTax: t === 'yes' }
    case 'taxRateId': return { taxRateId: t || null }
    default: return { [f]: t }
  }
}

/** Change prices, GST, HSN and more for many items in one grid, then save them together. */
export function BulkUpdateModal({ items, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('pricing')
  const [rates, setRates] = useState<TaxRate[]>([])
  const [edits, setEdits] = useState<Record<string, Partial<Record<Field, string>>>>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [taxFilter, setTaxFilter] = useState('all')
  const [category, setCategory] = useState('')
  const [setRate, setSetRate] = useState('')
  const [setCat, setSetCat] = useState('')
  const [pct, setPct] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.listTaxRates().then(setRates, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  }, [])

  const active = items.filter((i) => i.isActive)
  const categories = useMemo(() => [...new Set(active.map((i) => i.category).filter(Boolean))].sort(), [items])
  const shown = active.filter((i) => {
    const q = search.trim().toLowerCase()
    if (q && !(i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || i.hsnSac.includes(q))) return false
    if (taxFilter === 'none' && i.taxRateId) return false
    if (taxFilter !== 'all' && taxFilter !== 'none' && i.taxRateId !== taxFilter) return false
    if (category && i.category !== category) return false
    return true
  })

  const value = (i: Item, f: Field) => edits[i.id]?.[f] ?? cellText(i, f)
  const edit = (id: string, f: Field, v: string) => setEdits((e) => ({ ...e, [id]: { ...e[id], [f]: v } }))
  // Each item's changes, and a problem per cell that does not parse.
  const { changes, problems } = useMemo(() => {
    const changes: ItemBulkChange[] = []
    const problems: Record<string, string> = {}
    for (const i of items) {
      const e = edits[i.id]
      if (!e) continue
      const c: ItemBulkChange = { id: i.id }
      for (const [f, v] of Object.entries(e) as [Field, string][]) {
        if (v === cellText(i, f)) continue
        try {
          Object.assign(c, parse(f, v))
        } catch {
          problems[`${i.id}:${f}`] = 'Not a valid number'
        }
      }
      if (Object.keys(c).length > 1) changes.push(c)
    }
    return { changes, problems }
  }, [edits, items])
  const changed = (i: Item, f: Field) => edits[i.id]?.[f] !== undefined && edits[i.id]![f] !== cellText(i, f)

  const targets = () => shown.filter((i) => picked.has(i.id))
  const applyRate = () => {
    for (const i of targets()) edit(i.id, 'taxRateId', setRate)
  }
  const applyCategory = () => {
    for (const i of targets()) edit(i.id, 'category', setCat.trim())
  }
  const applyPercent = () => {
    const p = Number(pct)
    if (!Number.isFinite(p) || p <= -100 || p > 1000) return setMessage({ kind: 'error', text: 'Enter a percentage between -99 and 1000' })
    for (const i of targets()) {
      let base: number
      try {
        base = toPaise(value(i, 'salePrice') || '0')
      } catch {
        continue
      }
      edit(i.id, 'salePrice', rupees(base + divRound(base * Math.round(p * 100), 10_000)))
    }
  }
  const allPicked = shown.length > 0 && shown.every((i) => picked.has(i.id))
  const togglePickAll = () => setPicked(allPicked ? new Set() : new Set(shown.map((i) => i.id)))
  const togglePick = (id: string) => setPicked((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const save = async () => {
    if (Object.keys(problems).length) return setMessage({ kind: 'error', text: 'Some cells are not valid numbers (marked in red)' })
    setBusy(true)
    setMessage(null)
    try {
      const n = await api.bulkUpdateItems(changes)
      setEdits({})
      setMessage({ kind: 'success', text: `Saved changes to ${n} item${n === 1 ? '' : 's'}` })
      onSaved()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    if (changes.length && !window.confirm(`Discard unsaved changes to ${changes.length} item${changes.length === 1 ? '' : 's'}?`)) return
    onClose()
  }

  return (
    <Modal
      title="Bulk update items"
      onClose={close}
      wide
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            {changes.length ? `${changes.length} item${changes.length === 1 ? '' : 's'} changed, not saved yet` : 'Edit any cell; changed cells are highlighted.'}
          </span>
          {changes.length > 0 && <button className="btn" onClick={() => setEdits({})} disabled={busy}>Undo all</button>}
          <button className="btn" onClick={close}>Close</button>
          <button className="btn primary" onClick={save} disabled={busy || !changes.length}>Save changes</button>
        </>
      }
    >
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="tabs" role="tablist">
        {(['pricing', 'tax', 'stock'] as Tab[]).map((t) => (
          <button key={t} role="tab" className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t === 'pricing' ? 'Pricing' : t === 'tax' ? 'GST & HSN' : 'Stock'}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input className="input search" placeholder="Search name, code or HSN" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" style={{ width: 170 }} value={taxFilter} onChange={(e) => setTaxFilter(e.target.value)} aria-label="Filter by GST rate">
          <option value="all">All GST rates</option>
          <option value="none">No GST rate set</option>
          {rates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="input" style={{ width: 170 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {picked.size > 0 && (
        <div className="bulk-bar">
          <b>{targets().length} selected:</b>
          <select className="input" value={setRate} onChange={(e) => setSetRate(e.target.value)} aria-label="GST rate for selected">
            <option value="">No GST rate</option>
            {rates.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button className="btn small" onClick={applyRate}>Set GST rate</button>
          <input className="input" style={{ width: 140 }} placeholder="Category" value={setCat} onChange={(e) => setSetCat(e.target.value)} aria-label="Category for selected" />
          <button className="btn small" onClick={applyCategory}>Set category</button>
          <input className="input" style={{ width: 80 }} placeholder="+10 or -5" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Percent change" />
          <button className="btn small" onClick={applyPercent}>Change sale price by %</button>
        </div>
      )}
      <div className="bulk-grid">
        <table className="table compact">
          <thead>
            <tr>
              <th style={{ width: 28 }}><input type="checkbox" checked={allPicked} onChange={togglePickAll} aria-label="Select all shown" /></th>
              <th>Item</th>
              {COLUMNS[tab].map((c) => <th key={c.field}>{c.title}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} className={picked.has(i.id) ? 'selected' : ''}>
                <td><input type="checkbox" checked={picked.has(i.id)} onChange={() => togglePick(i.id)} aria-label={`Select ${i.name}`} /></td>
                <td>{i.name}{i.code && <span className="muted small"> · {i.code}</span>}</td>
                {COLUMNS[tab].map((c) => {
                  const cls = `input cell ${changed(i, c.field) ? 'changed' : ''} ${problems[`${i.id}:${c.field}`] ? 'bad' : ''}`
                  const label = `${c.title} of ${i.name}`
                  if (c.kind === 'tax') {
                    return (
                      <td key={c.field}>
                        <select className={cls} value={value(i, c.field)} onChange={(e) => edit(i.id, c.field, e.target.value)} aria-label={label}>
                          <option value="">None</option>
                          {rates.filter((r) => r.isActive || r.id === i.taxRateId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </td>
                    )
                  }
                  if (c.kind === 'yesno') {
                    return (
                      <td key={c.field}>
                        <select className={cls} value={value(i, c.field)} onChange={(e) => edit(i.id, c.field, e.target.value)} aria-label={label}>
                          <option value="no">Excluded</option>
                          <option value="yes">Included</option>
                        </select>
                      </td>
                    )
                  }
                  return (
                    <td key={c.field}>
                      <input className={cls} inputMode={c.kind === 'text' ? 'text' : 'decimal'} value={value(i, c.field)}
                        onChange={(e) => edit(i.id, c.field, e.target.value)} aria-label={label}
                        disabled={c.field === 'lowStockQty' && !i.trackStock} placeholder={c.field === 'lowStockQty' && !i.trackStock ? 'no stock' : ''} />
                    </td>
                  )
                })}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={8} className="muted">No items match.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
