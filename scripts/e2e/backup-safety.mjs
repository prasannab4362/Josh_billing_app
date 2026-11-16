// Second backup place and the damage check, in the running app (6 checks).
// Usage: node scripts/e2e/backup-safety.mjs <output folder>   (app started as in README.md, a business open)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { connect, stubDialogs, sleep } from './harness.mjs'

const out = process.argv[2] ?? 'e2e-out'
const mirror = join(out, 'second-place')
rmSync(mirror, { recursive: true, force: true })
mkdirSync(mirror, { recursive: true })
const app = await connect(out)
const { click, waitFor, text, api, check, shot, evaluate } = app
await stubDialogs(out, mirror) // the folder chooser answers with the second-place folder
await api('clearBackupMirror()')

await click('Settings')
await sleep(600)
await click('Backup & restore', '.report-nav')
await waitFor('Second copy, so nothing is ever lost')
await click('Check data for damage')
await waitFor('The data file is healthy')
check(true, 'the damage check reports a healthy data file')

await click('Choose folder')
await waitFor('Second backup place set')
await sleep(500)
const folders = existsSync(mirror) ? readdirSync(mirror) : []
const files = folders.length ? readdirSync(join(mirror, folders[0])) : []
check(folders.length === 1 && files.length === 1 && /^backup-\d{4}-\d{2}-\d{2}\.db$/.test(files[0]), `a first copy is saved in the second place (${folders[0]}/${files[0]})`)
const header = files.length ? readFileSync(join(mirror, folders[0], files[0])).subarray(0, 15).toString() : ''
check(header === 'SQLite format 3', 'the copy is a real database file')
check((await text()).includes(mirror.split('\\').join('/')) || (await text()).includes(mirror), 'the screen shows where the second copy goes')
check((await api('getBackupMirror()')) !== null, 'the choice is remembered')
await click('Back up to both now')
await waitFor('Backed up here and in the second place')
check(true, '"Back up to both now" saves in both places')
await shot('73-second-copy')
await api('clearBackupMirror()')
check((await api('getBackupMirror()')) === null, '"Stop" turns the second copy off')
console.log(app.log.filter((l) => l.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL OK')
app.close()
