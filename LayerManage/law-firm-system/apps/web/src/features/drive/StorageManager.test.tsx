import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import StorageManager, { type StorageReport } from './StorageManager';
import { get } from '../workspaces/api';
import { useAuthStore } from '@/stores/authStore';

vi.mock('../workspaces/api', () => ({ get: vi.fn(), errorMessage: () => '查询失败' }));
vi.mock('./file-transfer', () => ({ downloadVersion: vi.fn() }));
const auth = (isSystemSuperAdmin: boolean) => ({ userId: 'me', employeeId: null, isSystemSuperAdmin, isSystemAdmin: false, permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() });
const report = (name = '本人文件'): StorageReport => ({ audience: 'mine', workspace: '__all__', workspaces: [{ id: 'w1', name: '工作区一' }], disk: null,
  measured: { bytes: 100, allocatedBytes: 4096, objects: 1, unavailable: 0 }, totals: { files: 1, versions: 1, logicalBytes: 100, currentBytes: 100, historyBytes: 0, trashBytes: 0, aiBytes: 0, duplicateGroups: 0, potentialDuplicateBytes: 0 },
  breakdown: { workspaces: [], members: [], departments: [] }, owners: [{ id: 'me', name: '本人' }], departments: [],
  items: [{ id: 'f', fileId: 'f', version: 1, name, kind: 'PERSONAL', ownerId: 'me', ownerName: '本人', department: '未绑定部门', workspaceName: '未归属工作区', location: '目录', size: 100, current: true, trash: false, sha256: '', updatedAt: '2026-11-18', source: 'upload', referenceCount: 0, candidates: [], versionCount: 1 }],
  total: 1, page: 1, pageSize: 25, coverage: '已知统计范围', referenceNotice: '引用需要核对', computedAt: '2026-11-18' });
const options = vi.fn(), mine = vi.fn();
beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ authorization: auth(false) }); vi.mocked(get).mockResolvedValue(report()); });

test('ordinary users only get personal scope, storage metrics and no organization or destructive action', async () => {
  render(<StorageManager workspace="__all__" onWorkspaces={options} onMine={mine} />);
  expect(await screen.findByText('本人文件')).toBeInTheDocument();
  expect(String(vi.mocked(get).mock.calls[0][0])).toContain('audience=mine');
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '存储查看范围' }));
  expect(screen.queryByText('全组织（只读审计）')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /删除|清空/ })).not.toBeInTheDocument();
  expect(screen.getByText('已知统计范围')).toBeInTheDocument();
});

test('super administrator can switch to audited organization scope and keeps it when workspace changes', async () => {
  useAuthStore.setState({ authorization: auth(true) });
  const view = render(<StorageManager workspace="__all__" onWorkspaces={options} onMine={mine} />);
  await screen.findByText('本人文件');
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '存储查看范围' }));
  fireEvent.click(screen.getByText('全组织（只读审计）'));
  await waitFor(() => expect(vi.mocked(get).mock.calls.some(([url]) => String(url).includes('audience=organization'))).toBe(true));
  view.rerender(<StorageManager workspace="w1" onWorkspaces={options} onMine={mine} />);
  await waitFor(() => expect(String(vi.mocked(get).mock.calls.at(-1)?.[0])).toContain('audience=organization&workspace=w1'));
});

test('old workspace results never render after switching while a slow request is outstanding', async () => {
  let finish!: (value: StorageReport) => void;
  vi.mocked(get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; })).mockResolvedValueOnce(report('新工作区文件'));
  const view = render(<StorageManager workspace="old" onWorkspaces={options} onMine={mine} />);
  view.rerender(<StorageManager workspace="new" onWorkspaces={options} onMine={mine} />);
  expect(await screen.findByText('新工作区文件')).toBeInTheDocument();
  await act(async () => finish(report('旧工作区文件')));
  expect(screen.queryByText('旧工作区文件')).not.toBeInTheDocument();
});

test('refresh failures clear stale lists and offer a retry', async () => {
  render(<StorageManager workspace="__all__" onWorkspaces={options} onMine={mine} />);
  await screen.findByText('本人文件');
  vi.mocked(get).mockRejectedValueOnce(new Error('failed'));
  fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  expect(await screen.findByText('查询失败')).toBeInTheDocument();
  expect(screen.queryByText('本人文件')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  expect(await screen.findByText('本人文件')).toBeInTheDocument();
});
