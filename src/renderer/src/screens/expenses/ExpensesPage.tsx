import { useEffect, useMemo, useState } from 'react'
import type { Business, Expense, ExpenseInput, MoneyAccount, Preferences, TaxRate } from '@shared/models'
import { applyRate, formatINR, toPaise } from '@shared/money'
import { todayLocal } from '@shared/fy'
import { api, errorMessage } from '../../api'
import { Banner, DateInput, Field, Modal, TextArea, TextInput } from '../../components/Field'
import { paiseText } from '../../forms'
import { PERIODS, periodRange, type PeriodKey } from '../../periods'

export function ExpensesPage({ business }: { business: Business }) {
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [category, setCategory] = useState('')
  const [list, setList] = useState<Expense[]>([])
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const load = () =>
    api.listExpenses(periodRange(period, business.fyStartMonth)).then(setList, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  useEffect(() => {
    load()
  }, [period])

  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of list) m.set(e.category, (m.get(e.category) ?? 0) + e.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [list])
  const shown = list.filter((e) => !category || e.category === category)
  const total = shown.reduce((s, e) => s + e.total, 0)
  const gst = shown.reduce((s, e) => s + e.cgst + e.sgst, 0)

  const remove = async (e: Expense) => {
    if (!window.confirm(`Delete this ${e.category} expense of ${formatINR(e.total)}? The money goes back to ${e.accountName}.`)) return
    try {
      await api.deleteExpense(e.id)
      setMessage({ kind: 'success', text: 'Expense deleted' })
      load()
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) })
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1>Expenses</h1>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setEditing('new')}>+ Add expense</button>
      </div>
      <div className="stats">
        <div className="stat"><div className="label">Total paid{category ? ` · ${category}` : ''}</div><div className="value pay">{formatINR(total)}</div></div>
        <div className="stat"><div className="label">GST credit on these</div><div className="value">{formatINR(gst)}</div></div>
        {byCategory.slice(0, 3).map(([c, amount]) => (
          <button key={c} className="stat link" onClick={() => setCategory(category === c ? '' : c)}>
            <div className="label">{c}</div>
            <div className="value">{formatINR(amount)}</div>
          </button>
        ))}
      </div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="toolbar">
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {byCategory.map(([c]) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="card wide" style={{ maxWidth: 'none', padding: 0 }}>
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Paid to</th>
              <th>Bill no.</th>
              <th>Paid from</th>
              <th className="amount">Amount</th>
              <th className="amount">GST</th>
              <th className="amount">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="empty">No expenses in this period. Add rent, salaries, bills and other costs here.</td></tr>}
            {shown.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => setEditing(e)}>
                <td className="nowrap">{e.date}</td>
                <td>{e.category}</td>
                <td>{e.paidTo || '—'}</td>
                <td>{e.reference || '—'}</td>
                <td>{e.accountName}</td>
                <td className="amount">{formatINR(e.amount)}</td>
                <td className="amount">{e.cgst + e.sgst ? formatINR(e.cgst + e.sgst) : '—'}</td>
                <td className="amount">{formatINR(e.total)}</td>
                <td><button className="chip-x" title="Delete" onClick={(ev) => { ev.stopPropagation(); remove(e) }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <ExpenseForm
          expense={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(e) => {
            setEditing(null)
            setMessage({ kind: 'success', text: `${e.category} expense of ${formatINR(e.total)} saved` })
            load()
          }}
        />
      )}
    </div>
  )
}

function ExpenseForm({ expense, onClose, onSaved }: { expense: Expense | null; onClose: () => void; onSaved: (e: Expense) => void }) {
  const [categories, setCategories] = useState<string[]>([])
  const [accounts, setAccounts] = useState<MoneyAccount[]>([])
  const [rates, setRates] = useState<TaxRate[]>([])
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [date, setDate] = useState(expense?.date ?? todayLocal())
  const [category, setCategory] = useState(expense?.category ?? '')
  const [amount, setAmount] = useState(expense ? paiseText(expense.amount) : '')
  const [taxRateId, setTaxRateId] = useState(expense?.taxRateId ?? '')
  const [accountId, setAccountId] = useState(expense?.accountId ?? 'cash')
  const [paidTo, setPaidTo] = useState(expense?.paidTo ?? '')
  const [reference, setReference] = useState(expense?.reference ?? '')
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([api.listExpenseCategories(), api.listAccounts(), api.listTaxRates(), api.getPreferences()]).then(([c, a, r, p]) => {
      setCategories(c)
      setAccounts(a)
      setRates(r.filter((x) => x.isActive || x.id === taxRateId))
      setPrefs(p)
    }, (e) => setFailure(errorMessage(e)))
  }, [])

  const amountPaise = (() => {
    try {
      return toPaise(amount || '0')
    } catch {
      return 0
    }
  })()
  const rate = rates.find((r) => r.id === taxRateId)
  const tax = prefs?.gstRegistered && rate ? applyRate(amountPaise, rate.rateBp) : 0

  const save = async () => {
    setFailure(null)
    let paise: number
    try {
      paise = toPaise(amount)
    } catch {
      return setFailure('Enter the amount as a number')
    }
    const input: ExpenseInput = { date, category, amount: paise, taxRateId: taxRateId || null, accountId, paidTo, reference, notes }
    setSaving(true)
    try {
      onSaved(await api.saveExpense(expense?.id ?? null, input))
    } catch (e) {
      setFailure(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={expense ? 'Edit expense' : 'Add expense'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save expense'}</button></>}
    >
      {failure && <Banner kind="error">{failure}</Banner>}
      <div className="form-grid">
        <Field label="Category" required hint="Pick one or type a new one">
          <input className="input" list="expense-categories" value={category} onChange={(e) => setCategory(e.target.value)} autoFocus />
          <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Date"><DateInput value={date} onChange={setDate} /></Field>
        <Field label="Amount before GST (₹)" required><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
        <Field label="GST on the bill" hint={prefs && !prefs.gstRegistered ? 'Only GST-registered businesses claim credit' : 'Claimed as input credit'}>
          <select className="input" value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)} disabled={!prefs?.gstRegistered}>
            <option value="">No GST</option>
            {rates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Paid from">
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Total paid"><div className="value-line"><strong>{formatINR(amountPaise + tax)}</strong>{tax ? <span className="muted"> incl. {formatINR(tax)} GST</span> : null}</div></Field>
        <Field label="Paid to"><TextInput value={paidTo} onChange={setPaidTo} placeholder="e.g. Landlord, MSEB" /></Field>
        <Field label="Bill / voucher no."><TextInput value={reference} onChange={setReference} /></Field>
      </div>
      <Field label="Notes"><TextArea value={notes} onChange={setNotes} /></Field>
    </Modal>
  )
}
