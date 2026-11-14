import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESOURCE_SCOPE_RESOLVERS,
  ScopeResolutionInput,
} from '../../app/application/authorization/resource-scope-resolvers';

const input: ScopeResolutionInput = {
  userId: 'user-1',
  evaluatedAt: new Date('2026-07-18T12:00:00.000Z'),
  all: false,
  organizationTargets: [
    { path: '/root/branch-a', includeDescendants: true },
    { path: '/root/hq', includeDescendants: false },
  ],
  professionalTeamIds: ['team-1'],
  employeeIds: ['employee-1', 'employee-2'],
};

test('registers structured Prisma resolvers for every current scoped resource', () => {
  assert.deepEqual(Object.keys(RESOURCE_SCOPE_RESOLVERS).sort(), [
    'employee',
    'employee_assignment',
    'employee_reporting_line',
    'organization',
    'position',
    'professional_team',
    'professional_team_member',
    'user',
  ]);

  for (const resolver of Object.values(RESOURCE_SCOPE_RESOLVERS)) {
    const where = resolver.buildWhere(input);
    assert.equal(typeof where, 'object', resolver.resource);
    assert.ok(JSON.stringify(where).includes('/root/branch-a'), resolver.resource);
    assert.doesNotMatch(JSON.stringify(where), /SELECT|WITH RECURSIVE|\$queryRaw/i);
  }
});

test('record lookup combines the list predicate with an id without reading an unrestricted row', async () => {
  const calls: unknown[] = [];
  const prisma = {
    employee: {
      findFirst: async (args: unknown) => {
        calls.push(args);
        return { id: 'employee-1' };
      },
    },
  };
  const resolver = RESOURCE_SCOPE_RESOLVERS.employee;
  const where = resolver.buildWhere(input);

  assert.equal(await resolver.findAuthorizedId(prisma, where, 'employee-1'), 'employee-1');
  assert.deepEqual(calls, [{ where: { AND: [where, { id: 'employee-1' }] }, select: { id: true } }]);
});
