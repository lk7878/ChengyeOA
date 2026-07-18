import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { EmployeeService } from '../../app/application/master-data/employee-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { hasCode } from './test-helpers';

let prisma: PrismaClient;
let organizationId: string;
let positionId: string;
let service: EmployeeService;

async function baseInput(employeeNo: string) {
  return {
    employeeNo, name: '  Alice Lawyer  ', phone: ' 13800000000 ', email: ' ALICE@EXAMPLE.COM ',
    idCard: `ID-${employeeNo}`, licenseNo: `LICENSE-${employeeNo}`, employeeType: 'LAWYER',
    professionalDirections: [' Civil '], entryDate: '2026-01-01',
    primaryOrganizationId: organizationId, primaryPositionId: positionId,
  };
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  organizationId = randomUUID();
  await prisma.organization.create({ data: {
    id: organizationId, code: 'ROOT', name: 'Root', type: 'FIRM', path: `/${organizationId}`,
  } });
  positionId = (await prisma.position.create({ data: {
    organizationId, code: 'LAWYER', name: 'Lawyer', categoryCode: 'LEGAL',
  } })).id;
  service = new EmployeeService(prisma, { actorUserId: 'employee-actor' });
});
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('creates employee and primary assignment atomically with normalized identity', async () => {
  const created = await service.create(await baseInput(' emp-001 '));
  assert.equal(created.employeeNo, 'EMP-001');
  assert.equal(created.name, 'Alice Lawyer');
  assert.equal(created.email, 'alice@example.com');
  assert.equal(created.entryDate.toISOString().slice(0, 10), '2026-01-01');
  assert.deepEqual(created.professionalDirections, ['Civil']);
  assert.equal(created.formalDate, null);
  assert.deepEqual(created.activeProfessionalTeamIds, []);
  assert.equal(created.primaryAssignment?.organizationId, organizationId);
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: created.id } }), 1);
});

test('maps concurrent employee number and identity uniqueness to a safe conflict', async () => {
  const results = await Promise.allSettled([
    service.create(await baseInput('EMP-002')),
    service.create(await baseInput('EMP-002')),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert.ok(rejected);
  assert.equal(hasCode('EMPLOYEE_IDENTITY_CONFLICT')(rejected.reason), true);

  const duplicateIdentity = await baseInput('EMP-003');
  duplicateIdentity.idCard = 'ID-EMP-002';
  await assert.rejects(() => service.create(duplicateIdentity), hasCode('EMPLOYEE_IDENTITY_CONFLICT'));
});

test('updates with optimistic locking and formalizes only probation employees', async () => {
  const created = await service.create(await baseInput('EMP-004'));
  const updated = await service.update(created.id, { name: 'Updated Name', version: 1 });
  assert.equal(updated.version, 2);
  await assert.rejects(() => service.update(created.id, { name: 'Stale', version: 1 }), hasCode('VERSION_CONFLICT'));
  const formal = await service.formalize(created.id, { formalDate: '2026-02-01', version: 2 });
  assert.equal(formal.status, 'FORMAL');
  assert.equal(formal.formalDate?.toISOString().slice(0, 10), '2026-02-01');
  await assert.rejects(
    () => service.formalize(created.id, { formalDate: '2026-03-01', version: 3 }),
    hasCode('VALIDATION_FAILED'),
  );
});

test('requires handover, blocks active work and protects the initialized super-admin', async () => {
  const created = await service.create(await baseInput('EMP-005'));
  await assert.rejects(
    () => service.leave(created.id, { leaveDate: '2026-07-18', handoverConfirmed: false as true, version: 1 }),
    hasCode('VALIDATION_FAILED'),
  );
  await prisma.lead.create({ data: { name: 'Active lead', phone: '13800000001', assignedTo: created.id } });
  await assert.rejects(
    () => service.leave(created.id, { leaveDate: '2026-07-18', handoverConfirmed: true, version: 1 }),
    hasCode('MASTER_DATA_IN_USE'),
  );
  await prisma.lead.updateMany({ data: { status: 'LOST' } });

  const user = await prisma.user.create({ data: { username: 'protected.admin', password: 'unused', employeeId: created.id } });
  await prisma.systemInitialization.create({ data: {
    id: 'PRIMARY', rootOrganizationId: organizationId, superAdminUserId: user.id, completedAt: new Date(),
  } });
  await assert.rejects(
    () => service.leave(created.id, { leaveDate: '2026-07-18', handoverConfirmed: true, version: 1 }),
    hasCode('TRUST_ROOT_PROTECTED'),
  );
});

test('ends all relationships and disables an ordinary bound account on leave', async () => {
  const created = await service.create(await baseInput('EMP-006'));
  const user = await prisma.user.create({ data: { username: 'ordinary.user', password: 'unused', employeeId: created.id } });
  const leaved = await service.leave(created.id, { leaveDate: '2026-07-18', handoverConfirmed: true, version: 1 });
  assert.equal(leaved.status, 'LEAVED');
  assert.equal(await prisma.employeeAssignment.count({ where: { employeeId: created.id, endedAt: null } }), 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status, 'DISABLED');
});
