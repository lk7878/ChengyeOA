import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { expect, test, vi } from 'vitest';
import { CustomerWorkspacePage } from '../CustomerCreatePage';
import { useAuthStore } from '@/stores/authStore';
const api = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/api/customer', () => ({ customerApi: api }));
function CaseReturn() { const location = useLocation(); return <output>{JSON.stringify(location.state)}</output>; }
test('case draft handoff keeps the prefilled name on failure and returns the canonical customer on success', async () => {
  useAuthStore.setState({ authorization: { userId: 'user', employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: false, permissions: ['customer.create'], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() }, authorizationStatus: 'ready' });
  api.create.mockRejectedValueOnce(new Error('暂时不可用')).mockResolvedValueOnce({ data: { id: 'canonical-customer', name: '待建案件客户' } });
  render(<MemoryRouter initialEntries={[{ pathname: '/customers', state: { fromCase: true, createCustomerName: '待建案件客户' } }]}><Routes><Route path="/customers" element={<CustomerWorkspacePage />} /><Route path="/cases" element={<CaseReturn />} /></Routes></MemoryRouter>);
  expect(screen.getByLabelText('姓名')).toHaveValue('待建案件客户');
  fireEvent.change(screen.getByLabelText('电话'), { target: { value: '13900006661' } });
  fireEvent.click(screen.getByRole('button', { name: '创建客户' }));
  await screen.findByText('暂时不可用');
  expect(screen.getByLabelText('电话')).toHaveValue('13900006661');
  fireEvent.click(screen.getByRole('button', { name: '创建客户' }));
  expect(await screen.findByRole('status')).toHaveTextContent('canonical-customer');
  expect(screen.getByRole('status')).toHaveTextContent('"resumeCase":true');
});
