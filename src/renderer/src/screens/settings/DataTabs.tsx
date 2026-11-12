// Settings tabs for keeping data safe: backups, the recycle bin and the change history.
import { Fragment, useEffect, useState } from 'react'
import { AUDIT_ENTITIES, type AuditEntry, type BackupFile, type BackupInfo, type BinEntry } from '@shared/data'
import type { Business } from '@shared/models'
import { formatINR, formatPercent } from '@shared/money'
import { api, errorMessage } from '../../api'
import { Banner } from '../../components/Field'

type Message = { kind: 'error' | 'success'; text: string } | null

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const size = (bytes: number) => (bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
const KIND_LABEL: Record<BackupFile['kind'], string> = { auto: 'Daily automatic', safety: 'Before a restore', manual: 'Saved copy' }

// ---------- Backup & restore ----------

export function BackupTab({ business, onBusinessChange }: { business: Business; onBusinessChange: (b: Business) => void }) {
  const [files, setFiles] = useState<BackupFile[]>([])
  const [chosen, setChosen] = useState<BackupInfo | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.listBackups().then(setFiles, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  useEffect(() => {
    load()
  }, [business.id])

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await f()
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const backupNow = () =>
    run(async () => {
      const path = await api.backupNow()
      if (path) setMessage({ kind: 'success', text: `Backup saved to ${path}. Keep a copy on a pen drive or in cloud storage too.` })
    })
  const pick = (path?: string) =>
    run(async () => {
      const info = path ? await api.inspectBackup(path) : await api.chooseBackupFile()
      setChosen(info)
    })
  const replace = (info: BackupInfo) =>
    run(async () => {
      const warning = info.sameBusiness ? '' : `\n\nThis backup is of "${info.businessName}", not ${business.name}.`
      if (!window.confirm(`Replace all of ${business.name}'s current data with this backup?${warning}\n\nA copy of the current data is kept first, so this can be undone.`)) return
      const r = await api.restoreBackup(info.path)
      setChosen(null)
      setMessage({ kind: 'success', text: `Restored. The data from before the restore was kept as ${r.safetyCopy.split(/[\\/]/).pop()} (listed below).` })
      onBusinessChange(r.business)
      load()
    })
  const asNew = (info: BackupInfo) =>
    run(async () => {
      const b = await api.importBackup(info.path)
      setChosen(null)
      onBusinessChange(b)
    })

  return (
    <div>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <div className="data-actions">
        <div>
          <h3>Save a backup</h3>
          <p className="muted">One file with everything for {business.name}: bills, parties, stock, payments and settings.</p>
          <button className="btn primary" onClick={backupNow} disabled={busy}>Back up now…</button>
        </div>
        <div>
          <h3>Restore</h3>
          <p className="muted">Bring back data from a backup file, or open it as a separate business.</p>
          <button className="btn" onClick={() => pick()} disabled={busy}>Choose a backup file…</button>
        </div>
      </div>

      {chosen && (
        <div className="restore-box">
          <h3>Backup of {chosen.businessName}</h3>
          <p>
            {chosen.invoices} sale invoices · {chosen.parties} parties
            {chosen.lastEntry && ` · last bill change ${when(chosen.lastEntry)}`} · file from {when(chosen.modifiedAt)}
          </p>
          {!chosen.sameBusiness && <Banner kind="error">This backup is of a different business. Opening it as a separate business is usually what you want.</Banner>}
          <div className="row-flex">
            <button className="btn primary" onClick={() => replace(chosen)} disabled={busy}>Replace {business.name}'s data</button>
            <button className="btn" onClick={() => asNew(chosen)} disabled={busy}>Open as a separate business</button>
            <button className="btn" onClick={() => setChosen(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      <div className="row-flex" style={{ marginTop: 20 }}>
        <h3 style={{ margin: 0 }}>Backups on this computer</h3>
        <span className="spacer" />
        <button className="btn small" onClick={() => api.openBackupFolder()}>Open folder</button>
      </div>
      <p className="muted">A copy is taken automatically each day you open this business; the last 7 are kept.</p>
      <table className="table">
        <thead>
          <tr><th>Taken</th><th>Kind</th><th className="amount">Size</th><th /></tr>
        </thead>
        <tbody>
          {files.length === 0 && <tr><td colSpan={4} className="muted">No backups yet. Today's copy is taken a moment after the business opens.</td></tr>}
          {files.map((f) => (
            <tr key={f.path}>
              <td>{when(f.modifiedAt)}</td>
              <td>{KIND_LABEL[f.kind]}</td>
              <td className="amount">{size(f.size)}</td>
              <td className="amount"><button className="btn small" onClick={() => pick(f.path)} disabled={busy}>Restore…</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Recycle bin ----------

export function RecycleBinTab() {
  const [entries, setEntries] = useState<BinEntry[] | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => api.listBin().then(setEntries, (e) => setMessage({ kind: 'error', text: errorMessage(e) }))
  useEffect(() => {
    load()
  }, [])

  const restore = async (e: BinEntry) => {
    setBusy(e.id)
    setMessage(null)
    try {
      await api.restoreFromBin(e.kind, e.id)
      setMessage({ kind: 'success', text: `${e.what} ${e.title} restored` })
      load()
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Deleted bills, payments, expenses, parties and items stay here. Restoring puts back their stock, balances and
        money exactly as before.
      </p>
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      <table className="table">
        <thead>
          <tr><th>Deleted</th><th>What</th><th>Number / name</th><th>Party / details</th><th>Date</th><th className="amount">Amount</th><th /></tr>
        </thead>
        <tbody>
          {entries?.length === 0 && <tr><td colSpan={7} className="empty">The recycle bin is empty.</td></tr>}
          {entries?.map((e) => (
            <tr key={`${e.kind}-${e.id}`}>
              <td className="nowrap">{when(e.deletedAt)}</td>
              <td>{e.what}</td>
              <td>{e.title}</td>
              <td>{e.detail || '—'}</td>
              <td className="nowrap">{e.date}</td>
              <td className="amount">{e.amount !== null ? formatINR(e.amount) : '—'}</td>
              <td className="amount"><button className="btn small" onClick={() => restore(e)} disabled={busy !== null}>{busy === e.id ? 'Restoring…' : 'Restore'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Change history ----------

const ACTION_LABEL: Record<AuditEntry['action'], string> = { create: 'Created', update: 'Edited', delete: 'Deleted', restore: 'Restored' }
const MONEY = new Set([
  'amount', 'grandTotal', 'paidAmount', 'balanceDue', 'subtotal', 'taxableTotal', 'cgst', 'sgst', 'igst', 'cess', 'total',
  'openingBalance', 'salePrice', 'purchasePrice', 'mrp', 'wholesalePrice', 'creditLimit', 'rate', 'openingRate', 'roundOff',
  'discountTotal', 'chargesTotal', 'balance', 'stockValue', 'tax'
])
const SKIP = new Set(['id', 'createdAt', 'updatedAt', 'links', 'hasTransactions'])

const fieldName = (k: string) => k.replace(/Bp$/, '').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())

function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return MONEY.has(key) ? formatINR(v) : /Bp$/.test(key) ? formatPercent(v) : String(v)
  if (Array.isArray(v)) return `${v.length} ${key === 'lines' ? 'line' : 'entry'}${v.length === 1 ? '' : key === 'lines' ? 's' : 's'}`
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.amount === 'number') return formatINR(o.amount)
    if (typeof o.name === 'string') return o.name
    return JSON.stringify(v).slice(0, 80)
  }
  return String(v)
}

/** Fields whose value differs between before and after. */
function changes(e: AuditEntry): { key: string; before: string; after: string }[] {
  // Internal ids mean nothing to a reader; the names that go with them are recorded alongside.
  const keys = [...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])].filter((k) => !SKIP.has(k) && !/Id$/.test(k))
  const rows = []
  for (const k of keys) {
    const a = e.before?.[k]
    const b = e.after?.[k]
    if (e.before && e.after && JSON.stringify(a) === JSON.stringify(b)) continue
    // Inputs and saved records name a few things differently; compare what is shown.
    const before = e.before ? show(k, a) : ''
    const after = e.after ? show(k, b) : ''
    if (e.before && e.after && before === after) continue
    rows.push({ key: k, before, after })
  }
  return rows
}

export function HistoryTab() {
  const [entity, setEntity] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      api.listAudit({ entity: entity || undefined, search: search || undefined, from: from || undefined, to: to || undefined }).then(
        (l) => { setEntries(l); setError(null) },
        (e) => setError(errorMessage(e))
      )
    }, 200)
    return () => clearTimeout(t)
  }, [entity, search, from, to])

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>Every change made in this business, newest first. Click an entry to see what changed.</p>
      <div className="toolbar">
        <input className="input search" placeholder="Search number, name or value" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">Everything</option>
          {AUDIT_ENTITIES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <input type="date" className="input" value={from} aria-label="From" onChange={(e) => setFrom(e.target.value)} />
        <span className="muted">to</span>
        <input type="date" className="input" value={to} aria-label="To" onChange={(e) => setTo(e.target.value)} />
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      <table className="table">
        <thead>
          <tr><th>When</th><th>Change</th><th>Record</th></tr>
        </thead>
        <tbody>
          {entries.length === 0 && <tr><td colSpan={3} className="empty">No changes match.</td></tr>}
          {entries.map((e) => (
            <Fragment key={e.id}>
              <tr className={open === e.id ? 'clickable selected' : 'clickable'} onClick={() => setOpen(open === e.id ? null : e.id)}>
                <td className="nowrap">{when(e.at)}</td>
                <td><span className={`audit-action ${e.action}`}>{ACTION_LABEL[e.action]}</span></td>
                <td>{e.label}</td>
              </tr>
              {open === e.id && (
                <tr className="audit-detail">
                  <td colSpan={3}>
                    <ChangeTable entry={e} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {entries.length >= 500 && <p className="muted">Showing the latest 500. Narrow the dates or search to see older changes.</p>}
    </div>
  )
}

function ChangeTable({ entry }: { entry: AuditEntry }) {
  const rows = changes(entry)
  if (rows.length === 0) return <span className="muted">No field-level details recorded.</span>
  const both = !!entry.before && !!entry.after
  return (
    <table className="table compact">
      <thead>
        <tr><th>Field</th>{entry.before && <th>{both ? 'Before' : 'Value'}</th>}{entry.after && <th>{both ? 'After' : 'Value'}</th>}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="muted">{fieldName(r.key)}</td>
            {entry.before && <td className={both ? 'was' : ''}>{r.before}</td>}
            {entry.after && <td>{r.after}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
