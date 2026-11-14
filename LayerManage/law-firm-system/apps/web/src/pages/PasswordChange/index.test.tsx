import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { runtimeSession } from '@/features/auth/runtime-session';
import { useChallengeStore } from '@/features/auth/challengeStore';
import { useAuthStore } from '@/stores/authStore';
import PasswordChange from './index';

const forcePasswordChangeMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/auth', () => ({ authApi: { forcePasswordChange: forcePasswordChangeMock } }));

beforeEach(() => {
  forcePasswordChangeMock.mockReset();
  runtimeSession.clear();
  useChallengeStore.getState().clear();
  useAuthStore.setState({
    userInfo: null, isAuthenticated: false, bootstrapStatus: 'ready',
    authorization: null, authorizationStatus: 'idle',
  });
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => vi.useRealTimers());

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/password-change']}>
      <Routes>
        <Route path="/password-change" element={<PasswordChange />} />
        <Route path="/login" element={<h1>登录页</h1>} />
        <Route path="/" element={<h1>工作台</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

function submitPasswords(password = 'Replacement-Horse-93!', confirmation = password) {
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
}

test('continues from password change into mandatory MFA enrollment', async () => {
  useChallengeStore.getState().begin('PASSWORD_CHANGE', 'change-token', 300);
  forcePasswordChangeMock.mockResolvedValueOnce({ code: 200, data: {
    mode: 'MFA_ENROLLMENT_REQUIRED', challengeToken: 'mfa-token', expiresIn: 600,
  } });
  renderPage();
  submitPasswords();
  await waitFor(() => expect(forcePasswordChangeMock).toHaveBeenCalledWith(
    'change-token', 'Replacement-Horse-93!', 'Replacement-Horse-93!',
  ));
  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(useChallengeStore.getState()).toMatchObject({ kind: 'MFA_ENROLLMENT', token: 'mfa-token' });
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/change-token|mfa-token/);
});

test('accepts an authenticated continuation without requiring another login', async () => {
  useChallengeStore.getState().begin('PASSWORD_CHANGE', 'change-token', 300);
  forcePasswordChangeMock.mockResolvedValueOnce({ code: 200, data: {
    mode: 'AUTHENTICATED', token: 'access-token', csrfToken: 'csrf-token', expiresIn: 900,
    user: { id: 'u1', username: 'ordinary', name: 'Ordinary', roles: [], permissions: [] },
  } });
  renderPage();
  submitPasswords();
  expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(runtimeSession.getAccessToken()).toBe('access-token');
});

test.each([
  ['PASSWORD_INVALID', '新密码不符合安全要求，请重新输入'],
  ['PASSWORD_REUSED', '新密码不能与初始密码相同'],
])('shows stable copy for %s', async (code, publicMessage) => {
  useChallengeStore.getState().begin('PASSWORD_CHANGE', 'change-token', 300);
  forcePasswordChangeMock.mockRejectedValueOnce({ response: { data: { message: code, detail: 'internal detail' } } });
  renderPage();
  submitPasswords();
  expect(await screen.findByRole('alert')).toHaveTextContent(publicMessage);
  expect(screen.queryByText(/internal detail|PASSWORD_/)).not.toBeInTheDocument();
  expect(useChallengeStore.getState().token).toBe('change-token');
});

test('rejects mismatched confirmation before calling the endpoint', async () => {
  useChallengeStore.getState().begin('PASSWORD_CHANGE', 'change-token', 300);
  renderPage();
  submitPasswords('Replacement-Horse-93!', 'Different-Horse-94!');
  expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
  expect(forcePasswordChangeMock).not.toHaveBeenCalled();
});

test('never renders the form without a current in-memory password challenge', async () => {
  renderPage();
  expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
});

test('automatically clears and redirects when the password challenge expires', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-21T08:00:00.000Z'));
  useChallengeStore.getState().begin('PASSWORD_CHANGE', 'short-token', 1);
  renderPage();
  expect(screen.getByRole('heading', { name: '修改初始密码' })).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(useChallengeStore.getState().token).toBeNull();
});
