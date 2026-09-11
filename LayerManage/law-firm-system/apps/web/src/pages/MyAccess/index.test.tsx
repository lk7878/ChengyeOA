import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import MyAccessPage from './index';
import { authorizationAdminApi } from '@/features/authorization/admin-api';

vi.mock('@/features/authorization/admin-api', () => ({ authorizationAdminApi: { trace: { me: vi.fn() } } }));

test('loads only the current users effective access explanation', async () => {
  vi.mocked(authorizationAdminApi.trace.me).mockResolvedValue({ userId: 'self', employeeId: null, permissionCode: null, allowed: true, refusalCode: null, evaluatedAt: '2026-07-19T00:00:00.000Z', sources: [{ sourceType: 'ROLE', sourceId: 'grant-1', permissionCode: 'employee.read', scopeTypes: ['ALL'], validUntil: null, state: 'ACTIVE' }], fieldCapabilities: [] });
  render(<MyAccessPage />);
  expect(await screen.findByText('employee.read')).toBeInTheDocument();
  expect(authorizationAdminApi.trace.me).toHaveBeenCalledWith(undefined);
  expect(screen.queryByLabelText('目标用户')).not.toBeInTheDocument();
});
