import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import MainLayout from '@/components/Layout';
import { useAuthStore } from '@/stores/authStore';
import type { AuthorizationSummary } from '@/features/authorization/types';
import VisualApprovals from './VisualApprovals';
import { get } from './api';
import { ApprovalRedirect } from '../ApprovalEntry';
import { integrationApi } from '@/api/business-integration';

vi.mock('./api', async (original) => ({ ...(await original<object>()), get: vi.fn() }));
vi.mock('@/api/business-integration', () => ({ integrationApi: { payrollDetail: vi.fn() } }));
const authorization: AuthorizationSummary = {
  userId: 'route-test',
  employeeId: null,
  isSystemSuperAdmin: false,
  isSystemAdmin: false,
  permissions: ['approval.read'],
  menus: [],
  fieldCapabilities: {},
  validUntil: null,
  evaluatedAt: new Date().toISOString(),
};
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    isAuthenticated: false,
    userInfo: null,
    authorization: { ...authorization },
    authorizationStatus: 'ready',
  });
  vi.mocked(get).mockImplementation(async (path) => {
    if (path === '/workflows/options') return { users: [], roles: [], ownRoles: [], hooks: [] };
    if (path.includes('/definitions')) return [];
    if (path === '/workflows/stats') return { counts: [], nodes: [], overdue: 0, syncFailures: 0 };
    return { rows: [], total: 0 };
  });
});
function Location() {
  const location = useLocation();
  return <output aria-label="当前地址">{location.pathname + location.search}</output>;
}
function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MainLayout>
        <Routes>
          <Route path="/approvals" element={<VisualApprovals />} />
          <Route path="/approvals/visual" element={<ApprovalRedirect />} />
          <Route path="/approval-ledger" element={<ApprovalRedirect monitor />} />
        </Routes>
        <Location />
      </MainLayout>
    </MemoryRouter>,
  );
}

test.each([
  '/approvals',
  '/approvals/visual',
  '/approvals/visual?table=business-table&record=business-record',
])(
  'authorized direct entry %s renders the actual workflow page through the application shell',
  async (path) => {
    show(path);
    expect(await screen.findByRole('heading', { name: '审批中心' })).toBeInTheDocument();
    expect(screen.queryByText('页面不存在')).not.toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: '待我审批' })).toBeInTheDocument();
    const directory = within(screen.getByRole('navigation', { name: '当前区域目录' }));
    expect(directory.getByRole('link', { name: '审批中心' })).toHaveAttribute('aria-current', 'page');
    expect(get).toHaveBeenCalledWith('/workflows/options');
    expect(screen.getByLabelText('当前地址')).toHaveTextContent(
      path.replace('/approvals/visual', '/approvals'),
    );
    expect(directory.queryByRole('link', { name: '审批台账' })).not.toBeInTheDocument();
    expect(directory.queryByRole('link', { name: '审批运行监控' })).not.toBeInTheDocument();
  },
);
test('status bookmarks and tab changes query only the visual engine and preserve business context', async () => {
  show('/approvals/visual?role=APPLIED&table=t&record=r');
  expect(await screen.findByRole('tab', { name: '我发起的' })).toHaveAttribute('aria-selected', 'true');
  expect(get).toHaveBeenCalledWith(expect.stringContaining('/workflows/instances?role=APPLIED'));
  fireEvent.click(screen.getByRole('tab', { name: '抄送我的' }));
  expect(screen.getByLabelText('当前地址')).toHaveTextContent('/approvals?role=CC&table=t&record=r');
  expect(get).toHaveBeenCalledWith(expect.stringContaining('/workflows/instances?role=CC'));
  expect(vi.mocked(get).mock.calls.every(([path]) => path.startsWith('/workflows/'))).toBe(true);
});
test('legacy ledger opens visual monitoring for managers; design opens the custom designer', async () => {
  useAuthStore.setState({
    authorization: { ...authorization, permissions: ['approval.read', 'approval.manage', 'approval.apply'] },
  });
  show('/approval-ledger');
  expect(await screen.findByRole('tab', { name: '运行监控' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText('待处理回写异常')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/workflows/stats');
  expect(screen.getByRole('button', { name: '新建申请' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '流程设计' }));
  fireEvent.click(await screen.findByRole('button', { name: '新建自定义流程' }));
  expect(await screen.findByRole('tab', { name: '2 · 表单设计' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '3 · 流程设计' })).toBeInTheDocument();
});
test('readers cannot enter monitoring or design through query parameters', async () => {
  show('/approval-ledger');
  expect(await screen.findByRole('tab', { name: '待我审批' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('tab', { name: '运行监控' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '流程设计' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '新建申请' })).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalledWith('/workflows/stats');
});
test('missing approval.read still denies the workflow page before loading data', () => {
  useAuthStore.setState({ authorization: { ...authorization, permissions: [] } });
  show('/approvals/visual');
  expect(screen.getByText('无权访问此页面')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '审批中心' })).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
});

test('payroll opens the same visual application form with a frozen-material explanation and clears its context on cancel', async () => {
  useAuthStore.setState({
    authorization: { ...authorization, permissions: ['approval.read', 'approval.apply'] },
  });
  vi.mocked(integrationApi.payrollDetail).mockResolvedValue({
    data: {
      id: 'payroll-1',
      title: '十月工资',
      period: '2026-10',
      version: 1,
      attachmentId: 'file-1',
      attachment: { id: 'file-1', fileName: '工资.xlsx' },
      instance: null,
    },
  } as Awaited<ReturnType<typeof integrationApi.payrollDetail>>);
  show('/approvals?payroll=payroll-1');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('工资审批：十月工资')).toBeInTheDocument();
  expect(within(dialog).getByText(/审批通过表示待发放，不代表已经支付/)).toBeInTheDocument();
  expect(within(dialog).getByDisplayValue('十月工资')).toBeInTheDocument();
  expect(integrationApi.payrollDetail).toHaveBeenCalledWith('payroll-1');
  fireEvent.click(within(dialog).getByRole('button', { name: /cancel|取消/i }));
  expect(screen.getByLabelText('当前地址')).toHaveTextContent(/^\/approvals$/);
});
