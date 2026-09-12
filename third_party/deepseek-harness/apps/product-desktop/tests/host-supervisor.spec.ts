import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  createHostSupervisor,
  createReadinessParser,
  parseHostReadinessLine,
  redactHostOutput,
  type HostChild,
} from '../src/host-supervisor.js'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH012345678'
const READY_URL = `http://127.0.0.1:43123/?token=${TOKEN}`

class FakeChild extends EventEmitter implements HostChild {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly kills: Array<NodeJS.Signals | number | undefined> = []

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal)
    return true
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }

  fail(error: Error): void {
    this.emit('error', error)
  }
}

function supervisor(child: FakeChild, overrides: Partial<Parameters<typeof createHostSupervisor>[0]> = {}) {
  return createHostSupervisor({
    command: 'electron',
    args: [],
    cwd: '.',
    spawnHost: () => child,
    readyTimeoutMs: 100,
    shutdownTimeoutMs: 10,
    ...overrides,
  })
}

describe('host readiness', () => {
  it('accepts only a loopback HTTP root URL with one legal token', () => {
    expect(parseHostReadinessLine(`dsh web: ${READY_URL}`)).toEqual({
      launchUrl: READY_URL,
      origin: 'http://127.0.0.1:43123',
    })
    for (const url of [
      `https://127.0.0.1:43123/?token=${TOKEN}`,
      `http://0.0.0.0:43123/?token=${TOKEN}`,
      `http://127.0.0.1/?token=${TOKEN}`,
      `http://127.0.0.1:43123/admin?token=${TOKEN}`,
      `http://127.0.0.1:43123/?token=${TOKEN}&extra=1`,
      'http://127.0.0.1:43123/?token=short',
    ]) {
      expect(parseHostReadinessLine(`dsh web: ${url}`)).toBeUndefined()
    }
  })

  it('recognizes a readiness line split across chunks', () => {
    const accept = vi.fn()
    const parse = createReadinessParser(accept)
    parse('noise\r\ndsh web: http://127.0.0.1:43123/?tok')
    parse(`en=${TOKEN}\r\n`)
    expect(accept).toHaveBeenCalledOnce()
  })

  it('settles on the first valid readiness line when later output conflicts', () => {
    const accept = vi.fn()
    const parse = createReadinessParser(accept)
    parse(`dsh web: ${READY_URL}\n`)
    parse(`dsh web: http://127.0.0.1:43124/?token=${TOKEN}\n`)
    expect(accept).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ origin: 'http://127.0.0.1:43123' }))
  })

  it('redacts launch tokens from diagnostics', () => {
    expect(redactHostOutput(`open ${READY_URL}`)).toBe('open http://127.0.0.1:43123/?token=<redacted>')
  })
})

describe('host supervisor', () => {
  it('coalesces concurrent starts into one host generation', async () => {
    const child = new FakeChild()
    const host = supervisor(child)
    const first = host.start()
    const second = host.start()
    expect(first).toBe(second)
    child.stdout.write(`dsh web: ${READY_URL}\n`)
    await expect(first).resolves.toMatchObject({ origin: 'http://127.0.0.1:43123' })
  })

  it('rejects an early host exit and reports an unexpected later exit', async () => {
    const early = new FakeChild()
    const earlyHost = supervisor(early)
    const earlyStart = earlyHost.start()
    early.exit(2, null)
    await expect(earlyStart).rejects.toThrow('before readiness')

    const ready = new FakeChild()
    const unexpected = vi.fn()
    const readyHost = supervisor(ready, { onUnexpectedExit: unexpected })
    const readyStart = readyHost.start()
    ready.stdout.write(`dsh web: ${READY_URL}\n`)
    await readyStart
    ready.exit(1, null)
    expect(unexpected).toHaveBeenCalledOnce()
  })

  it('rejects an operating-system spawn failure immediately', async () => {
    const child = new FakeChild()
    const host = supervisor(child)
    const start = host.start()
    child.fail(new Error('missing executable'))
    await expect(start).rejects.toThrow('could not start: missing executable')
  })

  it('terminates a host that misses its readiness deadline', async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeChild()
      const host = supervisor(child, { readyTimeoutMs: 20 })
      const start = host.start()
      const rejected = expect(start).rejects.toThrow('did not become ready')
      await vi.advanceTimersByTimeAsync(20)
      await rejected
      expect(child.kills).toEqual(['SIGTERM'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('escalates from a bounded graceful stop to a forced stop', async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeChild()
      const host = supervisor(child, { shutdownTimeoutMs: 20 })
      const start = host.start()
      child.stdout.write(`dsh web: ${READY_URL}\n`)
      await start
      const stopping = host.shutdown()
      await vi.advanceTimersByTimeAsync(20)
      child.exit(null, 'SIGKILL')
      await stopping
      expect(child.kills).toEqual(['SIGTERM', 'SIGKILL'])
    } finally {
      vi.useRealTimers()
    }
  })
})
