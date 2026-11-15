/**
 * 把 E:\A\temp\标准 分批导入「标准规范库」。
 * 进度写在 scripts/.traffic-standards-kb.json，中断后重跑同一命令会续传。
 *
 *   node scripts/import-traffic-standards.mjs
 *   node scripts/import-traffic-standards.mjs --batch 1
 *   node scripts/import-traffic-standards.mjs --status
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = (process.env.WK_BASE || 'http://127.0.0.1:8093').replace(/\/+$/, '')
const KB_ID = '79ef9376-7c09-484d-a5ed-430a677db06e'
const SRC = 'E:/A/temp/标准'
const STAGE = 'E:/A/temp/标准-import'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE = path.join(__dirname, '.traffic-standards-kb.json')
const MAX_BYTES = 45 * 1024 * 1024

const BATCHES = {
  1: '文本型小文件（docx 与 1MB 以内 PDF）',
  2: '转换后的 Word 与数 MB 的 PDF',
  3: '扫描件与大文件，一次一份',
}

/** @type {Array<Record<string, string|number|boolean>>} */
const CATALOG = [
  item(1, '车速', 'GA/T 1999.1-2022', '公安部', 'GAT 1999.1-2022道路交通事故车辆速度鉴定方法第1部分：基于汽车行驶记录仪.docx', 'GA-T 1999.1-2022 道路交通事故车辆速度鉴定方法 第1部分：基于汽车行驶记录仪.docx'),
  item(1, '车速', 'GA/T 1999.2-2022', '公安部', 'GAT 1999.2-2022道路交通事故车辆速度鉴定方法第2部分：基于汽车事件数据记录系统.docx', 'GA-T 1999.2-2022 道路交通事故车辆速度鉴定方法 第2部分：基于汽车事件数据记录系统.docx'),
  item(1, '车速', 'GB/T 33195-2016', '国家标准化管理委员会', 'GBT 33195—2016道路交通事故车辆速度鉴定.pdf', 'GB-T 33195-2016 道路交通事故车辆速度鉴定.pdf'),
  item(1, '痕迹', 'SF/T 0072-2020', '司法部', 'SF T0072-2020 道路交通事故痕迹物证鉴定通用规范.pdf', 'SF-T 0072-2020 道路交通事故痕迹物证鉴定通用规范.pdf'),
  item(1, '信号灯', 'SF/T 0073-2020', '司法部', 'SF T0073-2020基于视频图像的道路交通事故信号灯状态鉴定规范.pdf', 'SF-T 0073-2020 基于视频图像的道路交通事故信号灯状态鉴定规范.pdf'),
  item(1, '交通设施', 'SF/T 0099-2021', '司法部', 'SF T0099-2021 道路交通设施安全技术状况鉴定规范.pdf', 'SF-T 0099-2021 道路交通设施安全技术状况鉴定规范.pdf'),
  item(1, '火灾', 'SF/T 0100-2021', '司法部', 'SF T0100-2021车辆火灾痕迹物证鉴定技术规范.pdf', 'SF-T 0100-2021 车辆火灾痕迹物证鉴定技术规范.pdf'),
  item(1, '重建', 'SF/T 0160-2023', '司法部', 'SF T0160-2023 基于图像的道路交通事故重建技术规范.pdf', 'SF-T 0160-2023 基于图像的道路交通事故重建技术规范.pdf'),
  item(1, '行为方式', 'SF/T 0162-2023', '司法部', 'SF T0162-2023道路交通事故涉案者交通行为方式鉴定规范.pdf', 'SF-T 0162-2023 道路交通事故涉案者交通行为方式鉴定规范.pdf'),
  item(1, '重建', 'DB50/T 1655-2024', '重庆市市场监督管理局', 'DB50 T 1655-2024道路交通事故过程分析及重建技术规范（标准文本）.pdf', 'DB50-T 1655-2024 道路交通事故过程分析及重建技术规范.pdf'),
  item(1, '车辆类型与装置', 'GB/T 12996-2024', '国家标准化管理委员会', 'GBT 12996-2024 电动轮椅车.pdf', 'GB-T 12996-2024 电动轮椅车.pdf'),
  item(1, '车辆安全', 'GB/T 18344-2025', '国家标准化管理委员会', 'GBT 18344-2025汽车维护、检测、诊断技术规范.pdf', 'GB-T 18344-2025 汽车维护、检测、诊断技术规范.pdf'),
  item(1, '程序', '司法鉴定程序通则（2016）', '司法部', '司法鉴定程序通则2016.docx', '司法鉴定程序通则（2016）.docx'),

  item(2, '车辆类型与装置', 'GA 802-2019', '公安部', 'GA 802-2019《道路交通管理 机动车类型》.doc', 'GA 802-2019 道路交通管理 机动车类型.docx', { convert: true }),
  item(2, '痕迹', 'GA/T 1087-2021', '公安部', 'GAT 1087-2021《道路交通事故痕迹鉴定》.doc', 'GA-T 1087-2021 道路交通事故痕迹鉴定.docx', { convert: true }),
  item(2, '痕迹', 'GA/T 41-2019', '公安部', 'GAT 41-2019《道路交通事故现场痕迹物证勘查》.doc', 'GA-T 41-2019 道路交通事故现场痕迹物证勘查.docx', { convert: true }),
  item(2, '车辆类型与装置', 'GB/T 5910-1998', '国家标准化管理委员会', 'GBT 5910-1998轿车质量分布.doc', 'GB-T 5910-1998 轿车质量分布.docx', { convert: true }),
  item(2, '程序', '渝司发〔2020〕71号', '重庆市司法局', '渝司发〔2020〕71号重庆市司法局关于印发 《重庆市司法鉴定执业活动流程指南》的通知20201221.doc', '渝司发〔2020〕71号 重庆市司法鉴定执业活动流程指南.docx', { convert: true }),
  item(2, '程序', '渝司发〔2020〕71号附件', '重庆市司法局', '渝司发〔2020〕71号附件.doc', '渝司发〔2020〕71号附件.docx', { convert: true }),
  item(2, '程序', '重庆市司法鉴定条例（2023）', '重庆市人大常委会', '重庆市司法鉴定条例（2023）.doc', '重庆市司法鉴定条例（2023）.docx', { convert: true }),
  item(2, '车速', 'GA/T 1999.3-2025', '公安部', 'GAT 1999.3-2025《道路交通事故车辆速度鉴定方法 第3部分：基于视频图像》.pdf', 'GA-T 1999.3-2025 道路交通事故车辆速度鉴定方法 第3部分：基于视频图像.pdf'),
  item(2, '车辆安全', 'GA/T 642-2020', '公安部', 'GAT 642-2020 道路交通事故车辆安全技术检验鉴定.pdf', 'GA-T 642-2020 道路交通事故车辆安全技术检验鉴定.pdf'),
  item(2, '车辆类型与装置', 'GB 15084-2022', '国家标准化管理委员会', 'GB 15084-2022 机动车辆 间接视野装置性能和安装要求.pdf', 'GB 15084-2022 机动车辆 间接视野装置性能和安装要求.pdf'),
  item(2, '车辆类型与装置', 'GB 17761-2024', '国家标准化管理委员会', 'GB 17761-2024电动自行车安全技术规范.pdf', 'GB 17761-2024 电动自行车安全技术规范.pdf'),
  item(2, '车辆类型与装置', 'GB 18100-2025', '国家标准化管理委员会', 'GB 18100-2025摩托车和轻便摩托车道路照明及光信号装置的安装规定.pdf', 'GB 18100-2025 摩托车和轻便摩托车道路照明及光信号装置的安装规定.pdf'),
  item(2, '车辆安全', 'GB 38900-2020', '国家标准化管理委员会', 'GB 38900-2020机动车安全技术检验项目和方法.pdf', 'GB 38900-2020 机动车安全技术检验项目和方法.pdf'),
  item(2, '车辆类型与装置', 'GB/T 5359.1-2008', '国家标准化管理委员会', 'GBT 5359.1-2008 摩托车和轻便摩托车术语 第1部分：车辆类型.pdf', 'GB-T 5359.1-2008 摩托车和轻便摩托车术语 第1部分：车辆类型.pdf'),
  item(2, '车辆类型与装置', 'GB/T 6104.1-2018', '国家标准化管理委员会', 'GBT 6104.1-2018 工业车辆 术语和分类 第1部分：工业车辆类型(1).pdf', 'GB-T 6104.1-2018 工业车辆 术语和分类 第1部分：工业车辆类型.pdf'),
  item(2, '交通设施', 'JTG B05-01-2013', '交通运输部', 'JTG B05-01-2013公路护栏安全性能评价标准.pdf', 'JTG B05-01-2013 公路护栏安全性能评价标准.pdf'),

  item(3, '车辆安全', 'GB 7258-2017', '国家标准化管理委员会', 'GB 7258-2017 机动车安全运行技术条件（扫描版）.pdf', 'GB 7258-2017 机动车安全运行技术条件.pdf', { scan: true }),
  item(3, '车辆类型与装置', 'GB 11564-2024', '国家标准化管理委员会', 'GB 11564-2024机动车回复反射装置.pdf', 'GB 11564-2024 机动车回复反射装置.pdf', { large: true }),
  item(3, '交通设施', 'CJJ 36-2016', '住房和城乡建设部', 'CJJ 36-2016 城镇道路养护技术规范.pdf', 'CJJ 36-2016 城镇道路养护技术规范.pdf', { large: true }),
  item(3, '交通设施', 'JTG D81-2017', '交通运输部', 'JTG D81-2017《公路交通安全设施设计规范》.pdf', 'JTG D81-2017 公路交通安全设施设计规范.pdf', { split: true, large: true }),
]

function item(batch, category, standard, publisher, source, uploadName, extra = {}) {
  return {
    key: standard,
    batch,
    category,
    folder: `交通事故/${category}`,
    standard,
    publisher,
    source,
    uploadName,
    ...extra,
  }
}

let token = ''
let state = null

function now() { return new Date().toISOString() }

async function loadState() {
  try {
    state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))
  } catch {
    state = { kbId: KB_ID, base: BASE, createdAt: now(), updatedAt: now(), batches: {}, items: {} }
  }
  for (const row of CATALOG) {
    if (!state.items[row.key] || state.items[row.key].status === 'pending') {
      state.items[row.key] = {
        ...(state.items[row.key] || {}),
        key: row.key,
        batch: row.batch,
        category: row.category,
        folder: row.folder,
        standard: row.standard,
        uploadName: row.uploadName,
        source: row.source,
        status: state.items[row.key]?.status || 'pending',
      }
    }
  }
  await saveState()
}

async function saveState() {
  const items = Object.values(state.items).filter((x) => x.status !== 'split')
  state.updatedAt = now()
  state.summary = {
    total: items.length,
    pending: items.filter((x) => x.status === 'pending' || x.status === 'prepared').length,
    uploaded: items.filter((x) => x.status === 'uploaded' || x.status === 'parsing').length,
    completed: items.filter((x) => x.status === 'completed' || x.status === 'skipped').length,
    failed: items.filter((x) => x.status === 'failed').length,
  }
  state.batches = {}
  for (const n of [1, 2, 3]) {
    const rows = items.filter((x) => x.batch === n)
    const done = rows.length > 0 && rows.every((x) => x.status === 'completed' || x.status === 'skipped')
    const started = rows.some((x) => !['pending', 'prepared'].includes(x.status))
    state.batches[n] = {
      name: BATCHES[n],
      count: rows.length,
      completed: rows.filter((x) => x.status === 'completed' || x.status === 'skipped').length,
      failed: rows.filter((x) => x.status === 'failed').length,
      status: done ? 'done' : started ? 'running' : 'pending',
    }
  }
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function log(line) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`)
}

async function api(method, p, { body, form } = {}) {
  const headers = { Authorization: `Bearer ${token}` }
  const init = { method, headers }
  if (form) init.body = form
  else if (body !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8'
    init.body = JSON.stringify(body)
  }
  const r = await fetch(`${BASE}/api/v1${p}`, init)
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!r.ok && r.status !== 409) {
    const detail = json?.message || json?.error || json?.msg || text.slice(0, 240)
    throw new Error(`${method} ${p} HTTP ${r.status} ${detail}`)
  }
  return { status: r.status, json }
}

function unwrapList(j) {
  let arr = j?.data
  if (Array.isArray(arr)) return arr
  if (arr && typeof arr === 'object') return arr.items || arr.data || []
  return []
}

async function login() {
  const r = await fetch(`${BASE}/api/v1/auth/auto-setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!r.ok) throw new Error(`WeKnora 未启动 HTTP ${r.status}（${BASE}）`)
  const j = await r.json()
  token = j.token || j.data?.token
  if (!token) throw new Error('auto-setup 未返回 token')
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, ...opts })
    let out = ''
    let err = ''
    child.stdout?.on('data', (b) => { out += b.toString() })
    child.stderr?.on('data', (b) => { err += b.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(err.trim() || out.trim() || `${cmd} exit ${code}`))
      else resolve(out)
    })
  })
}

async function convertDocs() {
  const docs = CATALOG.filter((x) => x.convert)
  if (!docs.length) return
  await fs.mkdir(STAGE, { recursive: true })
  const jobs = []
  for (const row of docs) {
    const src = path.join(SRC, row.source)
    const dest = path.join(STAGE, row.uploadName)
    try {
      await fs.access(dest)
      row.prepared = dest
      continue
    } catch { /* convert */ }
    try {
      await fs.access(src)
    } catch {
      throw new Error(`找不到源文件 ${row.source}`)
    }
    jobs.push({ src, dest, key: row.key })
    row.prepared = dest
  }
  if (!jobs.length) {
    log(`Word 转换：${docs.length} 份已在暂存目录`)
    return
  }
  log(`Word 转换 ${jobs.length} 份 .doc → .docx`)
  for (const j of jobs) {
    const ps1 = path.join(STAGE, '_convert-one.ps1')
    const src = j.src.replace(/'/g, "''")
    const dest = j.dest.replace(/'/g, "''")
    const lines = [
      "$ErrorActionPreference = 'Stop'",
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)',
      '$word = New-Object -ComObject Word.Application',
      '$word.Visible = $false',
      '$word.DisplayAlerts = 0',
      '$fmt = 12',
      'try {',
      `  $d = $word.Documents.Open('${src}', $false, $false, $false)`,
      `  if (Test-Path -LiteralPath '${dest}') { Remove-Item -LiteralPath '${dest}' -Force }`,
      `  $outPath = '${dest}'`,
      '  $d.SaveAs([ref]$outPath, [ref]$fmt)',
      '  $d.Close($false)',
      `  Write-Output 'OK ${j.key}'`,
      '} finally {',
      '  $after = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)',
      '  $started = @($after | Where-Object { $before -notcontains $_ })',
      '  if ($started.Count -gt 0) { $word.Quit() | Out-Null }',
      '}',
    ]
    await fs.writeFile(ps1, '\uFEFF' + lines.join('\r\n'), 'utf8')
    const out = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1])
    log(out.trim().split(/\r?\n/).filter(Boolean).pop() || `OK ${j.key}`)
  }
}

async function splitLarge() {
  const row = CATALOG.find((x) => x.split)
  if (!row) return
  const src = path.join(SRC, row.source)
  const marker = path.join(STAGE, '.jtg-d81-parts.json')
  try {
    const saved = JSON.parse(await fs.readFile(marker, 'utf8'))
    let ok = true
    for (const p of saved) {
      try { await fs.access(p.file) } catch { ok = false }
    }
    if (ok && saved.length) {
      row.parts = saved
      log(`JTG D81 已拆成 ${saved.length} 份`)
      return
    }
  } catch { /* split again */ }
  await fs.mkdir(STAGE, { recursive: true })
  log('拆分 JTG D81-2017（超过 50MB 上传上限）')
  const pyPath = path.join(STAGE, '_split_jtg.py')
  const py = `
import fitz, json, os
src = ${JSON.stringify(src)}
stage = ${JSON.stringify(STAGE)}
marker = ${JSON.stringify(marker)}
doc = fitz.open(src)
n = doc.page_count
parts = 3
size = (n + parts - 1) // parts
out = []
for i in range(parts):
    a = i * size
    b = min(n, (i + 1) * size)
    if a >= n:
        break
    name = f"JTG D81-2017 公路交通安全设施设计规范 第{i+1}部分.pdf"
    dest = os.path.join(stage, name)
    if not os.path.exists(dest):
        nd = fitz.open()
        nd.insert_pdf(doc, from_page=a, to_page=b-1)
        nd.save(dest, garbage=4, deflate=True)
        nd.close()
    out.append({"file": dest.replace("\\\\", "/"), "name": name, "from": a+1, "to": b, "bytes": os.path.getsize(dest)})
with open(marker, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
`
  await fs.writeFile(pyPath, py, 'utf8')
  await run('python', [pyPath])
  const parts = JSON.parse(await fs.readFile(marker, 'utf8'))
  for (const p of parts) {
    if (p.bytes > MAX_BYTES) throw new Error(`${p.name} 仍有 ${(p.bytes / 1024 / 1024).toFixed(1)}MB，超过 45MB`)
    log(`  ${p.name} 第${p.from}-${p.to}页 ${(p.bytes / 1024 / 1024).toFixed(1)}MB`)
  }
  await fs.writeFile(marker, JSON.stringify(parts, null, 2), 'utf8')
  row.parts = parts
}

function guessType(name) {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === '.doc') return 'application/msword'
  return 'application/octet-stream'
}

async function preparedPath(row) {
  if (row.convert) return path.join(STAGE, row.uploadName)
  return path.join(SRC, row.source)
}

async function uploadFile(filePath, uploadName, folder, meta) {
  const buf = await fs.readFile(filePath)
  if (buf.length > 50 * 1024 * 1024) {
    throw new Error(`文件 ${(buf.length / 1024 / 1024).toFixed(1)}MB 超过 50MB 上限`)
  }
  const form = new FormData()
  form.append('file', new Blob([buf], { type: guessType(uploadName) }), uploadName)
  form.append('fileName', `${folder}/${uploadName}`)
  form.append('metadata', JSON.stringify(meta))
  const { status, json } = await api('POST', `/knowledge-bases/${KB_ID}/knowledge/file`, { form })
  const data = json?.data || {}
  return { id: data.id || '', duplicate: status === 409, parseStatus: data.parse_status || '' }
}

async function listExisting() {
  const names = new Set()
  let page = 1
  while (page <= 40) {
    const { json } = await api('GET', `/knowledge-bases/${KB_ID}/knowledge?page=${page}&page_size=200`)
    const items = unwrapList(json)
    for (const it of items) {
      if (it.file_name) names.add(it.file_name)
      if (it.title) names.add(it.title)
    }
    if (items.length < 200) break
    page += 1
  }
  return names
}

async function readKnowledge(id) {
  const { json } = await api('GET', `/knowledge/${encodeURIComponent(id)}`)
  return json?.data || json || {}
}

async function waitParse(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const data = await readKnowledge(id)
    const st = data.parse_status || ''
    if (st !== last) {
      last = st
      log(`    解析 ${st}${data.error_message ? ' ' + data.error_message : ''}`)
    }
    if (st === 'completed') return data
    if (st === 'failed') throw new Error(data.error_message || '解析失败')
    await new Promise((r) => setTimeout(r, 8000))
  }
  return { parse_status: last || 'timeout' }
}

function expand(row) {
  if (!row.parts) return [row]
  return row.parts.map((p, i) => ({
    ...row,
    key: `${row.key}#${i + 1}`,
    uploadName: p.name,
    preparedFile: p.file,
    part: `${i + 1}/${row.parts.length}`,
    pages: `${p.from}-${p.to}`,
  }))
}

async function ensureExpandedState() {
  const base = CATALOG.find((x) => x.split)
  if (!base?.parts) return
  for (const part of expand(base)) {
    if (!state.items[part.key]) {
      state.items[part.key] = {
        key: part.key,
        batch: part.batch,
        category: part.category,
        folder: part.folder,
        standard: part.standard,
        uploadName: part.uploadName,
        source: part.source,
        status: 'prepared',
        part: part.part,
        pages: part.pages,
      }
    }
  }
  if (state.items[base.key] && !String(base.key).includes('#')) {
    state.items[base.key].status = 'split'
    state.items[base.key].note = `拆成 ${base.parts.length} 份后分别上传`
  }
  await saveState()
}

async function importOne(row, existing, timeoutMs) {
  const rec = state.items[row.key] || { key: row.key, batch: row.batch }
  state.items[row.key] = rec
  rec.uploadName = row.uploadName
  rec.folder = row.folder
  if (rec.status === 'completed' || rec.status === 'skipped') {
    log(`跳过 ${row.uploadName}（${rec.status}）`)
    return
  }
  if (rec.status === 'parsing' && rec.knowledgeId) {
    log(`继续等待 ${row.uploadName}`)
    try {
      const parsed = await waitParse(rec.knowledgeId, timeoutMs)
      if (parsed.parse_status === 'completed') {
        rec.status = 'completed'
        rec.parseStatus = 'completed'
        rec.enableStatus = parsed.enable_status || ''
        rec.error = ''
        log(`  完成 ${row.standard}`)
      } else {
        rec.parseStatus = parsed.parse_status || 'timeout'
        rec.error = '本批等待超时，解析仍在进行'
        log(`  仍在解析 ${row.standard}（${rec.parseStatus}）`)
      }
    } catch (e) {
      rec.status = 'failed'
      rec.error = e.message
      log(`  失败 ${row.standard}：${e.message}`)
    }
    rec.updatedAt = now()
    await saveState()
    return
  }
  const filePath = row.preparedFile || await preparedPath(row)
  if (existing.has(row.uploadName) && !rec.knowledgeId) {
    rec.status = 'skipped'
    rec.note = '库中已有同名文件'
    rec.updatedAt = now()
    await saveState()
    log(`跳过 ${row.uploadName}（库中已有）`)
    return
  }
  try {
    await fs.access(filePath)
  } catch {
    rec.status = 'failed'
    rec.error = `找不到 ${filePath}`
    rec.updatedAt = now()
    await saveState()
    log(`失败 ${row.uploadName}：找不到文件`)
    return
  }
  const meta = {
    标准编号: row.standard,
    发布机构: row.publisher,
    状态: '现行',
    分类: row.category,
    来源文件: row.source,
  }
  if (row.part) meta.分册 = `${row.part} 页${row.pages}`
  log(`上传 ${row.folder}/${row.uploadName}`)
  rec.status = 'uploading'
  rec.updatedAt = now()
  await saveState()
  try {
    const up = await uploadFile(filePath, row.uploadName, row.folder, meta)
    rec.knowledgeId = up.id
    rec.duplicate = up.duplicate
    if (up.duplicate && up.parseStatus === 'completed') {
      rec.status = 'skipped'
      rec.parseStatus = 'completed'
      rec.updatedAt = now()
      await saveState()
      log(`  已存在且解析完成 ${up.id}`)
      return
    }
    rec.status = 'parsing'
    rec.parseStatus = up.parseStatus || 'pending'
    rec.updatedAt = now()
    await saveState()
    if (!up.id) throw new Error('上传未返回 id')
    const parsed = await waitParse(up.id, timeoutMs)
    if (parsed.parse_status === 'completed') {
      rec.status = 'completed'
      rec.parseStatus = 'completed'
      rec.enableStatus = parsed.enable_status || ''
      rec.error = ''
      log(`  完成 ${row.standard}`)
    } else {
      rec.status = 'parsing'
      rec.parseStatus = parsed.parse_status || 'timeout'
      rec.error = '本批等待超时，解析仍在进行'
      log(`  仍在解析 ${row.standard}（${rec.parseStatus}）`)
    }
  } catch (e) {
    rec.status = 'failed'
    rec.error = e.message
    log(`  失败 ${row.standard}：${e.message}`)
  }
  rec.updatedAt = now()
  await saveState()
}

async function runBatch(n) {
  const timeout = n === 3 ? 25 * 60 * 1000 : n === 2 ? 12 * 60 * 1000 : 8 * 60 * 1000
  const rows = []
  for (const row of CATALOG.filter((x) => x.batch === n)) {
    if (row.split) rows.push(...expand(row))
    else rows.push(row)
  }
  log(`== 第 ${n} 批 ${BATCHES[n]}（${rows.length} 份）`)
  const existing = await listExisting()
  for (const row of rows) {
    await importOne(row, existing, timeout)
    if (n === 3) existing.add(row.uploadName)
  }
  await saveState()
  const b = state.batches[n]
  log(`第 ${n} 批结束：完成 ${b.completed}/${b.count}，失败 ${b.failed}`)
}

function printStatus() {
  const s = state.summary
  console.log(`进度 ${s.completed}/${s.total} 完成，失败 ${s.failed}，解析中 ${s.uploaded}，未开始 ${s.pending}`)
  for (const n of [1, 2, 3]) {
    const b = state.batches[n]
    console.log(`  批次${n} [${b.status}] ${b.completed}/${b.count} 失败${b.failed} ${b.name}`)
  }
  for (const row of Object.values(state.items)) {
    if (row.status === 'failed' || row.status === 'parsing') {
      console.log(`  - ${row.status} ${row.uploadName || row.key} ${row.error || row.parseStatus || ''}`)
    }
  }
  console.log(`进度文件 ${STATE_FILE}`)
}

async function main() {
  const args = process.argv.slice(2)
  await loadState()
  if (args.includes('--status')) {
    printStatus()
    return
  }
  const only = args.includes('--batch') ? Number(args[args.indexOf('--batch') + 1]) : 0
  log('准备文件')
  await fs.mkdir(STAGE, { recursive: true })
  await convertDocs()
  await splitLarge()
  await ensureExpandedState()
  if (args.includes('--prepare-only')) {
    log('只做了转换和拆分')
    printStatus()
    return
  }
  await login()
  log(`已连接 ${BASE}`)
  const batches = only ? [only] : [1, 2, 3]
  for (const n of batches) await runBatch(n)
  printStatus()
}

main().catch(async (e) => {
  console.error(e.stack || e.message)
  if (state) {
    state.lastError = e.message
    await saveState().catch(() => {})
  }
  process.exit(1)
})
