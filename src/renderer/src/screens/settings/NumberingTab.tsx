import { useEffect, useState } from 'react'
import { formatDocNumber, NUMBERED_LABELS } from '@shared/docTypes'
import type { NumberSeries } from '@shared/models'
import { api, errorMessage } from '../../api'
import { Banner } from '../../components/Field'

interface Draft {
  prefix: string
  nextNumber: string
  padding: string
}

const draftOf = (s: NumberSeries): Draft => ({ prefix: s.prefix, nextNumber: String(s.nextNumber), padding: String(s.padding) })

export function NumberingTab() {
  const [fy, setFy] = useState('')
  const [series, setSeries] = useState<NumberSeries[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    api.listSeries().then(
      (r) => {
        setFy(r.fy)
        setSeries(r.series)
        setDrafts(Object.fromEntries(r.series.map((s) => [s.id, draftOf(s)])))
      },
      (e) => setMessage({ kind: 'error', text: errorMessage(e) })
    )
  }, [])

  const edit = (id: string, key: keyof Draft, value: string) => {
    setMessage(null)
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: value } }))
  }

  const dirty = (s: NumberSeries) => {
    const d = drafts[s.id]
    return d && (d.prefix !== s.prefix || d.nextNumber !== String(s.nextNumber) || d.padding !== String(s.padding))
  }

  const save = async (s: NumberSeries) => {
    const d = drafts[s.id]
    try {
      const saved = await api.updateSeries(s.id, {
        prefix: d.prefix,
        nextNumber: Number(d.nextNumber),
        padding: Number(d.padding)
      })
      setSeries((list) => list.map((x) => (x.id === saved.id ? saved : x)))
      setDrafts((all) => ({ ...all, [saved.id]: draftOf(saved) }))
      setMessage({ kind: 'success', text: `${NUMBERED_LABELS[saved.docType].label} numbering saved` })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  return (
    <>
      <p className="muted">Financial year {fy}. Numbers restart from 1 each new financial year.</p>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <table className="table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Prefix</th>
            <th>Next number</th>
            <th>Min. digits</th>
            <th>Next will be</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {series.map((s) => {
            const d = drafts[s.id] ?? draftOf(s)
            const n = Number(d.nextNumber)
            const pad = Number(d.padding)
            return (
              <tr key={s.id}>
                <td>{NUMBERED_LABELS[s.docType].label}</td>
                <td>
                  <input className="input" value={d.prefix} maxLength={20} onChange={(e) => edit(s.id, 'prefix', e.target.value)} />
                </td>
                <td>
                  <input className="input narrow" value={d.nextNumber} inputMode="numeric"
                    onChange={(e) => edit(s.id, 'nextNumber', e.target.value.replace(/\D/g, ''))} />
                </td>
                <td>
                  <input className="input narrow" value={d.padding} inputMode="numeric"
                    onChange={(e) => edit(s.id, 'padding', e.target.value.replace(/\D/g, '').slice(0, 1))} />
                </td>
                <td className="mono">{n >= 1 ? formatDocNumber(d.prefix, n, pad || 0) : '—'}</td>
                <td>
                  <button className="btn small" disabled={!dirty(s)} onClick={() => save(s)}>
                    Save
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
