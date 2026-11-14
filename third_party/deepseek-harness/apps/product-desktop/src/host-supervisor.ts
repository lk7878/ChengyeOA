import { spawn } from 'node:child_process'

const READY_PREFIX = 'dsh web: '
const LAUNCH_TOKEN = /^[A-Za-z0-9_-]{43}$/u
const MAX_DIAGNOSTIC_CHARS = 8_192

/** A validated, single-use browser launch URL emitted by the Harness host. */
export interface HostReady {
  launchUrl: string
  origin: string
}

/** Minimal child-process surface used by the supervisor and its tests. */
export interface HostChild {
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  once(event: 'error', listener: (error: Error) => void): this
}

/** Options for supervising one local Harness product host generation. */
export interface HostSupervisorOptions {
  command: string
  args: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  readyTimeoutMs?: number
  shutdownTimeoutMs?: number
  spawnHost?: () => HostChild
  onUnexpectedExit?: (message: string) => void
}

/** Public controls for the single local Harness host generation. */
export interface HostSupervisor {
  start(): Promise<HostReady>
  shutdown(): Promise<void>
  diagnostics(): string
}

/** Parse and validate the one readiness line accepted by the desktop shell. */
export function parseHostReadinessLine(line: string): HostReady | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined

  const candidate = line.slice(READY_PREFIX.length).trim()
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return undefined
  }

  const allowedHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  const explicitPort = /^https?:\/\/[^/:]+:\d+\//u.test(candidate)
  const entries = [...url.searchParams.entries()]
  const soleEntry = entries.length === 1 ? entries[0] : undefined
  const token = url.searchParams.get('token')
  if (
    url.protocol !== 'http:' ||
    !allowedHost ||
    !explicitPort ||
    url.port.length === 0 ||
    Number(url.port) < 1 ||
    Number(url.port) > 65_535 ||
    url.pathname !== '/' ||
    url.hash.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    soleEntry === undefined ||
    soleEntry[0] !== 'token' ||
    token === null ||
    !LAUNCH_TOKEN.test(token)
  ) {
    return undefined
  }

  return { launchUrl: url.href, origin: url.origin }
}

/** Create a bounded line parser that recognizes readiness across stream chunks. */
export function createReadinessParser(onReady: (ready: HostReady) => void): (chunk: Buffer | string) => void {
  let remainder = ''
  let settled = false
  return (chunk) => {
    if (settled) return
    remainder = `${remainder}${chunk.toString()}`.slice(-MAX_DIAGNOSTIC_CHARS)
    const lines = remainder.split(/\r?\n/u)
    remainder = lines.pop() ?? ''
    for (const line of lines) {
      const ready = parseHostReadinessLine(line)
      if (ready) {
        settled = true
        onReady(ready)
        return
      }
    }
  }
}

/** Redact launch credentials before host output reaches diagnostics or dialogs. */
export function redactHostOutput(value: string): string {
  return value.replace(/([?&]token=)[A-Za-z0-9_-]+/gu, '$1<redacted>')
}

function defaultSpawn(options: HostSupervisorOptions): HostChild {
  return spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

async function waitForExit(child: HostChild, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve(false) }, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/** Supervise exactly one local Harness host and coalesce concurrent starts. */
export function createHostSupervisor(options: HostSupervisorOptions): HostSupervisor {
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000
  let child: HostChild | undefined
  let startPromise: Promise<HostReady> | undefined
  let stopping = false
  let started = false
  let diagnosticText = ''

  const appendDiagnostic = (chunk: Buffer | string) => {
    diagnosticText = `${diagnosticText}${redactHostOutput(chunk.toString())}`.slice(-MAX_DIAGNOSTIC_CHARS)
  }

  const start = (): Promise<HostReady> => {
    if (startPromise) return startPromise
    startPromise = new Promise<HostReady>((resolve, reject) => {
      child = options.spawnHost?.() ?? defaultSpawn(options)
      const current = child
      let settled = false
      const finish = (error?: Error, ready?: HostReady) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else if (ready) {
          started = true
          resolve(ready)
        }
      }
      const parse = createReadinessParser((ready) => { finish(undefined, ready) })
      current.stdout.on('data', (chunk: Buffer) => {
        appendDiagnostic(chunk)
        parse(chunk)
      })
      current.stderr.on('data', appendDiagnostic)
      current.once('error', (error) => {
        finish(new Error(`Product host could not start: ${error.message}`, { cause: error }))
      })
      current.once('exit', (code, signal) => {
        child = undefined
        if (!started) {
          finish(new Error(`Product host exited before readiness (code=${String(code)}, signal=${String(signal)}).`))
        } else if (!stopping) {
          options.onUnexpectedExit?.(`Product host exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`)
        }
      })
      const timer = setTimeout(() => {
        finish(new Error(`Product host did not become ready within ${readyTimeoutMs} ms.`))
        current.kill('SIGTERM')
      }, readyTimeoutMs)
    })
    return startPromise
  }

  const shutdown = async (): Promise<void> => {
    stopping = true
    const current = child
    if (!current || current.exitCode !== null || current.signalCode !== null) return
    current.kill('SIGTERM')
    if (!(await waitForExit(current, shutdownTimeoutMs))) {
      current.kill('SIGKILL')
      await waitForExit(current, shutdownTimeoutMs)
    }
  }

  return { start, shutdown, diagnostics: () => diagnosticText }
}
