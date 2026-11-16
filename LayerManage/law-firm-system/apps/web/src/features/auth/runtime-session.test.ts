import { beforeEach, expect, test, vi } from 'vitest';
import { runtimeSession } from './runtime-session';

beforeEach(() => {
  runtimeSession.clear();
  localStorage.clear();
});

test('keeps access and CSRF credentials only in module memory and purges legacy storage', () => {
  localStorage.setItem('law_firm_token', 'legacy-access');
  localStorage.setItem('law_firm_refresh_token', 'legacy-refresh');
  localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'persisted-access' } }));

  runtimeSession.setAuthenticated({
    token: 'memory-access', csrfToken: 'memory-csrf', expiresIn: 900,
  });

  expect(runtimeSession.getAccessToken()).toBe('memory-access');
  expect(runtimeSession.getCsrfToken()).toBe('memory-csrf');
  expect(JSON.stringify({ ...localStorage })).not.toMatch(/legacy|persisted|memory-access|memory-csrf/);
});

test('coalesces concurrent refreshes into one request and clears after terminal failure', async () => {
  const refresh = vi.fn().mockResolvedValue({
    token: 'refreshed-access', csrfToken: 'refreshed-csrf', expiresIn: 900,
  });
  const [first, second] = await Promise.all([
    runtimeSession.refreshOnce(refresh),
    runtimeSession.refreshOnce(refresh),
  ]);
  expect(first).toBe('refreshed-access');
  expect(second).toBe('refreshed-access');
  expect(refresh).toHaveBeenCalledOnce();

  const failure = vi.fn().mockRejectedValue(new Error('expired'));
  await expect(runtimeSession.refreshOnce(failure)).rejects.toThrow('expired');
  expect(runtimeSession.getAccessToken()).toBeNull();
  expect(runtimeSession.getCsrfToken()).toBeNull();
});

test('a late refresh cannot replace credentials rotated by personal password change', async () => {
  let resolve!: (value: { token: string; csrfToken: string; expiresIn: number }) => void;
  const pending = runtimeSession.refreshOnce(() => new Promise(done => { resolve = done; }));
  runtimeSession.setAuthenticated({ token: 'after-password-change', csrfToken: 'new-csrf', expiresIn: 900 });
  resolve({ token: 'stale-refresh', csrfToken: 'old-csrf', expiresIn: 900 });
  expect(await pending).toBe('after-password-change');
  expect(runtimeSession.getAccessToken()).toBe('after-password-change');
});
