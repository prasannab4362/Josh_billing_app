import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkLogin, createUser, IDLE_MS, MAX_AGE_MS, openAccounts, resetPassword, sessionUser, startSession, type AccountsDB
} from './accounts'

let db: AccountsDB
beforeEach(() => {
  db = openAccounts(':memory:')
})
afterEach(() => db.close())

describe('website accounts', () => {
  it('keep only a hash of the sign-in token, and end sign-ins left unused or too old', () => {
    const u = createUser(db, { name: 'Test One', email: 'one@example.test', password: 'Valid-pass-123' })
    const t0 = 1_800_000_000_000
    const token = startSession(db, u.id, t0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM web_session WHERE token_hash = ?').get(token)).toEqual({ n: 0 })
    expect(sessionUser(db, token, t0 + 1000)?.user.email).toBe('one@example.test')
    expect(sessionUser(db, 'made-up-token', t0)).toBeNull()
    // Unused for longer than the idle time: gone.
    expect(sessionUser(db, token, t0 + IDLE_MS + 5000)).toBeNull()
    // Used every day still ends at the most age.
    const t2 = startSession(db, u.id, t0)
    let at = t0
    while (at < t0 + MAX_AGE_MS - IDLE_MS / 2) {
      at += IDLE_MS / 2
      expect(sessionUser(db, t2, at)).not.toBeNull()
    }
    expect(sessionUser(db, t2, t0 + MAX_AGE_MS + 1)).toBeNull()
  })

  it('let the operator reset a forgotten password, which signs the person out everywhere', () => {
    const u = createUser(db, { name: 'Test Two', email: 'two@example.test', password: 'Valid-pass-123' })
    const token = startSession(db, u.id)
    expect(() => resetPassword(db, 'two@example.test', 'short')).toThrow(/8 characters/)
    expect(() => resetPassword(db, 'nobody@example.test', 'Another-pass-1')).toThrow(/No account/)
    resetPassword(db, 'TWO@example.test', 'Another-pass-1')
    expect(sessionUser(db, token)).toBeNull()
    expect(() => checkLogin(db, 'two@example.test', 'Valid-pass-123')).toThrow(/Wrong/)
    expect(checkLogin(db, 'two@example.test', 'Another-pass-1').id).toBe(u.id)
  })
})
