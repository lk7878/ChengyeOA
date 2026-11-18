import { readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs before the upstream application and its branding plugin, never over chat content.
export function entryBootstrap({ rootId, title }) {
  const document = window.document
  let timer, finished = false
  const showRecovery = () => {
    const loader = document.querySelector('[data-oa-entry]') || document.querySelector('[data-dsh-boot]')
    if (!loader || finished || loader.querySelector('[data-oa-entry-recovery]')) return
    const recovery = document.createElement('div')
    recovery.setAttribute('data-oa-entry-recovery', '')
    const message = document.createElement('p')
    message.textContent = '页面准备时间较长或加载遇到问题，可重试或返回智慧办案。'
    const retry = document.createElement('button')
    retry.textContent = '重试加载'
    retry.onclick = () => window.location.reload()
    const back = document.createElement('a')
    back.href = '/wb/'
    back.textContent = '返回智慧办案'
    recovery.append(message, retry, back)
    loader.append(recovery)
  }
  const observer = new MutationObserver(() => update())
  const update = () => {
    if (finished) return
    const root = document.getElementById(rootId)
    if (!root) return
    const placeholder = root.querySelector('[data-oa-entry]')
    const boot = root.querySelector('[data-dsh-boot]')
    if (boot) {
      placeholder?.remove()
      const card = boot.firstElementChild
      const label = card?.firstElementChild
      if (label?.textContent === 'HARNESS') label.textContent = title
      if (label && !label.hasAttribute('data-oa-boot-label')) label.setAttribute('data-oa-boot-label', '')
      for (const node of card?.children || []) {
        if (node.textContent === 'Loading plugins…') node.textContent = '正在准备 AI 助手…'
        const heading = node.firstElementChild
        if (heading?.textContent === 'Failed to load plugins') { heading.textContent = 'AI 助手加载失败'; showRecovery() }
      }
    }
    const hasApp = [...root.children].some(node => !node.hasAttribute('data-oa-entry') && !node.hasAttribute('data-dsh-boot'))
    if (hasApp) {
      placeholder?.remove()
      finished = true
      observer.disconnect()
      clearTimeout(timer)
      window.removeEventListener('error', showRecovery)
    }
  }
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('error', showRecovery)
  document.addEventListener('DOMContentLoaded', update, { once: true })
  timer = setTimeout(showRecovery, 30000)
  update()
}

const settings = {
  assistant: { rootId: 'root', title: '智慧办案 AI助手', message: '正在准备 AI 助手…' },
  knowledge: { rootId: 'app', title: '承业智慧办案 · 知识库', message: '正在准备知识库…' },
}
export function brandEntryHtml(html, kind) {
  const config = settings[kind]
  if (!config) throw Error('Unknown entry kind')
  // Idempotent: rebuilding or deploying twice must not duplicate screens/observers.
  html = html.replace(/<!-- oa-entry-head:start -->[\s\S]*?<!-- oa-entry-head:end -->/g, '')
    .replace(/<!-- oa-entry-body:start -->[\s\S]*?<!-- oa-entry-body:end -->/g, '')
  if (!new RegExp(`<div\\s+id=["']${config.rootId}["'][^>]*>\\s*</div>`).test(html)) throw Error(`Missing empty ${config.rootId} mount point`)
  html = html.replace(/<meta\s+charset=[^>]*>/gi, '').replace(/<head>/i, '<head><meta charset="utf-8">')
    .replace(/<title>[^<]*<\/title>/i, `<title>${config.title}</title>`)
    .replace(/<html lang="[^"]*"/i, '<html lang="zh-CN"')
    .replace(/<link\b[^>]*rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/gi, '')
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*("\s*\/?\s*>)/i, `$1${config.title}$2`)
  const head = `<!-- oa-entry-head:start --><link rel="icon" type="image/svg+xml" href="/wb/favicon.svg"><style>
body:has([data-oa-entry]){margin:0}
[data-oa-entry]{min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px;background:#f6f8fc;color:#182238;font:16px/1.7 system-ui,sans-serif;text-align:center}
[data-oa-entry] h1{font-size:24px;margin:0}[data-oa-entry] p{margin:0;color:#526078}.oa-entry-mark{background:#3370ff;color:white;border-radius:10px;width:44px;height:44px;font-size:30px;font-weight:700;line-height:44px}.oa-entry-spinner{width:24px;height:24px;border:3px solid #dce5fa;border-top-color:#3370ff;border-radius:50%;animation:oa-entry-spin 1s linear infinite}@keyframes oa-entry-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.oa-entry-spinner{animation:none}}
[data-dsh-boot]{min-height:100vh;background:#f6f8fc;--dsh-boot-brand:#3370ff}[data-oa-boot-label]::before{content:"承";display:block;margin:0 auto 16px;background:#3370ff;color:white;border-radius:10px;width:44px;height:44px;font:700 30px/44px system-ui,sans-serif;text-align:center}
[data-oa-boot-label]{font-family:system-ui,sans-serif!important;font-size:24px!important;letter-spacing:normal!important;text-transform:none!important}
[data-oa-entry-recovery]{padding:16px;text-align:center;font:14px/1.7 system-ui,sans-serif}[data-oa-entry-recovery] a,[data-oa-entry-recovery] button{margin:8px;color:#245bea;cursor:pointer}
:root[theme-mode=dark] [data-oa-entry],body[data-ds-dark-theme] [data-dsh-boot],body[data-ds-dark-theme] [data-oa-entry]{background:#181818;color:#eef2fa}:root[theme-mode=dark] [data-oa-entry] p{color:#b6c0d1}
</style><script>(${entryBootstrap.toString()})(${JSON.stringify(config)})</script><!-- oa-entry-head:end -->`
  html = html.replace('</head>', head + '</head>')
  const screen = `<!-- oa-entry-body:start --><section data-oa-entry role="status" aria-live="polite"><span class="oa-entry-mark" aria-hidden="true">承</span><h1>${config.title}</h1><span class="oa-entry-spinner" aria-hidden="true"></span><p data-oa-entry-status>${config.message}</p><noscript>请启用 JavaScript 后重新打开此页面。</noscript></section><!-- oa-entry-body:end -->`
  return html.replace(new RegExp(`(<div\\s+id=["']${config.rootId}["'][^>]*>)\\s*(</div>)`), `$1${screen}$2`)
}

export async function installEntryBranding(root) {
  const targets = [
    ['runtime/upstream/harness/apps/web/index.html', 'assistant'],
    ['runtime/upstream/harness/apps/web/dist/index.html', 'assistant'],
    ['runtime/upstream/harness/apps/web/dist/preview.html', 'assistant'],
    ['WeKnora/frontend/index.html', 'knowledge'],
    ['WeKnora/frontend/dist/index.html', 'knowledge'],
  ]
  const changes = []
  for (const [relative, kind] of targets) {
    const file = path.join(root, relative)
    const previous = await readFile(file, 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return null })
    if (previous === null) continue
    changes.push({ file, next: brandEntryHtml(previous, kind) })
  }
  if (!changes.length) throw Error('No built entrypoints found')
  for (const { file, next } of changes) {
    await writeFile(file + '.oa-entry', next)
    await rename(file + '.oa-entry', file)
  }
  return changes.map(c => c.file)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || fileURLToPath(new URL('../..', import.meta.url)))
  console.log((await installEntryBranding(root)).join('\n'))
}
