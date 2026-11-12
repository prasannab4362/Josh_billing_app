import { useEffect, useState } from 'react'
import { DATE_KEYS, DETAIL_DEFAULT_LABELS, DETAIL_HINTS, DETAIL_KEYS, type DateFormat, type DetailKey, type ItemFieldSettings } from '@shared/itemFields'
import { api, errorMessage } from '../../api'
import { Banner, Toggle } from '../../components/Field'

/** Which extra details bill lines have (batch, dates, model, size, serial), their names and date formats. */
export function ItemFieldsTab() {
  const [s, setS] = useState<ItemFieldSettings | null>(null)
  const [saved, setSaved] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    api.getItemFields().then((f) => {
      setS(f)
      setSaved(JSON.stringify(f))
    }, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  }, [])
  if (!s) return <p className="muted">Loading…</p>

  const setField = (k: DetailKey, patch: Partial<{ on: boolean; label: string }>) => setS({ ...s, fields: { ...s.fields, [k]: { ...s.fields[k], ...patch } } })
  const save = async () => {
    setMessage(null)
    try {
      const out = await api.saveItemFields(s)
      setS(out)
      setSaved(JSON.stringify(out))
      setMessage({ kind: 'success', text: 'Item fields saved. Bill lines now show the ones switched on.' })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }
  const dirty = JSON.stringify(s) !== saved

  return (
    <div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="section-title" style={{ marginTop: 0 }}>Details on bill lines</div>
      <p className="muted">
        Switch on the details you write on bills. Each bill line then has a box for them, and they print under the item name.
        You can rename them, e.g. "Batch no." to "Lot".
      </p>
      <table className="table compact item-fields">
        <thead><tr><th>On bills</th><th>Name on bills and prints</th><th>Date format</th><th>Used for</th></tr></thead>
        <tbody>
          {DETAIL_KEYS.map((k) => (
            <tr key={k}>
              <td><Toggle checked={s.fields[k].on} onChange={(v) => setField(k, { on: v })} label={DETAIL_DEFAULT_LABELS[k]} /></td>
              <td>
                <input className="input" value={s.fields[k].label} maxLength={30} aria-label={`Name for ${DETAIL_DEFAULT_LABELS[k]}`}
                  onChange={(e) => setField(k, { label: e.target.value })} />
              </td>
              <td>
                {DATE_KEYS.includes(k) ? (
                  <select className="input" value={k === 'mfg' ? s.mfgFormat : s.expFormat} aria-label={`Date format for ${DETAIL_DEFAULT_LABELS[k]}`}
                    onChange={(e) => setS({ ...s, [k === 'mfg' ? 'mfgFormat' : 'expFormat']: e.target.value as DateFormat })}>
                    <option value="dd/mm/yyyy">Day/month/year (12/11/2026)</option>
                    <option value="mm/yyyy">Month/year (11/2026)</option>
                  </select>
                ) : <span className="muted">—</span>}
              </td>
              <td className="muted small">{DETAIL_HINTS[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">These details are kept on each bill line. Stock is still counted per item, not per batch.</p>
      <button className="btn primary" onClick={save} disabled={!dirty}>Save item fields</button>
    </div>
  )
}
