import { useState } from 'react'
import { whatsappNumber } from '@shared/share'
import { errorMessage } from '../api'
import { Banner, Modal } from './Field'

interface Props {
  title: string
  phone: string
  initial: string
  /** What happens on Send; returns a note to show (e.g. where the PDF was saved). */
  onSend: (text: string) => Promise<string>
  onClose: () => void
}

/** Check and edit a WhatsApp message, then open WhatsApp with it. Sending happens in WhatsApp itself. */
export function WhatsAppModal({ title, phone, initial, onSend, onClose }: Props) {
  const [text, setText] = useState(initial)
  const [note, setNote] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const number = whatsappNumber(phone)
  const send = async () => {
    setBusy(true)
    setNote(null)
    try {
      setNote({ kind: 'success', text: await onSend(text) })
    } catch (e) {
      setNote({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={send} disabled={busy || !text.trim()}>Open WhatsApp</button>
        </>
      }
    >
      {note && <Banner kind={note.kind}>{note.text}</Banner>}
      <p className="muted small" style={{ marginTop: 0 }}>
        {number ? `To +${number.slice(0, 2)} ${number.slice(2)}.` : 'No mobile number saved: WhatsApp will ask whom to send it to.'}{' '}
        WhatsApp opens with this message typed in; you press Send there.
      </p>
      <textarea className="input" rows={12} value={text} onChange={(e) => setText(e.target.value)} aria-label="WhatsApp message" />
    </Modal>
  )
}
