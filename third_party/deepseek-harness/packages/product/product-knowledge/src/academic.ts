/** Source-only academic reading guides; no generated claims or separate index. */
import { createHash } from 'node:crypto'
import type { KnowledgeAcademicExcerpt } from './types.ts'

const HEADINGS: readonly [KnowledgeAcademicExcerpt['role'], RegExp][] = [
  ['abstract', /^(?:abstract|summary|摘要)(?:\s*[:：—–-]\s*|\s+|$)/iu],
  ['methods', /^(?:materials?\s+and\s+methods?|methods?|methodology|方法|研究方法)(?:\s*[:：—–-]\s*|$)/iu],
  ['results', /^(?:results?(?:\s+and\s+discussion)?|结果|研究结果)(?:\s*[:：—–-]\s*|$)/iu],
  ['discussion', /^(?:discussion|limitations?|讨论|局限性?)(?:\s*[:：—–-]\s*|$)/iu],
  ['conclusion', /^(?:conclusions?|结论)(?:\s*[:：—–-]\s*|$)/iu],
]
const SECTION_BREAK = /^(?:#{1,6}\s+|[IVX]+\.\s+[A-Z]|(?:keywords|introduction|references|bibliography|acknowledg\w*|appendix|参考文献|附录)\b)/iu

/**
 * Extract the first source passage under each recognizable academic heading.
 * @param content - normalized source Markdown, without rewriting its line positions.
 * @param maxChars - maximum characters per excerpt, excluding its heading.
 * @returns bounded verbatim excerpts with source line numbers and content hashes.
 */
export function academicGuide(content: string, maxChars: number): KnowledgeAcademicExcerpt[] {
  const lines = content.split('\n')
  const excerpts: KnowledgeAcademicExcerpt[] = []
  let role: KnowledgeAcademicExcerpt['role'] | undefined
  let first = 0
  let last = 0
  let length = 0
  const flush = (): void => {
    if (role !== undefined && last > first && !excerpts.some(item => item.role === role)) {
      const text = lines.slice(first, last).join('\n')
      excerpts.push({ role, startLine: first + 1, endLine: last, content: text,
        contentHash: createHash('sha256').update(text).digest('hex') })
    }
    role = undefined
    length = 0
  }
  for (const [index, line] of lines.entries()) {
    const title = line.replace(/^\s*#{1,6}\s*/u, '').replace(/^\s*(?:[IVX]+[.)]?|\d+(?:\.\d+)*[.)]?)\s+/u, '').trim()
    const match = HEADINGS.find(([, pattern]) => pattern.test(title))
    if (match !== undefined) {
      flush()
      role = match[0]
      first = index
      last = index
    } else if (SECTION_BREAK.test(line.trim())) {
      flush()
    }
    if (role === undefined) continue
    if (length + line.length + (last > first ? 1 : 0) > maxChars) { flush(); continue }
    if (last === first && line.trim().length === 0) { first = index + 1; last = first; continue }
    length += line.length + (last > first ? 1 : 0)
    last = index + 1
  }
  flush()
  return excerpts.filter(item => item.content.split('\n').length > 1 || item.content.length > 80)
}

/**
 * Recognize explicit overview requests without interpreting the scientific answer.
 * @param question - original user question, retained across auxiliary query retrieval.
 * @returns whether section coverage is preferable to isolated passage matches.
 */
export function isOverviewQuestion(question: string): boolean {
  return /概览|综述|概述|概括|总结|整体|overview|summari[sz]e|summary|review\s+of/iu.test(question)
}
