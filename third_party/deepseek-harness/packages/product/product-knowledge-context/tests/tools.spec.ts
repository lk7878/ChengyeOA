import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { KnowledgeBaseStore } from '@deepseek-ai/dsh-product-knowledge/src/store.ts'
import * as KnowledgeContext from '@deepseek-ai/dsh-product-knowledge-context/src/index.ts'

const open: KnowledgeBaseStore[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const store of open.splice(0)) store.close()
})

async function setup(ref = 'legal', revision: 'latest' | number = 'latest', maxResultChars = 64000) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const store = new KnowledgeBaseStore(':memory:')
  open.push(store)
  // Binding/budget tests isolate the service call; the Loader suite exercises the real evidence pipeline.
  const retrieveEvidence = vi.fn(async (request: { ref: string; query: string; limit?: number }, signal: AbortSignal) => {
    const value = await store.askHybrid(request.ref, request.query, request.limit, signal)
    return { question: value.question, status: value.citations.length ? 'evidence' : 'no-evidence',
      hits: value.citations.map(citation => ({ ...citation, excerptTruncated: false })) }
  })
  ctx.provide('knowledgeBases', { store, retrieveEvidence } as never)
  const fiber = ctx.plugin(KnowledgeContext, { maxResultChars, bindings: [{ role: 'primary', ref, revision, required: true }] })
  await fiber
  return { ctx, store, retrieveEvidence, fiber }
}

const signal = new AbortController().signal

describe('product knowledge context tools', () => {
  it('composes the three tools and returns revisioned source evidence', async () => {
    const { ctx, store } = await setup()
    store.create('legal', 'Legal')
    const imported = store.importMarkdown('legal', 'Procedure.md', '# Notice\nServe notice before compulsory measures.')

    expect(ctx.tools.schemas().map(row => row.name)).toEqual([
      'knowledge_search', 'knowledge_read', 'knowledge_sources',
    ])
    const search = await ctx.tools.execute({
      signal, callId: ToolCallId('search'), name: 'knowledge_search', arguments: { query: 'notice' },
    })
    expect(search.isError).toBe(false)
    expect(search.value).toMatchObject({
      knowledgeBase: { alias: 'legal', revision: 1 },
      hits: [{ documentName: 'Procedure.md', startLine: 1, excerptTruncated: false }],
    })

    const read = await ctx.tools.execute({
      signal, callId: ToolCallId('read'), name: 'knowledge_read',
      arguments: { documentId: imported.document.id, startLine: 1, endLine: 9999 },
    })
    expect(read.isError).toBe(false)
    expect(read.value).toMatchObject({ knowledgeBaseAlias: 'legal', revision: 1, startLine: 1, endLine: 2 })
  })

  it('fails visibly when a required binding is missing or pinned to another revision', async () => {
    const missing = await setup('missing')
    const missingResult = await missing.ctx.tools.execute({
      signal, callId: ToolCallId('missing'), name: 'knowledge_sources', arguments: {},
    })
    expect(missingResult.isError).toBe(true)
    expect(JSON.stringify(missingResult.content[0])).toContain('required knowledge base')

    const pinned = await setup('legal', 2)
    pinned.store.create('legal', 'Legal')
    pinned.store.importMarkdown('legal', 'Source.md', '# Source\ntext')
    const pinnedResult = await pinned.ctx.tools.execute({
      signal, callId: ToolCallId('pinned'), name: 'knowledge_sources', arguments: {},
    })
    expect(pinnedResult.isError).toBe(true)
    expect(JSON.stringify(pinnedResult.content[0])).toContain('not requested revision 2')
  })

  it('rejects unbound targets, changed revisions, cancelled work and oversized complete results', async () => {
    const { ctx, store, retrieveEvidence } = await setup('legal', 'latest', 1024)
    store.create('legal', 'Legal')
    store.create('other', 'Other')
    store.importMarkdown('legal', 'Source.md', '# Notice\nNotice before action.')
    const run = (ref?: string, caller = signal) => ctx.tools.execute({ signal: caller,
      callId: ToolCallId('guard'), name: 'knowledge_search', arguments: { query: 'notice', ...(ref ? { ref } : {}) } })
    expect((await run('other')).isError).toBe(true)
    expect(retrieveEvidence).not.toHaveBeenCalled()
    retrieveEvidence.mockImplementationOnce(async () => {
      store.importMarkdown('legal', 'New.md', '# Notice\nNew evidence.')
      return { question: 'notice', status: 'no-evidence', hits: [] }
    })
    expect(JSON.stringify((await run()).content)).toContain('changed during retrieval')
    const abort = new AbortController()
    retrieveEvidence.mockImplementationOnce(async () => {
      abort.abort(new Error('cancelled search'))
      return { question: 'notice', status: 'no-evidence', hits: [] }
    })
    expect((await run(undefined, abort.signal)).isError).toBe(true)
    store.importMarkdown('legal', 'Large.md', '# Notice\n' + '通知 notice '.repeat(500))
    expect(JSON.stringify((await run()).content)).toContain('maxResultChars')
  })

  it('removes all three tool registrations when the preset unloads', async () => {
    const { ctx, fiber } = await setup()
    expect(ctx.tools.schemas()).toHaveLength(3)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })
})
