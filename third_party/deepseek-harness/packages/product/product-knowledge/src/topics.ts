/** Cross-paper drafts retain original quotes; model judgments require human review. */
import { z } from 'zod'
import { numbersPreserved } from './compiler.ts'
import type { KnowledgeTopic } from './types.ts'

/** Bounded model output and human-editable topic representation. */
export const topicClaimsSchema = z.array(z.object({ text: z.string().min(1).max(4000),
  kind: z.enum(['consensus', 'conflict', 'insufficient']), evidenceIds: z.array(z.number().int().positive()).max(40),
}).strict()).min(1).max(30)

/** Validates persisted and uploaded topic fields before source reconciliation. */
export const topicSchema = z.object({ id: z.uuid(), title: z.string().trim().min(1).max(200),
  revision: z.number().int().nonnegative(), version: z.number().int().nonnegative(), notes: z.string().max(20000),
  previousText: z.string().max(150000), stale: z.boolean(), claims: topicClaimsSchema,
  sources: z.array(z.object({ id: z.number().int().positive(), documentId: z.string(), documentName: z.string(),
    heading: z.string(), startLine: z.number().int().positive(), endLine: z.number().int().positive(),
    content: z.string().max(10000), contentHash: z.string().regex(/^[a-f\d]{64}$/u),
  }).strict()).min(2).max(40),
}).strict()

/**
 * Reject unknown references and unsupported numeric literals; semantic judgments remain unverified.
 * @param topic - validated topic draft and source snapshots.
 */
export function checkTopicClaims(topic: KnowledgeTopic): void {
  if (new Set(topic.sources.map(source => source.id)).size !== topic.sources.length) throw new Error('Duplicate topic evidence IDs.')
  for (const claim of topic.claims) {
    const sources = claim.evidenceIds.map((id) => {
      const source = topic.sources.find(item => item.id === id)
      if (!source) throw new Error('Unknown topic evidence ID.')
      return source
    })
    if (claim.kind !== 'insufficient' && new Set(sources.map(source => source.documentId)).size < 2) throw new Error('A cross-paper judgment requires evidence from multiple papers.')
    if (!numbersPreserved(claim.text, sources.map(source => source.content).join('\n'))) throw new Error('Topic contains unsupported numbers.')
  }
}
