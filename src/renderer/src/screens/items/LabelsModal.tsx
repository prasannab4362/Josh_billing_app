import { useEffect, useMemo, useState } from 'react'
import type { LabelRequest } from '@shared/ipc'
import {
  DEFAULT_LABEL_OPTIONS, EXTRA_TITLES, extraFieldsUsed, LABEL_FIELDS, LABEL_LAYOUTS, LABEL_STYLES, MAX_LABEL_LINES, pageWidth, resolveLayout,
  type LabelExtra, type LabelField, type LabelLayout, type LabelLine, type LabelOptions, type LabelStyle, type SavedLabelSize
} from '@shared/labels'
import type { Item } from '@shared/models'
import { formatQty } from '@shared/qty'
import { api, errorMessage } from '../../api'
import { Banner, Modal, Toggle } from '../../components/Field'
import { CustomSizeModal } from './CustomSizeModal'
import { codeFormatError, codeFormatExample, yearLetters, type CodeFormat, type YearlyFormat } from '@shared/barcode'
import { fyFor, todayLocal } from '@shared/fy'

/** A tiny drawing of each label design, so the choice is visual. */
function StyleThumb({ style }: { style: LabelStyle }) {
  const bars = <i className="t-bars" />
  const qr = <i className="t-qr" />
  switch (style) {
    case 'garment':
      return <span className="lthumb"><b className="t-band" /><span className="t-row"><span className="t-col"><i className="t-ln" /><b className="t-price" /></span><i className="t-v" />{qr}</span></span>
    case 'priceTag':
      return <span className="lthumb center"><i className="t-ln short" /><b className="t-price big" />{bars}</span>
    case 'shelf':
      return <span className="lthumb"><span className="t-row"><span className="t-col"><i className="t-ln" />{bars}</span><span className="t-col right"><b className="t-price" /><i className="t-ln short" /><b className="t-save" /></span></span></span>
    case 'boxed':
      return <span className="lthumb center boxed"><i className="t-head" />{bars}<i className="t-ln" /></span>
    case 'jewellery':
      return <span className="lthumb jewel"><span className="t-row">{qr}<i className="t-tail" /><span className="t-col"><i className="t-ln" /><i className="t-ln short" /></span></span></span>
    case 'codeOnly':
      return <span className="lthumb center"><i className="t-bars tall" /><i className="t-ln short" /></span>
    case 'food':
      return <span className="lthumb"><i className="t-head line" /><i className="t-ln" /><b className="t-price small" /><span className="t-dates"><i /><i /></span>{bars}</span>
    default:
      return <span className="lthumb center"><i className="t-head" />{bars}<i className="t-ln" /><i className="t-ln short" /></span>
  }
}

/** How new barcode numbers are made: in-store EAN-13, or the shop's own pattern like 472-00001~1. */
function CodeFormatRow({ onMessage }: { onMessage: (m: Message) => void }) {
  const [f, setF] = useState<CodeFormat | null>(null)
  const [saved, setSaved] = useState('')
  const [fy, setFy] = useState('')
  useEffect(() => {
    api.getCodeFormat().then((x) => {
      setF(x)
      setSaved(JSON.stringify(x))
    }, () => setF({ kind: 'ean13' }))
    api.currentBusiness().then((b) => setFy(fyFor(todayLocal(), b?.fyStartMonth ?? 4)), () => setFy(fyFor(todayLocal())))
  }, [])
  if (!f || !fy) return null
  const pattern = f.kind === 'pattern' ? f : { kind: 'pattern' as const, prefix: '472-', digits: 5, suffix: '~1' }
  const yearly: YearlyFormat = f.kind === 'yearly'
    ? f
    : { kind: 'yearly', startCode: 'AA', startFy: fy, digits: 5, separator: '-', restartEachYear: false, sizeNumbers: true }
  const problem = codeFormatError(f)
  const dirty = JSON.stringify(f) !== saved
  const example = (x: CodeFormat): string => {
    try {
      return codeFormatExample(x, 1, fy)
    } catch (e) {
      return (e as Error).message
    }
  }
  const nextYear = `${Number(fy.slice(0, 4)) + 1}${fy.length > 4 ? `-${String((Number(fy.slice(0, 4)) + 2) % 100).padStart(2, '0')}` : ''}`
  const save = async () => {
    try {
      // Year letters chosen now belong to this accounting year.
      const out = await api.saveCodeFormat(f.kind === 'yearly' ? { ...f, startCode: safeLetters(f, fy), startFy: fy } : f)
      setF(out)
      setSaved(JSON.stringify(out))
      onMessage({ kind: 'success', text: `New barcodes will be numbered like ${example(out)}` })
    } catch (e) {
      onMessage({ kind: 'error', text: errorMessage(e) })
    }
  }
  return (
    <div className="code-format">
      <div className="labels-option-row">
        <span className="field-label">New barcode numbers</span>
        <div className="seg">
          <button className={f.kind === 'ean13' ? 'on' : ''} onClick={() => setF({ kind: 'ean13' })}>Store barcode (EAN-13)</button>
          <button className={f.kind === 'yearly' ? 'on' : ''} onClick={() => setF(yearly)}>Year letters</button>
          <button className={f.kind === 'pattern' ? 'on' : ''} onClick={() => setF(pattern)}>Own pattern</button>
        </div>
      </div>
      {f.kind === 'pattern' && (
        <div className="labels-option-row">
          <label className="field"><span className="field-label">Prefix</span><input className="input code-part" value={f.prefix} maxLength={12} onChange={(e) => setF({ ...f, prefix: e.target.value.trim() })} /></label>
          <label className="field"><span className="field-label">Digits</span>
            <select className="input code-part" value={f.digits} onChange={(e) => setF({ ...f, digits: Number(e.target.value) })}>
              {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Suffix</span><input className="input code-part" value={f.suffix} maxLength={12} onChange={(e) => setF({ ...f, suffix: e.target.value.trim() })} /></label>
        </div>
      )}
      {f.kind === 'yearly' && (
        <>
          <div className="labels-option-row">
            <label className="field">
              <span className="field-label">Letters for {fy}</span>
              <input className="input code-part" aria-label="Year letters" value={f.kind === 'yearly' && f.startFy !== fy ? safeLetters(f, fy) : f.startCode} maxLength={2}
                onChange={(e) => setF({ ...f, startCode: e.target.value.toUpperCase().replace(/[^A-Z]/g, ''), startFy: fy })} />
            </label>
            <label className="field"><span className="field-label">Between</span>
              <select className="input code-part" value={f.separator} onChange={(e) => setF({ ...f, separator: e.target.value })}>
                {['-', '/', '.', '#', '_', ''].map((s) => <option key={s} value={s}>{s || 'nothing'}</option>)}
              </select>
            </label>
            <label className="field"><span className="field-label">Digits</span>
              <select className="input code-part" value={f.digits} onChange={(e) => setF({ ...f, digits: Number(e.target.value) })}>
                {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <div className="labels-option-row">
            <Toggle checked={f.sizeNumbers} onChange={(v) => setF({ ...f, sizeNumbers: v })} label="Size number after ~ (~1, ~2, ~3 for the sizes of one product)" />
          </div>
          <div className="labels-option-row">
            <Toggle checked={f.restartEachYear} onChange={(v) => setF({ ...f, restartEachYear: v })} label="Start the product number again at 1 each year" />
          </div>
          {!problem && (
            <p className="muted small" style={{ margin: 0 }}>
              This year ({fy}) codes start with {safeLetters(f, fy)}; next year ({nextYear}) with {(() => {
                try {
                  return yearLetters(f, nextYear)
                } catch (e) {
                  return (e as Error).message
                }
              })()}, {f.restartEachYear ? 'numbered again from 1' : 'carrying on the product numbers'}.
            </p>
          )}
        </>
      )}
      <div className="labels-option-row">
        <span className={problem ? 'field-error' : 'muted small'}>
          {problem || `Example: ${example(f)}${f.kind !== 'ean13' ? ' (prints as a Code 128 barcode or a QR code)' : ''}`}
        </span>
        {dirty && <button className="btn small primary" onClick={save} disabled={!!problem}>Save numbering</button>}
      </div>
    </div>
  )
}

/** The letters this year, for a format started in an earlier year. */
function safeLetters(f: YearlyFormat, fy: string): string {
  try {
    return yearLetters(f, fy)
  } catch {
    return f.startCode
  }
}

interface Props {
  items: Item[]
  /** Items ticked when the window opens. */
  preselect: string[]
  onClose: () => void
  /** Items changed (barcodes were created); reload them. */
  onItemsChanged: () => void
}

type Message = { kind: 'error' | 'success'; text: string } | null
type Design = Omit<LabelOptions, 'skip'>

/** A saved design with any missing parts filled from the default (older saves, removed sizes). */
function complete(saved: Partial<Design> | null, sizes: SavedLabelSize[]): Design {
  if (!saved || !LABEL_LAYOUTS[saved.layout as LabelLayout]) return { ...DEFAULT_LABEL_OPTIONS }
  const lines = Array.from({ length: MAX_LABEL_LINES }, (_, i) => saved.lines?.[i] ?? { field: 'none' as const, text: '' })
  const d: Design = { ...DEFAULT_LABEL_OPTIONS, ...saved, lines }
  if (d.layout === 'roll-custom') {
    const s = sizes.find((x) => x.id === d.sizeId)
    if (!s) return { ...d, layout: DEFAULT_LABEL_OPTIONS.layout, sizeId: undefined }
    d.custom = { width: s.width, height: s.height, across: s.across, gap: s.gap }
  }
  return d
}

/** Fit the page into the preview pane: a whole A4 sheet, or a roll row enlarged to read it. */
function scaled(html: string, pageWidthMm: number): string {
  const zoom = Math.min(2.5, 350 / (pageWidthMm * 3.78))
  return html.replace(
    '</head>',
    `<style>html { zoom: ${zoom.toFixed(3)}; } body { background: #e9ecf1; } .sheet, .label:not(.empty) { background: #fff; } .sheet, .row { margin-bottom: 4mm; } .label:not(.empty) { outline: 1px dashed #c7ccd4; }</style></head>`
  )
}

function LineChoice({ title, line, onChange, own }: { title: string; line: LabelLine; onChange: (l: LabelLine) => void; own: string[] }) {
  return (
    <label className="field">
      <span className="field-label">{title}</span>
      <select className="input" value={line.field} onChange={(e) => onChange({ ...line, field: e.target.value as LabelField })}>
        {Object.entries(LABEL_FIELDS).map(([k, v]) => {
          // The business's own item fields show under their own names (Size, Colour…), and only when switched on.
          const n = /^own(\d)$/.exec(k)
          if (n) {
            const name = own[Number(n[1]) - 1]
            return name || line.field === k ? <option key={k} value={k}>{name ? `${name} (item field)` : v}</option> : null
          }
          return <option key={k} value={k}>{v}</option>
        })}
      </select>
      {line.field === 'custom' && (
        <input className="input" style={{ marginTop: 4 }} value={line.text} maxLength={60} placeholder="e.g. Free size"
          aria-label={`${title} text`} onChange={(e) => onChange({ ...line, text: e.target.value })} />
      )}
    </label>
  )
}

/** Choose items and how many labels of each, design the label, then print or save it. */
export function LabelsModal({ items, preselect, onClose, onItemsChanged }: Props) {
  const [copies, setCopies] = useState<Record<string, string>>(() => Object.fromEntries(preselect.map((id) => [id, '1'])))
  const [extras, setExtras] = useState<Record<string, LabelExtra>>({})
  const [search, setSearch] = useState('')
  const [design, setDesign] = useState<Design | null>(null)
  const [sizes, setSizes] = useState<SavedLabelSize[]>([])
  const [sizeForm, setSizeForm] = useState<SavedLabelSize | 'new' | null>(null)
  const [skip, setSkip] = useState('0')
  const [preview, setPreview] = useState('')
  const [message, setMessage] = useState<Message>(null)
  const [busy, setBusy] = useState(false)
  // Names of the business's own item fields that are switched on, by position ('' when off).
  const [own, setOwn] = useState<string[]>([])
  useEffect(() => {
    api.getFeatures().then((f) => setOwn(f.itemFields.map((x) => (x.on ? x.label : ''))), () => setOwn([]))
  }, [])

  // The business's sizes and last design, kept in its file.
  useEffect(() => {
    Promise.all([api.listLabelSizes(), api.getLabelDesign()]).then(
      ([s, d]) => {
        setSizes(s)
        setDesign(complete(d, s))
      },
      (e) => {
        setDesign({ ...DEFAULT_LABEL_OPTIONS })
        setMessage({ kind: 'error', text: errorMessage(e) })
      }
    )
  }, [])

  const d = design ?? DEFAULT_LABEL_OPTIONS
  const update = (patch: Partial<Design>) => setDesign((x) => ({ ...(x ?? DEFAULT_LABEL_OPTIONS), ...patch }))
  const setLine = (i: number, l: LabelLine) => update({ lines: d.lines.map((x, k) => (k === i ? l : x)) })
  const L = LABEL_LAYOUTS[d.layout]
  const printer = L.printer
  const savedSize = d.layout === 'roll-custom' ? sizes.find((s) => s.id === d.sizeId) : undefined
  const extraFields = extraFieldsUsed(d)

  const active = items.filter((i) => i.isActive)
  const shown = active.filter((i) => {
    const q = search.trim().toLowerCase()
    return !q || i.name.toLowerCase().includes(q) || i.barcode.includes(q) || i.code.toLowerCase().includes(q)
  })
  const chosen = active.filter((i) => Number(copies[i.id] || 0) > 0)
  const missing = chosen.filter((i) => !i.barcode && !i.code)
  const total = chosen.reduce((s, i) => s + Number(copies[i.id] || 0), 0)

  const options: LabelOptions = { ...d, skip: L.sheet ? Math.max(0, Math.floor(Number(skip) || 0)) : 0 }
  const optionsKey = JSON.stringify(options)
  const request: LabelRequest | null = useMemo(() => {
    if (!design) return null
    const list = chosen
      .filter((i) => i.barcode || i.code)
      .map((i) => ({ itemId: i.id, copies: Math.floor(Number(copies[i.id] || 0)), extra: extras[i.id] }))
    return list.length ? { items: list, options } : null
  }, [copies, extras, items, optionsKey])

  useEffect(() => {
    if (design) api.saveLabelDesign(design).catch((e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  }, [JSON.stringify(design)])

  useEffect(() => {
    if (!request) return setPreview('')
    const t = setTimeout(() => api.previewLabels(request).then(setPreview, (e) => setMessage({ kind: 'error', text: errorMessage(e) })), 250)
    return () => clearTimeout(t)
  }, [request])

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await f()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  const createMissing = () =>
    run(async () => {
      const n = await api.assignBarcodes(missing.map((i) => i.id))
      setMessage({ kind: 'success', text: `Created barcodes for ${n} item${n === 1 ? '' : 's'}` })
      onItemsChanged()
    })
  const print = () => run(async () => void (request && (await api.printLabels(request))))
  const pdf = () =>
    run(async () => {
      if (!request) return
      const path = await api.saveLabelsPdf(request)
      if (path) setMessage({ kind: 'success', text: `Saved ${path}` })
    })
  const setAll = (fn: (i: Item) => string) => setCopies((c) => ({ ...c, ...Object.fromEntries(shown.map((i) => [i.id, fn(i)])) }))
  const choosePrinter = (p: 'label' | 'regular') => {
    if (p !== printer) update({ layout: p === 'label' ? 'roll-2x50x25' : 'a4-65', sizeId: undefined })
  }
  const useSize = (s: SavedLabelSize) => update({ layout: 'roll-custom', sizeId: s.id, custom: { width: s.width, height: s.height, across: s.across, gap: s.gap } })
  const chooseSize = (value: string) => {
    if (value.startsWith('saved:')) {
      const s = sizes.find((x) => x.id === value.slice(6))
      if (s) useSize(s)
    } else update({ layout: value as LabelLayout, sizeId: undefined })
  }
  const sizeSaved = (s: SavedLabelSize) => {
    setSizes((list) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s]))
    useSize(s)
    setSizeForm(null)
    setMessage({ kind: 'success', text: `Size "${s.name}" saved` })
  }
  const removeSize = (s: SavedLabelSize) =>
    run(async () => {
      if (!window.confirm(`Delete the label size "${s.name}"?`)) return
      await api.deleteLabelSize(s.id)
      setSizes((list) => list.filter((x) => x.id !== s.id))
      update({ layout: 'roll-2x50x25', sizeId: undefined })
    })
  const setExtra = (itemId: string, f: keyof LabelExtra, v: string) => setExtras((e) => ({ ...e, [itemId]: { ...e[itemId], [f]: v } }))
  const resolved = resolveLayout(options)

  if (!design) return <Modal title="Print barcode and QR labels" onClose={onClose} wide footer={<button className="btn" onClick={onClose}>Close</button>}><p className="muted">Loading…</p></Modal>

  return (
    <>
    <Modal
      title="Print barcode and QR labels"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            {total} label{total === 1 ? '' : 's'}
            {!L.sheet && ` · paper ${pageWidth(resolved)} × ${resolved.height} mm`}
          </span>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn" onClick={pdf} disabled={busy || !request}>Save PDF</button>
          <button className="btn primary" onClick={print} disabled={busy || !request}>Print</button>
        </>
      }
    >
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      {missing.length > 0 && (
        <div className="notice">
          {missing.length} chosen item{missing.length === 1 ? ' has' : 's have'} no barcode or item code yet.
          <button className="btn small" onClick={createMissing} disabled={busy}>Create barcode{missing.length === 1 ? '' : 's'}</button>
        </div>
      )}
      <div className="labels-layout">
        <div>
          <div className="toolbar">
            <input className="input search" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="btn small" onClick={() => setAll(() => '1')}>1 each</button>
            <button className="btn small" onClick={() => setAll((i) => (i.trackStock && i.stockQty > 0 ? String(Math.ceil(i.stockQty / 1000)) : '0'))} title="As many labels as pieces in stock">As in stock</button>
            <button className="btn small" onClick={() => setAll(() => '0')}>None</button>
          </div>
          <div className="labels-items">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Item</th><th>Barcode / code</th><th className="amount">In stock</th>
                  {extraFields.map((f) => <th key={f}>{EXTRA_TITLES[f]}</th>)}
                  <th className="amount">Labels</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => {
                  const on = Number(copies[i.id] || 0) > 0
                  return (
                    <tr key={i.id} className={on ? 'selected' : ''}>
                      <td>{i.name}</td>
                      <td className={i.barcode || i.code ? 'mono' : 'muted'}>{i.barcode || i.code || 'none'}</td>
                      <td className="amount">{i.trackStock ? `${formatQty(i.stockQty)} ${i.baseUnitShort}` : '—'}</td>
                      {extraFields.map((f) => (
                        <td key={f}>
                          <input
                            className="input labels-extra"
                            type={f === 'mfg' || f === 'exp' ? 'month' : 'text'}
                            maxLength={30}
                            disabled={!on}
                            aria-label={`${EXTRA_TITLES[f]} for ${i.name}`}
                            value={extras[i.id]?.[f] ?? ''}
                            onChange={(e) => setExtra(i.id, f, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className="amount">
                        <input className="input num labels-qty" inputMode="numeric" value={copies[i.id] ?? ''} placeholder="0"
                          onChange={(e) => setCopies((c) => ({ ...c, [i.id]: e.target.value.replace(/\D/g, '') }))} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="labels-options">
            <div className="section-title">Design</div>
            <div className="label-styles">
              {(Object.keys(LABEL_STYLES) as LabelStyle[]).map((s) => (
                <button key={s} type="button" className={(d.style ?? 'classic') === s ? 'label-style on' : 'label-style'} title={LABEL_STYLES[s].hint}
                  onClick={() => update({ style: s })}>
                  <StyleThumb style={s} />
                  <span>{LABEL_STYLES[s].name}</span>
                </button>
              ))}
            </div>
            <p className="muted small" style={{ margin: '2px 0 6px' }}>{LABEL_STYLES[d.style ?? 'classic'].hint}</p>
            <div className="labels-option-row">
              <span className="field-label">Printer</span>
              <div className="seg">
                <button className={printer === 'label' ? 'on' : ''} onClick={() => choosePrinter('label')}>Label printer (roll)</button>
                <button className={printer === 'regular' ? 'on' : ''} onClick={() => choosePrinter('regular')}>Regular printer (A4 sheet)</button>
              </div>
            </div>
            <div className="labels-option-row">
              <span className="field-label">Print as</span>
              <div className="seg">
                <button className={d.symbol === 'barcode' ? 'on' : ''} onClick={() => update({ symbol: 'barcode' })}>Barcode</button>
                <button className={d.symbol === 'qr' ? 'on' : ''} onClick={() => update({ symbol: 'qr' })}>QR code</button>
              </div>
              <Toggle checked={d.showCode} onChange={(v) => update({ showCode: v })} label="Code in figures" />
            </div>
            <div className="labels-option-row">
              <label className="field" style={{ flex: '1 1 260px', margin: 0 }}>
                <span className="field-label">Label size</span>
                <select className="input" value={savedSize ? `saved:${savedSize.id}` : d.layout} onChange={(e) => chooseSize(e.target.value)}>
                  <optgroup label={printer === 'label' ? 'Common roll sizes' : 'A4 sticker sheets'}>
                    {Object.entries(LABEL_LAYOUTS)
                      .filter(([k, v]) => v.printer === printer && k !== 'roll-custom')
                      .map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </optgroup>
                  {printer === 'label' && sizes.length > 0 && (
                    <optgroup label="Your sizes">
                      {sizes.map((s) => (
                        <option key={s.id} value={`saved:${s.id}`}>
                          {s.name} ({s.across > 1 ? `${s.across} across, ` : ''}{s.width} × {s.height} mm)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              {printer === 'label' && <button className="btn small" style={{ alignSelf: 'flex-end' }} onClick={() => setSizeForm('new')}>+ Custom size</button>}
              {savedSize && (
                <>
                  <button className="btn small" style={{ alignSelf: 'flex-end' }} onClick={() => setSizeForm(savedSize)}>Change size</button>
                  <button className="btn small danger" style={{ alignSelf: 'flex-end' }} onClick={() => removeSize(savedSize)}>Delete size</button>
                </>
              )}
              {L.sheet && (
                <label className="field" style={{ flex: '0 1 200px', margin: 0 }}>
                  <span className="field-label">Skip used labels on the sheet</span>
                  <input className="input" inputMode="numeric" value={skip} onChange={(e) => setSkip(e.target.value.replace(/\D/g, ''))} />
                </label>
              )}
            </div>
            <div className="section-title">What the label shows</div>
            <div className="form-grid three">
              <LineChoice title="Header" line={d.header} onChange={(l) => update({ header: l })} own={own} />
              {d.lines.map((l, i) => <LineChoice key={i} title={`Line ${i + 1}`} line={l} onChange={(x) => setLine(i, x)} own={own} />)}
            </div>
            <div className="section-title">Barcode numbers</div>
            <CodeFormatRow onMessage={setMessage} />
            {extraFields.length > 0 && (
              <p className="muted small" style={{ margin: 0 }}>Type the {extraFields.map((f) => EXTRA_TITLES[f].toLowerCase()).join(', ')} for each item in the list above.</p>
            )}
          </div>
        </div>
        <div className="labels-preview">
          {preview ? (
            <iframe title="Label preview" sandbox="" srcDoc={scaled(preview, pageWidth(resolved))} />
          ) : (
            <p className="muted">Enter how many labels to print for each item.</p>
          )}
          {preview.includes('content="tight"') && (
            <p className="notice labels-note" style={{ margin: 8 }}>Too many lines for this label size: some will be cut off. Choose fewer lines or a bigger label.</p>
          )}
          {d.symbol === 'qr' && preview && <p className="muted small labels-note">The QR code holds the barcode (or item code), so a 2D scanner adds the item to a bill.</p>}
        </div>
      </div>
    </Modal>
    {sizeForm && (
      <CustomSizeModal size={sizeForm === 'new' ? null : sizeForm} design={d} onClose={() => setSizeForm(null)} onSaved={sizeSaved} />
    )}
    </>
  )
}
