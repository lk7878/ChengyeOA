import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import App from './App';
import { useAuthStore } from './stores/authStore';

beforeEach(() => {
  useAuthStore.setState({ token: null, refreshToken: null, userInfo: null, isAuthenticated: false });
  window.history.pushState({}, '', '/');
});

test('redirects an unauthenticated visit to login', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});
