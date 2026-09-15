import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import FinanceRecordPage from '../FinanceRecordPage';
import FinanceCreatePage from '../FinanceCreatePage';
import { useAuthStore } from '@/stores/authStore';
const mocks = vi.hoisted(() => ({
  paymentDetail: vi.fn(),
  costDetail: vi.fn(),
  costCreate: vi.fn(),
  costUpdate: vi.fn(),
  refundDetail: vi.fn(),
  refundApprove: vi.fn(),
  run: vi.fn(),
}));
vi.mock('@/api/payment', () => ({ paymentApi: { detail: mocks.paymentDetail } }));
vi.mock('@/api/refund', () => ({ refundApi: { detail: mocks.refundDetail, approve: mocks.refundApprove } }));
vi.mock('@/api/cost', () => ({
  COST_CATEGORIES: ['OFFICE'],
  costApi: { detail: mocks.costDetail, create: mocks.costCreate, update: mocks.costUpdate },
}));
vi.mock('@/features/auth/useStepUp', () => ({ useStepUp: () => ({ run: mocks.run, dialogProps: {} }) }));
vi.mock('@/features/auth/components/StepUpDialog', () => ({ default: () => null }));
vi.mock('@/features/crm/BusinessWorkspacePage', () => ({ BusinessTableLinks: () => null }));
vi.mock('@/features/workspaces/api', () => ({
  get: vi.fn(async (url: string) =>
    url === '/workspaces'
      ? { workspaces: [{ id: 'workspace', name: '财务工作区' }] }
      : { organizations: [{ id: 'org', name: '本部' }], employees: [], users: [], teams: [] },
  ),
}));
const row = {
  id: 'cost-1',
  category: 'OFFICE',
  amount: '123.45',
  occurredAt: '2026-09-15T00:00:00Z',
  note: '原备注',
  version: 4,
  createdAt: '2026-09-15T00:00:00Z',
  updatedAt: '2026-09-15T00:00:00Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.costDetail.mockResolvedValue({ data: row });
  mocks.costUpdate.mockResolvedValue({ data: { ...row, version: 5 } });
  mocks.costCreate.mockResolvedValue({ data: { ...row, id: 'saved' } });
  mocks.paymentDetail.mockResolvedValue({
    data: { ...row, id: 'payment-1', paymentNo: 'PAY-001', status: 'PENDING' },
  });
  mocks.refundDetail.mockResolvedValue({
    data: {
      ...row,
      id: 'refund-1',
      requestNo: 'RF-001',
      status: 'PENDING',
      type: 'WAIVER',
      reason: '申请减免',
    },
  });
  useAuthStore.setState({
    authorization: {
      userId: 'u',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions: [
        'cost.read',
        'cost.create',
        'cost.update',
        'payment.read',
        'refund.read',
        'refund.approve',
      ],
      menus: [],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
});
function open(kind: 'cost' | 'payment' | 'refund') {
  return render(
    <MemoryRouter initialEntries={['/record/' + kind + '-1']}>
      <Routes>
        <Route path="/record/:id" element={<FinanceRecordPage kind={kind} />} />
      </Routes>
    </MemoryRouter>,
  );
}
test('background refresh preserves cost draft and version captured when the editor opened', async () => {
  open('cost');
  fireEvent.click(await screen.findByRole('button', { name: '编辑成本' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('备注'), { target: { value: '未提交草稿' } });
  mocks.costDetail.mockResolvedValue({ data: { ...row, version: 9, note: '其他会话修改' } });
  fireEvent(window, new Event('focus'));
  await screen.findByText('其他会话修改');
  expect(within(dialog).getByLabelText('备注')).toHaveValue('未提交草稿');
  fireEvent.click(within(dialog).getByRole('button', { name: '确认办理' }));
  await waitFor(() =>
    expect(mocks.costUpdate).toHaveBeenCalledWith(
      'cost-1',
      expect.objectContaining({ note: '未提交草稿', version: 4, amount: '123.45' }),
    ),
  );
});
test('a denied detail refresh clears cached financial data', async () => {
  open('payment');
  await screen.findByText('PAY-001');
  mocks.paymentDetail.mockRejectedValue({ response: { status: 403, data: { message: '已撤权' } } });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(screen.queryByText('PAY-001')).not.toBeInTheDocument());
  expect(screen.queryByText('123.45')).not.toBeInTheDocument();
});
test('refund approval binds the displayed version and cancellation leaves the action available', async () => {
  mocks.run.mockRejectedValue(new Error('STEP_UP_CANCELLED'));
  open('refund');
  fireEvent.click(await screen.findByRole('button', { name: '审批通过' }));
  fireEvent.click((await screen.findByRole('dialog')).querySelector('button.ant-btn-primary')!);
  await waitFor(() =>
    expect(mocks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'REFUND_APPROVE',
        target: { refundRequestId: 'refund-1', expectedVersion: 4 },
      }),
    ),
  );
  expect(mocks.refundApprove).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
test('a lost create response retains the decimal payload and the same persisted request key', async () => {
  mocks.costCreate.mockRejectedValueOnce(new Error('NETWORK_UNKNOWN'));
  render(
    <MemoryRouter initialEntries={['/costs/new?workspace=workspace']}>
      <Routes>
        <Route path="/costs/new" element={<FinanceCreatePage kind="cost" />} />
        <Route path="/costs/saved" element={<p>已进入正式单据</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText('财务工作区');
  const input = screen.getByRole('spinbutton', { name: '单据金额' });
  fireEvent.change(input, { target: { value: '9999999999999999.99' } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole('button', { name: '保存单据' }));
  await waitFor(() => expect(mocks.costCreate).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '保存单据' }));
  await screen.findByText('已进入正式单据');
  const first = mocks.costCreate.mock.calls[0][0];
  expect(first.amount).toBe('9999999999999999.99');
  expect(first.idempotencyKey).toBeTruthy();
  expect(mocks.costCreate.mock.calls[1][0]).toEqual(first);
});


test('leaving a refund detail during identity verification prevents the later approval mutation', async () => {
  mocks.run.mockImplementation(() => new Promise(() => {}));
  const view = open('refund');
  fireEvent.click(await screen.findByRole('button', { name: '审批通过' }));
  fireEvent.click((await screen.findByRole('dialog')).querySelector('button.ant-btn-primary')!);
  await waitFor(() => expect(mocks.run).toHaveBeenCalled());
  const request = mocks.run.mock.calls[0][0];
  view.unmount();
  expect(() => request.mutate('late-token')).toThrow('STEP_UP_CANCELLED');
  expect(mocks.refundApprove).not.toHaveBeenCalled();
});
