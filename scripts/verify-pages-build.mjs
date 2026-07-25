import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const htmlPath = resolve(root, 'dist/index.html')
const html = await readFile(htmlPath, 'utf8')

if (html.includes('/src/main.tsx')) {
  throw new Error('Pages build still references the Vite source entry.')
}

if (/(?:src|href)="\/(?!\/)/.test(html)) {
  throw new Error('Pages build contains a root-relative asset path.')
}

if (!html.includes("connect-src 'none'") || /wss?:\/\//.test(html)) {
  throw new Error('Pages build CSP permits a development WebSocket connection.')
}

const scriptMatch = html.match(/<script[^>]+src="(\.\/assets\/[^"]+\.js)"/)

if (!scriptMatch) {
  throw new Error('Pages build does not use a relative production JavaScript asset.')
}

if (!html.includes('href="./favicon.svg"')) {
  throw new Error('Pages build favicon is not relative to the deployed repository path.')
}

await access(resolve(root, 'dist', scriptMatch[1].replace(/^\.\//, '')))
await access(resolve(root, 'dist/favicon.svg'))

process.stdout.write('GitHub Pages production asset paths verified.\n')
