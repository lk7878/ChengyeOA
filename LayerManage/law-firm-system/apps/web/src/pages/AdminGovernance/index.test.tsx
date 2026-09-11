import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { governanceApi } from '@/features/admin-governance/api';
import { confirmationPhrase, metadataFieldForTarget } from '@/features/admin-governance/form-rules';
import { masterDataApi } from '@/features/master-data/api';
import { useAuthStore } from '@/stores/authStore';
import AdminGovernancePage from './index';

vi.mock('@/features/admin-governance/api', () => ({
  governanceApi: {
    catalog: vi.fn(), userTargets: vi.fn(), list: vi.fn(), detail: vi.fn(), create: vi.fn(), review: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
  },
  governanceErrorMessage: vi.fn(() => '治理请求失败'),
}));
vi.mock('@/features/master-data/api', () => ({ masterDataApi: {
  organizations: { options: vi.fn() }, positions: { list: vi.fn() }, professionalTeams: { list: vi.fn() },
} }));

const catalog = [
  { operationType: 'SYSTEM_ADMIN_GRANT', riskLevel: 'HIGH', reviewMode: 'PRE', requesterRoles: ['SYSTEM_ADMIN'], adapterKey: 'administrator-account', retryable: true },
  { operationType: 'MASTER_DATA_METADATA_CORRECTION', riskLevel: 'MEDIUM', reviewMode: 'PRE', requesterRoles: ['SYSTEM_ADMIN'], adapterKey: 'master-data', retryable: true },
] as const;

const operation = (overrides: Record<string, unknown> = {}) => ({
  id: 'op-1', operationNo: 'GOV-20260721-0001', operationType: 'SYSTEM_ADMIN_GRANT', riskLevel: 'HIGH',
  reviewMode: 'PRE', status: 'PENDING_REVIEW', requesterUserId: 'other-user', targetType: 'USER',
  targetId: 'target-user', reason: '因业务需要进行管理员治理操作', expectedTargetVersion: 1,
  secondConfirmationAt: null, relatedOperationId: null, version: 2,
  createdAt: '2026-07-21T08:00:00.000Z', updatedAt: '2026-07-21T08:01:00.000Z', ...overrides,
});

const page = (list: ReturnType<typeof operation>[]) => ({
  code: 0, message: 'OK', data: { list, pagination: { page: 1, pageSize: 20, total: list.length, totalPages: list.length ? 1 : 0 } },
});

function setAuthorization(isSuper: boolean, permissions: string[]) {
  useAuthStore.setState({ authorization: {
    userId: 'self-user', employeeId: null, isSystemSuperAdmin: isSuper, isSystemAdmin: !isSuper,
    permissions, menus: ['menu.admin_governance'], fieldCapabilities: {}, validUntil: null,
    evaluatedAt: new Date().toISOString(),
  } as never });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(governanceApi.catalog).mockResolvedValue({ code: 0, message: 'OK', data: [...catalog] } as never);
  vi.mocked(governanceApi.userTargets).mockResolvedValue({ code: 0, message: 'OK', data: [{ id: 'target-user', username: 'target', displayName: '目标用户', status: 'ENABLED', governanceVersion: 3 }] } as never);
  vi.mocked(governanceApi.list).mockResolvedValue(page([]) as never);
  vi.mocked(masterDataApi.organizations.options).mockResolvedValue({ code: 0, message: 'OK', data: [] });
  vi.mocked(masterDataApi.positions.list).mockResolvedValue({ code: 0, message: 'OK', data: [] });
  vi.mocked(masterDataApi.professionalTeams.list).mockResolvedValue({ code: 0, message: 'OK', data: { list: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } } });
});

test('system administrator sees only own applications and can open catalog-driven creation', async () => {
  setAuthorization(false, ['governance.catalog.read', 'governance.operation.create', 'governance.operation.read_self']);
  render(<AdminGovernancePage />);
  expect(await screen.findByRole('tab', { name: '我的申请' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '待我审核' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '全部记录' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '新建治理申请' }));
  expect(await screen.findByRole('dialog', { name: '新建治理申请', hidden: true })).toBeInTheDocument();
  expect(screen.getByLabelText('治理操作')).toBeInTheDocument();
  expect(screen.getByText('申请理由')).toBeInTheDocument();
});

test('metadata governance has an exact one-field whitelist per target type', () => {
  expect(metadataFieldForTarget('ORGANIZATION')).toEqual({ key: 'sort', label: '排序' });
  expect(metadataFieldForTarget('POSITION')).toEqual({ key: 'responsibilities', label: '岗位职责' });
  expect(metadataFieldForTarget('PROFESSIONAL_TEAM')).toEqual({ key: 'description', label: '团队说明' });
});

test('critical confirmation expands only the target username placeholder', () => {
  expect(confirmationPhrase('CONFIRM chengye_oa_test SUPER_ADMIN_GRANT {targetUsername}', 'target'))
    .toBe('CONFIRM chengye_oa_test SUPER_ADMIN_GRANT target');
});

test('super administrator can review others but never their own operation', async () => {
  setAuthorization(true, ['governance.catalog.read', 'governance.operation.read_all', 'governance.review']);
  vi.mocked(governanceApi.list).mockResolvedValue(page([
    operation(), operation({ id: 'op-self', operationNo: 'GOV-SELF', requesterUserId: 'self-user' }),
  ]) as never);
  render(<AdminGovernancePage />);
  expect(await screen.findByRole('tab', { name: '待我审核' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '全部记录' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: '审核 GOV-20260721-0001' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '审核 GOV-SELF' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '审核 GOV-20260721-0001' }));
  fireEvent.click(await screen.findByRole('radio', { name: '驳回' }));
  fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
  expect(await screen.findByText('驳回或标记异常时请填写至少 10 个字符')).toBeInTheDocument();
  expect(governanceApi.review).not.toHaveBeenCalled();
});

test('shows cancel and retry only for eligible rows and renders immutable detail history', async () => {
  setAuthorization(true, ['governance.catalog.read', 'governance.operation.read_all', 'governance.retry']);
  vi.mocked(governanceApi.list).mockResolvedValue(page([
    operation({ requesterUserId: 'self-user' }),
    operation({ id: 'op-failed', operationNo: 'GOV-FAILED', status: 'FAILED', version: 5 }),
  ]) as never);
  vi.mocked(governanceApi.detail).mockResolvedValue({ code: 0, message: 'OK', data: {
    ...operation(), payloadSnapshot: { roleCode: 'SYSTEM_ADMIN' }, reviews: [], executions: [{
      id: 'run-1', operationId: 'op-1', attemptNo: 1, executorType: 'SYSTEM', status: 'FAILED',
      beforeSnapshot: { enabled: false }, afterSnapshot: null, resultCode: 'STALE_TARGET_VERSION',
      errorMessage: '版本冲突', startedAt: '2026-07-21T08:02:00.000Z', finishedAt: '2026-07-21T08:03:00.000Z',
    }],
  } } as never);
  render(<AdminGovernancePage />);
  expect(await screen.findByRole('button', { name: '撤销 GOV-20260721-0001' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重试 GOV-FAILED' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看 GOV-20260721-0001' }));
  expect(await screen.findByRole('dialog', { name: /治理详情/, hidden: true })).toBeInTheDocument();
  expect(screen.getByText('STALE_TARGET_VERSION')).toBeInTheDocument();
  expect(screen.getByText('版本冲突')).toBeInTheDocument();
});

test('distinguishes empty state from API failure and supports refresh', async () => {
  setAuthorization(false, ['governance.catalog.read', 'governance.operation.read_self']);
  const { unmount } = render(<AdminGovernancePage />);
  expect(await screen.findByText('暂无治理申请')).toBeInTheDocument();
  unmount();
  vi.mocked(governanceApi.list).mockRejectedValueOnce(new Error('offline'));
  render(<AdminGovernancePage />);
  expect(await screen.findByText('治理记录加载失败')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(governanceApi.list).toHaveBeenCalledTimes(3));
});
