import { useEffect, useState } from 'react'
import type { CustomField, FeatureSettings } from '@shared/features'
import { api, errorMessage } from '../../api'
import { Banner, Toggle } from '../../components/Field'

function useFeatures() {
  const [s, setS] = useState<FeatureSettings | null>(null)
  const [saved, setSaved] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  useEffect(() => {
    api.getFeatures().then((f) => {
      setS(f)
      setSaved(JSON.stringify(f))
    }, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  }, [])
  const save = async (text: string) => {
    if (!s) return
    setMessage(null)
    try {
      const out = await api.saveFeatures(s)
      setS(out)
      setSaved(JSON.stringify(out))
      setMessage({ kind: 'success', text })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }
  return { s, setS, dirty: !!s && JSON.stringify(s) !== saved, message, save }
}

/** Optional parts of bills: time on prints, profit while billing, transport and PO details. */
export function TransactionsTab() {
  const { s, setS, dirty, message, save } = useFeatures()
  if (!s) return message ? <Banner kind={message.kind}>{message.text}</Banner> : <p className="muted">Loading…</p>
  const rows: [keyof FeatureSettings, string, string][] = [
    ['transport', 'Transport details', 'Transporter, vehicle number, e-way bill number and delivery date on bills, printed in the invoice details.'],
    ['poDetails', 'Customer PO details', "The customer's purchase order number and date on sale bills."],
    ['showTime', 'Time on bills', 'Print the time the bill was made next to its date.'],
    ['showProfit', 'Profit while making a sale', 'Show the profit on a sale invoice while you make it: taxable value minus the items’ purchase price. Not printed.']
  ]
  return (
    <div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="switch-list">
        {rows.map(([k, title, hint]) => (
          <div key={k} className="switch-row">
            <Toggle checked={s[k] as boolean} onChange={(v) => setS({ ...s, [k]: v })} label={title} />
            <p className="muted small">{hint}</p>
          </div>
        ))}
      </div>
      <button className="btn primary" onClick={() => save('Saved. New and edited bills use these.')} disabled={!dirty}>Save</button>
    </div>
  )
}

function FieldRows({ title, hint, list, onChange }: { title: string; hint: string; list: CustomField[]; onChange: (l: CustomField[]) => void }) {
  const set = (i: number, patch: Partial<CustomField>) => onChange(list.map((f, k) => (k === i ? { ...f, ...patch } : f)))
  return (
    <div>
      <div className="section-title">{title}</div>
      <p className="muted small">{hint}</p>
      <table className="table compact own-fields">
        <thead><tr><th>#</th><th>Field name</th><th>On</th><th>Show in print</th></tr></thead>
        <tbody>
          {list.map((f, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              <td>
                <input className="input" value={f.label} maxLength={30} placeholder={`Field ${i + 1}`} aria-label={`${title} ${i + 1} name`}
                  onChange={(e) => set(i, { label: e.target.value, on: e.target.value.trim() ? f.on || !f.label : false })} />
              </td>
              <td><input type="checkbox" checked={f.on} disabled={!f.label.trim()} aria-label={`${title} ${i + 1} on`} onChange={(e) => set(i, { on: e.target.checked })} /></td>
              <td><input type="checkbox" checked={f.print} disabled={!f.on} aria-label={`${title} ${i + 1} print`} onChange={(e) => set(i, { print: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Up to four fields of the business's own for parties and for items. */
export function OwnFieldsSettings() {
  const { s, setS, dirty, message, save } = useFeatures()
  if (!s) return null
  return (
    <div style={{ marginTop: 24 }}>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="form-grid">
        <FieldRows title="Party fields" hint="e.g. Aadhaar no., Area, Salesman. Shown in the party form; printed under the party on invoices."
          list={s.partyFields} onChange={(l) => setS({ ...s, partyFields: l })} />
        <FieldRows title="Item fields" hint="e.g. Colour, Brand, Warranty. Shown in the item form; printed under the item on invoices."
          list={s.itemFields} onChange={(l) => setS({ ...s, itemFields: l })} />
      </div>
      <button className="btn primary" onClick={() => save('Own fields saved.')} disabled={!dirty}>Save own fields</button>
    </div>
  )
}
