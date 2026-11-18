// Start the website:   node out/server/index.js
// Reset a password:    node out/server/index.js reset-password <email> <new password>
//
// Settings (environment variables):
//   PORT            port to listen on (default 8080)
//   HOST            address to listen on (default 127.0.0.1: put a HTTPS proxy such as Caddy or nginx in front)
//   DATA_DIR        where accounts and business files are kept (default ./web-data)
//   STATIC_DIR      the built screens (default ./out/renderer)
//   SIGNUP          "open" (anyone may create an account, default) or "closed" (only the first account)
//   TRUST_PROXY     "1" when behind a proxy that sets X-Forwarded-Proto/-For/-Host
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { todayLocal } from '@shared/fy'
import { openAccounts, resetPassword } from './accounts'
import { createWebServer, readVersion } from './app'

const dataDir = resolve(process.env.DATA_DIR || 'web-data')
mkdirSync(dataDir, { recursive: true })
const accounts = openAccounts(join(dataDir, 'accounts.db'))

if (process.argv[2] === 'reset-password') {
  const [email, password] = process.argv.slice(3)
  if (!email || !password) {
    console.error('Usage: node out/server/index.js reset-password <email> <new password>')
    process.exit(2)
  }
  try {
    resetPassword(accounts, email, password)
    console.log(`Password changed for ${email}; they were signed out everywhere.`)
  } catch (e) {
    console.error((e as Error).message)
    process.exitCode = 1
  }
  accounts.close()
} else {
  const port = Number(process.env.PORT || 8080)
  const host = process.env.HOST || '127.0.0.1'
  const { server, pool } = createWebServer({
    accounts,
    dataDir,
    staticDir: resolve(process.env.STATIC_DIR || 'out/renderer'),
    signupOpen: (process.env.SIGNUP || 'open') !== 'closed',
    trustProxy: process.env.TRUST_PROXY === '1',
    version: readVersion(process.cwd())
  })

  // A verified backup of each open business once a day (kept 7 days, as on the desktop).
  const backups = setInterval(() => {
    for (const s of pool.sessions()) s.autoBackup(todayLocal()).catch((e) => console.error('Backup failed', e))
  }, 30 * 60_000)

  server.listen(port, host, () => console.log(`Josh Books website on http://${host}:${port} (data in ${dataDir})`))

  const stop = () => {
    clearInterval(backups)
    server.close()
    // Take a last backup and close every file cleanly.
    Promise.allSettled(pool.sessions().map((s) => s.autoBackup(todayLocal()))).finally(() => {
      pool.closeAll()
      accounts.close()
      process.exit(0)
    })
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
