import { useEffect, useMemo, useRef, useState } from 'react'
import { BILL_INFO, payDirection } from '@shared/billTypes'
import type {
  BillType,
  Business,
  Invoice,
  InvoiceInput,
  InvoiceSummary,
  Item,
  MoneyAccount,
  Party,
  PaymentMode,
  Preferences,
  TaxRate,
  Unit
} from '@shared/models'
import { formatINR, formatPercent, percentToBp, toPaise } from '@shared/money'
import { lineAmount, toBaseUnits, toMilli } from '@shared/qty'
import { computeTax, priceForDocument, type TaxLine } from '@shared/tax'
import { todayLocal } from '@shared/fy'
import { api, errorMessage } from '../../api'
import { Icon, IconTile } from '../../components/Icon'
import { Banner, DateInput, Field, StateSelect, TextArea, TextInput, Toggle } from '../../components/Field'
import { paiseText } from '../../forms'
import { formatQty } from '@shared/qty'
import { PartyForm } from '../parties/PartyForm'
import { BILL_EXTRA_LABELS, DEFAULT_FEATURES, PO_KEYS, TRANSPORT_KEYS, type BillExtra, type FeatureSettings } from '@shared/features'
import { DATE_KEYS, DEFAULT_ITEM_FIELDS, enabledDetails, type DetailKey, type ItemFieldSettings, type LineDetails } from '@shared/itemFields'

interface Row {
  key: number
  itemId: string | null
  text: string
  qty: string
  unitId: string
  rate: string
  /** Rate follows the item's price until the user types their own. */
  rateAuto: boolean
  discount: string
  taxRateId: string
  hsn: string
  /** Batch, dates, model, size, serial for this line. */
  details: LineDetails
}

interface ChargeRow {
  key: number
  name: string
  amount: string
  taxRateId: string
}

let nextKey = 1
const blankRow = (): Row => ({
  key: nextKey++, itemId: null, text: '', qty: '1', unitId: '', rate: '', rateAuto: true, discount: '', taxRateId: '', hsn: '', details: {}
})
const isBlank = (r: Row) => !r.itemId && !r.text.trim()

/** Parse text, falling back when it is not a valid number (live totals must not crash). */
function safe<T>(f: () => T, fallback: T): T {
  try {
    return f()
  } catch {
    return fallback
  }
}

const MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' }
]

interface Props {
  type: BillType
  business: Business
  invoiceId: string | null
  /** Start a new bill from another one: convert an estimate/order/challan, or return against a bill. */
  from?: { id: string; type: BillType } | null
  onSaved: (inv: Invoice, print: boolean) => void
  onCancel: () => void
}

export function InvoiceEditor({ type, business, invoiceId, from = null, onSaved, onCancel }: Props) {
  const info = BILL_INFO[type]
  const purchase = info.side === 'purchase'
  const noun = info.noun.toLowerCase()
  const moneyOut = payDirection(type) === 'out'
  // Due date means "pay by" on invoices and bills and "valid till" on estimates; other kinds hide it.
  const dueLabel = type === 'ESTIMATE' ? 'Valid till' : type === 'SALE_INVOICE' || type === 'PURCHASE_BILL' ? 'Due date' : ''
  const [ready, setReady] = useState(false)
  const [parties, setParties] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [rates, setRates] = useState<TaxRate[]>([])
  const [itemFields, setItemFields] = useState<ItemFieldSettings>(DEFAULT_ITEM_FIELDS)
  const [features, setFeatures] = useState<FeatureSettings>(DEFAULT_FEATURES)
  const [extra, setExtra] = useState<BillExtra>({})
  useEffect(() => {
    api.getItemFields().then(setItemFields, () => undefined)
    api.getFeatures().then(setFeatures, () => undefined)
  }, [])
  const [accounts, setAccounts] = useState<MoneyAccount[]>([])
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [original, setOriginal] = useState<Invoice | null>(null)
  const [source, setSource] = useState<Invoice | null>(null)
  const [linkedId, setLinkedId] = useState(from?.id ?? '')
  const [returnable, setReturnable] = useState<InvoiceSummary[]>([])

  const [partyId, setPartyId] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [number, setNumber] = useState('')
  const [suggested, setSuggested] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [dueDate, setDueDate] = useState('')
  const [pos, setPos] = useState('')
  const [inclusive, setInclusive] = useState(false)
  const [rows, setRows] = useState<Row[]>([blankRow()])
  const [charges, setCharges] = useState<ChargeRow[]>([])
  const [paidInFull, setPaidInFull] = useState(false)
  const [received, setReceived] = useState('')
  const [accountId, setAccountId] = useState('cash')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [addingParty, setAddingParty] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dueTouched = useRef(false)

  // ---------- Loading ----------
  useEffect(() => {
    Promise.all([
      api.listParties(), api.listItems(), api.listUnits(), api.listTaxRates(), api.listAccounts(), api.getPreferences(),
      invoiceId ? api.getBill(type, invoiceId) : from ? api.getBill(from.type, from.id) : Promise.resolve(null)
    ]).then(([p, i, u, r, a, pr, loaded]) => {
      // When starting from another bill, copy its party and lines but keep this bill's own number and dates.
      const inv = loaded
      const copying = !invoiceId && !!loaded
      if (copying) setSource(loaded)
      setParties(p)
      setItems(i)
      setUnits(u)
      setRates(r)
      setAccounts(a)
      setPrefs(pr)
      if (inv) {
        if (!copying) {
          setOriginal(inv)
          setNumber(inv.number)
          setDate(inv.date)
          setDueDate(inv.dueDate)
          dueTouched.current = true
        }
        setPartyId(inv.partyId ?? '')
        setWalkInName(inv.partyId ? '' : inv.partyName)
        setPos(inv.placeOfSupply)
        setInclusive(inv.pricesIncludeTax)
        setRows([
          ...inv.lines.map((l) => ({
            key: nextKey++,
            itemId: l.itemId,
            text: l.itemId ? l.itemName : l.description,
            qty: formatQty(l.qty),
            unitId: l.unitId ?? '',
            rate: paiseText(l.rate) || '0',
            rateAuto: false,
            discount: l.discountPctBp ? formatPercent(l.discountPctBp).replace('%', '') : '',
            taxRateId: l.taxRateId ?? '',
            hsn: l.hsnSac,
            details: l.details ?? {}
          })),
          blankRow()
        ])
        setCharges(inv.charges.map((c) => ({ key: nextKey++, name: c.name, amount: paiseText(c.amount), taxRateId: c.taxRateId ?? '' })))
        if (inv.received && !copying) {
          setReceived(paiseText(inv.received.amount))
          setPaidInFull(inv.received.amount === inv.grandTotal)
          setAccountId(inv.received.accountId)
          setMode(inv.received.mode)
          setReference(inv.received.reference)
        }
        setNotes(inv.notes)
        if (!copying || inv.type === type) setExtra(inv.extra ?? {})
        setTerms(inv.terms)
      } else {
        setInclusive(pr.pricesIncludeTax)
        // New sale bills start with the business's usual terms.
        if (info.side === 'sale' && !info.returnOf) {
          api.getPrintSettings().then((p) => p.defaultTerms && setTerms((t) => t || p.defaultTerms), () => undefined)
        }
      }
      setReady(true)
    }, (e) => setFailure(errorMessage(e)))
  }, [invoiceId])

  // Suggested number for a new invoice follows the date (a new financial year restarts it).
  useEffect(() => {
    if (invoiceId || !info.numbered) return
    api.nextBillNumber(type, date).then((n) => {
      setNumber((cur) => (cur === '' || cur === suggested ? n : cur))
      setSuggested(n)
    })
  }, [date, invoiceId])

  const party = parties.find((p) => p.id === partyId) ?? null

  // A return can be set against one of the party's bills; offer them once the party is known.
  useEffect(() => {
    if (!info.returnOf || !partyId || invoiceId) return setReturnable([])
    api.listBills(info.returnOf, { partyId }).then(setReturnable, () => setReturnable([]))
  }, [partyId])
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const rateById = useMemo(() => new Map(rates.map((r) => [r.id, r])), [rates])
  const registered = prefs?.gstRegistered ?? true
  // Sales go to the customer's state; purchases come to us, taxed by where the supplier is.
  const placeOfSupply = pos || (purchase ? '' : party?.stateCode) || business.stateCode
  const supply = purchase
    ? (party?.stateCode || business.stateCode) === placeOfSupply ? 'intra' : 'inter'
    : placeOfSupply === business.stateCode ? 'intra' : 'inter'

  // Default the due date from the party's terms until the user picks one.
  useEffect(() => {
    if (dueTouched.current || !prefs) return
    const days = party?.paymentTermDays ?? prefs.defaultDueDays
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    setDueDate(d.toISOString().slice(0, 10))
  }, [date, party?.id, prefs])

  // ---------- Rows ----------
  const rateBpOf = (taxRateId: string) => {
    const r = rateById.get(taxRateId)
    return registered && r ? { bp: r.rateBp, cess: r.cessBp } : { bp: 0, cess: 0 }
  }

  const autoRate = (row: Row, docInclusive: boolean): string => {
    const item = row.itemId ? itemById.get(row.itemId) : undefined
    if (!item) return row.rate
    const factor = row.unitId && row.unitId === item.altUnitId && item.altConversion ? item.altConversion : 1000
    const baseQty = toBaseUnits(safe(() => toMilli(row.qty), 0), factor)
    const wholesale = !purchase && item.wholesalePrice !== null && item.wholesaleMinQty !== null && baseQty >= item.wholesaleMinQty
    const tax = rateBpOf(row.taxRateId)
    // Purchase prices are kept before tax; sale prices follow the item's own setting.
    const price = purchase
      ? priceForDocument(item.purchasePrice, false, docInclusive, tax.bp + tax.cess)
      : priceForDocument(wholesale ? item.wholesalePrice! : item.salePrice, item.priceIncludesTax, docInclusive, tax.bp + tax.cess)
    return paiseText(lineAmount(factor, price)) || '0'
  }

  const updateRow = (key: number, change: Partial<Row>) =>
    setRows((list) => {
      const next = list.map((r) => {
        if (r.key !== key) return r
        const merged = { ...r, ...change }
        return merged.rateAuto && merged.itemId && change.rate === undefined ? { ...merged, rate: autoRate(merged, inclusive) } : merged
      })
      // Always keep one empty row at the end to type into.
      return isBlank(next[next.length - 1]) ? next : [...next, blankRow()]
    })

  /** An item by its barcode or item code (what a scanner types), case-insensitive for codes. */
  const byCode = (raw: string) => {
    const code = raw.trim()
    if (!code) return undefined
    return items.find((i) => i.isActive && (i.barcode === code || (i.code !== '' && i.code.toLowerCase() === code.toLowerCase())))
  }

  const pickText = (key: number, text: string) => {
    const item = items.find((i) => i.isActive && i.name.toLowerCase() === text.trim().toLowerCase()) ?? byCode(text)
    if (item) {
      updateRow(key, {
        itemId: item.id, text: item.name, unitId: item.baseUnitId ?? '', taxRateId: item.taxRateId ?? '',
        hsn: item.hsnSac, rateAuto: true
      })
    } else {
      updateRow(key, { itemId: null, text })
    }
  }

  // Scanning: each scan adds the item, or one more of it if it is already on the bill.
  const [scan, setScan] = useState('')
  const [scanNote, setScanNote] = useState<{ ok: boolean; text: string } | null>(null)
  const addScanned = (raw: string) => {
    const code = raw.trim()
    setScan('')
    if (!code) return
    const item = byCode(code)
    if (!item) return setScanNote({ ok: false, text: `No item has the barcode or code ${code}` })
    const existing = rows.find((r) => r.itemId === item.id && r.unitId === (item.baseUnitId ?? ''))
    if (existing) {
      const qty = safe(() => toMilli(existing.qty), 0) + 1000
      updateRow(existing.key, { qty: formatQty(qty) })
      setScanNote({ ok: true, text: `${item.name} × ${formatQty(qty)}` })
    } else {
      const blank = rows[rows.length - 1]
      updateRow(blank.key, {
        itemId: item.id, text: item.name, unitId: item.baseUnitId ?? '', taxRateId: item.taxRateId ?? '', hsn: item.hsnSac, rateAuto: true, qty: '1'
      })
      setScanNote({ ok: true, text: `${item.name} added` })
    }
  }

  // Transport and PO boxes, when switched on (PO only on sale bills).
  const extraKeys = [...(features.transport ? TRANSPORT_KEYS : []), ...(features.poDetails && info.side === 'sale' ? PO_KEYS : [])]
  const detailKeys = enabledDetails(itemFields)
  const dateFormat = (k: DetailKey) => (k === 'mfg' ? itemFields.mfgFormat : itemFields.expFormat)
  const setDetail = (key: number, k: DetailKey, v: string) =>
    setRows((list) =>
      list.map((r) => {
        if (r.key !== key) return r
        const details = { ...r.details }
        if (v.trim()) details[k] = v
        else delete details[k]
        return { ...r, details }
      })
    )

  const removeRow = (key: number) =>
    setRows((list) => {
      const next = list.filter((r) => r.key !== key)
      return next.length && isBlank(next[next.length - 1]) ? next : [...next, blankRow()]
    })

  const toggleInclusive = (v: boolean) => {
    setInclusive(v)
    setRows((list) => list.map((r) => (r.rateAuto && r.itemId ? { ...r, rate: autoRate(r, v) } : r)))
  }

  // ---------- Live totals ----------
  const filled = rows.filter((r) => !isBlank(r))
  const taxLines: TaxLine[] = filled.map((r) => {
    const t = rateBpOf(r.taxRateId)
    return {
      qty: safe(() => toMilli(r.qty), 0),
      rate: safe(() => toPaise(r.rate || '0'), 0),
      discountPctBp: safe(() => (r.discount.trim() ? percentToBp(r.discount) : 0), 0),
      discountAmount: 0,
      taxRateBp: t.bp,
      cessBp: t.cess
    }
  })
  const totals = computeTax({
    lines: taxLines,
    charges: charges.map((c) => ({ amount: safe(() => toPaise(c.amount || '0'), 0), taxRateBp: rateBpOf(c.taxRateId).bp })),
    pricesIncludeTax: inclusive,
    supply,
    roundOff: prefs?.roundOff ?? true
  })
  // Profit while billing: taxable value of each item line minus what the items cost (purchase price per base unit).
  const profit = (() => {
    if (!features.showProfit || type !== 'SALE_INVOICE') return null
    let p = 0
    filled.forEach((r, i) => {
      const it = r.itemId ? itemById.get(r.itemId) : undefined
      const res = totals.lines[i]
      if (!it || !res) return
      const factor = r.unitId && r.unitId === it.altUnitId && it.altConversion ? it.altConversion : 1000
      p += res.taxable - lineAmount(toBaseUnits(safe(() => toMilli(r.qty), 0), factor), it.purchasePrice)
    })
    return p
  })()
  const cashSale = info.walkIn && info.posts && partyId === ''
  const receivedPaise = cashSale || paidInFull ? totals.grandTotal : safe(() => toPaise(received || '0'), 0)
  const balance = totals.grandTotal - receivedPaise

  const creditWarning = (() => {
    if (type !== 'SALE_INVOICE' || !party || party.creditLimit === null) return null
    const already = original && original.partyId === party.id ? original.balanceDue : 0
    const after = party.balance - already + balance
    return after > party.creditLimit
      ? `${party.name} will owe ${formatINR(after)}, above the credit limit of ${formatINR(party.creditLimit)}`
      : null
  })()

  // ---------- Saving ----------
  const save = async (print: boolean) => {
    setFailure(null)
    const lines: InvoiceInput['lines'] = []
    for (const [i, r] of filled.entries()) {
      try {
        const item = r.itemId ? itemById.get(r.itemId) : undefined
        lines.push({
          itemId: r.itemId,
          description: r.itemId ? '' : r.text.trim(),
          qty: toMilli(r.qty),
          unitId: r.unitId || null,
          unitFactor: item && r.unitId && r.unitId === item.altUnitId && item.altConversion ? item.altConversion : 1000,
          rate: toPaise(r.rate || '0'),
          discountPctBp: r.discount.trim() ? percentToBp(r.discount) : 0,
          discountAmount: 0,
          taxRateId: r.taxRateId || null,
          hsnSac: r.hsn.trim(),
          details: Object.keys(r.details).length ? r.details : null
        })
      } catch {
        return setFailure(`Line ${i + 1}: check the quantity, price and discount`)
      }
    }
    let chargeInput: InvoiceInput['charges']
    let receivedAmount: number
    try {
      chargeInput = charges.map((c) => ({ name: c.name, amount: toPaise(c.amount || '0'), taxRateId: c.taxRateId || null }))
      receivedAmount = cashSale || paidInFull ? totals.grandTotal : toPaise(received || '0')
    } catch {
      return setFailure('Check the charge and received amounts')
    }
    const input: InvoiceInput = {
      partyId: partyId || null,
      walkInName,
      number: info.numbered && number === suggested && !invoiceId ? '' : number,
      date,
      dueDate,
      placeOfSupply: pos,
      pricesIncludeTax: inclusive,
      lines,
      charges: chargeInput,
      received: info.posts && receivedAmount > 0 ? { amount: receivedAmount, accountId, mode, reference } : null,
      notes,
      terms,
      extra: Object.keys(extra).length ? extra : null,
      linkedId: invoiceId ? null : linkedId || null
    }
    setSaving(true)
    try {
      onSaved(await api.saveBill(type, invoiceId, input), print)
    } catch (e) {
      setFailure(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (!ready) return failure ? <Banner kind="error">{failure}</Banner> : <div className="muted">Loading…</div>

  const activeRates = (current: string) => rates.filter((r) => r.isActive || r.id === current)
  const unitShort = (id: string) => units.find((u) => u.id === id)?.short ?? ''

  return (
    <div className="editor">
      <div className="page-head">
        <IconTile name={invoiceId ? 'edit' : 'plus'} tone={purchase ? 'violet' : 'accent'} />
        <h1>
          {invoiceId
            ? `Edit ${noun} ${original?.number ?? ''}`
            : `New ${type === 'SALE_INVOICE' ? 'sale invoice' : type === 'PURCHASE_BILL' ? 'purchase bill' : noun}`}
          {source && !info.returnOf && <span className="muted"> from {BILL_INFO[source.type].noun.toLowerCase()} {source.number}</span>}
        </h1>
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}><Icon name="x" size={17} />Cancel</button>
        <button className="btn" onClick={() => save(true)} disabled={saving}><Icon name="printer" size={17} />Save & print</button>
        <button className="btn primary" onClick={() => save(false)} disabled={saving}>
          {saving ? 'Saving…' : <><Icon name="check" size={17} />Save</>}
        </button>
      </div>
      {failure && <Banner kind="error">{failure}</Banner>}
      {creditWarning && <Banner kind="error">{creditWarning}</Banner>}
      {info.returnOf && !invoiceId && (
        <p className="muted">
          Enter the goods coming back and their price. The total is first set off against what is still due on the
          original {BILL_INFO[info.returnOf].noun.toLowerCase()}; anything more stays to be refunded.
        </p>
      )}

      <div className="card wide editor-head">
        <div className="form-grid three">
          <Field label={purchase ? 'Supplier' : 'Customer'} group>
            <div className="row-flex">
              <select className="input" value={partyId} disabled={!!source && !!info.returnOf} onChange={(e) => { setPartyId(e.target.value); setLinkedId('') }}>
                <option value="">{info.walkIn ? (info.posts ? 'Cash sale (walk-in)' : 'Walk-in customer') : purchase ? 'Choose a supplier…' : 'Choose a party…'}</option>
                {parties
                  .filter((p) => (p.isActive && p.kind !== (purchase ? 'customer' : 'supplier')) || p.id === partyId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.phone ? ` · ${p.phone}` : ''}</option>
                  ))}
              </select>
              <button className="btn" type="button" title="Add a new party" onClick={() => setAddingParty(true)}><Icon name="plus" size={16} />New</button>
            </div>
            {party ? (
              <span className="field-hint">
                Balance {formatINR(party.balance)}{party.gstin ? ` · GSTIN ${party.gstin}` : ' · unregistered'}
              </span>
            ) : !info.walkIn ? null : (
              <TextInput value={walkInName} onChange={setWalkInName} placeholder="Customer name (optional)" />
            )}
          </Field>
          <Field label={type === 'PURCHASE_BILL' ? "Supplier's bill number" : `${info.noun} number`}>
            <TextInput value={number} onChange={setNumber} placeholder={type === 'PURCHASE_BILL' ? 'As printed on their bill' : ''} />
          </Field>
          <Field label={`${info.noun} date`}>
            <DateInput value={date} onChange={setDate} />
          </Field>
          {info.returnOf && (
            <Field label={`Against ${BILL_INFO[info.returnOf].noun.toLowerCase()}`} hint={invoiceId ? 'Fixed once saved' : 'Optional'}>
              {invoiceId ? (
                <span>{original?.links.find((l) => l.kind === 'returned' && l.direction === 'from')?.number || '—'}</span>
              ) : (
                <select className="input" value={linkedId} onChange={(e) => setLinkedId(e.target.value)} disabled={!partyId}>
                  <option value="">Not against a particular bill</option>
                  {source && !returnable.some((b) => b.id === source.id) && <option value={source.id}>{source.number}</option>}
                  {returnable.map((b) => (
                    <option key={b.id} value={b.id}>{b.number || '(no number)'} · {b.date} · {formatINR(b.grandTotal)}{b.balanceDue ? ` · ${formatINR(b.balanceDue)} due` : ''}</option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Place of supply" hint={supply === 'intra' ? 'Same state: CGST + SGST' : 'Other state: IGST'}>
            <StateSelect value={placeOfSupply} onChange={setPos} />
          </Field>
          {dueLabel && (
            <Field label={dueLabel}>
              <DateInput value={dueDate} onChange={(v) => { dueTouched.current = true; setDueDate(v) }} />
            </Field>
          )}
          <Field label="Prices are" group>
            <div className="seg">
              <button type="button" className={inclusive ? '' : 'on'} onClick={() => toggleInclusive(false)}>Without tax</button>
              <button type="button" className={inclusive ? 'on' : ''} onClick={() => toggleInclusive(true)}>With tax</button>
            </div>
          </Field>
        </div>
      </div>

      <div className="card wide lines-card">
        <div className="scan-box">
          <input
            className="input"
            value={scan}
            placeholder="Scan barcode or type item code, then Enter"
            aria-label="Scan barcode"
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addScanned(scan)
              }
            }}
          />
          {scanNote && <span className={scanNote.ok ? 'muted' : 'field-error'}>{scanNote.text}</span>}
        </div>
        <datalist id="invoice-items">
          {items.filter((i) => i.isActive).map((i) => (
            <option key={i.id} value={i.name}>
              {formatINR(purchase ? i.purchasePrice : i.salePrice)}{i.trackStock ? ` · stock ${formatQty(i.stockQty)} ${i.baseUnitShort}` : ''}{i.barcode ? ` · ${i.barcode}` : ''}
            </option>
          ))}
        </datalist>
        <table className="table lines">
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th>Item</th>
              <th style={{ width: 90 }}>HSN/SAC</th>
              <th style={{ width: 80 }} className="amount">Qty</th>
              <th style={{ width: 90 }}>Unit</th>
              <th style={{ width: 110 }} className="amount">Price/unit</th>
              <th style={{ width: 70 }} className="amount">Disc %</th>
              <th style={{ width: 130 }}>GST</th>
              <th style={{ width: 120 }} className="amount">Amount</th>
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const blank = isBlank(r)
              const item = r.itemId ? itemById.get(r.itemId) : undefined
              const result = blank ? null : totals.lines[filled.indexOf(r)]
              const unitOptions = item ? [item.baseUnitId, item.altUnitId].filter((u): u is string => !!u) : []
              const lowStock =
                info.posts && info.sign > 0 && item && item.trackStock && toBaseUnits(safe(() => toMilli(r.qty), 0), r.unitId === item.altUnitId && item.altConversion ? item.altConversion : 1000) > item.stockQty
              return [
                <tr key={r.key} className={blank ? 'blank' : detailKeys.length ? 'has-details' : ''}>
                  <td className="muted">{blank ? '' : idx + 1}</td>
                  <td>
                    <input
                      className="input"
                      list="invoice-items"
                      value={r.text}
                      placeholder={blank ? 'Type or pick an item…' : ''}
                      onChange={(e) => pickText(r.key, e.target.value)}
                    />
                    {lowStock && <span className="field-error">Only {formatQty(item!.stockQty)} {item!.baseUnitShort} in stock</span>}
                  </td>
                  <td><input className="input" value={r.hsn} disabled={blank} onChange={(e) => updateRow(r.key, { hsn: e.target.value })} /></td>
                  <td><input className="input num" value={r.qty} disabled={blank} inputMode="decimal" onChange={(e) => updateRow(r.key, { qty: e.target.value })} /></td>
                  <td>
                    {unitOptions.length > 1 ? (
                      <select className="input" value={r.unitId} onChange={(e) => updateRow(r.key, { unitId: e.target.value })}>
                        {unitOptions.map((u) => <option key={u} value={u}>{unitShort(u)}</option>)}
                      </select>
                    ) : (
                      <span className="muted">{unitShort(r.unitId)}</span>
                    )}
                  </td>
                  <td>
                    <input
                      className="input num"
                      value={r.rate}
                      disabled={blank}
                      inputMode="decimal"
                      onChange={(e) => updateRow(r.key, { rate: e.target.value, rateAuto: false })}
                    />
                  </td>
                  <td><input className="input num" value={r.discount} disabled={blank} inputMode="decimal" onChange={(e) => updateRow(r.key, { discount: e.target.value })} /></td>
                  <td>
                    <select className="input" value={r.taxRateId} disabled={blank || !registered} onChange={(e) => updateRow(r.key, { taxRateId: e.target.value })}>
                      <option value="">None</option>
                      {activeRates(r.taxRateId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="amount">{result ? formatINR(result.total) : ''}</td>
                  <td>{!blank && <button className="chip-x" title="Remove line" onClick={() => removeRow(r.key)}>×</button>}</td>
                </tr>,
                !blank && detailKeys.length > 0 && (
                  <tr key={`${r.key}-details`} className="details-row">
                    <td />
                    <td colSpan={9}>
                      <div className="line-details">
                        {detailKeys.map((k) => (
                          <label key={k}>
                            <span>{itemFields.fields[k].label}</span>
                            <input
                              className="input"
                              type={DATE_KEYS.includes(k) ? (dateFormat(k) === 'mm/yyyy' ? 'month' : 'date') : 'text'}
                              maxLength={40}
                              value={r.details[k] ?? ''}
                              aria-label={`${itemFields.fields[k].label}, line ${idx + 1}`}
                              onChange={(e) => setDetail(r.key, k, e.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              ]
            })}
          </tbody>
        </table>
      </div>

      <div className="editor-bottom">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Additional charges</h3>
          {charges.map((c) => (
            <div key={c.key} className="inline-form charge-row">
              <TextInput value={c.name} onChange={(v) => setCharges((l) => l.map((x) => (x.key === c.key ? { ...x, name: v } : x)))} placeholder="e.g. Delivery" />
              <TextInput value={c.amount} inputMode="decimal" onChange={(v) => setCharges((l) => l.map((x) => (x.key === c.key ? { ...x, amount: v } : x)))} placeholder="Amount" />
              <select className="input" value={c.taxRateId} disabled={!registered} onChange={(e) => setCharges((l) => l.map((x) => (x.key === c.key ? { ...x, taxRateId: e.target.value } : x)))}>
                <option value="">No GST</option>
                {activeRates(c.taxRateId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="chip-x" title="Remove charge" onClick={() => setCharges((l) => l.filter((x) => x.key !== c.key))}>×</button>
            </div>
          ))}
          <button className="btn small" onClick={() => setCharges((l) => [...l, { key: nextKey++, name: '', amount: '', taxRateId: '' }])}>
            <Icon name="plus" size={16} />Add charge
          </button>
          {extraKeys.length > 0 && (
            <>
              <h3>{features.transport ? 'Transport details' : 'Purchase order'}</h3>
              <div className="bill-extra">
                {extraKeys.map((k) => (
                  <label key={k} className="field">
                    <span className="field-label">{BILL_EXTRA_LABELS[k]}</span>
                    <input
                      className="input"
                      type={k === 'deliveryDate' || k === 'poDate' ? 'date' : 'text'}
                      inputMode={k === 'ewayBillNo' ? 'numeric' : undefined}
                      maxLength={60}
                      aria-label={BILL_EXTRA_LABELS[k]}
                      value={extra[k] ?? ''}
                      onChange={(e) => setExtra((x) => ({ ...x, [k]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
            </>
          )}
          <h3>Notes</h3>
          <TextArea value={notes} onChange={setNotes} placeholder={`Shown on the ${noun}`} />
          <h3>Terms & conditions</h3>
          <TextArea value={terms} onChange={setTerms} placeholder="e.g. Goods once sold will not be taken back" />
        </div>

        <div className="card totals-card">
          <dl className="totals">
            {totals.discountTotal > 0 && (<><dt>Discount</dt><dd>-{formatINR(totals.discountTotal)}</dd></>)}
            <dt>{inclusive ? 'Taxable value' : 'Sub total'}</dt><dd>{formatINR(totals.taxableTotal)}</dd>
            {totals.chargesTotal > 0 && (<><dt>Charges</dt><dd>{formatINR(totals.chargesTotal)}</dd></>)}
            {supply === 'intra' ? (
              <><dt>CGST</dt><dd>{formatINR(totals.cgst)}</dd><dt>SGST</dt><dd>{formatINR(totals.sgst)}</dd></>
            ) : (
              <><dt>IGST</dt><dd>{formatINR(totals.igst)}</dd></>
            )}
            {totals.cess > 0 && (<><dt>Cess</dt><dd>{formatINR(totals.cess)}</dd></>)}
            {totals.roundOff !== 0 && (<><dt>Round off</dt><dd>{formatINR(totals.roundOff)}</dd></>)}
            <dt className="grand">Total</dt><dd className="grand">{formatINR(totals.grandTotal)}</dd>
          </dl>
          {profit !== null && (
            <div className={profit < 0 ? 'profit loss' : 'profit'} title="Taxable value of the items minus their purchase price. Not printed.">
              <span className="muted">Profit on this bill</span><b>{formatINR(profit)}</b>
            </div>
          )}

          {info.posts && <div className="received">
            {cashSale ? (
              <p className="muted">Cash sale: the full amount is received now.</p>
            ) : (
              <>
                <Toggle checked={paidInFull} onChange={setPaidInFull} label={info.returnOf ? 'Refunded in full now' : 'Fully paid now'} />
                {!paidInFull && (
                  <Field label={`${info.paidWord} now (₹)`}>
                    <TextInput value={received} onChange={setReceived} inputMode="decimal" placeholder="0" />
                  </Field>
                )}
              </>
            )}
            {receivedPaise > 0 && (
              <div className="form-grid">
                <Field label={moneyOut ? 'Paid from' : 'Received in'}>
                  <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
                <Field label="Mode">
                  <select className="input" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
                    {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </Field>
                {mode !== 'cash' && (
                  <Field label="Reference (UTR / cheque no.)">
                    <TextInput value={reference} onChange={setReference} />
                  </Field>
                )}
              </div>
            )}
            <dl className="totals">
              <dt>{info.returnOf ? 'Left to set off or refund' : 'Balance due'}</dt>
              <dd className={balance > 0 ? 'pay' : ''}>{formatINR(balance)}</dd>
            </dl>
          </div>}
        </div>
      </div>

      {addingParty && (
        <PartyForm
          party={null}
          defaultKind={purchase ? 'supplier' : 'customer'}
          onClose={() => setAddingParty(false)}
          onSaved={(p) => {
            setAddingParty(false)
            api.listParties().then(setParties)
            setPartyId(p.id)
          }}
        />
      )}
    </div>
  )
}
