import { readFile, writeFile } from 'node:fs/promises'

const directory = new URL('../dist/demo/', import.meta.url)
let html = await readFile(new URL('index.html', directory), 'utf8')
const scriptTag = html.match(/<script type="module"[^>]* src="([^"]+)"><\/script>/)
const styleTag = html.match(/<link rel="stylesheet"[^>]* href="([^"]+)">/)
if (!scriptTag || !styleTag) throw new Error('Assets missing from the Vite demo build.')

const [script, style] = await Promise.all([
  readFile(new URL(scriptTag[1], directory), 'utf8'),
  readFile(new URL(styleTag[1], directory), 'utf8'),
])
html = html
  .replace(scriptTag[0], () => `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`)
  .replace(styleTag[0], () => `<style>${style}</style>`)
  .replace('<title>BrowAO — Атлас Земли</title>', '<title>BrowAO — Демо</title>')
await writeFile(new URL('../browao-demo.html', directory), html)
