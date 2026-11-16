import { useEffect, useMemo, useRef, useState } from 'react'
import type { Business, Item, MoneyAccount, Party, PaperSize, PaymentMode, Preferences, TaxRate, Unit } from '@shared/models'
import { formatINR, percentToBp, toPaise } from '@shared/money'
import { priceForDocument } from '@shared/tax'
import { formatQty, toMilli } from '@shared/qty'
import { todayLocal } from '@shared/fy'
import {
  addItem, bulkHint, findForScan, isWholesale, linePrice, posInvoiceInput, posTotals, searchItems, settle, unitFactor,
  taxOf, type PosBill, type PosContext, type PosLine
} from '@shared/pos'
import { api, errorMessage } from '../../api'
import { Banner, Modal } from '../../components/Field'
import { Icon } from '../../components/Icon'

const MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank transfer' }, { value: 'cheque', label: 'Cheque' }
]

interface Tab extends PosBill {
  id: number
  /** A wholesale bill: every item with a wholesale price uses it. */
  wholesale: boolean
  /** What was typed in "Amount received"; '' means exactly the total. */
  tenderedText: string
  partyText: string
}

let nextId = 1
let nextKey = 1
const newTab = (stateCode: string): Tab => ({
  id: nextId++, wholesale: false, partyId: null, walkInName: '', date: todayLocal(), placeOfSupply: stateCode, lines: [], charges: [], notes: '',
  mode: 'cash', accountId: 'cash', tendered: 0, reference: '', tenderedText: '', partyText: ''
})

type Dialog = { kind: 'line'; key: number } | { kind: 'charge' } | { kind: 'discount' } | { kind: 'remarks' } | null

/** Counter billing: scan or search items, adjust with function keys, take payment and print the bill. */
export function PosPage({ business }: { business: Business }) {
  const [items, setItems] = useState<Item[]>([])
  const [rates, setRates] = useState<TaxRate[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [accounts, setAccounts] = useState<MoneyAccount[]>([])
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(business.stateCode)])
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [hint, setHint] = useState(0)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [breakup, setBreakup] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const partyRef = useRef<HTMLInputElement>(null)

  const load = () =>
    Promise.all([api.listItems(), api.listTaxRates(), api.listUnits(), api.listParties(), api.listAccounts(), api.getPreferences()]).then(
      ([i, r, u, p, a, pr]) => {
        setItems(i)
        setRates(r)
        setUnits(u)
        setParties(p.filter((x) => x.isActive && x.kind !== 'supplier'))
        setAccounts(a)
        setPrefs(pr)
      },
      (e) => setMessage({ kind: 'error', text: errorMessage(e) })
    )
  useEffect(() => {
    load()
    searchRef.current?.focus()
  }, [])

  const tab = tabs[Math.min(active, tabs.length - 1)]
  const update = (patch: Partial<Tab>) => setTabs((list) => list.map((t) => (t.id === tab.id ? { ...t, ...patch } : t)))
  const setLines = (f: (l: PosLine[]) => PosLine[]) => setTabs((list) => list.map((t) => (t.id === tab.id ? { ...t, lines: f(t.lines) } : t)))

  const party = parties.find((p) => p.id === tab.partyId) ?? null
  const ctx: PosContext | null = useMemo(() => prefs && {
    items: new Map(items.map((i) => [i.id, i])),
    rates: new Map(rates.map((r) => [r.id, r])),
    inclusive: prefs.pricesIncludeTax,
    registered: prefs.gstRegistered,
    supply: (party?.stateCode || business.stateCode) === business.stateCode ? 'intra' : 'inter',
    roundOff: prefs.roundOff,
    wholesaleBill: tab.wholesale
  }, [items, rates, prefs, party?.stateCode, tab.wholesale])
  const totals = ctx ? posTotals(tab.lines, ctx, tab.charges) : null
  const total = totals?.grandTotal ?? 0
  const tendered = tab.tenderedText.trim() === '' ? total : safePaise(tab.tenderedText)
  const pay = settle(total, tendered)
  const suggestions = searchItems(items, search)
  const bulk = ctx && !tab.wholesale ? bulkHint(tab.lines, ctx.items) : null
  const unitShort = (id: string | null) => units.find((u) => u.id === id)?.short ?? ''
  const qtyCount = tab.lines.reduce((s, l) => s + l.qty, 0)

  // ---------- Adding items ----------
  const add = (item: Item) => {
    setLines((l) => addItem(l, item.id, nextKey++))
    setSelected(tab.lines.find((l) => l.itemId === item.id && !l.useAltUnit && l.priceOverride === null)?.key ?? nextKey - 1)
    setSearch('')
    setHint(0)
    setMessage(null)
    searchRef.current?.focus()
  }
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHint((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHint((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Escape') setSearch('')
    else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = findForScan(items, search) ?? suggestions[hint]
      if (hit) add(hit)
      else if (search.trim()) setMessage({ kind: 'error', text: `No item matches "${search.trim()}"` })
    }
  }

  /** Change a line's quantity by a step (never below 1), or to what was typed in the box. */
  const step = (l: PosLine, by: number) => setLines((list) => list.map((x) => (x.key === l.key ? { ...x, qty: Math.max(1000, x.qty + by) } : x)))
  /** Apply what was typed in a quantity box; returns the quantity that now stands (the old one if the text was not a number). */
  const setQtyText = (l: PosLine, text: string): number => {
    let q = l.qty
    try {
      q = toMilli(text)
    } catch {
      q = l.qty
    }
    if (q <= 0) q = l.qty
    setLines((list) => list.map((x) => (x.key === l.key ? { ...x, qty: q } : x)))
    return q
  }

  // ---------- Saving ----------
  const save = async (print: boolean) => {
    if (!ctx || busy) return
    if (!tab.lines.length) return setMessage({ kind: 'error', text: 'Add at least one item' })
    if (!tab.partyId && pay.due > 0) return setMessage({ kind: 'error', text: `Received ${formatINR(pay.received)} of ${formatINR(total)}. Choose a customer to give credit, or take the full amount.` })
    setBusy(true)
    setMessage(null)
    try {
      const input = posInvoiceInput({ ...tab, tendered }, ctx)
      const inv = await api.saveBill('SALE_INVOICE', null, input)
      const change = pay.change ? ` Give back ${formatINR(pay.change)}.` : ''
      setMessage({ kind: 'success', text: `Bill ${inv.number} saved for ${formatINR(inv.grandTotal)}.${change}` })
      if (print) {
        const paper: PaperSize = prefs?.paperSize === 'thermal58' ? 'thermal58' : prefs?.paperSize === 'thermal80' ? 'thermal80' : 'thermal80'
        api.printBill('SALE_INVOICE', inv.id, paper).catch((e) => setMessage({ kind: 'error', text: errorMessage(e) }))
      }
      // Start a fresh bill in the same tab; stock and balances reload.
      setTabs((list) => list.map((t) => (t.id === tab.id ? newTab(business.stateCode) : t)))
      setSelected(null)
      load()
      searchRef.current?.focus()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  // ---------- Tabs ----------
  const openTab = () => {
    setTabs((l) => [...l, newTab(business.stateCode)])
    setActive(tabs.length)
    setSelected(null)
    setTimeout(() => searchRef.current?.focus(), 0)
  }
  const closeTab = (i: number) => {
    const t = tabs[i]
    if (t.lines.length && !window.confirm(`Close bill #${t.id}? Its ${t.lines.length} item(s) are not saved.`)) return
    const rest = tabs.filter((_, k) => k !== i)
    setTabs(rest.length ? rest : [newTab(business.stateCode)])
    setActive(Math.max(0, Math.min(active, rest.length - 1)))
  }

  // ---------- Keyboard ----------
  const keyRef = useRef<(e: KeyboardEvent) => void>()
  keyRef.current = (e: KeyboardEvent) => {
    if (dialog) return
    const sel = tab.lines.find((l) => l.key === selected) ?? tab.lines[tab.lines.length - 1]
    const k = e.key
    const ctrl = e.ctrlKey || e.metaKey
    const handled = () => e.preventDefault()
    if (k === 'F1') { handled(); searchRef.current?.focus() }
    else if ((k === 'F2' || k === 'F3' || k === 'F6') && sel) { handled(); setSelected(sel.key); setDialog({ kind: 'line', key: sel.key }) }
    else if (k === 'F4' && sel) { handled(); setLines((l) => l.filter((x) => x.key !== sel.key)); setSelected(null) }
    else if (k === 'F8') { handled(); setDialog({ kind: 'charge' }) }
    else if (k === 'F9') { handled(); setDialog({ kind: 'discount' }) }
    else if (k === 'F11') { handled(); partyRef.current?.focus() }
    else if (k === 'F12') { handled(); setDialog({ kind: 'remarks' }) }
    else if (ctrl && k.toLowerCase() === 'p') { handled(); void save(true) }
    else if (ctrl && k.toLowerCase() === 's') { handled(); void save(false) }
    else if (ctrl && k.toLowerCase() === 't') { handled(); openTab() }
    else if (ctrl && k.toLowerCase() === 'w') { handled(); closeTab(Math.min(active, tabs.length - 1)) }
    else if (ctrl && k.toLowerCase() === 'b') { handled(); setBreakup((b) => !b) }
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current?.(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const choosePartyText = (v: string) => {
    const p = parties.find((x) => `${x.name}${x.phone ? ` · ${x.phone}` : ''}` === v || x.phone === v.trim() || x.name.toLowerCase() === v.trim().toLowerCase())
    update({ partyText: v, partyId: p?.id ?? null, placeOfSupply: p?.stateCode || business.stateCode, walkInName: p ? '' : tab.walkInName })
  }
  const chooseMode = (m: PaymentMode) => {
    const bank = accounts.find((a) => a.kind !== 'cash' && a.isDefaultForPrint) ?? accounts.find((a) => a.kind !== 'cash')
    update({ mode: m, accountId: m === 'cash' ? 'cash' : bank?.id ?? 'cash' })
  }

  if (!prefs || !ctx) return message ? <Banner kind={message.kind}>{message.text}</Banner> : <p className="muted">Loading…</p>

  return (
    <div className="pos">
      <div className="pos-tabs">
        {tabs.map((t, i) => (
          <div key={t.id} className={i === active ? 'pos-tab on' : 'pos-tab'} onClick={() => { setActive(i); setSelected(null) }}>
            <span>Bill #{t.id}{t.lines.length ? ` · ${t.lines.length}` : ''}</span>
            <button className="chip-x" title="Close bill [Ctrl+W]" onClick={(e) => { e.stopPropagation(); closeTab(i) }}>×</button>
          </div>
        ))}
        <button className="btn small" onClick={openTab} title="Another customer at the counter"><Icon name="plus" size={15} />New bill <span className="kbd">Ctrl+T</span></button>
        <span className="spacer" />
        <span className="muted small-text">Prices {ctx.inclusive ? 'include' : 'exclude'} GST · retail, or wholesale from the item's minimum quantity</span>
      </div>

      <div className="pos-body">
        <div className="pos-left">
          <div className="pos-search">
            <Icon name="barcode" size={20} />
            <input ref={searchRef} className="input" value={search} placeholder="Scan a barcode, or search by name, code, HSN or price  [F1]"
              aria-label="Scan or search items" onChange={(e) => { setSearch(e.target.value); setHint(0) }} onKeyDown={onSearchKey} />
            {suggestions.length > 0 && (
              <div className="pos-suggest" role="listbox">
                {suggestions.map((i, k) => (
                  <button key={i.id} className={k === hint ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); add(i) }}>
                    <span>{i.name}{i.code && <span className="muted"> · {i.code}</span>}</span>
                    <span className="muted">{i.trackStock ? `${formatQty(i.stockQty)} ${i.baseUnitShort} in stock · ` : ''}{formatINR(i.salePrice)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {message && <Banner kind={message.kind}>{message.text}</Banner>}
          {bulk && (
            <div className="notice">
              {formatQty(bulk.pieces)} pieces across {bulk.items} items: a bulk order.
              <button className="btn small" onClick={() => update({ wholesale: true })}>Use wholesale prices</button>
            </div>
          )}
          <div className="pos-lines">
            <table className="table compact">
              <thead>
                <tr><th>#</th><th>Code</th><th>Item</th><th className="amount">Qty</th><th>Unit</th><th className="amount">Price</th><th className="amount">Discount</th><th className="amount">GST</th><th className="amount">Total</th></tr>
              </thead>
              <tbody>
                {tab.lines.map((l, n) => {
                  const item = ctx.items.get(l.itemId)
                  const r = totals?.lines[n]
                  if (!item || !r) return null
                  const sel = (selected ?? tab.lines[tab.lines.length - 1]?.key) === l.key
                  return (
                    <tr key={l.key} className={sel ? 'selected' : ''} onClick={() => setSelected(l.key)} onDoubleClick={() => setDialog({ kind: 'line', key: l.key })}>
                      <td className="muted">{n + 1}</td>
                      <td className="mono small-text">{item.barcode || item.code || '—'}</td>
                      <td>{item.name}{isWholesale(item, l, ctx.wholesaleBill) && l.priceOverride === null && <span className="badge">wholesale</span>}
                        {wholesaleNote(item, l, ctx) && <div className="muted small-text">{wholesaleNote(item, l, ctx)}</div>}</td>
                      <td className="amount pos-qty">
                        <button className="qty-btn" aria-label={`Less ${item.name}`} onClick={(e) => { e.stopPropagation(); step(l, -1000) }}>−</button>
                        <input key={`${l.key}-${l.qty}`} className="input num" inputMode="decimal" defaultValue={formatQty(l.qty)} aria-label={`Quantity of ${item.name}`}
                          onClick={(e) => e.stopPropagation()} onFocus={(e) => e.target.select()}
                          onBlur={(e) => { e.target.value = formatQty(setQtyText(l, e.target.value)) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); searchRef.current?.focus() } }} />
                        <button className="qty-btn" aria-label={`More ${item.name}`} onClick={(e) => { e.stopPropagation(); step(l, 1000) }}>+</button>
                      </td>
                      <td>{l.useAltUnit ? unitShort(item.altUnitId) : item.baseUnitShort}</td>
                      <td className="amount">{formatINR(linePrice(item, l, ctx))}</td>
                      <td className="amount">{r.discount ? formatINR(r.discount) : '—'}</td>
                      <td className="amount">{formatINR(r.cgst + r.sgst + r.igst + r.cess)}</td>
                      <td className="amount"><b>{formatINR(r.total)}</b></td>
                    </tr>
                  )
                })}
                {!tab.lines.length && (
                  <tr><td colSpan={9} className="pos-empty"><div className="pos-empty-art"><Icon name="barcode" size={44} /><b>Ready for the next customer</b><span>Scan a barcode, or type an item name above and press Enter.</span></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pos-keys">
            {([
              ['F2', 'Quantity'], ['F3', 'Item discount'], ['F4', 'Remove'], ['F6', 'Unit'],
              ['F8', 'Extra charge'], ['F9', 'Bill discount'], ['F11', 'Customer'], ['F12', 'Remarks']
            ] as [string, string][]).map(([key, label]) => (
              <button key={key} className="btn" onClick={() => keyRef.current?.(new KeyboardEvent('keydown', { key }))}>
                {label} <span className="kbd">{key}</span>
              </button>
            ))}
          </div>
        </div>

        <aside className="pos-right">
          <label className="field"><span className="field-label">Date</span>
            <input className="input" type="date" value={tab.date} onChange={(e) => update({ date: e.target.value })} />
          </label>
          <label className="field"><span className="field-label">Customer [F11]</span>
            <input ref={partyRef} className="input" list="pos-parties" value={tab.partyText} placeholder="Walk-in customer, or search name / phone"
              aria-label="Customer" onChange={(e) => choosePartyText(e.target.value)} />
            <datalist id="pos-parties">
              {parties.map((p) => <option key={p.id} value={`${p.name}${p.phone ? ` · ${p.phone}` : ''}`} />)}
            </datalist>
            {party ? (
              <span className="muted small-text">{party.balance > 0 ? `Owes ${formatINR(party.balance)}` : party.balance < 0 ? `Advance ${formatINR(-party.balance)}` : 'No balance'}{party.gstin ? ` · GSTIN ${party.gstin}` : ''}</span>
            ) : tab.partyText.trim() ? (
              <span className="muted small-text">Not a saved customer: printed as the walk-in name.</span>
            ) : null}
          </label>

          <div className="row-flex" style={{ gap: 8 }}>
            <span className="field-label" style={{ margin: 0 }}>Rates</span>
            <div className="seg">
              <button className={tab.wholesale ? '' : 'on'} onClick={() => update({ wholesale: false })}>Retail</button>
              <button className={tab.wholesale ? 'on' : ''} onClick={() => update({ wholesale: true })} title="Every item with a wholesale price uses it">Wholesale bill</button>
            </div>
          </div>
          <div className="pos-total">
            <div className="row-flex"><Icon name="receipt" size={20} /><b>Total {formatINR(total)}</b><span className="spacer" />
              <button className="link-btn" onClick={() => setBreakup((b) => !b)}>{breakup ? 'Hide' : 'Full'} breakup <span className="kbd">Ctrl+B</span></button>
            </div>
            <div className="muted small-text">Items: {tab.lines.length}, quantity: {formatQty(qtyCount)}</div>
            {breakup && totals && (
              <dl className="totals">
                <dt>Sub total</dt><dd>{formatINR(totals.subtotal)}</dd>
                {totals.discountTotal > 0 && (<><dt>Discount</dt><dd>-{formatINR(totals.discountTotal)}</dd></>)}
                {tab.charges.flatMap((c, i) => [<dt key={`c${i}`}>{c.name}</dt>, <dd key={`d${i}`}>{formatINR(c.amount)}</dd>])}
                {ctx.supply === 'intra'
                  ? (<><dt>CGST</dt><dd>{formatINR(totals.cgst)}</dd><dt>SGST</dt><dd>{formatINR(totals.sgst)}</dd></>)
                  : (<><dt>IGST</dt><dd>{formatINR(totals.igst)}</dd></>)}
                {totals.cess > 0 && (<><dt>Cess</dt><dd>{formatINR(totals.cess)}</dd></>)}
                {totals.roundOff !== 0 && (<><dt>Round off</dt><dd>{formatINR(totals.roundOff)}</dd></>)}
                <dt className="grand">Total</dt><dd className="grand">{formatINR(total)}</dd>
              </dl>
            )}
            {tab.notes && <div className="muted small-text">Remarks: {tab.notes}</div>}
          </div>

          <div className="form-grid">
            <label className="field"><span className="field-label">Payment mode</span>
              <select className="input" value={tab.mode} onChange={(e) => chooseMode(e.target.value as PaymentMode)} aria-label="Payment mode">
                {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <label className="field"><span className="field-label">Amount received</span>
              <input className="input num" inputMode="decimal" value={tab.tenderedText} placeholder={formatINR(total, { symbol: false })}
                aria-label="Amount received" onChange={(e) => update({ tenderedText: e.target.value.replace(/[^\d.]/g, '') })} />
            </label>
            {tab.mode !== 'cash' && (
              <>
                <label className="field"><span className="field-label">Into account</span>
                  <select className="input" value={tab.accountId} onChange={(e) => update({ accountId: e.target.value })}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <label className="field"><span className="field-label">Reference</span>
                  <input className="input" value={tab.reference} placeholder="UTR / cheque no." onChange={(e) => update({ reference: e.target.value })} />
                </label>
              </>
            )}
          </div>

          <div className="pos-change">
            {pay.due > 0
              ? (<><span>Balance {tab.partyId ? 'on credit' : 'still to take'}</span><b className={tab.partyId ? '' : 'pay'}>{formatINR(pay.due)}</b></>)
              : (<><span>Change to return</span><b>{formatINR(pay.change)}</b></>)}
          </div>
          <button className="btn primary pos-save" onClick={() => save(true)} disabled={busy || !tab.lines.length}>
            <Icon name="printer" size={18} />Save & print bill <span className="kbd">Ctrl+P</span>
          </button>
          <button className="btn" onClick={() => save(false)} disabled={busy || !tab.lines.length}>Save without printing <span className="kbd">Ctrl+S</span></button>
        </aside>
      </div>

      {dialog?.kind === 'line' && (() => {
        const line = tab.lines.find((l) => l.key === dialog.key)
        const item = line && ctx.items.get(line.itemId)
        if (!line || !item) return null
        return (
          <LineDialog item={item} line={line} ctx={ctx} altShort={unitShort(item.altUnitId)} onClose={() => { setDialog(null); searchRef.current?.focus() }}
            onSave={(l) => { setLines((list) => list.map((x) => (x.key === l.key ? l : x))); setDialog(null); searchRef.current?.focus() }} />
        )
      })()}
      {dialog?.kind === 'charge' && (
        <ChargeDialog rates={rates.filter((r) => r.isActive)} onClose={() => setDialog(null)}
          onSave={(c) => { update({ charges: [...tab.charges, c] }); setDialog(null) }} />
      )}
      {dialog?.kind === 'discount' && (
        <SimpleDialog title="Bill discount" label="Discount % on every item" initial="" numeric onClose={() => setDialog(null)}
          onSave={(v) => { const bp = safeBp(v); setLines((list) => list.map((l) => ({ ...l, discountPctBp: bp, discountAmount: 0 }))); setDialog(null) }} />
      )}
      {dialog?.kind === 'remarks' && (
        <SimpleDialog title="Remarks" label="Printed on the bill" initial={tab.notes} onClose={() => setDialog(null)}
          onSave={(v) => { update({ notes: v.trim() }); setDialog(null) }} />
      )}
    </div>
  )
}

/** "Wholesale ₹380 from 15 pcs: add 3 more" under an item that has a wholesale price it has not reached. */
function wholesaleNote(item: Item, l: PosLine, ctx: PosContext): string {
  if (item.wholesalePrice === null || item.wholesaleMinQty === null || l.priceOverride !== null || isWholesale(item, l, ctx.wholesaleBill)) return ''
  const need = item.wholesaleMinQty - Math.round((l.qty * unitFactor(item, l)) / 1000)
  const t = taxOf(item, ctx)
  const price = priceForDocument(item.wholesalePrice, item.priceIncludesTax, ctx.inclusive, t.bp + t.cess)
  return `Wholesale ${formatINR(price)} from ${formatQty(item.wholesaleMinQty)} ${item.baseUnitShort}${need > 0 ? `: add ${formatQty(need)} more` : ''}`
}

function safePaise(s: string): number {
  try {
    return toPaise(s || '0')
  } catch {
    return 0
  }
}
function safeBp(s: string): number {
  try {
    return Math.min(10_000, Math.max(0, percentToBp(s || '0')))
  } catch {
    return 0
  }
}

/** Change one line: quantity, unit, discount (% or ₹) and price. */
function LineDialog({ item, line, ctx, altShort, onSave, onClose }: { item: Item; line: PosLine; ctx: PosContext; altShort: string; onSave: (l: PosLine) => void; onClose: () => void }) {
  const [qty, setQty] = useState(formatQty(line.qty))
  const [alt, setAlt] = useState(line.useAltUnit)
  const [pct, setPct] = useState(line.discountPctBp ? String(line.discountPctBp / 100) : '')
  const [amt, setAmt] = useState(line.discountAmount ? String(line.discountAmount / 100) : '')
  const [price, setPrice] = useState(line.priceOverride !== null ? String(line.priceOverride / 100) : '')
  const [error, setError] = useState('')
  const auto = linePrice(item, { ...line, useAltUnit: alt, priceOverride: null, qty: (() => { try { return toMilli(qty || '0') } catch { return line.qty } })() }, ctx)
  const save = () => {
    try {
      const q = toMilli(qty)
      if (q <= 0) return setError('Quantity must be more than 0')
      onSave({
        ...line, qty: q, useAltUnit: alt, discountPctBp: pct.trim() ? percentToBp(pct) : 0,
        discountAmount: !pct.trim() && amt.trim() ? toPaise(amt) : 0, priceOverride: price.trim() ? toPaise(price) : null
      })
    } catch {
      setError('Check the numbers')
    }
  }
  return (
    <Modal title={`Change ${item.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel <span className="kbd">Esc</span></button><button className="btn primary" onClick={save}>Save <span className="kbd">Enter</span></button></>}>
      <form onSubmit={(e) => { e.preventDefault(); save() }} className="form-grid">
        {error && <div className="span-2"><Banner kind="error">{error}</Banner></div>}
        <label className="field"><span className="field-label">Quantity</span>
          <input className="input" autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.target.select()} aria-label="Quantity" />
        </label>
        <label className="field"><span className="field-label">Unit</span>
          <select className="input" value={alt ? 'alt' : 'base'} onChange={(e) => setAlt(e.target.value === 'alt')} disabled={!item.altUnitId}>
            <option value="base">{item.baseUnitShort || 'unit'}</option>
            {item.altUnitId && <option value="alt">{altShort} ({formatQty(item.altConversion ?? 0)} {item.baseUnitShort})</option>}
          </select>
        </label>
        <label className="field"><span className="field-label">Discount %</span>
          <input className="input" inputMode="decimal" value={pct} onChange={(e) => { setPct(e.target.value); if (e.target.value) setAmt('') }} aria-label="Discount %" />
        </label>
        <label className="field"><span className="field-label">or discount ₹ (whole line)</span>
          <input className="input" inputMode="decimal" value={amt} onChange={(e) => { setAmt(e.target.value); if (e.target.value) setPct('') }} aria-label="Discount amount" />
        </label>
        <label className="field span-2"><span className="field-label">Price per {alt ? altShort : item.baseUnitShort || 'unit'} (blank = {formatINR(auto)}{isWholesale(item, { qty: (() => { try { return toMilli(qty || '0') } catch { return 0 } })(), useAltUnit: alt }) ? ', wholesale' : ''})</span>
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price" />
        </label>
        <button type="submit" hidden />
      </form>
      <p className="muted small-text">Factor: 1 {alt ? altShort : item.baseUnitShort} = {formatQty(unitFactor(item, { useAltUnit: alt }))} {item.baseUnitShort}. MRP {item.mrp !== null ? formatINR(item.mrp) : 'not set'}.</p>
    </Modal>
  )
}

function ChargeDialog({ rates, onSave, onClose }: { rates: TaxRate[]; onSave: (c: { name: string; amount: number; taxRateId: string | null }) => void; onClose: () => void }) {
  const [name, setName] = useState('Packing')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [error, setError] = useState('')
  const save = () => {
    try {
      const a = toPaise(amount)
      if (!name.trim() || a <= 0) return setError('Enter a name and an amount')
      onSave({ name: name.trim(), amount: a, taxRateId: rate || null })
    } catch {
      setError('Enter a valid amount')
    }
  }
  return (
    <Modal title="Additional charge" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Add</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); save() }} className="form-grid">
        {error && <div className="span-2"><Banner kind="error">{error}</Banner></div>}
        <label className="field"><span className="field-label">For</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span className="field-label">Amount (before GST)</span><input className="input" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Charge amount" /></label>
        <label className="field"><span className="field-label">GST</span>
          <select className="input" value={rate} onChange={(e) => setRate(e.target.value)}>
            <option value="">No GST</option>
            {rates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function SimpleDialog({ title, label, initial, numeric, onSave, onClose }: { title: string; label: string; initial: string; numeric?: boolean; onSave: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(initial)
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave(v)}>Save</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(v) }}>
        <label className="field"><span className="field-label">{label}</span>
          <input className="input" autoFocus inputMode={numeric ? 'decimal' : undefined} value={v} onChange={(e) => setV(e.target.value)} aria-label={title} />
        </label>
      </form>
    </Modal>
  )
}
