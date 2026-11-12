import { useEffect, useState } from 'react'
import type { MoneyAccount, OpenDocument, Party, Payment, PaymentDirection, PaymentMode } from '@shared/models'
import { formatINR, toPaise } from '@shared/money'
import { todayLocal } from '@shared/fy'
import { api, errorMessage } from '../../api'
import { Banner, DateInput, Field, Modal, TextArea, TextInput } from '../../components/Field'
import { paiseText } from '../../forms'

export const MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' }
]

const safePaise = (s: string): number | null => {
  try {
    return s.trim() ? toPaise(s) : 0
  } catch {
    return null
  }
}

/** Spread an amount over bills, oldest first (same rule as the main process). */
function spread(docs: OpenDocument[], amount: number): Record<string, string> {
  const out: Record<string, string> = {}
  let left = amount
  for (const d of docs) {
    const take = Math.max(0, Math.min(left, d.open))
    out[d.id] = take ? paiseText(take) : ''
    left -= take
  }
  return out
}

interface Props {
  direction: PaymentDirection
  paymentId: string | null
  partyId?: string
  /** Pre-select this bill and its full balance (e.g. "Receive payment" on an invoice). */
  documentId?: string
  onClose: () => void
  onSaved: (p: Payment | null) => void
}

export function PaymentForm({ direction, paymentId, partyId: presetParty, documentId, onClose, onSaved }: Props) {
  const [parties, setParties] = useState<Party[]>([])
  const [accounts, setAccounts] = useState<MoneyAccount[]>([])
  const [existing, setExisting] = useState<Payment | null>(null)
  const [partyId, setPartyId] = useState(presetParty ?? '')
  const [number, setNumber] = useState('')
  const [suggested, setSuggested] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('cash')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [docs, setDocs] = useState<OpenDocument[]>([])
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const [allocTouched, setAllocTouched] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const isIn = direction === 'in'

  useEffect(() => {
    Promise.all([api.listParties(), api.listAccounts(), paymentId ? api.getPayment(paymentId) : Promise.resolve(null)]).then(
      ([p, a, pay]) => {
        setParties(p)
        setAccounts(a)
        if (pay) {
          setExisting(pay)
          setPartyId(pay.partyId ?? '')
          setNumber(pay.number)
          setDate(pay.date)
          setAmount(paiseText(pay.amount))
          setAccountId(pay.accountId)
          setMode(pay.mode)
          setReference(pay.reference)
          setNotes(pay.notes)
          setAlloc(Object.fromEntries(pay.allocations.map((x) => [x.documentId, paiseText(x.amount)])))
          setAllocTouched(true)
        }
        setLoaded(true)
      },
      (e) => setFailure(errorMessage(e))
    )
  }, [paymentId])

  useEffect(() => {
    if (paymentId) return
    api.nextPaymentNumber(direction, date).then((n) => {
      setNumber((cur) => (cur === '' || cur === suggested ? n : cur))
      setSuggested(n)
    })
  }, [date, direction, paymentId])

  // Open bills of the chosen party.
  useEffect(() => {
    if (!loaded || !partyId) return setDocs([])
    api.openDocuments(partyId, direction, paymentId).then((list) => {
      setDocs(list)
      if (documentId && !paymentId) {
        const d = list.find((x) => x.id === documentId)
        if (d) {
          setAmount(paiseText(d.open))
          setAlloc({ [d.id]: paiseText(d.open) })
          setAllocTouched(true)
        }
      } else if (!paymentId) {
        setAlloc({})
        setAllocTouched(false)
      }
    }, (e) => setFailure(errorMessage(e)))
  }, [partyId, loaded])

  const amountPaise = safePaise(amount)
  // Until the user edits the split, keep it following the amount (oldest bills first).
  const shownAlloc = allocTouched || amountPaise === null ? alloc : spread(docs, amountPaise)
  const allocated = Object.values(shownAlloc).reduce((s, v) => s + (safePaise(v) ?? 0), 0)
  const party = parties.find((p) => p.id === partyId)

  const save = async () => {
    setFailure(null)
    if (amountPaise === null || amountPaise <= 0) return setFailure('Enter the amount')
    const allocations = []
    for (const d of docs) {
      const v = safePaise(shownAlloc[d.id] ?? '')
      if (v === null) return setFailure(`Check the amount against ${d.number}`)
      if (v > 0) allocations.push({ documentId: d.id, amount: v })
    }
    setSaving(true)
    try {
      onSaved(
        await api.savePayment(paymentId, {
          direction, partyId, number: number === suggested && !paymentId ? '' : number, date, amount: amountPaise,
          accountId, mode, reference, notes, allocations
        })
      )
    } catch (e) {
      setFailure(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!existing || !window.confirm(`Delete payment ${existing.number}? Bills it paid will show as due again.`)) return
    try {
      await api.deletePayment(existing.id)
      onSaved(null)
    } catch (e) {
      setFailure(errorMessage(e))
    }
  }

  const fromInvoice = !!existing?.sourceDocId
  const title = paymentId ? `Payment ${existing?.number ?? ''}` : isIn ? 'Payment in (receive money)' : 'Payment out (pay money)'

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {existing && !fromInvoice && <button className="btn" onClick={remove}>Delete</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving || fromInvoice || !loaded}>
            {saving ? 'Saving…' : 'Save payment'}
          </button>
        </>
      }
    >
      {fromInvoice && (
        <Banner kind="error">This money was taken on invoice {existing?.sourceDocNumber}. Change it by editing that invoice.</Banner>
      )}
      {failure && <Banner kind="error">{failure}</Banner>}
      <div className="form-grid three">
        <Field label="Party" required>
          <select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)} disabled={!!paymentId}>
            <option value="">Choose a party…</option>
            {parties
              .filter((p) => p.isActive || p.id === partyId)
              .map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
          </select>
          {party && (
            <span className="field-hint">
              Balance {formatINR(Math.abs(party.balance))} {party.balance > 0 ? 'to receive' : party.balance < 0 ? 'to pay' : ''}
            </span>
          )}
        </Field>
        <Field label={isIn ? 'Receipt number' : 'Payment number'}>
          <TextInput value={number} onChange={setNumber} />
        </Field>
        <Field label="Date">
          <DateInput value={date} onChange={setDate} />
        </Field>
        <Field label="Amount (₹)" required error={amountPaise === null ? 'Enter a number' : undefined}>
          <TextInput value={amount} onChange={setAmount} inputMode="decimal" autoFocus placeholder="0" />
        </Field>
        <Field label={isIn ? 'Received in' : 'Paid from'}>
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

      {partyId && (
        <>
          <div className="section-title">{isIn ? 'Set against invoices' : 'Set against bills'}</div>
          {docs.length === 0 ? (
            <p className="muted">No open {isIn ? 'invoices' : 'bills'}. The whole amount is kept as an {isIn ? 'advance' : 'on-account payment'}.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>No.</th>
                  <th>Due</th>
                  <th className="amount">Total</th>
                  <th className="amount">Open</th>
                  <th className="amount" style={{ width: 150 }}>This payment</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.date}</td>
                    <td>{d.number}</td>
                    <td>{d.dueDate}</td>
                    <td className="amount">{formatINR(d.total)}</td>
                    <td className="amount">{formatINR(d.open)}</td>
                    <td>
                      <input
                        className="input num"
                        inputMode="decimal"
                        value={shownAlloc[d.id] ?? ''}
                        onChange={(e) => {
                          setAlloc({ ...shownAlloc, [d.id]: e.target.value })
                          setAllocTouched(true)
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="alloc-summary">
            <span>Set against {isIn ? 'invoices' : 'bills'}: <strong>{formatINR(allocated)}</strong></span>
            {amountPaise !== null && amountPaise - allocated > 0 && (
              <span>Kept as {isIn ? 'advance' : 'on account'}: <strong>{formatINR(amountPaise - allocated)}</strong></span>
            )}
            {amountPaise !== null && allocated > amountPaise && <span className="field-error">More than the payment amount</span>}
            {docs.length > 0 && (
              <button className="btn small" onClick={() => { setAlloc(spread(docs, amountPaise ?? 0)); setAllocTouched(true) }}>
                Auto (oldest first)
              </button>
            )}
          </div>
        </>
      )}

      <Field label="Notes">
        <TextArea value={notes} onChange={setNotes} />
      </Field>
    </Modal>
  )
}
