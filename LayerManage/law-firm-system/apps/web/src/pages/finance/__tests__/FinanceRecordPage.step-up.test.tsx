import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { authApi } from '@/api/auth';
import { refundApi } from '@/api/refund';
import { useAuthStore } from '@/stores/authStore';
import { MemoryRouter, Routes, Route } from 'react-router';
import FinanceRecordPage from '../FinanceRecordPage';
vi.mock('@/features/crm/BusinessWorkspacePage', () => ({ BusinessTableLinks: () => null }));

vi.mock('@/api/auth', () => ({ authApi: { stepUp: vi.fn(), mfaStatus: vi.fn(), sessions: vi.fn() } }));
vi.mock('@/api/refund', () => ({
  refundApi: {
    create: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    execute: vi.fn(),
  },
  REFUND_STATUSES: ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'],
  REFUND_TYPES: ['REFUND', 'WAIVER'],
}));

const pendingRefund = {
  id: 'rf-1',
  requestNo: 'RF000001-ABC123',
  type: 'REFUND' as const,
  contractId: 'c-1',
  customerId: 'cu-1',
  paymentId: 'p-1',
  planId: null,
  amount: '1000.00',
  reason: 'StepUp 测试申请',
  status: 'PENDING' as const,
  approvedBy: null,
  approvedAt: null,
  approvalComment: null,
  executedBy: null,
  executedAt: null,
  createdBy: 'u1',
  updatedBy: null,
  version: 1,
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
};

function setPermissions(permissions: string[]): void {
  useAuthStore.setState({
    authorization: {
      userId: 'u1',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions,
      menus: [],
      fieldCapabilities: {},
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.mfaStatus).mockResolvedValue({data:{enabled:true}} as never);
  vi.mocked(authApi.sessions).mockResolvedValue({data:[{current:true,assuranceLevel:'MFA'}]} as never);
  vi.mocked(refundApi.detail).mockResolvedValue({ code: 200, message: 'OK', data: pendingRefund });
  setPermissions(['refund.read', 'refund.create', 'refund.approve', 'refund.execute']);
  vi.mocked(refundApi.list).mockResolvedValue({
    code: 200,
    message: 'OK',
    data: { list: [pendingRefund], page: 1, pageSize: 10, total: 1 },
  } as never);
  vi.mocked(refundApi.approve).mockResolvedValue({
    code: 200,
    message: 'OK',
    data: { ...pendingRefund, status: 'APPROVED', version: 2 },
  } as never);
  vi.mocked(authApi.stepUp).mockResolvedValue({
    code: 200,
    message: 'OK',
    data: { stepUpToken: 'fresh-one-time-grant', expiresIn: 300 },
  } as never);
});


async function openApproveDialog() {
  render(<MemoryRouter initialEntries={['/refunds/rf-1']}><Routes><Route path="/refunds/:id" element={<FinanceRecordPage kind="refund" />} /></Routes></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'审批通过'}));
}
test('refund approval confirms under the existing session without MFA, including accounts without an authenticator',async()=>{
  vi.mocked(authApi.mfaStatus).mockResolvedValue({data:{enabled:false}} as never);
  await openApproveDialog();
  expect(refundApi.approve).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button',{name:'确认办理'}));
  await waitFor(()=>expect(refundApi.approve).toHaveBeenCalledWith('rf-1',expect.objectContaining({expectedVersion:1})));
  expect(authApi.stepUp).not.toHaveBeenCalled();
  expect(authApi.mfaStatus).not.toHaveBeenCalled();
  expect(screen.queryByText('再次验证身份')).not.toBeInTheDocument();
});
test('closing approval confirmation leaves the pending refund unchanged',async()=>{
  await openApproveDialog();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  expect(refundApi.approve).not.toHaveBeenCalled();
});
test('a role without approval permission has no approval button',async()=>{
  setPermissions(['refund.read']);
  render(<MemoryRouter initialEntries={['/refunds/rf-1']}><Routes><Route path="/refunds/:id" element={<FinanceRecordPage kind="refund" />} /></Routes></MemoryRouter>);
  await screen.findByText('RF000001-ABC123');
  expect(screen.queryByRole('button',{name:'审批通过'})).not.toBeInTheDocument();
});
