// SPEC-012 Task 6: 终止-计划联动前端——终止弹窗未清计划计数 + 计划 CANCELLED 态。
// 断言非恒真：分别覆盖 N>0 / N=0 计数提示、确认后计划列表出现 CANCELLED、直接渲染 CANCELLED 行。
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import ContractDetailPage from '../ContractDetailPage';
import { useContractStore } from '@/stores/contract-store';
import { useAuthStore } from '@/stores/authStore';
import type { ContractView } from '@/api/contract';
import type { PaymentPlanView } from '@/api/payment';
import type { PermissionCode } from '@/features/authorization/types';

const contractApi = vi.hoisted(() => ({
  detail: vi.fn(),
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
  return { ...original, contractApi };
});

const paymentApi = vi.hoisted(() => ({
  list: vi.fn(),
}));
vi.mock('@/api/payment', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/payment')>();
  return { ...original, paymentApi };
});

function apiRes<T>(data: T) {
  return { code: 200, message: 'success', data };
}

function pageOf<T>(list: T[]) {
  return { list, page: 1, pageSize: 100, total: list.length };
}

function contractFixture(overrides: Partial<ContractView> = {}): ContractView {
  return {
    id: 'contract-1',
    contractNo: 'WT2026-0001',
    contractType: 'FORMAL',
    title: '正式委托合同-张三',
    customerId: 'customer-1',
    sourceType: 'CUSTOMER',
    sourceId: null,
    negotiationId: null,
    parentContractId: null,
    templateCode: 'FORMAL_STANDARD',
    templateVersion: 1,
    branchId: null,
    professionalTeamId: null,
    amount: '50000.00',
    receivedAmount: '20000.00',
    status: 'EFFECTIVE',
    submittedBy: 'user-1',
    submittedAt: '2026-07-30T01:00:00.000Z',
    approvedBy: 'user-1',
    approvedAt: '2026-07-30T01:00:00.000Z',
    approvalComment: null,
    signDate: '2026-07-30T01:00:00.000Z',
    esignLinkId: null,
    esignSerialNo: null,
    esignStatus: null,
    effectiveDate: '2026-07-31T01:00:00.000Z',
    terminatedAt: null,
    terminateReason: null,
    voidedAt: null,
    voidReason: null,
    startDate: '2026-07-31',
    endDate: null,
    paymentTerms: null,
    terms: null,
    createdBy: 'user-1',
    updatedBy: null,
    version: 1,
    createdAt: '2026-07-30T01:00:00.000Z',
    updatedAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
  };
}

function planFixture(overrides: Partial<PaymentPlanView> = {}): PaymentPlanView {
  return {
    id: 'plan-1',
    planNo: 'PLAN2026-0001',
    contractId: 'contract-1',
    period: 1,
    dueDate: '2026-08-31T00:00:00.000Z',
    amount: '30000.00',
    receivedAmount: '0.00',
    status: 'PENDING',
    version: 1,
    createdBy: 'user-1',
    createdAt: '2026-07-31T01:00:00.000Z',
    updatedAt: '2026-07-31T01:00:00.000Z',
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/contracts/contract-1']}>
      <Routes>
        <Route path="/contracts/:id" element={<ContractDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useContractStore.getState().reset();
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle' });
});

test('terminate modal shows unsettled plan count when N>0', async () => {
  contractApi.detail.mockResolvedValue(apiRes(contractFixture()));
  contractApi.plans.mockResolvedValue(apiRes([
    planFixture({ id: 'plan-1', status: 'PENDING' }),
    planFixture({ id: 'plan-2', planNo: 'PLAN2026-0002', period: 2, amount: '20000.00', receivedAmount: '5000.00', status: 'PARTIAL' }),
    planFixture({ id: 'plan-3', planNo: 'PLAN2026-0003', period: 3, amount: '20000.00', receivedAmount: '20000.00', status: 'RECEIVED' }),
  ]));
  paymentApi.list.mockResolvedValue(apiRes(pageOf([])));
  grantPermissions(['contract.terminate', 'payment.read']);

  renderPage();
  expect(await screen.findByText('WT2026-0001')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /终\s*止/ }));
  // PENDING + PARTIAL = 2 个未清；RECEIVED 不计入。
  expect(await screen.findByText('将取消 2 个未清付款计划')).toBeInTheDocument();
});

test('terminate modal shows no-plan message when N=0', async () => {
  contractApi.detail.mockResolvedValue(apiRes(contractFixture()));
  contractApi.plans.mockResolvedValue(apiRes([
    planFixture({ id: 'plan-1', status: 'RECEIVED', receivedAmount: '30000.00' }),
  ]));
  paymentApi.list.mockResolvedValue(apiRes(pageOf([])));
  grantPermissions(['contract.terminate', 'payment.read']);

  renderPage();
  expect(await screen.findByText('WT2026-0001')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /终\s*止/ }));
  expect(await screen.findByText('无未清付款计划')).toBeInTheDocument();
  expect(screen.queryByText(/将取消 \d+ 个未清付款计划/)).not.toBeInTheDocument();
});

test('terminate confirm refreshes plan list to CANCELLED state', async () => {
  contractApi.detail
    .mockResolvedValueOnce(apiRes(contractFixture()))
    .mockResolvedValueOnce(apiRes(contractFixture({
      status: 'TERMINATED',
      terminatedAt: '2026-08-01T02:00:00.000Z',
      terminateReason: '客户原因',
    })));
  contractApi.plans
    .mockResolvedValueOnce(apiRes([
      planFixture({ id: 'plan-1', status: 'PENDING' }),
      planFixture({ id: 'plan-2', planNo: 'PLAN2026-0002', period: 2, amount: '20000.00', receivedAmount: '20000.00', status: 'RECEIVED' }),
    ]))
    .mockResolvedValueOnce(apiRes([
      planFixture({ id: 'plan-1', status: 'CANCELLED' }),
      planFixture({ id: 'plan-2', planNo: 'PLAN2026-0002', period: 2, amount: '20000.00', receivedAmount: '20000.00', status: 'RECEIVED' }),
    ]));
  contractApi.terminate.mockResolvedValue(apiRes(contractFixture({
    status: 'TERMINATED',
    terminatedAt: '2026-08-01T02:00:00.000Z',
    terminateReason: '客户原因',
  })));
  paymentApi.list.mockResolvedValue(apiRes(pageOf([])));
  grantPermissions(['contract.terminate', 'payment.read']);

  renderPage();
  expect(await screen.findByText('WT2026-0001')).toBeInTheDocument();
  expect(screen.queryByText('已取消')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /终\s*止/ }));
  await screen.findByText('将取消 1 个未清付款计划');
  fireEvent.change(screen.getByPlaceholderText('必填'), { target: { value: '客户原因' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*认/ }));

  // 确认后计划列表出现 CANCELLED 态；amount/receivedAmount 照常显示（后端保留原始期望额与实际已收）。
  expect(await screen.findByText('已取消')).toBeInTheDocument();
  expect(screen.getByText('30000.00')).toBeInTheDocument();
  expect(screen.getByText('0.00')).toBeInTheDocument();
  expect(contractApi.terminate).toHaveBeenCalledWith('contract-1', { reason: '客户原因' });
});

test('renders CANCELLED plan status with amounts intact when detail already carries it', async () => {
  grantPermissions(['payment.read']);
  contractApi.detail.mockResolvedValue(apiRes(contractFixture({
    status: 'TERMINATED',
    terminatedAt: '2026-08-01T02:00:00.000Z',
    terminateReason: '客户原因',
  })));
  contractApi.plans.mockResolvedValue(apiRes([
    planFixture({ id: 'plan-1', status: 'CANCELLED' }),
    planFixture({ id: 'plan-2', planNo: 'PLAN2026-0002', period: 2, amount: '20000.00', receivedAmount: '20000.00', status: 'RECEIVED' }),
  ]));
  paymentApi.list.mockResolvedValue(apiRes(pageOf([])));

  renderPage();

  expect(await screen.findByText('已取消')).toBeInTheDocument();
  // 已取消计划保留原始期望额与实际已收，不作隐藏/替换。
  expect(screen.getByText('30000.00')).toBeInTheDocument();
  expect(screen.getByText('0.00')).toBeInTheDocument();
  expect(screen.queryByText('待收款')).not.toBeInTheDocument();
});

test('contract-only users can submit without requesting financial records', async () => {
  contractApi.detail.mockResolvedValue(apiRes(contractFixture({ status: 'DRAFT', contractType: 'RISK_NOTICE' })));
  grantPermissions(['contract.read', 'contract.submit']);
  renderPage();
  expect(await screen.findByRole('button', { name: /提\s*交/ })).toBeEnabled();
  expect(screen.getByText('未授权查看应收计划和收款记录')).toBeInTheDocument();
  expect(contractApi.plans).not.toHaveBeenCalled();
  expect(paymentApi.list).not.toHaveBeenCalled();
});
