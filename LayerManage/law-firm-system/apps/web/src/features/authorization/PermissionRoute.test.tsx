import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import PermissionRoute from './PermissionRoute';

beforeEach(() => {
  useAuthStore.setState({
    userInfo: { id: 'user-1', username: 'legacy-admin', name: 'Legacy Admin', roles: ['admin'], permissions: [] },
    authorization: null,
    authorizationStatus: 'ready',
  });
});

test('admits content only from the formal permission summary', () => {
  useAuthStore.setState({
    authorization: {
      userId: 'user-1', employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: false,
      permissions: ['organization.read'], menus: [], fieldCapabilities: {},
      validUntil: null, evaluatedAt: new Date().toISOString(),
    },
  });
  render(<MemoryRouter><PermissionRoute permission="organization.read"><div>allowed</div></PermissionRoute></MemoryRouter>);
  expect(screen.getByText('allowed')).toBeInTheDocument();
});

test('does not treat an admin role name as a permission bypass', () => {
  render(<MemoryRouter><PermissionRoute permission="organization.read"><div>allowed</div></PermissionRoute></MemoryRouter>);
  expect(screen.queryByText('allowed')).not.toBeInTheDocument();
  expect(screen.getByText('403')).toBeInTheDocument();
});
