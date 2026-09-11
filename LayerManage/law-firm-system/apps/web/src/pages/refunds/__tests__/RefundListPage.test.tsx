import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { message } from 'antd';
import { beforeEach, expect, test, vi } from 'vitest';
import RefundListPage from '../RefundListPage';
import { useRefundStore } from '@/stores/refund-store';
import { useAuthStore } from '@/stores/authStore';
import type { RefundView } from '@/api/refund';
import type { PermissionCode } from '@/features/authorization/types';

const runStepUp = vi.hoisted(() => vi.fn());
vi.mock('@/features/auth/useStepUp', () => ({
  useStepUp: () => ({
    run: runStepUp,
    dialogProps: { open: false, purpose: 'SESSION_REVOKE', impact: '', loading: false, onCancel: vi.fn(), onVerify: vi.fn() },
  }),
}));
vi.mock('@/features/auth/components/StepUpDialog', () => ({ default: () => null }));

const refundApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('@/api/refund', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/refund')>();
  return { ...original, refundApi: refundApiMock };
});

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

function refundFixture(overrides: Partial<RefundView> = {}): RefundView {
  return {
    id: 'refund-1',
    requestNo: 'TK2026-0001',
    type: 'REFUND',
    contractId: 'contract-1',
    customerId: 'customer-1',
    paymentId: 'payment-1',
    planId: null,
    amount: '10000.00',
    reason: '客户申请退款',
    status: 'PENDING',
    approvedBy: null,
    approvedAt: null,
    approvalComment: null,
    executedBy: null,
    executedAt: null,
    createdBy: 'user-1',
    updatedBy: null,
    version: 1,
    createdAt: '2026-07-30T01:00:00.000Z',
    updatedAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
  };
}

function pageOf(list: RefundView[], total = list.length) {
  return { code: 200, message: 'success', data: { list, page: 1, pageSize: 10, total } };
}

function paymentFixture(overrides: Partial<Record<string, unknown>> = {}) {
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
    status: 'CONFIRMED',
    confirmedBy: 'user-1',
    confirmedAt: '2026-07-30T02:00:00.000Z',
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

function planFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'plan-1',
    planNo: 'YS2026-0001',
    contractId: 'contract-1',
    period: 1,
    dueDate: '2026-08-30T00:00:00.000Z',
    amount: '50000.00',
    receivedAmount: '10000.00',
    status: 'PENDING',
    version: 1,
    createdBy: 'user-1',
    createdAt: '2026-07-30T01:00:00.000Z',
    updatedAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
  };
}

function contractFixture(overrides: Partial<Record<string, unknown>> = {}) {
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
  runStepUp.mockImplementation(async request => request.mutate('one-time-grant'));
  vi.spyOn(message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(message, 'error').mockImplementation(() => undefined as never);
  useRefundStore.getState().reset();
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle' });
});

test('renders the refund list with server data', async () => {
  refundApiMock.list.mockResolvedValue(pageOf([refundFixture()]));
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);

  expect(await screen.findByText('TK2026-0001')).toBeInTheDocument();
  expect(screen.getByText('10000.00')).toBeInTheDocument();
  expect(screen.getByText('退款')).toBeInTheDocument();
  expect(screen.getByText('待审批')).toBeInTheDocument();
  expect(refundApiMock.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
});

test('type filter fires list query with type param', async () => {
  refundApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);
  await screen.findByText('暂无退款/减免申请');

  fireEvent.mouseDown(screen.getByRole('combobox', { name: '类型筛选' }));
  fireEvent.click(await screen.findByText('减免'));
  fireEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

  await waitFor(() => expect(refundApiMock.list).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 10, type: 'WAIVER' }),
  ));
});

test('shows the empty state when the server returns no refunds', async () => {
  refundApiMock.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);

  expect(await screen.findByText('暂无退款/减免申请')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('shows an error state when the list request fails', async () => {
  refundApiMock.list.mockRejectedValue(new Error('网络错误'));
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);

  expect(await screen.findByText('退款/减免列表加载失败')).toBeInTheDocument();
  expect(screen.getByText('网络错误')).toBeInTheDocument();
});

test('hides approve and execute buttons without refund.approve/refund.execute permissions', async () => {
  refundApiMock.list.mockResolvedValue(pageOf([refundFixture()]));
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);

  expect(await screen.findByText('TK2026-0001')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '审批通过' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '执行' })).not.toBeInTheDocument();
});

test('shows approve on PENDING and execute on APPROVED rows with the matching permissions', async () => {
  grantPermissions(['refund.approve', 'refund.execute']);
  refundApiMock.list.mockResolvedValue(pageOf([
    refundFixture(),
    refundFixture({ id: 'refund-2', requestNo: 'TK2026-0002', status: 'APPROVED' }),
  ]));
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);

  expect(await screen.findByText('TK2026-0001')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '审批通过' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument();
  // APPROVED 行渲染执行按钮（PENDING 行不渲染）。
  expect(screen.getAllByRole('button', { name: '执行' })).toHaveLength(1);
});

test('approve modal shows the high-sensitivity warning and submits the approve mutation', async () => {
  grantPermissions(['refund.approve']);
  refundApiMock.list.mockResolvedValue(pageOf([refundFixture()]));
  refundApiMock.approve.mockResolvedValue({
    code: 200,
    message: 'success',
    data: refundFixture({ status: 'APPROVED' }),
  });
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: '审批通过' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toBeInTheDocument();
  expect(screen.getByText(/审批通过为高敏感操作/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /确认批准/ }));
  // Task 7：approve 经 useStepUp（REFUND_APPROVE 目的位）持证调用——expectedVersion=行版本，
  // 一次性 grant 作为 x-step-up-token 第三参。
  await waitFor(() => expect(refundApiMock.approve).toHaveBeenCalledWith(
    'refund-1',
    expect.objectContaining({ expectedVersion: 1 }),
    'one-time-grant',
  ));
  await waitFor(() => expect(screen.getByText('已批准')).toBeInTheDocument());
});

test('approve failure (409 stale expectedVersion) shows an error and keeps the action modal open', async () => {
  grantPermissions(['refund.approve']);
  refundApiMock.list.mockResolvedValue(pageOf([refundFixture()]));
  refundApiMock.approve.mockRejectedValue({ response: { status: 409, data: { message: 'REFUND_VERSION_CONFLICT' } } });
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: '审批通过' }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: /确认批准/ }));

  // store 吞错返回 false → 页面内联 message.error（具体 409 业务码已由 request 拦截器提示，双提示可接受）。
  await waitFor(() => expect(refundApiMock.approve).toHaveBeenCalledOnce());
  expect(message.error).toHaveBeenCalledWith('审批操作失败，请重试');
  // Modal 保持打开（审批失败不关闭动作模态，用户可重试或取消）。
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText(/审批通过为高敏感操作/)).toBeInTheDocument();
});

test('REFUND create modal selects a confirmed payment and backfills a read-only amount', async () => {
  grantPermissions(['refund.create']);
  refundApiMock.list.mockResolvedValue(pageOf([]));
  refundApiMock.create.mockResolvedValue({
    code: 200,
    message: 'success',
    data: refundFixture({ status: 'PENDING' }),
  });
  paymentApiMock.list.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { list: [paymentFixture()], page: 1, pageSize: 100, total: 1 },
  });
  contractApiMock.list.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { list: [contractFixture()], page: 1, pageSize: 100, total: 1 },
  });
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /新建申请/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  fireEvent.mouseDown(screen.getByRole('combobox', { name: '收款单' }));
  fireEvent.click(await screen.findByText(/SK2026-0001/));

  // 金额只读回填（disabled 且值为收款金额）。
  const amountInput = screen.getByRole('spinbutton', { name: '金额' }) as HTMLInputElement;
  expect(amountInput).toBeDisabled();
  expect(Number(amountInput.value)).toBe(10000);

  fireEvent.change(screen.getByPlaceholderText('必填'), { target: { value: '客户申请退款' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(refundApiMock.create).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'REFUND',
      contractId: 'contract-1',
      paymentId: 'payment-1',
      amount: '10000.00',
      reason: '客户申请退款',
    }),
  ));
  // 提交成功后回源刷新列表（弹窗关闭由 antd 退出动画接管，不在 jsdom 断言）。
  await waitFor(() => expect(refundApiMock.list).toHaveBeenCalledTimes(2));
});

test('WAIVER create modal requires contract then plan and shows the balance hint', async () => {
  grantPermissions(['refund.create']);
  refundApiMock.list.mockResolvedValue(pageOf([]));
  refundApiMock.create.mockResolvedValue({
    code: 200,
    message: 'success',
    data: refundFixture({ type: 'WAIVER', paymentId: null, planId: 'plan-1', status: 'PENDING' }),
  });
  paymentApiMock.list.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { list: [], page: 1, pageSize: 100, total: 0 },
  });
  contractApiMock.list.mockResolvedValue({
    code: 200,
    message: 'success',
    data: { list: [contractFixture()], page: 1, pageSize: 100, total: 1 },
  });
  contractApiMock.plans.mockResolvedValue({
    code: 200,
    message: 'success',
    data: [planFixture()],
  });
  render(<MemoryRouter><RefundListPage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /新建申请/ }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  // 切换到减免类型。
  fireEvent.click(screen.getByRole('radio', { name: '减免' }));

  const contractSelect = await screen.findByRole('combobox', { name: '合同' });
  fireEvent.mouseDown(contractSelect);
  fireEvent.click(await screen.findByText(/WT2026-0001/));
  await waitFor(() => expect(contractApiMock.plans).toHaveBeenCalledWith('contract-1'));

  const planSelect = await screen.findByRole('combobox', { name: '应收计划' });
  fireEvent.mouseDown(planSelect);
  fireEvent.click(await screen.findByText(/第1期/));
  await waitFor(() => expect(screen.getByText(/余额上限 40000.00 元/)).toBeInTheDocument());

  fireEvent.change(screen.getByPlaceholderText('必填'), { target: { value: '客户困难减免' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(refundApiMock.create).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'WAIVER',
      contractId: 'contract-1',
      planId: 'plan-1',
      amount: '40000.00',
      reason: '客户困难减免',
    }),
  ));
  await waitFor(() => expect(refundApiMock.list).toHaveBeenCalledTimes(2));
});
