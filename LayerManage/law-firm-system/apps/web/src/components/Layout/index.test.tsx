import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import MainLayout from './index';
import { useAuthStore } from '@/stores/authStore';
import type { AuthorizationSummary } from '@/features/authorization/types';

const authorization: AuthorizationSummary = {
  userId: 'test-user',
  employeeId: null,
  isSystemSuperAdmin: false,
  isSystemAdmin: false,
  permissions: [],
  menus: [],
  fieldCapabilities: {},
  validUntil: null,
  evaluatedAt: new Date().toISOString(),
};
beforeEach(() =>
  useAuthStore.setState({
    isAuthenticated: false,
    userInfo: null,
    authorization: { ...authorization },
    authorizationStatus: 'ready',
  }),
);
const show = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MainLayout>
        <input aria-label="业务草稿" defaultValue="保留输入" />
      </MainLayout>
    </MemoryRouter>,
  );

test('uses exactly five global destinations and one contextual directory', () => {
  useAuthStore.setState({
    authorization: { ...authorization, menus: ['menu.channel'], permissions: ['channel.read'] },
  });
  show('/apps');
  const global = within(screen.getByRole('navigation', { name: '全局导航' }));
  expect(global.getAllByRole('link').map((link) => link.textContent)).toEqual([
    '承业中心',
    '承业空间',
    '承业协作',
    '数据分析',
    '管理中心',
  ]);
  expect(global.queryByRole('link', { name: '渠道管理' })).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('navigation', { name: '当前区域目录' })).getByRole('link', { name: '渠道管理' }),
  ).toBeInTheDocument();
});
test('cloud drive supplies its own context instead of receiving a third navigation tree', () => {
  show('/workspaces?base=original-id');
  expect(screen.queryByRole('navigation', { name: '当前区域目录' })).not.toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: '全局导航' })).toBeInTheDocument();
});
test('rejects a direct URL even when the menu exists without read permission', () => {
  useAuthStore.setState({ authorization: { ...authorization, menus: ['menu.security_roles'] } });
  show('/security/roles');
  expect(screen.getByText('无权访问此页面')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: '业务草稿' })).not.toBeInTheDocument();
});
test('OA exposes one smart-case entry and no separate knowledge entry', () => {
  useAuthStore.setState({authorization: {...authorization, menus:['menu.smart_case']}});
  show('/workspaces');
  expect(screen.getByRole('link',{name:'智慧办案'})).toHaveAttribute('href','/smart-case');
  expect(screen.getByRole('link',{name:'智慧办案'})).toHaveAttribute('target','_blank');
  expect(screen.queryByRole('link',{name:'知识库'})).not.toBeInTheDocument();
});
test('authorization failure hides protected content and provides a retry', () => {
  const retry = vi.fn().mockResolvedValue(undefined);
  useAuthStore.setState({ authorization: null, authorizationStatus: 'error', ensureAuthorization: retry });
  show('/security/event-operations');
  expect(screen.queryByRole('textbox', { name: '业务草稿' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试授权' }));
  expect(retry).toHaveBeenCalledWith(true);
});
test('search results include only authorized destinations and keep Chinese labels', async () => {
  show('/apps');
  fireEvent.click(screen.getByRole('button', { name: '查找功能入口' }));
  fireEvent.change(await screen.findByRole('textbox', { name: '搜索功能入口' }), {
    target: { value: '角色' },
  });
  expect(await screen.findByText('没有匹配的可用入口')).toBeInTheDocument();
  expect(
    within(screen.getByRole('dialog')).queryByRole('link', { name: /角色权限/ }),
  ).not.toBeInTheDocument();
});
test('unknown paths produce an explicit missing-page state', () => {
  show('/inventory/not-a-real-page');
  expect(screen.getByText('页面不存在')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: '业务草稿' })).not.toBeInTheDocument();
});

test.each([
  '/channels',
  '/payments',
  '/invoices',
  '/refunds',
  '/costs',
  '/inventory/items',
  '/inventory/movements',
  '/inventory/stocktakes',
  '/performances',
])('a business Base at %s has one table directory instead of stacked navigation', (path) => {
  show(path + '?base=original-base');
  expect(screen.getByRole('navigation', { name: '全局导航' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: '当前区域目录' })).not.toBeInTheDocument();
});
