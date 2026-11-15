// weknora-search.mjs — 医疗损害鉴定：临床知识库 / 标准规范库 / 鉴定方法库 / 脱敏案例库 / 医疗法律知识库
//
// 认证走 WeKnora Lite POST /api/v1/auth/auto-setup。修改后重启 Harness 生效。

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { isClinicalCareQuery } from './report-text.mjs'

export const name = 'weknora-search'
export const inject = ['tools']

export const Config = z.object({
  baseUrl: z.string().default('http://127.0.0.1:8090'),
  kbId: z.string().default(''),
  matchCount: z.number().default(6),
  maxCharsPerChunk: z.number().default(1200),
  methodKbId: z.string().default(''),
  caseKbId: z.string().default(''),
  lawKbId: z.string().default(''),
  clinicalKbId: z.string().default(''),
})

function stripHtml(s) {
  if (!s) return ''
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function resultSchema() {
  return {
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
            query: { type: 'string' },
          },
        },
      },
    },
  }
}

export function apply(ctx, config) {
  const baseUrl = (config.baseUrl || 'http://127.0.0.1:8090').replace(/\/+$/, '')
  const matchCount = config.matchCount || 6
  const maxChars = config.maxCharsPerChunk || 1200

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

  async function doSearch(kbId, query, n) {
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

  function mapResults(raw) {
    return raw.map((c, i) => {
      const meta = c.metadata || {}
      const standard = meta['标准编号'] || meta['标准号'] || meta['案例编号'] || ''
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
  }

  function registerOne({ toolName, kbId, description, queryHint, label }) {
    if (!kbId) return
    ctx.tools.register(defineTool({
      name: toolName,
      description,
      isConcurrencySafe: () => true,
      parameters: {
        query: {
          type: 'string',
          description: queryHint,
        },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: '最多 4 条检索词，一次并行查询。能合并就不要连打多次本工具。',
        },
        matchCount: {
          type: 'number',
          description: '每条查询返回片段上限，默认 4。',
        },
      },
      output: {
        schema: resultSchema(),
        render: (_args, value) => {
          const lines = [`【${label} 命中 ${value.count} 条】`]
          for (const r of value.results) {
            const src = r.standard ? `${r.title}（${r.standard}）` : r.title
            const q = r.query ? ` q=${r.query}` : ''
            lines.push(`\n[${r.index}] 《${src}》 score=${r.score}${q}`)
            lines.push(r.content)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args) {
        const n = args.matchCount || Math.min(matchCount, 4)
        const list = []
        if (args.query && String(args.query).trim()) list.push(String(args.query).trim())
        for (const q of args.queries || []) {
          const t = String(q || '').trim()
          if (t && !list.includes(t)) list.push(t)
        }
        if (!list.length) throw new Error('query 或 queries 至少提供一个')
        const uniq = list.slice(0, 4)
        if (toolName === 'weknora_search') {
          const blocked = uniq.filter((q) => isClinicalCareQuery(q))
          if (blocked.length) {
            throw new Error(
              `拦截：weknora_search 不能查临床诊疗（本次：${blocked.join('；')}）。请立即改调 weknora_clinical 查临床知识库，并用 expected_care_plan 生成应然方案。伤残/病历书写/SF/T 才用本工具。`,
            )
          }
        }
        const batches = await Promise.all(uniq.map((q) => doSearch(kbId, q, n)))
        const results = []
        for (let i = 0; i < batches.length; i++) {
          for (const item of mapResults(batches[i])) {
            results.push({ ...item, query: uniq[i], index: results.length + 1 })
          }
        }
        return { count: results.length, results }
      },
    }))
  }

  registerOne({
    toolName: 'weknora_search',
    kbId: config.kbId,
    label: 'weknora_search',
    description:
      '检索「标准规范库」（SF/T 0097、病历书写规范、知情同意规范、伤残/损伤标准等）。' +
      '仅用于伤残评残、病历书写、鉴定程序类条文。禁止查手术指征、诊疗指南、漏诊、适应证（会被拦截）。临床指南/教科书/专家共识必须用 weknora_clinical（临床知识库）和 expected_care_plan。优先用 queries 一次并行多词，不要连打本工具。引用标【出处：规范名 条款】。不得编造未检索到的条文。',
    queryHint: '中文检索词，例如“人体损伤致残程度分级 椎体压缩”“病历书写规范 首次病程”“知情同意 手术”。',
  })
  registerOne({
    toolName: 'weknora_method',
    kbId: config.methodKbId,
    label: 'weknora_method',
    description:
      '检索「鉴定方法库」（《医疗损害鉴定技术指引》第2–5章：过错子类型、21种疾病鉴定模板、意见书与因果论证、尸检要点）。' +
      '认定过错子类型、套疾病模板、写分析说明结构时使用。波次 C 用 queries 一次最多 4 条：疾病或术式+过错、过错子类型、原因力方法、争议点。引用须标【出处：技术指引 章节 印刷页】。方法库不是国家标准，效力低于 SF/T 0097。',
    queryHint: '中文检索词，例如“甲状腺手术 喉返神经”“机会丧失 三要件”“意见书 因果关系论证”“骨折 关节功能障碍 原因力”。',
  })
  registerOne({
    toolName: 'weknora_cases',
    kbId: config.caseKbId,
    label: 'weknora_cases',
    description:
      '检索「脱敏案例库」（书内教学案例，非判例）。用于类案参考。查询尽量带上疾病+过错类型+原因力。' +
      '类案只作分析对照，不得写成“按该案判决/先例”，不得把书内原因力百分比写入本案鉴定意见。',
    queryHint: '中文检索词，例如“主动脉夹层 诊断过错 完全原因”“腹腔镜 胆管损伤 主要原因”“错误出生 知情告知”。',
  })
  registerOne({
    toolName: 'weknora_law',
    kbId: config.lawKbId,
    label: 'weknora_law',
    description:
      '检索「医疗法律知识库」（法律法规、司法解释、部门规章与批复，如民法典医疗损害节录、医疗纠纷预防和处理条例、医疗损害责任纠纷司法解释）。' +
      '论证法律依据、鉴定管理、告知与责任条文时使用。标注【出处：法规名 条款】。不得编造未检索到的条文。',
    queryHint: '中文检索词，例如“医疗损害责任纠纷 司法解释 过错”“知情同意 条例”“病历 复印 条例”“鉴定 回避”。',
  })
  registerOne({
    toolName: 'weknora_clinical',
    kbId: config.clinicalKbId,
    label: 'weknora_clinical',
    description:
      '检索「临床知识库」（全科临床指南、专家共识、教科书节录）。用于手术指征、诊疗规范、适应证/禁忌、应然方案原文。' +
      '来源位阶：教科书 > 临床指南 > 专家共识。引用标【出处：指南或共识全称 年份】。未命中标【医学常识】，禁止编造条款号。' +
      '波次 C 与 expected_care_plan 同轮发出：本工具取原文片段，expected_care_plan 生成应然对照。优先用 queries 一次并行多词（建议诊断+指南、术式+适应证禁忌、争议点）。' +
      '评残/病历书写不要用本工具（改 weknora_search）。不要再用 web_search 重复搜同一疾病指南。',
    queryHint: '中文检索词，例如“胸腰椎骨折 诊疗指南”“椎体成形术 适应证 禁忌证”“骨质疏松性椎体压缩骨折 专家共识”。',
  })
}
