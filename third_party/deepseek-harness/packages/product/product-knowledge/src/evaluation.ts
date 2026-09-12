/** Live-model acceptance reports keep human semantic judgments separate from automatic diagnostics. */
import { z } from 'zod'
import type { KnowledgeAnswerView, KnowledgeModelEvaluationReport } from './types.ts'

const casesSchema = z.array(z.object({ id: z.string().trim().min(1).max(100), question: z.string().trim().min(1).max(500),
  expectedAnswer: z.string().max(10000), expectedDocumentNames: z.array(z.string().min(1).max(255)).max(20),
  unanswerable: z.boolean(),
}).strict()).min(1).max(50).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, 'Duplicate case IDs.')

/**
 * Run supplied, human-authored cases against the actual answer path, preserving every answer for review.
 * @param input - bounded JSON benchmark cases, never generated from the tested model.
 * @param revision - frozen knowledge-base revision.
 * @param answer - configured Host answer pipeline.
 * @param signal - explicit run cancellation.
 * @returns reproducible raw answers, timing, retrieval recall and blank human-review fields.
 */
export async function evaluateModelCases(
  input: unknown, revision: number, answer: (question: string) => Promise<KnowledgeAnswerView>, signal: AbortSignal,
): Promise<KnowledgeModelEvaluationReport> {
  const cases = casesSchema.parse(input)
  const results: KnowledgeModelEvaluationReport['results'][number][] = []
  for (const item of cases) {
    signal.throwIfAborted()
    const started = Date.now()
    const value = await answer(item.question)
    signal.throwIfAborted()
    const expected = [...new Set(item.expectedDocumentNames)]
    results.push({ ...item, answer: value, latencyMs: Date.now() - started,
      retrievalRecall: expected.length
        ? expected.filter(name => value.citations.some(source => source.documentName === name)).length / expected.length : null,
      humanReview: { answerCorrect: null, claimsSupported: null, refusalAppropriate: null, notes: '' } })
  }
  const times = results.map(item => item.latencyMs).sort((a, b) => a - b)
  const recalls = results.flatMap(item => item.retrievalRecall === null ? [] : [item.retrievalRecall])
  return { schemaVersion: 1, revision, createdAt: new Date().toISOString(), semanticAccuracy: null,
    meanRetrievalRecall: recalls.length ? recalls.reduce((sum, value) => sum + value, 0) / recalls.length : null,
    p95LatencyMs: times[Math.ceil(times.length * 0.95) - 1] ?? 0, results }
}
