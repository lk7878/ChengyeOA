import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { governanceApi } from '@/features/admin-governance/api';
import { useAuthStore } from '@/stores/authStore';
import AdminGovernancePage from './index';

const runStepUp = vi.hoisted(() => vi.fn());
vi.mock('@/features/auth/useStepUp', () => ({
  useStepUp: () => ({
    run: runStepUp,
    dialogProps: { open: false, purpose: 'SESSION_REVOKE', impact: '', loading: false, onCancel: vi.fn(), onVerify: vi.fn() },
  }),
}));
vi.mock('@/features/auth/components/StepUpDialog', () => ({ default: () => null }));
vi.mock('@/features/admin-governance/api', () => ({
  governanceApi: {
    catalog: vi.fn(), userTargets: vi.fn(), list: vi.fn(), detail: vi.fn(), create: vi.fn(),
    review: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
  },
  governanceErrorMessage: (code: string) => code,
}));
vi.mock('@/features/admin-governance/components/OperationCreateDrawer', () => ({
  default: ({ open, onSubmit }: { open: boolean; onSubmit: (input: Record<string, unknown>) => Promise<void> }) => open ? <div>
    <button onClick={() => void onSubmit({ operationType: 'SYSTEM_ADMIN_GRANT', targetType: 'USER', targetId: 'u2', reason: 'high risk reason', expectedTargetVersion: 3, payload: { validUntil: null }, idempotencyKey: 'high-key' })}>提交高风险申请</button>
    {(['SOP_TEMPLATE_PUBLISH', 'SOP_TEMPLATE_DISABLE', 'SYSTEM_ADMIN_GRANT', 'SYSTEM_ADMIN_REVOKE', 'SYSTEM_ADMIN_ACCOUNT_DISABLE', 'SUPER_ADMIN_GRANT', 'SUPER_ADMIN_REVOKE', 'SUPER_ADMIN_ACCOUNT_DISABLE', 'ADMIN_MFA_RESET', 'MASTER_DATA_STATUS_CORRECTION'] as const).map(operationType => <button key={operationType}
      onClick={() => void onSubmit({ operationType, targetType: 'USER', targetId: 'u2', reason: 'critical confirmed operation', expectedTargetVersion: 3,
        payload: operationType === 'SUPER_ADMIN_GRANT' ? { validUntil: null } : {}, idempotencyKey: operationType, confirmation: 'exact phrase' })}>{operationType}</button>)}
    <button onClick={() => void onSubmit({ operationType: 'MASTER_DATA_METADATA_CORRECTION', targetType: 'POSITION', targetId: 'p1', reason: 'medium risk reason', expectedTargetVersion: 4, payload: { responsibilities: 'new' }, idempotencyKey: 'medium-key' })}>提交中风险申请</button>
  </div> : null,
}));
vi.mock('@/features/admin-governance/components/ReviewDialog', () => ({
  default: ({ operation, onSubmit }: { operation: unknown; onSubmit: (decision: 'APPROVE') => Promise<void> }) => operation
    ? <button onClick={() => void onSubmit('APPROVE')}>确认批准</button> : null,
}));
vi.mock('@/features/admin-governance/components/OperationDetailDrawer', () => ({ default: () => null }));

const highOperation = {
  id: 'op-high', operationNo: 'GOV-HIGH', operationType: 'SYSTEM_ADMIN_GRANT', riskLevel: 'HIGH',
  reviewMode: 'PRE', status: 'PENDING_REVIEW', requesterUserId: 'other', targetType: 'USER', targetId: 'u2',
  reason: 'reason', expectedTargetVersion: 3, secondConfirmationAt: null, relatedOperationId: null, version: 2,
  createdAt: '2026-07-21T08:00:00.000Z', updatedAt: '2026-07-21T08:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  runStepUp.mockImplementation(async request => request.mutate('one-time-grant'));
  vi.mocked(governanceApi.catalog).mockResolvedValue({ code: 200, message: 'OK', data: [
    { operationType: 'SYSTEM_ADMIN_GRANT', riskLevel: 'HIGH', reviewMode: 'PRE', requesterRoles: ['SYSTEM_SUPER_ADMIN'], adapterKey: 'administrator-account', retryable: true },
    ...(['SOP_TEMPLATE_PUBLISH', 'SOP_TEMPLATE_DISABLE', 'SYSTEM_ADMIN_GRANT', 'SYSTEM_ADMIN_REVOKE', 'SYSTEM_ADMIN_ACCOUNT_DISABLE', 'SUPER_ADMIN_GRANT', 'SUPER_ADMIN_REVOKE', 'SUPER_ADMIN_ACCOUNT_DISABLE', 'ADMIN_MFA_RESET', 'MASTER_DATA_STATUS_CORRECTION'] as const).map(operationType => ({ operationType, riskLevel: 'CRITICAL', reviewMode: 'PRE', requesterRoles: ['SYSTEM_SUPER_ADMIN'], adapterKey: 'administrator-account', retryable: true })),
    { operationType: 'MASTER_DATA_METADATA_CORRECTION', riskLevel: 'MEDIUM', reviewMode: 'PRE', requesterRoles: ['SYSTEM_SUPER_ADMIN'], adapterKey: 'master-data', retryable: true },
  ] } as never);
  vi.mocked(governanceApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
    list: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  } } as never);
  vi.mocked(governanceApi.create).mockResolvedValue({ code: 200, message: 'OK', data: { ...highOperation } } as never);
  vi.mocked(governanceApi.review).mockResolvedValue({ code: 200, message: 'OK', data: { ...highOperation } } as never);
  vi.mocked(governanceApi.retry).mockResolvedValue({ code: 200, message: 'OK', data: { ...highOperation } } as never);
  useAuthStore.setState({ authorization: {
    userId: 'self', employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false,
    permissions: ['governance.catalog.read', 'governance.operation.create', 'governance.operation.read_all', 'governance.review', 'governance.retry'],
    menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString(),
  } as never });
});

for (const operationType of ['SOP_TEMPLATE_PUBLISH', 'SOP_TEMPLATE_DISABLE', 'SYSTEM_ADMIN_GRANT', 'SYSTEM_ADMIN_REVOKE', 'SYSTEM_ADMIN_ACCOUNT_DISABLE', 'SUPER_ADMIN_GRANT', 'SUPER_ADMIN_REVOKE', 'SUPER_ADMIN_ACCOUNT_DISABLE', 'ADMIN_MFA_RESET', 'MASTER_DATA_STATUS_CORRECTION'] as const) {
  test(`${operationType} submits, approves and retries directly without opening authenticator`, async () => {
    vi.mocked(governanceApi.list).mockResolvedValue({ code: 200, message: 'OK', data: {
      list: [{ ...highOperation, operationType, riskLevel: 'CRITICAL' },
        { ...highOperation, operationType, riskLevel: 'CRITICAL', id: 'op-failed', operationNo: 'GOV-FAILED', status: 'FAILED', version: 5 }],
      pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    } } as never);
    render(<AdminGovernancePage />);
    fireEvent.click(await screen.findByRole('button', { name: '新建治理申请' }));
    fireEvent.click(screen.getByRole('button', { name: operationType }));
    await waitFor(() => expect(governanceApi.create).toHaveBeenCalledWith(expect.objectContaining({ operationType, confirmation: 'exact phrase' })));
    fireEvent.click(await screen.findByRole('button', { name: '审核 GOV-HIGH' }));
    fireEvent.click(screen.getByRole('button', { name: '确认批准' }));
    await waitFor(() => expect(governanceApi.review).toHaveBeenCalledWith('op-high', expect.objectContaining({ decision: 'APPROVE' })));
    fireEvent.click(screen.getByRole('button', { name: '重试 GOV-FAILED' }));
    fireEvent.click(await screen.findByRole('button', { name: /继\s*续/ }));
    await waitFor(() => expect(governanceApi.retry).toHaveBeenCalledWith('op-failed', { expectedOperationVersion: 5 }));
    expect(runStepUp).not.toHaveBeenCalled();
  });
}
