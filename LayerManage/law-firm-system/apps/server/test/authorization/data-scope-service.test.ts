import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { DataScopeService } from '../../app/application/authorization/data-scope-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import {
  assertTestDatabaseUrl,
  clearTestApplicationData,
  createTestPrisma,
} from '../helpers/test-database';

const evaluatedAt = new Date('2026-07-18T12:00:00.000Z');
let prisma: PrismaClient;

test.before(() => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

function context(employeeId: string, scopeIds: string[]): AuthorizationContext {
  return {
    userId: `user-${employeeId}`,
    employeeId,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: [{
      sourceType: 'ROLE',
      sourceId: 'role-grant',
      permissionCode: 'employee.read',
      resource: 'employee',
      scopeIds,
      validUntil: null,
    }],
    fieldRules: [],
    permissionCodes: ['employee.read'],
    evaluatedAt,
  };
}

async function fixture() {
  const root = await createOrganization('ROOT', 'FIRM');
  const hq = await createOrganization('HQ', 'HQ_CENTER', root);
  const hqDepartment = await createOrganization('HQ_DEPT', 'DEPARTMENT', hq);
  const branchA = await createOrganization('BRANCH_A', 'BRANCH', root);
  const branchADepartment = await createOrganization('BRANCH_A_DEPT', 'DEPARTMENT', branchA);
  const branchB = await createOrganization('BRANCH_B', 'BRANCH', root);

  const manager = await createEmployee('MANAGER', branchA.id);
  const branchAChild = await createEmployee('BRANCH_A_CHILD', branchADepartment.id);
  const hqEmployee = await createEmployee('HQ_EMPLOYEE', hq.id);
  const hqDepartmentEmployee = await createEmployee('HQ_DEPT_EMPLOYEE', hqDepartment.id);
  const branchBSubordinate = await createEmployee('BRANCH_B_SUBORDINATE', branchB.id);
  const hqNestedSubordinate = await createEmployee('HQ_NESTED_SUBORDINATE', hq.id);

  const team = await prisma.professionalTeam.create({
    data: {
      code: `TEAM_${randomUUID()}`,
      name: 'Cross-office team',
      categoryCode: 'OTHER',
      homeOrganizationId: branchA.id,
      members: {
        create: [
          { employeeId: hqEmployee.id, memberRole: 'EXPERT', startedAt: new Date('2026-01-01') },
          { employeeId: branchBSubordinate.id, memberRole: 'EXPERT', startedAt: new Date('2026-01-01') },
          {
            employeeId: branchAChild.id,
            memberRole: 'EXPERT',
            startedAt: new Date('2025-01-01'),
            endedAt: new Date('2026-01-01'),
          },
        ],
      },
    },
  });
  await prisma.employeeReportingLine.createMany({
    data: [
      {
        employeeId: branchBSubordinate.id,
        managerEmployeeId: manager.id,
        startedAt: new Date('2026-01-01'),
      },
      {
        employeeId: hqNestedSubordinate.id,
        managerEmployeeId: branchBSubordinate.id,
        startedAt: new Date('2026-01-01'),
      },
    ],
  });

  const scopes = {
    all: await createScope({ scopeType: 'ALL' }),
    hq: await createScope({ scopeType: 'HQ_SCOPE' }),
    orgExact: await createScope({ scopeType: 'ORG', organizationId: branchA.id }),
    orgTree: await createScope({ scopeType: 'ORG', organizationId: branchA.id, includeDescendants: true }),
    branch: await createScope({ scopeType: 'BRANCH', organizationId: branchA.id, includeDescendants: true }),
    team: await createScope({ scopeType: 'TEAM', professionalTeamId: team.id }),
    self: await createScope({ scopeType: 'SELF' }),
    selfAndSubordinates: await createScope({ scopeType: 'SELF_AND_SUBORDINATES' }),
    custom: await createScope({
      scopeType: 'CUSTOM',
      targets: {
        create: [
          { organizationId: hqDepartment.id },
          { professionalTeamId: team.id },
          { employeeId: manager.id },
        ],
      },
    }),
  };

  return {
    manager,
    branchAChild,
    hqEmployee,
    hqDepartmentEmployee,
    branchBSubordinate,
    hqNestedSubordinate,
    scopes,
  };
}

test('resolves all eight scope types to exact employee record sets', async () => {
  const data = await fixture();
  const service = new DataScopeService(prisma);
  const allEmployeeIds = [
    data.manager,
    data.branchAChild,
    data.hqEmployee,
    data.hqDepartmentEmployee,
    data.branchBSubordinate,
    data.hqNestedSubordinate,
  ]
    .map(employee => employee.id)
    .sort();

  const cases: Array<[string, string, string[]]> = [
    ['ALL', data.scopes.all.id, allEmployeeIds],
    ['HQ_SCOPE', data.scopes.hq.id, [data.hqEmployee.id, data.hqDepartmentEmployee.id, data.hqNestedSubordinate.id]],
    ['ORG exact', data.scopes.orgExact.id, [data.manager.id]],
    ['ORG descendants', data.scopes.orgTree.id, [data.manager.id, data.branchAChild.id]],
    ['BRANCH', data.scopes.branch.id, [data.manager.id, data.branchAChild.id]],
    ['TEAM', data.scopes.team.id, [data.hqEmployee.id, data.branchBSubordinate.id]],
    ['SELF', data.scopes.self.id, [data.manager.id]],
    ['SELF_AND_SUBORDINATES', data.scopes.selfAndSubordinates.id, [
      data.manager.id,
      data.branchBSubordinate.id,
      data.hqNestedSubordinate.id,
    ]],
    ['CUSTOM', data.scopes.custom.id, [
      data.manager.id,
      data.hqEmployee.id,
      data.hqDepartmentEmployee.id,
      data.branchBSubordinate.id,
    ]],
  ];

  for (const [label, scopeId, expected] of cases) {
    const where = await service.buildScopeWhere(context(data.manager.id, [scopeId]), 'employee', 'employee.read');
    const actual = await prisma.employee.findMany({ where, select: { id: true }, orderBy: { id: 'asc' } });
    assert.deepEqual(actual.map(item => item.id).sort(), [...expected].sort(), label);
  }
});

test('uses one union for list and detail and denies a permission without a scope', async () => {
  const data = await fixture();
  const service = new DataScopeService(prisma);
  const unionContext = context(data.manager.id, [data.scopes.branch.id, data.scopes.team.id]);
  const where = await service.buildScopeWhere(unionContext, 'employee', 'employee.read');
  const visible = await prisma.employee.findMany({ where, select: { id: true } });

  assert.deepEqual(visible.map(item => item.id).sort(), [
    data.manager.id,
    data.branchAChild.id,
    data.hqEmployee.id,
    data.branchBSubordinate.id,
  ].sort());
  await assert.doesNotReject(() => service.requireRecord(unionContext, 'employee', 'employee.read', data.hqEmployee.id));
  await assert.rejects(
    () => service.requireRecord(unionContext, 'employee', 'employee.read', data.hqDepartmentEmployee.id),
    error => Boolean(error && typeof error === 'object' && 'code' in error
      && error.code === 'RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );

  const emptyContext = context(data.manager.id, []);
  const emptyWhere = await service.buildScopeWhere(emptyContext, 'employee', 'employee.read');
  assert.equal(await prisma.employee.count({ where: emptyWhere }), 0);
});

test('builds two grants and lists their records with a fixed query count', async () => {
  const data = await fixture();
  const measured = new PrismaClient({
    datasources: { db: { url: assertTestDatabaseUrl().toString() } },
    log: [{ emit: 'event', level: 'query' }],
  });
  let queryCount = 0;
  measured.$on('query', () => {
    queryCount += 1;
  });
  try {
    const service = new DataScopeService(measured);
    const where = await service.buildScopeWhere(
      context(data.manager.id, [data.scopes.branch.id, data.scopes.team.id]),
      'employee',
      'employee.read',
    );
    const scopeQueryCount = queryCount;
    await measured.employee.findMany({ where, select: { id: true } });
    assert.ok(scopeQueryCount <= 4, `scope resolution used ${scopeQueryCount} queries`);
    assert.equal(queryCount, scopeQueryCount + 1);
  } finally {
    await measured.$disconnect();
  }
});

async function createOrganization(code: string, type: string, parent?: { id: string; path: string }) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      code: `${code}_${id}`,
      name: code,
      type,
      parentId: parent?.id,
      path: parent ? `${parent.path}/${id}` : `/${id}`,
      level: parent ? parent.path.split('/').length - 1 : 0,
    },
  });
}

async function createEmployee(code: string, organizationId: string) {
  const id = randomUUID();
  const position = await prisma.position.create({
    data: {
      organizationId,
      code: `POSITION_${id}`,
      name: `${code} position`,
      categoryCode: 'STAFF',
    },
  });
  return prisma.employee.create({
    data: {
      id,
      employeeNo: `EMP_${id}`,
      name: code,
      phone: `1${id.replaceAll('-', '').slice(0, 10)}`,
      type: 'ADMIN',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
      assignments: {
        create: {
          organizationId,
          positionId: position.id,
          assignmentType: 'PRIMARY',
          startedAt: new Date('2025-01-01'),
        },
      },
    },
  });
}

async function createScope(data: Omit<Prisma.DataScopeUncheckedCreateInput, 'name'>) {
  return prisma.dataScope.create({ data: { name: `scope-${randomUUID()}`, ...data } });
}
