import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import MfaEnrollment from './MfaEnrollment';

const beginMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const qrMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/auth', () => ({
  authApi: { beginMfaEnrollment: beginMock, confirmMfaEnrollment: confirmMock },
}));
vi.mock('qrcode', () => ({ default: { toDataURL: qrMock } }));

beforeEach(() => {
  beginMock.mockReset();
  confirmMock.mockReset();
  qrMock.mockReset();
  localStorage.clear();
});

test('generates the QR locally, confirms six digits, and requires recovery-code acknowledgement', async () => {
  const authenticated = vi.fn();
  beginMock.mockResolvedValue({
    code: 200,
    data: { secret: 'JBSWY3DPEHPK3PXP', manualKey: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://safe-local' },
  });
  qrMock.mockResolvedValue('data:image/png;base64,local-qr');
  confirmMock.mockResolvedValue({
    code: 200,
    data: {
      mode: 'AUTHENTICATED', token: 'access-token', csrfToken: 'csrf-token', expiresIn: 900,
      user: { id: 'u1', username: 'admin', name: 'Admin', roles: [], permissions: [] },
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'],
    },
  });

  render(<MfaEnrollment challengeToken="challenge-token" onAuthenticated={authenticated} onExpired={vi.fn()} />);
  expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
  expect(qrMock).toHaveBeenCalledWith('otpauth://safe-local', expect.objectContaining({ width: 220 }));
  expect(await screen.findByRole('img', { name: '身份验证器二维码' })).toHaveAttribute('src', 'data:image/png;base64,local-qr');

  fireEvent.change(screen.getByLabelText('六位验证码'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: '确认绑定' }));
  await waitFor(() => expect(screen.getByText((_, element) => (
    element?.tagName === 'PRE' && element.textContent?.includes('AAAA-BBBB-CCCC-DDDD') === true
  ))).toBeInTheDocument());
  expect(authenticated).not.toHaveBeenCalled();
  expect(JSON.stringify({ ...localStorage })).not.toMatch(/challenge-token|access-token|csrf-token|AAAA-BBBB/);

  fireEvent.click(screen.getByRole('checkbox', { name: '我已安全保存恢复码' }));
  fireEvent.click(screen.getByRole('button', { name: /完\s*成/ }));
  await waitFor(() => expect(authenticated).toHaveBeenCalledOnce());
});
