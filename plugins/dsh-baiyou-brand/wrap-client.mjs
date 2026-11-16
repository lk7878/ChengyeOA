import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const inner = readFileSync(path.join(here, 'src/client.js'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/^import \{ useEffect \} from 'react'\n+/, '')
  .replace(/^import \{ jsx, jsxs \} from 'react\/jsx-runtime'\n+/, '')
const out = [
  'window.__ModuleLoader__.load({ id: "dsh-baiyou-brand", factory: (require) => {',
  'var module = { exports: {} }; var exports = module.exports;',
  'var { useEffect } = require("react");',
  'var { jsx, jsxs } = require("react/jsx-runtime");',
  inner.replaceAll('export const ', 'const ').replaceAll('export function ', 'function '),
  'exports.inject = inject; exports.apply = apply;',
  'return module.exports; } });',
  '',
].join('\n')
writeFileSync(path.join(here, 'lib/client.js'), out)
console.log('wrapped client.js', out.length, 'bytes')
