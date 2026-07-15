import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import App from '@/App';
import { useAuthStore } from '@/stores/authStore';
import { usePasswordChangeStore } from '@/stores/passwordChangeStore';
import Login from './index';

const loginMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/auth', () => ({
  authApi: { login: loginMock },
}));

beforeEach(() => {
  loginMock.mockReset();
  useAuthStore.setState({ token: null, refreshToken: null, userInfo: null, isAuthenticated: false });
  usePasswordChangeStore.getState().clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.pushState({}, '', '/login');
});

afterEach(() => loginMock.mockReset());

function submitLogin(username = 'root.admin', password = 'Initial-Horse-92!') {
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
}

test('renders explicit username and password inputs', () => {
  render(<MemoryRouter><Login /></MemoryRouter>);
  expect(screen.getByLabelText('用户名')).toBeInTheDocument();
  expect(screen.getByLabelText('密码')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
});

test('shows a stable page error when the login API fails', async () => {
  loginMock.mockRejectedValueOnce(new Error('internal transport detail'));
  const { container } = render(<MemoryRouter><Login /></MemoryRouter>);
  const username = container.querySelector('input:not([type="password"])');
  const password = container.querySelector('input[type="password"]');
  expect(username).not.toBeNull();
  expect(password).not.toBeNull();
  if (!username || !password) throw new Error('Login inputs were not rendered');

  fireEvent.change(username, { target: { value: 'missing-user' } });
  fireEvent.change(password, { target: { value: 'bad-password' } });
  fireEvent.click(screen.getByRole('button'));

  expect(await screen.findByRole('alert')).toHaveTextContent('登录失败，请重试');
  expect(screen.queryByText('internal transport detail')).not.toBeInTheDocument();
});

test('routes a forced-change login without persisting any password-change token or normal session', async () => {
  window.localStorage.setItem('law_firm_token', 'old-access');
  window.localStorage.setItem('law_firm_refresh_token', 'old-refresh');
  window.sessionStorage.setItem('unrelated', 'keep-me');
  loginMock.mockResolvedValueOnce({
    code: 200,
    message: 'OK',
    data: {
      mode: 'PASSWORD_CHANGE_REQUIRED',
      passwordChangeToken: 'change-token',
      expiresIn: 300,
    },
  });

  render(<App />);
  submitLogin();

  expect(await screen.findByRole('heading', { name: '修改初始密码' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/password-change');
  expect(window.localStorage.getItem('law_firm_token')).toBeNull();
  expect(window.localStorage.getItem('law_firm_refresh_token')).toBeNull();
  expect(window.localStorage.getItem('password_change_token')).toBeNull();
  expect(window.sessionStorage.getItem('password_change_token')).toBeNull();
  expect(JSON.stringify({ ...window.localStorage })).not.toContain('change-token');
  expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('change-token');
  expect(document.cookie).not.toContain('change-token');
  expect(window.location.href).not.toContain('change-token');
  expect(window.location.search).toBe('');
  expect(window.location.hash).toBe('');
  expect(useAuthStore.getState()).toMatchObject({
    token: null,
    refreshToken: null,
    userInfo: null,
    isAuthenticated: false,
  });
  expect(usePasswordChangeStore.getState().token).toBe('change-token');
});

test('keeps the existing authenticated login session and storage behavior', async () => {
  loginMock.mockResolvedValueOnce({
    code: 200,
    message: 'OK',
    data: {
      mode: 'AUTHENTICATED',
      token: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 604800,
      user: {
        id: 'user-1',
        username: 'root.admin',
        name: 'Root Admin',
        roles: ['admin'],
        permissions: [],
      },
    },
  });

  render(<App />);
  submitLogin();

  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(window.localStorage.getItem('law_firm_token')).toBe('access-token');
  expect(window.localStorage.getItem('law_firm_refresh_token')).toBe('refresh-token');
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(usePasswordChangeStore.getState().token).toBeNull();
});
