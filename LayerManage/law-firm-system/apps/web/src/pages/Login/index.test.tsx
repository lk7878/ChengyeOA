import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { runtimeSession } from '@/features/auth/runtime-session';
import { useChallengeStore } from '@/features/auth/challengeStore';
import { useAuthStore } from '@/stores/authStore';
import Login from './index';

const loginMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/auth', () => ({ authApi: { login: loginMock } }));
vi.mock('@/features/auth/components/MfaEnrollment', () => ({
  default: ({ challengeToken }: { challengeToken: string }) => <div>MFA enrollment: {challengeToken}</div>,
}));
vi.mock('@/features/auth/components/MfaChallenge', () => ({
  default: ({ challengeToken }: { challengeToken: string }) => <div>MFA challenge: {challengeToken}</div>,
}));

beforeEach(() => {
  loginMock.mockReset();
  runtimeSession.clear();
  useChallengeStore.getState().clear();
  useAuthStore.setState({
    userInfo: null,
    isAuthenticated: false,
    bootstrapStatus: 'ready',
    authorization: null,
    authorizationStatus: 'idle',
  });
  localStorage.clear();
  sessionStorage.clear();
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/password-change" element={<h1>修改初始密码页</h1>} />
        <Route path="/" element={<h1>工作台</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

function submitLogin() {
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'root.admin' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Initial-Horse-92!' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
}

test('renders explicit username and password inputs and stable failure copy', async () => {
  loginMock.mockRejectedValueOnce(new Error('internal transport detail'));
  renderLogin();
  submitLogin();
  expect(await screen.findByRole('alert')).toHaveTextContent('登录失败，请重试');
  expect(screen.queryByText('internal transport detail')).not.toBeInTheDocument();
});

test('routes PASSWORD_CHANGE_REQUIRED through the in-memory challenge store', async () => {
  loginMock.mockResolvedValueOnce({ code: 200, data: {
    mode: 'PASSWORD_CHANGE_REQUIRED', challengeToken: 'change-token', expiresIn: 300,
  } });
  renderLogin();
  submitLogin();
  expect(await screen.findByRole('heading', { name: '修改初始密码页' })).toBeInTheDocument();
  expect(useChallengeStore.getState()).toMatchObject({ kind: 'PASSWORD_CHANGE', token: 'change-token' });
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('change-token');
});

test('explains rejected credentials without claiming the login session expired or exposing account details', async () => {
  loginMock.mockRejectedValueOnce({
    isAxiosError: true,
    response: { status: 401, data: { message: 'AUTHENTICATION_FAILED', detail: 'ACCOUNT_LOCKED' } },
  });
  renderLogin();
  submitLogin();
  expect(await screen.findByRole('alert')).toHaveTextContent('用户名或密码不正确，或账号暂时无法登录，请核对后重试');
  expect(screen.queryByText(/登录已过期|ACCOUNT_LOCKED|AUTHENTICATION_FAILED/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
});

test.each([
  ['MFA_ENROLLMENT_REQUIRED', 'MFA_ENROLLMENT', 'MFA enrollment: mfa-token'],
  ['MFA_CHALLENGE_REQUIRED', 'MFA_VERIFY', 'MFA challenge: mfa-token'],
] as const)('renders %s without persisting the challenge', async (mode, kind, copy) => {
  loginMock.mockResolvedValueOnce({ code: 200, data: { mode, challengeToken: 'mfa-token', expiresIn: 300 } });
  renderLogin();
  submitLogin();
  expect(await screen.findByText(copy)).toBeInTheDocument();
  expect(useChallengeStore.getState()).toMatchObject({ kind, token: 'mfa-token' });
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('mfa-token');
});

test('stores AUTHENTICATED credentials only in runtime memory and enters the app', async () => {
  loginMock.mockResolvedValueOnce({ code: 200, data: {
    mode: 'AUTHENTICATED', token: 'access-token', csrfToken: 'csrf-token', expiresIn: 900,
    user: { id: 'u1', username: 'root.admin', name: 'Root Admin', roles: [], permissions: [] },
  } });
  renderLogin();
  submitLogin();
  expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
  await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
  expect(runtimeSession.getAccessToken()).toBe('access-token');
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/access-token|csrf-token/);
});
