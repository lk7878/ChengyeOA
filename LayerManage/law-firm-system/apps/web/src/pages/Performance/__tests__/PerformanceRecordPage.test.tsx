import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import PerformanceRecordPage from '../PerformanceRecordPage';
import { useAuthStore } from '@/stores/authStore';
const mocks = vi.hoisted(() => ({ detail: vi.fn(), metrics: vi.fn(), setGoal: vi.fn() }));
vi.mock('@/api/organization', () => ({ performanceApi: mocks }));
vi.mock('@/features/crm/BusinessWorkspacePage', () => ({ BusinessTableLinks: () => null }));
const row = {
  id: 'p',
  employeeId: 'employee',
  employee: { name: '被考核成员' },
  period: '2026-09',
  status: 'PENDING',
  version: 1,
  goal: '原目标',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail.mockResolvedValue({ data: row });
  mocks.metrics.mockResolvedValue({ data: { closedCases: null, confirmedRevenue: null, autoScore: null } });
  mocks.setGoal.mockResolvedValue({ data: { ...row, version: 2 } });
  useAuthStore.setState({
    authorization: {
      userId: 'u',
      employeeId: 'employee',
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions: ['performance.read', 'performance.update', 'performance.confirm'],
      menus: [],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
});
function open() {
  return render(
    <MemoryRouter initialEntries={['/performances/p']}>
      <Routes>
        <Route path="/performances/:id" element={<PerformanceRecordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
test('background updates preserve review drafts and only adopt a new version after explicit reconciliation', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: '设置目标' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('考核目标'), { target: { value: '我的未提交目标' } });
  mocks.detail.mockResolvedValue({ data: { ...row, goal: '其他成员更新', version: 3 } });
  fireEvent(window, new Event('focus'));
  await screen.findByText('其他成员更新');
  expect(within(dialog).getByLabelText('考核目标')).toHaveValue('我的未提交目标');
  fireEvent.click(within(dialog).getByRole('button', { name: '已核对最新版本' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '确认办理' }));
  await waitFor(() =>
    expect(mocks.setGoal).toHaveBeenCalledWith('p', { goal: '我的未提交目标', version: 3 }),
  );
});
test('revocation clears detail and open draft; managers cannot initiate someone else self review', async () => {
  useAuthStore.setState({
    authorization: { ...useAuthStore.getState().authorization!, employeeId: 'manager' },
  });
  open();
  await screen.findByText('被考核成员');
  expect(screen.queryByRole('button', { name: '提交自评' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '设置目标' }));
  await screen.findByRole('dialog');
  mocks.detail.mockRejectedValue({ response: { status: 403, data: { message: '已撤权' } } });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.queryByText('被考核成员')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.queryByLabelText('考核目标')).not.toBeInTheDocument());
});
