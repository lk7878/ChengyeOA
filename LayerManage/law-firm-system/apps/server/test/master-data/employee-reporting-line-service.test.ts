import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { EmployeeReportingLineService } from '../../app/application/master-data/employee-reporting-line-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { authorizationContext, hasCode } from './test-helpers';

const startedAt = new Date('2026-07-01T00:00:00.000Z');
let prisma: PrismaClient;
let service: EmployeeReportingLineService;

test.before(() => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await dropAuditTrigger();
  await clearTestApplicationData(prisma);
  service = new EmployeeReportingLineService(
    prisma,
    { actorUserId: 'reporting-actor' },
    authorizationContext({
      userId: 'reporting-actor',
      permissionCodes: ['employee.reporting_line.read', 'employee.reporting_line.manage'],
      resource: 'employee_reporting_line',
      superAdmin: true,
    }),
  );
});

test.after(async () => {
  await dropAuditTrigger();
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('creates replaces ends and lists reporting-line history with optimistic versions', async () => {
  const subordinate = await createEmployee('SUBORDINATE');
  const firstManager = await createEmployee('FIRST_MANAGER');
  const secondManager = await createEmployee('SECOND_MANAGER');

  const first = await service.createOrReplace(subordinate.id, { managerEmployeeId: firstManager.id, startedAt });
  assert.equal(first.managerEmployeeId, firstManager.id);
  const replacement = await service.createOrReplace(subordinate.id, {
    managerEmployeeId: secondManager.id,
    startedAt: new Date('2026-07-10T00:00:00.000Z'),
    currentLineVersion: first.version,
  });
  assert.equal(replacement.managerEmployeeId, secondManager.id);
  const history = await service.list(subordinate.id);
  assert.equal(history.length, 2);
  assert.equal(history.filter(item => item.endedAt === null).length, 1);
  assert.equal(history.find(item => item.id === first.id)?.endedAt?.toISOString(), '2026-07-10T00:00:00.000Z');

  await assert.rejects(
    () => service.end(subordinate.id, replacement.id, { endedAt: new Date('2026-07-15'), version: 2 }),
    hasCode('VERSION_CONFLICT'),
  );
  const ended = await service.end(subordinate.id, replacement.id, {
    endedAt: new Date('2026-07-15T00:00:00.000Z'),
    version: replacement.version,
  });
  assert.equal(ended.endedAt?.toISOString(), '2026-07-15T00:00:00.000Z');
  await assert.rejects(
    () => service.end(subordinate.id, replacement.id, { endedAt: new Date('2026-07-16'), version: ended.version }),
    hasCode('VERSION_CONFLICT'),
  );
});

test('rejects missing or left references self-management and direct or indirect cycles', async () => {
  const employeeA = await createEmployee('A');
  const employeeB = await createEmployee('B');
  const employeeC = await createEmployee('C');
  const leftManager = await createEmployee('LEFT', 'LEAVED');

  await assert.rejects(
    () => service.createOrReplace(employeeA.id, { managerEmployeeId: randomUUID(), startedAt }),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
  await assert.rejects(
    () => service.createOrReplace(employeeA.id, { managerEmployeeId: leftManager.id, startedAt }),
    hasCode('MASTER_DATA_IN_USE'),
  );
  await assert.rejects(
    () => service.createOrReplace(employeeA.id, { managerEmployeeId: employeeA.id, startedAt }),
    hasCode('REPORTING_LINE_CYCLE'),
  );
  await service.createOrReplace(employeeA.id, { managerEmployeeId: employeeB.id, startedAt });
  await service.createOrReplace(employeeB.id, { managerEmployeeId: employeeC.id, startedAt });
  await assert.rejects(
    () => service.createOrReplace(employeeC.id, { managerEmployeeId: employeeA.id, startedAt }),
    hasCode('REPORTING_LINE_CYCLE'),
  );
});

test('serializes concurrent managers and resolves all recursive descendants in one operation', async () => {
  const subordinate = await createEmployee('CONCURRENT_SUBORDINATE');
  const firstManager = await createEmployee('CONCURRENT_MANAGER_A');
  const secondManager = await createEmployee('CONCURRENT_MANAGER_B');
  const results = await Promise.allSettled([
    service.createOrReplace(subordinate.id, { managerEmployeeId: firstManager.id, startedAt }),
    service.createOrReplace(subordinate.id, { managerEmployeeId: secondManager.id, startedAt }),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert.ok(rejected);
  assert.equal(hasCode('VERSION_CONFLICT')(rejected.reason), true);

  const current = await prisma.employeeReportingLine.findFirstOrThrow({ where: { employeeId: subordinate.id, endedAt: null } });
  const nested = await createEmployee('NESTED_SUBORDINATE');
  await service.createOrReplace(nested.id, { managerEmployeeId: subordinate.id, startedAt });
  assert.deepEqual(
    (await service.descendantEmployeeIds(current.managerEmployeeId, new Date('2026-07-18'))).sort(),
    [subordinate.id, nested.id].sort(),
  );
});

test('enforces the same employee scope for reporting-line list and mutations', async () => {
  const rootId = randomUUID();
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  await prisma.organization.createMany({ data: [
    { id: rootId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${rootId}`, level: 0 },
    { id: branchAId, code: 'BRANCH_A', name: 'Branch A', type: 'BRANCH', parentId: rootId, path: `/${rootId}/${branchAId}`, level: 1 },
    { id: branchBId, code: 'BRANCH_B', name: 'Branch B', type: 'BRANCH', parentId: rootId, path: `/${rootId}/${branchBId}`, level: 1 },
  ] });
  const positionA = await prisma.position.create({ data: {
    organizationId: branchAId, code: 'A_MANAGER', name: 'A manager', categoryCode: 'ADMIN',
  } });
  const positionB = await prisma.position.create({ data: {
    organizationId: branchBId, code: 'B_MANAGER', name: 'B manager', categoryCode: 'ADMIN',
  } });
  const subordinateA = await createEmployee('SCOPE_SUBORDINATE_A');
  const managerA = await createEmployee('SCOPE_MANAGER_A');
  const employeeB = await createEmployee('SCOPE_EMPLOYEE_B');
  await prisma.employeeAssignment.createMany({ data: [
    { employeeId: subordinateA.id, organizationId: branchAId, positionId: positionA.id, assignmentType: 'PRIMARY', startedAt },
    { employeeId: managerA.id, organizationId: branchAId, positionId: positionA.id, assignmentType: 'PRIMARY', startedAt },
    { employeeId: employeeB.id, organizationId: branchBId, positionId: positionB.id, assignmentType: 'PRIMARY', startedAt },
  ] });
  const scope = await prisma.dataScope.create({ data: {
    name: 'Branch A reporting', scopeType: 'BRANCH', organizationId: branchAId, includeDescendants: true,
  } });
  const scoped = new EmployeeReportingLineService(
    prisma,
    { actorUserId: 'reporting-actor' },
    authorizationContext({
      userId: 'reporting-actor',
      permissionCodes: ['employee.reporting_line.read', 'employee.reporting_line.manage'],
      resource: 'employee_reporting_line',
      scopeIds: [scope.id],
    }),
  );

  const line = await scoped.createOrReplace(subordinateA.id, { managerEmployeeId: managerA.id, startedAt });
  assert.deepEqual((await scoped.list(subordinateA.id)).map(item => item.id), [line.id]);
  await assert.rejects(() => scoped.list(employeeB.id), hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
  await assert.rejects(
    () => scoped.createOrReplace(subordinateA.id, { managerEmployeeId: employeeB.id, startedAt }),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
});

test('rolls back a reporting-line write when its audit insert fails', async () => {
  const subordinate = await createEmployee('AUDIT_SUBORDINATE');
  const manager = await createEmployee('AUDIT_MANAGER');
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_reporting_line_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW."targetType" = 'EMPLOYEE_REPORTING_LINE' THEN RAISE EXCEPTION 'injected'; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_reporting_line_audit_trigger BEFORE INSERT ON "operation_log"
    FOR EACH ROW EXECUTE FUNCTION fail_reporting_line_audit()
  `);

  await assert.rejects(
    () => service.createOrReplace(subordinate.id, { managerEmployeeId: manager.id, startedAt }),
  );
  assert.equal(await prisma.employeeReportingLine.count({ where: { employeeId: subordinate.id } }), 0);
});

async function createEmployee(code: string, status = 'FORMAL') {
  const id = randomUUID();
  return prisma.employee.create({
    data: {
      id,
      employeeNo: `${code}_${id}`,
      name: code,
      phone: `1${id.replaceAll('-', '').slice(0, 10)}`,
      type: 'ADMIN',
      status,
      entryDate: new Date('2025-01-01'),
    },
  });
}

async function dropAuditTrigger() {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_reporting_line_audit_trigger ON "operation_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_reporting_line_audit()');
}
