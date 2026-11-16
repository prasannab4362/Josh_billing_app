import { useState } from 'react'
import { SHARE_CHANNELS, whatsappNumber, type ShareChannel } from '@shared/share'
import { errorMessage } from '../api'
import { Banner, Modal } from './Field'

interface Props {
  channel: ShareChannel
  /** Phone (WhatsApp, text message) or email address (Gmail, mail app) to send to. */
  to: string
  subject: string
  text: string
  onSend: (r: { to: string; subject: string; text: string }) => Promise<string>
  onClose: () => void
}

const HOW: Record<ShareChannel, string> = {
  whatsapp: 'WhatsApp opens with this message typed in. The PDF is saved and its folder opens: drag it into the chat, then press Send.',
  gmail: 'Gmail opens in your browser with this email filled in. The PDF is saved and its folder opens: drag it into the email to attach it.',
  email: 'Your mail app (Outlook, Mail…) opens with this email filled in. The PDF is saved and its folder opens: attach it, then send.',
  sms: 'Your phone-linking app (such as Phone Link) opens with this text. A text message cannot carry the PDF.'
}

/** Check the message for one way of sharing a bill, then open that app. Sending happens in the app itself. */
export function ShareModal({ channel, to: initialTo, subject: initialSubject, text: initialText, onSend, onClose }: Props) {
  const [to, setTo] = useState(initialTo)
  const [subject, setSubject] = useState(initialSubject)
  const [text, setText] = useState(initialText)
  const [note, setNote] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const email = channel === 'gmail' || channel === 'email'
  const phoneOk = !to.trim() || !!whatsappNumber(to)

  const send = async () => {
    setBusy(true)
    setNote(null)
    try {
      setNote({ kind: 'success', text: await onSend({ to, subject, text }) })
    } catch (e) {
      setNote({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`Send by ${SHARE_CHANNELS[channel]}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={send} disabled={busy || !text.trim() || (!email && !phoneOk)}>Open {SHARE_CHANNELS[channel]}</button>
        </>
      }
    >
      {note && <Banner kind={note.kind}>{note.text}</Banner>}
      <p className="muted small" style={{ marginTop: 0 }}>{HOW[channel]}</p>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">{email ? 'Email to' : 'Mobile number'}</span>
          <input className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label={email ? 'Email to' : 'Mobile number'}
            placeholder={email ? 'name@example.com (or leave blank)' : '10-digit mobile (or leave blank)'} />
          {!email && !phoneOk && <span className="field-error">Enter a 10-digit mobile number</span>}
        </label>
        {email && (
          <label className="field">
            <span className="field-label">Subject</span>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
          </label>
        )}
      </div>
      <textarea className="input" rows={channel === 'sms' ? 4 : 11} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
    </Modal>
  )
}
