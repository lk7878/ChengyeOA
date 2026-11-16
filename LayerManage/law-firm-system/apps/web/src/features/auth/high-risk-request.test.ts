import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { expect, test, vi } from 'vitest';
import request from '@/api/request';
import { registerHighRiskHandler } from './high-risk-request';
import { runtimeSession } from './runtime-session';
test('retries only after explicit action verification, preserving body and using credentials rotated during enrollment', async () => {
  runtimeSession.setAuthenticated({ token: 'before', csrfToken: 'before-csrf', expiresIn: 900 });
  const target = { method: 'POST', path: '/api/v1/roles', payloadHash: 'a'.repeat(64) };
  const verify = vi.fn(async () => { runtimeSession.setAuthenticated({ token: 'after', csrfToken: 'after-csrf', expiresIn: 900 }); return 'one-use-proof'; });
  const unregister = registerHighRiskHandler(verify);
  const configs: InternalAxiosRequestConfig[] = [];
  try {
    await request.post('/v1/roles', { name: 'Reviewed role' }, { suppressGlobalError: true, adapter: async config => {
      configs.push(config);
      if (configs.length === 1) throw new AxiosError('step-up', undefined, config, undefined, {
        status: 403, statusText: 'Forbidden', headers: {}, config,
        data: { code: 403, message: 'STEP_UP_REQUIRED', errors: { purpose: 'ADMIN_HIGH_RISK', target, impact: '修改管理权限' } },
      });
      expect(config.headers.get('X-Step-Up-Token')).toBe('one-use-proof');
      expect(config.headers.get('Authorization')).toBe('Bearer after');
      expect(config.headers.get('X-CSRF-Token')).toBe('after-csrf');
      expect(JSON.parse(config.data)).toEqual({ name: 'Reviewed role' });
      return { status: 200, statusText: 'OK', headers: {}, config, data: { code: 200, data: { id: 'created' } } };
    } });
    expect(verify).toHaveBeenCalledWith({ purpose: 'ADMIN_HIGH_RISK', target, impact: '修改管理权限' });
    expect(configs).toHaveLength(2);
  } finally { unregister(); runtimeSession.clear(); }
});
