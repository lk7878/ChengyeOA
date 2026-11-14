import { expect, test, vi } from 'vitest';
import request from '@/api/request';
import { masterDataApi } from './api';

vi.mock('@/api/request', () => ({ default: { delete: vi.fn().mockResolvedValue({ code: 200 }) } }));

test('unbind sends the employeeVersion required by the binding endpoint', async () => {
  await masterDataApi.employees.unbindAccount('employee-1', { employeeVersion: 7 });
  expect(request.delete).toHaveBeenCalledWith('/v1/employees/employee-1/account-binding', { data: { employeeVersion: 7 } });
});
