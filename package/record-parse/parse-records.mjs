// 扫描件病历解析插件：后台 OCR + 规则分类。解析不占用对话，完成后用 job 通知接上审查。
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { relToCase, resolveCaseCwd } from '../case-cwd.mjs'

export const name = 'record-parse'
export const inject = ['tools', 'jobs']
const CLOSE_BASE = 'https://api.openai-proxy.org/v1'
const ALIYUN_BASE = 'https://llm-p1xu3cnt2myixaep.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'

const SECRET_ENV = [
  'CLOSEAI_API_KEY',
  'CLOSEAI_ADMIN_KEY',
  'DASHSCOPE_API_KEY',
  'RECORD_PARSE_API_KEY',
  'OPENAI_API_KEY',
]

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

function sanitizeSecretEnv() {
  for (const name of SECRET_ENV) {
    if (process.env[name]) process.env[name] = sanitizeApiKey(process.env[name])
  }
}

function loadDshEnv() {
  const envFile = 'E:/A/.dsh/.env'
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = parseEnvValue(trimmed.slice(eq + 1))
    setEnvIfMissing(key, value)
  }
}

function loadDshCredentials() {
  const credFile = path.join(process.env.DSH_HOME || 'E:/A/.dsh', '.credentials.yaml')
  if (!existsSync(credFile)) return
  const text = readFileSync(credFile, 'utf8')
  for (const name of ['CLOSEAI_API_KEY', 'DASHSCOPE_API_KEY']) {
    const m = text.match(new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, 'm'))
    if (m) setEnvIfMissing(name, sanitizeApiKey(m[1]))
  }
}

loadDshEnv()
loadDshCredentials()
sanitizeSecretEnv()

export const Config = z.object({
  model: z.string().default('qwen3.5-flash'),
  visionModel: z.string().default('gemini-3.1-flash-lite-image'),
  baseUrl: z.string().default(CLOSE_BASE),
  apiConcurrency: z.string().default('16'),
})

function hasCloseKey() {
  return Boolean(String(process.env.CLOSEAI_API_KEY || '').trim())
}

function capConcurrency(value) {
  const n = Number.parseInt(String(value ?? '16'), 10)
  if (!Number.isFinite(n)) return '16'
  return String(Math.max(1, Math.min(n, 32)))
}

function resolveParseConfig(config) {
  const apiConcurrency = capConcurrency(config?.apiConcurrency || process.env.RECORD_PARSE_API_CONCURRENCY || '16')
  if (hasCloseKey()) {
    const model = config?.model && config.model !== 'qwen3.8-flash'
      ? config.model
      : 'qwen3.5-flash'
    return {
      model,
      visionModel: config?.visionModel || 'gemini-3.1-flash-lite-image',
      baseUrl: config?.baseUrl && String(config.baseUrl).includes('aliyuncs.com')
        ? CLOSE_BASE
        : (config?.baseUrl || CLOSE_BASE),
      apiConcurrency,
    }
  }
  return {
    model: 'qwen3.8-flash',
    visionModel: '',
    baseUrl: ALIYUN_BASE,
    apiConcurrency,
  }
}

const WORKER = fileURLToPath(new URL('./worker.py', import.meta.url))

const MATERIAL_EXTS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp', '.txt', '.md'])

function resolveDirs(args = {}, exec) {
  const cwd = resolveCaseCwd(exec)
  const materials = path.resolve(cwd, args.materials_dir || 'materials')
  const outDir = path.resolve(cwd, args.out_dir || 'reports/review')
  return { cwd, materials, outDir }
}

function listMaterialRels(root) {
  if (!existsSync(root)) return []
  const out = []
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (MATERIAL_EXTS.has(path.extname(ent.name).toLowerCase())) {
        out.push(path.relative(root, full).replace(/\\/g, '/'))
      }
    }
  }
  walk(root)
  return out
}

/** done 只能复用仍然覆盖当前材料的目录。新上传的意见书不在索引里时要重新解析。 */
function indexCoversMaterials(outDir, materials) {
  const index = readJson(path.join(outDir, 'parse-index.json'))
  if (!index?.pages) return false
  const indexed = new Set(index.pages.map((p) => String(p.file || '').replace(/\\/g, '/')))
  const rels = listMaterialRels(materials)
  if (!rels.length) return true
  return rels.every((rel) => indexed.has(rel))
}

function readJson(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function isPidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function writeJob(jobPath, job) {
  writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8')
}

function reconcileJob(jobPath) {
  const job = readJson(jobPath)
  if (!job) return null
  if ((job.status === 'running' || job.status === 'started') && !isPidAlive(job.pid)) {
    const next = {
      ...job,
      status: 'error',
      message: '解析进程已退出，进度未更新。请再调一次 parse_records。',
      error: job.error || 'worker exited without writing a final status',
      updated_at: new Date().toISOString(),
    }
    writeJob(jobPath, next)
    return next
  }
  return job
}

function harnessJobFile(outDir) {
  return path.join(outDir, 'parse-harness-job.json')
}

function readHarnessJob(outDir) {
  return readJson(harnessJobFile(outDir))
}

function writeHarnessJob(outDir, rec) {
  writeFileSync(harnessJobFile(outDir), JSON.stringify(rec, null, 2), 'utf8')
}

function nextAfterParse(job, jobId = '') {
  const status = job?.status || 'idle'
  if (status === 'done') {
    return '解析已完成。本轮不要结束、也不要只回复进度：立即并行 Read catalog.md、timeline.md、meta.md（若有 parse-warnings.md 一并读）。meta 里的解析核验警告优先按 OCR 串台处理，不要直接写成病历书写过错。然后进入审查，不要等用户再开口。'
  }
  if (status === 'running' || status === 'started') {
    const idHint = jobId ? `（job ${jobId}）` : ''
    return `解析在后台进行${idHint}，对话保持、不要结束会话。用户中途提问请正常回答。完成后会收到 background job 通知：先 job_output，再立刻并行 Read catalog.md、timeline.md、meta.md 进入审查。禁止 job_output wait 空等解析，禁止反复 parse_records_status，禁止再开第二个 parse_records。`
  }
  if (status === 'error') {
    return '把失败原因告诉用户。密钥/配置错误不要改用 convert_file；超时或进程已退出可再调一次 parse_records。'
  }
  return '请先调用 parse_records。'
}

function jobSummary(job) {
  if (!job) return '尚未解析。请先调用 parse_records。'
  const stage = job.stage || (job.status === 'done' ? '已完成' : (job.status === 'error' ? '失败' : '识别'))
  const rows = [
    ['状态', job.status || 'unknown'],
    ['阶段', stage],
    ['已识别', `${job.done_pages || 0} / ${job.total_pages || 0} 页`],
    ['简单页模型', job.model || '（未记录）'],
    ['复杂页模型', job.vision_model || '（未启用）'],
    ['API并发', job.api_limit != null ? String(job.api_limit) : '8'],
  ]
  if (job.ocr_pages != null) rows.push(['OCR页', String(job.ocr_pages)])
  if (job.escalate_pages) rows.push(['升级复杂模型', `${job.escalate_pages} 页`])
  if (job.cache_pages) rows.push(['缓存页', String(job.cache_pages)])
  if (job.message) rows.push(['说明', String(job.message)])
  if (job.error) rows.push(['错误', String(job.error).slice(0, 400)])
  const table = [
    '当前解析进度：',
    '',
    '| 项目 | 数值 |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '／')} |`),
  ]
  return table.join('\n')
}

function startWorker({ materials, outDir, force, maxPages, model, visionModel, baseUrl, apiConcurrency }) {
  const logPath = path.join(outDir, 'parse-worker.log')
  const fd = openSync(logPath, 'a')
  const args = ['-u', WORKER, '--materials', materials, '--out', outDir]
  if (force) args.push('--force')
  if (maxPages) args.push('--max-pages', String(maxPages))
  const child = spawn('python', args, {
    cwd: path.dirname(WORKER),
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    env: {
      ...process.env,
      CLOSEAI_API_KEY: sanitizeApiKey(process.env.CLOSEAI_API_KEY || ''),
      CLOSEAI_ADMIN_KEY: sanitizeApiKey(process.env.CLOSEAI_ADMIN_KEY || ''),
      DASHSCOPE_API_KEY: sanitizeApiKey(process.env.DASHSCOPE_API_KEY || ''),
      PYTHONIOENCODING: 'utf-8',
      RECORD_PARSE_MODEL: model,
      RECORD_PARSE_VISION_MODEL: visionModel || '',
      RECORD_PARSE_BASE_URL: baseUrl,
      RECORD_PARSE_API_CONCURRENCY: capConcurrency(apiConcurrency || '16'),
      RECORD_PARSE_TIMEOUT: process.env.RECORD_PARSE_TIMEOUT || '180',
      RECORD_PARSE_MAX_RETRIES: process.env.RECORD_PARSE_MAX_RETRIES || '4',
    },
  })
  try { closeSync(fd) } catch { /* child keeps the log handle */ }
  return child
}

function stopPid(pid) {
  if (!pid) return
  try { process.kill(pid) } catch { /* already gone */ }
}

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitWhileAlive(pid, jobPath) {
  while (isPidAlive(pid)) {
    const job = readJson(jobPath)
    if (job?.status === 'done' || job?.status === 'error') return job
    await sleep(1000)
  }
  return reconcileJob(jobPath)
}

function parseOutcome(job, extra = '') {
  const summary = [extra, jobSummary(job)].filter(Boolean).join('\n')
  if (job?.status === 'done') {
    return {
      status: 'completed',
      detail: `${job.done_pages || 0}/${job.total_pages || 0} 页`,
      output: `${summary}\n\n解析已完成。立刻并行 Read catalog.md、timeline.md、meta.md，然后进入审查。不要等用户再说「继续」。用户中途若已提问，先答完再继续鉴定。`,
    }
  }
  if (job?.status === 'error') {
    return {
      status: 'failed',
      detail: String(job.message || job.error || 'parse error').slice(0, 200),
      output: summary,
    }
  }
  return {
    status: 'failed',
    detail: 'worker exited without a final status',
    output: summary,
  }
}

function liveParseOutput(jobPath, outDir) {
  const job = reconcileJob(jobPath)
  let logTail = ''
  try {
    const log = readFileSync(path.join(outDir, 'parse-worker.log'), 'utf8')
    logTail = log.trim().slice(-600)
  } catch { /* no log yet */ }
  return [jobSummary(job), logTail].filter(Boolean).join('\n\n')
}

function lookupLiveHarnessJob(jobs, agent, outDir, pid) {
  const rec = readHarnessJob(outDir)
  if (!rec?.id || !jobs) return ''
  try {
    const snap = jobs.get(rec.id, agent)
    if (snap && (snap.status === 'running' || snap.status === 'stopping') && (!pid || rec.pid === pid)) {
      return rec.id
    }
  } catch { /* unknown or foreign job */ }
  return ''
}

function attachParseJob(jobs, exec, { child, pid, jobPath, outDir }) {
  if (!jobs || !exec?.agent) return ''
  const existing = lookupLiveHarnessJob(jobs, exec.agent, outDir, pid)
  if (existing) return existing
  try {
    const id = jobs.start({
      kind: 'parse',
      label: '病历解析 parse_records',
      owner: exec.agent,
      run: (job) => {
        let previous=''
        const report=()=>{const text=liveParseOutput(jobPath,outDir);if(text!==previous){previous=text;job.updateProgress(jobSummary(reconcileJob(jobPath)));job.append(text+'\n')}}
        report();const timer=setInterval(report,2000)
        return {
          cancel: () => {if(child){try{child.kill()}catch{}}else stopPid(pid)},
          done: (child ? waitForProcess(child) : waitWhileAlive(pid, jobPath))
            .then(() => {report();const outcome=parseOutcome(reconcileJob(jobPath));return {...outcome,result:outcome.output||liveParseOutput(jobPath,outDir)}})
            .catch(err => ({status:'failed',detail:String(err?.message||err).slice(0,200),result:String(err?.message||err)}))
            .finally(()=>clearInterval(timer)),
        }
      },
    })
    writeHarnessJob(outDir, { id, pid: pid || child?.pid || 0 })
    return id
  } catch {
    return ''
  }
}

function queryIndex(index, args) {
  const pages = Array.isArray(index?.pages) ? index.pages : []
  const category = String(args.category || '').trim()
  const keyword = String(args.keyword || '').trim()
  const file = String(args.file || '').trim()
  const pageFrom = Number(args.page_from || 0)
  const pageTo = Number(args.page_to || 0)
  const limit = Math.min(Math.max(Number(args.limit || 12), 1), 20)
  const maxChars = Math.min(Math.max(Number(args.max_chars || 1200), 200), 4000)

  let hits = pages.filter((p) => {
    if (category && p.category !== category) return false
    if (file && !String(p.file || '').includes(file)) return false
    if (pageFrom && p.page < pageFrom) return false
    if (pageTo && p.page > pageTo) return false
    return true
  })

  const outDir = path.dirname(args.indexPath)
  const snippets = []
  for (const p of hits) {
    const textPath = p.text_path ? path.join(outDir, p.text_path) : ''
    let text = ''
    try {
      text = textPath && existsSync(textPath) ? readFileSync(textPath, 'utf8') : ''
    } catch {
      text = ''
    }
    if (keyword && !text.includes(keyword) && !(p.specific || '').includes(keyword)) continue
    snippets.push({
      file: p.file,
      page: p.page,
      category: p.category,
      specific: p.specific || p.category,
      engine: p.engine || '',
      text: text.slice(0, maxChars),
    })
    if (snippets.length >= limit) break
  }
  return {
    match_pages: snippets.length,
    scanned_pages: hits.length,
    snippets,
  }
}

export function apply(ctx, config) {
  const route = resolveParseConfig(config)
  ctx.tools.register(defineTool({
    name: 'parse_records',
    timeoutMs: 60_000,
    description:
      '启动病历扫描件后台解析。本工具立刻返回，OCR 在后台跑，不占用、不断开当前对话。' +
      '简单页固定 CloseAI qwen3.5-flash；过短或无法识别的复杂页升 gemini-3.1-flash-lite-image。API 并发上限 40。' +
      '已有 done、且材料目录里的文件都已编入目录时才复用。出现新文件会重新解析，已识别的页走缓存。已有 running 则返回同一后台任务，不要重开。' +
      '返回 running 后继续与用户对话；完成后会收到 job 通知，再 job_output，然后立刻 read catalog/timeline/meta。' +
      '禁止 job_output wait 空等解析。禁止 convert_file / inspect_file / subagent OCR / 聊天模型看 pages/。',
    parameters: {
      materials_dir: { type: 'string', description: '材料目录，默认 materials/' },
      force: { type: 'string', description: 'true 时忽略页缓存重新 OCR' },
      max_pages: { type: 'number', description: '仅调试时限制页数。正式解析不要填。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string' },
          summary: { type: 'string' },
          catalog: { type: 'string' },
          timeline: { type: 'string' },
          meta: { type: 'string' },
          job_id: { type: 'string' },
          next: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.next ? `${value.summary}\n\n${value.next}` : value.summary,
      }],
    },
    async execute(args, exec) {
      const { cwd, materials, outDir } = resolveDirs(args, exec)
      await mkdir(outDir, { recursive: true })
      const jobPath = path.join(outDir, 'parse-job.json')
      const rel = (p) => relToCase(cwd, p)
      const paths = {
        catalog: rel(path.join(outDir, 'catalog.md')),
        timeline: rel(path.join(outDir, 'timeline.md')),
        meta: rel(path.join(outDir, 'meta.md')),
      }
      const finish = (job, extra = '', jobId = '') => ({
        status: job?.status || 'error',
        summary: extra ? `${extra}\n${jobSummary(job)}` : jobSummary(job),
        catalog: paths.catalog,
        timeline: paths.timeline,
        meta: paths.meta,
        job_id: jobId || '',
        next: nextAfterParse(job, jobId),
      })
      const jobs = ctx.jobs
      let job = reconcileJob(jobPath)
      const force = args.force === true || args.force === 'true'
      try {
        if (job?.status === 'done' && !force && indexCoversMaterials(outDir, materials)) {
          return finish(job, '已有解析结果，未重新跑。')
        }
        if (job?.status === 'running' && isPidAlive(job.pid)) {
          const jobId = attachParseJob(jobs, exec, {
            child: null,
            pid: job.pid,
            jobPath,
            outDir,
          })
          return finish(job, '解析仍在后台，对话保持。', jobId)
        }
        if (!existsSync(materials)) {
          return finish({ status: 'error' }, `未找到材料目录：${rel(materials)}`)
        }
        const child = startWorker({
          materials,
          outDir,
          force,
          maxPages: args.max_pages || 0,
          model: route.model,
          visionModel: route.visionModel,
          baseUrl: route.baseUrl,
          apiConcurrency: route.apiConcurrency,
        })
        writeJob(jobPath, {
          status: 'running',
          pid: child.pid,
          stage: '识别',
          message: '已启动后台解析',
          updated_at: new Date().toISOString(),
        })
        const jobId = attachParseJob(jobs, exec, {
          child,
          pid: child.pid,
          jobPath,
          outDir,
        })
        if (!jobId) {
          waitForProcess(child).catch(() => {})
        }
        job = reconcileJob(jobPath) || {
          status: 'running',
          pid: child.pid,
          message: '已启动后台解析',
        }
        return finish(job, '解析已在后台启动，对话不断开。', jobId)
      } catch (err) {
        job = reconcileJob(jobPath) || { status: 'error', message: String(err?.message || err) }
        return finish(job, `解析未能启动：${String(err?.message || err).slice(0, 200)}`)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'parse_records_status',
    description:
      '查看病历解析进度。parse_records 已改为后台任务，一般不必查本工具。' +
      '解析进行中请继续与用户对话，不要结束会话。完成后会有 job 通知。' +
      'done 必须本轮立即并行读 catalog/timeline/meta 并进入审查。不要读 pages/。不要 job_output wait 空等。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string' },
          summary: { type: 'string' },
          done_pages: { type: 'integer' },
          total_pages: { type: 'integer' },
          next: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.next ? `${value.summary}\n\n${value.next}` : value.summary,
      }],
    },
    async execute(_args, exec) {
      const { outDir } = resolveDirs({}, exec)
      const job = reconcileJob(path.join(outDir, 'parse-job.json'))
      return {
        status: job?.status || 'idle',
        summary: jobSummary(job),
        done_pages: Number(job?.done_pages || 0),
        total_pages: Number(job?.total_pages || 0),
        next: nextAfterParse(job),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'parse_records_query',
    description:
      '按文书大类、页码或关键词读取已解析病历片段。默认 12 页、最大 20 页，禁止把整本全文塞进上下文。' +
      '大类：入院记录、病程记录、会诊记录、出院记录、手术记录、死亡记录、麻醉记录、抢救记录、检验报告、知情同意、医嘱记录、护理记录、急诊记录、门诊记录、病案首页、影像报告、病理报告、尸检报告、体检报告、产检报告、其他。' +
      '认定病程辅助检查张冠李戴或「脊髓/骨髓水肿」误写前，必须同时查影像报告原文；条目化列表可能把后一次检查接到前一次检查名下。',
    parameters: {
      category: { type: 'string', description: '文书大类，如 手术记录、知情同意' },
      keyword: { type: 'string', description: '正文关键词，如 溶栓、气管插管' },
      file: { type: 'string', description: '文件名包含即可' },
      page_from: { type: 'number', description: '起始页（含）' },
      page_to: { type: 'number', description: '结束页（含）' },
      limit: { type: 'number', description: '返回页数，默认 12，最大 20' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          match_pages: { type: 'integer' },
          scanned_pages: { type: 'integer' },
          snippets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                file: { type: 'string' },
                page: { type: 'integer' },
                category: { type: 'string' },
                specific: { type: 'string' },
                engine: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [`命中 ${value.match_pages} 页（筛选范围内共 ${value.scanned_pages} 页）`]
        for (const s of value.snippets || []) {
          lines.push(`\n【${s.specific}，第${s.page}页】${s.file}`)
          lines.push(s.text)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const { outDir } = resolveDirs({}, exec)
      const indexPath = path.join(outDir, 'parse-index.json')
      const index = readJson(indexPath)
      if (!index) {
        return { match_pages: 0, scanned_pages: 0, snippets: [] }
      }
      return queryIndex(index, { ...args, indexPath })
    },
  }))
}
