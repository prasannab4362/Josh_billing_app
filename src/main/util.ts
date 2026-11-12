import { randomUUID } from 'node:crypto'

export const uuid = (): string => randomUUID()
export const nowIso = (): string => new Date().toISOString()

/** An error whose message is safe to show the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

export const toBool = (v: unknown): boolean => v === 1 || v === true
export const toInt = (v: boolean): number => (v ? 1 : 0)
