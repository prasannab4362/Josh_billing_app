import { useState } from 'react'
import { IMPORT_COLUMNS, type ImportKind, type ImportPreview, type ImportResult } from '@shared/imports'
import { api, errorMessage } from '../api'
import { Banner, Modal } from './Field'

interface Props {
  kind: ImportKind
  onClose: () => void
  /** Something was imported; reload the list. */
  onImported: () => void
}

const WORD: Record<ImportKind, [string, string]> = { items: ['item', 'items'], parties: ['party', 'parties'] }
const plural = (n: number, kind: ImportKind) => `${n} ${WORD[kind][n === 1 ? 0 : 1]}`

/** Import items or parties from Excel or CSV: get the template, choose a file, check it, then save. */
export function ImportModal({ kind, onClose, onImported }: Props) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

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
  const template = () =>
    run(async () => {
      const path = await api.saveImportTemplate(kind)
      if (path) setMessage({ kind: 'success', text: `Template saved: ${path}` })
    })
  const choose = () =>
    run(async () => {
      const p = await api.chooseImportFile(kind)
      if (!p) return
      setPreview(p)
      setResult(null)
      setOnlyProblems(p.errors > 0 && p.creates + p.updates === 0)
    })
  const commit = () =>
    run(async () => {
      if (!preview) return
      const r = await api.commitImport(preview.token)
      setResult(r)
      setPreview(null)
      onImported()
    })

  const ready = preview ? preview.creates + preview.updates : 0
  const rows = preview ? preview.rows.filter((r) => (onlyProblems ? r.action === 'error' : r.action !== 'update' || r.changes.length)) : []
  const unchanged = preview ? preview.rows.filter((r) => r.action === 'update' && !r.changes.length).length : 0
  const title = kind === 'items' ? 'Import items from Excel' : 'Import parties from Excel'

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {preview && <button className="btn" style={{ marginRight: 'auto' }} onClick={choose} disabled={busy}>Choose another file</button>}
          <button className="btn" onClick={onClose}>{result ? 'Done' : 'Cancel'}</button>
          {preview && (
            <button className="btn primary" onClick={commit} disabled={busy || ready === 0}>
              {ready === 0 ? 'Nothing to import' : `Import ${plural(ready, kind)}`}
            </button>
          )}
        </>
      }
    >
      {message && <Banner kind={message.kind}>{message.text}</Banner>}
      {result && (
        <Banner kind="success">
          Imported: {result.created} added, {result.updated} updated{result.skipped ? `, ${result.skipped} rows skipped` : ''}.
        </Banner>
      )}

      {!preview && (
        <div className="import-steps">
          <div className="import-step">
            <div className="step-no">1</div>
            <div>
              <h3>Get the template</h3>
              <p className="muted">An Excel file with the right columns, two example rows and a sheet explaining each column. Your own file works too if its headings match.</p>
              <button className="btn" onClick={template} disabled={busy}>Download template</button>
            </div>
          </div>
          <div className="import-step">
            <div className="step-no">2</div>
            <div>
              <h3>Fill it in and choose it</h3>
              <p className="muted">
                Excel (.xlsx) or CSV. Rows whose name matches an existing {WORD[kind][0]} update it; others are added.
                Nothing is saved until you check the rows and press Import.
              </p>
              <button className="btn primary" onClick={choose} disabled={busy}>Choose file…</button>
            </div>
          </div>
          <details className="import-columns">
            <summary>Columns it understands</summary>
            <ul>
              {IMPORT_COLUMNS[kind].map((c) => (
                <li key={c.key}><b>{c.title}{c.required ? ' *' : ''}</b>: {c.hint}</li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {preview && (
        <>
          <div className="import-summary">
            <span className="file mono">{preview.fileName}</span>
            <span className="pill ok">{preview.creates} new</span>
            <span className="pill info">{preview.updates} to update</span>
            {unchanged > 0 && <span className="pill">{unchanged} unchanged</span>}
            <span className={preview.errors ? 'pill bad' : 'pill'}>{preview.errors} with problems</span>
            <label className="row-flex" style={{ marginLeft: 'auto', gap: 6 }}>
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only rows with problems
            </label>
          </div>
          <p className="muted small">
            Columns read: {preview.columns.join(', ')}.
            {preview.ignored.length > 0 && <> Not understood, ignored: {preview.ignored.join(', ')}.</>}
            {preview.errors > 0 && ' Rows with problems are skipped; fix them in the file and choose it again, or import the rest now.'}
          </p>
          <div className="import-rows">
            <table className="table compact">
              <thead><tr><th>Row</th><th>Name</th><th>Will</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className={r.action === 'error' ? 'row-bad' : ''}>
                    <td className="mono">{r.row}</td>
                    <td>{r.name}</td>
                    <td>
                      <span className={`pill ${r.action === 'create' ? 'ok' : r.action === 'update' ? 'info' : 'bad'}`}>
                        {r.action === 'create' ? 'Add' : r.action === 'update' ? 'Update' : 'Skip'}
                      </span>
                    </td>
                    <td className="small">{r.action === 'error' ? r.errors.join('; ') : r.changes.join('; ')}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="muted">No rows to show.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}
