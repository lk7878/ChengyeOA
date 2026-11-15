/**
 * 账号库：E:\A\data\users.json。密码 scrypt 哈希，不落明文。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { usersShareCases } from './sharing.js'

const DATA_DIR = process.env.DATA_DIR || path.resolve('data')
const USERS_FILE = process.env.USERS_FILE || path.join(DATA_DIR, 'users.json')
const BOOTSTRAP_FILE = path.join(DATA_DIR, 'admin-initial-password.txt')

const ROLES = new Set([
  'platform_admin',
  'public_admin',
  'case_owner',
  'appraiser',
  'reviewer',
])
const STATUSES = new Set(['active', 'disabled', 'pending'])

function ensureDir() {
  mkdirSync(DATA_DIR, { recursive: true })
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 32).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false
  const next = scryptSync(String(password), salt, 32)
  const prev = Buffer.from(hash, 'hex')
  if (next.length !== prev.length) return false
  return timingSafeEqual(next, prev)
}

function publicUser(row) {
  if (!row) return null
  const { passwordHash, passwordSalt, ...rest } = row
  return rest
}

function loadRaw() {
  ensureDir()
  if (!existsSync(USERS_FILE)) return { users: [] }
  try {
    return JSON.parse(readFileSync(USERS_FILE, 'utf8'))
  } catch {
    return { users: [] }
  }
}

function saveRaw(data) {
  ensureDir()
  writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8')
}

function newId() {
  return `u-${randomBytes(3).toString('hex')}`
}

function nowIso() {
  return new Date().toISOString()
}

export function bootstrapUsers() {
  const data = loadRaw()
  if (data.users?.length) return { created: false, users: data.users.map(publicUser) }

  const adminPass = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '').trim() || randomBytes(9).toString('base64url')
  const hashed = hashPassword(adminPass)
  const now = nowIso()
  const admin = {
    id: 'u-001',
    username: 'admin',
    displayName: '平台管理员',
    email: 'admin@org.local',
    roles: ['platform_admin'],
    status: 'active',
    createdAt: now.slice(0, 10),
    lastActiveAt: null,
    passwordSalt: hashed.salt,
    passwordHash: hashed.hash,
  }
  saveRaw({ users: [admin] })
  writeFileSync(
    BOOTSTRAP_FILE,
    `平台管理员首次密码（登录后请立刻修改）\n用户名: admin\n密码: ${adminPass}\n生成时间: ${now}\n`,
    'utf8',
  )
  console.log(`[auth] 已创建管理员 admin，初始密码写在 ${BOOTSTRAP_FILE}`)
  return { created: true, users: [publicUser(admin)] }
}

export function listUsers() {
  if(process.env.OA_INTEGRATION==='0')bootstrapUsers()
  return loadRaw().users.map(publicUser)
}

export function getUserById(id) {
  if(process.env.OA_INTEGRATION==='0')bootstrapUsers()
  return publicUser(loadRaw().users.find((u) => u.id === id) || null)
}

export function getUserByUsername(username) {
  if(process.env.OA_INTEGRATION==='0')bootstrapUsers()
  const row = loadRaw().users.find((u) => u.username === String(username || '').trim())
  return row || null
}

export function authenticate(username, password) {
  const row = getUserByUsername(username)
  if (!row) return null
  if (!verifyPassword(password, row.passwordSalt, row.passwordHash)) return null
  if (row.status === 'disabled') {
    const err = new Error('账号已停用')
    err.code = 'disabled'
    throw err
  }
  if (row.status === 'pending') {
    const err = new Error('账号待激活，请联系管理员')
    err.code = 'pending'
    throw err
  }
  touchLastActive(row.id)
  return publicUser(row)
}

function touchLastActive(id) {
  const data = loadRaw()
  const row = data.users.find((u) => u.id === id)
  if (!row) return
  row.lastActiveAt = nowIso().slice(0, 19).replace('T', ' ')
  saveRaw(data)
}

export function createUser(input, { actor } = {}) {
  const username = String(input.username || '').trim()
  const displayName = String(input.displayName || '').trim()
  if (!username) throw new Error('用户名不能为空')
  if (!displayName) throw new Error('姓名不能为空')
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(username)) throw new Error('用户名仅允许字母数字和 ._-，2–32 位')
  const data = loadRaw()
  if (data.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('用户名已存在')
  }
  const roles = normalizeRoles(input.roles)
  const password = String(input.password || '').trim() || randomBytes(8).toString('base64url')
  const hashed = hashPassword(password)
  const row = {
    id: newId(),
    username,
    displayName,
    email: String(input.email || '').trim(),
    roles,
    status: STATUSES.has(input.status) ? input.status : 'pending',
    createdAt: nowIso().slice(0, 10),
    lastActiveAt: null,
    passwordSalt: hashed.salt,
    passwordHash: hashed.hash,
  }
  data.users.push(row)
  saveRaw(data)
  return { user: publicUser(row), initialPassword: String(input.password || '').trim() ? null : password }
}

export function updateUser(id, patch, { actor } = {}) {
  const data = loadRaw()
  const row = data.users.find((u) => u.id === id)
  if (!row) return null
  if (patch.displayName != null) row.displayName = String(patch.displayName).trim() || row.displayName
  if (patch.email != null) row.email = String(patch.email).trim()
  if (patch.roles != null) row.roles = normalizeRoles(patch.roles)
  if (patch.status != null) {
    if (!STATUSES.has(patch.status)) throw new Error('无效的账号状态')
    if (row.id === actor?.id && patch.status !== 'active') throw new Error('不能停用当前登录账号')
    row.status = patch.status
  }
  if (patch.password) {
    const hashed = hashPassword(String(patch.password))
    row.passwordSalt = hashed.salt
    row.passwordHash = hashed.hash
  }
  saveRaw(data)
  return publicUser(row)
}

function normalizeRoles(roles) {
  const list = Array.isArray(roles) ? roles.map(String) : []
  const next = [...new Set(list.filter((r) => ROLES.has(r)))]
  if (!next.length) throw new Error('至少选择一个角色')
  return next
}

export function hasRole(user, ...roles) {
  if (!user?.roles) return false
  return roles.some((r) => user.roles.includes(r))
}

export function isPlatformAdmin(user) {
  return hasRole(user, 'platform_admin')
}

export function canWriteKnowledge(user) {
  return hasRole(user, 'platform_admin', 'public_admin')
}

export function canOpenKbConsole(user) {
  return canWriteKnowledge(user)
}

export function canSeeBalance(user) {
  return isPlatformAdmin(user)
}

export function caseVisibleTo(meta, user) {
  if (!user || !meta) return false
  if (meta.ownerId === user.id) return true
  if ((meta.members || []).some((m) => m.accountId === user.id)) return true
  return false
}

export function canManageCase(meta, user) {
  if (!user || !meta) return false
  return meta.ownerId === user.id
}
