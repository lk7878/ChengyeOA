import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import PaymentListPage from '../PaymentListPage';
import { usePaymentStore } from '@/stores/payment-store';
import { useAuthStore } from '@/stores/authStore';
import type { PaymentView } from '@/api/payment';
import type { PermissionCode } from '@/features/authorization/types';

const paymentApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  confirm: vi.fn(),
  void: vi.fn(),
}));
vi.mock('@/api/payment', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/payment')>();
  return { ...original, paymentApi: paymentApiMock };
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

function paymentFixture(overrides: Partial<PaymentView> = {}): PaymentView {
  return {
    id: 'payment-1',
    paymentNo: 'SK2026-0001',
    contractId: 'contract-1',
    paymentPlanId: null,
    customerId: 'customer-1',
    amount: '10000.00',
    method: '银行转账',
    account: null,
    paidAt: '2026-07-30T02:00:00.000Z',
    status: 'PENDING',
    confirmedBy: null,
    confirmedAt: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    remark: null,
    createdBy: 'user-1',
    updatedBy: null,
    version: 1,
    createdAt: '2026-07-30T01:00:00.000Z',
    updatedAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
  };
}

function pageOf(list: PaymentView[], total = list.length) {
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
  usePaymentStore.getState().reset();
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle' });
});

test('renders the payment list with server data', async () => {
  paymentApiMock.list.mockResolvedValue(pageOf([paymentFixture()]));
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);

  expect(await screen.findByText('SK2026-0001')).toBeInTheDocument();
  expect(screen.getByText('10000.00')).toBeInTheDocument();
  expect(screen.getByText('待确认')).toBeInTheDocument();
  expect(paymentApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
});

test('status filter fires list query with status param', async () => {
  paymentApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);
  await screen.findByText('暂无收款记录');

  fireEvent.mouseDown(screen.getByRole('combobox', { name: '状态筛选' }));
  fireEvent.click(await screen.findByText('已确认'));
  fireEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

  await waitFor(() => expect(paymentApiMock.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 10, status: 'CONFIRMED' }),
  ));
});

test('shows the empty state when the server returns no payments', async () => {
  paymentApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);

  expect(await screen.findByText('暂无收款记录')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('shows an error state when the list request fails', async () => {
  paymentApiMock.list.mockRejectedValue(new Error('网络错误'));
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);

  expect(await screen.findByText('收款列表加载失败')).toBeInTheDocument();
  expect(screen.getByText('网络错误')).toBeInTheDocument();
});

test('hides the confirm button without payment.confirm permission', async () => {
  paymentApiMock.list.mockResolvedValue(pageOf([paymentFixture()]));
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);

  expect(await screen.findByText('SK2026-0001')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认' })).not.toBeInTheDocument();
});

test('shows the confirm button on PENDING rows with payment.confirm permission', async () => {
  grantPermissions(['payment.confirm']);
  paymentApiMock.list.mockResolvedValue(pageOf([
    paymentFixture(),
    paymentFixture({ id: 'payment-2', paymentNo: 'SK2026-0002', status: 'CONFIRMED' }),
  ]));
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);

  expect(await screen.findByText('SK2026-0001')).toBeInTheDocument();
  // 仅 PENDING 行渲染确认按钮；CONFIRMED 行不渲染。
  const confirmButtons = screen.getAllByRole('button', { name: '确认' });
  expect(confirmButtons).toHaveLength(1);
});

test('hides the register button without payment.create and shows it with the code', async () => {
  paymentApiMock.list.mockResolvedValue(pageOf([]));
  const { unmount } = render(<MemoryRouter><PaymentListPage /></MemoryRouter>);
  await screen.findByText('暂无收款记录');
  expect(screen.queryByRole('button', { name: /登记收款/ })).not.toBeInTheDocument();
  unmount();

  grantPermissions(['payment.create']);
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);
  await screen.findAllByText('暂无收款记录');
  expect(screen.getByRole('button', { name: /登记收款/ })).toBeInTheDocument();
});

// ===== SPEC-011 Task 11：冲销动作（FIN-03）=====

test('hides the void button without payment.void permission', async () => {
  paymentApiMock.list.mockResolvedValue(pageOf([paymentFixture({ status: 'CONFIRMED' })]));
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);

  expect(await screen.findByText('SK2026-0001')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /冲销/ })).not.toBeInTheDocument();
});

test('shows the void button on CONFIRMED rows with payment.void permission and hides it on PENDING rows', async () => {
  grantPermissions(['payment.void']);
  paymentApiMock.list.mockResolvedValue(pageOf([
    paymentFixture({ id: 'payment-1', paymentNo: 'SK2026-0001', status: 'PENDING' }),
    paymentFixture({ id: 'payment-2', paymentNo: 'SK2026-0002', status: 'CONFIRMED' }),
  ]));
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);

  expect(await screen.findByText('SK2026-0001')).toBeInTheDocument();
  const voidButtons = screen.getAllByRole('button', { name: /冲销/ });
  // 仅 CONFIRMED 行渲染冲销按钮；PENDING 行不渲染。
  expect(voidButtons).toHaveLength(1);
});

test('void modal requires a reason and submits the void mutation on success', async () => {
  grantPermissions(['payment.void']);
  paymentApiMock.list.mockResolvedValue(pageOf([paymentFixture({ status: 'CONFIRMED' })]));
  paymentApiMock.void.mockResolvedValue({
    code: 200,
    message: 'success',
    data: paymentFixture({ status: 'VOIDED', voidedBy: 'user-1', voidedAt: '2026-08-01T02:00:00.000Z', voidReason: '误登记' }),
  });
  render(<MemoryRouter><PaymentListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /冲销/ }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toBeInTheDocument();
  expect(screen.getByText('冲销为高敏感操作：将把该收款置为已冲销并回补合同已收金额，操作不可撤销。')).toBeInTheDocument();

  // 未填原因直接提交 → 校验拦截，不触发接口。
  fireEvent.click(screen.getByRole('button', { name: /确认冲销/ }));
  await waitFor(() => expect(screen.getByText('请输入冲销原因')).toBeInTheDocument());
  expect(paymentApiMock.void).not.toHaveBeenCalled();

  // 填写原因后提交 → 调用 void 并就地更新行（CONFIRMED→VOIDED）。
  fireEvent.change(screen.getByPlaceholderText('必填'), { target: { value: '误登记' } });
  fireEvent.click(screen.getByRole('button', { name: /确认冲销/ }));
  await waitFor(() => expect(paymentApiMock.void).toHaveBeenCalledWith(
    'payment-1',
    expect.objectContaining({ reason: '误登记' }),
  ));
  await waitFor(() => expect(screen.getByText('已冲销')).toBeInTheDocument());
});
