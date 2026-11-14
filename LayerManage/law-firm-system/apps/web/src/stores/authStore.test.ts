import { beforeEach, expect, test, vi } from 'vitest';
import { useAuthStore } from './authStore';
import { runtimeSession } from '@/features/auth/runtime-session';
import { authApi } from '@/api/auth';

const authorizationMeMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/authorization/api', () => ({
  authorizationApi: { me: authorizationMeMock },
  isAuthorizationSummaryExpired: (summary: { validUntil: string | null } | null, now = Date.now()) => (
    !summary || (summary.validUntil !== null && Date.parse(summary.validUntil) <= now)
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  authorizationMeMock.mockReset();
  window.localStorage.clear();
  runtimeSession.clear();
  useAuthStore.setState({
    isAuthenticated: true, bootstrapStatus: 'ready',
    userInfo: { id: 'user-1', username: 'admin', name: 'Admin', roles: ['admin'], permissions: [] },
    authorization: null, authorizationStatus: 'idle',
  });
});

test('logout keeps credentials until the server revokes the session, then clears account and authorization', async () => {
  runtimeSession.setAuthenticated({ token: 'access-token', csrfToken: 'csrf-token', expiresIn: 900 });
  let complete!: (value: Awaited<ReturnType<typeof authApi.logout>>) => void;
  const request = vi.spyOn(authApi, 'logout').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const pending = useAuthStore.getState().logout();
  expect(request).toHaveBeenCalledOnce();
  expect(runtimeSession.getAccessToken()).toBe('access-token');
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  complete({ code: 200, message: 'success', data: null });
  await pending;
  expect(runtimeSession.getAccessToken()).toBeNull();
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, userInfo: null, authorization: null, bootstrapStatus: 'ready' });
});

test('a failed logout preserves the session so the user can retry', async () => {
  runtimeSession.setAuthenticated({ token: 'access-token', csrfToken: 'csrf-token', expiresIn: 900 });
  vi.spyOn(authApi, 'logout').mockRejectedValue(new Error('offline'));
  await expect(useAuthStore.getState().logout()).rejects.toThrow('offline');
  expect(runtimeSession.getAccessToken()).toBe('access-token');
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
});

test('stores authentication credentials only in runtime memory', () => {
  useAuthStore.getState().setAuthenticated({
    mode: 'AUTHENTICATED', token: 'access-token', csrfToken: 'csrf-token', expiresIn: 900,
    user: { id: 'user-1', username: 'admin', name: 'Admin', roles: [], permissions: [] },
  });
  expect(runtimeSession.getAccessToken()).toBe('access-token');
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(JSON.stringify(useAuthStore.getState())).not.toMatch(/access-token|csrf-token/);
  expect(JSON.stringify({ ...localStorage })).not.toMatch(/access-token|csrf-token/);
});

test('never grants a permission from the legacy admin role name', () => {
  expect(useAuthStore.getState().hasPermission('organization.read')).toBe(false);
  expect(useAuthStore.getState().hasAnyPermission(['organization.read', 'employee.read'])).toBe(false);
});

test('refreshes an expired authorization summary from the formal endpoint', async () => {
  useAuthStore.setState({ authorization: {
    userId: 'user-1', employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: false,
    permissions: ['organization.read'], menus: [], fieldCapabilities: {},
    validUntil: '2026-07-18T00:00:00.000Z', evaluatedAt: '2026-07-17T00:00:00.000Z',
  } });
  authorizationMeMock.mockResolvedValueOnce({
    userId: 'user-1', employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: false,
    permissions: ['employee.read'], menus: ['menu.employee'], fieldCapabilities: {},
    validUntil: null, evaluatedAt: '2026-07-19T00:00:00.000Z',
  });

  await useAuthStore.getState().ensureAuthorization();

  expect(authorizationMeMock).toHaveBeenCalledOnce();
  expect(useAuthStore.getState().authorization?.permissions).toEqual(['employee.read']);
  expect(useAuthStore.getState().authorizationStatus).toBe('ready');
});

test('restores ready status from a valid persisted authorization summary', async () => {
  useAuthStore.setState({ authorization: {
    userId: 'user-1', employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: false,
    permissions: ['permission.trace.any'], menus: ['menu.security_trace'], fieldCapabilities: {},
    validUntil: null, evaluatedAt: '2026-07-19T00:00:00.000Z',
  }, authorizationStatus: 'idle' });

  await useAuthStore.getState().ensureAuthorization();

  expect(authorizationMeMock).not.toHaveBeenCalled();
  expect(useAuthStore.getState().authorizationStatus).toBe('ready');
  expect(useAuthStore.getState().hasPermission('permission.trace.any')).toBe(true);
});
