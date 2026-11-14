import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { answerBudget, checkAnswerInput, prepareConversation } from '../src/conversation.ts'
import { generateKnowledgeAnswer } from '../src/rag.ts'
import type { KnowledgeAnswerView } from '../src/types.ts'

const target = { provider: 'fixture', model: 'academic', defaultMaxTokens: 32000, contextWindow: 262144 }
const settings = { provider: '', model: '', maxOutputTokens: 0, temperature: 0.2, maxEvidenceChars: 12000, timeoutMs: 1000 }
const signal = () => new AbortController().signal
function model(outputs: readonly string[]) {
  const calls: GenerateOptions[] = []
  return { calls, async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    calls.push(options)
    yield { type: 'text-delta', index: 0, text: outputs[calls.length - 1] ?? '{}' }
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
}

describe('Wiki conversation memory and model budgets', () => {
  it('inherits metadata without a 16384 ceiling and keeps explicit legacy budgets', async () => {
    const llm = model([])
    const result = await prepareConversation(llm, target, settings, '你好', undefined, signal())
    expect(result.result).toMatchObject({ query: '你好', outputTokens: 32000, calls: 0, compactedTurns: 0 })
    expect(llm.calls).toHaveLength(0)
    expect(answerBudget(target, 64000).output).toBe(64000)
    expect(answerBudget(target, 4096).output).toBe(4096)
    expect(() => answerBudget({ provider: 'p', model: 'm' }, 0)).toThrow(/默认输出预算/u)
    expect(() => answerBudget(target, 262144)).toThrow(/输入/u)
    expect(() => { checkAnswerInput('system', { text: '中'.repeat(1000) }, 2000) }).toThrow(/上下文/u)
  })

  it('resolves a Chinese follow-up and sends memory separately from newly retrieved evidence', async () => {
    const llm = model(['{"question":"Forman 的肋骨损伤研究有哪些限制？"}', '这项研究存在限制 [1]。'])
    const input = { summary: '', turns: [{ question: 'Forman 的研究概况？', answer: '此前的回答 [99]。' }] }
    const memory = await prepareConversation(llm, target, settings, '继续说明限制', input, signal())
    expect(memory.result).toMatchObject({ query: 'Forman 的肋骨损伤研究有哪些限制？', historyTurns: 1, calls: 1, totalTokens: 20 })
    const local: KnowledgeAnswerView = { status: 'answered', requestedMode: 'local', mode: 'local-extractive',
      question: memory.result.query, answer: '', confidence: 'low', generation: null,
      citations: [{ id: 1, documentId: 'doc', documentName: 'paper', heading: '', startLine: 1, endLine: 1,
        content: 'This study has limitations.', contentHash: 'a'.repeat(64) }] }
    const answer = await generateKnowledgeAnswer(llm, target, local, { ...settings,
      maxOutputTokens: memory.result.outputTokens, originalQuestion: '继续说明限制', conversation: memory.history,
      conversationResult: memory.result, inputBytes: memory.inputBytes!,
    }, signal())
    expect(answer).toMatchObject({ question: '继续说明限制', mode: 'model-rag', answer: '这项研究存在限制 [1]。' })
    const text = llm.calls[1]!.messages[0]!.content[0]!
    expect(text.type === 'text' ? JSON.parse(text.text) : null).toMatchObject({ conversationMemory: input,
      evidence: [{ id: 1, content: 'This study has limitations.' }] })
    expect(llm.calls[1]!.system).toContain('Never reuse old citation IDs')
    expect(llm.calls[1]!.maxTokens).toBe(32000)
  })

  it('compacts old turns, retains recent turns and consumes the next summary without resending old turns', async () => {
    const llm = model(['{"summary":"用户在研究 Forman，先前模型结论尚待查证。"}', '{"question":"Forman 的研究限制是什么？"}',
      '{"question":"Forman 的研究限制还有哪些？"}'])
    const older = { question: 'Forman？', answer: 'Unverified old answer. '.repeat(150) }
    const latest = { question: '有哪些限制？', answer: '仍需原文查证。' }
    const first = await prepareConversation(llm, target, { ...settings, historyMaxChars: 2000, historyRecentTurns: 1 },
      '继续', { summary: '', turns: [older, latest] }, signal())
    expect(first.result).toMatchObject({ compactedTurns: 1, calls: 2, totalTokens: 40 })
    expect(first.history.turns).toEqual([latest])
    const next = await prepareConversation(llm, target, settings, '还有呢', first.history, signal())
    expect(next.result).toMatchObject({ compactedTurns: 0, calls: 1, historyTurns: 1 })
    expect(JSON.stringify(llm.calls[2]!.messages)).not.toContain('Unverified old answer')
    expect(JSON.stringify(llm.calls[2]!.messages)).toContain(first.result.summary)
  })

  it('preserves caller history on invalid summaries, language errors, oversized input and cancellation', async () => {
    const input = { summary: '', turns: [{ question: 'Forman？', answer: 'x'.repeat(4000) }] }
    const original = JSON.stringify(input)
    const invalid = model(['{"summary":""}'])
    await expect(prepareConversation(invalid, target, { ...settings, historyMaxChars: 2000 }, '继续', input, signal())).rejects.toThrow()
    expect(invalid.calls).toHaveLength(1)
    expect(JSON.stringify(input)).toBe(original)
    const english = model(['{"question":"What next?"}'])
    await expect(prepareConversation(english, target, settings, '继续', input, signal())).rejects.toThrow(/中文/u)
    const over = model([])
    await expect(prepareConversation(over, target, settings, '继续', { summary: '', turns: [
      { question: '中文', answer: '中'.repeat(250000) }, { question: '中文', answer: '中'.repeat(250000) },
    ] }, signal())).rejects.toThrow(/安全上限/u)
    expect(over.calls).toHaveLength(0)
    const abort = new AbortController()
    abort.abort()
    await expect(prepareConversation(over, target, settings, '继续', input, abort.signal)).rejects.toThrow()
    expect(over.calls).toHaveLength(0)
  })
})
