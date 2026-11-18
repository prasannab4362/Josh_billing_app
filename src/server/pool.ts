// The business files the website has open. Each business belongs to one owner and lives in the owner's folder
// (data/owners/<owner id>/), set out exactly as on the desktop, so its backups and restore work the same way.
// One Session (one open file) per business, shared by everyone signed in to it; the least used are closed.
import { join } from 'node:path'
import type { Business, CreateBusinessInput } from '@shared/models'
import { Session } from '../main/session'
import { UserError } from '../main/util'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export class BusinessPool {
  private readonly open = new Map<string, Session>()

  constructor(private readonly dataDir: string, private readonly max = 50) {}

  ownerDir(ownerId: string): string {
    if (!ID.test(ownerId)) throw new UserError('Unknown account')
    return join(this.dataDir, 'owners', ownerId)
  }

  private keep(id: string, s: Session): void {
    this.open.delete(id)
    this.open.set(id, s)
    while (this.open.size > this.max) {
      const [oldId, old] = this.open.entries().next().value as [string, Session]
      this.open.delete(oldId)
      old.close()
    }
  }

  /** The open session of a business, opening its file if needed. */
  get(businessId: string, ownerId: string): Session {
    const s = this.open.get(businessId)
    if (s?.isOpen) {
      this.keep(businessId, s)
      return s
    }
    if (!ID.test(businessId)) throw new UserError('That business was not found')
    const fresh = new Session(this.ownerDir(ownerId))
    fresh.open(businessId)
    this.keep(businessId, fresh)
    return fresh
  }

  create(ownerId: string, input: CreateBusinessInput): Business {
    const s = new Session(this.ownerDir(ownerId))
    const b = s.create(input)
    this.keep(b.id, s)
    return b
  }

  /** A backup file brought in as a new business of this owner. */
  importBackup(ownerId: string, path: string): Business {
    const s = new Session(this.ownerDir(ownerId))
    const b = s.importBackup(path)
    this.keep(b.id, s)
    return b
  }

  /** Read what a backup file holds, for this owner (nothing is opened or changed). */
  inspect(ownerId: string, path: string) {
    return new Session(this.ownerDir(ownerId)).inspectBackup(path)
  }

  sessions(): Session[] {
    return [...this.open.values()]
  }

  closeAll(): void {
    for (const s of this.open.values()) s.close()
    this.open.clear()
  }
}
