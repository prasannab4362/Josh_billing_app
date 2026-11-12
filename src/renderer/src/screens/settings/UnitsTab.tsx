import { useEffect, useState } from 'react'
import type { Unit } from '@shared/models'
import { api, errorMessage } from '../../api'
import { Banner, Field, TextInput } from '../../components/Field'

export function UnitsTab() {
  const [units, setUnits] = useState<Unit[]>([])
  const [name, setName] = useState('')
  const [short, setShort] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const load = () => api.listUnits().then(setUnits, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    setMessage(null)
    try {
      const unit = await api.createUnit(name, short)
      setName('')
      setShort('')
      setMessage({ kind: 'success', text: `${unit.name} (${unit.short}) added` })
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  const remove = async (u: Unit) => {
    setMessage(null)
    try {
      await api.deleteUnit(u.id)
      load()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    }
  }

  return (
    <>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="inline-form">
        <Field label="Unit name">
          <TextInput value={name} onChange={setName} placeholder="e.g. Carton" />
        </Field>
        <Field label="Short name">
          <TextInput value={short} onChange={setShort} placeholder="ctn" maxLength={10} />
        </Field>
        <button className="btn primary" onClick={add} disabled={!name.trim() || !short.trim()}>
          Add unit
        </button>
      </div>
      <div className="chips">
        {units.map((u) => (
          <span key={u.id} className="chip">
            {u.name} <span className="muted">({u.short})</span>
            {!u.inUse && (
              <button className="chip-x" title="Delete unit" onClick={() => remove(u)}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
    </>
  )
}
