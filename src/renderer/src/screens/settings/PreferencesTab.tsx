import { useEffect, useState } from 'react'
import type { PaperSize, Preferences } from '@shared/models'
import { api, errorMessage } from '../../api'
import { Banner, Field, TextInput, Toggle } from '../../components/Field'

export function PreferencesTab() {
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getPreferences().then(setPrefs, (e) => setError(errorMessage(e)))
  }, [])

  // Each change is saved immediately.
  const change = async <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setError(null)
    try {
      setPrefs(await api.savePreferences({ [key]: value }))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (!prefs) return error ? <Banner kind="error">{error}</Banner> : <p>Loading…</p>

  return (
    <>
      {error && <Banner kind="error">{error}</Banner>}
      <h3>GST</h3>
      <div className="stack">
        <Toggle checked={prefs.gstRegistered} onChange={(v) => change('gstRegistered', v)} label="GST registered (show GST on invoices)" />
        <Toggle checked={prefs.pricesIncludeTax} onChange={(v) => change('pricesIncludeTax', v)} label="Item prices include GST by default" />
      </div>
      <h3>Invoices</h3>
      <div className="stack">
        <Toggle checked={prefs.roundOff} onChange={(v) => change('roundOff', v)} label="Round totals to the nearest rupee" />
      </div>
      <div className="form-grid">
        <Field label="Default payment due (days)">
          <TextInput
            value={String(prefs.defaultDueDays)}
            onChange={(v) => change('defaultDueDays', Math.max(0, Math.min(365, Number(v.replace(/\D/g, '')) || 0)))}
            inputMode="numeric"
          />
        </Field>
        <Field label="Print size" hint="Paper, layout and what prints are in Settings › Print">
          <span className="muted">{({ A4: 'A4', A5: 'A5', thermal80: 'Thermal 80 mm', thermal58: 'Thermal 58 mm' } as Record<PaperSize, string>)[prefs.paperSize]}</span>
        </Field>
      </div>
      <h3>Stock</h3>
      <div className="stack">
        <Toggle checked={prefs.allowNegativeStock} onChange={(v) => change('allowNegativeStock', v)} label="Allow selling when stock is zero" />
      </div>
    </>
  )
}
