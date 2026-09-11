// SPEC-031 Task 2: 客户详情页「经营分析」区块测试（复购/转介绍指标渲染，非恒真）。
// SPEC-039 Task 2: +转介绍登记/列表/权限门控用例。
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import CustomerDetailPage from '../CustomerDetailPage';
import { useCustomerStore } from '@/stores/customer-store';
import { useAuthStore } from '@/stores/authStore';
import type { CustomerView, LeadView } from '@/api/types';
import type { PermissionCode } from '@/features/authorization/types';

const customerApiMock = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  update: vi.fn(),
  listContacts: vi.fn(),
  addContact: vi.fn(),
  updateContact: vi.fn(),
  removeContact: vi.fn(),
  createReferral: vi.fn(),
  listReferrals: vi.fn(),
}));
vi.mock('@/api/customer', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/customer')>();
  return { ...original, customerApi: customerApiMock };
});

function referralFixture(overrides: Partial<LeadView> = {}): LeadView {
  return {
    id: 'lead-ref-1',
    leadNo: 'L202608050001',
    name: '转介绍线索甲',
    phone: '139****1111',
    wechat: null,
    channelId: null,
    sourceType: 'REFERRAL',
    sourceDetail: null,
    campaignId: null,
    referralCustomerId: 'cust-1',
    intentionLevel: 4,
    status: 'NEW',
    poolStatus: 'PUBLIC',
    branchId: null,
    professionalTeamId: null,
    assignedTo: null,
    assignedAt: null,
    firstResponseSeconds: null,
    isValid: true,
    invalidReason: null,
    tags: null,
    createdBy: 'user-1',
    version: 1,
    createdAt: '2026-08-05T01:00:00.000Z',
    updatedAt: '2026-08-05T01:00:00.000Z',
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

function customerFixture(overrides: Partial<CustomerView> = {}): CustomerView {
  return {
    id: 'cust-1',
    customerNo: 'CU-001',
    name: '复购客户',
    phone: '138****8888',
    wechat: null,
    email: null,
    address: null,
    status: 'SIGNED',
    customerType: 'INDIVIDUAL',
    sourceLeadId: null,
    tags: null,
    remark: null,
    createdBy: 'user-1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    contractCount: 3,
    repurchaseCount: 2,
    referralCount: 1,
    firstContractAt: '2026-02-01T00:00:00.000Z',
    latestContractAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCustomerStore.setState({
    detail: { customer: null, contacts: [], loading: true, error: null },
  });
  useAuthStore.setState({ authorization: null, authorizationStatus: 'idle' });
});

test('renders the customer 经营分析 card with repurchase and referral metrics (SPEC-031)', async () => {
  useCustomerStore.setState({
    detail: {
      customer: customerFixture(),
      contacts: [],
      loading: false,
      error: null,
    },
  });
  render(
    <MemoryRouter initialEntries={['/customers/cust-1']}>
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

  // 经营分析卡渲染指标（非恒真：复购数/转介绍数/首单/最近单时间）。
  expect(await screen.findByTestId('customer-analytics')).toBeInTheDocument();
  expect(screen.getByText('合同数')).toBeInTheDocument();
  expect(screen.getByText('复购数')).toBeInTheDocument();
  expect(screen.getByText('转介绍数')).toBeInTheDocument();
  // 指标值：合同数 3 / 复购数 2（含「复购客户」Tag）/ 转介绍数 1 / 首单 2026-02-01。
  // 「复购客户」出现在标题 + 复购 Tag 两处——用 getAllByText 断言 ≥1。
  expect(screen.getAllByText('复购客户').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText('2026-02-01')).toBeInTheDocument();
  expect(screen.getByText('2026-07-01')).toBeInTheDocument();
});

test('renders zero metrics when the customer has no contracts or referrals (SPEC-031)', () => {
  useCustomerStore.setState({
    detail: {
      customer: customerFixture({
        contractCount: 0,
        repurchaseCount: 0,
        referralCount: 0,
        firstContractAt: null,
        latestContractAt: null,
      }),
      contacts: [],
      loading: false,
      error: null,
    },
  });
  render(
    <MemoryRouter initialEntries={['/customers/cust-1']}>
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(screen.getByTestId('customer-analytics')).toBeInTheDocument();
  // 零指标：首单/最近单时间缺省渲染为 '-'（占位符多于 0 个）。
  expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  // 无复购 → 合同数/复购数显示 0。
  expect(screen.getAllByText('0').length).toBeGreaterThan(0);
});

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/customers/cust-1']}>
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('renders the customer referral list with lead data (SPEC-039)', async () => {
  grantPermissions(['lead.read']);
  useCustomerStore.setState({
    detail: { customer: customerFixture(), contacts: [], loading: false, error: null },
  });
  customerApiMock.listReferrals.mockResolvedValue({
    code: 200, message: 'success',
    data: { list: [referralFixture()], page: 1, pageSize: 50, total: 1 },
  });
  renderDetail();

  expect(await screen.findByText('转介绍线索甲')).toBeInTheDocument();
  expect(screen.getByText('L202608050001')).toBeInTheDocument();
  expect(customerApiMock.listReferrals).toHaveBeenCalledWith('cust-1', expect.objectContaining({ page: 1 }));
});

test('registers a referral lead from the customer detail modal (SPEC-039)', async () => {
  grantPermissions(['lead.create']);
  useCustomerStore.setState({
    detail: { customer: customerFixture(), contacts: [], loading: false, error: null },
  });
  customerApiMock.createReferral.mockResolvedValue({ code: 200, message: 'success', data: referralFixture() });
  customerApiMock.listReferrals.mockResolvedValue({ code: 200, message: 'success', data: { list: [], page: 1, pageSize: 50, total: 0 } });
  renderDetail();

  fireEvent.click(await screen.findByRole('button', { name: /登记转介绍/ }));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByRole('textbox', { name: '转介绍人姓名' }), { target: { value: '王五' } });
  fireEvent.change(screen.getByRole('textbox', { name: '电话' }), { target: { value: '13900001111' } });
  fireEvent.click(screen.getByRole('button', { name: /确\s*定/ }));

  await waitFor(() => expect(customerApiMock.createReferral).toHaveBeenCalledWith(
    'cust-1',
    expect.objectContaining({ name: '王五', phone: '13900001111', intentionLevel: 3 }),
  ));
});

test('hides the register referral button without lead.create permission (SPEC-039)', async () => {
  useCustomerStore.setState({
    detail: { customer: customerFixture(), contacts: [], loading: false, error: null },
  });
  renderDetail();

  expect(await screen.findByTestId('customer-analytics')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /登记转介绍/ })).not.toBeInTheDocument();
});
