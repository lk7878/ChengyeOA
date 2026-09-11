import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import InvoiceListPage from '../InvoiceListPage';
import { useInvoiceStore } from '@/stores/invoice-store';
import { useAuthStore } from '@/stores/authStore';
import type { InvoiceView } from '@/api/invoice';
import type { PermissionCode } from '@/features/authorization/types';

const invoiceApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  complete: vi.fn(),
}));
vi.mock('@/api/invoice', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/invoice')>();
  return { ...original, invoiceApi: invoiceApiMock };
});

const contractApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  submit: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  sign: vi.fn(),
  effect: vi.fn(),
  terminate: vi.fn(),
  void: vi.fn(),
  plans: vi.fn(),
}));
vi.mock('@/api/contract', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/contract')>();
  return { ...original, contractApi: contractApiMock };
});

function invoiceFixture(overrides: Partial<InvoiceView> = {}): InvoiceView {
  return {
    id: 'invoice-1',
    requestNo: 'KP2026-0001',
    contractId: 'contract-1',
    customerId: 'customer-1',
    amount: '10000.00',
    reason: '开票给客户',
    status: 'PENDING',
    approvedBy: null,
    approvedAt: null,
    approvalComment: null,
    invoiceNo: null,
    completedBy: null,
    completedAt: null,
    createdBy: 'user-1',
    updatedBy: null,
    version: 1,
    createdAt: '2026-07-30T01:00:00.000Z',
    updatedAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
  };
}

function pageOf(list: InvoiceView[], total = list.length) {
  return { code: 200, message: 'success', data: { list, page: 1, pageSize: 10, total } };
}

function contractFixture(overrides: Partial<{ id: string; contractNo: string; title: string; amount: string; status: string }> = {}) {
  return {
    id: 'contract-1',
    contractNo: 'WT2026-0001',
    title: '正式委托合同-张三',
    amount: '50000.00',
    status: 'SIGNED',
    ...overrides,
  };
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
  useInvoiceStore.getState().reset();
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle' });
});

test('renders the invoice list with server data', async () => {
  invoiceApiMock.list.mockResolvedValue(pageOf([invoiceFixture()]));
  render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);

  expect(await screen.findByText('KP2026-0001')).toBeInTheDocument();
  expect(screen.getByText('10000.00')).toBeInTheDocument();
  expect(screen.getByText('待审批')).toBeInTheDocument();
  expect(invoiceApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
});

test('status filter fires list query with status param', async () => {
  invoiceApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);
  await screen.findByText('暂无开票申请');

  fireEvent.mouseDown(screen.getByRole('combobox', { name: '状态筛选' }));
  fireEvent.click(await screen.findByText('已批准'));
  fireEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

  await waitFor(() => expect(invoiceApiMock.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 10, status: 'APPROVED' }),
  ));
});

test('shows the empty state when the server returns no invoices', async () => {
  invoiceApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);

  expect(await screen.findByText('暂无开票申请')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('shows an error state when the list request fails', async () => {
  invoiceApiMock.list.mockRejectedValue(new Error('网络错误'));
  render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);

  expect(await screen.findByText('开票列表加载失败')).toBeInTheDocument();
  expect(screen.getByText('网络错误')).toBeInTheDocument();
});

test('hides action buttons without invoice.approve/invoice.complete permissions', async () => {
  invoiceApiMock.list.mockResolvedValue(pageOf([invoiceFixture()]));
  render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);

  expect(await screen.findByText('KP2026-0001')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '审核通过' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '完成' })).not.toBeInTheDocument();
});

test('shows approve on PENDING and complete on APPROVED rows with the matching permissions', async () => {
  grantPermissions(['invoice.approve', 'invoice.complete']);
  invoiceApiMock.list.mockResolvedValue(pageOf([
    invoiceFixture(),
    invoiceFixture({ id: 'invoice-2', requestNo: 'KP2026-0002', status: 'APPROVED' }),
  ]));
  render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);

  expect(await screen.findByText('KP2026-0001')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '审核通过' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument();
  // APPROVED 行渲染完成按钮（PENDING 行不渲染）。
  expect(screen.getAllByRole('button', { name: '完成' })).toHaveLength(1);
});

test('approve modal submits the approve mutation', async () => {
  grantPermissions(['invoice.approve']);
  invoiceApiMock.list.mockResolvedValue(pageOf([invoiceFixture()]));
  invoiceApiMock.approve.mockResolvedValue({
    code: 200,
    message: 'success',
    data: invoiceFixture({ status: 'APPROVED' }),
  });
  render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: '审核通过' }));
  expect(await screen.findByText('审批意见（可选）')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(invoiceApiMock.approve).toHaveBeenCalledWith(
    'invoice-1',
    expect.objectContaining({}),
  ));
  await waitFor(() => expect(screen.getByText('已批准')).toBeInTheDocument());
});

test('hides the create button without invoice.create and shows it with the code', async () => {
  invoiceApiMock.list.mockResolvedValue(pageOf([]));
  const { unmount } = render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);
  await screen.findByText('暂无开票申请');
  expect(screen.queryByRole('button', { name: /新建申请/ })).not.toBeInTheDocument();
  unmount();

  grantPermissions(['invoice.create']);
  render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);
  await screen.findAllByText('暂无开票申请');
  expect(screen.getByRole('button', { name: /新建申请/ })).toBeInTheDocument();
});

test('create modal submits the create mutation with a receivable contract', async () => {
  grantPermissions(['invoice.create']);
  invoiceApiMock.list.mockResolvedValue(pageOf([]));
  invoiceApiMock.create.mockResolvedValue({
    code: 200,
    message: 'success',
    data: invoiceFixture({ status: 'PENDING' }),
  });
  contractApiMock.list.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { list: [contractFixture()], page: 1, pageSize: 100, total: 1 },
  });
  render(<MemoryRouter><InvoiceListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /新建申请/ }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toBeInTheDocument();

  fireEvent.mouseDown(screen.getByRole('combobox', { name: '合同' }));
  fireEvent.click(await screen.findByText(/WT2026-0001/));
  fireEvent.change(screen.getByRole('spinbutton', { name: '申请金额' }), { target: { value: '10000' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(invoiceApiMock.create).toHaveBeenCalledWith(
    expect.objectContaining({ contractId: 'contract-1', amount: '10000.00' }),
  ));
  await waitFor(() => expect(invoiceApiMock.list).toHaveBeenCalledTimes(2));
});
