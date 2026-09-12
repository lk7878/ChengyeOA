import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import MainLayout, { buildMenuItems } from './index';
import { useAuthStore } from '@/stores/authStore';

function keys(items: ReturnType<typeof buildMenuItems>): string[] {
  return items.flatMap(item => {
    if (!item || !('key' in item)) return [];
    const own = String(item.key);
    const children = 'children' in item && Array.isArray(item.children) ? keys(item.children) : [];
    return [own, ...children];
  });
}

test('requires super-admin status as well as the organization MENU permission', () => {
  const menuKeys = keys(buildMenuItems([
    'menu.organization_personnel',
    'menu.organization',
    'menu.security_roles',
  ], true));
  expect(menuKeys).toContain('/org/tree');
  expect(menuKeys).not.toContain('/org/employees');
  expect(menuKeys).toContain('/security/roles');
  expect(menuKeys).not.toContain('/security/users');
});

test('does not grant navigation from role names', () => {
  const menuKeys = keys(buildMenuItems(['SYSTEM_SUPER_ADMIN'] as never[]));
  expect(menuKeys).not.toContain('master-data');
  expect(menuKeys).not.toContain('/security/roles');
});

test('shows administrator governance only from its menu permission', () => {
  expect(keys(buildMenuItems(['menu.admin_governance']))).toContain('/security/admin-governance');
  expect(keys(buildMenuItems(['governance.catalog.read']))).not.toContain('/security/admin-governance');
});

test('shows event operations only from its menu permission', () => {
  expect(keys(buildMenuItems(['menu.event_operations']))).toContain('/security/event-operations');
  expect(keys(buildMenuItems([]))).not.toContain('/security/event-operations');
  expect(keys(buildMenuItems(['event.delivery.read']))).not.toContain('/security/event-operations');
});

test('uses the approved Chinese breadcrumb for event operations', () => {
  useAuthStore.setState({
    authorization: {
      userId: 'u1', employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: true,
      permissions: ['event.delivery.read'], menus: ['menu.event_operations'], fieldCapabilities: {},
      validUntil: null, evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
  render(
    <MemoryRouter initialEntries={['/security/event-operations']}>
      <MainLayout><div>page content</div></MainLayout>
    </MemoryRouter>,
  );
  expect(screen.getByText('事件运维')).toBeInTheDocument();
  expect(screen.queryByText('/security/event-operations')).not.toBeInTheDocument();
});

test('hides organization management from ordinary administrators with the menu code', () => {
  expect(keys(buildMenuItems(['menu.organization_personnel', 'menu.organization']))).not.toContain('/org/tree');
});


test('shows smart case navigation only with its menu permission', () => {
  expect(keys(buildMenuItems(['menu.smart_case']))).toContain('/smart-case');
  expect(keys(buildMenuItems([]))).not.toContain('/smart-case');
});

test('renders the specified product version and a permission-controlled knowledge entry', async () => {
  useAuthStore.setState({ authorization: { userId:'u1', employeeId:null, isSystemSuperAdmin:false, isSystemAdmin:false, permissions:[], menus:['menu.knowledge'], fieldCapabilities:{}, validUntil:null, evaluatedAt:new Date().toISOString() }, authorizationStatus:'ready' });
  render(<MemoryRouter><MainLayout><div>内容</div></MainLayout></MemoryRouter>);
  fireEvent.click(screen.getByRole('img',{name:'menu-unfold'}));
  expect(await screen.findByText('律师智慧管理系统')).toBeInTheDocument();
  expect(screen.getByText('V1.2.0')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/知识库/})).toBeInTheDocument();
});
