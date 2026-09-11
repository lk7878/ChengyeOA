// SPEC-014 Task 3: 审批动作静默 catch UX——三动作（apply/process/withdraw）失败时
// message.error 内联反馈 + 返回 false（保持既有调用方契约「if (!ok) return」）。
// 沿 cost-store.test.ts 形态：mock approvalApi + store reset + antd message 双 spy。
import { beforeEach, expect, test, vi } from 'vitest';
import { message } from 'antd';
import { useApprovalStore } from './approval-store';

const approvalApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  definitions: vi.fn(),
  detail: vi.fn(),
  apply: vi.fn(),
  withdraw: vi.fn(),
  process: vi.fn(),
}));
vi.mock('@/api/approval', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/approval')>();
  return { ...original, approvalApi: approvalApiMock };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(message, 'error').mockImplementation(() => undefined as never);
  vi.spyOn(message, 'success').mockImplementation(() => undefined as never);
  useApprovalStore.getState().reset();
});

test('applyApproval failure shows message.error with the business message and returns false', async () => {
  approvalApiMock.apply.mockRejectedValue({ response: { data: { message: 'APPROVAL_DEFINITION_INACTIVE' } } });

  const ok = await useApprovalStore.getState().applyApproval({
    definitionCode: 'SEAL',
    title: '用印申请',
    content: { sealType: '公章', docCount: 1 },
  });

  expect(ok).toBe(false);
  expect(message.error).toHaveBeenCalledWith('APPROVAL_DEFINITION_INACTIVE');
});

test('applyApproval failure without a response message falls back to 操作失败 and returns false', async () => {
  approvalApiMock.apply.mockRejectedValue(new Error('网络错误'));

  const ok = await useApprovalStore.getState().applyApproval({
    definitionCode: 'SEAL',
    title: '用印申请',
    content: {},
  });

  expect(ok).toBe(false);
  expect(message.error).toHaveBeenCalledWith('操作失败');
});

test('processApproval failure shows message.error and returns false', async () => {
  approvalApiMock.process.mockRejectedValue({ response: { data: { message: 'APPROVAL_STATE_INVALID' } } });

  const ok = await useApprovalStore.getState().processApproval('task-1', { action: 'APPROVE' });

  expect(ok).toBe(false);
  expect(message.error).toHaveBeenCalledWith('APPROVAL_STATE_INVALID');
});

test('withdrawApproval failure shows message.error and returns false', async () => {
  approvalApiMock.withdraw.mockRejectedValue({ response: { data: { message: 'APPROVAL_STATE_INVALID' } } });

  const ok = await useApprovalStore.getState().withdrawApproval('ap-1', { reason: '主动撤回' });

  expect(ok).toBe(false);
  expect(message.error).toHaveBeenCalledWith('APPROVAL_STATE_INVALID');
});

test('applyApproval success returns true without a message.error', async () => {
  approvalApiMock.apply.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { id: 'ap-new' },
  });

  const ok = await useApprovalStore.getState().applyApproval({
    definitionCode: 'SEAL',
    title: '用印申请',
    content: {},
  });

  expect(ok).toBe(true);
  expect(message.error).not.toHaveBeenCalled();
});
