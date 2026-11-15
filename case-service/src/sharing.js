/**
 * 数据共享组：同组成员可互见彼此负责的案件（读/写材料，不可删案或改成员）。
 * 存储于 E:\A\data\sharing-groups.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR || path.resolve('data')
const GROUPS_FILE = process.env.SHARING_GROUPS_FILE || path.join(DATA_DIR, 'sharing-groups.json')

function ensureDir() {
  mkdirSync(DATA_DIR, { recursive: true })
}

function loadRaw() {
  ensureDir()
  if (!existsSync(GROUPS_FILE)) return { groups: [] }
  try {
    return JSON.parse(readFileSync(GROUPS_FILE, 'utf8'))
  } catch {
    return { groups: [] }
  }
}

function saveRaw(data) {
  ensureDir()
  writeFileSync(GROUPS_FILE, JSON.stringify(data, null, 2), 'utf8')
  invalidateCache()
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return `sg-${randomBytes(3).toString('hex')}`
}

function normalizeMemberIds(ids) {
  if (!Array.isArray(ids)) throw new Error('成员列表格式无效')
  const next = [...new Set(ids.map(String).filter(Boolean))]
  if (next.length < 2) throw new Error('共享组至少需要 2 名成员')
  return next
}

/** userId -> Set<groupId> */
let userGroupIndex = null

function rebuildIndex() {
  const data = loadRaw()
  const index = new Map()
  for (const g of data.groups || []) {
    for (const uid of g.memberIds || []) {
      if (!index.has(uid)) index.set(uid, new Set())
      index.get(uid).add(g.id)
    }
  }
  userGroupIndex = index
}

function invalidateCache() {
  userGroupIndex = null
}

function getUserGroupIndex() {
  if (!userGroupIndex) rebuildIndex()
  return userGroupIndex
}

/** 两名用户是否在同一共享组 */
export function usersShareCases(userIdA, userIdB) {
  if (!userIdA || !userIdB || userIdA === userIdB) return false
  const index = getUserGroupIndex()
  const groupsA = index.get(userIdA)
  if (!groupsA?.size) return false
  const groupsB = index.get(userIdB)
  if (!groupsB?.size) return false
  for (const gid of groupsA) {
    if (groupsB.has(gid)) return true
  }
  return false
}

export function listSharingGroups() {
  return loadRaw().groups || []
}

export function getSharingGroup(id) {
  return listSharingGroups().find((g) => g.id === id) || null
}

export function createSharingGroup(input, { validateUserIds } = {}) {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('共享组名称不能为空')
  const memberIds = normalizeMemberIds(input.memberIds)
  if (validateUserIds) validateUserIds(memberIds)

  const data = loadRaw()
  for (const g of data.groups) {
    for (const uid of memberIds) {
      if ((g.memberIds || []).includes(uid)) {
        throw new Error(`用户 ${uid} 已在共享组「${g.name}」中，每人只能加入一个组`)
      }
    }
  }

  const row = {
    id: newId(),
    name,
    memberIds,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  data.groups.push(row)
  saveRaw(data)
  return row
}

export function updateSharingGroup(id, patch, { validateUserIds } = {}) {
  const data = loadRaw()
  const row = data.groups.find((g) => g.id === id)
  if (!row) return null

  if (patch.name != null) {
    const name = String(patch.name).trim()
    if (!name) throw new Error('共享组名称不能为空')
    row.name = name
  }
  if (patch.memberIds != null) {
    const memberIds = normalizeMemberIds(patch.memberIds)
    if (validateUserIds) validateUserIds(memberIds)
    for (const g of data.groups) {
      if (g.id === id) continue
      for (const uid of memberIds) {
        if ((g.memberIds || []).includes(uid)) {
          throw new Error(`用户 ${uid} 已在共享组「${g.name}」中，每人只能加入一个组`)
        }
      }
    }
    row.memberIds = memberIds
  }

  row.updatedAt = nowIso()
  saveRaw(data)
  return row
}

export function deleteSharingGroup(id) {
  const data = loadRaw()
  const idx = data.groups.findIndex((g) => g.id === id)
  if (idx < 0) return false
  data.groups.splice(idx, 1)
  saveRaw(data)
  return true
}
