import type { DB } from '../db/connection'
import { nowIso, uuid } from '../util'

export type AuditAction = 'create' | 'update' | 'delete' | 'restore'

/** Record a change. Call inside the same transaction as the change itself. */
export function audit(db: DB, entity: string, entityId: string, action: AuditAction, before: unknown, after: unknown): void {
  db.prepare(
    `INSERT INTO audit_log (id, at, entity, entity_id, action, before_json, after_json) VALUES (?,?,?,?,?,?,?)`
  ).run(
    uuid(), nowIso(), entity, entityId, action,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after)
  )
}
