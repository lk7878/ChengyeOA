import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import CostListPage from '../CostListPage';
import { useCostStore } from '@/stores/cost-store';
import { useAuthStore } from '@/stores/authStore';
import type { CostView } from '@/api/cost';
import type { PermissionCode } from '@/features/authorization/types';

const costApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/api/cost', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/cost')>();
  return { ...original, costApi: costApiMock };
});

const organizationApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/api/organization', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/organization')>();
  return { ...original, channelApi: organizationApiMock };
});

const businessApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  createCommunication: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@/api/business', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/business')>();
  return { ...original, caseApi: businessApiMock };
});

function costFixture(overrides: Partial<CostView> = {}): CostView {
  return {
    id: 'cost-1',
    category: 'CHANNEL',
    amount: '2000.00',
    occurredAt: '2026-07-28T00:00:00.000Z',
    note: '渠道投放费',
    channelId: 'channel-1',
    caseId: null,
    createdBy: 'user-1',
    updatedBy: null,
    version: 1,
    createdAt: '2026-07-28T01:00:00.000Z',
    updatedAt: '2026-07-28T01:00:00.000Z',
    ...overrides,
  };
}

function pageOf(list: CostView[], total = list.length) {
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
  useCostStore.getState().reset();
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle' });
  organizationApiMock.list.mockResolvedValue({
    code: 200, message: 'success',
    data: { list: [{ id: 'channel-1', name: '抖音投放', type: 'ONLINE', cost: 0, status: 'ENABLED' }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
  });
  businessApiMock.list.mockResolvedValue({
    code: 200, message: 'success',
    data: { list: [{ id: 'case-1', caseNo: 'AJ2026-0001', title: '张三离婚纠纷' }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
  });
});

test('renders the cost list with server data', async () => {
  costApiMock.list.mockResolvedValue(pageOf([costFixture()]));
  render(<MemoryRouter><CostListPage /></MemoryRouter>);

  expect(await screen.findByText('2000.00')).toBeInTheDocument();
  expect(screen.getByText('渠道成本')).toBeInTheDocument();
  expect(screen.getByText('抖音投放')).toBeInTheDocument();
  expect(costApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
});

test('category filter fires list query with category param', async () => {
  costApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><CostListPage /></MemoryRouter>);
  await screen.findByText('暂无成本记录');

  fireEvent.mouseDown(screen.getByRole('combobox', { name: '类别筛选' }));
  fireEvent.click(await screen.findByText('办案成本'));
  fireEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

  await waitFor(() => expect(costApiMock.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 10, category: 'CASE_HANDLING' }),
  ));
});

test('shows the empty state when the server returns no costs', async () => {
  costApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><CostListPage /></MemoryRouter>);

  expect(await screen.findByText('暂无成本记录')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('shows an error state when the list request fails', async () => {
  costApiMock.list.mockRejectedValue(new Error('网络错误'));
  render(<MemoryRouter><CostListPage /></MemoryRouter>);

  expect(await screen.findByText('成本列表加载失败')).toBeInTheDocument();
  expect(screen.getByText('网络错误')).toBeInTheDocument();
});

test('hides edit and delete buttons without cost.update/cost.delete permissions', async () => {
  costApiMock.list.mockResolvedValue(pageOf([costFixture()]));
  render(<MemoryRouter><CostListPage /></MemoryRouter>);

  expect(await screen.findByText('2000.00')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
});

test('shows edit and delete buttons with the matching permissions', async () => {
  grantPermissions(['cost.update', 'cost.delete']);
  costApiMock.list.mockResolvedValue(pageOf([costFixture()]));
  render(<MemoryRouter><CostListPage /></MemoryRouter>);

  expect(await screen.findByText('2000.00')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
});

test('create modal shows a channel anchor for CHANNEL category and none for LABOR', async () => {
  grantPermissions(['cost.create']);
  costApiMock.list.mockResolvedValue(pageOf([]));
  costApiMock.create.mockResolvedValue({
    code: 200, message: 'success', data: costFixture(),
  });
  render(<MemoryRouter><CostListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /登记成本/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  // 默认类别为空 → 无锚点控件。
  expect(screen.queryByRole('combobox', { name: '锚点渠道' })).not.toBeInTheDocument();

  // 选 CHANNEL → 渠道下拉出现。
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '成本类别' }));
  fireEvent.click(await screen.findByText('渠道成本'));
  expect(await screen.findByRole('combobox', { name: '锚点渠道' })).toBeInTheDocument();

  // 切到 LABOR → 锚点控件消失。
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '成本类别' }));
  fireEvent.click(await screen.findByText('人力成本'));
  await waitFor(() => expect(screen.queryByRole('combobox', { name: '锚点渠道' })).not.toBeInTheDocument());
  expect(screen.queryByRole('combobox', { name: '锚点案件' })).not.toBeInTheDocument();
});

test('create modal submits the create mutation with the channel anchor', async () => {
  grantPermissions(['cost.create']);
  costApiMock.list.mockResolvedValue(pageOf([]));
  costApiMock.create.mockResolvedValue({
    code: 200, message: 'success', data: costFixture(),
  });
  render(<MemoryRouter><CostListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /登记成本/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  fireEvent.mouseDown(screen.getByRole('combobox', { name: '成本类别' }));
  fireEvent.click(await screen.findByText('渠道成本'));
  const channelSelect = await screen.findByRole('combobox', { name: '锚点渠道' });
  fireEvent.mouseDown(channelSelect);
  fireEvent.click(await screen.findByText('抖音投放'));

  fireEvent.change(screen.getByRole('spinbutton', { name: '成本金额' }), { target: { value: '2000' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(costApiMock.create).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'CHANNEL',
      channelId: 'channel-1',
      amount: '2000.00',
    }),
  ));
  await waitFor(() => expect(costApiMock.list).toHaveBeenCalledTimes(2));
});

test('edit modal disables the category and anchor selects (immutable anchors)', async () => {
  grantPermissions(['cost.update']);
  costApiMock.list.mockResolvedValue(pageOf([costFixture()]));
  render(<MemoryRouter><CostListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  // 编辑态类别与锚点不可变（PATCH 白名单只收 amount/occurredAt/note/version）。
  expect(screen.getByRole('combobox', { name: '成本类别' })).toBeDisabled();
  expect(await screen.findByRole('combobox', { name: '锚点渠道' })).toBeDisabled();
});

test('delete requires a double confirmation and calls the remove mutation', async () => {
  grantPermissions(['cost.delete']);
  costApiMock.list.mockResolvedValue(pageOf([costFixture()]));
  costApiMock.remove.mockResolvedValue({ code: 200, message: 'success', data: null });
  render(<MemoryRouter><CostListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: '删除' }));
  expect(await screen.findByText('确认删除该成本记录？')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /确\s*认/ }));

  await waitFor(() => expect(costApiMock.remove).toHaveBeenCalledWith('cost-1'));
});
