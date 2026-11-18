import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { UserGrantService } from '../../app/application/authorization/user-grant-service';

const actor: AuthorizationContext = {
  userId: 'self', employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: true,
  grants: [], fieldRules: [], permissionCodes: [], evaluatedAt: new Date('2026-11-18T00:00:00Z'),
};

test('a super administrator can read their own authorization summary', async () => {
  const prisma = { user: { findUnique: async (query: { where: { id: string } }) => {
    assert.equal(query.where.id, actor.userId);
    return { id: actor.userId, status: 'ENABLED', userRoles: [], permissionGrants: [] };
  } } } as unknown as PrismaClient;
  const summary = await new UserGrantService(prisma, actor).summary(actor.userId);
  assert.deepEqual(summary, { userId: actor.userId, status: 'ENABLED', roleGrants: [], specialGrants: [] });
});

const attempts: [string, (service: UserGrantService) => Promise<unknown>][] = [
  ['grant role', service => service.grantRole(actor.userId, 'role', {
    source: 'PERMANENT', validFrom: '2026-11-18T00:00:00Z', validUntil: null, reason: null,
  })],
  ['replace roles', service => service.replaceBusinessRoles(actor.userId, { roleIds: [] })],
  ['revoke role', service => service.revokeRole(actor.userId, 'grant', { reason: 'Self change must be blocked', version: 1 })],
  ['grant special permission', service => service.grantSpecial(actor.userId, {
    permissionCode: 'employee.high_sensitive.read', dataScopeId: 'scope',
    validFrom: '2026-11-18T00:00:00Z', validUntil: '2026-11-19T00:00:00Z', reason: 'Self change must be blocked',
  })],
  ['revoke special permission', service => service.revokeSpecial(actor.userId, 'grant', { reason: 'Self change must be blocked', version: 1 })],
];
for (const [name, attempt] of attempts) {
  test(`self access remains read-only: ${name} is rejected before database access`, async () => {
    const prisma = new Proxy({}, { get() { assert.fail('Self modification must not access the database'); } }) as PrismaClient;
    await assert.rejects(() => attempt(new UserGrantService(prisma, actor)), { code: 'PRIVILEGE_ESCALATION_BLOCKED' });
  });
}
