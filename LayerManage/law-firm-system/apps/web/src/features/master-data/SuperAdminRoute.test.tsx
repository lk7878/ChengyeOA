import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test } from 'vitest';
import { buildMenuItems } from '@/components/Layout';
import { useAuthStore } from '@/stores/authStore';
import SuperAdminRoute from './SuperAdminRoute';

const superAdmin = {
  id: 'user-1', username: 'root', name: 'Root', roles: ['SYSTEM_SUPER_ADMIN'], permissions: [],
};

beforeEach(() => {
  useAuthStore.setState({ userInfo: null });
});

test('renders protected content only for the system super-admin role', () => {
  useAuthStore.setState({ userInfo: superAdmin });
  const { rerender } = render(
    <MemoryRouter><SuperAdminRoute><div>allowed</div></SuperAdminRoute></MemoryRouter>,
  );
  expect(screen.getByText('allowed')).toBeInTheDocument();

  useAuthStore.setState({ userInfo: { ...superAdmin, roles: ['BRANCH_ADMIN'] } });
  rerender(<MemoryRouter><SuperAdminRoute><div>allowed</div></SuperAdminRoute></MemoryRouter>);
  expect(screen.queryByText('allowed')).not.toBeInTheDocument();
  expect(screen.getByText('无权访问此页面')).toBeInTheDocument();
});

test('shows one grouped master-data navigation section only to the system super-admin', () => {
  const privileged = buildMenuItems(['SYSTEM_SUPER_ADMIN']);
  const ordinary = buildMenuItems(['BRANCH_ADMIN']);
  const group = privileged.find(item => item?.key === 'master-data');

  expect(group).toBeDefined();
  expect('children' in group! && group.children?.map(item => item?.key)).toEqual([
    '/org/tree', '/org/positions', '/org/employees', '/org/professional-teams',
  ]);
  expect(ordinary.some(item => item?.key === 'master-data')).toBe(false);
});
