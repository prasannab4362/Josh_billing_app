import { useEffect, useState } from 'react'
import { OwnFields } from '../../components/OwnFields'
import type { Party, PartyInput, PartyKind } from '@shared/models'
import { gstinProblem, gstinStateCode } from '@shared/gstin'
import { todayLocal } from '@shared/fy'
import { hasErrors, normalizeParty, validateParty, type Errors } from '@shared/validation'
import { api, errorMessage } from '../../api'
import { Banner, DateInput, Field, Modal, StateSelect, TextArea, TextInput, Toggle } from '../../components/Field'
import { paiseOrNull, paiseText } from '../../forms'

interface FormState {
  name: string
  kind: PartyKind
  phone: string
  email: string
  gstin: string
  stateCode: string
  billingAddress: string
  shippingAddress: string
  sameAddress: boolean
  opening: string
  openingSide: 'receive' | 'pay'
  openingDate: string
  creditLimit: string
  paymentTermDays: string
  group: string
}

function initial(p: Party | null, kind: PartyKind): FormState {
  return {
    name: p?.name ?? '',
    kind: p?.kind ?? kind,
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    gstin: p?.gstin ?? '',
    stateCode: p?.stateCode ?? '',
    billingAddress: p?.billingAddress ?? '',
    shippingAddress: p?.shippingAddress ?? '',
    sameAddress: !p || !p.shippingAddress || p.shippingAddress === p.billingAddress,
    opening: paiseText(p ? Math.abs(p.openingBalance) : null),
    openingSide: p && p.openingBalance < 0 ? 'pay' : kind === 'supplier' && !p ? 'pay' : 'receive',
    openingDate: p?.openingDate || todayLocal(),
    creditLimit: paiseText(p?.creditLimit ?? null),
    paymentTermDays: p?.paymentTermDays === null || p?.paymentTermDays === undefined ? '' : String(p.paymentTermDays),
    group: p?.group ?? ''
  }
}

type FieldErrors = Errors<PartyInput> & { opening?: string }

/** Turn the form's text into a PartyInput, or field errors when numbers do not parse. */
function toInput(f: FormState): { input: PartyInput | null; errors: FieldErrors } {
  const errors: FieldErrors = {}
  let opening = 0
  let creditLimit: number | null = null
  let paymentTermDays: number | null = null
  try {
    opening = Math.abs(paiseOrNull(f.opening) ?? 0)
  } catch {
    errors.openingBalance = 'Enter an amount, like 1500 or 1500.50'
  }
  try {
    creditLimit = paiseOrNull(f.creditLimit)
  } catch {
    errors.creditLimit = 'Enter an amount'
  }
  if (f.paymentTermDays.trim()) {
    paymentTermDays = /^\d+$/.test(f.paymentTermDays.trim()) ? Number(f.paymentTermDays) : NaN
  }
  if (hasErrors(errors)) return { input: null, errors }
  const input: PartyInput = {
    name: f.name,
    kind: f.kind,
    phone: f.phone,
    email: f.email,
    gstin: f.gstin,
    stateCode: f.stateCode,
    billingAddress: f.billingAddress,
    shippingAddress: f.sameAddress ? '' : f.shippingAddress,
    openingBalance: f.openingSide === 'pay' ? -opening : opening,
    openingDate: f.openingDate,
    creditLimit,
    paymentTermDays,
    group: f.group
  }
  return { input, errors: validateParty(normalizeParty(input)) }
}

interface Props {
  party: Party | null
  defaultKind?: PartyKind
  onClose: () => void
  onSaved: (p: Party) => void
}

export function PartyForm({ party, defaultKind = 'customer', onClose, onSaved }: Props) {
  const [f, setF] = useState(() => initial(party, defaultKind))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [groups, setGroups] = useState<string[]>([])
  const [own, setOwn] = useState<string[]>(() => party?.customFields ?? [])

  useEffect(() => {
    api.listPartyGroups().then(setGroups, () => setGroups([]))
  }, [])

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
    setF((s) => ({ ...s, [key]: v }))
  }

  const setGstin = (raw: string) => {
    const gstin = raw.toUpperCase().replace(/\s/g, '')
    clearError('gstin')
    setF((s) => ({
      ...s,
      gstin,
      stateCode: gstin.length === 15 && gstinProblem(gstin) === null ? gstinStateCode(gstin) : s.stateCode
    }))
  }

  const save = async () => {
    setFailure(null)
    const { input, errors: e } = toInput(f)
    setErrors(e)
    if (!input || hasErrors(e)) return
    setSaving(true)
    try {
      const full = { ...input, customFields: own.some((v) => v.trim()) ? own : null }
      onSaved(party ? await api.updateParty(party.id, full) : await api.createParty(full))
    } catch (err) {
      setFailure(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={party ? `Edit ${party.name}` : 'Add party'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save party'}
          </button>
        </>
      }
    >
      {failure && <Banner kind="error">{failure}</Banner>}
      <div className="form-grid">
        <Field label="Party name" required error={errors.name}>
          <TextInput value={f.name} onChange={(v) => set('name', v)} autoFocus placeholder="Customer or supplier name" />
        </Field>
        <Field label="Type" group>
          <div className="seg">
            {(['customer', 'supplier', 'both'] as const).map((k) => (
              <button key={k} type="button" className={f.kind === k ? 'on' : ''} onClick={() => set('kind', k)}>
                {k === 'both' ? 'Both' : k === 'customer' ? 'Customer' : 'Supplier'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Mobile number" error={errors.phone}>
          <TextInput value={f.phone} onChange={(v) => set('phone', v)} inputMode="tel" placeholder="10-digit mobile" />
        </Field>
        <Field label="Email" error={errors.email}>
          <TextInput value={f.email} onChange={(v) => set('email', v)} inputMode="email" />
        </Field>
      </div>

      <div className="section-title">GST & address</div>
      <div className="form-grid">
        <Field label="GSTIN" error={errors.gstin} hint="Leave empty for unregistered customers">
          <TextInput value={f.gstin} onChange={setGstin} maxLength={15} placeholder="27ABCDE1234F1Z5" />
        </Field>
        <Field label="State" error={errors.stateCode} hint="Decides CGST+SGST or IGST on bills">
          <StateSelect value={f.stateCode} onChange={(v) => set('stateCode', v)} />
        </Field>
        <Field label="Billing address">
          <TextArea value={f.billingAddress} onChange={(v) => set('billingAddress', v)} />
        </Field>
        <Field label="Shipping address" group>
          {f.sameAddress ? (
            <Toggle checked label="Same as billing address" onChange={(v) => set('sameAddress', v)} />
          ) : (
            <>
              <TextArea value={f.shippingAddress} onChange={(v) => set('shippingAddress', v)} />
              <Toggle checked={false} label="Same as billing address" onChange={(v) => set('sameAddress', v)} />
            </>
          )}
        </Field>
      </div>

      <div className="section-title">Balance & credit</div>
      <div className="form-grid three">
        <Field label="Opening balance (₹)" error={errors.openingBalance}>
          <TextInput value={f.opening} onChange={(v) => set('opening', v)} inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="This amount is" group>
          <div className="seg">
            <button type="button" className={f.openingSide === 'receive' ? 'on' : ''} onClick={() => set('openingSide', 'receive')}>
              To receive
            </button>
            <button type="button" className={f.openingSide === 'pay' ? 'on' : ''} onClick={() => set('openingSide', 'pay')}>
              To pay
            </button>
          </div>
        </Field>
        <Field label="As of date" error={errors.openingDate}>
          <DateInput value={f.openingDate} onChange={(v) => set('openingDate', v)} />
        </Field>
        <Field label="Credit limit (₹)" error={errors.creditLimit} hint="Optional — warns when billing above it">
          <TextInput value={f.creditLimit} onChange={(v) => set('creditLimit', v)} inputMode="decimal" />
        </Field>
        <Field label="Payment terms (days)" error={errors.paymentTermDays} hint="Sets the invoice due date">
          <TextInput value={f.paymentTermDays} onChange={(v) => set('paymentTermDays', v)} inputMode="numeric" />
        </Field>
        <Field label="Group" error={errors.group} hint="e.g. Retail, Wholesale">
          <input className="input" list="party-groups" value={f.group} onChange={(e) => set('group', e.target.value)} />
          <datalist id="party-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
      </div>
      <OwnFields kind="party" values={own} onChange={setOwn} />
    </Modal>
  )
}
