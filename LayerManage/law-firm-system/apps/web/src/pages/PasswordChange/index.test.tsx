import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { usePasswordChangeStore } from '@/stores/passwordChangeStore';
import PasswordChange from './index';

const forcePasswordChangeMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/auth', () => ({
  authApi: { forcePasswordChange: forcePasswordChangeMock },
}));

beforeEach(() => {
  forcePasswordChangeMock.mockReset();
  useAuthStore.setState({ token: null, refreshToken: null, userInfo: null, isAuthenticated: false });
  usePasswordChangeStore.getState().clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/password-change']}>
      <Routes>
        <Route path="/password-change" element={<PasswordChange />} />
        <Route path="/login" element={<h1>登录页</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

function submitPasswords(password = 'Replacement-Horse-93!', confirmation = password) {
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
}

test('renders two accessible password controls and submits with the in-memory bearer token', async () => {
  const success = vi.spyOn(message, 'success').mockImplementation(() => ({}) as never);
  usePasswordChangeStore.getState().begin('change-token', 300);
  forcePasswordChangeMock.mockResolvedValueOnce({ code: 200, message: 'OK', data: null });

  renderPage();
  expect(screen.getByRole('heading', { name: '修改初始密码' })).toBeInTheDocument();
  expect(screen.getByLabelText('新密码')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('确认新密码')).toHaveAttribute('type', 'password');

  submitPasswords();

  await waitFor(() => expect(forcePasswordChangeMock).toHaveBeenCalledWith(
    'change-token',
    'Replacement-Horse-93!',
    'Replacement-Horse-93!',
  ));
  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(success).toHaveBeenCalledWith('密码已更新，请重新登录');
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(JSON.stringify({ ...window.localStorage })).not.toContain('change-token');
  expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('change-token');
});

describe.each([
  ['PASSWORD_INVALID', '新密码不符合安全要求，请重新输入'],
  ['PASSWORD_REUSED', '新密码不能与初始密码相同'],
])('%s response', (code, publicMessage) => {
  test('shows stable Chinese copy without server internals', async () => {
    usePasswordChangeStore.getState().begin('change-token', 300);
    forcePasswordChangeMock.mockRejectedValueOnce({
      response: { data: { message: code, detail: 'database stack and decoded token' } },
    });

    renderPage();
    submitPasswords();

    expect(await screen.findByRole('alert')).toHaveTextContent(publicMessage);
    expect(screen.queryByText(/database stack|decoded token|PASSWORD_/)).not.toBeInTheDocument();
    expect(usePasswordChangeStore.getState().token).toBe('change-token');
  });
});

test('clears an invalid change token, shows a stable message, and returns to login', async () => {
  const error = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  usePasswordChangeStore.getState().begin('change-token', 300);
  forcePasswordChangeMock.mockRejectedValueOnce({
    response: { data: { message: 'TOKEN_INVALID', detail: 'signed token internals' } },
  });

  renderPage();
  submitPasswords();

  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(error).toHaveBeenCalledWith('登录状态已失效，请重新登录');
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(screen.queryByText(/TOKEN_INVALID|signed token/)).not.toBeInTheDocument();
});

test('rejects mismatched confirmation before calling the endpoint', async () => {
  usePasswordChangeStore.getState().begin('change-token', 300);
  renderPage();
  submitPasswords('Replacement-Horse-93!', 'Different-Horse-94!');

  expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
  expect(forcePasswordChangeMock).not.toHaveBeenCalled();
});

test('page expiry clears memory and returns to login without calling the endpoint', async () => {
  usePasswordChangeStore.setState({ token: 'expired-token', expiresAt: Date.now() - 1 });
  renderPage();

  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(forcePasswordChangeMock).not.toHaveBeenCalled();
});

test('back to login clears both password-change memory and any normal session storage', async () => {
  usePasswordChangeStore.getState().begin('change-token', 300);
  useAuthStore.setState({
    token: 'old-access',
    refreshToken: 'old-refresh',
    userInfo: null,
    isAuthenticated: false,
  });
  window.localStorage.setItem('law_firm_token', 'old-access');
  window.localStorage.setItem('law_firm_refresh_token', 'old-refresh');

  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '返回登录' }));

  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(useAuthStore.getState()).toMatchObject({
    token: null,
    refreshToken: null,
    userInfo: null,
    isAuthenticated: false,
  });
  expect(window.localStorage.getItem('law_firm_token')).toBeNull();
  expect(window.localStorage.getItem('law_firm_refresh_token')).toBeNull();
});
