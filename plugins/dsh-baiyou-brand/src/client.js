import { useEffect, useRef } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { registerOaFileSync } from './oa-file-sync.js'
import { bindOaUpload } from './oa-upload.js'

export const inject = ['slots', 'theme', 'contextMenus']

const TITLE = '智慧办案 AI助手'
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
  ['DSH 本地构建', 'AI 助手'],
  ['DSH Local Build', 'AI 助手'],
])

const CSS = [
  'html[data-oa-harness-role=member] nav[class*="_panelList"]{display:none!important}',
  'html[data-oa-harness-role=member] [data-composer-card]:has(.oa-upload-trigger) button[class*="_add"]{display:none!important}.oa-upload-trigger{border:0;border-radius:50%;min-width:28px;height:28px;cursor:pointer;background:var(--dsw-alias-background-secondary,#f4f5f7);color:inherit;font-size:18px}.oa-upload-trigger[data-admin]{border-radius:6px;font-size:13px;padding:0 8px}',
  '.oa-material-badge{font-size:12px;color:var(--dsw-alias-label-secondary,#52617a);background:none;border:0;cursor:pointer;margin-left:6px}.oa-material-status>div{display:flex;flex-wrap:wrap;gap:8px;padding:12px 0;border-bottom:1px solid #dce2ee}.oa-material-status strong,.oa-material-status span{width:100%;overflow-wrap:anywhere}.oa-upload-dialog{width:min(620px,90vw);max-height:80vh;overflow:auto;padding:24px;border:1px solid #dce2ee;border-radius:16px;background:var(--dsw-alias-background-primary,#fff);color:var(--dsw-alias-label-primary,#182238)}.oa-upload-dialog::backdrop{background:#0006}.oa-upload-dialog p{line-height:1.7}.oa-upload-dialog button{margin:8px;padding:8px 12px;border:1px solid #ccc;border-radius:6px;cursor:pointer}.oa-upload-list>div{display:flex;flex-direction:column;gap:8px;padding:12px 0;overflow-wrap:anywhere}',
  '.by-mark{display:inline-flex;flex:none;border-radius:8px;overflow:hidden}',
  '.by-name{display:flex;flex-direction:column;justify-content:center;line-height:normal;gap:2px;min-width:0;white-space:nowrap}',
  '.by-name__zh{line-height:21px}.by-name__en{line-height:17px}',
  '[class*="_brandIdentity"]:has(.by-name){gap:10px}.by-name{text-align:left;letter-spacing:normal}.by-sidebar-mark text{font-size:20px;font-weight:400}',
  '[class*=\"_brandName\"]:has(.by-name),[class*=\"_brandIdentity\"]:has(.by-name){height:auto;min-height:36px}',
  '.by-name__zh{font-size:15px;font-weight:600;letter-spacing:normal;color:var(--dsw-alias-label-primary)}',
  '.by-name__en{font-size:12px;font-weight:400;letter-spacing:normal;color:var(--dsw-alias-label-secondary)}',
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

function BrandMark({ size = 24, className = '' }) {
  ensureCss()
  const px = Number(size) || 24
  return jsxs('svg', {
    className: 'by-mark '+className,
    viewBox: '0 0 32 32',
    width: px,
    height: px,
    'aria-hidden': 'true',
    fill: 'none',
    dangerouslySetInnerHTML: { __html: MARK },
  })
}

function SidebarBrandMark() { return jsx(BrandMark, {size:32,className:'by-sidebar-mark'}) }

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

export function apply(ctx) {
  registerOaFileSync(ctx)
  function UploadBinding({inputActions,sessionId}) {
    const anchor=useRef(null),isAdmin=window.__oaHarness?.isSuperAdmin===true
    useEffect(()=>bindOaUpload(ctx,inputActions,window,anchor.current),[inputActions,sessionId])
    return jsx('button',{ref:anchor,type:'button',className:'oa-upload-trigger','data-admin':isAdmin?'':undefined,'aria-label':'上传文件到 OA 和当前任务',children:isAdmin?'上传文件':'＋'})
  }
  ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({name:'conversation.input.left',id:'oa-upload'},UploadBinding))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', id: 'welcome-notice', order: -100, priority: -10,
  }, SkipPreviewNotice))
  // Hide the owning settings surface too: keyboard shortcuts must not open it.
  // This flag is injected by the authenticated OA proxy before the native app boots.
  const ModelLabel = () => jsx('span',{'aria-label':'任务模型',children:window.__oaHarness?.model||'任务模型未配置'})
  ctx.slots.inject('conversation.input.model',()=>ctx.slots.register({name:'conversation.input.model',priority:-100},ModelLabel))
  ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'models',order:10,priority:-100,label:()=>'模型'},()=>jsx('p',{children:'请到智慧办案「授权与 AI 管理」配置模型连接及任务策略。'})))
  if (window.__oaHarness?.isSuperAdmin !== true) {
    for (const name of ['conversation.hero.agentPreset','conversation.input.permission']) {
      ctx.slots.inject(name, () => ctx.slots.register({name,priority:-100},HiddenSettings))
    }
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({name:'conversation.session.header.actions',id:'agent-preset',priority:-100},HiddenSettings))
    document.documentElement.dataset.oaHarnessRole = 'member'
    for (const id of ['plugins','schedules']) {
      ctx.slots.inject('main', () => ctx.slots.register({name:'main',key:id,priority:-100},HiddenSettings))
    }
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
    yield ctx.slots.register({ name: 'sidebar.brand.mark', ...brandSeat }, SidebarBrandMark)
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
