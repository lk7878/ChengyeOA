import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import SecuritySettingsPage from './index';

const runStepUp = vi.hoisted(() => vi.fn());
vi.mock('@/features/auth/useStepUp', () => ({
  useStepUp: () => ({
    run: runStepUp,
    dialogProps: { open: false, purpose: 'SESSION_REVOKE', impact: '', loading: false, onCancel: vi.fn(), onVerify: vi.fn() },
  }),
}));
vi.mock('@/features/auth/components/StepUpDialog', () => ({ default: () => null }));
vi.mock('@/features/auth/components/MfaEnrollment', () => ({
  default: ({ onAuthenticated }: { onAuthenticated: (data: unknown) => void }) => (
    <button aria-label="complete optional enrollment" onClick={() => onAuthenticated({
      mode: 'AUTHENTICATED', token: 'mfa-access', csrfToken: 'mfa-csrf', expiresIn: 900,
      user: { id: 'u1', username: 'ordinary.mfa', name: 'Ordinary MFA', roles: [], permissions: [] },
      recoveryCodes: ['SAFE-CODE'],
    })}>complete optional enrollment</button>
  ),
}));
vi.mock('@/api/auth', () => ({ authApi: {
  mfaStatus: vi.fn(), sessions: vi.fn(), regenerateRecoveryCodes: vi.fn(), disableMfa: vi.fn(),
  revokeSession: vi.fn(), logoutAll: vi.fn(), startMfaEnrollment: vi.fn(),
} }));

beforeEach(() => {
  vi.clearAllMocks();
  runStepUp.mockImplementation(async request => request.mutate('one-time-grant'));
  vi.mocked(authApi.mfaStatus).mockResolvedValue({ code: 200, message: 'OK', data: {
    enabled: true, verifiedAt: '2026-07-21T08:00:00.000Z', recoveryCodesRemaining: 7,
  } });
  vi.mocked(authApi.sessions).mockResolvedValue({ code: 200, message: 'OK', data: [
    { id: 's1', assuranceLevel: 'MFA', createdAt: '2026-07-21T08:00:00.000Z', lastSeenAt: '2026-07-21T09:00:00.000Z', expiresAt: '2026-08-20T08:00:00.000Z', current: true, ipPrefix: '10.0.0.0/24' },
    { id: 's2', assuranceLevel: 'MFA', createdAt: '2026-07-20T08:00:00.000Z', lastSeenAt: '2026-07-20T09:00:00.000Z', expiresAt: '2026-08-19T08:00:00.000Z', current: false, ipPrefix: null },
  ] });
  vi.mocked(authApi.regenerateRecoveryCodes).mockResolvedValue({ code: 200, message: 'OK', data: {
    recoveryCodes: ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'],
  } });
  vi.mocked(authApi.revokeSession).mockResolvedValue({ code: 200, message: 'OK', data: null });
  vi.mocked(authApi.logoutAll).mockResolvedValue({ code: 200, message: 'OK', data: { revokedCount: 1 } });
  vi.mocked(authApi.startMfaEnrollment).mockResolvedValue({
    code: 200, message: 'OK', data: { challengeToken: 'optional-enrollment', expiresIn: 600 },
  });
});

function setUser(admin: boolean) {
  useAuthStore.setState({
    userInfo: { id: 'u1', username: 'admin', name: 'Admin' }, isAuthenticated: true, bootstrapStatus: 'ready',
    authorization: {
      userId: 'u1', employeeId: null, isSystemSuperAdmin: admin, isSystemAdmin: false,
      permissions: [], menus: [], fieldCapabilities: {}, validUntil: null, evaluatedAt: new Date().toISOString(),
    },
  });
}


test('presents password, devices and optional advanced security with no mandatory ordinary-user factor', async () => {
  setUser(false); render(<SecuritySettingsPage />);
  expect(await screen.findByText('当前设备')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '修改密码' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('高级安全设置'));
  expect(await screen.findByText(/普通账号无需安装验证器/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '绑定身份验证器' })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('退费审批等操作');
});
test('logs out another device and other devices with confirmation but without step-up', async () => {
  setUser(false); render(<SecuritySettingsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '退出该设备 s2' }));
  fireEvent.click(await screen.findByRole('button', { name: /退\s*出$/ }));
  await waitFor(() => expect(authApi.revokeSession).toHaveBeenCalledWith('s2'));
  fireEvent.click(screen.getByRole('button', { name: '退出其他设备' }));
  fireEvent.click(await screen.findByRole('button', { name: /退\s*出$/ }));
  await waitFor(() => expect(authApi.logoutAll).toHaveBeenCalledWith('', true));
  expect(runStepUp).not.toHaveBeenCalled();
});
test('administrator binds in the existing page without resetting authorization or losing context', async () => {
  setUser(true); vi.mocked(authApi.mfaStatus).mockResolvedValue({ data: { enabled: false } } as never);
  render(<SecuritySettingsPage />); fireEvent.click(screen.getByText('高级安全设置'));
  fireEvent.click(await screen.findByRole('button', { name: '绑定身份验证器' }));
  fireEvent.click(await screen.findByRole('button', { name: 'complete optional enrollment' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'complete optional enrollment' })).not.toBeInTheDocument());
  expect(useAuthStore.getState().authorization?.isSystemSuperAdmin).toBe(true);
});
