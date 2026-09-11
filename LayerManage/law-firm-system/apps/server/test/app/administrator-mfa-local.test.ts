import assert from 'node:assert/strict';
import test from 'node:test';
import type { Context } from 'egg';
import administratorMfaGuard from '../../app/middleware/administratorMfaGuard';

test('administrator password sessions pass the guard only with the explicit local setting', async () => {
  for (const localPasswordLogin of [undefined, false, true]) {
    let nextCalls = 0;
    const ctx = {
      app: { config: { identitySecurity: { localPasswordLogin } } },
      path: '/api/v1/authorization/me',
      state: {
        authorization: { isSystemSuperAdmin: true },
        user: { userId: 'local-admin', assuranceLevel: 'PASSWORD' },
      },
      prisma: { mfaFactor: { async findFirst() { return null; } } },
    } as unknown as Context;
    const request = administratorMfaGuard()(ctx, async () => { nextCalls++; });
    if (localPasswordLogin) await request;
    else await assert.rejects(request, { code: 'MFA_ENROLLMENT_REQUIRED' });
    assert.equal(nextCalls, localPasswordLogin ? 1 : 0);
  }
});
