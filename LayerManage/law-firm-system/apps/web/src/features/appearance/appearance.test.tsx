import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { useEffect, useState } from 'react';
import { Input } from 'antd';
import AppearanceProvider from './AppearanceProvider';
import MainLayout from '@/components/Layout';
import { useAuthStore } from '@/stores/authStore';
import { get, patch } from '@/features/workspaces/api';
import { appearanceRowHeight, defaultAppearance, useAppearanceStore } from './store';

vi.mock('@/features/workspaces/api', () => ({ get: vi.fn(), patch: vi.fn(), errorMessage: (e: Error) => e.message }));
vi.mock('@/features/notifications/LiveNotifications', () => ({ default: () => null }));
let mounts = 0;
function Drafts() {
  const [value, setValue] = useState('');
  useEffect(() => { mounts++; }, []);
  return <><Input aria-label="业务草稿" value={value} onChange={e => setValue(e.target.value)} />
    <textarea aria-label="审批草稿" defaultValue="审批流程未保存" /></>;
}
beforeEach(() => {
  mounts = 0;
  useAppearanceStore.setState({ accountId: undefined, preferences: defaultAppearance, status: 'idle' });
  useAuthStore.setState({ userInfo: { id: 'a', username: 'a', name: 'a' }, isAuthenticated: false,
    authorizationStatus: 'ready', authorization: { userId: 'a', employeeId: null, isSystemSuperAdmin: true,
      isSystemAdmin: true, permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString() } });
  vi.mocked(get).mockResolvedValue(defaultAppearance);
  vi.mocked(patch).mockImplementation(async (_url, value) => value as never);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const show = () => render(<AppearanceProvider><MemoryRouter><MainLayout><Drafts /></MainLayout></MemoryRouter></AppearanceProvider>);
async function open() {
  await waitFor(() => expect(useAppearanceStore.getState().status).toBe('ready'));
  fireEvent.click(screen.getByRole('button', { name: '账号菜单' }));
  fireEvent.click(await screen.findByText('外观设置', { selector: '.ant-dropdown-menu-title-content' }));
  await screen.findByRole('dialog');
}
test('save applies appearance without remounting business or approval drafts; cancel and reset stay explicit', async () => {
  show();
  fireEvent.change(screen.getByLabelText('业务草稿'), { target: { value: '不能丢失的业务内容' } });
  await open();
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('radio', { name: '特大' }));
  fireEvent.click(dialog.getByRole('radio', { name: '淡绿色' }));
  fireEvent.click(dialog.getByRole('radio', { name: '宽松' }));
  expect(document.documentElement.dataset.oaAppearance).toBe('standard');
  expect(patch).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(document.documentElement.dataset.oaAppearance).toBe('extraLarge'));
  expect(screen.getByLabelText('业务草稿')).toHaveValue('不能丢失的业务内容');
  expect(screen.getByLabelText('审批草稿')).toHaveValue('审批流程未保存');
  expect(mounts).toBe(1);
  expect(appearanceRowHeight(useAppearanceStore.getState().preferences)).toBe(72);
  await open();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '恢复默认' }));
  expect(document.documentElement.dataset.oaAppearance).toBe('extraLarge');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /取\s*消/ }));
  expect(patch).toHaveBeenCalledTimes(1);
  await open();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '恢复默认' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /保\s*存/ }));
  await waitFor(() => expect(document.documentElement.dataset.oaAppearance).toBe('standard'));
  expect(mounts).toBe(1);
});
test('failed saves retain selections and keep the applied appearance unchanged', async () => {
  vi.mocked(patch).mockRejectedValue(new Error('保存失败，请重试'));
  show(); await open();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: '特大' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /保\s*存/ }));
  await screen.findByText('保存失败，请重试');
  expect(screen.getByRole('radio', { name: '特大' })).toBeChecked();
  expect(document.documentElement.dataset.oaAppearance).toBe('standard');
});
test('account changes reset presentation and ignore a stale response from the previous account', async () => {
  let release: (value: unknown) => void = () => undefined;
  vi.mocked(get).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  show();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await act(async () => { useAuthStore.setState({ userInfo: { id: 'b', username: 'b', name: 'b' } }); });
  await waitFor(() => expect(useAppearanceStore.getState().accountId).toBe('b'));
  await act(async () => { release({ fontSize: 'extraLarge', background: 'beige', rowHeight: 'comfortable' }); });
  expect(document.documentElement.dataset.oaAppearance).toBe('standard');
  expect(useAppearanceStore.getState().preferences).toEqual(defaultAppearance);
});
