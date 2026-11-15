/**
 * Harness 右侧栏 Word 预览：把 .docx 注册为 bytes-complete 渲染器，
 * 避免落入纯文本读取（会报「非文本文件，暂时无法预览」）。
 */
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useMemo, useState } from 'react'
import mammoth from 'mammoth'

const BODY_ID = 'dsh-docx-preview/docx'
const CSS_ID = 'dsh-docx-preview/body.css'

const CSS = [
  '.dshdx-root{box-sizing:border-box;width:100%;height:100%;min-height:240px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff)}',
  '.dshdx-frame{border:none;width:100%;height:100%;min-height:240px;background:#fff;display:block;flex:1}',
  '.dshdx-status{box-sizing:border-box;width:100%;min-height:100%;margin:0;padding:16px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;display:flex;align-items:center;justify-content:center;text-align:center}',
].join('')

if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-docx-preview'
  tag.dataset.pluginCss = CSS_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

function wrapHtml(body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#fff;}
  body{font-family:-apple-system,"Microsoft YaHei",Segoe UI,Roboto,sans-serif;line-height:1.75;color:#1f2329;padding:28px 36px;max-width:880px;margin:0 auto;}
  table{border-collapse:collapse;width:100%;margin:12px 0;}
  th,td{border:1px solid #d0d3d8;padding:6px 10px;text-align:left;vertical-align:top;}
  th{background:#f3f5f7;}
  h1,h2,h3{margin-top:1.4em;}
  p{margin:0.6em 0;}
  img{max-width:100%;}
  a{color:#1677ff;}
</style></head><body>${body || '<p>（文档为空）</p>'}</body></html>`
}

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data.slice(0)
  const view = data instanceof Uint8Array ? data : new Uint8Array(data)
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
}

function DocxBody({ content, scrollportRef }) {
  const bytes = content?.kind === 'bytes' ? content.data : undefined
  const [html, setHtml] = useState(null)
  const [error, setError] = useState(null)

  const token = useMemo(() => bytes, [bytes])

  useEffect(() => {
    if (!token) {
      setHtml(null)
      setError(null)
      return
    }
    let cancelled = false
    setHtml(null)
    setError(null)
    mammoth.convertToHtml({ arrayBuffer: toArrayBuffer(token) })
      .then((result) => {
        if (cancelled) return
        setHtml(wrapHtml(result.value))
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.message || String(e))
      })
    return () => { cancelled = true }
  }, [token])

  if (!bytes) {
    return jsx('p', { className: 'dshdx-status', role: 'status', children: '正在读取 Word 文档…' })
  }
  if (error) {
    return jsx('p', { className: 'dshdx-status', role: 'alert', children: `无法预览该 Word 文件：${error}` })
  }
  if (!html) {
    return jsx('p', { className: 'dshdx-status', role: 'status', children: '正在转换为可预览格式…' })
  }
  return jsxs('div', {
    className: 'dshdx-root',
    ref: scrollportRef,
    children: [
      jsx('iframe', {
        className: 'dshdx-frame',
        srcDoc: html,
        sandbox: 'allow-same-origin',
        title: 'Word 文档预览',
      }),
    ],
  })
}

export const inject = ['slots', 'documentPreviews']

export function apply(ctx) {
  ctx.effect(() => ctx.documentPreviews.register({
    id: BODY_ID,
    extensions: ['docx'],
    priority: 'extension',
    title: () => 'Word',
    loading: 'bytes-complete',
    wrap: false,
  }), 'dsh-docx-preview: metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document',
    key: BODY_ID,
  }, DocxBody)), 'dsh-docx-preview: body')
}
