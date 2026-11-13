// Locks the app down: windows cannot navigate away or open new ones, pages cannot reach the network or ask
// for the camera and the like, and only the app's own window can call the main process. The app is offline
// by design (AGENTS.md: "Nothing is sent from the app"); this makes that a rule the code enforces.
import { app, session, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

/**
 * The dev server address, only when developing (not in a packaged app) and only on this computer. An
 * environment variable must never make the app load a website with full access to the business data.
 */
export function devServerUrl(): string | null {
  const raw = process.env.ELECTRON_RENDERER_URL
  if (!raw || app.isPackaged) return null
  try {
    const u = new URL(raw)
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin
  } catch {
    // Not a URL: ignored.
  }
  return null
}

/** The page the app's window shows: the built renderer file, or the local dev server. */
export function appPageUrl(): string {
  return devServerUrl() ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

/** True for addresses the app's own pages may load: its files, inline data and (in development) the dev server. */
export function isAllowedUrl(url: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools:') || url === 'about:blank' || url === 'about:srcdoc') return true
  if (url.startsWith('file:')) {
    // Only the app's own files, never other files on the computer.
    const root = pathToFileURL(join(__dirname, '..')).href
    return url.startsWith(root)
  }
  const dev = devServerUrl()
  if (dev && (url.startsWith(dev + '/') || url === dev)) return true
  if (dev && url.startsWith(dev.replace(/^http/, 'ws'))) return true // live reload in development
  return false
}

/** Only the app's own window may call the main process. */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame.parent) return false // not from a sub-frame (the invoice preview is one)
  const url = frame.url.split('#')[0].split('?')[0]
  const page = appPageUrl().split('#')[0]
  return url === page || (devServerUrl() !== null && url.startsWith(devServerUrl()!))
}

function guard(contents: WebContents): void {
  // No new windows: links that should open go through the app's safe "open in browser" call instead.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (e, url) => {
    if (!isAllowedUrl(url)) e.preventDefault()
  })
  contents.on('will-redirect', (e, url) => {
    if (!isAllowedUrl(url)) e.preventDefault()
  })
  contents.on('will-attach-webview', (e) => e.preventDefault())
}

/** Call once, before any window opens. */
export function hardenApp(): void {
  app.on('web-contents-created', (_e, contents) => guard(contents))
  const s = session.defaultSession
  // No camera, microphone, location, notifications, clipboard reading, USB, and so on.
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  s.setPermissionCheckHandler(() => false)
  s.setDevicePermissionHandler(() => false)
  // Nothing leaves the computer: any request to the network is cancelled.
  s.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedUrl(details.url) }))
  s.on('will-download', (e) => e.preventDefault())
}
