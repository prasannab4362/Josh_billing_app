import type { ReactNode } from 'react'
import { STATES } from '@shared/states'

interface FieldProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
  /** Render as a plain group (not a <label>) when it holds buttons or several controls. */
  group?: boolean
  children: ReactNode
}

export function Field({ label, error, hint, required, group, children }: FieldProps) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className={error ? 'field has-error' : 'field'}>
      <span className="field-label">
        {label}
        {required && <span className="req"> *</span>}
      </span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </Tag>
  )
}

interface TextInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  maxLength?: number
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email'
}

export function TextInput({ value, onChange, ...rest }: TextInputProps) {
  return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
}

export function StateSelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select state…</option>
      {STATES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.code} – {s.name}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Banner({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  return <div className={`banner ${kind}`}>{children}</div>
}

export function TextArea({ value, onChange, rows = 2, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea className="input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

export function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="date" className="input" value={value} onChange={(e) => onChange(e.target.value)} />
}

interface ModalProps {
  title: string
  onClose: () => void
  footer: ReactNode
  children: ReactNode
  wide?: boolean
}

export function Modal({ title, onClose, footer, children, wide }: ModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="chip-x" title="Close" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">{children}</div>
        <footer className="modal-foot">{footer}</footer>
      </div>
    </div>
  )
}
