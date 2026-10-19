import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import FinanceRecordPage, { type FinanceKind } from '../FinanceRecordPage';
import { useAuthStore } from '@/stores/authStore';
import type { PermissionCode } from '@/features/authorization/types';
const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  confirm: vi.fn(),
  void: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  complete: vi.fn(),
  execute: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/api/payment', () => ({
  paymentApi: { detail: mocks.detail, confirm: mocks.confirm, void: mocks.void },
}));
vi.mock('@/api/invoice', () => ({
  invoiceApi: {
    detail: mocks.detail,
    approve: mocks.approve,
    reject: mocks.reject,
    complete: mocks.complete,
  },
}));
vi.mock('@/api/refund', () => ({
  refundApi: { detail: mocks.detail, approve: mocks.approve, reject: mocks.reject, execute: mocks.execute },
}));
vi.mock('@/api/cost', () => ({
  costApi: { detail: mocks.detail, remove: mocks.remove },
  COST_CATEGORIES: [],
}));
vi.mock('@/features/crm/BusinessWorkspacePage', () => ({ BusinessTableLinks: () => null }));
vi.mock('@/features/auth/useStepUp', () => ({ useStepUp: () => ({ run: vi.fn(), dialogProps: {} }) }));
vi.mock('@/features/auth/components/StepUpDialog', () => ({ default: () => null }));
const record = {
  id: 'original-id',
  paymentNo: 'PAY-original',
  invoiceNo: 'INV-original',
  requestNo: 'REQ-original',
  amount: '9999999999999999.99',
  status: 'PENDING',
  version: 7,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};
function permissions(codes: PermissionCode[]) {
  useAuthStore.setState({
    authorization: {
      userId: 'u',
      employeeId: null,
      isSystemAdmin: false,
      isSystemSuperAdmin: false,
      permissions: codes,
      menus: [],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
  });
}
function open(kind: FinanceKind, status = 'PENDING') {
  mocks.detail.mockResolvedValue({ data: { ...record, status } });
  return render(
    <MemoryRouter initialEntries={['/record/original-id']}>
      <Routes>
        <Route path="/record/:id" element={<FinanceRecordPage kind={kind} />} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const action of ['confirm', 'void', 'approve', 'reject', 'complete', 'execute'] as const)
    mocks[action].mockResolvedValue({ data: { ...record, status: 'COMPLETED' } });
  mocks.remove.mockResolvedValue({ data: null });
  permissions([]);
});
test.each([
  ['payment', 'PENDING', 'payment.confirm', '确认收款'],
  ['payment', 'CONFIRMED', 'payment.void', '冲销收款'],
  ['invoice', 'PENDING', 'invoice.approve', '审批通过'],
  ['invoice', 'APPROVED', 'invoice.complete', '完成开票'],
  ['refund', 'APPROVED', 'refund.execute', '执行退款减免'],
  ['cost', 'PENDING', 'cost.delete', '删除成本'],
] as const)('%s %s exposes %s only to the authorized operator', async (kind, status, permission, label) => {
  permissions([(kind + '.read') as PermissionCode]);
  const view = open(kind, status);
  await screen.findByText('9,999,999,999,999,999.99');
  expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  view.unmount();
  permissions([(kind + '.read') as PermissionCode, permission]);
  open(kind, status);
  expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
});
test('payment reversal requires a nonblank reason and uses the original payment ID', async () => {
  permissions(['payment.read', 'payment.void']);
  open('payment', 'CONFIRMED');
  fireEvent.click(await screen.findByRole('button', { name: '冲销收款' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '确认办理' }));
  await screen.findByText(/请输入|Please enter|is required/);
  expect(mocks.void).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText('冲销原因'), { target: { value: '  原收款重复登记  ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认办理' }));
  await waitFor(() => expect(mocks.void).toHaveBeenCalledWith('original-id', { reason: '原收款重复登记' }));
});
test('invoice approval failure retains the comment and does not complete an invoice', async () => {
  mocks.approve.mockRejectedValue({ response: { status: 409, data: { message: '版本冲突' } } });
  permissions(['invoice.read', 'invoice.approve']);
  open('invoice');
  fireEvent.click(await screen.findByRole('button', { name: '审批通过' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('办理意见'), { target: { value: '核对原票据' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认办理' }));
  await screen.findByText('版本冲突');
  expect(within(dialog).getByLabelText('办理意见')).toHaveValue('核对原票据');
  expect(mocks.complete).not.toHaveBeenCalled();
});
test('deleting a cost requires explicit confirmation and cancellation leaves the row intact', async () => {
  permissions(['cost.read', 'cost.delete']);
  open('cost');
  fireEvent.click(await screen.findByRole('button', { name: '删除成本' }));
  const dialog = await screen.findByRole('dialog');
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: /Cancel|取\s*消/ }));
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '删除成本' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认办理' }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('original-id'));
});
