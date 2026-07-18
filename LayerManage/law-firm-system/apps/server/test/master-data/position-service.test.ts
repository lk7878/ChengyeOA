import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PositionService } from '../../app/application/master-data/position-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { hasCode } from './test-helpers';

let prisma: PrismaClient;
let rootId: string;
let branchId: string;
let disabledOrganizationId: string;
let service: PositionService;

async function createOrganization(input: { code: string; status?: string; sort?: number }) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      code: input.code,
      name: `${input.code} name`,
      type: input.code === 'ROOT' ? 'FIRM' : 'BRANCH',
      parentId: input.code === 'ROOT' ? null : rootId,
      path: input.code === 'ROOT' ? `/${id}` : `/${rootId}/${id}`,
      level: input.code === 'ROOT' ? 0 : 1,
      status: input.status ?? 'ENABLED',
      sort: input.sort ?? 0,
    },
  });
}

async function createPosition(organizationId = branchId, code = 'LAWYER', level = 1) {
  return service.create({
    organizationId,
    code,
    name: `${code} position`,
    categoryCode: 'LEGAL',
    level,
  });
}

async function dropAuditFailureTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_position_audit_trigger ON "operation_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_position_audit()');
}

test.before(async () => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await dropAuditFailureTrigger();
  await clearTestApplicationData(prisma);
  rootId = (await createOrganization({ code: 'ROOT' })).id;
  branchId = (await createOrganization({ code: 'BRANCH_A' })).id;
  disabledOrganizationId = (await createOrganization({ code: 'BRANCH_DISABLED', status: 'DISABLED' })).id;
  service = new PositionService(prisma, { actorUserId: 'position-test-actor', ip: '127.0.0.1' });
});

test.after(async () => {
  await dropAuditFailureTrigger();
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('scopes stable position codes to one organization and maps the write race', async () => {
  const otherBranch = await createOrganization({ code: 'BRANCH_B' });
  await Promise.all([createPosition(branchId, 'LAWYER'), createPosition(otherBranch.id, 'LAWYER')]);

  const results = await Promise.allSettled([
    createPosition(branchId, 'ASSISTANT'),
    createPosition(branchId, 'ASSISTANT'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.ok(rejected);
  assert.equal(hasCode('MASTER_DATA_CODE_CONFLICT')(rejected.reason), true);
});

test('rejects creation and enable when the owning organization is disabled', async () => {
  await assert.rejects(
    () => createPosition(disabledOrganizationId),
    hasCode('MASTER_DATA_IN_USE'),
  );
  const position = await prisma.position.create({
    data: {
      organizationId: disabledOrganizationId,
      code: 'DISABLED_POSITION',
      name: 'Disabled position',
      categoryCode: 'LEGAL',
      status: 'DISABLED',
    },
  });
  await assert.rejects(() => service.enable(position.id, 1), hasCode('MASTER_DATA_IN_USE'));
});

test('keeps organization and code immutable while updating normalized mutable fields', async () => {
  const position = await createPosition();
  await assert.rejects(
    () => service.update(position.id, { organizationId: rootId, name: 'Moved', version: 1 } as never),
    hasCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => service.update(position.id, { code: 'CHANGED', name: 'Changed', version: 1 } as never),
    hasCode('VALIDATION_FAILED'),
  );

  const updated = await service.update(position.id, {
    name: '  Senior Lawyer  ',
    categoryCode: ' senior_legal ',
    level: 3,
    responsibilities: '  Lead matters  ',
    version: 1,
  });
  assert.equal(updated.organizationId, branchId);
  assert.equal(updated.code, 'LAWYER');
  assert.equal(updated.name, 'Senior Lawyer');
  assert.equal(updated.categoryCode, 'SENIOR_LEGAL');
  assert.equal(updated.responsibilities, 'Lead matters');
  assert.equal(updated.version, 2);
});

test('rejects stale versions and blocks disable while an assignment is active', async () => {
  const position = await createPosition();
  const employee = await prisma.employee.create({
    data: {
      employeeNo: 'EMP-001',
      name: 'Employee One',
      phone: '13800000000',
      type: 'LAWYER',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
      orgId: branchId,
      positionId: position.id,
    },
  });
  await prisma.employeeAssignment.create({
    data: {
      employeeId: employee.id,
      organizationId: branchId,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: employee.entryDate,
    },
  });

  await assert.rejects(() => service.disable(position.id, 1), hasCode('MASTER_DATA_IN_USE'));
  await assert.rejects(
    () => service.update(position.id, { name: 'Stale', version: 2 }),
    hasCode('VERSION_CONFLICT'),
  );
});

test('lists positions deterministically with filters and active assignment counts', async () => {
  const lowB = await createPosition(branchId, 'B_CODE', 1);
  const high = await createPosition(branchId, 'HIGH', 3);
  const lowA = await createPosition(branchId, 'A_CODE', 1);
  await service.disable(lowB.id, lowB.version);

  const enabled = await service.list({ organizationId: branchId, status: 'ENABLED' });
  assert.deepEqual(enabled.map(item => item.id), [high.id, lowA.id]);
  assert.equal((await service.detail(high.id)).activeAssignmentCount, 0);
  assert.deepEqual((await service.list({ keyword: 'high' })).map(item => item.id), [high.id]);
});

test('rolls back position creation when audit writing fails', async () => {
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_position_audit() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected position audit failure';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_position_audit_trigger
    BEFORE INSERT ON "operation_log"
    FOR EACH ROW EXECUTE FUNCTION fail_position_audit()
  `);

  await assert.rejects(() => createPosition(branchId, 'ROLLBACK_POSITION'));
  assert.equal(await prisma.position.count({ where: { code: 'ROLLBACK_POSITION' } }), 0);
});
