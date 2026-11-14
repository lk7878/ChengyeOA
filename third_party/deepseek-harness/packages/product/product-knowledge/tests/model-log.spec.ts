import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { loggedKnowledgeLlm } from '@deepseek-ai/dsh-product-knowledge/src/model-log.ts'

let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined })

describe('Wiki model log lifecycle', () => {
  it.each(['missing', 'failed', 'ready'] as const)('requires a successful persistence checkpoint (%s)', async (persistence) => {
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    const dispatch = vi.fn()
    class Adapter extends LlmAdapter {
      override async *stream(): AsyncIterable<StreamChunk> {
        dispatch()
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.effect(() => ctx!.llm.registerAdapter(['fixture'], new Adapter()))
    const created: Session[] = []
    ctx.on('session/created', (session) => { created.push(session) })
    if (persistence !== 'missing') ctx.on('session/flush', () => {
      if (persistence === 'failed') throw new Error('test persistence failure')
    })
    const options: GenerateOptions = { provider: 'fixture', model: 'model', maxTokens: 16,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'plugin', plugin: 'dsh-product-knowledge' } })] }
    const run = async () => {
      for await (const chunk of loggedKnowledgeLlm(ctx!.llm, ctx!.sessions).stream(options)) void chunk
    }
    if (persistence === 'ready') await run()
    else await expect(run()).rejects.toThrow(/persistence/u)
    expect(dispatch).toHaveBeenCalledTimes(persistence === 'ready' ? 1 : 0)
    expect(created).toHaveLength(1)
    expect(ctx.sessions.get(created[0]!.id)).toBeUndefined()
    expect(created[0]!.events.at(-1)).toMatchObject({ type: 'turn/end' })
  })
})
