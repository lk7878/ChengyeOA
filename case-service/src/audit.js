/**
 * 简易审计：追加 JSON 行到 E:\A\data\audit.log
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR || path.resolve('data')
const AUDIT_FILE = process.env.AUDIT_FILE || path.join(DATA_DIR, 'audit.log')

export function audit(user, action, extra = {}) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const row = {
      at: new Date().toISOString(),
      userId: user?.id || null,
      username: user?.username || null,
      action,
      ...extra,
    }
    appendFileSync(AUDIT_FILE, JSON.stringify(row) + '\n', 'utf8')
  } catch (e) {
    console.warn('[audit]', e.message)
  }
}
