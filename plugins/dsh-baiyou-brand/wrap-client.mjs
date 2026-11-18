import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const inner = readFileSync(path.join(here, 'src/client.js'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/^import \{ useEffect, useRef \} from 'react'\n+/, '')
  .replace(/^import \{ jsx, jsxs \} from 'react\/jsx-runtime'\n+/, '')
  .replace(/^import \{ registerOaFileSync \} from '\.\/oa-file-sync.js'\n+/, '')
const upload = readFileSync(path.join(here, 'src/oa-upload.js'), 'utf8')
const fileSync = readFileSync(path.join(here, 'src/oa-file-sync.js'), 'utf8')
const cleanedInner = inner.replace(/^import \{ bindOaUpload \} from '\.\/oa-upload.js'\n+/m, '')
const out = [
  'window.__ModuleLoader__.load({ id: "dsh-baiyou-brand", factory: (require) => {',
  'var module = { exports: {} }; var exports = module.exports;',
  'var { useEffect, useRef } = require("react");',
  'var { jsx, jsxs } = require("react/jsx-runtime");',
  (fileSync + '\n' + upload + '\n' + cleanedInner).replaceAll('export async function ', 'async function ').replaceAll('export const ', 'const ').replaceAll('export function ', 'function '),
  'exports.inject = inject; exports.apply = apply;',
  'return module.exports; } });',
  '',
].join('\n')
writeFileSync(path.join(here, 'lib/client.js'), out)
console.log('wrapped client.js', out.length, 'bytes')
