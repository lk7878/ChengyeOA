// weknora-search.mjs — 损伤鉴定 preset 的领域检索工具
//
// 注册一个 model-facing 工具 `weknora_search`，调用本地 WeKnora Lite 的
// /api/v1/knowledge-bases/:id/hybrid-search（向量召回，关闭关键词匹配以
// 规避 SQLite FTS5 对中文的语法错误），把命中的标准条文片段回填给模型，
// 由模型据此合成鉴定意见并引用条文。
//
// 认证：本地 Lite 场景用 POST /api/v1/auth/auto-setup 取 JWT（免 API key），
// 缓存并在 401 时自动刷新。
//
// 这是一个静态 Cordis 插件（preset 本地文件），通过 e:\A\package\node_modules
// 的 junction 解析 @deepseek-ai/dsh-tools。修改后重启 Harness 生效。

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'weknora-search'
export const inject = ['tools']

/** 插件配置（由 agent.cordis.yml 的 row config 提供）。必须是 schemastery schema，
 *  cordis 的 resolveConfig 会调 Config["~standard"].validate 来填默认值。 */
export const Config = z.object({
  baseUrl: z.string().default('http://127.0.0.1:8090'),
  kbId: z.string().default(''),
  matchCount: z.number().default(8),
  maxCharsPerChunk: z.number().default(2400),
})

/** 去掉 HTML 表格/标签，压空白，给模型读干净文本。 */
function stripHtml(s) {
  if (!s) return ''
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function apply(ctx, config) {
  const baseUrl = (config.baseUrl || 'http://127.0.0.1:8090').replace(/\/+$/, '')
  const kbId = config.kbId
  const matchCount = config.matchCount || 8
  const maxChars = config.maxCharsPerChunk || 2400

  if (!kbId) {
    // 没配 kbId 就不注册工具，避免运行时一律失败。
    return
  }

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
    tokenExp = Date.now() + 50 * 60 * 1000 // 50 分钟后强制刷新
    return tok
  }

  async function doSearch(query, n) {
    const token = await getToken()
    const body = {
      query_text: query,
      match_count: n,
      disable_keywords_match: true, // 仅向量召回，规避 FTS5 中文语法错误
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
      '检索「标准规范库」知识库（含《人体损伤程度鉴定标准》《人体损伤致残程度分级》《劳动能力鉴定 职工工伤与职业病致残等级》《人身保险伤残评定及代码》（GB/T 44893—2024）《人身损害误工期/护理期/营养期评定规范》《人身损害护理依赖程度评定》等）。' +
      '输入中文检索词，返回最相关的标准条文片段。查具体条款时 query 写标准全称加条款号，例如「人体损伤致残程度分级 5.10.2」。回答伤残、损伤程度或三期问题前先调用本工具，再据片段给出意见并标注【出处：标准名 条款号】。',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: '中文检索查询，描述要查的鉴定标准/条款/情形，例如“踝关节功能丧失 伤残等级”或“多发性肋骨骨折 损伤程度”。',
      },
      matchCount: {
        type: 'number',
        description: '返回片段数量上限，默认 6。',
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
        const content = stripHtml(c.matched_content || c.content || '').slice(0, maxChars)
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
