import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { EmployeeAssignmentService } from '../../app/application/master-data/employee-assignment-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { hasCode } from './test-helpers';

let prisma: PrismaClient;
let rootId: string;
let branchId: string;
let rootPositionId: string;
let branchPositionId: string;
let employeeId: string;
let service: EmployeeAssignmentService;

async function organization(code: string, parentId: string | null, status = 'ENABLED') {
  const id = randomUUID();
  const parent = parentId ? await prisma.organization.findUniqueOrThrow({ where: { id: parentId } }) : null;
  return prisma.organization.create({ data: {
    id, code, name: code, type: parent ? 'BRANCH' : 'FIRM', parentId,
    path: parent ? `${parent.path}/${id}` : `/${id}`, level: parent ? parent.level + 1 : 0, status,
  } });
}

async function position(organizationId: string, code: string, status = 'ENABLED') {
  return prisma.position.create({ data: { organizationId, code, name: code, categoryCode: 'LEGAL', status } });
}

async function employeeWithPrimary(employeeNo = 'EMP-001') {
  const employee = await prisma.employee.create({ data: {
    employeeNo, name: employeeNo, phone: '13800000000', type: 'LAWYER',
    entryDate: new Date('2026-01-01T00:00:00.000Z'),
  } });
  await prisma.employeeAssignment.create({ data: {
    employeeId: employee.id, organizationId: rootId, positionId: rootPositionId,
    assignmentType: 'PRIMARY', startedAt: employee.entryDate,
  } });
  return employee;
}

async function dropAuditTrigger() {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_assignment_audit_trigger ON "operation_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_assignment_audit()');
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await dropAuditTrigger();
  await clearTestApplicationData(prisma);
  rootId = (await organization('ROOT', null)).id;
  branchId = (await organization('BRANCH_A', rootId)).id;
  rootPositionId = (await position(rootId, 'ROOT_LAWYER')).id;
  branchPositionId = (await position(branchId, 'BRANCH_LAWYER')).id;
  employeeId = (await employeeWithPrimary()).id;
  service = new EmployeeAssignmentService(prisma, { actorUserId: 'assignment-actor' });
});
test.after(async () => { await dropAuditTrigger(); await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('transfers primary assignment atomically and permits only one concurrent winner', async () => {
  const transferred = await service.transferPrimary(employeeId, {
    organizationId: branchId, positionId: branchPositionId, employeeVersion: 1,
  });
  assert.equal(transferred.primaryAssignment?.organizationId, branchId);
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId, assignmentType: 'PRIMARY', endedAt: null } }), 1);
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId, assignmentType: 'PRIMARY', endedAt: { not: null } } }), 1);

  const results = await Promise.allSettled([
    service.transferPrimary(employeeId, { organizationId: rootId, positionId: rootPositionId, employeeVersion: 2 }),
    service.transferPrimary(employeeId, { organizationId: rootId, positionId: rootPositionId, employeeVersion: 2 }),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert.ok(rejected);
  assert.equal(hasCode('VERSION_CONFLICT')(rejected.reason), true);
});

test('rejects mismatched or disabled references and duplicate active tuples', async () => {
  await assert.rejects(
    () => service.add(employeeId, { organizationId: rootId, positionId: branchPositionId, assignmentType: 'SECONDARY' }),
    hasCode('ASSIGNMENT_ORGANIZATION_MISMATCH'),
  );
  await prisma.organization.update({ where: { id: branchId }, data: { status: 'DISABLED' } });
  await assert.rejects(
    () => service.add(employeeId, { organizationId: branchId, positionId: branchPositionId, assignmentType: 'SECONDARY' }),
    hasCode('MASTER_DATA_IN_USE'),
  );
  await prisma.organization.update({ where: { id: branchId }, data: { status: 'ENABLED' } });
  await service.add(employeeId, { organizationId: branchId, positionId: branchPositionId, assignmentType: 'SECONDARY' });
  await assert.rejects(
    () => service.add(employeeId, { organizationId: branchId, positionId: branchPositionId, assignmentType: 'ACTING' }),
    hasCode('PRIMARY_ASSIGNMENT_CONFLICT'),
  );
});

test('ends only active non-primary assignments with a valid version', async () => {
  const detail = await service.add(employeeId, {
    organizationId: branchId, positionId: branchPositionId, assignmentType: 'SECONDARY',
  });
  const secondary = detail.assignments.find(item => item.assignmentType === 'SECONDARY')!;
  const primary = detail.assignments.find(item => item.assignmentType === 'PRIMARY')!;
  await assert.rejects(() => service.end(employeeId, primary.id, { version: primary.version }), hasCode('PRIMARY_ASSIGNMENT_CONFLICT'));
  await assert.rejects(() => service.end(employeeId, secondary.id, { version: 2 }), hasCode('VERSION_CONFLICT'));
  const ended = await service.end(employeeId, secondary.id, { version: 1 });
  assert.ok(ended.assignments.find(item => item.id === secondary.id)?.endedAt);
});

test('rolls back a transfer when audit writing fails', async () => {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_assignment_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_assignment_audit_trigger BEFORE INSERT ON "operation_log" FOR EACH ROW EXECUTE FUNCTION fail_assignment_audit()`);
  await assert.rejects(() => service.transferPrimary(employeeId, {
    organizationId: branchId, positionId: branchPositionId, employeeVersion: 1,
  }));
  assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).version, 1);
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId, endedAt: null } }), 1);
});
