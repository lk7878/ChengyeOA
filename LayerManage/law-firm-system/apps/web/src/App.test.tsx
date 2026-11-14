import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App';
import { useAuthStore } from './stores/authStore';
import { useChallengeStore } from './features/auth/challengeStore';
import { runtimeSession } from './features/auth/runtime-session';
import { authApi } from './api/auth';
import { authorizationApi } from './features/authorization/api';

vi.mock('./pages/SecurityRole', () => ({ default: () => <div>Role page</div> }));
vi.mock('./pages/AdminGovernance', () => ({ default: () => <div>Administrator governance page</div> }));
vi.mock('./pages/EventOperations', () => ({ default: () => <div>Event operations page</div> }));
vi.mock('./pages/SecuritySettings', () => ({ default: () => <div>Account security page</div> }));
vi.mock('./pages/Dashboard', () => ({ default: () => <div>Dashboard page</div> }));

function observePasswordChangeUi() {
  const exposure = { heading: false, form: false, password: false, confirmation: false };
  const scan = (node: Node) => {
    if (!(node instanceof Element)) return;
    exposure.heading ||=
      Array.from(node.querySelectorAll('h2')).some((heading) => heading.textContent === '修改初始密码') ||
      (node.matches('h2') && node.textContent === '修改初始密码');
    exposure.form ||=
      node.matches('form#password-change') || Boolean(node.querySelector('form#password-change'));
    exposure.password ||=
      node.matches('[aria-label="新密码"]') || Boolean(node.querySelector('[aria-label="新密码"]'));
    exposure.confirmation ||=
      node.matches('[aria-label="确认新密码"]') || Boolean(node.querySelector('[aria-label="确认新密码"]'));
  };
  const consume = (records: MutationRecord[]) => {
    records.forEach((record) => record.addedNodes.forEach(scan));
  };
  const observer = new MutationObserver(consume);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    consume(observer.takeRecords());
    observer.disconnect();
    return exposure;
  };
}

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.spyOn(authorizationApi, 'me').mockImplementation(
    async () =>
      useAuthStore.getState().authorization || {
        userId: useAuthStore.getState().userInfo!.id,
        employeeId: null,
        isSystemSuperAdmin: false,
        isSystemAdmin: false,
        permissions: [],
        menus: [],
        fieldCapabilities: {},
        validUntil: null,
        evaluatedAt: new Date().toISOString(),
      },
  );
  useAuthStore.setState({
    userInfo: null,
    isAuthenticated: false,
    bootstrapStatus: 'ready',
    authorization: null,
    authorizationStatus: 'idle',
  });
  useChallengeStore.getState().clear();
  runtimeSession.clear();
  window.history.pushState({}, '', '/');
});

test('redirects an unauthenticated visit to login', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});

test('redirects a direct password-change visit without current in-memory state to login', async () => {
  window.history.pushState({}, '', '/password-change');
  render(<App />);

  expect(await screen.findByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});

test('allows the password-change route only with a current in-memory token', async () => {
  useChallengeStore.getState().begin('PASSWORD_CHANGE', 'change-token', 300);
  window.history.pushState({}, '', '/password-change');
  render(<App />);

  expect(await screen.findByRole('heading', { name: '修改初始密码' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/password-change');
});

test('clears an expired route token and redirects to login', async () => {
  useChallengeStore.setState({ kind: 'PASSWORD_CHANGE', token: 'expired-token', expiresAt: Date.now() - 1 });
  window.history.pushState({}, '', '/password-change');
  const stopObserving = observePasswordChangeUi();
  render(<App />);

  expect(stopObserving()).toEqual({ heading: false, form: false, password: false, confirmation: false });
  expect(screen.queryByRole('heading', { name: '修改初始密码' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('确认新密码')).not.toBeInTheDocument();
  expect(document.querySelector('form#password-change')).toBeNull();
  expect(await screen.findByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
  expect(useChallengeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(window.location.pathname).toBe('/login');
});

test('does not allow an authenticated user to enter password change even with memory state', async () => {
  useAuthStore.setState({
    bootstrapStatus: 'ready',
    userInfo: { id: 'user-1', username: 'admin', name: 'Admin', roles: ['admin'], permissions: [] },
    isAuthenticated: true,
  });
  useChallengeStore.getState().begin('PASSWORD_CHANGE', 'change-token', 300);
  window.history.pushState({}, '', '/password-change');
  render(<App />);

  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '修改初始密码' })).not.toBeInTheDocument();
  await waitFor(() => expect(useChallengeStore.getState().token).toBeNull());
});

test('does not admit organization routes from a legacy admin role name', async () => {
  useAuthStore.setState({
    bootstrapStatus: 'ready',
    isAuthenticated: true,
    userInfo: { id: 'user-1', username: 'admin', name: 'Admin', roles: ['admin'], permissions: [] },
    authorization: {
      userId: 'user-1',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions: [],
      menus: [],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
  window.history.pushState({}, '', '/org/tree');
  render(<App />);

  expect(await screen.findByText('无权访问此页面')).toBeInTheDocument();
});

test('redirects the legacy roles path to the permission-protected security route', async () => {
  useAuthStore.setState({
    bootstrapStatus: 'ready',
    isAuthenticated: true,
    userInfo: { id: 'user-1', username: 'role.reader', name: 'Role Reader' },
    authorization: {
      userId: 'user-1',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions: ['role.read'],
      menus: ['menu.security_roles'],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
  window.history.pushState({}, '', '/roles');
  render(<App />);

  await waitFor(() => expect(window.location.pathname).toBe('/security/roles'));
});

test('protects administrator governance with the catalog permission', async () => {
  useAuthStore.setState({
    bootstrapStatus: 'ready',
    isAuthenticated: true,
    userInfo: { id: 'user-1', username: 'system.admin', name: 'System Admin' },
    authorization: {
      userId: 'user-1',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: true,
      permissions: ['governance.catalog.read'],
      menus: ['menu.admin_governance'],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
  window.history.pushState({}, '', '/security/admin-governance');
  render(<App />);
  expect(await screen.findByText('Administrator governance page')).toBeInTheDocument();
});

test('protects event operations with the delivery read permission', async () => {
  useAuthStore.setState({
    bootstrapStatus: 'ready',
    isAuthenticated: true,
    userInfo: { id: 'user-1', username: 'event.operator', name: 'Event Operator' },
    authorization: {
      userId: 'user-1',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: true,
      permissions: ['event.delivery.read'],
      menus: ['menu.event_operations'],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
  window.history.pushState({}, '', '/security/event-operations');
  render(<App />);
  expect(await screen.findByText('Event operations page')).toBeInTheDocument();
});

test('denies direct event operations access without the delivery read permission', async () => {
  useAuthStore.setState({
    bootstrapStatus: 'ready',
    isAuthenticated: true,
    userInfo: { id: 'user-1', username: 'event.viewer', name: 'Event Viewer' },
    authorization: {
      userId: 'user-1',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions: [],
      menus: ['menu.event_operations'],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
  window.history.pushState({}, '', '/security/event-operations');
  render(<App />);
  expect(await screen.findByText('无权访问此页面')).toBeInTheDocument();
  expect(screen.queryByText('Event operations page')).not.toBeInTheDocument();
});

test('allows every authenticated user to open account security without a new permission', async () => {
  useAuthStore.setState({
    bootstrapStatus: 'ready',
    isAuthenticated: true,
    userInfo: { id: 'user-1', username: 'ordinary', name: 'Ordinary User' },
    authorization: {
      userId: 'user-1',
      employeeId: null,
      isSystemSuperAdmin: false,
      isSystemAdmin: false,
      permissions: [],
      menus: [],
      fieldCapabilities: {},
      validUntil: null,
      evaluatedAt: new Date().toISOString(),
    },
    authorizationStatus: 'ready',
  });
  window.history.pushState({}, '', '/security/account');
  render(<App />);
  expect(await screen.findByText('Account security page')).toBeInTheDocument();
});

test('restores the server session once before rendering protected routes', async () => {
  const refresh = vi.spyOn(runtimeSession, 'refreshOnce').mockResolvedValueOnce('restored-token');
  const me = vi.spyOn(authApi, 'me').mockResolvedValueOnce({
    code: 200,
    message: 'OK',
    data: { id: 'restored-user', username: 'restored', name: 'Restored User', roles: [], permissions: [] },
  });
  useAuthStore.setState({
    userInfo: null,
    isAuthenticated: false,
    bootstrapStatus: 'idle',
    authorization: null,
    authorizationStatus: 'idle',
  });

  render(<App />);
  expect(screen.getByLabelText('正在恢复会话')).toBeInTheDocument();
  await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
  expect(refresh).toHaveBeenCalledOnce();
  expect(me).toHaveBeenCalledOnce();
  expect(window.location.pathname).toBe('/');
});
