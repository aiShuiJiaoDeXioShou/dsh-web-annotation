/**
 * Build the browser half:
 *   src/client/index.tsx -> client/client.js (DSH __ModuleLoader__ factory)
 *
 * The Host half is the hand-written no-op `index.js`; there is nothing to build.
 */
import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const ID = pkg.name
const banner = `/* ${ID} v${pkg.version} */`

const outDir = join(root, 'client')
const tmpFile = join(outDir, '.bundle.cjs')
const outFile = join(outDir, 'client.js')
await mkdir(outDir, { recursive: true })
await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  bundle: true,
  write: true,
  outfile: tmpFile,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  external: ['react', 'react/jsx-runtime'],
  loader: { '.css': 'text', '.svg': 'text' },
  logLevel: 'warning',
})
const body = await readFile(tmpFile, 'utf8')
if (body.includes('require("@deepseek-ai/')) {
  throw new Error('client bundle must not require a DSH internal Client package')
}
const wrapped = `${banner}
window.__ModuleLoader__.load({
  id: ${JSON.stringify(ID)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  },
});
`
await writeFile(outFile, wrapped, 'utf8')
await rm(tmpFile, { force: true })
const kb = (Buffer.byteLength(await readFile(outFile)) / 1024).toFixed(1)
console.log(`[dsh-web-annotation] built ${outFile} (${kb} KiB)`)
