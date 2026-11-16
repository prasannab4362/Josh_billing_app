import { join } from 'node:path'
import { app, BrowserWindow, Menu } from 'electron'
import { autoBackupLater, registerIpc } from './ipc'
import { appPageUrl, devServerUrl, hardenApp } from './security'
import { Session } from './session'
import { protectOutputPipes } from './stdio'

protectOutputPipes()

// The data folder keeps its first name, so a renamed app still finds every shop already saved on this computer.
if (app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Josh Billing'))

let session: Session | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Josh Books',
    icon: join(app.getAppPath(), 'build/icon-512.png'),
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
    // While the app is open, refresh today's backup (and the second copy) every half hour.
    setInterval(() => {
      session?.autoBackup().catch((err) => console.error('Automatic backup failed', err))
    }, 30 * 60_000).unref()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// One last backup as the app closes, so the day's final bills are in it. Closing waits for it (at most a few seconds).
let finalBackupDone = false
app.on('before-quit', (e) => {
  if (finalBackupDone || !session?.isOpen) return
  e.preventDefault()
  const done = () => {
    finalBackupDone = true
    app.quit()
  }
  const timer = setTimeout(done, 5000)
  session.autoBackup(undefined, true).then(
    () => (clearTimeout(timer), done()),
    (err) => (console.error('Backup on close failed', err), clearTimeout(timer), done())
  )
})

app.on('will-quit', () => {
  session?.close()
  session = null
})
