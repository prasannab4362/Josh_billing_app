import { join } from 'node:path'
import { app, BrowserWindow, Menu } from 'electron'
import { autoBackupLater, registerIpc } from './ipc'
import { appPageUrl, devServerUrl, hardenApp } from './security'
import { Session } from './session'
import { protectOutputPipes } from './stdio'

protectOutputPipes()

let session: Session | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Josh Billing',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })
  if (devServerUrl()) win.loadURL(appPageUrl())
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// One copy of the app at a time, so two windows never write the same business file.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    hardenApp()
    // A packaged app has no developer menu (no "Toggle Developer Tools", no reload).
    if (app.isPackaged) Menu.setApplicationMenu(null)
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
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  session?.close()
  session = null
})
