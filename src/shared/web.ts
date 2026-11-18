// The website version: who is signed in, the team of a business, and what the server asks the browser to do
// (download a file, print a page, open a link) in place of the desktop's file windows and printers.
import type { Role } from './auth'

export interface WebUser {
  id: string
  email: string
  name: string
}

export interface WebMe {
  /** Who is signed in, or null. */
  user: WebUser | null
  /** The business they have open, and their role in it (null when none is open). */
  businessId: string | null
  role: Role | null
  /** New people may create an account. */
  signupOpen: boolean
}

export interface TeamMember {
  userId: string
  email: string
  name: string
  role: Role
  addedAt: string
}

export interface NewStaffInput {
  name: string
  email: string
  /** Used only when this email has no account yet. */
  password: string
}

/** Sent back in place of a result when the browser has to do something first. */
export type WebEffect =
  | { __web: 'download'; name: string; mime: string; base64: string; result: unknown }
  | { __web: 'print'; html: string; result: unknown }
  | { __web: 'open'; url: string; result: unknown }

export const isWebEffect = (v: unknown): v is WebEffect =>
  !!v && typeof v === 'object' && typeof (v as { __web?: unknown }).__web === 'string'

/** Every call from the page carries this header; a form or link on another site cannot add it. */
export const CSRF_HEADER = 'x-josh-books'

/** A file chosen in the browser, sent along with the call that needs it. */
export interface UploadedFile {
  name: string
  base64: string
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** A problem with an email address, or ''. */
export function emailProblem(email: string): string {
  if (typeof email !== 'string' || !email.trim()) return 'Enter your email address'
  if (email.length > 254 || !EMAIL.test(email.trim())) return 'Enter a valid email address, like name@example.com'
  return ''
}

export const normEmail = (email: string): string => String(email ?? '').trim().toLowerCase()
