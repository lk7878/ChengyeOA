import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve(__dirname, '../../app/router.ts'), 'utf8');

const protectedRoutes = [
  ['get', '/api/v1/admin-governance/catalog', 'governance.catalog.read'],
  ['get', '/api/v1/admin-governance/targets/users', 'governance.catalog.read'],
  ['post', '/api/v1/admin-governance/operations', 'governance.operation.create'],
  ['post', '/api/v1/admin-governance/operations/:id/review', 'governance.review'],
  ['post', '/api/v1/admin-governance/operations/:id/retry', 'governance.retry'],
] as const;

test('registers the statically permissioned governance routes', () => {
  for (const [method, route, permission] of protectedRoutes) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(source, new RegExp(
      `router\\.${method}\\(\\s*['"]${escaped}['"]\\s*,\\s*requirePermission\\(['"]${permission}['"]\\)`,
    ));
  }
});

test('registers self-or-all governance routes without weakening JWT middleware', () => {
  for (const [method, route, handler] of [
    ['get', '/api/v1/admin-governance/operations', 'index'],
    ['get', '/api/v1/admin-governance/operations/:id', 'show'],
    ['post', '/api/v1/admin-governance/operations/:id/cancel', 'cancel'],
  ] as const) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(source, new RegExp(
      `router\\.${method}\\(\\s*['"]${escaped}['"]\\s*,\\s*controller\\.adminGovernance\\.${handler}\\s*\\)`,
    ));
  }
  assert.doesNotMatch(source, /PUBLIC_PATHS[\s\S]*admin-governance/);
});
