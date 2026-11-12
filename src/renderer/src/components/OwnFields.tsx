import { useEffect, useState } from 'react'
import { CUSTOM_FIELD_COUNT, type CustomField } from '@shared/features'
import { api } from '../api'

interface Props {
  kind: 'party' | 'item'
  values: string[]
  onChange: (values: string[]) => void
}

/** The business's own fields for a party or an item (Settings › Extra fields); nothing when none are on. */
export function OwnFields({ kind, values, onChange }: Props) {
  const [fields, setFields] = useState<CustomField[]>([])
  useEffect(() => {
    api.getFeatures().then((f) => setFields(kind === 'party' ? f.partyFields : f.itemFields), () => setFields([]))
  }, [kind])
  const on = fields.map((f, i) => ({ ...f, i })).filter((f) => f.on)
  if (!on.length) return null
  const set = (i: number, v: string) => {
    const next = Array.from({ length: CUSTOM_FIELD_COUNT }, (_, k) => values[k] ?? '')
    next[i] = v
    onChange(next)
  }
  return (
    <>
      <div className="section-title">More details</div>
      <div className="form-grid">
        {on.map((f) => (
          <label key={f.i} className="field">
            <span className="field-label">{f.label}</span>
            <input className="input" value={values[f.i] ?? ''} maxLength={100} aria-label={f.label} onChange={(e) => set(f.i, e.target.value)} />
          </label>
        ))}
      </div>
    </>
  )
}
