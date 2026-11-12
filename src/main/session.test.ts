import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_TEST_PROFILE } from '@shared/testFixtures'
import { Session } from './session'

const profile = (name: string) => ({ ...EMPTY_TEST_PROFILE, name, stateCode: '27' })
let dir: string
let session: Session

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'billing-session-'))
  session = new Session(dir)
})
afterEach(() => {
  session.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Session', () => {
  it('creates a business in its own file and opens it', () => {
    const b = session.create({ profile: profile('Shop A'), preferences: {} })
    expect(session.current()?.id).toBe(b.id)
    expect(existsSync(join(dir, 'businesses', `${b.id}.db`))).toBe(true)
    expect(session.registry.list().map((x) => x.name)).toEqual(['Shop A'])
  })

  it('switches between businesses and remembers the last one', () => {
    const a = session.create({ profile: profile('Shop A'), preferences: {} })
    const b = session.create({ profile: profile('Shop B'), preferences: {} })
    expect(session.current()?.name).toBe('Shop B')
    session.open(a.id)
    expect(session.current()?.name).toBe('Shop A')
    session.close()

    const restarted = new Session(dir)
    expect(restarted.restoreLast()?.id).toBe(a.id)
    restarted.close()
    expect(b.id).not.toBe(a.id)
  })

  it('leaves no file behind when creation fails', () => {
    expect(() => session.create({ profile: profile(''), preferences: {} })).toThrow()
    expect(readdirSync(join(dir, 'businesses'))).toEqual([])
    expect(session.registry.list()).toEqual([])
  })

  it('keeps the registry name in step with profile edits', () => {
    const b = session.create({ profile: profile('Shop A'), preferences: {} })
    session.syncName({ ...b, name: 'Shop A Renamed' })
    expect(new Session(dir).registry.get(b.id)?.name).toBe('Shop A Renamed')
  })

  it('reports a missing file clearly', () => {
    const b = session.create({ profile: profile('Shop A'), preferences: {} })
    session.close()
    for (const s of ['', '-wal', '-shm']) rmSync(join(dir, 'businesses', `${b.id}.db${s}`), { force: true })
    expect(() => session.open(b.id)).toThrow(/missing/)
    expect(new Session(dir).restoreLast()).toBeNull()
  })
})
