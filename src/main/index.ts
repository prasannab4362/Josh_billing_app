import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { autoBackupLater, registerIpc } from './ipc'
import { Session } from './session'

let session: Session | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Billing App',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  session = new Session(app.getPath('userData'))
  try {
    if (session.restoreLast()) autoBackupLater(session)
  } catch (err) {
    console.error('Could not reopen the last business', err)
  }
  registerIpc(session)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  session?.close()
  session = null
})
