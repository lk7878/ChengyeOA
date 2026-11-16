import assert from 'node:assert/strict';
import test from 'node:test';
import type { Context } from 'egg';
import administratorMfaGuard from '../../app/middleware/administratorMfaGuard';

test('ordinary administrator reads do not depend on a development bypass', async () => {
  for (const localPasswordLogin of [undefined, false, true]) {
    let nextCalls = 0;
    const ctx = {
      app: { config: { identitySecurity: { localPasswordLogin } } },
      method: 'GET', request: { body: {} },
      path: '/api/v1/authorization/me',
      state: {
        authorization: { isSystemSuperAdmin: true },
        user: { userId: 'local-admin', assuranceLevel: 'PASSWORD' },
      },
      prisma: { mfaFactor: { async findFirst() { return null; } } },
    } as unknown as Context;
    const request = administratorMfaGuard()(ctx, async () => { nextCalls++; });
    await request;
    assert.equal(nextCalls, 1);
  }
});
