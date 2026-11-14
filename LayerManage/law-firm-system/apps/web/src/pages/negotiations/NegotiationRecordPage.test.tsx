import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import NegotiationRecordPage from './NegotiationRecordPage';
import NegotiationList from './NegotiationList';
import { negotiationApi } from '@/api/negotiation';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/api/negotiation', () => ({
  negotiationApi: { detail: vi.fn(), update: vi.fn(), close: vi.fn(), list: vi.fn() },
}));
vi.mock('@/features/crm/BusinessWorkspacePage', () => ({ BusinessTableLinks: () => null }));
vi.mock('@/features/workspaces/api', () => ({
  get: async (url: string) =>
    url === '/workspaces'
      ? { workspaces: [{ id: 'w', name: '工作区' }] }
      : { employees: [{ id: 'e', name: '谈案人甲' }], organizations: [] },
  errorMessage: () => '请求失败',
}));
const record = {
  id: 'n',
  negotiationNo: 'NE-1',
  status: 'NEGOTIATING',
  negotiatorEmployeeId: 'e',
  quotedAmount: '100.00',
  remark: '原备注',
  customerId: 'c',
};
beforeEach(() => {
  useAuthStore.setState({ hasPermission: () => true });
  vi.mocked(negotiationApi.detail).mockResolvedValue({ data: record } as never);
  vi.mocked(negotiationApi.update).mockImplementation(
    async (_, data) => ({ data: { ...record, ...data } }) as never,
  );
  vi.mocked(negotiationApi.close).mockResolvedValue({ data: { ...record, status: 'SIGNED' } } as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function openEditor() {
  render(
    <MemoryRouter initialEntries={['/negotiations/n']}>
      <Routes>
        <Route path="/negotiations/:id" element={<NegotiationRecordPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByDisplayValue('原备注');
}
test('saving displays success and sends cleared quote as null', async () => {
  await openEditor();
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '修改备注' } });
  fireEvent.change(screen.getByLabelText('报价金额'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '保存谈案' }));
  await screen.findByText('谈案已保存，可返回谈案工作表查看。');
  expect(negotiationApi.update).toHaveBeenCalledWith(
    'n',
    expect.objectContaining({ remark: '修改备注', quotedAmount: null }),
  );
});
test('closing saves pending edits before completing the original record', async () => {
  await openEditor();
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '完结前的备注' } });
  fireEvent.click(screen.getByRole('button', { name: '完结谈案' }));
  const modal = await screen.findByRole('dialog');
  fireEvent.click(within(modal).getByRole('button', { name: '确认完结' }));
  await screen.findByText('谈案已完结，结果已更新到原谈案记录，可返回谈案工作表查看。');
  expect(negotiationApi.update).toHaveBeenCalledWith(
    'n',
    expect.objectContaining({ remark: '完结前的备注' }),
  );
  expect(negotiationApi.close).toHaveBeenCalledWith('n', { outcome: 'SIGNED' });
  expect(vi.mocked(negotiationApi.update).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(negotiationApi.close).mock.invocationCallOrder[0],
  );
});
test('failed draft save prevents closing and shows the error inside the modal', async () => {
  vi.mocked(negotiationApi.update).mockRejectedValue(new Error('failed'));
  await openEditor();
  fireEvent.click(screen.getByRole('button', { name: '完结谈案' }));
  const modal = await screen.findByRole('dialog');
  fireEvent.click(within(modal).getByRole('button', { name: '确认完结' }));
  await within(modal).findByText('未能完结谈案：请求失败');
  expect(negotiationApi.close).not.toHaveBeenCalled();
});
test('switching from unsigned to signed does not submit a stale unsigned reason', async () => {
  await openEditor();
  fireEvent.click(screen.getByRole('button', { name: '完结谈案' }));
  const modal = await screen.findByRole('dialog');
  fireEvent.mouseDown(within(modal).getByRole('combobox'));
  fireEvent.click(await screen.findByText('未签约'));
  fireEvent.change(await within(modal).findByLabelText('未签原因'), { target: { value: '原未签原因' } });
  fireEvent.mouseDown(within(modal).getByRole('combobox'));
  fireEvent.click(await screen.findByText('已签约'));
  fireEvent.click(within(modal).getByRole('button', { name: '确认完结' }));
  await waitFor(() => expect(negotiationApi.close).toHaveBeenCalledWith('n', { outcome: 'SIGNED' }));
});
test('formal list displays closed and ongoing records without a connected workspace table', async () => {
  vi.mocked(negotiationApi.list).mockResolvedValue({
    data: { list: [record, { ...record, id: 'closed', negotiationNo: 'NE-2', status: 'SIGNED' }], total: 2 },
  } as never);
  render(
    <MemoryRouter>
      <NegotiationList />
    </MemoryRouter>,
  );
  await screen.findByText('NE-2');
  expect(screen.getByText('NE-1')).toBeTruthy();
  await waitFor(() =>
    expect(negotiationApi.list).toHaveBeenCalledWith({ page: 1, pageSize: 20, status: undefined }),
  );
});
