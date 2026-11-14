import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SqliteSessionPersistence from '@deepseek-ai/dsh-session-persistence-sqlite'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { KnowledgeController } from '@deepseek-ai/dsh-product-knowledge'
import type { KnowledgeEvidenceValue } from '@deepseek-ai/dsh-product-knowledge'
import { LocalTransformersEmbeddingProvider } from '@deepseek-ai/dsh-product-knowledge/src/semantic-retrieval.ts'
import * as KnowledgeContext from '../src/index.ts'

let root: string | undefined
let context: Context | undefined
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.restoreAllMocks()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('Preset and Wiki shared retrieval through Loader', () => {
  it('shares hybrid evidence, compiled-page lookups and durable auxiliary calls without a tool-side final answer', async () => {
    root = await mkdtemp(join(tmpdir(), 'preset-wiki-retrieval-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-persistence-sqlite'",
      `  config: { path: ${JSON.stringify(join(root, 'sessions.db'))} }`,
      "- name: '@deepseek-ai/dsh-agent-default-model'",
      '  config: { provider: fixture, model: academic }',
      "- name: '@deepseek-ai/dsh-typert-registry'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-product-knowledge'",
      '  config:',
      `    databasePath: ${JSON.stringify(join(root, 'knowledge.db'))}`,
      `    embeddingCachePath: ${JSON.stringify(join(root, 'models'))}`,
      '    retrievalMode: hybrid',
      "- name: '@deepseek-ai/dsh-product-knowledge-context'",
      '  config:',
      '    bindings: [{ role: primary, ref: papers, required: true }]',
      '',
    ].join('\n'))
    // Only inference is scripted; ranking, SQLite, navigation and official model logging stay real.
    const embeddings = vi.spyOn(LocalTransformersEmbeddingProvider.prototype, 'embed').mockImplementation(async (texts, signal) => {
      signal?.throwIfAborted()
      return texts.map(() => { const vector = new Float32Array(384); vector[0] = 1; return vector })
    })
    const ctx = context = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-llm', LlmRuntime], ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-session-persistence-sqlite', SqliteSessionPersistence],
      ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModel], ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt], ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-product-knowledge', KnowledgeController], ['@deepseek-ai/dsh-product-knowledge-context', KnowledgeContext],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected Loader module ${specifier}`)
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    const requests: GenerateOptions[] = []
    let failPlanning = false
    class Adapter extends LlmAdapter {
      override async resolveModel(provider: string, model: string) {
        return { provider, id: model, name: model, defaultMaxTokens: 4096, context: { contextWindow: 262144 } }
      }
      override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(options)
        const system = options.system ?? ''
        if (failPlanning && system.startsWith('Plan source checks')) throw new Error('fixture navigation unavailable')
        const text = system.startsWith('Extract academic facts')
          ? { facts: [{ statement: 'Notification precedes action.', quote: 'Notice is required before action.' }], gaps: [] }
          : system.startsWith('Synthesize an academic paper')
            ? { title: 'Policy', sections: [{ heading: 'Procedure', text: 'Notification precedes action.', factIds: ['F1'] }], gaps: [] }
            : system.startsWith('Plan source checks')
              ? { needs: [{ question: '何时通知？', facts: [{ document: 'D1', id: 'F1' }], lookup: null },
                { question: '阈值是多少？', facts: [], lookup: { document: 'D1', query: 'Threshold' } }] }
              : system.startsWith('Check the numbered ORIGINAL')
                ? { needs: [{ id: 1, evidenceIds: [1] }, { id: 2, evidenceIds: [2] }] }
                : system.startsWith('Return ONLY JSON {"query"') ? { query: 'notice before action threshold' }
                  : system.startsWith('Return ONLY JSON {"ids"') ? { ids: [1] }
                    : '根据原文，行动前需要通知 [1]。'
        yield { type: 'text-delta', index: 0, text: typeof text === 'string' ? text : JSON.stringify(text) }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.effect(() => ctx.llm.registerAdapter(['fixture'], new Adapter()))
    ctx.knowledgeBases.create({ alias: 'papers', name: 'Papers' })
    const document = ctx.knowledgeBases.importMarkdown({ ref: 'papers', name: 'Policy.md',
      markdown: '# Policy\n## Procedure\nNotice is required before action.\n## Appendix\nThreshold is 0.8.' }).document
    ctx.knowledgeBases.create({ alias: 'private', name: 'Unbound' })
    ctx.knowledgeBases.importMarkdown({ ref: 'private', name: 'Secret.md', markdown: '# Threshold\nThreshold is 9.9.' })
    const query = '何时通知，阈值是多少？'
    const signal = new AbortController().signal
    const search = async () => {
      const result = await ctx.tools.execute({ signal, callId: ToolCallId('search'), name: 'knowledge_search', arguments: { query } })
      expect(result.isError, JSON.stringify(result.content)).toBe(false)
      return result.value as unknown as KnowledgeEvidenceValue
    }
    const baseline = await search()
    expect(baseline).toMatchObject({ retrieval: { actualMode: 'hybrid' }, queryExpansion: { status: 'applied' }, evidenceSelection: { status: 'applied' } })
    expect(requests).toHaveLength(2)
    expect(embeddings).toHaveBeenCalled()
    const compiled = await ctx.knowledgeBases.compileDocument({ ref: 'papers', documentId: document.id, operation: 'compile' }, signal)
    expect(compiled.status).toBe('complete')
    const before = requests.length
    const found = await search()
    expect(requests.length - before).toBe(2)
    expect(found).toMatchObject({ status: 'evidence', retrieval: { actualMode: 'hybrid' },
      knowledgeNavigation: { status: 'applied', calls: 2, lookupCount: 1 } })
    expect(found.hits.map(hit => hit.content).join('\n')).toContain('Threshold is 0.8')
    expect(found.hits.every(hit => hit.documentId === document.id && !hit.excerptTruncated)).toBe(true)
    expect(JSON.stringify(found)).not.toContain('9.9')
    await ctx.knowledgeBases.ask({ ref: 'papers', question: query, mode: 'model' }, signal)
    const answerInput = requests.at(-1)!.messages[0]!.content[0]!
    if (answerInput.type !== 'text') throw new Error('missing final answer evidence')
    const answerPayload = JSON.parse(answerInput.text) as { evidence: { id: number; content: string }[] }
    expect(answerPayload.evidence.map(item => ({ id: item.id, content: item.content })))
      .toEqual(found.hits.map(item => ({ id: item.id, content: item.content })))
    expect({ schemas: ctx.tools.schemas(), evidence: answerPayload.evidence,
      navigationNeeds: found.knowledgeNavigation?.needs }).toMatchSnapshot('shared Wiki and Preset model-visible evidence')
    for (const request of requests) {
      const persisted = await ctx.sessionPersistence.load(request.sessionId!)
      expect(persisted.events.filter(event => event.type === 'user/message').map(event => event.data)).toEqual(request.messages)
      expect(persisted.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    }
    failPlanning = true
    embeddings.mockRejectedValue(new Error('fixture embedding unavailable'))
    const fallback = await search()
    expect(fallback).toMatchObject({ retrieval: { actualMode: 'lexical' }, knowledgeNavigation: { status: 'failed' },
      queryExpansion: { status: 'applied' }, evidenceSelection: { status: 'applied' } })
    expect(fallback.retrieval?.fallbackReason).not.toBeNull()
    expect(ctx.knowledgeBases.compilation({ ref: 'papers', documentId: document.id }).publication).toEqual(compiled.publication)
  })
})
