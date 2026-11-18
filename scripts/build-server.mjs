// Bundle the website's server (src/server) into out/server/index.cjs. better-sqlite3 stays outside (native module).
import { build } from 'esbuild'

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'out/server/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['better-sqlite3', 'electron'],
  tsconfig: 'tsconfig.node.json',
  sourcemap: true,
  logLevel: 'info'
})

// The server must not pull in desktop-only code: electron is not there on a web server.
const { readFileSync } = await import('node:fs')
if (/require\(["']electron["']\)/.test(readFileSync('out/server/index.cjs', 'utf8'))) {
  console.error('The server bundle needs "electron". Move that code out of what src/server imports.')
  process.exit(1)
}
