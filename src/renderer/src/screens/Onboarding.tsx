import { useState } from 'react'
import type { BankAccountInput, Business, BusinessProfile, PaperSize, Preferences } from '@shared/models'
import { DEFAULT_PREFERENCES } from '@shared/models'
import { fyFor, fyShort, todayLocal } from '@shared/fy'
import { toPaise } from '@shared/money'
import { hasErrors, normalizeBusiness, validateBankAccount, validateBusiness, type Errors } from '@shared/validation'
import { api, errorMessage } from '../api'
import { BusinessForm, EMPTY_PROFILE } from '../components/BusinessForm'
import { Banner, Field, TextInput, Toggle } from '../components/Field'
import { Icon } from '../components/Icon'

const STEPS = ['Business details', 'Preferences', 'Bank & UPI']

interface BankForm {
  enabled: boolean
  name: string
  bankName: string
  accountNo: string
  ifsc: string
  upiId: string
  openingBalance: string
}

interface Props {
  onDone: (b: Business) => void
  onCancel?: () => void
}

export function Onboarding({ onDone, onCancel }: Props) {
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState<BusinessProfile>(EMPTY_PROFILE)
  const [profileErrors, setProfileErrors] = useState<Errors<BusinessProfile>>({})
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES)
  const fy = fyShort(fyFor(todayLocal(), profile.fyStartMonth))
  const [prefix, setPrefix] = useState(`INV/${fy}/`)
  const [bank, setBank] = useState<BankForm>({
    enabled: false, name: 'Main bank account', bankName: '', accountNo: '', ifsc: '', upiId: '', openingBalance: ''
  })
  const [bankErrors, setBankErrors] = useState<Errors<BankAccountInput>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const next = () => {
    if (step === 0) {
      const errors = validateBusiness(normalizeBusiness(profile))
      setProfileErrors(errors)
      if (hasErrors(errors)) return
      if (!profile.gstin) setPrefs((p) => ({ ...p, gstRegistered: false }))
    }
    setStep((s) => s + 1)
  }

  const bankInput = (): BankAccountInput | null | 'invalid' => {
    if (!bank.enabled) return null
    let openingBalance = 0
    try {
      openingBalance = bank.openingBalance.trim() ? toPaise(bank.openingBalance) : 0
    } catch {
      setBankErrors({ openingBalance: 'Enter an amount like 5000 or 5000.50' })
      return 'invalid'
    }
    const input: BankAccountInput = {
      kind: bank.accountNo.trim() ? 'bank' : 'upi_wallet',
      name: bank.name, bankName: bank.bankName, accountNo: bank.accountNo, ifsc: bank.ifsc, upiId: bank.upiId,
      openingBalance
    }
    const errors = validateBankAccount(input)
    setBankErrors(errors)
    return hasErrors(errors) ? 'invalid' : input
  }

  const finish = async () => {
    const bankAccount = bankInput()
    if (bankAccount === 'invalid') return
    setSaving(true)
    setError(null)
    try {
      onDone(await api.createBusiness({ profile, preferences: prefs, invoicePrefix: prefix, bankAccount }))
    } catch (e) {
      setError(errorMessage(e))
      setSaving(false)
    }
  }

  const setB = <K extends keyof BankForm>(k: K, v: BankForm[K]) => setBank((b) => ({ ...b, [k]: v }))
  const setP = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setPrefs((p) => ({ ...p, [k]: v }))

  return (
    <div className="center-page">
      <div className="wizard">
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''}>
              <span>{i < step ? <Icon name="check" size={14} strokeWidth={2.6} /> : i + 1}</span> {s}
            </li>
          ))}
        </ol>

        {error && <Banner kind="error">{error}</Banner>}

        {step === 0 && (
          <section>
            <h2>Tell us about your business</h2>
            <p className="muted">This appears on your invoices. You can change it later in Settings.</p>
            <BusinessForm value={profile} onChange={setProfile} errors={profileErrors} compact />
          </section>
        )}

        {step === 1 && (
          <section>
            <h2>How do you bill?</h2>
            <div className="stack">
              <Toggle checked={prefs.gstRegistered} onChange={(v) => setP('gstRegistered', v)} label="I am GST registered (show GST on invoices)" />
              <Toggle checked={prefs.pricesIncludeTax} onChange={(v) => setP('pricesIncludeTax', v)} label="My item prices already include GST" />
              <Toggle checked={prefs.roundOff} onChange={(v) => setP('roundOff', v)} label="Round invoice totals to the nearest rupee" />
            </div>
            <div className="form-grid">
              <Field label="Invoice number prefix" hint={`First invoice will be ${prefix}1`}>
                <TextInput value={prefix} onChange={setPrefix} maxLength={20} />
              </Field>
              <Field label="Print size">
                <select className="input" value={prefs.paperSize} onChange={(e) => setP('paperSize', e.target.value as PaperSize)}>
                  <option value="A4">A4</option>
                  <option value="A5">A5</option>
                  <option value="thermal80">Thermal 80 mm (3 inch)</option>
                  <option value="thermal58">Thermal 58 mm (2 inch)</option>
                </select>
              </Field>
              <Field label="Default payment due (days)">
                <TextInput
                  value={String(prefs.defaultDueDays)}
                  onChange={(v) => setP('defaultDueDays', Math.max(0, Math.min(365, Number(v.replace(/\D/g, '')) || 0)))}
                  inputMode="numeric"
                />
              </Field>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>Receive payments</h2>
            <p className="muted">Bank details and a UPI QR code can be printed on invoices. Optional.</p>
            <Toggle checked={bank.enabled} onChange={(v) => setB('enabled', v)} label="Add a bank account or UPI ID" />
            {bank.enabled && (
              <div className="form-grid">
                <Field label="Account name" required error={bankErrors.name}>
                  <TextInput value={bank.name} onChange={(v) => setB('name', v)} />
                </Field>
                <Field label="Bank name">
                  <TextInput value={bank.bankName} onChange={(v) => setB('bankName', v)} placeholder="e.g. State Bank of India" />
                </Field>
                <Field label="Account number" error={bankErrors.accountNo}>
                  <TextInput value={bank.accountNo} onChange={(v) => setB('accountNo', v.replace(/\s/g, ''))} inputMode="numeric" />
                </Field>
                <Field label="IFSC" error={bankErrors.ifsc}>
                  <TextInput value={bank.ifsc} onChange={(v) => setB('ifsc', v.toUpperCase())} maxLength={11} />
                </Field>
                <Field label="UPI ID" error={bankErrors.upiId}>
                  <TextInput value={bank.upiId} onChange={(v) => setB('upiId', v.trim())} placeholder="name@okbank" />
                </Field>
                <Field label="Current balance (₹)" error={bankErrors.openingBalance}>
                  <TextInput value={bank.openingBalance} onChange={(v) => setB('openingBalance', v)} inputMode="decimal" placeholder="0" />
                </Field>
              </div>
            )}
          </section>
        )}

        <div className="wizard-actions">
          {step === 0 && onCancel && (
            <button className="btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          {step > 0 && (
            <button className="btn" onClick={() => setStep((s) => s - 1)} disabled={saving}>
              <Icon name="arrowLeft" size={17} />Back
            </button>
          )}
          <span className="spacer" />
          {step < STEPS.length - 1 ? (
            <button className="btn primary" onClick={next}>
              Continue<Icon name="arrowRight" size={17} />
            </button>
          ) : (
            <button className="btn primary" onClick={finish} disabled={saving}>
              {saving ? 'Creating…' : <><Icon name="check" size={17} />Create business</>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
