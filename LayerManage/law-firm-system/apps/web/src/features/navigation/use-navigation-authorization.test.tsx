import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import MainLayout from '@/components/Layout';
import { useAuthStore } from '@/stores/authStore';
import { authorizationApi } from '../authorization/api';
import { runtimeSession } from '../auth/runtime-session';
import type { AuthorizationSummary } from '../authorization/types';

const allowed: AuthorizationSummary = {
  userId: 'one',
  employeeId: null,
  isSystemAdmin: false,
  isSystemSuperAdmin: false,
  permissions: ['case.read'],
  menus: [],
  fieldCapabilities: {},
  validUntil: null,
  evaluatedAt: new Date().toISOString(),
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useAuthStore.setState({
    isAuthenticated: false,
    userInfo: null,
    authorization: null,
    authorizationStatus: 'idle',
  });
});
function show() {
  vi.spyOn(runtimeSession, 'getAccessToken').mockReturnValue('synthetic-session');
  useAuthStore.setState({
    isAuthenticated: true,
    userInfo: { id: 'one', username: 'one', name: '测试' },
    authorization: allowed,
    authorizationStatus: 'ready',
  });
  return render(
    <MemoryRouter initialEntries={['/cases']}>
      <MainLayout>
        <input aria-label="未保存草稿" />
      </MainLayout>
    </MemoryRouter>,
  );
}
test('successful background refresh preserves drafts; revoked permission closes protected content', async () => {
  vi.useFakeTimers();
  const api = vi.spyOn(authorizationApi, 'me').mockResolvedValue(allowed);
  show();
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByRole('textbox', { name: '未保存草稿' }), { target: { value: '仍在编辑' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.getByRole('textbox', { name: '未保存草稿' })).toHaveValue('仍在编辑');
  api.mockResolvedValue({ ...allowed, permissions: [] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.queryByRole('textbox', { name: '未保存草稿' })).not.toBeInTheDocument();
  expect(screen.getByText('无权访问此页面')).toBeInTheDocument();
});
test('a response from the previous account cannot restore authorization after logout', async () => {
  let resolve!: (value: AuthorizationSummary) => void;
  vi.spyOn(authorizationApi, 'me').mockReturnValue(
    new Promise<AuthorizationSummary>((done) => {
      resolve = done;
    }),
  );
  show();
  act(() =>
    useAuthStore.setState({
      isAuthenticated: false,
      userInfo: null,
      authorization: null,
      authorizationStatus: 'error',
    }),
  );
  await act(async () => {
    resolve(allowed);
  });
  expect(useAuthStore.getState().authorization).toBeNull();
  expect(screen.queryByRole('textbox', { name: '未保存草稿' })).not.toBeInTheDocument();
});
