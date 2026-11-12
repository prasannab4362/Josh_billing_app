// Reading the change history. Every create, edit, delete and restore is written to audit_log in the same
// transaction as the change itself; this only reads it back with a readable name for each record.
import { BILL_INFO, type BillType } from '@shared/billTypes'
import type { AuditEntry, AuditFilter } from '@shared/data'
import type { DB } from '../db/connection'

interface Row {
  id: string
  at: string
  entity: string
  entity_id: string
  action: AuditEntry['action']
  before_json: string | null
  after_json: string | null
  doc_type: string | null
  doc_number: string | null
  category: string | null
  party_name: string | null
  item_name: string | null
  pay_number: string | null
  pay_direction: string | null
  account_name: string | null
  adj_item: string | null
}

const parse = (json: string | null): Record<string, unknown> | null => {
  if (!json) return null
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v }
  } catch {
    return null
  }
}

function label(r: Row): string {
  switch (r.entity) {
    case 'document': {
      const t = r.doc_type as BillType | null
      return `${t && BILL_INFO[t] ? BILL_INFO[t].noun : 'Bill'} ${r.doc_number ?? ''}`.trim()
    }
    case 'expense': return `Expense ${r.category ?? ''}`.trim()
    case 'payment': return `${r.pay_direction === 'out' ? 'Payment made' : 'Payment received'} ${r.pay_number ?? ''}`.trim()
    case 'party': return `Party ${r.party_name ?? ''}`.trim()
    case 'item': return `Item ${r.item_name ?? ''}`.trim()
    case 'bank_account': return `Account ${r.account_name ?? ''}`.trim()
    case 'account_transfer': return 'Transfer'
    case 'stock_adjustment': return `Stock adjustment ${r.adj_item ?? ''}`.trim()
    default: return r.entity
  }
}

/** Newest first, at most `limit` entries. */
export function listAudit(db: DB, filter: AuditFilter = {}, limit = 500): AuditEntry[] {
  const rows = db
    .prepare(
      `SELECT a.*, d.doc_type, d.number AS doc_number, d.category, p.name AS party_name, i.name AS item_name,
              y.number AS pay_number, y.direction AS pay_direction, b.name AS account_name, ai.name AS adj_item
       FROM audit_log a
       LEFT JOIN document d ON a.entity IN ('document', 'expense') AND d.id = a.entity_id
       LEFT JOIN party p ON a.entity = 'party' AND p.id = a.entity_id
       LEFT JOIN item i ON a.entity = 'item' AND i.id = a.entity_id
       LEFT JOIN payment y ON a.entity = 'payment' AND y.id = a.entity_id
       LEFT JOIN bank_account b ON a.entity = 'bank_account' AND b.id = a.entity_id
       LEFT JOIN stock_adjustment s ON a.entity = 'stock_adjustment' AND s.id = a.entity_id
       LEFT JOIN item ai ON ai.id = s.item_id
       WHERE (@from IS NULL OR substr(a.at, 1, 10) >= @from) AND (@to IS NULL OR substr(a.at, 1, 10) <= @to)
         AND (@entity IS NULL OR a.entity = @entity) AND (@entityId IS NULL OR a.entity_id = @entityId)
       ORDER BY a.at DESC, a.rowid DESC`
    )
    .all({ from: filter.from || null, to: filter.to || null, entity: filter.entity || null, entityId: filter.entityId || null }) as Row[]

  const q = filter.search?.trim().toLowerCase() ?? ''
  const out: AuditEntry[] = []
  for (const r of rows) {
    const entry: AuditEntry = {
      id: r.id, at: r.at, entity: r.entity, entityId: r.entity_id, action: r.action, label: label(r),
      before: parse(r.before_json), after: parse(r.after_json)
    }
    if (q && !entry.label.toLowerCase().includes(q) && !(r.before_json ?? '').toLowerCase().includes(q) && !(r.after_json ?? '').toLowerCase().includes(q)) continue
    out.push(entry)
    if (out.length >= limit) break
  }
  return out
}
