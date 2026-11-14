// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CompilerPanel, type CompilerActions } from '../src/client/CompilerPanel.tsx'
import { zh, type KnowledgeLocaleKey } from '../src/client/locales.ts'
import type { KnowledgeCompilationValue } from '../src/types.ts'

afterEach(cleanup)

it('separates completed compilation from human review and saves a local disposition without consent or inference', async () => {
  let state: KnowledgeCompilationValue = { status: 'review', progress: 100, error: null, vision: [], suggestedPages: [], rawAvailable: true,
    publication: { version: 1, sourceHash: 'raw', contentHash: 'text', cacheKey: 'publication', provider: 'fixture', model: 'academic',
      createdAt: '2026-09-07T00:00:00.000Z', title: 'Paper', sections: [], facts: [], visionSources: [], coverage: [],
      gaps: ['Verify equation against original page.'], calls: 2, totalTokens: 300, latencyMs: 100 } }
  const actions: CompilerActions = { compilerSettings: vi.fn(), saveCompilerSettings: vi.fn(), reviewVision: vi.fn(),
    compilation: vi.fn(async () => state), compileDocument: vi.fn(), reviewGap: vi.fn<CompilerActions['reviewGap']>(async (request) => {
      state = { ...state, gapReviews: [{ index: request.index, status: request.status, note: request.note, reviewedAt: '2026-09-07T01:00:00.000Z' }] }
      return state
    }) }
  const view = render(<CompilerPanel actions={actions} source={{ ref: 'paper', documentId: 'doc' }} t={key => zh[key as KnowledgeLocaleKey]} />)
  await waitFor(() => { expect(view.getByRole('status').textContent).toBe('编译完成 · 100%') })
  expect(view.getByText(zh.compilerGapNotice).textContent).toMatchInlineSnapshot('"以下是本版编译时记录的缺口，不代表视觉页当前的核验状态。请对照原文依据后逐项核验。保存仅记录您的结论与备注，不调用模型、不消耗 Token，也不修正原文或编译知识；保留疑问的事项仍计入未解决数量。"')
  view.getByText(zh.compilerGaps).closest('details')!.scrollIntoView = vi.fn()
  fireEvent.click(view.getByRole('button', { name: zh.compilerReviewGo }))
  fireEvent.click(view.getByText('事项 1 · 未核验'))
  const form = view.getByRole('form', { name: '事项 1' })
  fireEvent.change(within(form).getByLabelText(zh.compilerGapDecision), { target: { value: 'verified' } })
  fireEvent.change(within(form).getByLabelText(zh.compilerGapNote), { target: { value: 'Checked against equation on page 2.' } })
  fireEvent.submit(form)
  await waitFor(() => { expect(view.getAllByText('未处理 / 保留疑问: 0 / 1')).toHaveLength(2) })
  expect(actions.reviewGap).toHaveBeenCalledWith({ ref: 'paper', documentId: 'doc', publicationKey: 'publication',
    publicationCreatedAt: '2026-09-07T00:00:00.000Z', index: 0, status: 'verified', note: 'Checked against equation on page 2.' })
  expect(view.getByRole('status').textContent).toBe('编译完成 · 100%')
  expect(actions.compileDocument).not.toHaveBeenCalled()
  vi.mocked(actions.reviewGap).mockRejectedValueOnce(new Error('Publication changed'))
  fireEvent.submit(view.getByRole('form', { name: '事项 1' }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe(zh.compilerGapSaveFailed) })
})

it('polls a reopened running compilation, reports stale progress and recovers without starting another model call', async () => {
  vi.useFakeTimers()
  const initial: KnowledgeCompilationValue = { status: 'running', progress: 0, error: null, publication: null,
    vision: [], suggestedPages: [], rawAvailable: true }
  const actions: CompilerActions = {
    compilerSettings: vi.fn(), saveCompilerSettings: vi.fn(), reviewVision: vi.fn(), reviewGap: vi.fn(), compileDocument: vi.fn(),
    compilation: vi.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce({ ...initial, progress: 16 }).mockResolvedValue({ ...initial, status: 'complete', progress: 100 }),
  }
  const view = render(<CompilerPanel actions={actions} source={{ ref: 'paper', documentId: 'doc' }} t={key => zh[key as KnowledgeLocaleKey]} />)
  try {
    await act(async () => { await Promise.resolve() })
    expect(view.getByRole('status').textContent).toContain('0%')
    expect(view.getByRole('note').textContent).toMatchInlineSnapshot('"进度在每批完成并通过校验后更新。等待模型响应可能持续数分钟，首批期间可保持 0%；该百分比不代表已耗时间。"')
    fireEvent.click(view.getByLabelText(zh.compilerConsent))
    expect((view.getByRole('button', { name: zh.compilerRun }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(view.getByRole('alert').textContent).toBe(zh.compilerProgressUnavailable)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(view.getByRole('status').textContent).toContain('16%')
    expect(view.queryByRole('alert')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(view.getByRole('status').textContent).toContain('100%')
    expect(view.queryByRole('note')).toBeNull()
    const calls = vi.mocked(actions.compilation).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(actions.compilation).toHaveBeenCalledTimes(calls)
    expect(actions.compileDocument).not.toHaveBeenCalled()
  } finally { view.unmount(); vi.useRealTimers() }
})

it('requires explicit document scope, submits only selected visual pages, and cancels the caller request', async () => {
  const initial: KnowledgeCompilationValue = { status: 'uncompiled', progress: 0, error: null, publication: null,
    vision: [], suggestedPages: [2, 5], rawAvailable: true }
  let calledSignal: AbortSignal | undefined
  const actions: CompilerActions = {
    compilerSettings: vi.fn(), saveCompilerSettings: vi.fn(), reviewVision: vi.fn(), reviewGap: vi.fn(),
    compilation: vi.fn().mockResolvedValue(initial),
    compileDocument: vi.fn<CompilerActions['compileDocument']>(async (_request, signal) => {
      calledSignal = signal
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return { ...initial, status: 'cancelled' }
    }),
  }
  const view = render(<CompilerPanel actions={actions} source={{ ref: 'paper', documentId: 'doc' }} t={key => zh[key as KnowledgeLocaleKey]} />)
  expect((view.getByRole('button', { name: zh.compilerRun }) as HTMLButtonElement).disabled).toBe(true)
  expect(actions.compileDocument).not.toHaveBeenCalled()
  expect(view.getByText(zh.compilerRecompileCost)).toBeTruthy()
  await waitFor(() => { expect((view.getByLabelText(zh.compilerPages) as HTMLInputElement).value).toBe('2, 5') })
  fireEvent.click(view.getByLabelText(zh.compilerConsent))
  fireEvent.change(view.getByLabelText(zh.compilerPages), { target: { value: '5' } })
  fireEvent.click(view.getByRole('button', { name: zh.compilerVisionRun }))
  expect(actions.compileDocument).toHaveBeenCalledWith({ ref: 'paper', documentId: 'doc', operation: 'vision', pages: [5], force: false }, expect.any(AbortSignal))
  fireEvent.click(view.getByRole('button', { name: zh.compilerCancel }))
  await waitFor(() => { expect(calledSignal?.aborted).toBe(true) })
})
