import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test } from 'vitest';
import Login from './index';

test('renders explicit username and password inputs', () => {
  render(<MemoryRouter><Login /></MemoryRouter>);
  expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('密码')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /登\s*录/ })).toBeInTheDocument();
});
