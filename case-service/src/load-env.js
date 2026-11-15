/** 先于其它模块加载 E:\A\data\gateway.env（COOKIE_DOMAIN / AI_PUBLIC_BASE 等）。 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const FILE = process.env.GATEWAY_ENV || path.join(process.env.DATA_DIR || path.resolve('data'), 'gateway.env')

function applyEnvFile(file) {
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
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

applyEnvFile(FILE)
