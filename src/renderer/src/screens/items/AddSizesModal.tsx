import { useEffect, useState } from 'react'
import { splitSizeCode } from '@shared/barcode'
import type { Item } from '@shared/models'
import { formatINR, toPaise } from '@shared/money'
import { api, errorMessage } from '../../api'
import { Banner, Modal } from '../../components/Field'

interface Props {
  item: Item
  onClose: () => void
  /** The new size items, to select and reload. */
  onSaved: (made: Item[]) => void
}

const COMMON = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Free size', '28', '30', '32', '34', '36', '38', '40']

/**
 * More sizes of a product. Each size becomes its own item with its own barcode: with size numbers the sizes share the
 * product number (AA-00012~1, ~2, ~3). Colours of one size are the same item, so they scan as one barcode.
 */
export function AddSizesModal({ item, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<{ size: string; price: string }[]>([{ size: '', price: '' }])
  const [error, setError] = useState('')
  const [sizeField, setSizeField] = useState<number>(-1)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api.getFeatures().then((f) => setSizeField(f.itemFields.findIndex((x) => x.on && /^size$/i.test(x.label.trim()))), () => undefined)
  }, [])
  const own = sizeField >= 0 ? item.customFields?.[sizeField] ?? '' : ''
  const stem = item.barcode ? splitSizeCode(item.barcode) : null
  const filled = rows.filter((r) => r.size.trim())

  const set = (i: number, part: Partial<{ size: string; price: string }>) => {
    const next = rows.map((r, k) => (k === i ? { ...r, ...part } : r))
    // Always keep one empty row to type the next size.
    if (next[next.length - 1]!.size.trim()) next.push({ size: '', price: '' })
    setRows(next)
  }
  const quick = (s: string) => {
    if (rows.some((r) => r.size.trim().toLowerCase() === s.toLowerCase()) || own.toLowerCase() === s.toLowerCase()) return
    const next = [...filled, { size: s, price: '' }, { size: '', price: '' }]
    setRows(next)
  }
  const save = async () => {
    setError('')
    let sizes: { size: string; salePrice?: number }[]
    try {
      sizes = filled.map((r) => (r.price.trim() ? { size: r.size.trim(), salePrice: toPaise(r.price) } : { size: r.size.trim() }))
    } catch {
      setError('Check the prices: use numbers like 849 or 849.50')
      return
    }
    setSaving(true)
    try {
      onSaved(await api.addItemSizes(item.id, sizes))
    } catch (e) {
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Add sizes of ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!filled.length || saving}>
            Add {filled.length || ''} size{filled.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      {error && <Banner kind="error">{error}</Banner>}
      <p className="muted small" style={{ marginTop: 0 }}>
        Each size becomes its own item with its own barcode, so the counter knows which size was sold.
        {stem?.size != null
          ? ` They share this product's number: ${stem.stem}~2, ${stem.stem}~3 …`
          : item.barcode
            ? ' Each size gets a new barcode number.'
            : ' This item gets a barcode first.'}
        {' '}All colours of one size are the same item and scan as the same barcode.
      </p>
      {sizeField < 0 && (
        <p className="muted small">Tip: turn on an item field named <b>Size</b> in Settings › Extra fields, so the size prints on labels and bills.</p>
      )}
      {own && <p className="small" style={{ margin: '0 0 8px' }}>This item is size <b>{own}</b>{item.barcode ? ` (${item.barcode})` : ''}.</p>}
      <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {COMMON.map((s) => (
          <button key={s} className="btn small" onClick={() => quick(s)}>{s}</button>
        ))}
      </div>
      <table className="table compact size-rows">
        <thead>
          <tr><th>Size</th><th>Sale price (blank = {formatINR(item.salePrice)})</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input className="input" aria-label={`Size ${i + 1}`} value={r.size} maxLength={20} onChange={(e) => set(i, { size: e.target.value })} /></td>
              <td><input className="input" aria-label={`Price ${i + 1}`} inputMode="decimal" value={r.price} placeholder={formatINR(item.salePrice, { symbol: false })} onChange={(e) => set(i, { price: e.target.value })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
