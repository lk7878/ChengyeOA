import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { KnowledgeController } from '@deepseek-ai/dsh-product-knowledge'
import { expandKnowledgeQuery, generateKnowledgeAnswer, streamKnowledgeAnswer } from '@deepseek-ai/dsh-product-knowledge/src/rag.ts'
import type { KnowledgeAnswerView, KnowledgeModelSettings } from '@deepseek-ai/dsh-product-knowledge/types'
import SessionStore, { Session } from '@deepseek-ai/dsh-session'

const local: KnowledgeAnswerView = {
  status: 'answered', requestedMode: 'local', mode: 'local-extractive', question: 'When is notice required?',
  answer: '[1] Notice is required before action.', confidence: 'low', generation: null,
  citations: [{
    id: 1, documentId: 'doc-1', documentName: 'Policy.md', heading: 'Notice',
    startLine: 2, endLine: 3, content: 'Notice is required before action.', contentHash: 'a'.repeat(64),
  }],
}

const config = { maxEvidenceChars: 4_000, maxOutputTokens: 400, timeoutMs: 1_000 }
const target = { provider: 'fixture', model: 'fixture-model' }

function llm(chunks: readonly StreamChunk[], inspect?: (options: GenerateOptions) => void): Pick<LlmRuntime, 'stream' | 'prepareCall'> {
  const stream = async function* (options: GenerateOptions) {
    inspect?.(options)
    for (const chunk of chunks) yield chunk
  }
  return {
    stream,
    prepareCall: vi.fn(async (config: Parameters<LlmRuntime['prepareCall']>[0]) => ({ config, adapterDefaults: {}, stream,
      retryPolicy: { mode: 'normal' as const, maxRetries: 0, retryableCodes: [], initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 } })),
  }
}

const sessions = {
  prepare: (id: Parameters<SessionStore['prepare']>[0]) => Session.create(id!),
  enter: () => () => {}, announce: () => {}, flush: async () => true,
} as unknown as SessionStore

describe('generated knowledge RAG', () => {
  it('repairs Chinese synthesis once using exactly the same bounded evidence and never streams repair JSON', async () => {
    const calls: GenerateOptions[] = []
    const model = { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      calls.push(options)
      yield { type: 'text-delta', index: 0, text: calls.length === 1 ? 'Notice is required [1].'
        : '{"status":"answered","answer":"应先通知，再采取行动 [1]。"}' }
      yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    const frames = []
    for await (const frame of streamKnowledgeAnswer(model, target, { ...local, question: '何时需要通知？' },
      { ...config, answerRepair: { maxTokens: 128 } })) frames.push(frame)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.maxTokens).toBe(128)
    expect(calls[1]?.signal).toBe(calls[0]?.signal)
    expect(calls[1]?.messages[0]?.content).toEqual(calls[0]?.messages[0]?.content)
    expect(frames.filter(frame => frame.type === 'delta')).toEqual([{ type: 'delta', text: 'Notice is required [1].' }])
    expect(frames.at(-1)).toMatchObject({ type: 'complete', answer: { mode: 'model-rag', answer: '应先通知，再采取行动 [1]。',
      answerRepair: { reason: 'answer-language', status: 'repaired', generation: { totalTokens: 42 } } } })
  })

  it('accepts a structured evidence insufficiency without admitting uncited factual text', async () => {
    for (const refusal of ['', 'THUMS v7 proves a risk threshold of 50%.']) {
      let calls = 0
      const model = { async *stream(): AsyncIterable<StreamChunk> {
        yield { type: 'text-delta', index: 0, text: calls++ === 0 ? '无法从 v4.1 的资料确认 v7 的结论。'
          : JSON.stringify({ status: 'insufficient-evidence', answer: refusal }) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } }
      const result = await generateKnowledgeAnswer(model, target, { ...local, question: 'THUMS v7 的风险曲线如何开发？' },
        { ...config, answerRepair: { maxTokens: 128 } })
      expect(calls).toBe(2)
      expect(result.mode).toBe(refusal === '' ? 'model-insufficient' : 'model-failed')
      expect(result.answer).not.toContain('50%')
      expect(result.confidence).toBe('none')
      expect(result.citations).toEqual(local.citations)
    }
  })

  it('does not retry a failed repair or publish its invalid text as a final answer', async () => {
    for (const text of ['Missing sources.', 'Wrong [9].', 'Grouped [1, 2].']) {
      let calls = 0
      const model = { async *stream(): AsyncIterable<StreamChunk> {
        yield { type: 'text-delta', index: 0, text: calls++ === 0 ? text : '{"status":"answered","answer":"Still wrong [9]."}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } }
      const result = await generateKnowledgeAnswer(model, target, local, { ...config, answerRepair: { maxTokens: 128 } })
      expect(calls).toBe(2)
      expect(result).toMatchObject({ status: 'failed', mode: 'model-failed', answerRepair: { status: 'failed' } })
      expect(result.answer).not.toContain('Still wrong')
      expect(result.answer).not.toBe(local.answer)
    }
  })

  it('propagates cancellation during correction without publishing a completion', async () => {
    const controller = new AbortController()
    let calls = 0
    const model = { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (++calls === 2) controller.abort(new Error('cancel repair'))
      options.signal?.throwIfAborted()
      yield { type: 'text-delta', index: 0, text: 'Missing citation.' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    await expect(generateKnowledgeAnswer(model, target, local, { ...config, answerRepair: { maxTokens: 128 } }, controller.signal)).rejects.toThrow('cancel repair')
    expect(calls).toBe(2)
  })
  it('rejects irrelevant candidates before explicitly labelled general generation', async () => {
    const inspect: GenerateOptions[] = []
    const model = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        inspect.push(options)
        yield { type: 'text-delta', index: 0, text: inspect.length === 1 ? '{"ids":[]}' : '以下仅为通用知识。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await generateKnowledgeAnswer(model, target, local,
      { ...config, evidenceSelection: { maxTokens: 128, timeoutMs: 1000 } })
    expect(result).toMatchObject({ mode: 'model-general', citations: [],
      evidenceSelection: { status: 'applied', candidateCount: 1, selectedCount: 0 } })
    expect(inspect[1]?.system).toContain('No supporting knowledge-base evidence')
  })

  it('keeps original evidence when selection invents IDs, and never exposes its raw output', async () => {
    let calls = 0
    const model = {
      async *stream(): AsyncIterable<StreamChunk> {
        yield { type: 'text-delta', index: 0, text: calls++ === 0 ? '{"ids":[999]}' : 'Supported [1].' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await generateKnowledgeAnswer(model, target, local,
      { ...config, evidenceSelection: { maxTokens: 128, timeoutMs: 1000 } })
    expect(result).toMatchObject({ mode: 'model-rag', evidenceSelection: { status: 'failed', selectedCount: 1 } })
    expect(JSON.stringify(result)).not.toContain('999')
  })

  it('renumbers selected authoritative evidence and gives overview-specific instructions', async () => {
    const source = { ...local, question: '请给我一个概览', citations: [local.citations[0]!, { ...local.citations[0]!, id: 2, content: 'Other source.' }] }
    const route = { ...target, auxiliaryReasoningEffort: 'off' as NonNullable<GenerateOptions['reasoningEffort']>,
      reasoningEffort: 'high' as NonNullable<GenerateOptions['reasoningEffort']> }
    let calls = 0
    const model = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (calls > 0) expect(options.system).toContain('Keep studies and model versions separate')
        expect(options.reasoningEffort).toBe(calls === 0 ? 'off' : 'high')
        yield { type: 'text-delta', index: 0, text: calls++ === 0 ? '{"ids":[2]}' : '结论 [1]。' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const result = await generateKnowledgeAnswer(model, route, source,
      { ...config, evidenceSelection: { maxTokens: 128, timeoutMs: 1000 } })
    expect(result.citations).toMatchObject([{ id: 1, content: 'Other source.' }])
  })

  it('cancels evidence selection without starting answer generation', async () => {
    const controller = new AbortController()
    let calls = 0
    const model = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        calls += 1
        controller.abort(new Error('cancelled selection'))
        options.signal?.throwIfAborted()
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    await expect(generateKnowledgeAnswer(model, target, local,
      { ...config, evidenceSelection: { maxTokens: 128, timeoutMs: 1000 } }, controller.signal)).rejects.toThrow('cancelled selection')
    expect(calls).toBe(1)
  })

  it('records the no-evidence provenance visible to the client without source IDs', async () => {
    const result = await generateKnowledgeAnswer(llm([
      { type: 'text-delta', index: 0, text: '你好！可以用中文向我提问。' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]), target, { ...local, question: '你好' }, config)
    expect({ mode: result.mode, status: result.status, answer: result.answer, citations: result.citations }).toMatchInlineSnapshot(`
      {
        "answer": "你好！可以用中文向我提问。",
        "citations": [],
        "mode": "model-general",
        "status": "answered",
      }
    `)
  })

  it('emits start, incremental text, and one validated completion frame', async () => {
    const frames = []
    for await (const frame of streamKnowledgeAnswer(llm([
      { type: 'text-delta', index: 0, text: 'Notice ' },
      { type: 'text-delta', index: 0, text: 'is required [1].' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]), target, local, config)) frames.push(frame)
    expect(frames.map(frame => frame.type)).toEqual(['start', 'delta', 'delta', 'complete'])
    expect(frames.at(-1)).toMatchObject({ type: 'complete', answer: { mode: 'model-rag' } })
  })

  it('uses the selected Harness route and retains only valid cited evidence', async () => {
    const inspect = vi.fn<(options: GenerateOptions) => void>()
    const answer = await generateKnowledgeAnswer(llm([
      { type: 'text-delta', index: 0, text: 'Notice is required before action [1].' },
      { type: 'usage', usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ], inspect), target, local, config)

    expect(answer).toMatchObject({
      status: 'answered', requestedMode: 'model', mode: 'model-rag',
      generation: { provider: 'fixture', model: 'fixture-model', inputTokens: 20, outputTokens: 8, totalTokens: 28, fallbackReason: null },
    })
    expect(answer.citations).toHaveLength(1)
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ provider: 'fixture', model: 'fixture-model' }))
    expect(inspect.mock.calls[0]?.[0]).not.toHaveProperty('tools')
  })

  it('reports failure without presenting raw passages when citations are absent or outside the evidence set', async () => {
    for (const text of ['Notice is required.', 'Unsupported source [2].']) {
      const answer = await generateKnowledgeAnswer(llm([
        { type: 'text-delta', index: 0, text },
        { type: 'finish', reason: { kind: 'stop' } },
      ]), target, local, config)
      expect(answer).toMatchObject({ requestedMode: 'model', mode: 'model-failed', generation: { fallbackReason: 'invalid-citations' } })
      expect(answer.answer).not.toBe(local.answer)
      expect(answer.status).toBe('failed')
      expect(answer.citations).toEqual(local.citations)
    }
  })

  it('rejects empty or abnormally terminated model output', async () => {
    const limited = await generateKnowledgeAnswer(llm([
      { type: 'usage', usage: { inputTokens: 200, outputTokens: 400, totalTokens: 600 } },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]), target, local, config)
    expect(limited).toMatchObject({ mode: 'model-failed', generation: { fallbackReason: 'output-limit', totalTokens: 600 } })
    const empty = await generateKnowledgeAnswer(llm([
      { type: 'finish', reason: { kind: 'stop' } },
    ]), target, local, config)
    expect(empty).toMatchObject({ mode: 'model-failed', generation: { fallbackReason: 'empty-output' } })

    const unfinished = await generateKnowledgeAnswer(llm([
      { type: 'text-delta', index: 0, text: 'Looks valid [1].' },
    ]), target, local, config)
    expect(unfinished).toMatchObject({ mode: 'model-failed', generation: { fallbackReason: 'model-error' } })
  })

  it('falls back without leaking model errors and answers without evidence using explicit general provenance', async () => {
    const failed = await generateKnowledgeAnswer(llm([{
      type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'secret credential detail' } },
    }]), target, local, config)
    expect(failed).toMatchObject({ mode: 'model-failed', generation: { fallbackReason: 'model-error' } })
    expect(JSON.stringify(failed)).not.toContain('secret credential detail')

    const inspect = vi.fn<(options: GenerateOptions) => void>()
    const empty: KnowledgeAnswerView = {
      status: 'no-evidence', requestedMode: 'local', mode: 'local-extractive', question: 'unknown',
      answer: '', confidence: 'none', citations: [], generation: null,
    }
    const noEvidence = await generateKnowledgeAnswer(llm([
      { type: 'text-delta', index: 0, text: '你好！可以用中文向我提问。' },
      { type: 'finish', reason: { kind: 'stop' } },
    ], inspect), target, { ...empty, question: '你好' }, config)
    expect(noEvidence).toMatchObject({ status: 'answered', requestedMode: 'model', mode: 'model-general', confidence: 'none', citations: [] })
    expect(inspect.mock.calls[0]?.[0].system).toContain('No supporting knowledge-base evidence')
    expect(noEvidence.answer).toContain('你好')
  })

  it('rejects fabricated source numbers in a general answer', async () => {
    const answer = await generateKnowledgeAnswer(llm([
      { type: 'text-delta', index: 0, text: 'Your paper proves this [1].' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]), target, { ...local, status: 'no-evidence', answer: '', citations: [], confidence: 'none' }, config)
    expect(answer).toMatchObject({ status: 'failed', mode: 'model-failed', generation: { fallbackReason: 'invalid-citations' } })
  })

  it('treats Chinese and English greetings as conversation even when lexical search accidentally matched a reference', async () => {
    for (const question of ['你好', 'hello']) {
      const inspect = vi.fn<(options: GenerateOptions) => void>()
      const retrieve = vi.fn()
      const answer = await generateKnowledgeAnswer(llm([
        { type: 'text-delta', index: 0, text: 'Hello! 你好！' }, { type: 'finish', reason: { kind: 'stop' } },
      ], inspect), target, { ...local, question }, {
        ...config, queryExpansion: { maxTokens: 200, timeoutMs: 1_000, rankConstant: 60 },
      }, undefined, retrieve)
      expect(answer).toMatchObject({ mode: 'model-general', citations: [], confidence: 'none' })
      expect(inspect).toHaveBeenCalledTimes(1)
      expect(retrieve).not.toHaveBeenCalled()
    }
  })

  it('retrieves an English expansion but answers the original Chinese question from authoritative passages', async () => {
    const inspect = vi.fn<(options: GenerateOptions) => void>()
    let calls = 0
    const model = { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      inspect(options)
      yield { type: 'text-delta', index: 0, text: calls++ === 0 ? '{"query":"notice required before action"}' : '应在行动之前发出通知 [1]。' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    const retrieve = vi.fn(async () => local)
    const answer = await generateKnowledgeAnswer(model, target, {
      ...local, question: '何时必须通知？', status: 'no-evidence', answer: '', citations: [],
    }, { ...config, queryExpansion: { maxTokens: 200, timeoutMs: 1_000, rankConstant: 60 } }, undefined, retrieve)
    expect(retrieve).toHaveBeenCalledWith('notice required before action')
    expect(answer).toMatchObject({ question: '何时必须通知？', mode: 'model-rag', queryExpansion: { status: 'applied' } })
    expect(answer.citations).toEqual(local.citations)
    expect(JSON.stringify(inspect.mock.calls[0])).not.toContain('Notice is required before action.')
    expect(JSON.stringify(inspect.mock.calls[1])).toContain('何时必须通知？')
    expect(inspect.mock.calls[1]?.[0].system).toContain("language of the user's question")
  })

  it('bounds expansion output and preserves cancellation without issuing another model request', async () => {
    for (const text of ['bad json', '{"query":123}', JSON.stringify({ query: 'x'.repeat(251) })]) {
      const result = await expandKnowledgeQuery(llm([
        { type: 'text-delta', index: 0, text }, { type: 'finish', reason: { kind: 'stop' } },
      ]), target, '检索问题', { maxTokens: 200, timeoutMs: 1_000 })
      expect(result).toMatchObject({ status: 'failed', query: null })
    }
    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))
    const stream = vi.fn()
    await expect(expandKnowledgeQuery({ stream }, target, '你好', { maxTokens: 200, timeoutMs: 1_000 }, controller.signal)).rejects.toThrow('user cancelled')
    expect(stream).not.toHaveBeenCalled()
  })

  it('bounds a generated answer with an abortable timeout', async () => {
    const stalled = {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        await new Promise<void>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => { reject(new Error('timed out')) }, { once: true })
          if (options.signal?.aborted === true) reject(new Error('timed out'))
        })
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    } as Pick<LlmRuntime, 'stream'>
    const answer = await generateKnowledgeAnswer(stalled, target, local, { ...config, timeoutMs: 5 })
    expect(answer).toMatchObject({ mode: 'model-failed', generation: { fallbackReason: 'model-timeout' } })
  })

  it('bounds the complete serialized evidence and rejects citations that were not sent', async () => {
    const citations = Array.from({ length: 8 }, (_, index) => ({
      ...local.citations[0]!,
      id: index + 1,
      documentId: `doc-${index + 1}`,
      documentName: `Policy \\\"${'very-long-name-'.repeat(30)}${index + 1}.md`,
      content: `Evidence \\\"${'long-content-'.repeat(200)}${index + 1}`,
    }))
    const oversized: KnowledgeAnswerView = { ...local, citations }
    let sentIds: number[] = []

    const accepted = await generateKnowledgeAnswer(llm([
      { type: 'text-delta', index: 0, text: 'Supported answer [1].' },
      { type: 'finish', reason: { kind: 'stop' } },
    ], (options) => {
      const block = options.messages[0]?.content[0]
      if (block?.type !== 'text') throw new Error('expected text-only RAG message')
      const payload = JSON.parse(block.text) as { evidence: Array<{ id: number }> }
      expect(JSON.stringify(payload.evidence).length).toBeLessThanOrEqual(1_000)
      expect(payload.evidence.length).toBeGreaterThan(0)
      sentIds = payload.evidence.map(item => item.id)
    }), target, oversized, { ...config, maxEvidenceChars: 1_000 })
    expect(accepted.mode).toBe('model-rag')
    expect(sentIds).toContain(1)
    expect(sentIds).not.toContain(8)

    const rejected = await generateKnowledgeAnswer(llm([
      { type: 'text-delta', index: 0, text: 'Unsupported answer [8].' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]), target, oversized, { ...config, maxEvidenceChars: 1_000 })
    expect(rejected).toMatchObject({ mode: 'model-failed', generation: { fallbackReason: 'invalid-citations' } })
  })

  it('keeps model fallback callable through the Typert traceable controller view', async () => {
    const controllerView = new Proxy(Object.assign(Object.create(KnowledgeController.prototype) as object, {
      store: { askHybrid: async () => local, beginTurn: () => 1, finishTurn: vi.fn() },
      shutdown: new AbortController(), operations: new Set(), answerTurns: new Set(), closing: false,
      generation: config,
      settingsSource: () => ({
        provider: '', model: '', temperature: 0.2,
        maxEvidenceChars: 4_000, maxOutputTokens: 400, timeoutMs: 1_000,
      }),
      ctx: {
        sessions,
        agentDefaultModel: { currentSelection: () => target },
        llm: { ...llm([{ type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'missing credential' } } }]),
          resolveModelInfo: async () => ({ reasoning: { efforts: [] } }) },
      },
    }), {})
    const ask = Object.getOwnPropertyDescriptor(KnowledgeController.prototype, 'ask')?.value as unknown
    if (typeof ask !== 'function') throw new Error('expected KnowledgeController.ask method')
    const result = await Reflect.apply(ask, controllerView, [
      { ref: 'fixture', question: local.question, limit: 4, mode: 'model' },
      new AbortController().signal,
    ]) as Awaited<ReturnType<KnowledgeController['ask']>>
    expect(result.answer).toMatchObject({ requestedMode: 'model', mode: 'model-failed', generation: { fallbackReason: 'model-error' } })
  })

  it('uses the live Wiki settings route and generation parameters ahead of the Profile default', async () => {
    const inspect = vi.fn<(options: GenerateOptions) => void>()
    const controllerView = new Proxy(Object.assign(Object.create(KnowledgeController.prototype) as object, {
      store: { askHybrid: async () => local, beginTurn: () => 1, finishTurn: vi.fn() },
      shutdown: new AbortController(), operations: new Set(), answerTurns: new Set(), closing: false,
      generation: config,
      settingsSource: () => ({
        provider: 'wiki-provider', model: 'wiki-model', temperature: 0.7,
        maxEvidenceChars: 3_000, maxOutputTokens: 321, timeoutMs: 2_000,
      }),
      ctx: {
        sessions,
        agentDefaultModel: { currentSelection: () => target },
        llm: { ...llm([
          { type: 'text-delta', index: 0, text: 'Configured answer [1].' },
          { type: 'finish', reason: { kind: 'stop' } },
        ], inspect), resolveModelInfo: async () => ({ reasoning: { efforts: [] } }) },
      },
    }), {})
    const ask = Object.getOwnPropertyDescriptor(KnowledgeController.prototype, 'ask')?.value as unknown
    if (typeof ask !== 'function') throw new Error('expected KnowledgeController.ask method')
    const result = await Reflect.apply(ask, controllerView, [
      { ref: 'fixture', question: local.question, limit: 4, mode: 'model' }, new AbortController().signal,
    ]) as Awaited<ReturnType<KnowledgeController['ask']>>
    expect(result.answer).toMatchObject({ mode: 'model-rag', generation: { provider: 'wiki-provider', model: 'wiki-model' } })
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'wiki-provider', model: 'wiki-model', temperature: 0.7, maxTokens: 321,
    }))
  })

  it('persists the complete Wiki model section and returns the refreshed catalog', async () => {
    let current: KnowledgeModelSettings = {
      provider: '', model: '', temperature: 0.2,
      maxEvidenceChars: 4_000, maxOutputTokens: 400, timeoutMs: 1_000,
    }
    const replace = vi.fn(async (_namespace: string, settings: KnowledgeModelSettings) => { current = settings })
    const controllerView = Object.assign(Object.create(KnowledgeController.prototype) as object, {
      settingsSource: () => current,
      settingsWritable: true,
      ctx: {
        get: () => ({ writable: true, replace }),
        agentDefaultModel: { currentSelection: () => target },
        llm: {
          listProviders: () => [{ id: 'wiki-provider', name: 'Wiki Provider' }],
          listModels: async () => [{ provider: 'wiki-provider', id: 'wiki-model', name: 'Wiki Model' }],
        },
      },
    }) as unknown as KnowledgeController
    const next: KnowledgeModelSettings = {
      provider: 'wiki-provider', model: 'wiki-model', temperature: 0.6,
      maxEvidenceChars: 3_500, maxOutputTokens: 512, timeoutMs: 5_000,
    }

    const value = await controllerView.saveModelSettings({ settings: next })

    expect(replace).toHaveBeenCalledWith('product-knowledge', next)
    expect(value).toMatchObject({
      settings: next, resolvedProvider: 'wiki-provider', resolvedModel: 'wiki-model', writable: true,
      options: [{ provider: 'wiki-provider', model: 'wiki-model' }],
    })
  })
})
