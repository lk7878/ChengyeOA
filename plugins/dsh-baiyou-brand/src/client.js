import { jsx, jsxs } from 'react/jsx-runtime'

export const inject = ['slots']

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
  '.by-name{display:flex;flex-direction:column;justify-content:center;line-height:1.15;gap:1px;min-width:0}',
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
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/svg+xml'
  if (link.getAttribute('href') !== FAVICON) link.setAttribute('href', FAVICON)
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

export function apply(ctx) {
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
