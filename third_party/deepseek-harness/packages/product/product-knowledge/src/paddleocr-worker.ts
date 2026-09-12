/** Supervised loopback client for the product-owned local PaddleOCR worker. */

import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** One normalized OCR block returned by the local PaddleOCR pipeline. */
export interface PaddleOcrBlock {
  readonly text: string
  readonly type: string
  readonly box: readonly number[] | null
  readonly confidence: number | null
}

/** Validated result for one rendered PDF page. */
export interface PaddleOcrPageResult {
  readonly text: string
  readonly blocks: readonly PaddleOcrBlock[]
  readonly model: string
  readonly engine: string
  readonly elapsedMs: number
}

/** Minimal OCR provider boundary consumed by document extraction. */
export interface PaddleOcrProvider {
  recognize(image: Uint8Array, pageNumber: number): Promise<PaddleOcrPageResult>
  close(): void
}

/** Configuration for one application-managed local worker generation. */
export interface LocalPaddleOcrConfig {
  readonly pythonPath: string
  readonly workerPath: string
  readonly cachePath: string
  readonly model: string
  readonly device: 'cpu' | 'gpu'
  readonly timeoutMs: number
  readonly maxImageBytes: number
}

/** Lazily starts and supervises a token-authenticated worker bound to 127.0.0.1. */
export class LocalPaddleOcrClient implements PaddleOcrProvider {
  readonly #config: LocalPaddleOcrConfig
  readonly #token = randomBytes(32).toString('hex')
  #child: ChildProcessWithoutNullStreams | undefined
  #endpoint: Promise<string> | undefined
  #stderr = ''

  constructor(config: LocalPaddleOcrConfig) { this.#config = config }

  async recognize(image: Uint8Array, pageNumber: number): Promise<PaddleOcrPageResult> {
    if (image.byteLength === 0 || image.byteLength > this.#config.maxImageBytes) {
      throw new Error(`OCR page image is outside the configured byte limit (${image.byteLength}).`)
    }
    const endpoint = await this.#ensureStarted()
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(new Error('Local PaddleOCR request timed out.')) }, this.#config.timeoutMs)
    try {
      const response = await fetch(`${endpoint}/ocr`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64: Buffer.from(image).toString('base64'), pageNumber }),
        signal: controller.signal,
      })
      const body = await response.text()
      if (!response.ok) throw new Error(`Local PaddleOCR failed (${response.status}): ${safeMessage(body)}`)
      if (body.length > 10_000_000) throw new Error('Local PaddleOCR response exceeded the configured safety bound.')
      return validateResult(JSON.parse(body) as unknown)
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${message} ${this.#stderr}`.trim())
    } finally { clearTimeout(timer) }
  }

  close(): void {
    this.#child?.kill()
    this.#child = undefined
    this.#endpoint = undefined
  }

  async #ensureStarted(): Promise<string> {
    this.#endpoint ??= this.#start()
    try { return await this.#endpoint } catch (error) {
      this.close()
      throw error
    }
  }

  #start(): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.#config.pythonPath, [
        this.#config.workerPath,
        '--token', this.#token,
        '--model', this.#config.model,
        '--device', this.#config.device,
        '--max-image-bytes', String(this.#config.maxImageBytes),
      ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PADDLE_PDX_CACHE_HOME: this.#config.cachePath,
          PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True',
          PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT: 'False',
          PADDLE_PDX_MODEL_SOURCE: process.env.PADDLE_PDX_MODEL_SOURCE ?? 'BOS',
        },
      })
      this.#child = child
      let stdout = ''
      const startupTimer = setTimeout(() => {
        reject(new Error(`Local PaddleOCR worker did not become ready. ${this.#stderr}`.trim()))
        child.kill()
      }, Math.min(this.#config.timeoutMs, 60_000))
      const fail = (error: unknown) => {
        clearTimeout(startupTimer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      child.once('error', fail)
      child.once('exit', (code) => {
        if (this.#child === child) {
          this.#child = undefined
          this.#endpoint = undefined
        }
        fail(new Error(`Local PaddleOCR worker exited with code ${code}. ${this.#stderr}`.trim()))
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => { this.#stderr = `${this.#stderr}${chunk}`.slice(-4_000) })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        for (;;) {
          const newline = stdout.indexOf('\n')
          if (newline < 0) break
          const line = stdout.slice(0, newline).trim()
          stdout = stdout.slice(newline + 1)
          try {
            const frame = JSON.parse(line) as unknown
            if (!isReadyFrame(frame)) continue
            clearTimeout(startupTimer)
            resolve(`http://127.0.0.1:${frame.port}`)
          } catch { /* dependency diagnostics may write non-protocol lines */ }
        }
      })
    })
  }
}

function isReadyFrame(value: unknown): value is { readonly type: 'ready'; readonly port: number } {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as Record<string, unknown>
  return frame.type === 'ready' && typeof frame.port === 'number' && Number.isInteger(frame.port)
    && frame.port >= 1 && frame.port <= 65_535
}

function validateResult(value: unknown): PaddleOcrPageResult {
  if (typeof value !== 'object' || value === null) throw new Error('Local PaddleOCR returned a non-object response.')
  const input = value as Partial<PaddleOcrPageResult>
  if (typeof input.text !== 'string' || typeof input.model !== 'string' || typeof input.engine !== 'string'
    || typeof input.elapsedMs !== 'number' || !Array.isArray(input.blocks)) {
    throw new Error('Local PaddleOCR response did not match the expected contract.')
  }
  const blocks = input.blocks.map((block: unknown) => {
    if (typeof block !== 'object' || block === null) throw new Error('Local PaddleOCR returned an invalid block.')
    const candidate = block as Record<string, unknown>
    if (typeof candidate.text !== 'string' || typeof candidate.type !== 'string'
      || !(candidate.box === null || Array.isArray(candidate.box))
      || !(candidate.confidence === null || typeof candidate.confidence === 'number')) {
      throw new Error('Local PaddleOCR returned an invalid block.')
    }
    return candidate as unknown as PaddleOcrBlock
  })
  return { text: input.text, model: input.model, engine: input.engine, elapsedMs: input.elapsedMs, blocks }
}

function safeMessage(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 500)
}
