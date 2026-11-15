import { readFileSync, writeFileSync } from 'node:fs'

const inner = readFileSync('src/client.js', 'utf8')
const out = [
  'window.__ModuleLoader__.load({ id: "dsh-case-open", factory: (require) => {',
  'var module = { exports: {} }; var exports = module.exports;',
  inner.replaceAll('export const ', 'const ').replaceAll('export function ', 'function '),
  'exports.inject = inject; exports.apply = apply;',
  'return module.exports; } });',
  '',
].join('\n')
writeFileSync('lib/client.js', out)
console.log('wrapped client.js', out.length, 'bytes')
