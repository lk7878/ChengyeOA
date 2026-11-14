// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { KnowledgeBaseCenter } from '@deepseek-ai/dsh-product-knowledge/src/client/KnowledgeBaseCenter.tsx'
import { apply, inject as clientInject } from '@deepseek-ai/dsh-product-knowledge/src/client/index.ts'
import { en, zh } from '@deepseek-ai/dsh-product-knowledge/src/client/locales.ts'
import { answerCopy } from '@deepseek-ai/dsh-product-knowledge/src/answer-copy.ts'
import type {
  KnowledgeAnswerView, KnowledgeBaseView, KnowledgeDocumentView,
  KnowledgeGraphValue, KnowledgeModelSettingsValue, KnowledgeSearchHit,
  KnowledgeWikiPageView, KnowledgeWikiValue, KnowledgeImportFileValue, KnowledgeCompilationValue,
} from '@deepseek-ai/dsh-product-knowledge/types'

const base: KnowledgeBaseView = {
  id: 'kb-1', alias: 'legal', name: 'Legal', status: 'active', revision: 1,
  documentCount: 1, chunkCount: 2, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}
const document: KnowledgeDocumentView = {
  id: 'doc-1', knowledgeBaseId: base.id, name: 'Procedure.md', contentHash: 'a'.repeat(64),
  originalName: 'Procedure.md', kind: 'md', sourceHash: 'd'.repeat(64), sizeBytes: 120,
  status: 'ready', progress: 100, error: null, extractedChars: 98,
  revision: 1, chunkCount: 2, importedAt: '2026-09-01T00:00:00.000Z',
}
const hit: KnowledgeSearchHit = {
  knowledgeBaseId: base.id, knowledgeBaseAlias: base.alias, revision: 1, documentId: document.id,
  documentName: document.name, chunkId: 'chunk-1', heading: 'Notice', startLine: 4, endLine: 5,
  content: 'Serve notice before compulsory measures.', contentHash: 'b'.repeat(64),
}

const compilerActions = {
  topics: vi.fn(async () => []), previewTopic: vi.fn(), saveTopic: vi.fn(),
  queue: vi.fn().mockResolvedValue({ imports: [], compilations: [] }),
  conversation: vi.fn().mockResolvedValue({ turns: [], hasMore: false }),
  compilation: vi.fn().mockResolvedValue({ status: 'uncompiled', progress: 0, error: null, publication: null, vision: [], suggestedPages: [], rawAvailable: false }),
  compilerSettings: vi.fn().mockResolvedValue({ settings: { provider: '', model: '', visionEnabled: false, visionProvider: '', visionModel: '', maxInputChars: 16000, maxOutputTokens: 16000, timeoutMs: 180000, maxCalls: 200, renderWidth: 2000 },
    resolvedProvider: 'fixture', resolvedModel: 'model', options: [], writable: true }),
  saveCompilerSettings: vi.fn(), compileDocument: vi.fn(), reviewVision: vi.fn(), reviewGap: vi.fn(),
}

afterEach(cleanup)

describe('KnowledgeBaseCenter', () => {
  const uncompiled: KnowledgeCompilationValue = { status: 'uncompiled', progress: 0, error: null, publication: null,
    vision: [], suggestedPages: [], rawAvailable: true }
  const compiled: KnowledgeCompilationValue = { ...uncompiled, status: 'review', progress: 100,
    publication: { version: 1, sourceHash: 'raw', contentHash: 'text', cacheKey: 'publication', provider: 'fixture', model: 'academic',
      createdAt: '2026-09-08T00:00:00.000Z', title: 'Paper', sections: [], facts: [], visionSources: [], coverage: [],
      gaps: ['Check source.'], calls: 2, totalTokens: 300, latencyMs: 100 } }
  const batchDocuments = ['A.pdf', 'B.pdf', 'C.pdf', 'D.pdf', 'E.pdf'].map((name, index) => ({ ...document, id: `doc-${index}`, name }))

  async function batchView(overrides: Partial<ComponentProps<typeof KnowledgeBaseCenter>> = {}) {
    const props = { pageId: 'knowledge-base', ...compilerActions, close: vi.fn(), list: vi.fn().mockResolvedValue([base]),
      documents: vi.fn().mockResolvedValue(batchDocuments), compilation: vi.fn().mockResolvedValue(uncompiled),
      documentDetail: vi.fn().mockResolvedValue({ document: batchDocuments[0], preview: '', reprocessable: true, stages: [] }),
      compileDocument: vi.fn().mockResolvedValue(compiled), t: (key: keyof typeof en) => zh[key], ...overrides,
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    fireEvent.click(view.getByRole('button', { name: zh.documents }))
    await view.findByText('A.pdf')
    return { view, props }
  }

  it('compiles selected ready sources serially with consent, cache reuse, isolated failures and Chinese results', async () => {
    let finish: (value: KnowledgeCompilationValue) => void = () => { throw new Error('Not started') }
    const pending = new Promise<KnowledgeCompilationValue>((resolve) => { finish = resolve })
    const compileDocument = vi.fn<ComponentProps<typeof KnowledgeBaseCenter>['compileDocument']>().mockImplementationOnce(() => pending).mockResolvedValueOnce(compiled)
      .mockResolvedValueOnce({ ...uncompiled, status: 'failed' }).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(compiled)
    const { view } = await batchView({ compileDocument, compilation: vi.fn<ComponentProps<typeof KnowledgeBaseCenter>['compilation']>(async request => request.documentId === 'doc-0' ? compiled : uncompiled),
      documents: vi.fn().mockResolvedValue([...batchDocuments, { ...document, id: 'bad', name: 'Bad.pdf', status: 'failed' }]) })
    const start = view.getByRole('button', { name: zh.batchCompile }) as HTMLButtonElement
    fireEvent.click(view.getByLabelText(zh.batchCompileSelectAll))
    expect((view.getByLabelText(zh.batchCompileSelectDocument.replace('{name}', 'Bad.pdf')) as HTMLInputElement).disabled).toBe(true)
    expect(start.disabled).toBe(true)
    fireEvent.click(view.getByLabelText(zh.batchCompileConsent))
    fireEvent.click(start)
    await waitFor(() => { expect(compileDocument).toHaveBeenCalledTimes(1) })
    expect((view.getByLabelText(zh.switchKnowledgeBase) as HTMLSelectElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: zh.wiki }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(start)
    expect(compileDocument).toHaveBeenCalledTimes(1)
    await act(async () => { finish(compiled); await pending })
    await waitFor(() => { expect(start.disabled).toBe(false) })
    expect(compileDocument.mock.calls.map(call => call[0])).toEqual(batchDocuments.map(row => ({ ref: base.alias, documentId: row.id, operation: 'compile', force: false })))
    expect(view.getByLabelText(zh.batchCompileResults).textContent).toMatchInlineSnapshot('"已结束: 5/5A.pdf — 已复用有效成果（无模型调用）B.pdf — 编译完成 · 待核验C.pdf — 失败: 任务未完成，请检查模型设置和诊断会话；上一版知识仍保留。D.pdf — 失败: Connection lostE.pdf — 编译完成 · 待核验"')
  })

  it('selects only filtered ready rows, preserves hidden selection and clears it explicitly', async () => {
    const { view, props } = await batchView()
    const filter = view.getByPlaceholderText(zh.filterDocuments)
    fireEvent.change(filter, { target: { value: 'A.pdf' } })
    fireEvent.click(view.getByLabelText(zh.batchCompileSelectAll))
    fireEvent.change(filter, { target: { value: 'B.pdf' } })
    fireEvent.click(view.getByLabelText(zh.batchCompileSelectAll))
    expect(view.getByText('已选择: 2')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: zh.batchCompileClear }))
    expect(view.getByText('已选择: 0')).toBeTruthy()
    fireEvent.click(view.getByLabelText(zh.batchCompileSelectAll))
    fireEvent.click(view.getByLabelText(zh.batchCompileConsent))
    fireEvent.click(view.getByRole('button', { name: zh.batchCompile }))
    await waitFor(() => { expect(props.compileDocument).toHaveBeenCalledTimes(1) })
    expect(props.compileDocument).toHaveBeenCalledWith({ ref: base.alias, documentId: 'doc-1', operation: 'compile', force: false }, expect.any(AbortSignal))
  })

  it.each(['cancel', 'unmount'] as const)('stops current compilation and never dispatches queued documents after %s', async (operation) => {
    let finish: (value: KnowledgeCompilationValue) => void = () => { throw new Error('Not started') }
    const pending = new Promise<KnowledgeCompilationValue>((resolve) => { finish = resolve })
    const compileDocument = vi.fn().mockImplementation(() => pending)
    const { view } = await batchView({ compileDocument })
    fireEvent.click(view.getByLabelText(zh.batchCompileSelectAll))
    fireEvent.click(view.getByLabelText(zh.batchCompileConsent))
    fireEvent.click(view.getByRole('button', { name: zh.batchCompile }))
    await waitFor(() => { expect(compileDocument).toHaveBeenCalledTimes(1) })
    const signal = compileDocument.mock.calls[0]![1] as AbortSignal
    if (operation === 'unmount') view.unmount()
    else fireEvent.click(view.getByRole('button', { name: zh.batchCompileCancel }))
    expect(signal.aborted).toBe(true)
    await act(async () => { finish({ ...uncompiled, status: 'cancelled' }); await pending })
    expect(compileDocument).toHaveBeenCalledTimes(1)
    if (operation === 'cancel') {
      expect(view.getByText('A.pdf — 已取消')).toBeTruthy()
      expect(view.getByText('B.pdf — 未执行')).toBeTruthy()
    }
  })

  it('reports polled progress failures and recovery without dispatching more work', async () => {
    const { view, props } = await batchView({ compileDocument: vi.fn().mockImplementation(() => new Promise(() => {})),
      compilation: vi.fn().mockResolvedValueOnce(uncompiled).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ ...uncompiled, status: 'running', progress: 42 }) })
    vi.useFakeTimers()
    try {
      fireEvent.click(view.getByLabelText(zh.batchCompileSelectAll))
      fireEvent.click(view.getByLabelText(zh.batchCompileConsent))
      await act(async () => { fireEvent.click(view.getByRole('button', { name: zh.batchCompile })) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(view.getByRole('alert').textContent).toBe(zh.compilerProgressUnavailable)
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(view.getByText('A.pdf — 编译中 · 42%')).toBeTruthy()
      expect(view.queryByRole('alert')).toBeNull()
      expect(props.compileDocument).toHaveBeenCalledTimes(1)
    } finally { view.unmount(); vi.useRealTimers() }
  })

  it('blocks archived libraries and a selected document already running in the single compiler', async () => {
    const { view, props } = await batchView({ compilation: vi.fn().mockResolvedValue({ ...uncompiled, status: 'running' }) })
    fireEvent.click(view.getAllByRole('button', { name: zh.details })[0]!)
    await view.findByText(zh.compilerTitle)
    await waitFor(() => { expect(view.getByText(zh.batchCompileAlreadyRunning)).toBeTruthy() })
    fireEvent.click(view.getByLabelText(zh.batchCompileSelectAll))
    fireEvent.click(view.getByLabelText(zh.batchCompileConsent))
    expect((view.getByRole('button', { name: zh.batchCompile }) as HTMLButtonElement).disabled).toBe(true)
    expect(props.compileDocument).not.toHaveBeenCalled()
    view.unmount()
    const archived = await batchView({ list: vi.fn().mockResolvedValue([{ ...base, status: 'archived' }]) })
    expect((archived.view.getByLabelText(zh.batchCompileSelectAll) as HTMLInputElement).disabled).toBe(true)
    expect((archived.view.getByRole('button', { name: zh.batchCompile }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(['detail', 'reprocess', 'delete', 'import'] as const)('refreshes missing document references after %s without retaining the compiler', async (operation) => {
    let missing = false
    const detail = { document, preview: 'Stored paper preview', reprocessable: true, stages: [] }
    const fail = async () => {
      missing = true
      throw new RemoteError('knowledge/document-not-found', 'Old document is missing.', { ref: base.alias, documentId: document.id })
    }
    const failed = { ...document, status: 'failed', error: 'OCR timeout' }
    const props = { pageId: 'knowledge-base', close: vi.fn(), list: vi.fn().mockResolvedValue([base]),
      documents: vi.fn(async () => missing ? [] : [failed]),
      documentDetail: vi.fn().mockResolvedValueOnce(detail).mockImplementation(fail),
      reprocess: vi.fn(fail), deleteDocument: vi.fn(fail),
      importFile: vi.fn().mockResolvedValue({ document, knowledgeBase: base, duplicate: false }),
      t: (key: keyof typeof en) => zh[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    fireEvent.click(view.getByRole('button', { name: zh.documents }))
    fireEvent.click(await view.findByRole('button', { name: zh.details }))
    expect(await view.findByText(detail.preview)).toBeTruthy()
    if (operation === 'import') {
      const input = view.getByLabelText(zh.sourceFile)
      fireEvent.change(input, { target: { files: [new File(['fixture'], 'Paper.pdf')] } })
      fireEvent.submit(input.closest('form')!)
    } else fireEvent.click(view.getByRole('button', { name: operation === 'detail' ? zh.details : operation === 'reprocess' ? zh.reprocess : zh.deleteDocument }))
    expect(await view.findByText(zh.documentUnavailable)).toBeTruthy()
    await waitFor(() => { expect(view.queryByRole('button', { name: zh.details })).toBeNull() })
    expect(view.queryByText(detail.preview)).toBeNull()
    expect(view.queryByRole('button', { name: zh.compilerRun })).toBeNull()
    expect(view.queryByRole('alert')).toBeNull()
    expect(view.getByText(zh.documentUnavailable).textContent).toMatchInlineSnapshot('"该文档已不存在，已关闭旧详情；请从当前列表重新选择文档。"')
    if (operation === 'import') expect(view.getByText('Paper.pdf — 已导入')).toBeTruthy()
  })

  it('closes the current document and compiler after a successful deletion', async () => {
    let deleted = false
    const props = { pageId: 'knowledge-base', close: vi.fn(), list: vi.fn().mockResolvedValue([base]),
      documents: vi.fn(async () => deleted ? [] : [document]),
      documentDetail: vi.fn().mockResolvedValue({ document, preview: 'Stored preview', reprocessable: true, stages: [] }),
      deleteDocument: vi.fn(async () => { deleted = true }), t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    fireEvent.click(view.getByRole('button', { name: en.documents }))
    fireEvent.click(await view.findByRole('button', { name: en.details }))
    expect(await view.findByText('Stored preview')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: en.deleteDocument }))
    expect(await view.findByText(en.documentDeleted)).toBeTruthy()
    expect(view.queryByText('Stored preview')).toBeNull()
    expect(view.queryByRole('button', { name: en.compilerRun })).toBeNull()
  })

  it('ignores late detail results after switching bases and keeps unrelated failures visible', async () => {
    const other = { ...base, id: 'kb-2', alias: 'other', name: 'Other' }
    const detail = { document, preview: 'Late old preview', reprocessable: true, stages: [] }
    let finish: (value: typeof detail) => void = () => { throw new Error('No pending detail') }
    const pending = new Promise<typeof detail>((resolve) => { finish = resolve })
    const documents = vi.fn().mockResolvedValue([document])
    const props = { pageId: 'knowledge-base', close: vi.fn(), list: vi.fn().mockResolvedValue([base, other]),
      documents, documentDetail: vi.fn().mockImplementationOnce(() => pending).mockRejectedValueOnce(new Error('Connection lost')),
      t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    fireEvent.click(view.getByRole('button', { name: en.documents }))
    fireEvent.click(await view.findByRole('button', { name: en.details }))
    fireEvent.change(view.getByLabelText(en.switchKnowledgeBase), { target: { value: 'other' } })
    await waitFor(() => { expect(documents).toHaveBeenCalledWith('other') })
    await act(async () => { finish(detail); await pending })
    fireEvent.click(view.getByRole('button', { name: en.documents }))
    expect(view.queryByText(detail.preview)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: en.details }))
    expect((await view.findByRole('alert')).textContent).toContain('Connection lost')
    expect(view.queryByText(en.documentUnavailable)).toBeNull()
    expect(view.getByRole('button', { name: en.details })).toBeTruthy()
  })

  it('imports multiple raw files serially and reports every success, duplicate and failure in Chinese', async () => {
    let finish: (value: KnowledgeImportFileValue) => void = () => { throw new Error('No pending import') }
    const pending = new Promise<KnowledgeImportFileValue>((resolve) => { finish = resolve })
    const result = { document, knowledgeBase: base, duplicate: false }
    const importFile = vi.fn().mockImplementationOnce(() => pending)
      .mockResolvedValueOnce({ ...result, duplicate: true })
      .mockResolvedValueOnce({ ...result, duplicate: true, document: { ...document, status: 'failed', error: 'OCR timeout' } })
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce(result)
    const props = { pageId: 'knowledge-base', close: vi.fn(), list: vi.fn().mockResolvedValue([base]),
      documents: vi.fn().mockResolvedValue([]), importFile,
      reprocess: vi.fn().mockResolvedValue({ ...result, document: { ...document, status: 'failed', error: 'OCR timeout' } }),
      documentDetail: vi.fn().mockResolvedValue({ document, preview: '', reprocessable: false, stages: [] }),
      t: (key: keyof typeof en) => zh[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    fireEvent.click(view.getByRole('button', { name: zh.documents }))
    const input = view.getByLabelText(zh.sourceFile) as HTMLInputElement
    expect(input.multiple).toBe(true)
    const files = ['A.pdf', 'Duplicate.pdf', 'Broken.pdf', 'Network.docx', 'Empty.txt', 'Large.pdf', 'Last.html']
      .map(name => new File([name === 'Empty.txt' ? '' : 'fixture'], name))
    Object.defineProperty(files[5], 'size', { value: 20 * 1024 * 1024 + 1 })
    fireEvent.change(input, { target: { files } })
    fireEvent.submit(input.closest('form')!)
    expect(importFile).toHaveBeenCalledTimes(1)
    expect(input.disabled).toBe(true)
    expect((view.getByLabelText(zh.switchKnowledgeBase) as HTMLSelectElement).disabled).toBe(true)
    fireEvent.submit(input.closest('form')!)
    expect(importFile).toHaveBeenCalledTimes(1)
    await act(async () => { finish(result); await pending })
    await waitFor(() => { expect(input.disabled).toBe(false) })
    expect(importFile.mock.calls.map(call => (call[1] as File).name)).toEqual(['A.pdf', 'Duplicate.pdf', 'Broken.pdf', 'Network.docx', 'Last.html'])
    const region = view.getByRole('region', { name: zh.batchImport })
    expect(Array.from(region.querySelectorAll('li'), row => row.textContent)).toMatchInlineSnapshot(`
      [
        "A.pdf — 已导入",
        "Duplicate.pdf — 已存在",
        "Broken.pdf — 失败: OCR timeout",
        "Network.docx — 失败: Connection lost",
        "Empty.txt — 失败: 文件内容为空。",
        "Large.pdf — 失败: 文件超过单个 20 MiB 上限。",
        "Last.html — 已导入",
      ]
    `)
    expect(region.textContent).toContain('7/7')
  })

  it.each(['stop', 'unmount'] as const)('does not dispatch remaining files after %s while the current import settles', async (operation) => {
    let finish: (value: KnowledgeImportFileValue) => void = () => { throw new Error('No pending import') }
    const pending = new Promise<KnowledgeImportFileValue>((resolve) => { finish = resolve })
    const importFile = vi.fn(() => pending)
    const props = { pageId: 'knowledge-base', close: vi.fn(), list: vi.fn().mockResolvedValue([base]),
      documents: vi.fn().mockResolvedValue([]), importFile, documentDetail: vi.fn(),
      t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    fireEvent.click(view.getByRole('button', { name: en.documents }))
    const input = view.getByLabelText(en.sourceFile) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['a'], 'A.txt'), new File(['b'], 'B.txt')] } })
    fireEvent.submit(input.closest('form')!)
    expect(importFile).toHaveBeenCalledTimes(1)
    if (operation === 'stop') {
      fireEvent.click(view.getByRole('button', { name: en.stopImports }))
      expect(input.disabled).toBe(true)
    } else view.unmount()
    await act(async () => { finish({ document, knowledgeBase: base, duplicate: false }); await pending })
    expect(importFile).toHaveBeenCalledTimes(1)
    expect(props.documentDetail).not.toHaveBeenCalled()
    if (operation === 'stop') {
      expect(input.disabled).toBe(false)
      expect(view.getByText('B.txt — Not started')).toBeTruthy()
      expect(view.getByText('A.txt — Imported')).toBeTruthy()
    }
  })

  it('replaces rejected streamed text with a Chinese failure notice and keeps evidence outside the answer', async () => {
    const answer: KnowledgeAnswerView = {
      status: 'failed', requestedMode: 'model', mode: 'model-failed', question: '请用中文说明结论',
      answer: answerCopy.zh.answerFailed, confidence: 'none',
      citations: [{ id: 1, documentId: 'doc-1', documentName: 'Policy.md', heading: 'Notice',
        startLine: 1, endLine: 2, content: 'Original English evidence.', contentHash: 'a'.repeat(64) }],
      generation: { provider: 'fixture', model: 'model', latencyMs: 1, inputTokens: null, outputTokens: null, totalTokens: null, fallbackReason: 'invalid-citations' },
    }
    let finish: (() => void) | undefined
    const ask: ComponentProps<typeof KnowledgeBaseCenter>['ask'] = async (_ref, _question, _mode, frame) => {
      frame({ type: 'start', answer: { ...answer, answer: '', mode: 'model-rag' }, provider: 'fixture', model: 'model' })
      frame({ type: 'delta', text: 'Unverified draft [99].' })
      await new Promise<void>((resolve) => { finish = resolve })
      frame({ type: 'complete', answer })
      return answer
    }
    const props = { pageId: 'knowledge-base', close: vi.fn(), list: vi.fn().mockResolvedValue([base]),
      documents: vi.fn().mockResolvedValue([document]), ask, t: (key: keyof typeof en) => zh[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    fireEvent.click(view.getByRole('button', { name: zh.qa }))
    expect(view.getByText(zh.chatSessionHint).textContent).toMatchInlineSnapshot('"问题、完整终态回答和历史引用保存在本地，重新打开知识库后可继续；每轮重新查证当前原文，对话摘要按需重建。"')
    fireEvent.change(view.getByLabelText(zh.question), { target: { value: answer.question } })
    fireEvent.click(view.getByRole('button', { name: zh.ask }))
    expect(await view.findByText(/未核验草稿/u)).toBeTruthy()
    finish?.()
    expect(await view.findByText(answerCopy.zh.answerFailed)).toBeTruthy()
    expect(view.queryByText('Unverified draft [99].')).toBeNull()
    expect(view.getByText('Original English evidence.').closest('details')?.open).toBe(false)
    fireEvent.click(view.getByRole('button', { name: zh.retryQuestion }))
    expect((view.getByLabelText(zh.question) as HTMLTextAreaElement).value).toBe(answer.question)
  })
  it('submits Chinese after IME composition and visibly labels general answers without library citations', async () => {
    const answer: KnowledgeAnswerView = {
      status: 'answered', requestedMode: 'model', mode: 'model-general', question: '你好',
      answer: '你好，可以用中文提问。', confidence: 'none', citations: [], generation: null,
    }
    const ask = vi.fn().mockResolvedValue(answer)
    const props = {
      pageId: 'knowledge-base', close: vi.fn(), list: vi.fn().mockResolvedValue([base]),
      documents: vi.fn().mockResolvedValue([document]), ask, t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    await waitFor(() => { expect(props.documents).toHaveBeenCalledWith('legal') })
    fireEvent.click(view.getByRole('button', { name: 'Q&A' }))
    const question = view.getByLabelText('Question')
    fireEvent.change(question, { target: { value: '你好' } })
    fireEvent.keyDown(question, { key: 'Enter', isComposing: true })
    expect(ask).not.toHaveBeenCalled()
    fireEvent.keyDown(question, { key: 'Enter', isComposing: false })
    expect(await view.findByText('你好，可以用中文提问。')).toBeTruthy()
    expect(ask).toHaveBeenCalledWith('legal', '你好', 'model', expect.any(Function), expect.any(AbortSignal), { summary: '', turns: [] })
    expect(view.getByRole('note').textContent).toBe(en.generalAnswerNotice)
    expect(view.queryByText(/Source evidence/u)).toBeNull()
  })

  it('mounts its generated Remote contribution instead of waiting on an unprovided namespace', async () => {
    const disposeRemote = vi.fn(async () => {})
    const mount = vi.fn(async (contribution: unknown) => {
      void contribution
      return disposeRemote
    })
    const registerLocale = vi.fn(() => vi.fn())
    const disposeUi = vi.fn(async () => {})
    const register = vi.fn((_definition: { inject: () => unknown }, _component: unknown) => {})
    const missing = new RemoteError('knowledge/document-not-found', 'Missing document.', { ref: 'legal', documentId: 'doc-1' })
    const ctx: Record<string, unknown> = {
      remote: { $mount: mount, knowledge: { documentDetail: vi.fn().mockResolvedValue({ ok: false, error: missing }) } },
      effect: vi.fn((setup: () => unknown) => setup()),
      locale: { register: registerLocale },
      layout: { closePrimaryPage: vi.fn(), openPrimaryPage: vi.fn() },
      slots: { inject: vi.fn((_slot: string, install: () => unknown) => install()), register },
    }
    const injectScope = vi.fn((services: string[], register: (scope: unknown) => void) => {
      void services
      register(ctx)
      return Object.assign(Promise.resolve(), { dispose: disposeUi })
    })
    ctx.inject = injectScope

    expect(clientInject).toEqual(['slots', 'locale', 'layout', 'remote'])
    const dispose = await apply(ctx as never)
    expect(mount).toHaveBeenCalledTimes(1)
    expect(mount.mock.calls[0]?.[0]).toMatchObject({ package: '@deepseek-ai/dsh-product-knowledge' })
    expect(injectScope).toHaveBeenCalledWith(
      ['slots', 'locale', 'layout', 'remote.knowledge'],
      expect.any(Function),
    )
    expect(registerLocale).toHaveBeenCalledTimes(1)
    const actions = register.mock.calls[0]![0].inject() as ComponentProps<typeof KnowledgeBaseCenter>
    await expect(actions.documentDetail('legal', 'doc-1')).rejects.toBe(missing)
    await dispose()
    expect(disposeUi).toHaveBeenCalledTimes(1)
    expect(disposeRemote).toHaveBeenCalledTimes(1)
  })

  it('drives create, import, and source-evidenced search callbacks', async () => {
    const list = vi.fn().mockResolvedValue([base])
    const create = vi.fn().mockResolvedValue(base)
    const documents = vi.fn().mockResolvedValue([document])
    const importMarkdown = vi.fn().mockResolvedValue(undefined)
    const importFile = vi.fn().mockResolvedValue({ document, knowledgeBase: base, duplicate: false })
    const documentDetail = vi.fn().mockResolvedValue({
      document, preview: '# Procedure', reprocessable: true,
      stages: [{ key: 'upload', status: 'done', progress: 10, message: 'persisted' }],
    })
    const search = vi.fn().mockResolvedValue({
      hits: [hit],
      retrieval: {
        requestedMode: 'hybrid', actualMode: 'hybrid', semanticIndexRevision: 1,
        semanticCandidateCount: 1, fallbackReason: null,
      },
    })
    const props = {
      pageId: 'knowledge-base', close: vi.fn(), list, create, documents, importFile, importMarkdown,
      documentDetail, reprocess: vi.fn(), search,
      t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)

    await waitFor(() => { expect(view.getByText('Legal')).toBeTruthy() })
    fireEvent.click(view.getByText('Legal'))
    await waitFor(() => { expect(documents).toHaveBeenCalledWith('legal') })

    fireEvent.change(view.getByLabelText('Search query'), { target: { value: 'notice' } })
    fireEvent.click(view.getByRole('button', { name: 'Search' }))
    await waitFor(() => { expect(view.getByText('Serve notice before compulsory measures.')).toBeTruthy() })
    expect(view.getByText(/Procedure\.md · L4-5 · r1/u)).toBeTruthy()
    expect(view.getByRole('status').textContent).toContain('Retrieval: Hybrid · vector index revision: 1 · semantic candidates: 1')

    fireEvent.click(view.getByRole('button', { name: 'Documents' }))
    fireEvent.change(view.getByLabelText('Document name'), { target: { value: 'New.md' } })
    fireEvent.change(view.getByLabelText('Markdown content'), { target: { value: '# New\nBody' } })
    fireEvent.click(view.getByRole('button', { name: 'Import Markdown' }))
    await waitFor(() => { expect(importMarkdown).toHaveBeenCalledWith('legal', 'New.md', '# New\nBody') })

    const file = new File(['# Uploaded\nEvidence'], 'Uploaded.md', { type: 'text/markdown' })
    const fileInput = view.getByLabelText('Source file')
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fireEvent.submit(fileInput.closest('form')!)
    await waitFor(() => { expect(importFile).toHaveBeenCalledWith('legal', file, true) })
    expect(await view.findByText('Extracted preview')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Manage knowledge bases' }))
    expect(view.getByRole('dialog', { name: 'Manage knowledge bases' })).toBeTruthy()
    expect(view.getByLabelText('Stable alias').getAttribute('pattern')).toBe('[a-z0-9](?:[a-z0-9]|-)*')
    fireEvent.change(view.getByLabelText('Stable alias'), { target: { value: 'new-base' } })
    fireEvent.change(view.getByLabelText('Name'), { target: { value: 'New Base' } })
    fireEvent.click(view.getByRole('button', { name: 'Create knowledge base' }))
    await waitFor(() => { expect(create).toHaveBeenCalledWith('new-base', 'New Base') })
  })

  it('loads every knowledge workspace tab and invokes lifecycle management', async () => {
    const pageSummary: KnowledgeWikiPageView = {
      id: 'page:doc-1', slug: 'procedure-doc-1', title: 'Procedure', summary: 'Serve notice.',
      type: 'procedure', topic: 'Notice', sources: [], links: [],
      documentId: document.id, documentName: document.name, revision: 1,
      contentHash: document.contentHash, sections: [],
    }
    const pageDetail: KnowledgeWikiPageView = {
      ...pageSummary,
      academicGuide: [{ role: 'methods', startLine: 4, endLine: 5,
        content: 'Verbatim methods excerpt.', contentHash: 'e'.repeat(64) }],
      sections: [{
        id: 'section:doc-1:0', heading: 'Notice', level: 2, startLine: 4, endLine: 5,
        content: 'Serve notice before compulsory measures.', contentHash: 'c'.repeat(64),
      }],
    }
    const graph: KnowledgeGraphValue = {
      revision: 1, totalNodes: 2, totalEdges: 1, truncated: false,
      nodes: [
        { id: pageSummary.id, type: 'page', label: pageSummary.title, documentId: document.id, startLine: 1, degree: 1 },
        { id: pageDetail.sections[0]!.id, type: 'section', label: 'Notice', documentId: document.id, startLine: 4, degree: 1 },
      ],
      edges: [{ id: 'edge:0', source: pageSummary.id, target: pageDetail.sections[0]!.id, relation: 'contains', label: 'contains', weight: 1 }],
    }
    const answer: KnowledgeAnswerView = {
      status: 'answered', requestedMode: 'local', mode: 'local-extractive', question: 'notice',
      answer: '[1] Serve notice before compulsory measures.', confidence: 'low',
      generation: null,
      retrieval: {
        requestedMode: 'hybrid', actualMode: 'hybrid', semanticIndexRevision: 1,
        semanticCandidateCount: 1, fallbackReason: null,
      },
      citations: [{
        id: 1, documentId: document.id, documentName: document.name, heading: 'Notice',
        startLine: 4, endLine: 5, content: hit.content, contentHash: hit.contentHash,
      }],
    }
    const modelSettings: KnowledgeModelSettingsValue = {
      settings: { provider: '', model: '', temperature: 0.2, maxOutputTokens: 1200, maxEvidenceChars: 12000, timeoutMs: 60000 },
      resolvedProvider: 'fixture', resolvedModel: 'fixture-model', writable: true,
      options: [{ provider: 'fixture', providerName: 'Fixture', model: 'fixture-model', modelName: 'Fixture model' }],
    }
    const wiki = vi.fn(async (_ref: string, documentId?: string): Promise<KnowledgeWikiValue> => ({
      revision: 1, compiledAt: base.updatedAt, contentHash: 'f'.repeat(64),
      stats: {
        pageCount: 1, sectionCount: 1, sourceCount: 1, linkCount: 0, topicCount: 1,
        types: { policy: 0, procedure: 1, reference: 0, concept: 0 },
      },
      pages: documentId === undefined ? [pageSummary] : [pageDetail],
    }))
    const loadGraph = vi.fn().mockResolvedValue(graph)
    const ask = vi.fn().mockResolvedValue({ ...answer, knowledgeNavigation: {
      status: 'partial', reason: null, provider: 'fixture', model: 'strong-text', calls: 2,
      totalTokens: 300, latencyMs: 500, lookupCount: 1,
      needs: [{ question: 'When is notice required?', evidenceIds: [1] }, { question: 'What exceptions apply?', evidenceIds: [] }],
    } })
    const setStatus = vi.fn().mockResolvedValue({ ...base, status: 'archived' })
    const semanticStatus = {
      configuredMode: 'hybrid' as const, state: 'ready' as const,
      model: 'test/model', modelRevision: 'a'.repeat(40), dimensions: 384, minimumScore: 0.82,
      sourceRevision: 1, indexRevision: 1, sourceChunkCount: 2, indexedChunkCount: 2,
      coverage: 1, builtAt: base.updatedAt,
    }
    const rebuildSemanticIndex = vi.fn().mockResolvedValue(semanticStatus)
    const clearSemanticIndex = vi.fn().mockResolvedValue({
      ...semanticStatus, state: 'missing', indexRevision: null, indexedChunkCount: 0, coverage: 0,
    })
    const props = {
      pageId: 'knowledge-base', close: vi.fn(), list: vi.fn().mockResolvedValue([base]),
      create: vi.fn(), documents: vi.fn().mockResolvedValue([document]), importMarkdown: vi.fn(),
      search: vi.fn(), wiki, graph: loadGraph, ask, setStatus,
      modelSettings: vi.fn().mockResolvedValue(modelSettings),
      saveModelSettings: vi.fn().mockResolvedValue(modelSettings), testModel: vi.fn(),
      semanticIndexStatus: vi.fn().mockResolvedValue(semanticStatus),
      rebuildSemanticIndex, clearSemanticIndex,
      deleteDocument: vi.fn(), deleteKnowledgeBase: vi.fn(), backup: vi.fn(), restore: vi.fn(),
      t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)

    await waitFor(() => { expect(view.getByText('Legal')).toBeTruthy() })
    fireEvent.click(view.getByText('Legal'))
    await waitFor(() => { expect(props.documents).toHaveBeenCalledWith('legal') })

    fireEvent.click(view.getByRole('button', { name: 'Wiki' }))
    await waitFor(() => { expect(view.getAllByText('Serve notice.')).toHaveLength(2) })
    expect(wiki).toHaveBeenCalledWith('legal')
    expect(wiki).toHaveBeenCalledWith('legal', document.id)
    expect(view.getByRole('region', { name: 'Paper reading guide' })).toBeTruthy()
    expect(view.getByText('Methods · L4-5')).toBeTruthy()
    expect(view.getByText('Verbatim methods excerpt.')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'Graph' }))
    await waitFor(() => { expect(view.getByRole('img', { name: 'Knowledge graph' })).toBeTruthy() })
    expect(loadGraph).toHaveBeenCalledWith('legal')

    fireEvent.click(view.getByRole('button', { name: 'Q&A' }))
    fireEvent.change(view.getByLabelText('Question'), { target: { value: 'notice' } })
    fireEvent.click(view.getByRole('button', { name: 'Ask' }))
    await waitFor(() => { expect(view.getByText('[1] Serve notice before compulsory measures.')).toBeTruthy() })
    expect(ask).toHaveBeenCalledWith('legal', 'notice', 'model', expect.any(Function), expect.any(AbortSignal), { summary: '', turns: [] })
    fireEvent.click(view.getByText('Answer details'))
    expect(view.getByRole('status').textContent).toContain('Retrieval: Hybrid · vector index revision: 1')
    expect(view.getByText('When is notice required?', { exact: false })).toBeTruthy()
    expect(view.getByText('What exceptions apply?', { exact: false })).toBeTruthy()
    expect(view.getByText(en.navigationMissing, { exact: false })).toBeTruthy()

    expect(view.queryByRole('button', { name: 'Evaluation' })).toBeNull()
    expect(view.queryByLabelText('Evaluation cases')).toBeNull()
    expect(view.queryByRole('button', { name: 'Evaluate' })).toBeNull()
    expect([...view.getByRole('navigation', { name: en.workspaceNavigation }).querySelectorAll('button')]
      .map(button => button.textContent)).toMatchInlineSnapshot(`
        [
          "Overview",
          "Documents",
          "Wiki",
          "Graph",
          "Q&A",
          "Settings",
        ]
      `)

    fireEvent.click(view.getByRole('button', { name: 'Settings' }))
    await waitFor(() => { expect(view.getByText('Wiki model settings')).toBeTruthy() })
    expect(view.getByText('Local semantic index')).toBeTruthy()
    expect(view.getByText('100% (2/2)')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Rebuild index' }))
    await waitFor(() => { expect(rebuildSemanticIndex).toHaveBeenCalledWith('legal', expect.any(AbortSignal)) })
    fireEvent.click(view.getByRole('button', { name: 'Clear vectors' }))
    await waitFor(() => { expect(clearSemanticIndex).toHaveBeenCalledWith('legal') })
    expect(view.getByText('0% (0/2)')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Archive' }))
    await waitFor(() => { expect(setStatus).toHaveBeenCalledWith('legal', 'archived') })
  })

  it('aborts a streamed answer and ignores its late completion', async () => {
    const answer: KnowledgeAnswerView = {
      status: 'answered', requestedMode: 'model', mode: 'model-rag', question: 'notice',
      answer: 'Authoritative answer [1].', confidence: 'low', generation: null,
      citations: [{
        id: 1, documentId: document.id, documentName: document.name, heading: 'Notice',
        startLine: 4, endLine: 5, content: hit.content, contentHash: hit.contentHash,
      }],
    }
    let observedSignal: AbortSignal | undefined
    const ask = vi.fn(async (
      _ref: string, _question: string, _mode: 'local' | 'model',
      onFrame: (frame: { type: 'start'; answer: KnowledgeAnswerView; provider: string | null; model: string | null }
        | { type: 'delta'; text: string }
        | { type: 'complete'; answer: KnowledgeAnswerView }) => void,
      signal: AbortSignal,
    ) => {
      observedSignal = signal
      onFrame({ type: 'start', answer, provider: 'fixture', model: 'fixture-model' })
      onFrame({ type: 'delta', text: 'Partial answer' })
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return { ...answer, answer: 'Late completion [1].' }
    })
    const props = {
      pageId: 'knowledge-base', close: vi.fn(), list: vi.fn().mockResolvedValue([base]),
      documents: vi.fn().mockResolvedValue([document]), ask,
      t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)

    fireEvent.click(await view.findByText('Legal'))
    await waitFor(() => { expect(props.documents).toHaveBeenCalledWith('legal') })
    fireEvent.click(view.getByRole('button', { name: 'Q&A' }))
    fireEvent.change(view.getByLabelText('Question'), { target: { value: 'notice' } })
    fireEvent.click(view.getByRole('button', { name: 'Ask' }))
    expect(await view.findByText('Partial answer')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Cancel generation' }))

    await waitFor(() => { expect(observedSignal?.aborted).toBe(true) })
    expect(view.queryByText('Late completion [1].')).toBeNull()
    expect(view.getByText('Partial answer')).toBeTruthy()
    expect(view.getByText(`${en.generationStopped} · ${en.unverifiedDraft}`)).toBeTruthy()
    expect(view.getByText('notice')).toBeTruthy()
  })

  async function streamingView(modelSettings?: ComponentProps<typeof KnowledgeBaseCenter>['modelSettings']) {
    const answer: KnowledgeAnswerView = { status: 'answered', requestedMode: 'model', mode: 'model-general',
      question: '你好', answer: '这是完整中文回答。', confidence: 'none', generation: null, citations: [] }
    let finish!: (value: KnowledgeAnswerView) => void
    let fail!: (error: Error) => void
    const pending = new Promise<KnowledgeAnswerView>((resolve, reject) => { finish = resolve; fail = reject })
    const ask = vi.fn<ComponentProps<typeof KnowledgeBaseCenter>['ask']>(async (_ref, _question, _mode, onFrame) => {
      onFrame({ type: 'delta', text: '正在综合文献' })
      return pending
    })
    const settings: KnowledgeModelSettingsValue = {
      settings: { provider: '', model: '', temperature: 0.2, maxOutputTokens: 1200, maxEvidenceChars: 12000, timeoutMs: 60000 },
      resolvedProvider: 'fixture', resolvedModel: 'fixture-model', writable: true, options: [],
    }
    const { view } = await batchView({ ask, modelSettings: modelSettings ?? vi.fn().mockResolvedValue(settings),
      list: vi.fn().mockResolvedValue([base, { ...base, alias: 'other', id: 'kb-2', name: 'Other' }]),
      semanticIndexStatus: vi.fn().mockResolvedValue({ configuredMode: 'lexical', state: 'disabled', model: null,
        modelRevision: null, dimensions: null, minimumScore: null, sourceRevision: 1, indexRevision: null,
        sourceChunkCount: 2, indexedChunkCount: 0, coverage: 0, builtAt: null }),
    })
    fireEvent.click(view.getByRole('button', { name: zh.qa }))
    fireEvent.change(view.getByLabelText(zh.question), { target: { value: '你好' } })
    fireEvent.click(view.getByRole('button', { name: zh.ask }))
    await view.findByText('正在综合文献')
    return { view, ask, answer, finish, fail, pending, settings, signal: ask.mock.calls[0]![4], onFrame: ask.mock.calls[0]![3] }
  }

  it('commits successful summaries without resending old turns, rejects failed memory and isolates libraries', async () => {
    let count = 0
    const ask = vi.fn<ComponentProps<typeof KnowledgeBaseCenter>['ask']>(async (_ref, question) => {
      count++
      return { status: count === 3 ? 'failed' : 'answered', requestedMode: 'model', mode: count === 3 ? 'model-failed' : 'model-general',
        question, answer: `回答${count}`, confidence: 'none', citations: [], generation: null,
        conversation: { summary: count === 2 ? '已压缩问题一' : count === 3 ? '失败摘要' : '',
          compactedTurns: count === 2 || count === 3 ? 1 : 0, historyTurns: count - 1,
          query: question, outputTokens: 32000, contextWindow: 262144, calls: count === 1 ? 0 : 1, totalTokens: 20 } }
    })
    const { view } = await batchView({ ask,
      list: vi.fn().mockResolvedValue([base, { ...base, alias: 'other', id: 'kb-2', name: 'Other' }]),
    })
    fireEvent.click(view.getByRole('button', { name: zh.qa }))
    for (const question of ['问题一', '继续二', '继续三', '继续四']) {
      fireEvent.change(view.getByLabelText(zh.question), { target: { value: question } })
      fireEvent.click(view.getByRole('button', { name: zh.ask }))
      await waitFor(() => { expect((view.getByRole('button', { name: zh.ask }) as HTMLButtonElement).disabled).toBe(false) })
    }
    expect(ask.mock.calls[1]![5]).toEqual({ summary: '', turns: [{ question: '问题一', answer: '回答1' }] })
    expect(ask.mock.calls[2]![5]).toEqual({ summary: '已压缩问题一', turns: [{ question: '继续二', answer: '回答2' }] })
    expect(ask.mock.calls[3]![5]).toEqual({ summary: '已压缩问题一', turns: [
      { question: '继续二', answer: '回答2' }, { question: '继续三', answer: '' },
    ] })
    fireEvent.change(view.getByLabelText(zh.switchKnowledgeBase), { target: { value: 'other' } })
    await waitFor(() => { expect(view.queryByText('问题一')).toBeNull() })
    fireEvent.click(view.getByRole('button', { name: zh.qa }))
    fireEvent.change(view.getByLabelText(zh.question), { target: { value: '新问题' } })
    fireEvent.click(view.getByRole('button', { name: zh.ask }))
    await waitFor(() => { expect(ask).toHaveBeenCalledTimes(5) })
    expect(ask.mock.calls[4]![5]).toEqual({ summary: '', turns: [] })
  })

  it('excludes a cancelled draft and ignores its late summary on the next follow-up', async () => {
    const { view, ask, answer, finish } = await streamingView()
    fireEvent.click(view.getByRole('button', { name: zh.cancelGeneration }))
    await act(async () => { finish({ ...answer, conversation: { summary: '迟到的摘要', compactedTurns: 1,
      historyTurns: 1, query: '继续', outputTokens: 32000, contextWindow: null, calls: 1, totalTokens: 20 } }) })
    ask.mockResolvedValue(answer)
    fireEvent.change(view.getByLabelText(zh.question), { target: { value: '继续' } })
    fireEvent.click(view.getByRole('button', { name: zh.ask }))
    await waitFor(() => { expect(ask).toHaveBeenCalledTimes(2) })
    expect(ask.mock.calls[1]![5]).toEqual({ summary: '', turns: [{ question: '你好', answer: '' }] })
  })

  it.each(['complete', 'failed'] as const)('keeps the stream alive across settings and returns its %s result to the original question', async (outcome) => {
    const { view, ask, answer, finish, fail, signal, onFrame } = await streamingView()
    fireEvent.click(view.getByRole('button', { name: zh.settings }))
    await view.findByText(zh.generationSettings)
    await waitFor(() => { expect((view.getByRole('button', { name: zh.saveModelSettings }) as HTMLButtonElement).disabled).toBe(false) })
    expect(signal.aborted).toBe(false)
    expect(view.getByText(zh.answerInBackground).textContent).toMatchInlineSnapshot('"问答仍在生成中，切换标签页不会中止回答。"')
    act(() => { onFrame({ type: 'delta', text: '，继续生成中文内容。' }) })
    fireEvent.click(view.getByRole('button', { name: zh.returnToAnswer }))
    expect(view.getByText('正在综合文献，继续生成中文内容。')).toBeTruthy()
    expect(view.getByRole('button', { name: zh.cancelGeneration })).toBeTruthy()
    fireEvent.submit(view.getByLabelText(zh.question).closest('form')!)
    expect(ask).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByRole('button', { name: zh.settings }))
    await act(async () => { if (outcome === 'complete') finish(answer); else fail(new Error('Model unavailable')) })
    expect(view.queryByText(zh.answerInBackground)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh.qa }))
    expect(view.getByText('你好')).toBeTruthy()
    if (outcome === 'complete') expect(view.getByText(answer.answer)).toBeTruthy()
    else expect(view.getByRole('alert').textContent).toContain('Model unavailable')
    expect(view.getByRole('button', { name: zh.ask })).toBeTruthy()
    expect(signal.aborted).toBe(false)
  })

  it('does not release a pending settings load when the background answer completes', async () => {
    let load!: (settings: KnowledgeModelSettingsValue) => void
    const loading = new Promise<KnowledgeModelSettingsValue>((resolve) => { load = resolve })
    const { view, answer, finish, settings } = await streamingView(vi.fn(() => loading))
    fireEvent.click(view.getByRole('button', { name: zh.settings }))
    await act(async () => { finish(answer) })
    expect((view.getByRole('button', { name: zh.downloadBackup }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { load(settings); await loading })
    expect((view.getByRole('button', { name: zh.downloadBackup }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each(['stop', 'switch-base', 'unmount'] as const)('still cancels on %s and ignores late output from settings', async (operation) => {
    const { view, answer, finish, signal, onFrame } = await streamingView()
    fireEvent.click(view.getByRole('button', { name: zh.settings }))
    await view.findByText(zh.generationSettings)
    if (operation === 'stop') fireEvent.click(view.getByRole('button', { name: zh.cancelGeneration }))
    else if (operation === 'switch-base') fireEvent.change(view.getByLabelText(zh.switchKnowledgeBase), { target: { value: 'other' } })
    else view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { onFrame({ type: 'delta', text: 'Late output' }); finish(answer) })
    if (operation !== 'unmount') {
      fireEvent.click(view.getByRole('button', { name: zh.qa }))
      expect(view.queryByText(answer.answer)).toBeNull()
      expect(view.queryByText('Late output')).toBeNull()
      if (operation === 'stop') expect(view.getByText(`${zh.generationStopped} · ${zh.unverifiedDraft}`)).toBeTruthy()
      else expect(view.queryByText('你好')).toBeNull()
    }
  })

  it('reloads an empty graph after a PDF import and displays the current nodes', async () => {
    let imported = false
    const graph = vi.fn(async (): Promise<KnowledgeGraphValue> => imported ? {
      revision: 1, totalNodes: 2, totalEdges: 1, truncated: false,
      nodes: [
        { id: 'page:paper', type: 'page', label: 'Paper', documentId: 'paper', startLine: 1, degree: 1 },
        { id: 'source:paper', type: 'source', label: 'Paper.pdf', documentId: 'paper', startLine: 1, degree: 1 },
      ],
      edges: [{ id: 'edge:0', source: 'page:paper', target: 'source:paper', relation: 'has-source', label: 'has source', weight: 1 }],
    } : { revision: 0, totalNodes: 0, totalEdges: 0, truncated: false, nodes: [], edges: [] })
    const props = {
      pageId: 'knowledge-base', close: vi.fn(),
      list: vi.fn(async () => [{ ...base, revision: imported ? 1 : 0, documentCount: imported ? 1 : 0 }]),
      documents: vi.fn(async () => imported ? [document] : []), graph,
      importFile: vi.fn(async () => { imported = true; return { document, knowledgeBase: base, duplicate: false } }),
      documentDetail: vi.fn(async () => ({ document, preview: 'Paper evidence.', stages: [], reprocessable: true })),
      t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    fireEvent.click(view.getByRole('button', { name: 'Graph' }))
    expect(await view.findByText('No graph data.')).toBeTruthy()
    await waitFor(() => { expect(view.queryByRole('progressbar')).toBeNull() })
    fireEvent.click(view.getByRole('button', { name: 'Documents' }))
    const fileInput = view.getByLabelText('Source file')
    Object.defineProperty(fileInput, 'files', { value: [new File(['PDF'], 'Paper.pdf', { type: 'application/pdf' })] })
    fireEvent.submit(fileInput.closest('form')!)
    expect(await view.findByText('Paper evidence.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Graph' }))
    await waitFor(() => { expect(graph).toHaveBeenCalledTimes(2) })
    const network = await view.findByRole('img', { name: 'Knowledge graph' })
    expect(network.querySelectorAll('circle')).toHaveLength(2)
    expect(network.querySelectorAll('line')).toHaveLength(1)
    fireEvent.change(view.getByLabelText('Find node'), { target: { value: 'absent' } })
    expect(view.getByText('No matching nodes')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Reset view' }))
    expect(view.getByRole('img', { name: 'Knowledge graph' })).toBeTruthy()
  })

  it('retains successive questions, partial failures and citations in conversation order', async () => {
    const ask = vi.fn(async (_ref: string, question: string): Promise<KnowledgeAnswerView> => {
      if (question === 'failure') throw new Error('Connection lost')
      return {
        status: 'answered', requestedMode: 'local', mode: 'local-extractive', question,
        answer: `Answer for ${question}.`, confidence: 'low', generation: null, citations: [],
      }
    })
    const props = {
      pageId: 'knowledge-base', close: vi.fn(), list: vi.fn(async () => [base]),
      documents: vi.fn(async () => [document]), ask, t: (key: keyof typeof en) => en[key],
    } as unknown as ComponentProps<typeof KnowledgeBaseCenter>
    const view = render(<KnowledgeBaseCenter {...compilerActions} {...props} />)
    fireEvent.click(await view.findByText('Legal'))
    fireEvent.click(view.getByRole('button', { name: 'Q&A' }))
    for (const question of ['notice', 'deadline', 'failure']) {
      fireEvent.change(view.getByLabelText('Question'), { target: { value: question } })
      fireEvent.click(view.getByRole('button', { name: 'Ask' }))
      await waitFor(() => { expect(view.getByRole('button', { name: 'Ask' })).toBeTruthy() })
    }
    const transcript = view.getByRole('log', { name: 'Knowledge conversation' })
    expect(transcript.textContent).toMatch(/notice.*Answer for notice.*deadline.*Answer for deadline.*failure.*Connection lost/u)
    expect((view.getByLabelText('Question') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(view.getByRole('button', { name: 'Overview' }))
    fireEvent.click(view.getByRole('button', { name: 'Q&A' }))
    expect(view.getByText('Answer for notice.')).toBeTruthy()
    expect(view.getByText('Answer for deadline.')).toBeTruthy()
    const input = view.getByLabelText('Question')
    fireEvent.change(input, { target: { value: 'keyboard' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(ask).toHaveBeenCalledTimes(3)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await view.findByText('Answer for keyboard.')).toBeTruthy()
  })
})
