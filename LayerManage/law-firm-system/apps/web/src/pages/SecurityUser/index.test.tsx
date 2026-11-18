import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import SecurityUserPage from './index';
import {MemoryRouter} from 'react-router';
import { authorizationAdminApi } from '@/features/authorization/admin-api';
import {previewEvent} from '../SecurityRole/worksheet-permission-options';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/features/authorization/admin-api', () => ({ authorizationAdminApi: {
  users: { list: vi.fn(), detail:vi.fn(), authorization: vi.fn(), grantRole: vi.fn(), revokeRole: vi.fn(), grantSpecial: vi.fn(), revokeSpecial: vi.fn() },
  roles: { list: vi.fn() }, catalogs: { permissions: vi.fn(), dataScopes: vi.fn() },
} }));

vi.mock('../SecurityRole/PermissionOverview',()=>({default:({onPreview}:{onPreview:(table:string,subject:string)=>void})=><button onClick={()=>onPreview('table-fixture','MEMBER:target-user')}>预览合成表格</button>}));

const page = { list: [{ id: 'self-user', username: 'admin', status: 'ENABLED', employee: null, lastLoginAt: null }, { id: 'target-user', username: 'lawyer', status: 'ENABLED', employee: null, lastLoginAt: null }], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 } };

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ authorization: { userId: 'self-user', employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false, permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() } });
  vi.mocked(authorizationAdminApi.users.list).mockResolvedValue(page);
  vi.mocked(authorizationAdminApi.roles.list).mockResolvedValue({ list: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
  vi.mocked(authorizationAdminApi.catalogs.permissions).mockResolvedValue([]);
  vi.mocked(authorizationAdminApi.catalogs.dataScopes).mockResolvedValue([]);
  vi.mocked(authorizationAdminApi.users.authorization).mockResolvedValue({ userId: 'target-user', status: 'ENABLED', roleGrants: [], specialGrants: [] });
});

test('disables self modification and opens the audited grant workflow for another user', async () => {
  render(<MemoryRouter><SecurityUserPage /></MemoryRouter>);
  expect(await screen.findByRole('button', { name: '管理 admin 的授权' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '管理 lawyer 的授权' }));
  await waitFor(() => expect(authorizationAdminApi.users.authorization).toHaveBeenCalledWith('target-user'));
  expect(await screen.findByRole('button', { name: '授予角色' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '授予角色' }));
  expect(await screen.findByText('授权期限')).toBeInTheDocument();
  expect(screen.getByText('长期')).toBeInTheDocument();
  expect(screen.getByText('临时')).toBeInTheDocument();
});

test('account handoff resolves a selected user even outside the first page',async()=>{
 vi.mocked(authorizationAdminApi.users.detail).mockResolvedValue({id:'outside',username:'不在第一页',status:'ENABLED',employee:null,lastLoginAt:null});
 render(<MemoryRouter initialEntries={['/security/users?userId=outside']}><SecurityUserPage/></MemoryRouter>);
 expect(await screen.findByText('授权详情 · 不在第一页')).toBeInTheDocument();
 expect(authorizationAdminApi.users.authorization).toHaveBeenCalledWith('outside');
});


test('member overview opens preview with the expected target and identity',async()=>{
 const handler=vi.fn();window.addEventListener(previewEvent,handler);
 try{
  render(<MemoryRouter><SecurityUserPage/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'管理 lawyer 的授权'}));
  fireEvent.click(await screen.findByRole('tab',{name:'有效表格权限与共享来源'}));
  fireEvent.click(await screen.findByRole('button',{name:'预览合成表格'}));
  expect(handler).toHaveBeenCalledOnce();
  expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({table:'table-fixture',target:'MEMBER',id:'target-user'});
 }finally{window.removeEventListener(previewEvent,handler)}
});
