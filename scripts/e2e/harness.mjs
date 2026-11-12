// Drives the running app over the Chrome DevTools Protocol, for end-to-end checks.
// Start the app first (see scripts/e2e/README.md), then import this from a check script.
import { mkdirSync, writeFileSync } from 'node:fs'

const PAGE_PORT = 9333 // --remote-debugging-port: the window's page
const MAIN_PORT = 9334 // --inspect: the main process

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Connect to the app window. `out` is a folder for screenshots and saved files. */
export async function connect(out) {
  mkdirSync(out, { recursive: true })
  const log = []
  const check = (cond, msg) => {
    log.push(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
    console.log(log.at(-1))
    return cond
  }

  let target
  for (let i = 0; i < 40 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${PAGE_PORT}/json`)).json()).find((t) => t.type === 'page')
    } catch {}
    if (!target) await sleep(500)
  }
  if (!target) throw new Error(`The app is not running with --remote-debugging-port=${PAGE_PORT}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let seq = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) (pending.get(msg.id)(msg), pending.delete(msg.id))
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  /** Run JavaScript in the page and return its (JSON) value. */
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
    return r.result.result.value
  }
  /** Call the app's API as the screens do, e.g. api('listItems()'). */
  const api = (call) => evaluate(`window.api.${call}`)
  /** Visible text. Note: CSS text-transform applies, so uppercase section titles read in capitals. */
  const text = () => evaluate('document.body.innerText')
  const waitFor = async (needle, tries = 60) => {
    for (let i = 0; i < tries; i++) {
      if ((await text()).includes(needle)) return
      await sleep(250)
    }
    throw new Error(`Timed out waiting for "${needle}". Page:\n${(await text()).slice(0, 2000)}`)
  }
  /** Click the button whose text is (or starts with) label, optionally inside a CSS scope like '.modal'. */
  const click = (label, scope = '') =>
    evaluate(`(() => {
      const all = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})];
      const b = all.find((x) => x.innerText.trim() === ${JSON.stringify(label)}) || all.find((x) => x.innerText.trim().startsWith(${JSON.stringify(label)}));
      if (!b) throw new Error('no button ' + ${JSON.stringify(label)});
      b.click();
    })()`)
  /** Set an input/select/textarea the way React notices (native setter + input/change event). */
  const setValue = (elementExpr, value) =>
    evaluate(`(() => { const el = ${elementExpr};
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })()`)
  /** Screenshot; skipped (not hung) when the window is hidden. */
  const shot = async (name) => {
    await send('Page.bringToFront')
    const r = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), sleep(5000).then(() => null)])
    if (r) writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64'))
    else log.push(`(no screenshot for ${name}: window not visible)`)
  }
  const close = () => ws.close()
  return { evaluate, api, text, waitFor, click, setValue, shot, check, log, close, out }
}

/**
 * Run JavaScript in the main process (needs --inspect=9334), e.g. to stub file dialogs.
 * `require` works at the top of the expression, but not inside functions called later:
 * compute values (paths etc.) directly instead.
 */
export async function mainEval(expression) {
  const list = await (await fetch(`http://127.0.0.1:${MAIN_PORT}/json`)).json()
  const w = new WebSocket(list[0].webSocketDebuggerUrl)
  await new Promise((r) => (w.onopen = r))
  const res = await new Promise((resolve) => {
    w.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.id === 1) resolve(d.result)
    }
    w.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true } }))
  })
  w.close()
  return res?.result?.value
}

/** Make save dialogs answer with a file in `dir` (named from the suggested name) and open dialogs with `openFile`. */
export async function stubDialogs(dir, openFile = '') {
  const d = dir.split('\\').join('/')
  return mainEval(`(() => { const { dialog, shell, BrowserWindow } = require('electron');
    globalThis.__openFile = ${JSON.stringify(openFile.split('\\').join('/'))};
    dialog.showSaveDialog = async (a, b) => { const o = b || a; const name = String(o.defaultPath || 'file').split('/').pop().split(String.fromCharCode(92)).pop(); return { canceled: false, filePath: ${JSON.stringify(d)} + '/' + name } };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__openFile] });
    shell.openPath = async () => '';
    const w = BrowserWindow.getAllWindows()[0]; if (w) { w.restore(); w.show(); w.focus() }
    return 'stubbed' })()`)
}
