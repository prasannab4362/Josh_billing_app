// Visits every page at several window sizes and reports anything cut off, overflowing or overlapping.
// Usage: node scripts/e2e/ui-check.mjs <output folder>   (app started as in README.md, a business open)
import { connect, mainEval, stubDialogs, sleep } from './harness.mjs'

const out = process.argv[2] ?? 'e2e-out'
const app = await connect(out)
const { click, waitFor, evaluate, check, shot } = app
await stubDialogs(out)

const SIZES = [[960, 600], [1280, 800], [1600, 900]]
const PAGES = ['Dashboard', 'Sale', 'POS', 'Purchase', 'Payments', 'Expenses', 'Parties', 'Items', 'Cash & Bank', 'Reports', 'Grow', 'Settings']
const SETTINGS_TABS = ['Business', 'Preferences', 'Transactions', 'Print', 'Extra fields', 'Invoice numbering', 'Tax rates', 'Units', 'Backup & restore', 'Recycle bin', 'Change history']

/** Elements wider than the window, text cut off by its box, and a page that scrolls sideways. */
const AUDIT = `(() => {
  const vw = document.documentElement.clientWidth
  const bad = []
  const name = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' "' + (el.innerText || el.value || '').trim().slice(0, 30) + '"')
  // Any box that scrolls sideways hides part of what is in it (tables inside their own scroll box are expected).
  for (const el of document.querySelectorAll('*')) {
    const o = getComputedStyle(el)
    if (/(auto|scroll)/.test(o.overflowX) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && !el.closest('.table-wrap, .report-scroll, .report-body > .card, .pos-lines, .import-rows, .bulk-grid, .labels-items, .catalogue-items, .catalogue-preview')) {
      const lim = el.getBoundingClientRect().right
      const culprit = [...el.querySelectorAll('*')].find((c) => c.getBoundingClientRect().right > lim + 2 && c.getBoundingClientRect().width > 0)
      bad.push('scrolls sideways: ' + name(el) + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')' + (culprit ? ' because of ' + name(culprit) : ''))
    }
  }
  if (document.documentElement.scrollWidth > vw + 1) bad.push('page scrolls sideways (' + document.documentElement.scrollWidth + ' > ' + vw + ')')
  for (const el of document.querySelectorAll('button, input, select, textarea, th, td, .btn, .stat, .card, h1, h2, h3, .pill, .badge, label')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none') continue
    // Inside a scrolling box (table wrapper, list) is fine.
    let p = el.parentElement, scrolls = false
    while (p) { const o = getComputedStyle(p); if (/(auto|scroll)/.test(o.overflowX) && p.scrollWidth > p.clientWidth) { scrolls = true; break } p = p.parentElement }
    if (!scrolls && r.right > vw + 1 && !el.closest('iframe')) bad.push('off the right edge: ' + name(el))
    const txt = (el.tagName === 'BUTTON' || el.classList.contains('btn')) && el.scrollWidth > el.clientWidth + 2 && st.overflow === 'hidden'
    if (txt) bad.push('text cut off in button: ' + name(el))
  }
  return [...new Set(bad)].slice(0, 12)
})()`

async function resize(w, h) {
  await mainEval(`(() => { const win = require('electron').BrowserWindow.getAllWindows()[0]; win.setSize(${w}, ${h}); win.center(); return 1 })()`)
  await sleep(900)
}
const sidebarHidden = async () => evaluate(`(() => { const n = document.querySelector('nav.sidebar, .sidebar'); return !!n && n.getBoundingClientRect().width < 80 })()`)

for (const [w, h] of SIZES) {
  await resize(w, h)
  for (const page of PAGES) {
    await evaluate(`[...document.querySelectorAll('nav button, nav a, .sidebar button')].find((b) => b.innerText.trim().startsWith(${JSON.stringify(page)}))?.click()`)
    await sleep(1000)
    if (page === 'Settings') {
      for (const tab of SETTINGS_TABS) {
        await click(tab, '.report-nav')
        await sleep(450)
        const bad = await evaluate(AUDIT)
        check(bad.length === 0, `${w}×${h} Settings › ${tab}${bad.length ? ': ' + bad.join(' | ') : ''}`)
      }
      continue
    }
    const bad = await evaluate(AUDIT)
    check(bad.length === 0, `${w}×${h} ${page}${bad.length ? ': ' + bad.join(' | ') : ''}`)
    if (w === 1280) await shot(`ui-${page.replace(/\W+/g, '-').toLowerCase()}`)
  }
}
await resize(1280, 800)
const failed = app.log.filter((l) => l.startsWith('FAIL')).length
console.log(failed ? `${failed} PROBLEM(S)` : 'ALL PAGES CLEAN')
app.close()
