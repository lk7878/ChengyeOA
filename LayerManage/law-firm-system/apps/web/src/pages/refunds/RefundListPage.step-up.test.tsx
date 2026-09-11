import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { authApi } from '@/api/auth';
import { refundApi } from '@/api/refund';
import { useAuthStore } from '@/stores/authStore';
import { useRefundStore } from '@/stores/refund-store';
import RefundListPage from './RefundListPage';

vi.mock('@/api/auth', () => ({ authApi: { stepUp: vi.fn() } }));
vi.mock('@/api/refund', () => ({
  refundApi: { create: vi.fn(), list: vi.fn(), detail: vi.fn(), approve: vi.fn(), reject: vi.fn(), execute: vi.fn() },
  REFUND_STATUSES: ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'],
  REFUND_TYPES: ['REFUND', 'WAIVER'],
}));

const pendingRefund = {
  id: 'rf-1', requestNo: 'RF000001-ABC123', type: 'REFUND' as const, contractId: 'c-1', customerId: 'cu-1',
  paymentId: 'p-1', planId: null, amount: '1000.00', reason: 'StepUp 测试申请', status: 'PENDING' as const,
  approvedBy: null, approvedAt: null, approvalComment: null, executedBy: null, executedAt: null,
  createdBy: 'u1', updatedBy: null, version: 1,
  createdAt: '2026-07-01T08:00:00.000Z', updatedAt: '2026-07-01T08:00:00.000Z',
};

function setPermissions(permissions: string[]): void {
  useAuthStore.setState({ authorization: {
    userId: 'u1', employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: false,
    permissions, menus: [], fieldCapabilities: {}, validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  useRefundStore.getState().reset();
  setPermissions(['refund.read', 'refund.create', 'refund.approve', 'refund.execute']);
  vi.mocked(refundApi.list).mockResolvedValue({
    code: 200, message: 'OK', data: { list: [pendingRefund], page: 1, pageSize: 10, total: 1 },
  } as never);
  vi.mocked(refundApi.approve).mockResolvedValue({
    code: 200, message: 'OK', data: { ...pendingRefund, status: 'APPROVED', version: 2 },
  } as never);
  vi.mocked(authApi.stepUp).mockResolvedValue({
    code: 200, message: 'OK', data: { stepUpToken: 'fresh-one-time-grant', expiresIn: 300 },
  } as never);
});

async function openApproveDialog(): Promise<void> {
  render(<RefundListPage />);
  fireEvent.click(await screen.findByRole('button', { name: '审批通过' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认批准' }));
}

test('approve button opens a REFUND_APPROVE step-up challenge before any API call', async () => {
  await openApproveDialog();
  // 挑战对话框出现：真实 StepUpDialog（再次验证身份）。
  expect(await screen.findByText('再次验证身份')).toBeInTheDocument();
  expect(screen.getByLabelText('当前六位验证码')).toBeInTheDocument();
  // 未输码/未验证 → 不调用 stepUp 发证，也不调用审批 API。
  expect(authApi.stepUp).not.toHaveBeenCalled();
  expect(refundApi.approve).not.toHaveBeenCalled();
});

test('entering a code verifies the REFUND_APPROVE target and calls approve with the grant', async () => {
  await openApproveDialog();
  fireEvent.change(await screen.findByLabelText('当前六位验证码'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并继续' }));

  await waitFor(() => expect(refundApi.approve).toHaveBeenCalledOnce());
  expect(authApi.stepUp).toHaveBeenCalledOnce();
  expect(authApi.stepUp).toHaveBeenCalledWith(
    'REFUND_APPROVE',
    { refundRequestId: 'rf-1', expectedVersion: 1 },
    '123456',
  );
  expect(refundApi.approve).toHaveBeenCalledWith(
    'rf-1',
    expect.objectContaining({ expectedVersion: 1 }),
    'fresh-one-time-grant',
  );
});

test('cancelling the step-up challenge does not call approve', async () => {
  await openApproveDialog();
  // StepUpDialog cancelText="取消"（动作 Modal 未设 cancelText → 默认英文 Cancel，无歧义）；
  // AntD 两字按钮自动插空格 → 实际可访问名 "取 消"。
  fireEvent.click(await screen.findByRole('button', { name: /取\s*消/ }));

  await waitFor(() => expect(screen.queryByLabelText('当前六位验证码')).not.toBeInTheDocument());
  expect(authApi.stepUp).not.toHaveBeenCalled();
  expect(refundApi.approve).not.toHaveBeenCalled();
  expect(refundApi.reject).not.toHaveBeenCalled();
});
