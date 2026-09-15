import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import PerformancePage from '../index';
import { useAuthStore } from '@/stores/authStore';
import type { Performance } from '@/types';
import type { PermissionCode } from '@/features/authorization/types';

const performanceApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  confirm: vi.fn(),
  setGoal: vi.fn(),
  selfReview: vi.fn(),
  managerReview: vi.fn(),
  metrics: vi.fn(),
}));
const employeeApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
}));
vi.mock('@/api/organization', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/organization')>();
  return { ...original, performanceApi: performanceApiMock, employeeApi: employeeApiMock };
});

function performanceFixture(overrides: Partial<Performance> = {}): Performance {
  return {
    version: 1,
    id: 'perf-1',
    employeeId: 'emp-1',
    period: '2026-04',
    type: 'MONTHLY',
    kpiData: '{"cases":5}',
    score: '92.50',
    bonus: '3000.00',
    remark: null,
    status: 'PENDING',
    createdAt: '2026-08-01T01:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    ...overrides,
  };
}

function pageOf(list: Performance[], total = list.length) {
  return { code: 200, message: 'success', data: { list, page: 1, pageSize: 10, total } };
}

function grantPermissions(permissions: PermissionCode[]) {
  useAuthStore.setState({
    authorization: {
      userId: 'user-1',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions,
      menus: [],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(message, 'error').mockImplementation(() => undefined as never);
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle' });
  employeeApiMock.list.mockResolvedValue({
    code: 200,
    message: 'success',
    data: {
      list: [{ id: 'emp-1', name: '张三', employeeNo: 'EMP-0001' }],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    },
  });
  performanceApiMock.detail.mockResolvedValue({ code: 200, message: 'success', data: performanceFixture() });
});

test('renders the performance list with server data and employee name mapping', async () => {
  performanceApiMock.list.mockResolvedValue(pageOf([performanceFixture()]));
  render(
    <MemoryRouter>
      <PerformancePage />
    </MemoryRouter>,
  );

  expect(await screen.findByText('2026-04')).toBeInTheDocument();
  expect(screen.getByText('张三')).toBeInTheDocument(); // employeeId → 员工名映射
  expect(screen.getByText('月度绩效')).toBeInTheDocument();
  expect(screen.getByText('待考核')).toBeInTheDocument(); // PENDING 状态标签
  expect(performanceApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
});

test('hides create/confirm actions without performance.create/confirm permissions', async () => {
  performanceApiMock.list.mockResolvedValue(pageOf([performanceFixture()]));
  render(
    <MemoryRouter>
      <PerformancePage />
    </MemoryRouter>,
  );

  expect(await screen.findByText('2026-04')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /录入绩效/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /确认/ })).not.toBeInTheDocument();
});

test('create modal submits the performance create mutation', async () => {
  grantPermissions(['performance.create']);
  performanceApiMock.list.mockResolvedValue(pageOf([]));
  performanceApiMock.create.mockResolvedValue({ code: 200, message: 'success', data: performanceFixture() });
  render(
    <MemoryRouter>
      <PerformancePage />
    </MemoryRouter>,
  );

  fireEvent.click(await screen.findByRole('button', { name: /录入绩效/ }));
  await screen.findByRole('dialog');

  fireEvent.change(screen.getByRole('textbox', { name: '考核周期' }), { target: { value: '2026-04' } });
  const empSelect = screen.getByRole('combobox', { name: '绩效员工' });
  fireEvent.mouseDown(empSelect);
  fireEvent.click((await screen.findAllByText('张三')).find((el) => el.closest('[role="option"]'))!);
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() =>
    expect(performanceApiMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp-1', period: '2026-04', type: 'MONTHLY' }),
    ),
  );
});

test('confirm button calls the confirm mutation for a PENDING record', async () => {
  grantPermissions(['performance.confirm']);
  performanceApiMock.list.mockResolvedValue(pageOf([performanceFixture()]));
  performanceApiMock.confirm.mockResolvedValue({
    code: 200,
    message: 'success',
    data: performanceFixture({ status: 'CONFIRMED' }),
  });
  render(
    <MemoryRouter>
      <PerformancePage />
    </MemoryRouter>,
  );

  fireEvent.click(await screen.findByRole('button', { name: /确认/ }));

  await waitFor(() => expect(performanceApiMock.confirm).toHaveBeenCalledWith('perf-1'));
});

test('sets a performance goal from the detail drawer (SPEC-043)', async () => {
  grantPermissions(['performance.update']);
  performanceApiMock.list.mockResolvedValue(pageOf([performanceFixture()]));
  performanceApiMock.detail.mockResolvedValue({ code: 200, message: 'success', data: performanceFixture() });
  performanceApiMock.setGoal.mockResolvedValue({
    code: 200,
    message: 'success',
    data: performanceFixture({ goal: '完成 5 个案源转化' }),
  });
  render(
    <MemoryRouter>
      <PerformancePage />
    </MemoryRouter>,
  );

  fireEvent.click(await screen.findByRole('button', { name: /详情/ }));
  await screen.findByText('考核流程');
  fireEvent.click(screen.getByRole('button', { name: '设定目标' }));
  // 抽屉与 Modal 均为 dialog——直接定位 Modal 内唯一文本域。
  await screen.findByRole('textbox', { name: '绩效目标' });
  fireEvent.change(screen.getByRole('textbox', { name: '绩效目标' }), {
    target: { value: '完成 5 个案源转化' },
  });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() =>
    expect(performanceApiMock.setGoal).toHaveBeenCalledWith(
      'perf-1',
      expect.objectContaining({ goal: '完成 5 个案源转化' }),
    ),
  );
});

test('renders the business metrics card from the detail drawer (SPEC-044)', async () => {
  grantPermissions(['performance.read']);
  performanceApiMock.list.mockResolvedValue(pageOf([performanceFixture()]));
  performanceApiMock.detail.mockResolvedValue({ code: 200, message: 'success', data: performanceFixture() });
  performanceApiMock.metrics.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { closedCases: 3, confirmedRevenue: '120000.00', autoScore: 42 },
  });
  render(
    <MemoryRouter>
      <PerformancePage />
    </MemoryRouter>,
  );

  fireEvent.click(await screen.findByRole('button', { name: /详情/ }));
  expect(await screen.findByText('业务指标（考核周期）')).toBeInTheDocument();
  expect(screen.getByText('3 件')).toBeInTheDocument();
  expect(screen.getByText('¥120000.00')).toBeInTheDocument();
  expect(screen.getByText('42 分')).toBeInTheDocument(); // SPEC-045 autoScore
  expect(performanceApiMock.metrics).toHaveBeenCalledWith('perf-1');
});
