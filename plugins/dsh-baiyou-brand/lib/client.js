window.__ModuleLoader__.load({ id: "dsh-baiyou-brand", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var { useEffect } = require("react");
var { jsx, jsxs } = require("react/jsx-runtime");
// Native file menus use workspace paths; the OA broker accepts reviewed snapshot keys.
// Never turn a displayed file path directly into an upload request.
function outputPath(path) {
  if (typeof path !== 'string' || /[\\\0]/.test(path)) return null
  const relative = path.startsWith('/workspace/') ? path.slice(11) : path
  const parts = relative.split('/')
  if (!['reports', 'drafts'].includes(parts[0]) || parts.length < 2 ||
      parts.some(part => !part || part === '.' || part === '..')) return null
  return relative
}

function registerOaFileSync(ctx, browser = window) {
  const taskId = /^\/harness\/([a-f0-9-]{36})(?:\/|$)/i.exec(browser.location.pathname)?.[1]
  if (!taskId) return
  const pending = new Set()
  const api = async (suffix, body) => {
    const response = await browser.fetch(`/api/tasks/${taskId}/${suffix}`, {
      credentials: 'include',
      ...(body === undefined ? {} : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw Error(data.message || data.error ||
      (response.status === 401 ? '登录已失效，请重新登录 OA 后再同步。' : '同步服务暂不可用，请稍后重试。'))
    return data
  }
  ctx.effect(() => ctx.contextMenus.register({
    id: 'oa.sync-file', target: 'file', order: 300,
    resolve: ({ path }) => {
      const relative = outputPath(path)
      if (!relative) return []
      return [{
        id: 'sync', label: '同步OA工作空间', disabled: pending.has(relative),
        run: async () => {
          if (pending.has(relative)) return
          pending.add(relative)
          try {
            ctx.contextMenus.notify('正在检查文件版本…', true)
            const { items } = await api('outputs')
            const file = items?.find(item => item.path === relative)
            if (!file) throw Error('文件不存在或仍在生成中，请等待生成完成后重试。仅支持同步 reports、drafts 中的成果文件。')
            if (file.saved) {
              ctx.contextMenus.notify('此版本已同步，请到承业空间 → 我的资源 → 我的文件查看。', true)
              return
            }
            if (!browser.confirm(`同步OA工作空间\n\n文件：${file.path}\n大小：${Math.ceil(file.size / 1024)} KB\n当前版本：${file.sha256.slice(0, 10)}\n\n保存到：承业空间 → 我的资源 → 我的文件\n只同步这份文件的当前版本；后续修改不会自动同步。此操作不等同于正式归档。\n\n确认同步？`)) return
            ctx.contextMenus.notify('正在同步到 OA，请稍候…', true)
            const task = await api('save', { selection: [file.key] })
            if (task.outputs?.[file.key]?.status !== 'SAVED') throw Error('尚未确认保存成功，请刷新成果列表后重试。')
            ctx.contextMenus.notify(`“${file.name}”已同步到承业空间 → 我的资源 → 我的文件。`, true)
          } catch (error) {
            ctx.contextMenus.notify(`同步失败：${error.message || '请稍后重试'}`, false)
          } finally {
            pending.delete(relative)
          }
        },
      }]
    },
  }), 'oa: explicit single file synchronization')
}

const inject = ['slots', 'theme', 'contextMenus']

const TITLE = '承业智慧办案 · AI 助手'
const CSS_ID = 'dsh-baiyou-brand/css'
const MARK = '<rect width="32" height="32" rx="9" fill="#3370ff"/><text x="16" y="23" text-anchor="middle" fill="white" font-size="23" font-family="sans-serif" font-weight="700">承</text>'
const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${MARK}</svg>`)}`

const EXACT = new Map([
  ['探索未至之境', '开始本次办案任务'],
  ['Into the Unknown', '开始本次办案任务'],
  ['预览版', ''],
  ['Preview', ''],
  ['Preview Notice', '使用说明'],
  ['配置 DeepSeek 官方模型，即可开始使用。', '模型由系统管理员统一配置。'],
  ['Configure the official DeepSeek provider to start building.', '模型由系统管理员统一配置。'],
  ['内测声明', '使用说明'],
  ['Internal Testing Notice', '使用说明'],
  ['HARNESS', '承业智慧办案'],
  ['DeepSeek Harness', '承业智慧办案'],
  ['深度求索中', '正在分析'],
  ['DSH 本地构建', 'AI 助手'],
  ['DSH Local Build', 'AI 助手'],
])

const CSS = [
  '.by-mark{display:inline-flex;flex:none;border-radius:8px;overflow:hidden}',
  '.by-name{display:flex;flex-direction:column;justify-content:center;line-height:normal;gap:2px;min-width:0;white-space:nowrap}',
  '.by-name__zh{line-height:18px}.by-name__en{line-height:14px}',
  '[class*=\"_brandName\"]:has(.by-name),[class*=\"_brandIdentity\"]:has(.by-name){height:auto;min-height:36px}',
  '.by-name__zh{font-size:13px;font-weight:700;letter-spacing:.04em;color:var(--dsw-alias-label-primary)}',
  '.by-name__en{font-size:10px;font-weight:600;letter-spacing:.14em;color:var(--dsw-alias-label-secondary)}',
].join('')

function ensureCss() {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-baiyou-brand'
  tag.dataset.pluginCss = CSS_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

function markSvg(size) {
  const px = Number(size) || 24
  return `<svg class="by-mark" viewBox="0 0 32 32" width="${px}" height="${px}" aria-hidden="true">${MARK}</svg>`
}

function BrandMark({ size = 24 }) {
  ensureCss()
  const px = Number(size) || 24
  return jsxs('svg', {
    className: 'by-mark',
    viewBox: '0 0 32 32',
    width: px,
    height: px,
    'aria-hidden': 'true',
    fill: 'none',
    dangerouslySetInnerHTML: { __html: MARK },
  })
}

function BrandName() {
  ensureCss()
  return jsxs('span', {
    className: 'by-name',
    children: [
      jsx('span', { className: 'by-name__zh', children: '承业智慧办案' }),
      jsx('span', { className: 'by-name__en', children: 'AI 助手' }),
    ],
  })
}

function applyTitle() {
  if (typeof document === 'undefined') return
  if (document.title !== TITLE) document.title = TITLE
}

function applyFavicon() {
  if (typeof document === 'undefined') return
  // The native page declares separate light and dark icons. Replace both so
  // the browser cannot select an unbranded icon when its color scheme changes.
  let links = [...document.querySelectorAll('link[rel~="icon"]')]
  if (!links.length) {
    const link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
    links = [link]
  }
  for (const link of links) {
    link.type = 'image/svg+xml'
    if (link.getAttribute('href') !== FAVICON) link.setAttribute('href', FAVICON)
  }
}

function officialArtwork(svg) {
  if (svg.classList.contains('by-mark') || svg.closest('.by-mark')) return false
  const drawn = [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d') || '').join(' ')
  if (drawn.includes('48.8354')) return true
  if (drawn.startsWith('M22.403') || drawn.startsWith('M23.271')) return true
  const box = svg.getAttribute('viewBox') || ''
  return box === '26 0 156 24' || box === '0 0 182 24'
}

function replaceArtwork(svg) {
  if (svg.dataset.byPatched === '1') return
  svg.dataset.byPatched = '1'
  const box = svg.getAttribute('viewBox') || ''
  const wordmark = box === '26 0 156 24' || box === '0 0 182 24'
  if (wordmark) {
    const name = document.createElement('span')
    name.className = 'by-name'
    name.innerHTML = '<span class="by-name__zh">承业智慧办案</span><span class="by-name__en">AI 助手</span>'
    svg.replaceWith(name)
    return
  }
  const width = Number.parseFloat(svg.getAttribute('width') || '') || 24
  const holder = document.createElement('span')
  holder.innerHTML = markSvg(width)
  svg.replaceWith(holder.firstChild)
}

function patchLabels() {
  const nodes = document.querySelectorAll('span, p, h1, h2, div')
  for (const el of nodes) {
    if (el.childNodes.length !== 1 || el.firstChild.nodeType !== Node.TEXT_NODE) continue
    if (el.closest('textarea, input, pre, code, [contenteditable="true"]')) continue
    const text = el.textContent || ''
    if (/^单页内容超过 .+ 上限，无法读取$/.test(text)) { el.textContent = text.replace('单页内容', '文件内容') + '。请缩小文件后重试。'; continue }
    if (EXACT.has(text)) {
      const next = EXACT.get(text)
      if (!next) {
        el.hidden = true
        continue
      }
      if (text !== next) el.textContent = next
      continue
    }
    if (text.startsWith('深度求索中') && text.length < 100) { el.textContent = text.replace('深度求索中', '正在分析'); continue }
    if (text.includes('DeepSeek Harness') && text.length > 80) {
      el.textContent = text.replaceAll('DeepSeek Harness', '承业智慧办案')
    }
  }
}

function patchOfficialDom() {
  if (typeof document === 'undefined') return
  ensureCss()
  applyTitle()
  applyFavicon()
  document.querySelectorAll('svg').forEach((svg) => {
    if (officialArtwork(svg)) replaceArtwork(svg)
  })
  patchLabels()
}

// Shadow the upstream onboarding step using its public slot contract. This
// completes the coordinator without showing a modal or storing fake acceptance.
function SkipPreviewNotice({ complete }) {
  useEffect(() => { complete() }, [complete])
  return null
}
function HiddenSettings() { return null }

function apply(ctx) {
  registerOaFileSync(ctx)
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', id: 'welcome-notice', order: -100, priority: -10,
  }, SkipPreviewNotice))
  // Hide the owning settings surface too: keyboard shortcuts must not open it.
  // This flag is injected by the authenticated OA proxy before the native app boots.
  if (window.__oaHarness?.isSuperAdmin !== true) {
    ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
      name: 'sidebar.settings', priority: -10,
    }, HiddenSettings))
  }

  const syncTheme = event => ctx.theme.setTheme(event?.detail || window.__oaTheme || 'light');
  window.addEventListener('oa-theme-change', syncTheme);
  if (window.__oaTheme) syncTheme();
  const themeScript = document.createElement('script');
  themeScript.src = '/api/oa/theme.js';
  document.head.appendChild(themeScript);
  ctx.effect(() => () => { window.removeEventListener('oa-theme-change', syncTheme); themeScript.remove(); }, 'oa-theme-sync');
  ensureCss()
  applyTitle()
  applyFavicon()
  patchOfficialDom()
  const timer = setInterval(patchOfficialDom, 1500)
  ctx.effect(() => () => clearInterval(timer), 'dsh-baiyou-brand: title')

  const brandSeat = { priority: -1 }
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', function* () {
    yield ctx.slots.register({ name: 'sidebar.brand.mark', ...brandSeat }, BrandMark)
    yield ctx.slots.register({ name: 'sidebar.brand.name', ...brandSeat }, BrandName)
  }))
  ctx.slots.inject('conversation.hero.brand.mark', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.brand.mark', ...brandSeat }, BrandMark)
  })

  if (typeof document !== 'undefined') {
    const observer = new MutationObserver(patchOfficialDom)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    ctx.effect(() => () => observer.disconnect(), 'oa-brand: observer')
  }
}

exports.inject = inject; exports.apply = apply;
return module.exports; } });
