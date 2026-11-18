// The website's HTTP server: the app's pages, sign-up and sign-in, and one POST endpoint per API call.
// Run it behind HTTPS (see docs/WEBSITE.md); it sets secure cookies when the request came over HTTPS.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { API_METHODS } from '@shared/ipc'
import { CSRF_HEADER, MAX_UPLOAD_BYTES, type NewStaffInput, type UploadedFile, type WebMe } from '@shared/web'
import { checkRole } from '../main/access'
import { setAuditUser } from '../main/services/audit'
import { UserError } from '../main/util'
import {
  addStaff, checkLogin, createUser, endSession, removeStaff, roleIn, sessionUser, setSessionBusiness, startSession, team, userCount,
  type AccountsDB, type SessionInfo
} from './accounts'
import { FileTokens, NO_BUSINESS, webHandlers, type WebCtx } from './handlers'
import { BusinessPool } from './pool'

export interface WebOptions {
  accounts: AccountsDB
  dataDir: string
  /** The built screens (out/renderer). */
  staticDir: string
  /** Anyone may create an account (otherwise only the very first one). */
  signupOpen: boolean
  /** Behind a proxy that sets X-Forwarded-Proto / X-Forwarded-For. */
  trustProxy: boolean
  version: string
}

const COOKIE = 'jb_session'
const API = new Set<string>([...API_METHODS, 'uploadImportFile', 'uploadBackupFile'])
const SMALL_BODY = 16 * 1024
const BIG_BODY = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 64 * 1024

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json'
}

const CSP = [
  "default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "object-src 'none'", "base-uri 'none'",
  "form-action 'self'", "frame-ancestors 'none'"
].join('; ')

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Wrong sign-ins from one address, so guessing across many accounts is slowed too. */
class Throttle {
  private readonly hits = new Map<string, number[]>()
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  check(key: string, now = Date.now()): void {
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs)
    if (list.length >= this.limit) throw new HttpError(429, 'Too many tries from this network. Wait a few minutes and try again.')
    list.push(now)
    this.hits.set(key, list)
    if (this.hits.size > 10_000) this.hits.clear()
  }
}

export function createWebServer(o: WebOptions): { server: Server; pool: BusinessPool } {
  const pool = new BusinessPool(o.dataDir)
  const files = new FileTokens(join(o.dataDir, 'uploads'))
  const loginThrottle = new Throttle(30, 15 * 60_000)
  const signupThrottle = new Throttle(10, 60 * 60_000)
  const staticRoot = resolve(o.staticDir)

  const isSecure = (req: IncomingMessage) =>
    (req.socket as { encrypted?: boolean }).encrypted === true || (o.trustProxy && String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim() === 'https')
  const clientIp = (req: IncomingMessage) =>
    (o.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() : '') || req.socket.remoteAddress || '?'

  const securityHeaders = (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Security-Policy', CSP)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (isSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
  }

  const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    const data = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
    res.end(data)
  }

  const cookie = (req: IncomingMessage, token: string, maxAge: number) =>
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`

  const tokenOf = (req: IncomingMessage): string | undefined => {
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=')
      if (k === COOKIE) return v.join('=')
    }
    return undefined
  }

  const readBody = (req: IncomingMessage, limit: number): Promise<unknown> =>
    new Promise((ok, fail) => {
      const type = String(req.headers['content-type'] ?? '')
      if (!type.startsWith('application/json')) return fail(new HttpError(415, 'Send JSON'))
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > limit) {
          fail(new HttpError(413, 'That is too large to send'))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => {
        try {
          ok(size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
        } catch {
          fail(new HttpError(400, 'Bad request'))
        }
      })
      req.on('error', fail)
    })

  /** Calls must come from this site's own page: the header, and (when the browser sends one) the same origin. */
  const checkSameSite = (req: IncomingMessage) => {
    if (req.headers[CSRF_HEADER] !== '1') throw new HttpError(403, 'Not allowed')
    const origin = req.headers.origin
    if (origin) {
      let host = ''
      try {
        host = new URL(origin).host
      } catch {
        // not a URL
      }
      const own = (o.trustProxy ? String(req.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim() : '') || req.headers.host
      if (!host || host !== own) throw new HttpError(403, 'Not allowed')
    }
  }

  const signedIn = (req: IncomingMessage): SessionInfo => {
    const me = sessionUser(o.accounts, tokenOf(req))
    if (!me) throw new HttpError(401, 'Please sign in')
    return me
  }

  /** The business this session has open, if the person still has access to it. */
  const openBiz = (me: SessionInfo): WebCtx['biz'] => {
    if (!me.businessId) return null
    const access = roleIn(o.accounts, me.user.id, me.businessId)
    if (!access) {
      setSessionBusiness(o.accounts, me.tokenHash, null)
      return null
    }
    return { session: pool.get(me.businessId, access.ownerId), role: access.role, ownerId: access.ownerId }
  }

  const ownerOfOpen = (me: SessionInfo): string => {
    const biz = openBiz(me)
    if (!biz) throw new UserError('Open a business first')
    if (biz.role !== 'owner') throw new UserError('Only the owner can manage the team')
    return me.businessId!
  }

  async function auth(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (path === '/auth/me' && req.method === 'GET') {
      const me = sessionUser(o.accounts, tokenOf(req))
      const role = me?.businessId ? roleIn(o.accounts, me.user.id, me.businessId)?.role ?? null : null
      const body: WebMe = { user: me?.user ?? null, businessId: role ? me!.businessId : null, role, signupOpen: o.signupOpen || userCount(o.accounts) === 0 }
      return json(res, 200, body)
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Not allowed')
    checkSameSite(req)
    const body = (await readBody(req, SMALL_BODY)) as Record<string, string>
    switch (path) {
      case '/auth/signup': {
        if (!o.signupOpen && userCount(o.accounts) > 0) throw new HttpError(403, 'New accounts are not being taken here. Ask the shop owner to add you.')
        signupThrottle.check(clientIp(req))
        const user = createUser(o.accounts, { name: body.name, email: body.email, password: body.password })
        const token = startSession(o.accounts, user.id)
        return json(res, 200, { user }, { 'Set-Cookie': cookie(req, token, 30 * 24 * 3600) })
      }
      case '/auth/login': {
        loginThrottle.check(clientIp(req))
        const user = checkLogin(o.accounts, body.email, body.password)
        const token = startSession(o.accounts, user.id)
        return json(res, 200, { user }, { 'Set-Cookie': cookie(req, token, 30 * 24 * 3600) })
      }
      case '/auth/logout': {
        const me = sessionUser(o.accounts, tokenOf(req))
        if (me) endSession(o.accounts, me.tokenHash)
        return json(res, 200, {}, { 'Set-Cookie': cookie(req, '', 0) })
      }
      case '/auth/team': {
        const me = signedIn(req)
        return json(res, 200, team(o.accounts, ownerOfOpen(me)))
      }
      case '/auth/team/add': {
        const me = signedIn(req)
        return json(res, 200, addStaff(o.accounts, ownerOfOpen(me), body as unknown as NewStaffInput))
      }
      case '/auth/team/remove': {
        const me = signedIn(req)
        removeStaff(o.accounts, ownerOfOpen(me), String(body.userId ?? ''))
        return json(res, 200, {})
      }
    }
    throw new HttpError(404, 'Not found')
  }

  async function api(req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
    if (req.method !== 'POST') throw new HttpError(405, 'Not allowed')
    checkSameSite(req)
    if (!API.has(method)) throw new HttpError(404, 'Not found')
    const me = signedIn(req)
    const body = (await readBody(req, BIG_BODY)) as { args?: unknown[]; file?: UploadedFile }
    const args = Array.isArray(body.args) ? body.args : []
    const biz = openBiz(me)
    if (!biz && !NO_BUSINESS.has(method)) throw new UserError('Open a business first')
    if (biz && !NO_BUSINESS.has(method)) {
      const db = biz.session.requireDb()
      checkRole(db, biz.role, method, args)
      setAuditUser(db, `web:${me.user.email}`)
    }
    const handlers = webHandlers({ accounts: o.accounts, pool, files, me, version: o.version, biz }) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
    const fn = handlers[method]
    if (!fn) throw new HttpError(404, 'Not found')
    const callArgs = method === 'uploadImportFile' ? [args[0], body.file] : method === 'uploadBackupFile' ? [body.file] : args
    const value = await fn(...callArgs)
    json(res, 200, { value: value === undefined ? null : value })
  }

  function page(req: IncomingMessage, res: ServerResponse, path: string): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Not allowed')
    let rel = path === '/' ? '/index.html' : path
    try {
      rel = decodeURIComponent(rel)
    } catch {
      throw new HttpError(400, 'Bad request')
    }
    const file = resolve(join(staticRoot, normalize(rel)))
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) throw new HttpError(404, 'Not found')
    if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, 'Not found')
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache })
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
  }

  const server = createServer(async (req, res) => {
    securityHeaders(req, res)
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    try {
      if (path === '/healthz') return json(res, 200, { ok: true })
      if (path.startsWith('/auth/')) return await auth(req, res, path)
      if (path.startsWith('/api/')) return await api(req, res, path.slice(5))
      return page(req, res, path)
    } catch (err) {
      if (res.headersSent) return res.end()
      if (err instanceof HttpError) return json(res, err.status, { error: err.message, signIn: err.status === 401 })
      if (err instanceof UserError) return json(res, 400, { error: err.message })
      // Details stay in the server's log; the page gets a reference to quote.
      const ref = randomBytes(4).toString('hex')
      console.error(`[${new Date().toISOString()}] ref ${ref} ${req.method} ${path}`, err)
      return json(res, 500, { error: `Something went wrong. Please try again. (ref ${ref})` })
    }
  })
  server.requestTimeout = 120_000
  server.headersTimeout = 30_000
  return { server, pool }
}

/** Version from package.json next to the server (or "dev"). */
export function readVersion(dir: string): string {
  try {
    return String(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version ?? 'dev')
  } catch {
    return 'dev'
  }
}
