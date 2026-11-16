/**
 * CloseAI 聚合网关：模型目录、余额查询、密钥加载。
 * 文档：https://api.openai-proxy.org  （OpenAI 兼容 /v1，管理接口需 sk-admin-）
 * 新增聊天模型：在 CHAT_MODELS 加一条 { id, name, role }，并同步 .dsh/settings.yaml。
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DSH_HOME = process.env.DSH_HOME || path.join(ROOT, '.dsh')
const DSH_ENV = path.join(DSH_HOME, '.env')
const CLOSE_BASE = 'https://api.openai-proxy.org'

/** @typedef {{ id: string, name: string, role: 'main' | 'reasoning' | 'flash' | 'vision' }} ChatModel */

/** 聊天模型。role：main 适中主会话、reasoning 复杂、flash 简单、vision 仅 OCR。 */
export const CHAT_MODELS = [
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', role: 'reasoning' },
  { id: 'gpt-5.5', name: 'GPT-5.5 · 主分析', role: 'main' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', role: 'reasoning' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', role: 'reasoning' },
  { id: 'gemini-3.1-flash-lite-image', name: 'Gemini 3.1 Flash Lite · 复杂识图', role: 'vision' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', role: 'reasoning' },
  { id: 'deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro · 0813', role: 'reasoning' },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', role: 'flash' },
  { id: 'qwen3.8-max', name: '千问 3.8 Max', role: 'reasoning' },
  { id: 'qwen3.8-flash', name: '千问 3.8 Flash', role: 'main' },
  { id: 'qwen3.7-plus', name: '千问 3.7 Plus', role: 'main' },
  { id: 'qwen3.5-flash', name: '千问 3.5 Flash · 病历识图', role: 'vision' },
  { id: 'glm-5.3', name: 'GLM-5.3', role: 'reasoning' },
  { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', role: 'flash' },
  { id: 'kimi-k3', name: 'Kimi K3', role: 'reasoning' },
]

export const EMBEDDING_MODEL = { id: 'text-embedding-ada-002', name: 'Ada Embedding' }
export const DEFAULT_CHAT_MODEL = 'qwen3.8-flash'
export const PARSE_MODEL = 'qwen3.5-flash'
export const PARSE_VISION_MODEL = 'gemini-3.1-flash-lite-image'
export const PARSE_PROVIDER = 'closeai'
export const WEKNORA_EMBEDDING = 'text-embedding-v4'

export function loadDshEnv() {
  if (!existsSync(DSH_ENV)) return
  const text = readFileSync(DSH_ENV, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && !String(process.env[key] || '').trim()) process.env[key] = value
  }
}

function authHeaders(key) {
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' }
}

function pickNumber(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function fromBody(body) {
  if (!body || typeof body !== 'object') return null
  const data = body.data && typeof body.data === 'object' ? body.data : body
  const amount = pickNumber(
    data.balance,
    data.total_available,
    data.totalAvailable,
    data.credit_balance,
    data.remain_quota,
    data.quota,
    data.hard_limit_usd,
  )
  if (amount == null) return null
  const used = pickNumber(data.total_used, data.used, data.total_usage)
  const granted = pickNumber(data.total_granted, data.hard_limit_usd, data.total)
  return { amount, used, granted, raw: data }
}

async function tryGet(url, key) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await fetch(url, { headers: authHeaders(key), signal: ctrl.signal })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch { json = null }
    const errMsg = json?.error?.message || json?.message || ''
    return { ok: r.ok, status: r.status, json, text: text.slice(0, 240), errMsg }
  } catch (e) {
    const msg = String(e.message || e)
    const aborted = e.name === 'AbortError' || /aborted/i.test(msg)
    return { ok: false, status: 0, json: null, text: msg, errMsg: aborted ? '查询超时' : msg }
  } finally {
    clearTimeout(t)
  }
}

function failDetail(res) {
  if (!res) return '无响应'
  if (res.errMsg) return `HTTP ${res.status} ${res.errMsg}`.trim()
  if (res.status) return `HTTP ${res.status}`
  return res.text || '网络失败'
}

export async function fetchCloseBalance() {
  loadDshEnv()
  const apiKey = String(process.env.CLOSEAI_API_KEY || '').trim()
  const adminKey = String(process.env.CLOSEAI_ADMIN_KEY || '').trim()
  const attempts = []

  // 普通 sk- 走 OpenAI 兼容账单接口（无 /v1）；sk-admin- 走平台开放接口（需企业认证且密钥有效）
  if (apiKey) {
    attempts.push(
      { source: 'credit_grants_root', url: `${CLOSE_BASE}/dashboard/billing/credit_grants`, key: apiKey },
      { source: 'credit_grants', url: `${CLOSE_BASE}/v1/dashboard/billing/credit_grants`, key: apiKey },
    )
  }
  if (adminKey) {
    attempts.push({ source: 'admin', url: `${CLOSE_BASE}/api/v1/account/balance`, key: adminKey })
  }

  let last = null
  let lastSource = null
  for (const a of attempts) {
    const res = await tryGet(a.url, a.key)
    last = res
    lastSource = a.source
    if (!res.ok || !res.json) continue
    const parsed = fromBody(res.json)
    if (!parsed) continue
    return {
      ok: true,
      amount: parsed.amount,
      used: parsed.used,
      granted: parsed.granted,
      currency: 'CNY',
      source: a.source,
      configured: true,
      updatedAt: new Date().toISOString(),
    }
  }

  const configured = Boolean(apiKey || adminKey)
  return {
    ok: false,
    amount: null,
    used: null,
    granted: null,
    currency: 'CNY',
    source: lastSource,
    configured,
    error: configured
      ? `余额查询失败（${failDetail(last)}）`
      : '未配置 CLOSEAI_API_KEY / CLOSEAI_ADMIN_KEY',
    updatedAt: new Date().toISOString(),
  }
}

export function llmStatusPayload(balance) {
  return {
    provider: 'closeai',
    providerLabel: 'CloseAI 聚合',
    defaultModel: DEFAULT_CHAT_MODEL,
    parseModel: PARSE_MODEL,
    parseVisionModel: PARSE_VISION_MODEL,
    parseProvider: PARSE_PROVIDER,
    embeddingModel: WEKNORA_EMBEDDING,
    closeEmbedding: EMBEDDING_MODEL.id,
    search: 'google-mcp',
    models: CHAT_MODELS,
    balance,
  }
}
