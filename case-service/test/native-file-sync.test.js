import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { outputPath, registerOaFileSync } from '../../plugins/dsh-baiyou-brand/src/oa-file-sync.js'

const id = 'e367847c-27c4-46f2-8b1a-bc640202d505'
const file = { path: 'reports/中国刑法.docx', name: '中国刑法.docx', size: 3000, sha256: 'a'.repeat(64) }
file.key = `${file.path}:${file.sha256}`
function setup({ items = [file], confirm = true, save, pathname = `/harness/${id}/` } = {}) {
  const requests = [], notices = [], confirmations = [], providers = [], opened = []
  const browser = {
    location: { pathname },
    open: (...args) => opened.push(args),
    confirm: text => { confirmations.push(text); return confirm },
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (!options.method) return Response.json({ items })
      return save ? save() : Response.json({ outputs: { [file.key]: { status: 'SAVED' } } })
    },
  }
  const ctx = { effect: fn => fn(), contextMenus: {
    register: provider => { providers.push(provider); return () => {} },
    notify: (...notice) => notices.push(notice),
  } }
  registerOaFileSync(ctx, browser)
  const action = () => providers[0].resolve({ path: `/workspace/${file.path}` })[0]
  return { action, requests, notices, confirmations, providers, opened }
}

test('file menu matches generated paths only, including Chinese filenames', () => {
  assert.equal(outputPath(`/workspace/${file.path}`), file.path)
  assert.equal(outputPath('drafts/sub/report.pdf'), 'drafts/sub/report.pdf')
  for (const path of ['/etc/passwd', 'materials/input.docx', '/workspace/reports/../materials/a',
    'reports//a', 'reports/./a', 'reports/a\\b', 'reports', '', null]) assert.equal(outputPath(path), null)
  assert.equal(setup({ pathname: '/wb/' }).providers.length, 0)
})

test('right-click sync confirms and submits exactly one current snapshot, never other outputs', async () => {
  const s = setup({ items: [{ ...file, path: 'reports/script.py', key: 'other' }, file] })
  assert.equal(s.action().label, '同步OA工作空间')
  await s.action().run()
  assert.equal(s.requests.length, 2)
  assert.equal(s.requests[0].url, `/api/tasks/${id}/outputs`)
  assert.equal(s.requests[1].url, `/api/tasks/${id}/save`)
  assert.equal(s.requests[1].options.credentials, 'include')
  assert.deepEqual(JSON.parse(s.requests[1].options.body), { selection: [file.key] })
  assert.match(s.confirmations[0], /承业空间 → 我的资源 → 我的文件/)
  assert.match(s.notices.at(-1)[0], /已保存到承业空间 → 我的资源/)
  assert.equal(s.notices.at(-1)[1], true)
})

test('cancel, already saved, missing file do not upload', async () => {
  for (const options of [{ confirm: false }, { items: [{ ...file, saved: true }] }, { items: [] }]) {
    const s = setup(options); await s.action().run()
    assert.equal(s.requests.length, 1)
    if (options.items?.length) assert.match(s.notices.at(-1)[0], /此版本已保存/)
    if (options.items?.length === 0) assert.equal(s.notices.at(-1)[1], false)
  }
})

test('duplicate click is suppressed; failed or changed versions can retry without false success', async () => {
  let finish
  const s = setup({ save: () => new Promise(resolve => { finish = resolve }) })
  const first = s.action().run()
  await s.action().run()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(s.action().disabled, true)
  assert.equal(s.requests.length, 2)
  finish(Response.json({ error: '成果已变更，请重新确认' }, { status: 409 }))
  await first
  assert.equal(s.action().disabled, false)
  assert.match(s.notices.at(-1)[0], /成果已变更/)
  assert.equal(s.notices.at(-1)[1], false)
  const retry = s.action().run()
  await new Promise(resolve => setImmediate(resolve))
  finish(Response.json({ outputs: { [file.key]: { status: 'SAVED' } } }))
  await retry
  assert.equal(s.notices.at(-1)[1], true)
})

test('server refusal and incomplete receipt never display success', async () => {
  for (const response of [Response.json({ error: '权限已撤销' }, { status: 403 }), Response.json({ outputs: {} })]) {
    const s = setup({ save: () => response }); await s.action().run()
    assert.equal(s.notices.at(-1)[1], false)
    assert.match(s.notices.at(-1)[0], /^同步失败/)
  }
})

test('shipped native bundle includes the menu and its declared service dependency', () => {
  let plugin
  vm.runInNewContext(readFileSync(new URL('../../plugins/dsh-baiyou-brand/lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }) => { plugin = factory(() => ({})) } } },
  })
  assert.ok(plugin.inject.includes('contextMenus'))
  assert.equal(typeof plugin.apply, 'function')
  const pkg = JSON.parse(readFileSync(new URL('../../plugins/dsh-baiyou-brand/package.json', import.meta.url)))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-context-menu'))
})

 test('successful and already-saved receipts offer an explicit safe OA file-list link', async () => {
  for (const items of [[file], [{ ...file, saved: true }]]) {
    const s = setup({ items }); await s.action().run()
    assert.equal(s.opened.length, 0, 'never navigate automatically')
    const action = s.notices.at(-1)[2]
    assert.equal(action.label, '查看文件')
    action.run()
    assert.deepEqual(s.opened, [['/workspaces?workspace=__all__&scope=mine', '_blank', 'noopener,noreferrer']])
  }
})
