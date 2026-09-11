import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import MfaChallenge from './MfaChallenge';

const verifyMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/auth', () => ({ authApi: { verifyMfa: verifyMock } }));

beforeEach(() => verifyMock.mockReset());

test('supports TOTP and recovery-code verification without persistent challenge state', async () => {
  const authenticated = vi.fn();
  verifyMock.mockResolvedValue({
    code: 200,
    data: {
      mode: 'AUTHENTICATED', token: 'access-token', csrfToken: 'csrf-token', expiresIn: 900,
      user: { id: 'u1', username: 'admin', name: 'Admin', roles: [], permissions: [] },
    },
  });
  render(<MfaChallenge challengeToken="challenge-token" onAuthenticated={authenticated} onExpired={vi.fn()} />);

  fireEvent.change(screen.getByLabelText('六位验证码'), { target: { value: '12345' } });
  expect(screen.getByRole('button', { name: '提交 MFA 验证' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('六位验证码'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '提交 MFA 验证' }));
  await waitFor(() => expect(verifyMock).toHaveBeenCalledWith(
    'challenge-token', { kind: 'TOTP', code: '123456' },
  ));
  await waitFor(() => expect(authenticated).toHaveBeenCalledOnce());

  verifyMock.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '使用恢复码' }));
  fireEvent.change(screen.getByLabelText('恢复码'), { target: { value: 'aaaa-bbbb-cccc-dddd' } });
  fireEvent.click(screen.getByRole('button', { name: '提交 MFA 验证' }));
  await waitFor(() => expect(verifyMock).toHaveBeenCalledWith(
    'challenge-token', { kind: 'RECOVERY_CODE', code: 'AAAA-BBBB-CCCC-DDDD' },
  ));
});
