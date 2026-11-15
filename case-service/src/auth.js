/**
 * 工作台登录：HMAC 签名 Cookie `by_sid`，HttpOnly。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getUserById } from './users.js'

const DATA_DIR = process.env.DATA_DIR || path.resolve('data')
const SECRET_FILE = path.join(DATA_DIR, 'auth-secret.txt')
const COOKIE = 'by_sid'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

function loadSecret() {
  mkdirSync(DATA_DIR, { recursive: true })
  if (process.env.AUTH_SECRET) return String(process.env.AUTH_SECRET)
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, 'utf8').trim()
  const secret = randomBytes(32).toString('hex')
  writeFileSync(SECRET_FILE, secret, 'utf8')
  return secret
}

const SECRET = loadSecret()

function sign(payloadB64) {
  return createHmac('sha256', SECRET).update(payloadB64).digest('base64url')
}

export function makeSessionCookie(userId) {
  const payload = Buffer.from(JSON.stringify({
    uid: userId,
    exp: Date.now() + TTL_MS,
  }), 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** 打开 Harness 时放进 URL hash，供助手拉取「当前用户可见的案件会话」。 */
export function mintAiAclTicket(userId, ttlMs = 12 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({
    uid: userId,
    exp: Date.now() + ttlMs,
    kind: 'ai-acl',
  }), 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function readAiAclUser(ticket) {
  const token = String(ticket || '').trim()
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  const expect = sign(payload)
  const a = Buffer.from(mac)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (data?.kind !== 'ai-acl' || !data.uid || data.exp < Date.now()) return null
    const user = getUserById(data.uid)
    if (!user || user.status !== 'active') return null
    return user
  } catch {
    return null
  }
}

export function readSessionUser(cookieHeader) {
  const token = parseCookie(cookieHeader)[COOKIE]
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  const expect = sign(payload)
  const a = Buffer.from(mac)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!data?.uid || data.exp < Date.now()) return null
    const user = getUserById(data.uid)
    if (!user || user.status !== 'active') return null
    return user
  } catch {
    return null
  }
}

export function parseCookie(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    try { out[k] = decodeURIComponent(v) } catch { out[k] = v }
  }
  return out
}

export function requestHost(headers = {}) {
  const xf = headers['x-forwarded-host']
  if (xf) return String(xf).split(',')[0].trim()
  return String(headers.host || '').trim()
}

export function isLocalRequestHost(host) {
  const h = String(host || '').trim().toLowerCase()
  if (!h) return true
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h)
}

export function sessionCookieHeader(value, { clear = false, headers } = {}) {
  const domain = String(process.env.COOKIE_DOMAIN || '').trim()
  const secure = String(process.env.COOKIE_SECURE || '') === '1'
  const local = isLocalRequestHost(requestHost(headers))
  const parts = [
    `${COOKIE}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (clear) parts.push('Max-Age=0')
  else parts.push(`Max-Age=${Math.floor(TTL_MS / 1000)}`)
  if (domain && !local) parts.push(`Domain=${domain}`)
  if (secure && !local) parts.push('Secure')
  return parts.join('; ')
}

export function cookieName() {
  return COOKIE
}
