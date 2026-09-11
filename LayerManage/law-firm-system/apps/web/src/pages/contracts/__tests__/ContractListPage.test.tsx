import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import ContractListPage from '../ContractListPage';
import { availableContractActions } from '../meta';
import { useContractStore } from '@/stores/contract-store';
import { useAuthStore } from '@/stores/authStore';
import type { ContractStatus, ContractType, ContractView } from '@/api/contract';
import type { PermissionCode } from '@/features/authorization/types';

const api = vi.hoisted(() => ({
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
  return { ...original, contractApi: api };
});

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
    receivedAmount: '0.00',
    status: 'DRAFT',
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    approvalComment: null,
    signDate: null,
    esignLinkId: null,
    esignSerialNo: null,
    esignStatus: null,
    effectiveDate: null,
    terminatedAt: null,
    terminateReason: null,
    voidedAt: null,
    voidReason: null,
    startDate: null,
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

function pageOf(list: ContractView[], total = list.length) {
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
  useContractStore.getState().reset();
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle' });
});

test('renders the contract list with server data', async () => {
  api.list.mockResolvedValue(pageOf([contractFixture()]));
  render(<MemoryRouter><ContractListPage /></MemoryRouter>);

  expect(await screen.findByText('WT2026-0001')).toBeInTheDocument();
  expect(screen.getByText('正式委托合同-张三')).toBeInTheDocument();
  expect(screen.getByText('50000.00')).toBeInTheDocument();
  expect(screen.getByText('正式委托')).toBeInTheDocument();
  expect(screen.getByText('草稿')).toBeInTheDocument();
  expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
});

test('filter interaction fires list query with keyword, type and status params', async () => {
  api.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><ContractListPage /></MemoryRouter>);
  await screen.findByText('暂无合同');

  fireEvent.change(screen.getByPlaceholderText('搜索合同编号/标题'), { target: { value: 'WT2026' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '类型筛选' }));
  fireEvent.click(await screen.findByText('首签合同'));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '状态筛选' }));
  fireEvent.click(await screen.findByText('待审批'));
  fireEvent.click(screen.getByRole('button', { name: /搜\s*索/ }));

  await waitFor(() => expect(api.list).toHaveBeenCalledWith(
    expect.objectContaining({
      page: 1,
      pageSize: 10,
      keyword: 'WT2026',
      contractType: 'FIRST_SIGN',
      status: 'PENDING_APPROVAL',
    }),
  ));
});

test('shows the empty state when the server returns no contracts', async () => {
  api.list.mockResolvedValue(pageOf([]));
  render(<MemoryRouter><ContractListPage /></MemoryRouter>);

  expect(await screen.findByText('暂无合同')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('shows an error state when the list request fails', async () => {
  api.list.mockRejectedValue(new Error('网络错误'));
  render(<MemoryRouter><ContractListPage /></MemoryRouter>);

  expect(await screen.findByText('合同列表加载失败')).toBeInTheDocument();
  expect(screen.getByText('网络错误')).toBeInTheDocument();
});

test('hides the create button without contract.create and shows it with the code', async () => {
  api.list.mockResolvedValue(pageOf([]));
  const { unmount } = render(<MemoryRouter><ContractListPage /></MemoryRouter>);
  await screen.findByText('暂无合同');
  expect(screen.queryByRole('button', { name: /新建合同/ })).not.toBeInTheDocument();
  unmount();

  grantPermissions(['contract.create']);
  render(<MemoryRouter><ContractListPage /></MemoryRouter>);
  await screen.findAllByText('暂无合同');
  expect(screen.getByRole('button', { name: /新建合同/ })).toBeInTheDocument();
});

// ===== 状态机按钮可用性矩阵（镜像后端 canTransitionContract）=====

const MATRIX: Array<[ContractType, ContractStatus, string[]]> = [
  ['FORMAL', 'DRAFT', ['submit', 'void']],
  ['FORMAL', 'PENDING_APPROVAL', ['approve', 'reject', 'void']],
  ['FORMAL', 'PENDING_SIGN', ['sign', 'void']],
  ['FORMAL', 'SIGNED', ['effect']],
  ['FORMAL', 'EFFECTIVE', ['terminate']],
  ['FORMAL', 'TERMINATED', []],
  ['FORMAL', 'VOID', []],
  ['FIRST_SIGN', 'DRAFT', ['submit', 'void']],
  ['FIRST_SIGN', 'SIGNED', ['effect']],
  ['SUPPLEMENT', 'PENDING_APPROVAL', ['approve', 'reject', 'void']],
  ['RISK_NOTICE', 'DRAFT', ['submit', 'void']],
  ['RISK_NOTICE', 'PENDING_SIGN', ['sign', 'void']],
  // RISK_NOTICE 无生效——签署即终态（政策门禁先于流转表）。
  ['RISK_NOTICE', 'SIGNED', []],
  ['RISK_NOTICE', 'EFFECTIVE', ['terminate']],
];

test('availableContractActions matches the backend state machine matrix', () => {
  for (const [type, status, expected] of MATRIX) {
    expect(availableContractActions(type, status), `${type}/${status}`).toEqual(expected);
  }
});
