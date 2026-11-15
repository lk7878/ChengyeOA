// weknora-search.mjs — 交通事故鉴定 preset 的标准检索工具
//
// 注册 weknora_search，调用本地 WeKnora Lite 的 hybrid-search（只做向量召回）。
// 认证走 POST /api/v1/auth/auto-setup。修改后重启 Harness 生效。

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'weknora-search'
export const inject = ['tools']

export const Config = z.object({
  baseUrl: z.string().default('http://127.0.0.1:8090'),
  kbId: z.string().default(''),
  matchCount: z.number().default(8),
  maxCharsPerChunk: z.number().default(2400),
})

function stripHtml(s) {
  if (!s) return ''
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const UNREADABLE = '无可读条文（页面图片、英文摘要或乱码）。不能当作条款引用，可用条款号再查一次。'

function readableClause(raw) {
  const noImg = String(raw || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  const text = stripHtml(noImg)
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const summary = /^\s*#?\s*summary\b/i.test(text)
  if (han < 20 || (summary && han < 40)) return UNREADABLE
  return text
}

export function apply(ctx, config) {
  const baseUrl = (config.baseUrl || 'http://127.0.0.1:8090').replace(/\/+$/, '')
  const kbId = config.kbId
  const matchCount = config.matchCount || 8
  const maxChars = config.maxCharsPerChunk || 2400

  if (!kbId) return

  let cachedToken = null
  let tokenExp = 0

  async function getToken() {
    if (cachedToken && Date.now() < tokenExp) return cachedToken
    const r = await fetch(baseUrl + '/api/v1/auth/auto-setup', { method: 'POST' })
    if (!r.ok) throw new Error(`weknora auto-setup failed: HTTP ${r.status}`)
    const j = await r.json()
    const tok = j.token || (j.data && j.data.token)
    if (!tok) throw new Error('weknora auto-setup returned no token')
    cachedToken = tok
    tokenExp = Date.now() + 50 * 60 * 1000
    return tok
  }

  async function doSearch(query, n) {
    const token = await getToken()
    const body = {
      query_text: query,
      match_count: n,
      disable_keywords_match: true,
    }
    const url = `${baseUrl}/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/hybrid-search`
    const req = (tok) => fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let r = await req(token)
    if (r.status === 401) {
      cachedToken = null
      r = await req(await getToken())
    }
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      throw new Error(`weknora hybrid-search failed: HTTP ${r.status} ${detail.slice(0, 300)}`)
    }
    const j = await r.json()
    return j.data || []
  }

  ctx.tools.register(defineTool({
    name: 'weknora_search',
    description:
      '检索「标准规范库」。先由 traffic-appraisal-plan 选定一部标准，query 写该书全称加待核问题或条款号。' +
      '只引用标题与该书相符、且内容为可读中文条文的命中，标注【出处：《标准名》条款号】。' +
      '标题不符、页面图片、英文摘要或乱码的命中丢弃。无可读条文时用条款号再查一次，仍没有则写「条款未能核实」。',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: '中文检索词。写标准全称加问题或条款号，例如「道路交通事故车辆速度鉴定 附着系数」或「司法鉴定程序通则 受理」。',
      },
      matchCount: {
        type: 'number',
        description: '返回片段数量上限，默认 8。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer' },
                title: { type: 'string' },
                standard: { type: 'string' },
                score: { type: 'number' },
                content: { type: 'string' },
                chunk_id: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [`【weknora_search 命中 ${value.count} 条】`]
        for (const r of value.results) {
          const src = r.standard ? `${r.title}（${r.standard}）` : r.title
          lines.push(`\n[${r.index}] 《${src}》 score=${r.score}`)
          lines.push(r.content)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const n = args.matchCount || matchCount
      const raw = await doSearch(args.query, n)
      const results = raw.map((c, i) => {
        const meta = c.metadata || {}
        const standard = meta['标准编号'] || meta['标准号'] || ''
        const content = readableClause(c.matched_content || c.content || '').slice(0, maxChars)
        return {
          index: i + 1,
          title: c.knowledge_title || c.knowledge_filename || '',
          standard,
          score: typeof c.score === 'number' ? Number(c.score.toFixed(4)) : 0,
          content,
          chunk_id: c.id || '',
        }
      })
      return { count: results.length, results }
    },
  }))
}
