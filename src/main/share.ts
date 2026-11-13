// Sharing: poster images, the catalogue PDF, bills on WhatsApp, and the few web pages the app opens.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, shell } from 'electron'
import { POSTER_SIZES, type PosterSize } from '@shared/posters'
import { isSafeExternalUrl } from '@shared/share'
import { UserError } from './util'

const parentWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'file'

/** Draw a page at exactly width × height pixels and return it as a PNG. Scripts are off. */
export async function renderPng(html: string, width: number, height: number): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false, width, height, useContentSize: true, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, javascript: false, sandbox: true }
  })
  try {
    win.setContentSize(width, height)
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise((r) => setTimeout(r, 250)) // let fonts and images settle
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height })
    return img.resize({ width, height }).toPNG()
  } finally {
    win.destroy()
  }
}

const posterSize = (size: PosterSize) => {
  const s = POSTER_SIZES[size]
  if (!s) throw new UserError('Choose a poster size')
  return s
}

/** Ask where to save the poster as a PNG. Returns the path, or null if cancelled. */
export async function savePoster(html: string, size: PosterSize, name: string): Promise<string | null> {
  const { width, height } = posterSize(size)
  const options = { defaultPath: `${safeName(name)}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] }
  const parent = parentWindow()
  const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, await renderPng(html, width, height))
  return r.filePath
}

/** Put the poster on the clipboard, ready to paste into WhatsApp. */
export async function copyPoster(html: string, size: PosterSize): Promise<boolean> {
  const { width, height } = posterSize(size)
  // Electron 44+: the W3C-style clipboard API; a PNG Blob pastes as a picture into WhatsApp and other apps.
  const png = await renderPng(html, width, height)
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  return true
}

/** Save HTML as a PDF where the user chooses, then open it. */
export async function savePdfAs(html: string, name: string): Promise<string | null> {
  const options = { defaultPath: `${safeName(name)}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
  const parent = parentWindow()
  const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, await htmlToPdf(html))
  void shell.openPath(r.filePath)
  return r.filePath
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
  } finally {
    win.destroy()
  }
}

/** Where PDFs made for sharing are kept, so they can be dragged into WhatsApp. */
export function shareFolder(): string {
  const dir = join(app.getPath('documents'), 'Billing App', 'Shared')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Write a PDF into the share folder and show it in Explorer. Returns its path. */
export function keepForSharing(pdf: Buffer, name: string): string {
  const path = join(shareFolder(), `${safeName(name)}.pdf`)
  writeFileSync(path, pdf)
  shell.showItemInFolder(path)
  return path
}

/** Open only the web addresses the app itself makes: WhatsApp's wa.me links and Google Business. */
export async function openSafe(url: string): Promise<void> {
  if (!isSafeExternalUrl(url)) throw new UserError('That link cannot be opened from here')
  await shell.openExternal(url)
}
