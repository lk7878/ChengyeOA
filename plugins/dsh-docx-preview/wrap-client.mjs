import { readFileSync, writeFileSync } from 'node:fs'

const inner = readFileSync('lib/client.inner.js', 'utf8')
const out = [
  'window.__ModuleLoader__.load({ id: "dsh-docx-preview", factory: (require) => {',
  'var module = { exports: {} }; var exports = module.exports;',
  inner,
  'exports.inject = inject; exports.apply = apply;',
  'return module.exports; } });',
  '',
].join('\n')
writeFileSync('lib/client.js', out)
console.log('wrapped client.js', out.length, 'bytes')
