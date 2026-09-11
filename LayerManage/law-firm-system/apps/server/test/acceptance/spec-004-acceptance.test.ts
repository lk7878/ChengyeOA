import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { DataScopeService } from '../../app/application/authorization/data-scope-service';
import { PermissionTraceService } from '../../app/application/authorization/permission-trace-service';
import { SensitiveAccessService } from '../../app/application/authorization/sensitive-access-service';
import { EmployeeService } from '../../app/application/master-data/employee-service';
import { OrganizationService } from '../../app/application/master-data/organization-service';
import { assertTestDatabaseUrl, clearTestApplicationData } from '../helpers/test-database';

const prisma = new PrismaClient({
  datasources: { db: { url: assertTestDatabaseUrl().toString() } },
  log: [{ emit: 'event', level: 'query' }],
});
let queryCount = 0;
prisma.$on('query', () => { queryCount += 1; });

const fixtureTime = new Date('2026-07-19T08:00:00.000Z');
const branchUserId = 'acceptance-branch-user';
const subordinateUserId = 'acceptance-subordinate-user';
const rootUserId = 'acceptance-root-user';
const branchScopeId = 'acceptance-branch-scope';
const teamScopeId = 'acceptance-team-scope';
const allScopeId = 'acceptance-all-scope';
const subordinateScopeId = 'acceptance-subordinate-scope';

test.before(async () => {
  await clearTestApplicationData(prisma);
  await seedScaleFixture();
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('meets scaled authorization, hierarchy, pagination, recursion, and trace targets', async () => {
  const loader = new AuthorizationContextLoader(prisma);
  await loader.load(branchUserId);
  queryCount = 0;
  const contextDurations = await measureFive(() => loader.load(branchUserId));
  const contextQueries = queryCount / 5;
  assert.ok(median(contextDurations) <= 100, `Authorization context median ${median(contextDurations).toFixed(1)}ms`);
  assert.ok(contextQueries <= 8, `Authorization context averaged ${contextQueries} queries`);

  const rootContext = await loader.load(rootUserId);
  const organizations = new OrganizationService(prisma, { actorUserId: rootUserId }, rootContext);
  await organizations.tree();
  queryCount = 0;
  const organizationDurations = await measureFive(async () => {
    const tree = await organizations.tree();
    assert.equal(countNodes(tree), 500);
  });
  assert.ok(median(organizationDurations) <= 2400, `Organization tree median ${median(organizationDurations).toFixed(1)}ms`);
  assert.equal(queryCount, 5, 'Organization tree introduced row-level N+1 queries');

  const employees = new EmployeeService(prisma, { actorUserId: rootUserId }, rootContext);
  await employees.list({ page: 1, pageSize: 20 });
  queryCount = 0;
  const employeeDurations = await measureFive(async () => {
    const page = await employees.list({ page: 1, pageSize: 20 });
    assert.equal(page.list.length, 20);
    assert.equal(page.pagination.total, 10_000);
  });
  assert.ok(median(employeeDurations) <= 2400, `Employee page median ${median(employeeDurations).toFixed(1)}ms`);
  assert.equal(queryCount, 25, 'Employee pagination introduced row-level N+1 queries');

  const subordinateContext = await loader.load(subordinateUserId);
  const dataScopes = new DataScopeService(prisma);
  const subordinateDurations = await measureFive(async () => {
    const where = await dataScopes.buildScopeWhere(subordinateContext, 'employee', 'employee.read');
    assert.equal(await prisma.employee.count({ where }), 1000);
  });
  assert.ok(median(subordinateDurations) <= 2000, `Subordinate scope median ${median(subordinateDurations).toFixed(1)}ms`);

  const traceService = new PermissionTraceService(prisma);
  await traceService.trace(rootContext, branchUserId, 'employee.read');
  const traceDurations = await measureFive(() => traceService.trace(rootContext, branchUserId, 'employee.read'));
  assert.ok(median(traceDurations) <= 2000, `Permission trace median ${median(traceDurations).toFixed(1)}ms`);
  console.log(JSON.stringify({
    authorizationContextMedianMs: median(contextDurations),
    organizationTreeMedianMs: median(organizationDurations),
    employeePageMedianMs: median(employeeDurations),
    subordinateScopeMedianMs: median(subordinateDurations),
    permissionTraceMedianMs: median(traceDurations),
  }));
});

test('enforces branch and team union, detail parity, field projection, L4 purpose, and audit hygiene', async () => {
  const loader = new AuthorizationContextLoader(prisma);
  let context = await loader.load(branchUserId);
  const service = new EmployeeService(prisma, { actorUserId: branchUserId }, context);
  const page = await service.list({ page: 1, pageSize: 100 });
  const visibleIds = new Set(page.list.map(item => item.id));
  assert.ok(visibleIds.has('employee-00000'), 'Branch employee should be visible');
  assert.ok(visibleIds.has('employee-00001'), 'Cross-office team member should be visible through union access');
  assert.equal(visibleIds.has('employee-00002'), false, 'Unrelated branch employee should remain hidden');
  await assert.rejects(() => service.detail('employee-00002'), (error: unknown) => (
    error instanceof Error && 'code' in error && error.code === 'RESOURCE_NOT_FOUND_OR_FORBIDDEN'
  ));

  const masked = await service.detail('employee-00000');
  assert.equal(masked.phone, '138****0000');
  assert.equal('idCard' in masked, false, 'Normal employee detail must never expose L4 data');

  await prisma.fieldPermission.create({ data: {
    roleId: 'acceptance-role-00', resource: 'employee', fieldCode: 'employee.phone',
    readLevel: 'READ', canWrite: false, canExport: false,
  } });
  context = await loader.load(branchUserId);
  const rawService = new EmployeeService(prisma, { actorUserId: branchUserId }, context);
  const raw = await rawService.detail('employee-00000');
  assert.equal(raw.phone, '13800000000');
  const l3Audit = await prisma.operationLog.findFirst({ where: { userId: branchUserId, action: 'READ_L3_FIELDS' }, orderBy: { createdAt: 'desc' } });
  assert.ok(l3Audit);
  assert.doesNotMatch(JSON.stringify(l3Audit), /13800000000|500000199001010000/);

  const l4 = await new SensitiveAccessService(prisma).viewEmployeeFields({
    context,
    employeeId: 'employee-00000',
    fieldCodes: ['employee.idCard'],
    purpose: 'Verify identity for court filing',
  });
  assert.equal(l4['employee.idCard'], '500000199001010000');
  const l4Audit = await prisma.operationLog.findFirst({ where: { userId: branchUserId, action: 'VIEW_HIGH_SENSITIVE_FIELDS' }, orderBy: { createdAt: 'desc' } });
  assert.ok(l4Audit);
  assert.doesNotMatch(JSON.stringify(l4Audit), /500000199001010000/);
});

test('expires and revokes grants immediately while preserving history and trace provenance', async () => {
  const loader = new AuthorizationContextLoader(prisma);
  const roleId = 'acceptance-role-03';
  const tempUser = await prisma.user.create({ data: { id: 'acceptance-temp-user', username: 'acceptance.temp', password: 'not-used' } });
  const tempGrant = await prisma.userRole.create({ data: {
    id: 'acceptance-temp-grant', userId: tempUser.id, roleId, source: 'TEMPORARY',
    validFrom: new Date('2026-07-19T07:00:00.000Z'), validUntil: new Date('2026-07-20T07:00:00.000Z'),
    reason: 'Temporary acceptance authorization', grantedByUserId: rootUserId,
  } });
  assert.ok((await loader.load(tempUser.id, fixtureTime)).permissionCodes.includes('employee.read'));
  assert.equal((await loader.load(tempUser.id, new Date('2026-07-21T08:00:00.000Z'))).permissionCodes.includes('employee.read'), false);

  await prisma.userRole.update({ where: { id: tempGrant.id }, data: {
    revokedAt: new Date('2026-07-19T09:00:00.000Z'), revokedByUserId: rootUserId,
    revokeReason: 'Acceptance access no longer required', version: { increment: 1 },
  } });
  assert.equal((await loader.load(tempUser.id, new Date('2026-07-19T10:00:00.000Z'))).permissionCodes.includes('employee.read'), false);
  assert.equal(await prisma.userRole.count({ where: { id: tempGrant.id } }), 1, 'Revocation must preserve grant history');

  const rootContext = await loader.load(rootUserId);
  const trace = await new PermissionTraceService(prisma).trace(rootContext, branchUserId, 'employee.read');
  assert.equal(trace.allowed, true);
  assert.deepEqual(new Set(trace.sources.map(source => source.scopeTypes[0])), new Set(['BRANCH', 'TEAM']));
  assert.equal(trace.sources.every(source => source.sourceType === 'ROLE'), true);
  assert.doesNotMatch(JSON.stringify(trace), /13800000000|500000199001010000|password|token/i);
});

async function seedScaleFixture() {
  const organizations: Prisma.OrganizationCreateManyInput[] = [
    { id: 'root', code: 'ROOT', name: 'Root Firm', type: 'FIRM', path: '/root', level: 0 },
  ];
  for (let index = 1; index < 500; index += 1) {
    const id = `branch-${String(index).padStart(3, '0')}`;
    organizations.push({ id, code: `BRANCH_${String(index).padStart(3, '0')}`, name: `Branch ${index}`, type: 'BRANCH', parentId: 'root', path: `/root/${id}`, level: 1 });
  }
  await prisma.organization.createMany({ data: organizations });

  const positions = organizations.slice(1).map((organization, index) => ({
    id: `position-${String(index + 1).padStart(3, '0')}`, organizationId: organization.id!,
    code: `LAWYER_${String(index + 1).padStart(3, '0')}`, name: 'Lawyer', categoryCode: 'LEGAL',
  }));
  await prisma.position.createMany({ data: positions });

  const employees = Array.from({ length: 10_000 }, (_, index) => ({
    id: `employee-${String(index).padStart(5, '0')}`,
    employeeNo: `EMP-${String(index).padStart(5, '0')}`,
    name: `Employee ${index}`,
    phone: `138${String(index).padStart(8, '0')}`,
    idCard: index === 0 ? '500000199001010000' : null,
    type: 'LAWYER', status: 'FORMAL', entryDate: fixtureTime,
  }));
  for (const values of chunks(employees, 2000)) await prisma.employee.createMany({ data: values });
  const assignments = employees.map((employee, index) => {
    const branchIndex = index % 499 + 1;
    return {
      id: `assignment-${String(index).padStart(5, '0')}`, employeeId: employee.id,
      organizationId: `branch-${String(branchIndex).padStart(3, '0')}`,
      positionId: `position-${String(branchIndex).padStart(3, '0')}`,
      assignmentType: 'PRIMARY', startedAt: fixtureTime,
    };
  });
  for (const values of chunks(assignments, 2000)) await prisma.employeeAssignment.createMany({ data: values });

  const reportingLines = [
    { id: 'reporting-0000', employeeId: 'employee-00000', managerEmployeeId: 'employee-09999', startedAt: fixtureTime },
    ...Array.from({ length: 998 }, (_, index) => ({
      id: `reporting-${String(index + 1).padStart(4, '0')}`,
      employeeId: `employee-${String(index + 1).padStart(5, '0')}`,
      managerEmployeeId: `employee-${String(index).padStart(5, '0')}`,
      startedAt: fixtureTime,
    })),
  ];
  // The deferred row trigger is already covered by migration and service tests. Disabling it
  // while loading a known acyclic performance fixture avoids 999 repeated full-tree walks.
  await prisma.$executeRawUnsafe('ALTER TABLE "employee_reporting_line" DISABLE TRIGGER "employee_reporting_line_acyclic"');
  try {
    await prisma.employeeReportingLine.createMany({ data: reportingLines });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "employee_reporting_line" ENABLE TRIGGER "employee_reporting_line_acyclic"');
  }

  const team = await prisma.professionalTeam.create({ data: { id: 'acceptance-team', code: 'CROSS_OFFICE', name: 'Cross-office Team', categoryCode: 'OTHER', homeOrganizationId: 'root' } });
  await prisma.professionalTeamMember.createMany({ data: [
    { professionalTeamId: team.id, employeeId: 'employee-00000', memberRole: 'LEAD', startedAt: fixtureTime },
    { professionalTeamId: team.id, employeeId: 'employee-00001', memberRole: 'LAWYER', startedAt: fixtureTime },
  ] });

  const roles = Array.from({ length: 20 }, (_, index) => ({
    id: `acceptance-role-${String(index).padStart(2, '0')}`,
    code: `ACCEPTANCE_ROLE_${String(index).padStart(2, '0')}`,
    name: `Acceptance Role ${index}`, type: 'BUSINESS',
  }));
  await prisma.role.createMany({ data: [
    { id: 'acceptance-root-role', code: 'SYSTEM_SUPER_ADMIN', name: 'System Super Admin', type: 'SYSTEM' },
    ...roles,
  ] });
  const permissionIds = (await prisma.permission.findMany({ orderBy: { code: 'asc' }, take: 50, select: { id: true } })).map(item => item.id);
  await prisma.rolePermission.createMany({ data: roles.flatMap(role => permissionIds.map(permissionId => ({ roleId: role.id, permissionId }))) });
  assert.equal(await prisma.rolePermission.count({ where: { roleId: { startsWith: 'acceptance-role-' } } }), 1000);

  await prisma.dataScope.createMany({ data: [
    { id: branchScopeId, name: 'Branch 001', scopeType: 'BRANCH', organizationId: 'branch-001', includeDescendants: true },
    { id: teamScopeId, name: 'Cross-office team', scopeType: 'TEAM', professionalTeamId: team.id },
    { id: allScopeId, name: 'All employees', scopeType: 'ALL' },
    { id: subordinateScopeId, name: 'Self and subordinates', scopeType: 'SELF_AND_SUBORDINATES' },
  ] });
  await prisma.roleDataScope.createMany({ data: [
    { roleId: 'acceptance-role-00', resource: 'employee', dataScopeId: branchScopeId },
    { roleId: 'acceptance-role-01', resource: 'employee', dataScopeId: teamScopeId },
    { roleId: 'acceptance-role-02', resource: 'employee', dataScopeId: subordinateScopeId },
    { roleId: 'acceptance-role-03', resource: 'employee', dataScopeId: allScopeId },
  ] });

  await prisma.user.createMany({ data: [
    { id: rootUserId, username: 'acceptance.root', password: 'not-used' },
    { id: branchUserId, username: 'acceptance.branch', password: 'not-used', employeeId: 'employee-00000' },
    { id: subordinateUserId, username: 'acceptance.subordinate', password: 'not-used', employeeId: 'employee-09999' },
  ] });
  await prisma.userRole.createMany({ data: [
    { userId: rootUserId, roleId: 'acceptance-root-role', source: 'PERMANENT', validFrom: new Date(fixtureTime.getTime() - 60_000) },
    { userId: branchUserId, roleId: 'acceptance-role-00', source: 'PERMANENT', validFrom: new Date(fixtureTime.getTime() - 60_000), grantedByUserId: rootUserId },
    { userId: branchUserId, roleId: 'acceptance-role-01', source: 'PERMANENT', validFrom: new Date(fixtureTime.getTime() - 60_000), grantedByUserId: rootUserId },
    { userId: subordinateUserId, roleId: 'acceptance-role-02', source: 'PERMANENT', validFrom: new Date(fixtureTime.getTime() - 60_000), grantedByUserId: rootUserId },
  ] });
}

async function measureFive(run: () => Promise<unknown>): Promise<number[]> {
  const durations: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const startedAt = performance.now();
    await run();
    durations.push(performance.now() - startedAt);
  }
  return durations;
}

function median(values: number[]): number {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function countNodes(nodes: Array<{ children: unknown[] }>): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children as Array<{ children: unknown[] }>), 0);
}
