import type { DB } from '../db/connection'
import { nowIso, uuid } from '../util'

export type AuditAction = 'create' | 'update' | 'delete' | 'restore'

/** Who is making changes in each open business file (null when logins are off). */
const actors = new WeakMap<DB, string | null>()

/** Set the signed-in user whose changes are recorded from now on. */
export function setAuditUser(db: DB, userId: string | null): void {
  actors.set(db, userId)
}

/** Record a change, and who made it. Call inside the same transaction as the change itself. */
export function audit(db: DB, entity: string, entityId: string, action: AuditAction, before: unknown, after: unknown): void {
  db.prepare(
    `INSERT INTO audit_log (id, at, user_id, entity, entity_id, action, before_json, after_json) VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    uuid(), nowIso(), actors.get(db) ?? null, entity, entityId, action,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after)
  )
}
