/**
 * Inline the built CSS and JS into ONE self-contained HTML file that opens by
 * double-clicking, with no web server and no network.
 *
 * Why this exists: browsers block ES modules loaded over file://, so a normal Vite build
 * cannot be opened from the filesystem — you get a blank page and a CORS error in the
 * console. The build is configured to emit IIFE instead, and this script folds everything
 * into a single file so there is nothing left to fetch.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const OUT = join(root, 'HyperV-Surveyor.html')

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html not found — run `npm run build` first.')
  process.exit(1)
}

let html = readFileSync(join(dist, 'index.html'), 'utf8')

// A closing script tag inside a JS string literal would terminate the inline <script>.
const safe = (js) => js.replace(/<\/script/gi, '<\\/script')

// Inline every stylesheet.
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi, (m, href) => {
  const p = join(dist, href.replace(/^\.?\//, ''))
  if (!existsSync(p)) return m
  return `<style>\n${readFileSync(p, 'utf8')}\n</style>`
})

// Inline every script, dropping type="module" — an inline module still triggers the
// file:// restriction, so the tag has to be a classic script.
//
// Vite emits the script tag in <head>. A module there is deferred until after parsing, but a
// CLASSIC inline script executes immediately — before <div id="root"> exists — which throws
// React error #299 ("target container is not a DOM element") and leaves a blank page.
// So the script is collected here and re-emitted at the end of <body>.
const collected = []
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/gi, (m, src) => {
  const p = join(dist, src.replace(/^\.?\//, ''))
  if (!existsSync(p)) return m
  collected.push(safe(readFileSync(p, 'utf8')))
  return ''
})
if (collected.length === 0) {
  console.error('No script was inlined — nothing to bundle. Aborting.')
  process.exit(1)
}
html = html.replace(
  /<\/body>/i,
  `${collected.map(js => `<script>\n${js}\n</script>`).join('\n')}\n</body>`,
)

if (/<script[^>]+src=/i.test(html) || /<link[^>]+stylesheet/i.test(html)) {
  console.error('Something did not inline — the file would still need a server. Aborting.')
  process.exit(1)
}
if (/type="module"/i.test(html)) {
  console.error('A module script survived — this would fail over file://. Aborting.')
  process.exit(1)
}

writeFileSync(OUT, html, 'utf8')
const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
console.log(`\n  HyperV-Surveyor.html  ${kb} KB  — self-contained, double-click to open\n`)
