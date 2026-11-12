import { useState } from 'react'
import { customSizeError, labelsHtml, pageWidth, resolveLayout, type LabelData, type LabelOptions, type SavedLabelSize } from '@shared/labels'
import { api, errorMessage } from '../../api'
import { Banner, Modal } from '../../components/Field'

interface Props {
  /** The size to change; null adds a new one. */
  size: SavedLabelSize | null
  /** The label design, so the preview shows the lines chosen. */
  design: Omit<LabelOptions, 'skip'>
  onClose: () => void
  onSaved: (s: SavedLabelSize) => void
}

const SAMPLE: LabelData = {
  name: 'Sample item', code: '2000000000015', itemCode: 'SKU-1', category: 'Category', hsn: '6109', description: 'Description',
  price: 45_150, mrp: 49_900, extra: { batch: 'B12', model: 'M-100', mfg: '2026-11', exp: '2027-10' }
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

/** Name a label size of your own (labels per row, width, height, gap) with a live preview. */
export function CustomSizeModal({ size, design, onClose, onSaved }: Props) {
  const [name, setName] = useState(size?.name ?? '')
  const [f, setF] = useState({
    width: size ? String(size.width) : '50',
    height: size ? String(size.height) : '25',
    across: String(size?.across ?? 1),
    gap: size ? String(size.gap) : '2'
  })
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const across = Number(f.across)
  const custom = { width: num(f.width), height: num(f.height), across, gap: across === 1 ? 0 : num(f.gap) }
  const error = customSizeError(custom)
  const options: LabelOptions = { ...design, layout: 'roll-custom', custom, skip: 0 }
  const L = resolveLayout(options)
  const html = error ? '' : labelsHtml(Array(across).fill(SAMPLE), options, 'Your business')
  const zoom = error ? 1 : Math.min(3, 330 / (pageWidth(L) * 3.78))
  const preview = html.replace('</head>', `<style>html { zoom: ${zoom.toFixed(3)}; } body { background: #f2f4f7; padding: 4mm 0; } .row { margin: 0 auto; } .label { background: #fff; outline: 1px dashed #98a2b3; }</style></head>`)

  const save = async () => {
    setSaving(true)
    setFailure(null)
    try {
      onSaved(await api.saveLabelSize(size?.id ?? null, name, custom))
    } catch (e) {
      setFailure(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const field = (k: keyof typeof f, title: string, disabled = false) => (
    <label className="field">
      <span className="field-label">{title}</span>
      <input className="input" inputMode="decimal" value={disabled ? '0' : f[k]} disabled={disabled}
        onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value.replace(/[^\d.]/g, '') }))} />
    </label>
  )

  return (
    <Modal
      title={size ? 'Change label size' : 'Create custom size'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving || !!error || !name.trim()}>Save size</button>
        </>
      }
    >
      {failure && <Banner kind="error">{failure}</Banner>}
      <div className="size-layout">
        <div>
          <p className="muted small" style={{ marginTop: 0 }}>
            Measure one label on your roll, and the gap between labels if there are several in a row. Set the same paper size in the printer's own settings.
          </p>
          <label className="field">
            <span className="field-label">Size name</span>
            <input className="input" value={name} maxLength={40} placeholder="e.g. Jewellery tag 40 × 30" onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Labels per row</span>
            <select className="input" value={f.across} onChange={(e) => setF((x) => ({ ...x, across: e.target.value }))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="form-grid">
            {field('width', 'Label width (mm)')}
            {field('height', 'Label height (mm)')}
          </div>
          {field('gap', 'Gap between labels (mm)', across === 1)}
          {error && <p className="field-error">{error}</p>}
        </div>
        <div className="size-preview">
          <div className="field-label">Preview</div>
          {html ? <iframe title="Size preview" sandbox="" srcDoc={preview} /> : <p className="muted">{error}</p>}
          {!error && (
            <p className="muted small">
              Each label {custom.width} × {custom.height} mm · paper {pageWidth(L)} × {custom.height} mm
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
