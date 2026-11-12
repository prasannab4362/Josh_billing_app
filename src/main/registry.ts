// The list of businesses on this computer. Each business is its own database file.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BusinessSummary } from '@shared/models'
import { nowIso } from './util'

interface RegistryFile {
  version: 1
  lastOpenedId: string | null
  businesses: BusinessSummary[]
}

export class BusinessRegistry {
  readonly dir: string
  private readonly file: string
  private data: RegistryFile

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'businesses')
    this.file = join(baseDir, 'registry.json')
    mkdirSync(this.dir, { recursive: true })
    this.data = this.load()
  }

  private load(): RegistryFile {
    if (!existsSync(this.file)) return { version: 1, lastOpenedId: null, businesses: [] }
    const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as RegistryFile
    return { version: 1, lastOpenedId: parsed.lastOpenedId ?? null, businesses: parsed.businesses ?? [] }
  }

  private save(): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  list(): BusinessSummary[] {
    return [...this.data.businesses].sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))
  }

  get(id: string): BusinessSummary | undefined {
    return this.data.businesses.find((b) => b.id === id)
  }

  get lastOpenedId(): string | null {
    return this.data.lastOpenedId
  }

  pathFor(id: string): string {
    return join(this.dir, `${id}.db`)
  }

  add(id: string, name: string): BusinessSummary {
    const entry: BusinessSummary = { id, name, file: `${id}.db`, createdAt: nowIso(), lastOpenedAt: null }
    this.data.businesses.push(entry)
    this.save()
    return entry
  }

  markOpened(id: string): void {
    const entry = this.get(id)
    if (!entry) throw new Error(`Unknown business ${id}`)
    entry.lastOpenedAt = nowIso()
    this.data.lastOpenedId = id
    this.save()
  }

  rename(id: string, name: string): void {
    const entry = this.get(id)
    if (entry && entry.name !== name) {
      entry.name = name
      this.save()
    }
  }

  remove(id: string): void {
    this.data.businesses = this.data.businesses.filter((b) => b.id !== id)
    if (this.data.lastOpenedId === id) this.data.lastOpenedId = null
    this.save()
  }
}
