import type { BusinessProfile } from '@shared/models'
import { gstinProblem, gstinStateCode } from '@shared/gstin'
import type { Errors } from '@shared/validation'
import { Field, StateSelect, TextInput } from './Field'

export const EMPTY_PROFILE: BusinessProfile = {
  name: '',
  legalName: '',
  gstin: '',
  pan: '',
  stateCode: '',
  address: '',
  city: '',
  pincode: '',
  phone: '',
  email: '',
  businessType: '',
  category: '',
  fyStartMonth: 4
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

interface Props {
  value: BusinessProfile
  onChange: (p: BusinessProfile) => void
  errors: Errors<BusinessProfile>
  compact?: boolean
}

export function BusinessForm({ value: p, onChange, errors, compact }: Props) {
  const set = <K extends keyof BusinessProfile>(key: K, v: BusinessProfile[K]) => onChange({ ...p, [key]: v })

  const setGstin = (raw: string) => {
    const gstin = raw.toUpperCase().replace(/\s/g, '')
    const next = { ...p, gstin }
    // Fill the state from a complete, valid GSTIN.
    if (gstin.length === 15 && gstinProblem(gstin) === null) next.stateCode = gstinStateCode(gstin)
    onChange(next)
  }

  return (
    <div className="form-grid">
      <Field label="Business name" required error={errors.name}>
        <TextInput value={p.name} onChange={(v) => set('name', v)} autoFocus placeholder="e.g. Sharma Traders" />
      </Field>
      <Field label="Mobile number" error={errors.phone}>
        <TextInput value={p.phone} onChange={(v) => set('phone', v)} inputMode="tel" placeholder="10-digit mobile" />
      </Field>
      <Field label="GSTIN" error={errors.gstin} hint="Leave empty if not registered">
        <TextInput value={p.gstin} onChange={setGstin} maxLength={15} placeholder="27ABCDE1234F1Z5" />
      </Field>
      <Field label="State" required error={errors.stateCode} hint="Decides CGST+SGST or IGST on invoices">
        <StateSelect value={p.stateCode} onChange={(v) => set('stateCode', v)} />
      </Field>
      <Field label="Address" error={errors.address}>
        <TextInput value={p.address} onChange={(v) => set('address', v)} placeholder="Shop / street / area" />
      </Field>
      <Field label="City" error={errors.city}>
        <TextInput value={p.city} onChange={(v) => set('city', v)} />
      </Field>
      <Field label="Pincode" error={errors.pincode}>
        <TextInput value={p.pincode} onChange={(v) => set('pincode', v)} inputMode="numeric" maxLength={6} />
      </Field>
      <Field label="Email" error={errors.email}>
        <TextInput value={p.email} onChange={(v) => set('email', v)} inputMode="email" />
      </Field>
      {!compact && (
        <>
          <Field label="Legal name" hint="If different from the business name">
            <TextInput value={p.legalName} onChange={(v) => set('legalName', v)} />
          </Field>
          <Field label="PAN" error={errors.pan} hint="Taken from GSTIN if left empty">
            <TextInput value={p.pan} onChange={(v) => set('pan', v.toUpperCase())} maxLength={10} />
          </Field>
          <Field label="Business type">
            <select className="input" value={p.businessType} onChange={(e) => set('businessType', e.target.value)}>
              <option value="">Select…</option>
              {['Retail', 'Wholesale', 'Distributor', 'Manufacturer', 'Services', 'Other'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Category" hint="e.g. Grocery, Electronics, Automobile">
            <TextInput value={p.category} onChange={(v) => set('category', v)} />
          </Field>
          <Field label="Financial year starts in" error={errors.fyStartMonth}>
            <select className="input" value={p.fyStartMonth} onChange={(e) => set('fyStartMonth', Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </div>
  )
}
