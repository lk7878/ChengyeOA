import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import App from './App';
import { useAuthStore } from './stores/authStore';
import { usePasswordChangeStore } from './stores/passwordChangeStore';

beforeEach(() => {
  useAuthStore.setState({ token: null, refreshToken: null, userInfo: null, isAuthenticated: false });
  usePasswordChangeStore.getState().clear();
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
  usePasswordChangeStore.getState().begin('change-token', 300);
  window.history.pushState({}, '', '/password-change');
  render(<App />);

  expect(await screen.findByRole('heading', { name: '修改初始密码' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/password-change');
});

test('clears an expired route token and redirects to login', async () => {
  usePasswordChangeStore.setState({ token: 'expired-token', expiresAt: Date.now() - 1 });
  window.history.pushState({}, '', '/password-change');
  render(<App />);

  expect(await screen.findByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(window.location.pathname).toBe('/login');
});

test('does not allow an authenticated user to enter password change even with memory state', async () => {
  useAuthStore.setState({
    token: 'access-token',
    refreshToken: 'refresh-token',
    userInfo: { id: 'user-1', username: 'admin', name: 'Admin', roles: ['admin'], permissions: [] },
    isAuthenticated: true,
  });
  usePasswordChangeStore.getState().begin('change-token', 300);
  window.history.pushState({}, '', '/password-change');
  render(<App />);

  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(screen.queryByRole('heading', { name: '修改初始密码' })).not.toBeInTheDocument();
  await waitFor(() => expect(usePasswordChangeStore.getState().token).toBeNull());
});
