import { useEffect, useState } from 'react'
import type { TaxKind, TaxRate } from '@shared/models'
import { formatPercent, percentToBp } from '@shared/money'
import { api, errorMessage } from '../../api'
import { Banner, Field, TextInput } from '../../components/Field'

const KIND_LABEL: Record<TaxKind, string> = { gst: 'GST', exempt: 'Exempted', nil: 'Nil rated', non_gst: 'Non-GST' }

export function TaxRatesTab() {
  const [rates, setRates] = useState<TaxRate[]>([])
  const [rate, setRate] = useState('')
  const [cess, setCess] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const load = () => api.listTaxRates().then(setRates, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    setMessage(null)
    let rateBp: number
    let cessBp: number
    try {
      rateBp = percentToBp(rate)
      cessBp = cess.trim() ? percentToBp(cess) : 0
    } catch {
      setMessage({ kind: 'error', text: 'Enter rates as numbers, like 18 or 0.25' })
      return
    }
    const name = `GST ${formatPercent(rateBp)}${cessBp ? ` + Cess ${formatPercent(cessBp)}` : ''}`
    try {
      await api.createTaxRate({ name, kind: 'gst', rateBp, cessBp })
      setRate('')
      setCess('')
      setMessage({ kind: 'success', text: `${name} added` })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const toggle = async (r: TaxRate) => {
    try {
      const saved = await api.setTaxRateActive(r.id, !r.isActive)
      setRates((list) => list.map((x) => (x.id === saved.id ? saved : x)))
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  return (
    <>
      <p className="muted">Hidden rates stay on old invoices but are not offered for new items.</p>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Rate</th>
            <th>Cess</th>
            <th>Shown</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.id} className={r.isActive ? '' : 'inactive'}>
              <td>{r.name}</td>
              <td>{KIND_LABEL[r.kind]}</td>
              <td>{formatPercent(r.rateBp)}</td>
              <td>{r.cessBp ? formatPercent(r.cessBp) : '—'}</td>
              <td>
                <input type="checkbox" checked={r.isActive} onChange={() => toggle(r)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Add a GST rate</h3>
      <div className="inline-form">
        <Field label="GST %">
          <TextInput value={rate} onChange={setRate} inputMode="decimal" placeholder="18" />
        </Field>
        <Field label="Cess % (optional)">
          <TextInput value={cess} onChange={setCess} inputMode="decimal" placeholder="0" />
        </Field>
        <button className="btn primary" onClick={add} disabled={!rate.trim()}>
          Add rate
        </button>
      </div>
    </>
  )
}
