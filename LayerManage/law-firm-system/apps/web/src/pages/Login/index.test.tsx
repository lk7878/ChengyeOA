import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import Login from './index';

const loginMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/auth', () => ({
  authApi: { login: loginMock },
}));

afterEach(() => loginMock.mockReset());

test('renders explicit username and password inputs', () => {
  render(<MemoryRouter><Login /></MemoryRouter>);
  expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('密码')).toBeInTheDocument();
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
