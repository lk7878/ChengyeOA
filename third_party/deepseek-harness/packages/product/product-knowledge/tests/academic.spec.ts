import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { academicGuide } from '../src/academic.ts'
import { KnowledgeBaseStore } from '../src/store.ts'

describe('source-backed academic guides', () => {
  it('keeps verbatim ranges for PDF-style headings and omits missing or oversized sections', () => {
    const content = ['# Page 1', 'I. ABSTRACT', 'THUMS study scope.', '## Page 2', 'II. METHODS',
      'Frontal thoracic loading.', 'III. RESULTS', 'Risk estimates differ.', 'IV. CONCLUSIONS',
      'Calibration is model-specific.', 'REFERENCES', 'Unrelated conclusion in another paper.'].join('\n')
    const guide = academicGuide(content, 100)
    expect(guide.map(item => item.role)).toEqual(['abstract', 'methods', 'results', 'conclusion'])
    for (const excerpt of guide) {
      expect(excerpt.content).toBe(content.split('\n').slice(excerpt.startLine - 1, excerpt.endLine).join('\n'))
      expect(excerpt.contentHash).toBe(createHash('sha256').update(excerpt.content).digest('hex'))
      expect(excerpt.content.length).toBeLessThanOrEqual(100)
      expect(excerpt.content).not.toContain('Unrelated')
    }
    expect(academicGuide('No recognizable headings.', 100)).toEqual([])
    expect(academicGuide('## Results\n' + 'x'.repeat(200), 100)).toEqual([])
  })

  it('uses Wiki source guides for Chinese overviews without changing stored documents', async () => {
    const store = new KnowledgeBaseStore(':memory:')
    try {
      store.create('papers', 'Papers')
      const imported = store.importMarkdown('papers', 'THUMS-study.md', [
        '# Page 1', 'ABSTRACT', 'THUMS study of rib fracture risk.', '## Page 2', 'METHODS',
        'Frontal loading and local strain evaluation.', 'CONCLUSIONS', 'Calibration is model-specific.',
        '## Appendix', 'THUMS '.repeat(50),
      ].join('\n'))
      store.importMarkdown('papers', 'unrelated.md', '## Abstract\nBotanical fertilizer comparison.')
      const page = store.wiki('papers', imported.document.id).pages[0]!
      expect(page.title).toBe('THUMS-study')
      expect(page.summary).toContain('THUMS study of rib fracture risk.')
      expect(page.academicGuide?.map(item => item.role)).toEqual(['abstract', 'methods', 'conclusion'])
      const result = await store.askHybrid('papers', 'THUMS的胸部损伤如何评价，请给我一个概览', 8)
      expect(result.citations[0]?.heading).toBe('abstract')
      expect(result.citations.some(item => item.heading === 'conclusion')).toBe(true)
      expect(result.citations.every(item => item.documentId === imported.document.id)).toBe(true)
      const translated = await store.askHybrid('papers', 'THUMS thoracic injury evaluation', 8, undefined, '给我一个概览')
      expect(translated.citations.some(item => item.heading === 'methods')).toBe(true)
      expect(store.documents('papers').find(item => item.id === imported.document.id)?.revision).toBe(imported.document.revision)
    } finally { store.close() }
  })
})
