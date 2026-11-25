import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import StorageManager, { type StorageReport } from './StorageManager';
import { get } from '../workspaces/api';
import { useAuthStore } from '@/stores/authStore';

vi.mock('../workspaces/api', () => ({ get: vi.fn(), errorMessage: () => '查询失败' }));
const auth = (isSystemSuperAdmin: boolean) => ({ userId: 'me', employeeId: null, isSystemSuperAdmin, isSystemAdmin: false, permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() });
const report = (name = '本人文件'): StorageReport => ({ audience: 'mine', workspace: '__all__', workspaces: [{ id: 'w1', name: '工作区一' }], disk: null,
  measured: { bytes: 100, allocatedBytes: 4096, objects: 1, unavailable: 0 }, totals: { files: 1, versions: 1, logicalBytes: 100, currentBytes: 100, historyBytes: 0, trashBytes: 0, aiBytes: 0, duplicateGroups: 0, potentialDuplicateBytes: 0 },
  breakdown: { workspaces: [], members: [], departments: [] }, owners: [{ id: 'me', name: '本人' }], departments: [],
  items: [{ id: 'f', fileId: 'f', version: 1, name, kind: 'PERSONAL', ownerId: 'me', ownerName: '本人', department: '未绑定部门', workspaceName: '未归属工作区', location: '目录', size: 100, current: true, trash: false, sha256: '', updatedAt: '2026-11-18', source: 'upload', referenceCount: 0, candidates: [], versionCount: 1 }],
  total: 1, page: 1, pageSize: 25, coverage: '已知统计范围', referenceNotice: '引用需要核对', computedAt: '2026-11-18' });
const workspaceChange = vi.fn(), mine = vi.fn();
beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ authorization: auth(false) }); vi.mocked(get).mockResolvedValue(report()); });

test('ordinary users only get personal scope, storage metrics and no organization or destructive action', async () => {
  render(<StorageManager workspace="__all__" onWorkspaceChange={workspaceChange} onMine={mine} />);
  expect(await screen.findByText('本人文件')).toBeInTheDocument();
  expect(String(vi.mocked(get).mock.calls[0][0])).toContain('audience=mine');
  expect(screen.queryByRole('combobox', { name: '存储查看范围' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  for (const name of ['存储成员筛选', '存储部门筛选', '存储工作区筛选']) {
    expect(screen.queryByRole('combobox', { name })).not.toBeInTheDocument();
  }
  expect(screen.queryByRole('button', { name: /删除|清空/ })).not.toBeInTheDocument();
  expect(screen.queryByText('已知统计范围')).not.toBeInTheDocument();
});

test('super administrator can switch to audited organization scope and keeps it when workspace changes', async () => {
  useAuthStore.setState({ authorization: auth(true) });
  const view = render(<StorageManager workspace="__all__" onWorkspaceChange={workspaceChange} onMine={mine} />);
  await screen.findByText('本人文件');
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '存储查看范围' }));
  fireEvent.click(screen.getByText('全组织（只读审计）'));
  await waitFor(() => expect(vi.mocked(get).mock.calls.some(([url]) => String(url).includes('audience=organization'))).toBe(true));
  expect(await screen.findByRole('tab', {name:'按成员'})).toBeInTheDocument();
  expect(screen.getByRole('combobox', {name:'存储成员筛选'})).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', {name:'存储工作区筛选'}));
  fireEvent.click(screen.getByText('工作区一'));
  expect(workspaceChange).toHaveBeenCalledWith('w1');
  view.rerender(<StorageManager workspace="w1" onWorkspaceChange={workspaceChange} onMine={mine} />);
  await waitFor(() => expect(String(vi.mocked(get).mock.calls.at(-1)?.[0])).toContain('audience=organization&workspace=w1'));
});

test('previous account results never render after switching while a slow request is outstanding', async () => {
  let finish!: (value: StorageReport) => void;
  vi.mocked(get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; })).mockResolvedValueOnce(report('新账号文件'));
  const view = render(<StorageManager workspace="old" onWorkspaceChange={workspaceChange} onMine={mine} />);
  act(() => useAuthStore.setState({authorization:{...auth(false), userId:'other'}}));
  view.rerender(<StorageManager workspace="new" onWorkspaceChange={workspaceChange} onMine={mine} />);
  expect(await screen.findByText('新账号文件')).toBeInTheDocument();
  await act(async () => finish(report('旧账号文件')));
  expect(screen.queryByText('旧账号文件')).not.toBeInTheDocument();
});

test('refresh failures clear stale lists and offer a retry', async () => {
  render(<StorageManager workspace="__all__" onWorkspaceChange={workspaceChange} onMine={mine} />);
  await screen.findByText('本人文件');
  vi.mocked(get).mockRejectedValueOnce(new Error('failed'));
  fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  expect(await screen.findByText('查询失败')).toBeInTheDocument();
  expect(screen.queryByText('本人文件')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  expect(await screen.findByText('本人文件')).toBeInTheDocument();
});

test('personal totals ignore the previous workspace and remain scoped to the current owner', async () => {
  const view = render(<StorageManager workspace="w1" onWorkspaceChange={workspaceChange} onMine={mine} />);
  await screen.findByText('本人文件');
  const query = new URLSearchParams(String(vi.mocked(get).mock.calls.at(-1)?.[0]).split('?')[1]);
  expect(query.get('workspace')).toBe('__all__');
  expect(query.get('audience')).toBe('mine');
  expect(query.get('ownerId')).toBe('');
  expect(screen.getByText(/范围：全部本人文件/)).toBeInTheDocument();
  view.rerender(<StorageManager workspace="another" onWorkspaceChange={workspaceChange} onMine={mine} />);
  expect(get).toHaveBeenCalledTimes(1);
});

test('losing super admin status removes organization data and requests own files only', async () => {
  useAuthStore.setState({authorization:auth(true)});
  render(<StorageManager workspace="w1" onWorkspaceChange={workspaceChange} onMine={mine} />);
  await screen.findByText('本人文件');
  vi.mocked(get).mockResolvedValueOnce(report('全组织文件'));
  fireEvent.mouseDown(screen.getByRole('combobox', {name:'存储查看范围'}));
  fireEvent.click(screen.getByText('全组织（只读审计）'));
  await screen.findByText('全组织文件');
  act(() => useAuthStore.setState({authorization:auth(false)}));
  expect(screen.queryByText('全组织文件')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  await screen.findByText('本人文件');
  expect(String(vi.mocked(get).mock.calls.at(-1)?.[0])).toContain('audience=mine&workspace=__all__');
});
