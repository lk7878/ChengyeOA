import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { PDF_FIXTURE_BASE64, PDF_RULE_FIXTURE_BASE64 } from './pdf-fixture.ts'
import { KnowledgeController } from '@deepseek-ai/dsh-product-knowledge'
import { KnowledgeBaseStore } from '../src/store.ts'

let root: string | undefined
let context: Context | undefined
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('Wiki QA Loader composition', () => {
  it('publishes repaired Chinese synthesis and reconstructs each request from durable official session events', async () => {
    root = await mkdtemp(join(tmpdir(), 'wiki-qa-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-attachment-local'",
      `  config: { dshHome: ${JSON.stringify(root)} }`,
      "- name: '@deepseek-ai/dsh-settings-file'",
      `  config: { path: ${JSON.stringify(join(root, 'settings.json'))} }`,
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-persistence-sqlite'",
      `  config: { path: ${JSON.stringify(join(root, 'sessions.db'))} }`,
      "- name: '@deepseek-ai/dsh-agent-default-model'",
      '  config: { provider: fixture, model: academic }',
      "- name: '@deepseek-ai/dsh-typert-registry'",
      "- name: '@deepseek-ai/dsh-product-knowledge'",
      '  config:',
      `    databasePath: ${JSON.stringify(join(root, 'knowledge.db'))}`,
      '    queryExpansionEnabled: false',
      '    evidenceSelectionEnabled: false',
      '',
    ].join('\n'))
    const ctx = context = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-session-persistence-sqlite', SqliteSessionPersistence],
      ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModel], ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
      ['@deepseek-ai/dsh-product-knowledge', KnowledgeController],
      ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
      ['@deepseek-ai/dsh-attachment-local', LocalAttachmentStore],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected Loader module ${specifier}`)
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)).toEqual([])
    const requests: GenerateOptions[] = []
    const inputChecks: Array<() => void> = []
    const checkpointed = new Set<string>()
    let hold: (() => void) | undefined
    ctx.on('session/flush', (session) => { checkpointed.add(session.id) })
    class Adapter extends LlmAdapter {
      override async resolveModel(provider: string, model: string) {
        return { provider, id: model, name: model, defaultMaxTokens: 4096, context: { contextWindow: 262144 },
          inputModalities: model === 'vision' ? ['text', 'image'] as const : ['text'] as const }
      }
      override async listModels(provider: string) { return [{ provider, id: 'academic', name: 'Academic', inputModalities: ['text'] as const }] }
      override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(options)
        if (options.sessionId === undefined) throw new Error('Request has no session')
        inputChecks.push(() => { expect(checkpointed.has(options.sessionId!)).toBe(true) })
        const persisted = await ctx.sessionPersistence.inspect(options.sessionId).catch((error: unknown) => {
          inputChecks.push(() => { throw error })
          throw error
        })
        inputChecks.push(() => { expect(persisted.events.filter(event => event.type === 'user/message').map(event => event.data)).toEqual(options.messages) })
        const header = persisted.events.find(event => event.type === 'request/header')
        inputChecks.push(() => { expect(header).toMatchObject({ data: { header: { system: options.system,
          config: { provider: options.provider, model: options.model, maxTokens: options.maxTokens } } } }) })
        const compilingFacts = options.system?.startsWith('Extract academic facts')
        const compilingPage = options.system?.startsWith('Synthesize an academic paper')
        if (hold !== undefined) {
          hold()
          await new Promise<void>((_resolve, reject) => options.signal?.addEventListener('abort', () => {
            reject(new Error('Fixture cancelled'))
          }, { once: true }))
        }
        const recognizing = options.system?.startsWith('Transcribe this academic PDF')
        if (recognizing) {
          const image = options.messages[0]?.content.find(block => block.type === 'image')
          if (image?.type !== 'image') throw new Error('Vision request has no durable image')
          const stored = await ctx.attachments.readImage(image.attachment)
          expect(stored.data.byteLength).toBeGreaterThan(0)
        }
        const planning = options.system?.startsWith('Plan source checks')
        const reviewing = options.system?.startsWith('Check the numbered ORIGINAL')
        const input = options.messages[0]?.content[0]
        const payload = planning && input?.type === 'text' ? JSON.parse(input.text) as { documents?: Array<{ id: string; name: string }> } : {}
        const policy = payload.documents?.find(document => document.name === 'Policy.md')
        yield { type: 'text-delta', index: 0, text: options.system?.startsWith('Resolve the CURRENT')
          ? '{"question":"何时需要通知？"}' : planning
            ? JSON.stringify({ needs: [{ question: '何时需要通知？', facts: [{ document: policy!.id, id: 'F1' }], lookup: null }] })
            : reviewing ? '{"needs":[{"id":1,"evidenceIds":[1]}]}'
              : input?.type === 'text' && input.text.includes('"evidenceRequirements"') ? '根据原文，必须在行动前通知 [1]。' : recognizing
                ? '{"printedPage":1,"text":"PDF evidence supports verified ingestion.","uncertainties":[]}' : compilingFacts
                  ? '{"facts":[{"statement":"Notification precedes action.","quote":"Notice is required before action."}],"gaps":[]}'
                  : compilingPage ? '{"title":"Notice policy","sections":[{"heading":"Procedure","text":"Notification precedes action.","factIds":["F1"]}],"gaps":[]}'
                    : requests.length === 1 ? '需要在行动前通知 [11]。'
                      : '{"status":"answered","answer":"根据资料，通知必须在采取行动之前完成 [1]。"}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.effect(() => ctx.llm.registerAdapter(['fixture'], new Adapter()))
    ctx.knowledgeBases.create({ alias: 'paper', name: 'Paper' })
    ctx.knowledgeBases.importMarkdown({ ref: 'paper', name: 'Policy.md', markdown: '# Notice\nNotice is required before action.' })
    const frames = []
    for await (const frame of ctx.knowledgeBases.askStream({ ref: 'paper', question: 'Notice 何时需要通知？', mode: 'model' }, new AbortController().signal)) frames.push(frame)
    for (const check of inputChecks) check()
    expect(requests).toHaveLength(2)
    const persistedHistory = ctx.knowledgeBases.conversation({ ref: 'paper' })
    expect(persistedHistory.turns.map(turn => ({ question: turn.question, answer: turn.answer?.answer,
      citations: turn.answer?.citations.map(source => source.content), status: turn.status, sourceChanged: turn.sourceChanged })))
      .toMatchInlineSnapshot(`
        [
          {
            "answer": "根据资料，通知必须在采取行动之前完成 [1]。",
            "citations": [
              "# Notice
        Notice is required before action.",
            ],
            "question": "Notice 何时需要通知？",
            "sourceChanged": false,
            "status": "complete",
          },
        ]
      `)
    const last = frames.at(-1)
    expect(last).toMatchObject({ type: 'complete', answer: { mode: 'model-rag', answerRepair: { status: 'repaired', reason: 'unknown-citations' } } })
    expect(requests.map(request => ({ system: request.system, maxTokens: request.maxTokens }))).toMatchSnapshot('durable model instructions')
    expect(last?.type === 'complete' ? { mode: last.answer.mode, answer: last.answer.answer, evidence: last.answer.citations.map(item => item.content) } : null).toMatchInlineSnapshot(`
      {
        "answer": "根据资料，通知必须在采取行动之前完成 [1]。",
        "evidence": [
          "# Notice
      Notice is required before action.",
        ],
        "mode": "model-rag",
      }
    `)
    const settingsBefore = await ctx.knowledgeBases.modelSettings()
    const compilerSettings = await ctx.knowledgeBases.compilerSettings()
    expect(compilerSettings).toMatchObject({ resolvedProvider: 'fixture', resolvedModel: 'academic', writable: true })
    await ctx.knowledgeBases.saveCompilerSettings({ settings: { ...compilerSettings.settings, provider: 'fixture', model: 'strong-text' } })
    expect((await ctx.knowledgeBases.modelSettings()).settings).toEqual(settingsBefore.settings)
    await expect(ctx.knowledgeBases.saveCompilerSettings({ settings: { ...compilerSettings.settings, provider: 'fixture', model: '' } })).rejects.toThrow(/both/u)
    await expect(ctx.knowledgeBases.saveCompilerSettings({ settings: { ...compilerSettings.settings, visionEnabled: true, visionProvider: 'fixture', visionModel: 'academic' } })).rejects.toThrow(/image input/u)
    const documentId = ctx.knowledgeBases.documents({ ref: 'paper' }).documents[0]!.id
    const compiled = await ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId, operation: 'compile' }, new AbortController().signal)
    expect(compiled).toMatchObject({ status: 'complete', publication: { provider: 'fixture', model: 'strong-text', title: 'Notice policy', calls: 2 } })
    expect(requests).toHaveLength(4)
    await ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId, operation: 'compile' }, new AbortController().signal)
    expect(requests).toHaveLength(4)
    for (const check of inputChecks) check()
    expect({ status: compiled.status, title: compiled.publication?.title, sections: compiled.publication?.sections }).toMatchSnapshot('original-language compiled publication')
    for (const request of requests) {
      const persisted = await ctx.sessionPersistence.load(request.sessionId!)
      expect(persisted.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(persisted.events.some(event => event.type === 'assistant/chunk')).toBe(true)
    }
    const entered = new Promise<void>((resolve) => { hold = resolve })
    const cancel = new AbortController()
    const running = ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId, operation: 'compile', force: true }, cancel.signal)
    await entered
    expect(() => ctx.knowledgeBases.setStatus({ ref: 'paper', status: 'archived' })).toThrow(/Cancel the active/u)
    expect(() => ctx.knowledgeBases.deleteDocument({ ref: 'paper', documentId })).toThrow(/Cancel the active/u)
    expect(() => ctx.knowledgeBases.reviewGap({ ref: 'paper', documentId, publicationKey: compiled.publication!.cacheKey,
      publicationCreatedAt: compiled.publication!.createdAt, index: 0, status: 'question', note: 'Check original.' })).toThrow(/Cancel the active/u)
    cancel.abort()
    const cancelled = await running
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.publication).toEqual(compiled.publication)
    hold = undefined
    const cachedAfterCancel = await ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId, operation: 'compile' }, new AbortController().signal)
    expect(cachedAfterCancel).toMatchObject({ status: 'complete', progress: 100, error: null, publication: compiled.publication })

    await ctx.knowledgeBases.saveCompilerSettings({ settings: { ...compilerSettings.settings,
      visionEnabled: true, visionProvider: 'fixture', visionModel: 'vision' } })
    const fixtureStore = new KnowledgeBaseStore(join(root, 'knowledge.db'))
    try {
      const source = fixtureStore.compilationSource('paper', documentId)
      fixtureStore.saveCompilation('paper', documentId, { ...cachedAfterCancel, vision: [{ page: 1, printedPage: '1',
        sourceHash: source.sourceHash, imageHash: source.sourceHash, attachmentId: 'review-fixture', region: [0, 0, 1, 1],
        provider: 'fixture', model: 'vision', text: 'Additional verified material.', uncertainties: [], reviewed: false, totalTokens: 100 }] }, source.contentHash)
    } finally { fixtureStore.close() }
    const beforeReview = requests.length
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(ctx.knowledgeBases.reviewVision({ ref: 'paper', documentId, page: 1, text: 'Additional verified material.' }))
        .toMatchObject({ status: 'complete', publication: compiled.publication })
      const reused = await ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId, operation: 'compile' }, new AbortController().signal)
      expect(reused.publication).toEqual(compiled.publication)
      expect(reused.publication?.visionSources).toEqual([])
      expect(requests).toHaveLength(beforeReview)
    }
    const pdf = await ctx.knowledgeBases.importFile({ ref: 'paper', fileName: 'Source.pdf', base64: PDF_FIXTURE_BASE64 })
    const ruled = await ctx.knowledgeBases.importFile({ ref: 'paper', fileName: 'Native-rule.pdf', base64: PDF_RULE_FIXTURE_BASE64 })
    expect(ruled.document.status).toBe('ready')
    const ruledDetail = ctx.knowledgeBases.documentDetail({ ref: 'paper', documentId: ruled.document.id })
    expect(ruledDetail.preview).toContain('Native paper evidence supports fracture risk analysis.')
    expect(ruledDetail.preview).toContain('__________________________________')
    expect((await ctx.knowledgeBases.reprocess({ ref: 'paper', documentId: ruled.document.id })).document.id).toBe(ruled.document.id)
    ctx.knowledgeBases.deleteDocument({ ref: 'paper', documentId: ruled.document.id })
    const visual = await ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId: pdf.document.id, operation: 'vision', pages: [1] }, new AbortController().signal)
    expect(visual).toMatchObject({ status: 'review', vision: [{ page: 1, printedPage: '1', region: [0, 0, 1, 1], reviewed: false, model: 'vision' }] })
    const visualRequest = requests.at(-1)!
    const visualLog = await ctx.sessionPersistence.load(visualRequest.sessionId!)
    expect(visualLog.events.filter(event => event.type === 'user/message').map(event => event.data)).toEqual(visualRequest.messages)
    const callCount = requests.length
    await ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId: pdf.document.id, operation: 'vision', pages: [1] }, new AbortController().signal)
    expect(requests).toHaveLength(callCount)
    await ctx.knowledgeBases.saveCompilerSettings({ settings: { ...compilerSettings.settings,
      visionEnabled: true, visionProvider: 'fixture', visionModel: 'vision', renderWidth: 1000 } })
    const rerendered = await ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId: pdf.document.id, operation: 'vision', pages: [1] }, new AbortController().signal)
    expect(requests).toHaveLength(callCount + 1)
    expect(rerendered.vision[0]?.imageHash).not.toBe(visual.vision[0]?.imageHash)
    expect(ctx.knowledgeBases.reviewVision({ ref: 'paper', documentId: pdf.document.id, page: 1,
      text: 'PDF evidence supports verified ingestion.' }).vision[0]?.reviewed).toBe(true)
    await ctx.knowledgeBases.saveCompilerSettings({ settings: { ...compilerSettings.settings, provider: 'fixture', model: 'strong-text' } })
    for (const streaming of [false, true]) {
      const before = requests.length
      const request = { ref: 'paper', question: '继续', mode: 'model' as const,
        conversation: { summary: '', turns: [{ question: '何时需要通知？', answer: '尚需查证。' }] } }
      let answer
      if (streaming) {
        for await (const frame of ctx.knowledgeBases.askStream(request, new AbortController().signal)) {
          if (frame.type === 'complete') answer = frame.answer
        }
      } else answer = (await ctx.knowledgeBases.ask(request, new AbortController().signal)).answer
      expect(answer).toMatchObject({ question: '继续', mode: 'model-rag', answer: '根据原文，必须在行动前通知 [1]。',
        conversation: { query: '何时需要通知？', outputTokens: 4096, calls: 1 },
        knowledgeNavigation: { status: 'applied', calls: 2, model: 'strong-text', needs: [{ evidenceIds: [1] }] } })
      expect(requests.slice(before).map(request => request.model)).toEqual(['academic', 'strong-text', 'strong-text', 'academic'])
    }
    const reviewStore = new KnowledgeBaseStore(join(root, 'knowledge.db'))
    try {
      const current = reviewStore.compilation('paper', documentId)
      reviewStore.saveCompilation('paper', documentId, { ...current, publication: { ...current.publication!, gaps: ['Check the original procedure.'] } }, current.publication!.contentHash)
    } finally { reviewStore.close() }
    const beforeGapReview = requests.length
    const current = ctx.knowledgeBases.compilation({ ref: 'paper', documentId })
    const gapRequest = { ref: 'paper', documentId, publicationKey: current.publication!.cacheKey,
      publicationCreatedAt: current.publication!.createdAt, index: 0, status: 'verified' as const, note: 'Compared with the source procedure.' }
    const savedReview = ctx.knowledgeBases.reviewGap(gapRequest)
    expect(savedReview.publication).toEqual(current.publication)
    expect(savedReview.gapReviews).toMatchObject([{ index: 0, status: 'verified', note: gapRequest.note }])
    const reusedReview = await ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId, operation: 'compile' }, new AbortController().signal)
    expect(reusedReview.gapReviews).toEqual(savedReview.gapReviews)
    expect(requests).toHaveLength(beforeGapReview)
    ctx.knowledgeBases.setStatus({ ref: 'paper', status: 'archived' })
    expect(() => ctx.knowledgeBases.reviewGap(gapRequest)).toThrow()
    ctx.knowledgeBases.setStatus({ ref: 'paper', status: 'active' })
    const recompiled = await ctx.knowledgeBases.compileDocument({ ref: 'paper', documentId, operation: 'compile', force: true }, new AbortController().signal)
    expect(recompiled.gapReviews).toEqual([])
    expect(requests.length).toBeGreaterThan(beforeGapReview)
    expect(() => ctx.knowledgeBases.reviewGap(gapRequest)).toThrow(/Publication changed/u)
    for (const check of inputChecks) check()
  })
})
