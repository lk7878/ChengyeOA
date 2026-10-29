import { fireEvent, render, screen, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import MainLayout from '@/components/Layout';
import { useAuthStore } from '@/stores/authStore';
import type { AuthorizationSummary } from '@/features/authorization/types';
import VisualApprovals from './VisualApprovals';
import { get } from './api';

vi.mock('./api', async (original) => ({ ...(await original<object>()), get: vi.fn() }));
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
  vi.mocked(get).mockImplementation(async (path) =>
    path === '/workflows/options'
      ? { users: [], roles: [], ownRoles: [], hooks: [] }
      : { rows: [], total: 0 },
  );
});
function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MainLayout>
        <Routes>
          <Route path="/approvals" element={<Link to="/approvals/visual">打开可视化审批</Link>} />
          <Route path="/approvals/visual" element={<VisualApprovals />} />
        </Routes>
      </MainLayout>
    </MemoryRouter>,
  );
}

test.each(['/approvals/visual', '/approvals/visual?table=business-table&record=business-record'])(
  'authorized direct entry %s renders the actual workflow page through the application shell',
  async (path) => {
    show(path);
    expect(await screen.findByRole('heading', { name: '可视化审批' })).toBeInTheDocument();
    expect(screen.queryByText('页面不存在')).not.toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: '待我审批' })).toBeInTheDocument();
    const directory = within(screen.getByRole('navigation', { name: '当前区域目录' }));
    expect(directory.getByRole('link', { name: '审批中心' })).toHaveAttribute('aria-current', 'page');
    expect(get).toHaveBeenCalledWith('/workflows/options');
  },
);
test('following the approval-center link passes the same shell guard', async () => {
  show('/approvals');
  fireEvent.click(screen.getByRole('link', { name: '打开可视化审批' }));
  expect(await screen.findByRole('heading', { name: '可视化审批' })).toBeInTheDocument();
  expect(screen.queryByText('页面不存在')).not.toBeInTheDocument();
});
test('missing approval.read still denies the workflow page before loading data', () => {
  useAuthStore.setState({ authorization: { ...authorization, permissions: [] } });
  show('/approvals/visual');
  expect(screen.getByText('无权访问此页面')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '可视化审批' })).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
});
