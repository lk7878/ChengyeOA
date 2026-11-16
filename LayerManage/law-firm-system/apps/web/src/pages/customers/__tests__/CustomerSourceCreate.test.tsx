import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import CustomerCreatePage from '../CustomerCreatePage';
import { useAuthStore } from '@/stores/authStore';
import { get, post } from '@/features/workspaces/api';
vi.mock('@/features/workspaces/api', () => ({ get: vi.fn(), post: vi.fn(), errorMessage: (e: Error) => e.message }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
test('table customer creation submits the selected source in the same request and preserves form on failure', async () => {
  useAuthStore.setState({ authorization: { userId: 'user', employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: false, permissions: ['customer.create'], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() }, authorizationStatus: 'ready' });
  vi.mocked(get).mockResolvedValue({ fields: [{ id: 'source', name: '客户来源', type: 'SINGLE_SELECT', writable: true, options: { choices: [{ id: 'lawyer-a', name: '刘佳律师' }] } }] });
  vi.mocked(post).mockRejectedValueOnce(new Error('同步失败')).mockResolvedValueOnce({ id: 'customer-1' });
  render(<MemoryRouter initialEntries={['/customers/new?table=customers']}><Routes>
    <Route path="/customers/new" element={<CustomerCreatePage />} />
    <Route path="/customers/:id" element={<div>客户已创建</div>} />
  </Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '测试客户' } });
  fireEvent.change(screen.getByLabelText('电话'), { target: { value: '13800001234' } });
  fireEvent.mouseDown(await screen.findByLabelText('客户来源'));
  fireEvent.click(await screen.findByTitle('刘佳律师'));
  fireEvent.click(screen.getByRole('button', { name: '创建客户' }));
  await screen.findByText('同步失败');
  expect(screen.getByLabelText('姓名')).toHaveValue('测试客户');
  fireEvent.click(screen.getByRole('button', { name: '创建客户' }));
  await screen.findByText('客户已创建');
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(vi.mocked(post).mock.calls[0]).toEqual(['/tables/customers/business-records', expect.objectContaining({ name: '测试客户', phone: '13800001234', sourceFieldId: 'source', sourceValue: 'lawyer-a' }), expect.any(String)]);
  expect(vi.mocked(post).mock.calls[0][2]).toBe(vi.mocked(post).mock.calls[1][2]);
});
