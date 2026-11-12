// A quick end-to-end check of the main screens in the running app.
// Usage: node scripts/e2e/smoke.mjs <output folder>   (start the app first; see README.md)
// Needs a business to be open already (create one in the app the first time).
import { connect, stubDialogs, sleep } from './harness.mjs'

const out = process.argv[2] ?? 'e2e-out'
const app = await connect(out)
const { click, waitFor, text, api, check, shot } = app
await stubDialogs(out)

const biz = await api('currentBusiness()')
check(!!biz, `a business is open: ${biz?.name ?? 'none (create one in the app first)'}`)
if (!biz) process.exit(1)

for (const [nav, needle] of [
  ['Dashboard', 'To receive'],
  ['Parties', '+ Add party'],
  ['Items', 'Bulk update'],
  ['Sale', '+ New invoice'],
  ['Purchase', 'Purchase'],
  ['Reports', 'Reports'],
  ['Settings', 'Extra fields']
]) {
  await click(nav)
  await waitFor(needle)
  check(true, `${nav} opens`)
}
for (const tab of ['Print', 'Transactions', 'Extra fields']) {
  await click(tab, 'nav.tabs')
  await sleep(500)
  check((await text()).length > 200, `Settings › ${tab} shows`)
}
const items = await api('listItems()')
check(Array.isArray(items), `items load (${items.length})`)
const html = await app.evaluate(`(async () => window.api.previewPrintSettings(await window.api.getPrintSettings(), 'A4'))()`)
check(html.includes('<!doctype html>'), 'invoice print preview renders')
await shot('smoke')
console.log(app.log.filter((l) => l.startsWith('FAIL')).length ? 'SOME CHECKS FAILED' : 'all checks passed')
app.close()
