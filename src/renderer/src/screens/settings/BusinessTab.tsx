import { useState } from 'react'
import type { Business, BusinessProfile } from '@shared/models'
import { hasErrors, normalizeBusiness, validateBusiness, type Errors } from '@shared/validation'
import { api, errorMessage } from '../../api'
import { BusinessForm } from '../../components/BusinessForm'
import { Banner } from '../../components/Field'
import { chooseImage } from '../../images'

function profileOf(b: Business): BusinessProfile {
  const { id: _id, createdAt: _c, updatedAt: _u, logo: _l, signature: _s, ...profile } = b
  return profile
}

type Message = { kind: 'error' | 'success'; text: string } | null

export function BusinessTab({ business, onSaved }: { business: Business; onSaved: (b: Business) => void }) {
  const [profile, setProfile] = useState(profileOf(business))
  const [errors, setErrors] = useState<Errors<BusinessProfile>>({})
  const [message, setMessage] = useState<Message>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const e = validateBusiness(normalizeBusiness(profile))
    setErrors(e)
    if (hasErrors(e)) return
    setSaving(true)
    try {
      const saved = await api.updateBusiness(profile)
      setProfile(profileOf(saved))
      onSaved(saved)
      setMessage({ kind: 'success', text: 'Business details saved' })
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="images-row">
        <ImagePicker
          title="Logo"
          hint="Printed at the top of your bills"
          value={business.logo}
          options={{ maxWidth: 600, maxHeight: 300, format: 'png' }}
          onChange={async (v) => onSaved(await api.setBusinessImage('logo', v))}
          onMessage={setMessage}
        />
        <ImagePicker
          title="Signature"
          hint="Printed above “Authorised signatory”. Sign on white paper and photograph it."
          value={business.signature}
          options={{ maxWidth: 500, maxHeight: 160, format: 'png' }}
          onChange={async (v) => onSaved(await api.setBusinessImage('signature', v))}
          onMessage={setMessage}
        />
      </div>
      <BusinessForm value={profile} onChange={(p) => { setProfile(p); setMessage(null) }} errors={errors} />
      <div className="actions">
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
  )
}

interface PickerProps {
  title: string
  hint: string
  value: string
  options: Parameters<typeof chooseImage>[0]
  onChange: (dataUrl: string | null) => Promise<void>
  onMessage: (m: Message) => void
}

/** A picture box with Upload / Change / Remove. */
export function ImagePicker({ title, hint, value, options, onChange, onMessage }: PickerProps) {
  const [busy, setBusy] = useState(false)
  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    onMessage(null)
    try {
      await f()
    } catch (e) {
      onMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  const upload = () =>
    run(async () => {
      const img = await chooseImage(options)
      if (img) await onChange(img)
    })
  return (
    <div className="image-picker">
      <div className="image-title">{title}</div>
      <button type="button" className={value ? 'image-box' : 'image-box empty'} onClick={upload} disabled={busy} title={`Upload ${title.toLowerCase()}`}>
        {value ? <img src={value} alt={title} /> : <span>{busy ? 'Loading…' : `+ Upload ${title.toLowerCase()}`}</span>}
      </button>
      <div className="row-flex">
        {value && <button type="button" className="btn small" onClick={upload} disabled={busy}>Change</button>}
        {value && <button type="button" className="btn small" onClick={() => run(() => onChange(null))} disabled={busy}>Remove</button>}
      </div>
      <span className="field-hint">{hint}</span>
    </div>
  )
}
