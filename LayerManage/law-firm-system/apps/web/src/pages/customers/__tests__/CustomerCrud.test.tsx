import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import CustomerListPage from '../CustomerListPage';
import CustomerDetailPage from '../CustomerDetailPage';
import { useCustomerStore } from '@/stores/customer-store';
import { useAuthStore } from '@/stores/authStore';
import type { CustomerView } from '@/api/types';
import type { PermissionCode } from '@/features/authorization/types';

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), listContacts: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('@/api/customer', () => ({ customerApi: api }));
const customer: CustomerView = {
  id: 'customer-1', customerNo: 'CU-001', name: '测试客户', phone: '138****1234', wechat: '***',
  email: 'old@example.test', address: '原地址', status: 'POTENTIAL', customerType: 'INDIVIDUAL',
  sourceLeadId: null, tags: '标签', remark: '原备注', createdBy: 'user-1', version: 3, createdAt: '2026-09-14T01:00:00Z',
  contractCount: 0, repurchaseCount: 0, referralCount: 0, firstContractAt: null, latestContractAt: null,
};
function grant(permissions: PermissionCode[]) {
  useAuthStore.setState({ authorization: {
    userId: 'user-1', employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: false,
    permissions, menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString(),
  }, authorizationStatus: 'ready' });
}
function page(edit = false) {
  render(<ConfigProvider locale={zhCN} theme={{ token: { motion: false } }}><MemoryRouter initialEntries={edit ? [{ pathname: '/customers/customer-1', state: { editCustomer: true } }] : ['/customers']}>
    <Routes><Route path="/customers" element={<CustomerListPage />} /><Route path="/customers/:id" element={<CustomerDetailPage />} /></Routes>
  </MemoryRouter></ConfigProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  useCustomerStore.getState().reset();
  grant(['customer.read', 'customer.update', 'customer.delete']);
  api.list.mockImplementation(async params => ({ data: { list: [customer], total: 1, page: params.page, pageSize: params.pageSize } }));
  api.detail.mockResolvedValue({ data: customer });
  api.listContacts.mockResolvedValue({ data: [] });
  api.update.mockResolvedValue({ data: { ...customer, name: '修改客户', version: 4 } });
  api.remove.mockResolvedValue({ data: null });
});

test('list queries and reset use current filters, and query opens the selected detail', async () => {
  page();
  await screen.findByRole('button', { name: '查询' });
  fireEvent.change(screen.getByPlaceholderText('搜索姓名/电话/编号'), { target: { value: '13800001234' } });
  fireEvent.click(screen.getByRole('button', { name: /搜索/ }));
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: '13800001234', page: 1 })));
  fireEvent.click(screen.getByRole('button', { name: /重置/ }));
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 }));
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  expect(await screen.findByText('基本信息')).toBeInTheDocument();
  expect(api.detail).toHaveBeenCalledWith(customer.id);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('list modify opens a populated draggable form; clears ordinary fields without submitting sensitive masks and includes version', async () => {
  page();
  fireEvent.click(await screen.findByRole('button', { name: '修改' }));
  const dialog = await screen.findByRole('dialog', { name: '编辑客户档案' });
  expect(within(dialog).getByLabelText('姓名')).toHaveValue(customer.name);
  expect(within(dialog).getByLabelText('电话（留空则不修改）')).toHaveValue('');
  expect(within(dialog).getByLabelText('微信（留空则不修改）')).toHaveValue('');
  fireEvent.change(within(dialog).getByLabelText('姓名'), { target: { value: '修改客户' } });
  fireEvent.change(within(dialog).getByLabelText('邮箱'), { target: { value: '' } });
  fireEvent.change(within(dialog).getByLabelText('备注'), { target: { value: '' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确.*定/ }));
  await waitFor(() => expect(api.update).toHaveBeenCalledWith(customer.id, expect.objectContaining({ name: '修改客户', email: '', remark: '', version: 3 })));
  const payload = api.update.mock.calls[0][1];
  expect(payload).not.toHaveProperty('phone');
  expect(payload).not.toHaveProperty('wechat');
});

test('cancel does not save and reopening clears unsaved phone; invalid new phone blocks save', async () => {
  page(true);
  let dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('电话（留空则不修改）'), { target: { value: '13900001111' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /取.*消/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /编辑档案/ }));
  dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByLabelText('电话（留空则不修改）')).toHaveValue('');
  fireEvent.change(within(dialog).getByLabelText('电话（留空则不修改）'), { target: { value: 'abc' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确.*定/ }));
  await waitFor(() => expect(dialog.querySelector('.ant-form-item-explain-error')).toBeTruthy());
  expect(api.update).not.toHaveBeenCalled();
});

test('delete needs confirmation, cancels safely and returns to a valid page after deleting the final row', async () => {
  api.list.mockResolvedValue({ data: { list: [customer], total: 11, page: 2, pageSize: 10 } });
  page();
  fireEvent.click(await screen.findByRole('button', { name: '删除' }));
  // AntD uses a shared test-id for Select and Modal under NODE_ENV=test; inspect the rendered title directly.
  let dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('删除客户')).toBeInTheDocument();
  expect(within(dialog).getByText(/CU-001/)).toHaveTextContent('测试客户');
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: /取.*消/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(api.remove).toHaveBeenCalledWith(customer.id, 3));
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 }));
});

test('delete failures retain the record and show the reason', async () => {
  api.remove.mockRejectedValue(new Error('该客户有关联案件，无法删除'));
  page();
  fireEvent.click(await screen.findByRole('button', { name: '删除' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('该客户有关联案件，无法删除');
  expect(api.list).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: customer.name })).toBeInTheDocument();
});

test('read-only users see query but no modify or delete actions', async () => {
  grant(['customer.read']);
  page();
  await screen.findByRole('button', { name: '查询' });
  expect(screen.queryByRole('button', { name: '修改' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await screen.findByText('基本信息');
  expect(screen.queryByRole('button', { name: /编辑档案/ })).not.toBeInTheDocument();
});
