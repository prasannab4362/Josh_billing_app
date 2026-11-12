import { useEffect, useState } from 'react'
import type { PaperSize } from '@shared/models'
import {
  ACCENT_COLOURS, INVOICE_THEMES, SHOW_LABELS, THERMAL_THEMES,
  type InvoiceTheme, type PrintSettings, type PrintShow, type TextSize, type ThermalTheme
} from '@shared/printSettings'
import { api, errorMessage } from '../../api'
import { Banner, Toggle } from '../../components/Field'

const GROUPS: { title: string; keys: (keyof PrintShow)[] }[] = [
  { title: 'Header', keys: ['logo', 'businessAddress', 'businessPhone', 'businessEmail', 'businessGstin', 'partyPhone', 'partyGstin', 'shipTo'] },
  { title: 'Item table', keys: ['serialNo', 'hsn', 'itemDescription', 'discountColumn', 'taxColumn'] },
  { title: 'Totals and footer', keys: ['taxSummary', 'amountInWords', 'receivedBalance', 'bankDetails', 'upiQr', 'notes', 'terms', 'signature'] }
]
const PAPERS: [PaperSize, string][] = [['A4', 'A4'], ['A5', 'A5'], ['thermal80', 'Thermal 80 mm'], ['thermal58', 'Thermal 58 mm']]
const isThermal = (p: PaperSize) => p === 'thermal80' || p === 'thermal58'

/** A tiny drawing of each layout, so the choice is visual. */
function Thumb({ theme }: { theme: InvoiceTheme }) {
  return (
    <div className={`thumb thumb-${theme}`} aria-hidden>
      <div className="t-head"><i /><b /></div>
      <div className="t-rows"><span /><span /><span /><span /></div>
      <div className="t-foot"><i /><b /></div>
    </div>
  )
}

/** Invoice layout, colour, text size and which parts print, with a live preview. */
export function PrintTab() {
  const [s, setS] = useState<PrintSettings | null>(null)
  const [saved, setSaved] = useState('')
  const [paper, setPaper] = useState<PaperSize>('A4')
  const [savedPaper, setSavedPaper] = useState<PaperSize>('A4')
  const [html, setHtml] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api.getPrintSettings(), api.getPreferences()]).then(
      ([p, prefs]) => {
        setS(p)
        setSaved(JSON.stringify(p))
        setPaper(prefs.paperSize)
        setSavedPaper(prefs.paperSize)
      },
      (e) => setMessage({ kind: 'error', text: errorMessage(e) })
    )
  }, [])
  useEffect(() => {
    if (!s) return
    const t = setTimeout(() => api.previewPrintSettings(s, paper).then(setHtml, (e) => setMessage({ kind: 'error', text: errorMessage(e) })), 200)
    return () => clearTimeout(t)
  }, [JSON.stringify(s), paper])

  if (!s) return <p className="muted">Loading…</p>
  const set = (patch: Partial<PrintSettings>) => setS({ ...s, ...patch })
  const toggle = (k: keyof PrintShow, v: boolean) => set({ show: { ...s.show, [k]: v } })
  const dirty = JSON.stringify(s) !== saved
  const thermal = isThermal(paper)

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const out = await api.savePrintSettings(s)
      await api.savePreferences({ paperSize: paper })
      setS(out)
      setSaved(JSON.stringify(out))
      setSavedPaper(paper)
      setMessage({ kind: 'success', text: 'Print settings saved. New prints and PDFs use them.' })
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  // Fit the page into the preview: A4 is about 794 px wide, receipts much narrower.
  const zoom = thermal ? 1 : 0.62
  const preview = html.replace('</head>', `<style>html { zoom: ${zoom}; } body { box-shadow: 0 0 0 1px #e4e7ec; min-height: 100vh; }</style></head>`)

  return (
    <div className="print-layout">
      <div className="print-options">
        {message && <Banner kind={message.kind}>{message.text}</Banner>}
        <div className="field">
          <span className="field-label">Default paper</span>
          <div className="seg">
            {PAPERS.map(([p, label]) => <button key={p} className={paper === p ? 'on' : ''} onClick={() => setPaper(p)}>{label}</button>)}
          </div>
        </div>

        {!thermal ? (
          <>
            <div className="section-title">Layout</div>
            <div className="theme-cards">
              {(Object.keys(INVOICE_THEMES) as InvoiceTheme[]).map((t) => (
                <button key={t} className={s.theme === t ? 'theme-card on' : 'theme-card'} onClick={() => set({ theme: t })} title={INVOICE_THEMES[t].hint}>
                  <Thumb theme={t} />
                  <span>{INVOICE_THEMES[t].name}</span>
                </button>
              ))}
            </div>
            <p className="muted small">{INVOICE_THEMES[s.theme].hint}.</p>
            <div className="section-title">Colour</div>
            <div className="swatches">
              {ACCENT_COLOURS.map((c) => (
                <button key={c} className={s.colour === c ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => set({ colour: c })} aria-label={`Colour ${c}`} />
              ))}
              <label className="swatch custom" title="Your own colour">
                <input type="color" value={s.colour} onChange={(e) => set({ colour: e.target.value })} aria-label="Your own colour" />
              </label>
            </div>
          </>
        ) : (
          <>
            <div className="section-title">Receipt layout</div>
            <div className="seg">
              {(Object.keys(THERMAL_THEMES) as ThermalTheme[]).map((t) => (
                <button key={t} className={s.thermalTheme === t ? 'on' : ''} onClick={() => set({ thermalTheme: t })} title={THERMAL_THEMES[t].hint}>{THERMAL_THEMES[t].name}</button>
              ))}
            </div>
            <p className="muted small">{THERMAL_THEMES[s.thermalTheme].hint}.</p>
          </>
        )}

        <div className="field">
          <span className="field-label">Text size</span>
          <div className="seg">
            {(['small', 'medium', 'large'] as TextSize[]).map((t) => (
              <button key={t} className={s.textSize === t ? 'on' : ''} onClick={() => set({ textSize: t })}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </div>

        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="section-title">{g.title}</div>
            <div className="toggle-grid">
              {g.keys.map((k) => <Toggle key={k} checked={s.show[k]} onChange={(v) => toggle(k, v)} label={SHOW_LABELS[k]} />)}
            </div>
          </div>
        ))}
        {s.show.upiQr && <p className="muted small">The UPI QR code prints when the account in Cash &amp; Bank marked for printing has a UPI ID, and something is still due.</p>}

        <div className="section-title">Text</div>
        <label className="field">
          <span className="field-label">Footer line</span>
          <input className="input" value={s.footer} maxLength={200} placeholder="e.g. Thank you for shopping with us!" onChange={(e) => set({ footer: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Default terms and conditions (filled into new sale invoices)</span>
          <textarea className="input" rows={3} value={s.defaultTerms} maxLength={2000} placeholder="e.g. Goods once sold will not be taken back."
            onChange={(e) => set({ defaultTerms: e.target.value })} />
        </label>
        <div className="row-flex" style={{ gap: 8, marginTop: 8 }}>
          <button className="btn primary" onClick={save} disabled={busy || (!dirty && paper === savedPaper)}>Save print settings</button>
          {(dirty || paper !== savedPaper) && <span className="muted small">Not saved yet</span>}
        </div>
      </div>
      <div className={thermal ? 'print-preview thermal' : 'print-preview'}>
        <div className="field-label">Preview (sample invoice)</div>
        {html && <iframe title="Print preview" sandbox="" srcDoc={preview} style={thermal ? { width: paper === 'thermal58' ? 240 : 320 } : undefined} />}
      </div>
    </div>
  )
}
