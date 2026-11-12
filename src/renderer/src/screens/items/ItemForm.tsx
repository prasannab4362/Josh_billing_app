import { useEffect, useState } from 'react'
import type { Item, ItemInput, ItemKind, TaxRate, Unit } from '@shared/models'
import { todayLocal } from '@shared/fy'
import { hasErrors, normalizeItem, validateItem, type Errors } from '@shared/validation'
import { api, errorMessage } from '../../api'
import { Banner, DateInput, Field, Modal, TextArea, TextInput, Toggle } from '../../components/Field'
import { barcodeSvg } from '@shared/barcode'
import { ImagePicker } from '../settings/BusinessTab'
import { OwnFields } from '../../components/OwnFields'
import { milliOrNull, milliOrZero, milliText, paiseOrNull, paiseOrZero, paiseText } from '../../forms'

interface FormState {
  name: string
  kind: ItemKind
  code: string
  category: string
  hsnSac: string
  baseUnitId: string
  altUnitId: string
  altConversion: string
  salePrice: string
  priceIncludesTax: boolean
  purchasePrice: string
  taxRateId: string
  mrp: string
  wholesalePrice: string
  wholesaleMinQty: string
  trackStock: boolean
  openingQty: string
  openingRate: string
  openingDate: string
  lowStockQty: string
  description: string
  barcode: string
}

function initial(i: Item | null, pricesIncludeTax: boolean, defaultUnitId: string): FormState {
  return {
    name: i?.name ?? '',
    kind: i?.kind ?? 'goods',
    code: i?.code ?? '',
    category: i?.category ?? '',
    hsnSac: i?.hsnSac ?? '',
    baseUnitId: i ? (i.baseUnitId ?? '') : defaultUnitId,
    altUnitId: i?.altUnitId ?? '',
    altConversion: milliText(i?.altConversion ?? null),
    salePrice: paiseText(i?.salePrice ?? null),
    priceIncludesTax: i?.priceIncludesTax ?? pricesIncludeTax,
    purchasePrice: paiseText(i?.purchasePrice ?? null),
    taxRateId: i?.taxRateId ?? '',
    mrp: paiseText(i?.mrp ?? null),
    wholesalePrice: paiseText(i?.wholesalePrice ?? null),
    wholesaleMinQty: milliText(i?.wholesaleMinQty ?? null),
    trackStock: i?.trackStock ?? true,
    openingQty: milliText(i?.openingQty ?? null),
    openingRate: paiseText(i?.openingRate ?? null),
    openingDate: i?.openingDate || todayLocal(),
    lowStockQty: milliText(i?.lowStockQty ?? null),
    description: i?.description ?? '',
    barcode: i?.barcode ?? ''
  }
}

type FieldErrors = Errors<ItemInput>

function toInput(f: FormState): { input: ItemInput | null; errors: FieldErrors } {
  const errors: FieldErrors = {}
  const num = <T,>(key: keyof ItemInput, parse: () => T, fallback: T, msg = 'Enter a number'): T => {
    try {
      return parse()
    } catch {
      errors[key] = msg
      return fallback
    }
  }
  const salePrice = num('salePrice', () => paiseOrZero(f.salePrice), 0, 'Enter a price, like 120 or 99.50')
  const purchasePrice = num('purchasePrice', () => paiseOrZero(f.purchasePrice), 0, 'Enter a price, like 120 or 99.50')
  const mrp = num('mrp', () => paiseOrNull(f.mrp), null)
  const wholesalePrice = num('wholesalePrice', () => paiseOrNull(f.wholesalePrice), null)
  const wholesaleMinQty = num('wholesaleMinQty', () => milliOrNull(f.wholesaleMinQty), null)
  const altConversion = num('altConversion', () => milliOrNull(f.altConversion), null)
  const openingQty = num('openingQty', () => milliOrZero(f.openingQty), 0)
  // Opening stock defaults to the purchase price when no rate is given.
  const openingRate = num('openingRate', () => paiseOrNull(f.openingRate) ?? purchasePrice, 0)
  const lowStockQty = num('lowStockQty', () => milliOrNull(f.lowStockQty), null)
  if (hasErrors(errors)) return { input: null, errors }

  const input: ItemInput = {
    name: f.name,
    code: f.code,
    kind: f.kind,
    category: f.category,
    hsnSac: f.hsnSac,
    taxRateId: f.taxRateId || null,
    priceIncludesTax: f.priceIncludesTax,
    salePrice,
    purchasePrice,
    mrp,
    wholesalePrice,
    wholesaleMinQty,
    baseUnitId: f.baseUnitId || null,
    altUnitId: f.altUnitId || null,
    altConversion,
    trackStock: f.trackStock,
    openingQty,
    openingRate,
    openingDate: f.openingDate,
    lowStockQty,
    description: f.description,
    barcode: f.barcode
  }
  return { input, errors: validateItem(normalizeItem(input)) }
}

interface Props {
  item: Item | null
  onClose: () => void
  onSaved: (i: Item) => void
}

export function ItemForm({ item, onClose, onSaved }: Props) {
  const [f, setF] = useState<FormState | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [rates, setRates] = useState<TaxRate[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // The photo is loaded on its own (lists do not carry it); undefined means "not changed".
  const [image, setImage] = useState<string | null>(null)
  const [imageChanged, setImageChanged] = useState(false)
  const [own, setOwn] = useState<string[]>(() => item?.customFields ?? [])

  useEffect(() => {
    if (item?.hasImage) api.getItemImage(item.id).then(setImage, () => setImage(null))
  }, [item?.id])

  const newBarcode = async () => {
    try {
      set('barcode', await api.generateBarcode())
    } catch (e) {
      setFailure(errorMessage(e))
    }
  }

  useEffect(() => {
    Promise.all([api.listUnits(), api.listTaxRates(), api.listItemCategories(), api.getPreferences()]).then(
      ([u, r, c, prefs]) => {
        setUnits(u)
        setRates(r)
        setCategories(c)
        setF(initial(item, prefs.pricesIncludeTax, u.find((x) => x.short === 'pcs')?.id ?? ''))
      },
      (e) => setFailure(errorMessage(e))
    )
  }, [item])

  // Editing a field clears its error until the next save.
  const clearError = (key: string) =>
    setErrors((e) => {
      const next = { ...e } as Record<string, string | undefined>
      delete next[key]
      if (key === 'opening') delete next.openingBalance
      return next as FieldErrors
    })
  const set = <K extends keyof FormState>(key: K, v: FormState[K]) => {
    clearError(key)
    setF((s) => (s ? { ...s, [key]: v } : s))
  }

  const save = async () => {
    if (!f) return
    setFailure(null)
    const { input, errors: e } = toInput(f)
    setErrors(e)
    if (!input || hasErrors(e)) return
    setSaving(true)
    try {
      const full = { ...input, image: imageChanged ? image : undefined, customFields: own.some((v) => v.trim()) ? own : null }
      onSaved(item ? await api.updateItem(item.id, full) : await api.createItem(full))
    } catch (err) {
      setFailure(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={saving || !f}>
        {saving ? 'Saving…' : 'Save item'}
      </button>
    </>
  )

  if (!f) {
    return (
      <Modal title={item ? `Edit ${item.name}` : 'Add item'} onClose={onClose} footer={footer} wide>
        {failure ? <Banner kind="error">{failure}</Banner> : <p className="muted">Loading…</p>}
      </Modal>
    )
  }

  const goods = f.kind === 'goods'
  const unitShort = (id: string) => units.find((u) => u.id === id)?.short ?? 'unit'
  // Hidden rates stay selectable when the item already uses one.
  const rateOptions = rates.filter((r) => r.isActive || r.id === f.taxRateId)
  const locked = item?.hasTransactions ?? false

  return (
    <Modal title={item ? `Edit ${item.name}` : 'Add item'} onClose={onClose} footer={footer} wide>
      {failure && <Banner kind="error">{failure}</Banner>}
      <div className="form-grid three">
        <Field label="Item name" required error={errors.name}>
          <TextInput value={f.name} onChange={(v) => set('name', v)} autoFocus placeholder="e.g. Basmati Rice 5kg" />
        </Field>
        <Field label="Type" group>
          <div className="seg">
            <button type="button" className={goods ? 'on' : ''} onClick={() => set('kind', 'goods')}>Product</button>
            <button type="button" className={goods ? '' : 'on'} onClick={() => set('kind', 'service')}>Service</button>
          </div>
        </Field>
        <Field label="Item code / SKU" error={errors.code}>
          <TextInput value={f.code} onChange={(v) => set('code', v)} placeholder="Optional, e.g. TS-RED-M" />
        </Field>
        <Field label={goods ? 'HSN code' : 'SAC code'} error={errors.hsnSac} hint="4, 6 or 8 digits">
          <TextInput value={f.hsnSac} onChange={(v) => set('hsnSac', v.replace(/\s/g, ''))} inputMode="numeric" maxLength={8} />
        </Field>
        <Field label="Category">
          <input className="input" list="item-categories" value={f.category} onChange={(e) => set('category', e.target.value)} />
          <datalist id="item-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Unit" error={errors.baseUnitId} hint={locked ? 'Fixed once the item is used' : undefined}>
          <select className="input" value={f.baseUnitId} disabled={locked} onChange={(e) => set('baseUnitId', e.target.value)}>
            <option value="">No unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.short})</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="form-grid three">
        <Field label="Barcode" error={errors.barcode} hint="Scan the product's barcode here, or create one to print on labels">
          <div className="row-flex">
            <TextInput value={f.barcode} onChange={(v) => set('barcode', v.trim())} placeholder="Scan or type" />
            <button type="button" className="btn" onClick={newBarcode} disabled={!!f.barcode} title="Create a new barcode number">Create</button>
          </div>
          {f.barcode && !errors.barcode && /^[\x20-\x7E]+$/.test(f.barcode) && (
            <div className="barcode-preview" dangerouslySetInnerHTML={{ __html: barcodeSvg(f.barcode) }} />
          )}
        </Field>
        <Field label="Description" error={errors.description} hint="Printed under the item name on bills">
          <TextArea value={f.description} onChange={(v) => set('description', v)} placeholder="e.g. Cotton, round neck, sizes S–XL" />
        </Field>
        <ImagePicker
          title="Photo"
          hint="Shown in the item list"
          value={image ?? ''}
          options={{ maxWidth: 600, maxHeight: 600, format: 'jpeg' }}
          onChange={async (v) => { setImage(v); setImageChanged(true) }}
          onMessage={(m) => setFailure(m?.text ?? null)}
        />
      </div>

      <div className="section-title">Price & tax</div>
      <div className="form-grid three">
        <Field label="Sale price (₹)" error={errors.salePrice}>
          <TextInput value={f.salePrice} onChange={(v) => set('salePrice', v)} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="GST rate">
          <select className="input" value={f.taxRateId} onChange={(e) => set('taxRateId', e.target.value)}>
            <option value="">None</option>
            {rateOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Sale price is" group>
          <div className="seg">
            <button type="button" className={f.priceIncludesTax ? '' : 'on'} onClick={() => set('priceIncludesTax', false)}>
              Without tax
            </button>
            <button type="button" className={f.priceIncludesTax ? 'on' : ''} onClick={() => set('priceIncludesTax', true)}>
              With tax
            </button>
          </div>
        </Field>
        <Field label="Purchase price (₹)" error={errors.purchasePrice}>
          <TextInput value={f.purchasePrice} onChange={(v) => set('purchasePrice', v)} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="MRP (₹)" error={errors.mrp}>
          <TextInput value={f.mrp} onChange={(v) => set('mrp', v)} inputMode="decimal" />
        </Field>
        <div />
        <Field label="Wholesale price (₹)" error={errors.wholesalePrice}>
          <TextInput value={f.wholesalePrice} onChange={(v) => set('wholesalePrice', v)} inputMode="decimal" />
        </Field>
        <Field label={`Wholesale from qty (${unitShort(f.baseUnitId)})`} error={errors.wholesaleMinQty}>
          <TextInput value={f.wholesaleMinQty} onChange={(v) => set('wholesaleMinQty', v)} inputMode="decimal" />
        </Field>
      </div>

      <div className="section-title">Second unit</div>
      <div className="form-grid three">
        <Field label="Also sold in" error={errors.altUnitId} hint="e.g. Box, when the main unit is Pieces">
          <select className="input" value={f.altUnitId} onChange={(e) => set('altUnitId', e.target.value)}>
            <option value="">None</option>
            {units.filter((u) => u.id !== f.baseUnitId).map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.short})</option>
            ))}
          </select>
        </Field>
        {f.altUnitId && (
          <Field label={`1 ${unitShort(f.altUnitId)} = how many ${unitShort(f.baseUnitId)}`} error={errors.altConversion}>
            <TextInput value={f.altConversion} onChange={(v) => set('altConversion', v)} inputMode="decimal" placeholder="12" />
          </Field>
        )}
      </div>

      {goods && (
        <>
          <div className="section-title">Stock</div>
          <Toggle checked={f.trackStock} onChange={(v) => set('trackStock', v)} label="Track stock for this item" />
          {f.trackStock && (
            <div className="form-grid three">
              <Field label={`Opening stock (${unitShort(f.baseUnitId)})`} error={errors.openingQty}>
                <TextInput value={f.openingQty} onChange={(v) => set('openingQty', v)} inputMode="decimal" placeholder="0" />
              </Field>
              <Field label="At price per unit (₹)" error={errors.openingRate} hint="Defaults to the purchase price">
                <TextInput value={f.openingRate} onChange={(v) => set('openingRate', v)} inputMode="decimal" />
              </Field>
              <Field label="As of date" error={errors.openingDate}>
                <DateInput value={f.openingDate} onChange={(v) => set('openingDate', v)} />
              </Field>
              <Field label={`Low stock alert below (${unitShort(f.baseUnitId)})`} error={errors.lowStockQty}>
                <TextInput value={f.lowStockQty} onChange={(v) => set('lowStockQty', v)} inputMode="decimal" />
              </Field>
            </div>
          )}
        </>
      )}
      <OwnFields kind="item" values={own} onChange={setOwn} />
    </Modal>
  )
}
