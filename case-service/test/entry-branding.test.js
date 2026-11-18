import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from '../../runtime/upstream/harness/node_modules/jsdom/lib/api.js'
import { brandEntryHtml } from '../../deploy/integration/brand-entrypoints.mjs'
const fixture = id => `<!doctype html><html lang="en"><head><title>DSH Local Build</title><link rel="icon" href="./upstream.svg"></head><body><div id="${id}"></div></body></html>`
const tick = () => new Promise(resolve => setImmediate(resolve))
function page(kind='assistant') {
 const dom = new JSDOM(brandEntryHtml(fixture(kind==='assistant'?'root':'app'),kind), {runScripts:'dangerously',url:'http://localhost/harness/test/'})
 return dom
}
test('initial HTML has branded title, favicon and accessible loading screen; deployment is idempotent', () => {
 for(const [kind,id,title] of [['assistant','root','智慧办案 AI助手'],['knowledge','app','承业智慧办案 · 知识库']]) {
  const html=brandEntryHtml(fixture(id),kind)
  assert.equal(brandEntryHtml(html,kind),html)
  const dom=new JSDOM(html)
  assert.equal(dom.window.document.title,title)
  assert.equal(dom.window.document.querySelector('link[rel=icon]').getAttribute('href'),'/wb/favicon.svg')
  assert.match(dom.window.document.querySelector('[role=status]').textContent,/正在准备/)
  assert.ok(!dom.window.document.body.textContent.includes('HARNESS'))
  dom.window.close()
 }
 assert.throws(()=>brandEntryHtml('<html><head></head><body></body></html>','assistant'),/mount point/)
})
test('native loading text changes before paint, then observer stops without touching conversation text', async()=>{
 const dom=page(),{document}=dom.window,root=document.getElementById('root')
 try {
  const boot=document.createElement('div');boot.dataset.dshBoot='';boot.innerHTML='<div><div>HARNESS</div><div data-dsh-boot-spinner></div><div>Loading plugins…</div></div>';root.append(boot)
  await tick()
  assert.equal(root.querySelector('[data-oa-entry]'),null)
  assert.match(boot.textContent,/智慧办案 AI助手/)
  assert.match(boot.textContent,/正在准备 AI 助手/)
  root.innerHTML='<main>HARNESS is quoted user content</main>'
  await tick()
  assert.equal(root.textContent,'HARNESS is quoted user content')
  assert.equal(root.querySelector('[data-oa-entry]'),null)
 } finally {dom.window.close()}
})
test('boot failures retain diagnostic content and expose recovery rather than an endless loading overlay',async()=>{
 const dom=page(),{document}=dom.window,root=document.getElementById('root')
 try {
  root.innerHTML='<div data-dsh-boot><div><div>HARNESS</div><div><h2>Failed to load plugins</h2><p>network unavailable</p></div></div></div>'
  await tick()
  assert.match(root.textContent,/AI 助手加载失败/)
  assert.match(root.textContent,/network unavailable/)
  assert.equal(root.querySelector('[data-oa-entry-recovery] button').textContent,'重试加载')
  assert.equal(root.querySelector('[data-oa-entry-recovery] a').getAttribute('href'),'/wb/')
 } finally {dom.window.close()}
})
test('knowledge placeholder yields to the real application and script failures offer recovery',async()=>{
 const dom=page('knowledge'),{document}=dom.window,root=document.getElementById('app')
 try {
  dom.window.dispatchEvent(new dom.window.Event('error'));await tick()
  assert.ok(root.querySelector('[data-oa-entry-recovery]'))
  root.innerHTML='<main>知识库内容</main>';await tick()
  assert.equal(root.textContent,'知识库内容')
  assert.equal(root.querySelector('[data-oa-entry]'),null)
 } finally {dom.window.close()}
})
