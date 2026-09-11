import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from 'egg';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import {
  authorizationContextMiddleware,
  isAuthorizationPublicPath,
} from '../../app/middleware/authorizationContext';
import { requirePermission } from '../../app/middleware/requirePermission';

const loadedContext: AuthorizationContext = {
  userId: 'user-1',
  employeeId: null,
  isSystemAdmin: false,
  isSystemSuperAdmin: false,
  grants: [],
  fieldRules: [],
  permissionCodes: ['organization.read'],
  evaluatedAt: new Date('2026-07-18T12:00:00.000Z'),
};

function fakeContext(path: string, userId?: string): Context {
  return {
    path,
    state: userId ? { user: { userId } } : {},
  } as unknown as Context;
}

test('leaves health login refresh and forced-change routes untouched', async () => {
  for (const path of ['/api/health', '/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/password/forced-change']) {
    assert.equal(isAuthorizationPublicPath(path), true);
    let loaded = 0;
    let next = 0;
    await authorizationContextMiddleware(() => ({
      load: async () => { loaded += 1; return loadedContext; },
    }))(fakeContext(path), async () => { next += 1; });
    assert.equal(loaded, 0);
    assert.equal(next, 1);
  }
});

test('requires authenticated state and builds one context per request', async () => {
  const middleware = authorizationContextMiddleware(() => ({
    load: async () => loadedContext,
  }));
  await assert.rejects(
    () => middleware(fakeContext('/api/v1/organizations'), async () => undefined),
    error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'AUTHENTICATION_REQUIRED'),
  );

  let loaded = 0;
  const ctx = fakeContext('/api/v1/organizations', 'user-1');
  const counted = authorizationContextMiddleware(() => ({
    load: async () => { loaded += 1; return loadedContext; },
  }));
  await counted(ctx, async () => counted(ctx, async () => undefined));
  assert.equal(loaded, 1);
  assert.equal(ctx.state.authorization, loadedContext);
});

test('permission middleware denies missing actions and reaches next for active grants', async () => {
  const denied = fakeContext('/api/v1/organizations', 'user-1');
  denied.state.authorization = { ...loadedContext, permissionCodes: [] };
  await assert.rejects(
    () => requirePermission('organization.read')(denied, async () => undefined),
    error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PERMISSION_DENIED'),
  );

  const allowed = fakeContext('/api/v1/organizations', 'user-1');
  allowed.state.authorization = loadedContext;
  let reached = 0;
  await requirePermission('organization.read')(allowed, async () => { reached += 1; });
  assert.equal(reached, 1);
});
