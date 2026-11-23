import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import FileSharing from './FileSharing';
import request from '@/api/request';
import { get, post } from '../workspaces/api';
vi.mock('@/api/request', () => ({ default: { put: vi.fn() } }));
vi.mock('../workspaces/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  errorMessage: () => '授权版本已变化，请刷新',
}));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => 'owner' }));
const grant = (id: string, role = 'READER') => ({
  principalType: 'USER',
  principalId: id,
  role,
  rowScope: 'ALL',
  canCreate: false,
  hiddenFields: [],
  readonlyFields: [],
});
const data = () => ({
  id: 'file',
  name: '测试.txt',
  kind: 'FILE',
  version: 3,
  ownerId: 'owner',
  labels: { 'USER:owner': '所有者', 'USER:a': '甲（a）' },
  path: [{ id: 'file', name: '测试.txt' }],
  policy: { restricted: true, grants: [grant('owner', 'MANAGER'), grant('a')] },
  sources: [
    {
      id: 'file',
      name: '测试.txt',
      ownerId: 'owner',
      restricted: true,
      inherited: false,
      grants: [grant('owner', 'MANAGER'), grant('a')],
    },
  ],
  audience: [
    { userId: 'a', name: '甲', username: 'a', level: 1, matches: [{ sourceId: 'file', ...grant('a') }] },
  ],
});
let saved = data();
beforeEach(() => {
  vi.clearAllMocks();
  saved = data();
  vi.mocked(get).mockImplementation(async (url) =>
    url.includes('/people?') ? [{ value: 'USER:b', label: '乙（b）' }] : structuredClone(saved),
  );
  vi.mocked(post).mockImplementation(async () => {
    saved.policy.grants = [grant('owner', 'MANAGER')];
    saved.version++;
    return { retained: [] };
  });
  vi.mocked(request.put).mockResolvedValue({});
});
test('revocation requires confirmation, saves immediately, and refreshes the saved audience', async () => {
  const changed = vi.fn();
  render(<FileSharing fileId="file" onClose={vi.fn()} onChanged={changed} />);
  fireEvent.click(await screen.findByRole('button', { name: '撤销分享' }));
  const dialog = (await screen.findByText('确认撤销分享', { selector: '.ant-modal-title' })).closest('[role=dialog]') as HTMLElement;
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: '确认并立即生效' }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/personal-files/file/access/revoke', {
      version: 3,
      principalType: 'USER',
      principalId: 'a',
    }),
  );
  await waitFor(() => expect(screen.queryByRole('button', { name: '撤销分享' })).toBeNull());
  expect(changed).toHaveBeenCalledOnce();
  expect(request.put).not.toHaveBeenCalled();
});
test('other permission sources are explicitly reported after revoking a direct share', async () => {
  vi.mocked(post).mockResolvedValue({
    retained: [{ userId: 'a', name: '甲', username: 'a', level: 1, sources: ['律师部 · 律师角色'] }],
  });
  render(<FileSharing fileId="file" onClose={vi.fn()} onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '撤销分享' }));
  fireEvent.click(
    within((await screen.findByText('确认撤销分享', { selector: '.ant-modal-title' })).closest('[role=dialog]') as HTMLElement).getByRole('button', {
      name: '确认并立即生效',
    }),
  );
  expect(await screen.findByText(/以下人员仍有其他访问来源.*律师部/)).toBeInTheDocument();
});
test('new sharing is marked unsaved, close warns before discarding, and explicit save persists it', async () => {
  const close = vi.fn();
  render(<FileSharing fileId="file" onClose={close} onChanged={vi.fn()} />);
  const selector = await screen.findByRole('combobox', { name: '搜索分享对象' });
  fireEvent.mouseDown(selector);
  fireEvent.click(await screen.findByText('乙（b）', { selector: '.ant-select-item-option-content' }));
  expect(screen.getByText('尚未保存')).toBeInTheDocument();
  expect(request.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  const confirm = (await screen.findByText('放弃未保存的分享修改？', { selector: '.ant-modal-title' })).closest('[role=dialog]') as HTMLElement;
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole('button', { name: /Cancel|取\s*消/ }));
  fireEvent.click(screen.getByRole('button', { name: '确认分享' }));
  await waitFor(() =>
    expect(request.put).toHaveBeenCalledWith(
      '/v1/personal-files/file/access',
      {
        version: 3,
        policy: { restricted: true, grants: [grant('owner', 'MANAGER'), grant('a'), grant('b')] },
      },
      { suppressGlobalError: true },
    ),
  );
});
test('a concurrent-update rejection keeps the confirmation and reports failure without refreshing success', async () => {
  vi.mocked(post).mockRejectedValue(new Error('conflict'));
  const changed = vi.fn();
  render(<FileSharing fileId="file" onClose={vi.fn()} onChanged={changed} />);
  fireEvent.click(await screen.findByRole('button', { name: '撤销分享' }));
  const dialog = (await screen.findByText('确认撤销分享', { selector: '.ant-modal-title' })).closest('[role=dialog]') as HTMLElement;
  fireEvent.click(within(dialog).getByRole('button', { name: '确认并立即生效' }));
  expect(await within(dialog).findByText('授权版本已变化，请刷新')).toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
});
