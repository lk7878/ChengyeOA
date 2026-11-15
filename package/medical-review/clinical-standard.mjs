// 应然诊疗：优先检索本地「临床知识库」，不足时再 Google + 正文摘录，由 gemini-3.8-flash 对照医方过错。
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const name = 'clinical-standard'
export const inject = ['tools']

const CLOSE_BASE = 'https://api.openai-proxy.org'
const SEARCH_PATH = '/api/v1/plugins/google-search'
const CHAT_PATH = '/v1/chat/completions'
const MODEL = 'gemini-3.8-flash'

export const Config = z.object({
  baseUrl: z.string().default(CLOSE_BASE),
  model: z.string().default(MODEL),
  weknoraUrl: z.string().default('http://127.0.0.1:8090'),
  clinicalKbId: z.string().default(''),
})

function parseEnvValue(value) {
  let next = String(value || '').trim()
  if ((next.startsWith('"') && next.endsWith('"')) || (next.startsWith("'") && next.endsWith("'"))) {
    return next.slice(1, -1).trim()
  }
  const hash = next.search(/\s+#/)
  return (hash >= 0 ? next.slice(0, hash) : next).trim()
}

function sanitizeApiKey(value) {
  return parseEnvValue(value).replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, '')
}

function setEnvIfMissing(key, value) {
  if (key && value && process.env[key] == null) process.env[key] = value
}

function loadDshEnv() {
  const envFile = 'E:/A/.dsh/.env'
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    setEnvIfMissing(trimmed.slice(0, eq).trim(), parseEnvValue(trimmed.slice(eq + 1)))
  }
}

function loadDshCredentials() {
  const credFile = path.join(process.env.DSH_HOME || 'E:/A/.dsh', '.credentials.yaml')
  if (!existsSync(credFile)) return
  const text = readFileSync(credFile, 'utf8')
  const m = text.match(/^\s*CLOSEAI_API_KEY:\s*(\S+)\s*$/m)
  if (m) setEnvIfMissing('CLOSEAI_API_KEY', sanitizeApiKey(m[1]))
}

loadDshEnv()
loadDshCredentials()
if (process.env.CLOSEAI_API_KEY) {
  process.env.CLOSEAI_API_KEY = sanitizeApiKey(process.env.CLOSEAI_API_KEY)
}

function apiKey() {
  const key = sanitizeApiKey(process.env.CLOSEAI_API_KEY || '')
  if (!key) throw new Error('未找到 CLOSEAI_API_KEY（.dsh/.env 或 .credentials.yaml）')
  return key
}

let wkToken = ''
let wkTokenExp = 0

async function weknoraToken(weknoraUrl) {
  if (wkToken && Date.now() < wkTokenExp) return wkToken
  const r = await fetch(`${weknoraUrl.replace(/\/+$/, '')}/api/v1/auth/auto-setup`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) throw new Error(`weknora auto-setup HTTP ${r.status}`)
  const j = await r.json()
  const tok = j.token || (j.data && j.data.token)
  if (!tok) throw new Error('weknora auto-setup 未返回 token')
  wkToken = tok
  wkTokenExp = Date.now() + 50 * 60 * 1000
  return tok
}

async function searchClinicalKb(weknoraUrl, kbId, queries, matchCount = 4) {
  if (!kbId) return []
  const base = weknoraUrl.replace(/\/+$/, '')
  const token = await weknoraToken(base)
  const batches = await Promise.all(queries.map(async (query) => {
    const url = `${base}/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/hybrid-search`
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query_text: query,
        match_count: matchCount,
        disable_keywords_match: true,
      }),
      signal: AbortSignal.timeout(45000),
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      throw new Error(`临床知识库检索失败 HTTP ${r.status} ${detail.slice(0, 200)}`)
    }
    const j = await r.json()
    return (j.data || []).map((c) => ({
      title: String(c.knowledge_title || c.knowledge_filename || '').replace(/\.md$/i, ''),
      snippet: stripHtml(c.matched_content || c.content || '').slice(0, 1200),
      link: `临床知识库://${c.knowledge_title || c.knowledge_filename || '文献'}`,
      origin: 'local',
      query,
    }))
  }))
  return batches.flat()
}

function classifyHit(item) {
  const blob = `${item.title || ''} ${item.snippet || ''} ${item.link || ''}`
  if (/工伤|职业病致残|劳动能力鉴定|人体损伤致残|GB\/T\s*16180|SF\/T\s*0097/.test(blob)) {
    return { kind: 'disability', rank: 99, label: '评残标准（不用于诊疗）' }
  }
  if (/教材|教科书|内科学|外科学|妇产科学|儿科学|诊断学|人民卫生|人卫版|本科教材/.test(blob)) {
    return { kind: 'textbook', rank: 1, label: '教科书' }
  }
  if (/临床指南|诊疗指南|诊疗规范|指导原则|指导规范|实践指南|clinical guideline|practice guideline/.test(blob)) {
    return { kind: 'guideline', rank: 2, label: '临床指南' }
  }
  if (/专家共识|专家建议|共识意见|consensus/.test(blob)) {
    return { kind: 'consensus', rank: 3, label: '专家共识' }
  }
  return { kind: 'other', rank: 4, label: '其他文献' }
}

function buildQueries({ diagnosis, focus, eventYear, extra, procedures, hospitalLevel }) {
  const d = String(diagnosis || '').trim()
  const year = String(eventYear || '').trim() || String(new Date().getFullYear())
  const proc = String(procedures || '').trim()
  const f = String(focus || '').trim()
  const level = String(hospitalLevel || '').trim()
  const auto = [
    `${d} 临床指南 诊疗规范 ${year}`,
    proc ? `${proc} 临床指南 适应证 禁忌证 ${year}` : `${d} 适应证 禁忌证 临床指南`,
    f ? `${d} ${f} 指南 适用范围` : `${d} 专家共识 ${year}`,
    `${d} 教科书 外科学 内科学 诊疗原则`,
  ]
  if (proc && f) auto.push(`${proc} ${f} 预防 指南 禁忌`)
  if (level) auto.push(`${d} ${level} 诊疗常规`)
  const list = []
  for (const q of extra) {
    const t = String(q || '').trim()
    if (t && !list.includes(t)) list.push(t)
  }
  for (const q of auto) {
    if (q && !list.includes(q)) list.push(q)
  }
  return list.slice(0, 6)
}

function parseSearchBody(body) {
  if (Array.isArray(body)) return body
  if (!body || typeof body !== 'object') return []
  const data = body.data || body.results || body.items || body.organic || []
  return Array.isArray(data) ? data : []
}

function extractJson(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new Error('模型未返回内容')
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON')
  return JSON.parse(candidate.slice(start, end + 1))
}

function formatSources(hits) {
  return hits.map((h, i) => {
    const where = h.origin === 'local' ? '临床知识库' : h.label
    const tag = `[${i + 1}]【${where}】`
    const loc = h.origin === 'local' ? '（本地知识库原文）' : (h.link || '')
    return `${tag} ${h.title}\n${loc}\n${h.snippet}`
  }).join('\n\n')
}

function asTextList(value) {
  if (!value) return ''
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      if (item && typeof item === 'object') {
        const title = item.title || item.name || `第${i + 1}项`
        const expected = item.expected || item.norm || ''
        const actual = item.actual || ''
        const deviation = item.deviation || item.analysis || item.detail || ''
        const source = item.source || ''
        return [
          `${i + 1}. ${title}`,
          expected ? `应然：${expected}` : '',
          actual ? `实然：${actual}` : '',
          deviation ? `偏离：${deviation}` : '',
          source ? `出处：${source}` : '',
        ].filter(Boolean).join('\n')
      }
      return `${i + 1}. ${String(item)}`
    }).join('\n\n')
  }
  return String(value)
}

function asNames(value) {
  const deny = /工伤|职业病致残|劳动能力鉴定|人体损伤致残|GB\/T\s*16180|SF\/T\s*0097/
  const names = []
  const push = (s) => {
    const t = String(s || '').trim()
    if (t && !deny.test(t)) names.push(t)
  }
  if (!value) return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object') push(item.name || item.title || '')
      else push(item)
    }
  } else {
    String(value).split(/[\n；;]+/).forEach(push)
  }
  return names.join('；')
}

export function apply(ctx, config) {
  const baseUrl = String(config.baseUrl || CLOSE_BASE).replace(/\/+$/, '')
  const model = config.model || MODEL
  const weknoraUrl = String(config.weknoraUrl || 'http://127.0.0.1:8090')
  const clinicalKbId = String(config.clinicalKbId || '')

  ctx.tools.register(defineTool({
    name: 'expected_care_plan',
    description:
      '生成患者应然诊疗方案，并与医方已实施行为对照、列出可能过错。优先检索本地「临床知识库」，命中不足时再谷歌补检索，由 gemini-3.8-flash 综合。' +
      '来源位阶必须是：教科书 > 临床指南 > 专家共识；先核对该指南是否适用于本案术式/病情/医院等级，再对照过错。' +
      '必须同时分析禁忌证与当时可实施性，禁止用事后确诊的并发症倒推当时义务，禁止编造评分分值或条款号。' +
      '波次 C 每案只调用一次；跳过解析/重新鉴定时仍必须调用。同轮并行 weknora_clinical 取原文片段。' +
      '不要用 weknora_search 查临床指南（会被拦截），也不要再用 web_search 重复搜同一疾病指南。' +
      '伤残标准、病历书写规范、鉴定方法仍用 weknora_search / weknora_method。',
    isConcurrencySafe: () => true,
    parameters: {
      diagnosis: {
        type: 'string',
        description: '主诊断、关键病情或术式，例如“急性缺血性脑卒中”“腹腔镜胆囊切除术”。多诊断用顿号连接。',
      },
      actual_care: {
        type: 'string',
        description:
          '医方已实施诊疗摘要：时间链、检查、诊断、用药、手术/操作、观察、转诊、告知。只写病历已有事实，拟行未做不要写成已做。建议 400–2000 字，含关键数值。',
      },
      hospital_level: {
        type: 'string',
        description: '可选。医院等级与科室，例如“二级甲等县医院胸外科”“三级甲等综合医院骨科”。用于校准当时当地注意义务。',
      },
      procedures: {
        type: 'string',
        description: '可选。已实施的主要手术/操作名称，例如“右锁骨粉碎性骨折切开复位内固定术、胸腔闭式引流”。',
      },
      contraindications: {
        type: 'string',
        description: '可选。当时可能限制某项措施的因素，例如“创伤性血气胸、胸腔引流、多发肋骨骨折、活动性出血风险”。',
      },
      focus: {
        type: 'string',
        description: '可选。争议点，例如“静脉溶栓时间窗”“围手术期 VTE 预防”“手术时机”。',
      },
      event_year: {
        type: 'string',
        description: '可选。诊疗发生年份，用于检索当时指南，例如“2022”。',
      },
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: '可选。额外检索词，最多 6 条（含自动生成）。能合并就不要连打本工具。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          search_count: { type: 'integer' },
          sources: { type: 'string' },
          expected_plan: { type: 'string' },
          comparison: { type: 'string' },
          possible_faults: { type: 'string' },
          no_fault: { type: 'string' },
          scope_check: { type: 'string' },
          contraindication_check: { type: 'string' },
          appendix_guidelines: { type: 'string' },
          caveats: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `【应然诊疗方案】检索 ${value.search_count} 条`,
          '',
          '## 来源（教科书>临床指南>专家共识）',
          value.sources || '（无）',
          '',
          '## 应然诊疗方案',
          value.expected_plan || '（无）',
          '',
          '## 应然与实然对照',
          value.comparison || '（无）',
          '',
          '## 可能的医疗过错',
          value.possible_faults || '根据现有材料，未发现明显不当。',
          '',
          '## 符合规范的对照',
          value.no_fault || '（无）',
          '',
          '## 指南适用范围',
          value.scope_check || '（无）',
          '',
          '## 禁忌与可实施性',
          value.contraindication_check || '（无）',
          '',
          '## 已核实规范（附录）',
          value.appendix_guidelines || '（无）',
          '',
          '## 局限',
          value.caveats || '（无）',
        ].join('\n'),
      }],
    },
    async execute(args) {
      const diagnosis = String(args.diagnosis || '').trim()
      const actual = String(args.actual_care || '').trim()
      if (!diagnosis) throw new Error('diagnosis 不能为空')
      if (!actual) throw new Error('actual_care 不能为空：必须提供医方已实施诊疗摘要才能对照过错')

      const queries = buildQueries({
        diagnosis,
        focus: args.focus,
        eventYear: args.event_year,
        extra: args.queries || [],
        procedures: args.procedures,
        hospitalLevel: args.hospital_level,
      })
      const key = apiKey()
      let localRaw = []
      let localNote = ''
      if (clinicalKbId) {
        try {
          localRaw = await searchClinicalKb(weknoraUrl, clinicalKbId, queries, 4)
        } catch (err) {
          localNote = `临床知识库检索失败：${err.message}。已改用在线检索。`
        }
      }
      const localGood = rankHits(localRaw).filter((h) => h.rank <= 3).length
      let webRaw = []
      if (localGood < 6) {
        try {
          webRaw = await searchAll(baseUrl, key, queries)
        } catch (err) {
          if (!localRaw.length) throw err
          localNote = [localNote, `在线检索失败：${err.message}`].filter(Boolean).join(' ')
        }
      }
      const ranked = rankHits([...localRaw, ...webRaw]).slice(0, 18)
      const searchBlock = [
        localNote,
        formatSources(ranked),
      ].filter(Boolean).join('\n\n')
      const fetched = await fetchTopSources(ranked.filter((h) => h.origin !== 'local'))
      const generated = await generatePlan(baseUrl, key, model, {
        diagnosis,
        actual,
        focus: String(args.focus || '').trim(),
        eventYear: String(args.event_year || '').trim(),
        hospitalLevel: String(args.hospital_level || '').trim(),
        procedures: String(args.procedures || '').trim(),
        contraindications: String(args.contraindications || '').trim(),
        searchBlock,
        fetchedBlock: fetched,
      })
      return {
        search_count: ranked.length,
        sources: searchBlock || '本次检索未返回可用条目，应然方案主要依据模型医学知识，条款须标【医学常识】。',
        expected_plan: String(generated.expected_plan || '').trim(),
        comparison: String(generated.comparison || '').trim(),
        possible_faults: asTextList(generated.possible_faults) || '根据现有材料，未发现明显不当。',
        no_fault: asTextList(generated.no_fault || generated.no_fault_items),
        scope_check: String(generated.scope_check || generated.guideline_scope || '').trim(),
        contraindication_check: String(generated.contraindication_check || generated.contraindications || '').trim(),
        appendix_guidelines: asNames(generated.appendix_guidelines || generated.sources_used),
        caveats: String(generated.caveats || '').trim(),
      }
    },
  }))
}

function rankHits(hits) {
  const seen = new Set()
  const out = []
  for (const raw of hits) {
    const link = String(raw.link || raw.url || '').trim()
    const title = String(raw.title || '').trim()
    const snippet = String(raw.snippet || raw.description || '').trim()
    const key = raw.origin === 'local'
      ? `local:${title}::${snippet.slice(0, 48)}`
      : (link || title).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const cls = classifyHit({ title, snippet, link })
    if (cls.rank >= 99) continue
    out.push({
      title: title || link,
      link,
      snippet: snippet.slice(0, 700),
      kind: cls.kind,
      rank: cls.rank,
      label: cls.label,
      origin: raw.origin === 'local' ? 'local' : 'web',
    })
  }
  out.sort((a, b) => a.rank - b.rank || (a.origin === 'local' ? -1 : 1) || 0)
  return out
}

async function searchAll(baseUrl, key, queries) {
  const batches = await Promise.all(queries.map((q) => googleSearch(baseUrl, key, q)))
  const hits = []
  for (let i = 0; i < batches.length; i++) {
    for (const item of batches[i]) {
      hits.push({ ...item, query: queries[i] })
    }
  }
  return hits
}

async function googleSearch(baseUrl, key, query) {
  const url = new URL(baseUrl + SEARCH_PATH)
  url.searchParams.set('query', query)
  url.searchParams.set('page', '1')
  url.searchParams.set('num', '10')
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`google-search HTTP ${r.status} ${detail.slice(0, 200)}`)
  }
  return parseSearchBody(await r.json())
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchOneSource(item) {
  const link = String(item.link || '').trim()
  if (!/^https?:\/\//i.test(link)) return ''
  try {
    const r = await fetch(link, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; medical-review/1.0)' },
      signal: AbortSignal.timeout(12000),
    })
    if (!r.ok) return ''
    const text = stripHtml(await r.text()).slice(0, 3500)
    if (text.length < 80) return ''
    return `【正文摘录：${item.title}】\n${link}\n${text}`
  } catch {
    return ''
  }
}

async function fetchTopSources(ranked) {
  const preferred = ranked.filter((h) => h.rank <= 3).slice(0, 4)
  const pages = await Promise.all(preferred.map(fetchOneSource))
  return pages.filter(Boolean).join('\n\n')
}

async function generatePlan(baseUrl, key, model, {
  diagnosis, actual, focus, eventYear, hospitalLevel, procedures, contraindications, searchBlock, fetchedBlock,
}) {
  const yearHint = eventYear ? `诊疗发生年份约 ${eventYear}，优先用当时或之前发布、其后仍适用的规范。` : '优先用较新但仍须符合行为发生时的规范。'
  const focusHint = focus ? `争议焦点：${focus}` : '覆盖诊断、检查、治疗、手术/操作、观察、转诊与告知中与本案相关的环节。'
  const levelHint = hospitalLevel ? `医院等级/科室：${hospitalLevel}。复杂技术与设备依赖项目按该等级校准，但生命体征、基本查体和危重症鉴别不因基层免除。` : '医院等级未提供，按当时一般同级医疗机构注意义务评价，不要按最高三级医院标准苛责。'
  const procHint = procedures ? `已实施手术/操作：${procedures}` : '未单独提供术式，从实然摘要中识别已实施操作。'
  const contraHint = contraindications ? `当时限制因素/可能禁忌：${contraindications}` : '从实然摘要中识别出血、休克、过敏、脏器功能等限制因素。'
  const system = [
    '你是医疗损害司法鉴定助手，只做应然诊疗方案生成与医方行为对照，不定法院赔偿比例。',
    '来源位阶：教科书 > 临床指南 > 专家共识 > 其他文献。冲突时取高位阶；同位阶取与行为发生时更接近、更权威者。',
    '只能依据检索摘要、本地临床知识库原文、网页正文摘录与病历实然摘要。本地知识库片段视为已核实原文，优先于网页摘要；引用写【出处：临床知识库 《指南或共识全称》】。检索未出现的具体条款号一律写「具体条款有待核实」或标【医学常识】，禁止编造。',
    '禁止把《劳动能力鉴定 职工工伤与职业病致残等级》《人体损伤致残程度分级》、GB/T 16180、SF/T 0097 等评残或鉴定程序标准当作诊疗指南。',
    '拟行未做不得写成已实施。并发症不等于过错。仅有不良后果不能反推必然有过错。',
    '后见之明禁止：只用行为当时已有病史、体征、检验、影像判断应然，不得用事后确诊的并发症倒推当时必然应做某项检查或用药。',
    '指南适用范围：先写该规范适用于哪类疾病、哪类手术、哪级医院。不在适用范围内不得作为应然依据。禁止把髋膝关节置换、髋部骨折等「骨科大手术」静脉血栓预防指南直接套用于锁骨、上肢、单纯肋骨内固定等未列入适用范围的术式。',
    '禁忌与可实施性：手术、抗凝、溶栓、有创操作必须同时分析出血风险、禁忌证、当时能否安全实施。存在活动性出血、血胸、多发创伤未稳定等情形时，不得径行认定「应当药物抗凝」。',
    '评分量表：Caprini 等必须按检索给出的计分项逐项计分；检索未给出具体分值则写「具体分值有待核实」，禁止自行发明分值后反推高危。',
    '监测义务：只有规范明确要求的监测才写入应然。不得把用于并发症诊断的检查（如 D-二聚体、CTA）写成常规预防监测义务，除非指南有明确术前/术后监测推荐。',
    '符合规范的对照也要写。可能过错须同时写：应然要求、实然行为、偏离及可能医学影响、出处种类。',
    '用简体中文。只输出一个 JSON 对象，不要 Markdown。',
  ].join('')
  const user = [
    `主诊断/病情：${diagnosis}`,
    yearHint,
    focusHint,
    levelHint,
    procHint,
    contraHint,
    '',
    '【检索结果】',
    searchBlock || '（无检索命中）',
    '',
    '【指南/教科书正文摘录】',
    fetchedBlock || '（未能抓取正文，仅依据检索摘要，条款须审慎）',
    '',
    '【医方已实施诊疗（实然）】',
    actual,
    '',
    '请输出 JSON，字段：',
    'expected_plan: 应然诊疗方案（分段：指南适用范围、评估与诊断、初始处理、药物治疗、手术或介入、监测与转诊、知情告知、禁忌与可实施性）。',
    'comparison: 应然与实然对照综述，须含符合项与偏离项。',
    'possible_faults: 数组，每项 {title, expected, actual, deviation, source}；无过错则空数组。',
    'no_fault: 字符串数组，列出符合规范的要点。',
    'scope_check: 所引指南是否覆盖本案术式/病情/医院等级；不覆盖则写明不得作为应然依据。',
    'contraindication_check: 关键措施的禁忌、出血/实施风险及当时能否安全实施。',
    'appendix_guidelines: 字符串数组，仅列检索中已出现且适用于本案的临床指南/教科书/专家共识全称（含机构/年份若有）。不适用范围的不要列入。禁止列入评残国标。',
    'caveats: 检索不足、当时规范不明、材料不足、后见之明风险等局限。',
  ].join('\n')

  const r = await fetch(baseUrl + CHAT_PATH, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 10000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`gemini HTTP ${r.status} ${detail.slice(0, 300)}`)
  }
  const body = await r.json()
  const content = body?.choices?.[0]?.message?.content || ''
  try {
    return extractJson(content)
  } catch (err) {
    return {
      expected_plan: String(content).slice(0, 6000),
      comparison: '',
      possible_faults: '',
      no_fault: '',
      scope_check: '',
      contraindication_check: '',
      appendix_guidelines: '',
      caveats: `模型未按 JSON 返回：${err.message || err}`,
    }
  }
}
