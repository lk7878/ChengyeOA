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

test('shows MFA state, protects administrator MFA, and marks the current session', async () => {
  setUser(true);
  render(<SecuritySettingsPage />);
  expect(await screen.findByText('已启用')).toBeInTheDocument();
  expect(screen.getByText('剩余恢复码：7')).toBeInTheDocument();
  expect(screen.getByText('当前会话')).toBeInTheDocument();
  expect(screen.getByText('管理员必须保持 MFA 启用')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '停用 MFA' })).not.toBeInTheDocument();
});

test('allows an ordinary user to start and complete optional MFA enrollment', async () => {
  setUser(false);
  vi.mocked(authApi.mfaStatus).mockResolvedValue({
    code: 200, message: 'OK', data: { enabled: false, verifiedAt: null, recoveryCodesRemaining: 0 },
  });
  render(<SecuritySettingsPage />);

  fireEvent.click(await screen.findByRole('button', { name: '绑定身份验证器' }));
  await waitFor(() => expect(authApi.startMfaEnrollment).toHaveBeenCalledOnce());
  fireEvent.click(await screen.findByRole('button', { name: 'complete optional enrollment' }));

  await waitFor(() => expect(useAuthStore.getState().userInfo?.username).toBe('ordinary.mfa'));
  await waitFor(() => expect(
    screen.queryByRole('button', { name: 'complete optional enrollment' }),
  ).not.toBeInTheDocument());
});

test('requires acknowledgement before regenerating and acknowledging newly displayed recovery codes', async () => {
  setUser(false);
  render(<SecuritySettingsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '重新生成恢复码' }));
  expect(screen.getByRole('button', { name: '继续生成' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '我知道旧恢复码将立即失效' }));
  fireEvent.click(screen.getByRole('button', { name: '继续生成' }));
  await waitFor(() => expect(authApi.regenerateRecoveryCodes).toHaveBeenCalledWith('one-time-grant'));
  expect(runStepUp.mock.calls[0][0]).toMatchObject({
    purpose: 'MFA_RECOVERY_CODES_REGENERATE', target: { userId: 'u1' },
  });
  expect(await screen.findByText((_, element) => element?.tagName === 'PRE'
    && Boolean(element.textContent?.includes('AAAA-BBBB-CCCC-DDDD')))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '完成' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '我已安全保存这些恢复码' }));
  expect(screen.getByRole('button', { name: '完成' })).toBeEnabled();
});

test('binds session revoke and logout-all grants to the intended targets', async () => {
  setUser(false);
  render(<SecuritySettingsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '撤销会话 s2' }));
  await waitFor(() => expect(authApi.revokeSession).toHaveBeenCalledWith('s2', 'one-time-grant'));
  fireEvent.click(screen.getByRole('checkbox', { name: '保留当前会话' }));
  fireEvent.click(screen.getByRole('button', { name: '退出其他会话' }));
  await waitFor(() => expect(authApi.logoutAll).toHaveBeenCalledWith('one-time-grant', true));
  expect(runStepUp.mock.calls.map(call => call[0]).map(({ purpose, target }) => ({ purpose, target }))).toEqual([
    { purpose: 'SESSION_REVOKE', target: { sessionId: 's2' } },
    { purpose: 'SESSION_REVOKE_ALL', target: { userId: 'u1' } },
  ]);
});


test('unbound local administrator has an enrollment entry while disabling MFA stays unavailable', async()=>{
 setUser(true);vi.mocked(authApi.mfaStatus).mockResolvedValue({data:{enabled:false,verifiedAt:null,recoveryCodesRemaining:0}} as never);
 render(<SecuritySettingsPage/>);fireEvent.click(await screen.findByRole('button',{name:'绑定身份验证器'}));
 await waitFor(()=>expect(authApi.startMfaEnrollment).toHaveBeenCalledOnce());
 expect(screen.queryByRole('button',{name:'停用 MFA'})).not.toBeInTheDocument();
});
