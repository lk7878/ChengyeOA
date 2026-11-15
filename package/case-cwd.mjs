/** 案件目录：用会话 cwd，不要用 Harness 进程的 process.cwd()。 */
import path from 'node:path'

export function resolveCaseCwd(exec) {
  const raw = exec?.agent?.session?.header?.cwd
  if (typeof raw === 'string' && raw.trim()) return path.resolve(raw.trim())
  return process.cwd()
}

export function relToCase(cwd, absPath) {
  return path.relative(cwd, absPath).replace(/\\/g, '/')
}
