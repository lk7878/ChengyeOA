// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TopicPanel } from '../src/client/TopicPanel.tsx'
import { zh } from '../src/client/locales.ts'
import type { KnowledgeDocumentView, KnowledgeTopic } from '../src/types.ts'

afterEach(cleanup)

it('previews original evidence, preserves human notes on regeneration and saves only on explicit publication', async () => {
  const topic: KnowledgeTopic = { id: '00000000-0000-4000-8000-000000000001', title: '样本比较', revision: 1, version: 1,
    notes: '已保存备注', previousText: '', stale: false,
    claims: [{ text: '研究条件不同。', kind: 'insufficient', evidenceIds: [1, 2] }],
    sources: ['A', 'B'].map((name, i) => ({ id: i + 1, documentId: name, documentName: name, heading: '', startLine: 1, endLine: 1, content: `${name} 原文`, contentHash: 'a'.repeat(64) })) }
  const actions = { topics: vi.fn(async () => [topic]), previewTopic: vi.fn(async () => ({ ...topic, previousText: '旧版比较' })),
    saveTopic: vi.fn(async (_ref: string, value: KnowledgeTopic) => ({ ...value, version: 2 })) }
  const documents = ['A', 'B'].map(id => ({ id, name: id, status: 'ready' })) as KnowledgeDocumentView[]
  const view = render(<TopicPanel actions={actions} base="paper" documents={documents} disabled={false} t={key => zh[key]} />)
  fireEvent.click(await view.findByRole('button', { name: topic.title }))
  fireEvent.change(view.getByLabelText(zh.topicNotes), { target: { value: '尚未保存的人工备注' } })
  fireEvent.click(view.getByRole('button', { name: zh.previewTopic }))
  await waitFor(() => { expect(view.getByText(zh.previousTopic)).toBeTruthy() })
  expect((view.getByLabelText(zh.topicNotes) as HTMLTextAreaElement).value).toBe('尚未保存的人工备注')
  expect(actions.saveTopic).not.toHaveBeenCalled()
  expect(view.container.querySelector('article')?.textContent).toMatchInlineSnapshot('"样本比较证据不足: 研究条件不同。 [1] [2][1] A · 第 1-1 行A 原文[2] B · 第 1-1 行B 原文上次生成的文本旧版比较人工备注（重新生成时保留）尚未保存的人工备注保存已审阅主题"')
  fireEvent.click(view.getByRole('button', { name: zh.publishTopic }))
  await waitFor(() => { expect(actions.saveTopic).toHaveBeenCalledWith('paper', expect.objectContaining({ notes: '尚未保存的人工备注', version: 1 })) })
})
