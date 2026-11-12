import { useState } from 'react'
import type { Business, BusinessSummary } from '@shared/models'
import { api, errorMessage } from '../api'
import { Banner } from '../components/Field'

interface Props {
  businesses: BusinessSummary[]
  onOpened: (b: Business) => void
  onCreate: () => void
}

export function Welcome({ businesses, onOpened, onCreate }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const open = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      onOpened(await api.openBusiness(id))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  // A backup from another computer opens as its own business; nothing here is replaced.
  const openBackup = async () => {
    setError(null)
    try {
      const info = await api.chooseBackupFile()
      if (!info) return
      if (!window.confirm(`Open the backup of ${info.businessName} (${info.invoices} invoices, ${info.parties} parties) as a business on this computer?`)) return
      setBusy('backup')
      onOpened(await api.importBackup(info.path))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="center-page">
      <div className="welcome">
        <h1>Billing App</h1>
        <p className="muted">GST billing, stock and accounts — works fully offline.</p>
        {error && <Banner kind="error">{error}</Banner>}

        {businesses.length > 0 && (
          <>
            <h2>Your businesses</h2>
            <ul className="business-list">
              {businesses.map((b) => (
                <li key={b.id}>
                  <button className="business-item" onClick={() => open(b.id)} disabled={busy !== null}>
                    <span className="avatar">{b.name.slice(0, 1).toUpperCase()}</span>
                    <span>
                      <strong>{b.name}</strong>
                      <small className="muted">
                        {b.lastOpenedAt ? `Last opened ${new Date(b.lastOpenedAt).toLocaleDateString('en-IN')}` : 'Never opened'}
                      </small>
                    </span>
                    <span className="muted">{busy === b.id ? 'Opening…' : 'Open →'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <button className="btn primary big" onClick={onCreate}>
          + Create a new business
        </button>
        <button className="btn big" style={{ marginTop: 8 }} onClick={openBackup} disabled={busy !== null}>
          {busy === 'backup' ? 'Opening backup…' : 'Open a backup file…'}
        </button>
        <p className="muted small-note">Moving to a new computer? Open a backup saved from Settings › Backup &amp; restore.</p>
      </div>
    </div>
  )
}
