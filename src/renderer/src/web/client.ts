// The app's API in a web browser: each call is a POST to the website's server. What the desktop does with its own
// windows (save a file, print, open a link, choose a file) is done here by the browser.
import { API_METHODS, type BillingApi } from '@shared/ipc'
import type { NewStaffInput, TeamMember, UploadedFile, WebMe, WebUser } from '@shared/web'
import { CSRF_HEADER, isWebEffect, MAX_UPLOAD_BYTES, type WebEffect } from '@shared/web'

/** True when the app runs as a website (there is no desktop bridge). */
export const isWeb = typeof window !== 'undefined' && !(window as { api?: unknown }).api

const listeners = new Set<() => void>()
/** Called when the server says the sign-in has ended (so the sign-in page can show). */
export function onSignedOut(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

async function post(path: string, body: unknown): Promise<unknown> {
  let r: Response
  try {
    r = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', [CSRF_HEADER]: '1' },
      body: JSON.stringify(body)
    })
  } catch {
    throw new Error('Could not reach the server. Check the internet connection and try again.')
  }
  let data: { value?: unknown; error?: string; signIn?: boolean } = {}
  try {
    data = await r.json()
  } catch {
    // not JSON (a proxy error page, for example)
  }
  if (!r.ok) {
    if (r.status === 401) listeners.forEach((fn) => fn())
    throw new Error(data.error || `The server could not do that (${r.status}). Please try again.`)
  }
  return data
}

function run(effect: WebEffect): unknown {
  if (effect.__web === 'download') {
    const bytes = Uint8Array.from(atob(effect.base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: effect.mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = effect.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } else if (effect.__web === 'print') {
    printHtml(effect.html)
  } else if (effect.__web === 'open') {
    window.open(effect.url, '_blank', 'noopener,noreferrer')
  }
  return effect.result
}

/** Print a page through a hidden frame; the browser's print window also offers "Save as PDF". */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  frame.onload = () => {
    const w = frame.contentWindow
    if (!w) return
    // Let pictures load before printing.
    setTimeout(() => {
      w.focus()
      w.print()
      setTimeout(() => frame.remove(), 60_000)
    }, 300)
  }
  frame.srcdoc = html
  document.body.appendChild(frame)
}

async function call(method: string, args: unknown[], file?: UploadedFile): Promise<unknown> {
  const data = (await post(`/api/${method}`, { args, file })) as { value?: unknown }
  const value = data.value ?? null
  return isWebEffect(value) ? run(value) : value
}

/** Ask the person to choose a file; null when they cancel. */
export function pickFile(accept: string): Promise<UploadedFile | null> {
  return new Promise((done, fail) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let settled = false
    const finish = (v: UploadedFile | null) => {
      if (settled) return
      settled = true
      input.remove()
      done(v)
    }
    input.addEventListener('cancel', () => finish(null))
    input.addEventListener('change', () => {
      const f = input.files?.[0]
      if (!f) return finish(null)
      if (f.size > MAX_UPLOAD_BYTES) {
        settled = true
        input.remove()
        return fail(new Error('That file is too large (over 50 MB)'))
      }
      const reader = new FileReader()
      reader.onload = () => finish({ name: f.name, base64: String(reader.result).split(',')[1] ?? '' })
      reader.onerror = () => {
        settled = true
        fail(new Error('That file could not be read'))
      }
      reader.readAsDataURL(f)
    })
    document.body.appendChild(input)
    input.click()
  })
}

function makeApi(): BillingApi {
  const api = Object.fromEntries(API_METHODS.map((name) => [name, (...args: unknown[]) => call(name, args)])) as Record<string, unknown>
  api.chooseImportFile = async (kind: string) => {
    const file = await pickFile('.xlsx,.csv,.xls')
    return file ? call('uploadImportFile', [kind], file) : null
  }
  api.chooseBackupFile = async () => {
    const file = await pickFile('.db')
    return file ? call('uploadBackupFile', [], file) : null
  }
  return api as unknown as BillingApi
}

export const webApi: BillingApi | null = isWeb ? makeApi() : null

// ---------- Accounts ----------

export async function getMe(): Promise<WebMe> {
  const r = await fetch('/auth/me', { credentials: 'same-origin', headers: { [CSRF_HEADER]: '1' } })
  if (!r.ok) throw new Error('Could not reach the server')
  return r.json()
}

export const signIn = async (email: string, password: string) => ((await post('/auth/login', { email, password })) as { user: WebUser }).user
export const signUp = async (name: string, email: string, password: string) =>
  ((await post('/auth/signup', { name, email, password })) as { user: WebUser }).user
export const signOut = async () => {
  await post('/auth/logout', {})
}
export const listTeam = async () => (await post('/auth/team', {})) as TeamMember[]
export const addStaff = async (input: NewStaffInput) => (await post('/auth/team/add', input)) as TeamMember
export const removeStaff = async (userId: string) => {
  await post('/auth/team/remove', { userId })
}
