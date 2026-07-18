import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { OrganizationService } from '../../app/application/master-data/organization-service';
import { OrganizationType } from '../../app/application/master-data/master-data-types';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { hasCode } from './test-helpers';

let prisma: PrismaClient;
let rootId: string;
let actorUserId: string;
let service: OrganizationService;

async function createTrustRoot(): Promise<void> {
  rootId = randomUUID();
  actorUserId = randomUUID();
  const roleId = randomUUID();
  await prisma.$transaction([
    prisma.organization.create({
      data: {
        id: rootId,
        code: 'ROOT',
        name: 'Chengye Law Firm',
        type: 'FIRM',
        path: `/${rootId}`,
        level: 0,
      },
    }),
    prisma.role.create({
      data: { id: roleId, code: 'SYSTEM_SUPER_ADMIN', name: 'System super admin', type: 'SYSTEM' },
    }),
    prisma.user.create({
      data: { id: actorUserId, username: `actor.${actorUserId}`, password: 'not-used-by-this-test' },
    }),
  ]);
  await prisma.systemInitialization.create({
    data: {
      id: 'PRIMARY',
      rootOrganizationId: rootId,
      superAdminUserId: actorUserId,
      completedAt: new Date('2026-07-18T00:00:00.000Z'),
    },
  });
}

async function createOrganization(
  code: string,
  type: Exclude<OrganizationType, 'FIRM'>,
  parentId = rootId,
  sort = 0,
) {
  return service.create({ code, name: `${code} name`, type, parentId, sort });
}

async function dropAuditFailureTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_master_data_audit_trigger ON "operation_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_master_data_audit()');
}

test.before(async () => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await dropAuditFailureTrigger();
  await clearTestApplicationData(prisma);
  await createTrustRoot();
  service = new OrganizationService(prisma, { actorUserId, ip: '127.0.0.1' });
});

test.after(async () => {
  await dropAuditFailureTrigger();
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

test('creates normalized branch and department paths with sanitized audit', async () => {
  const branch = await service.create({
    code: ' branch_east ',
    name: '  East Branch  ',
    type: 'BRANCH',
    parentId: rootId,
    sort: 20,
  });
  const department = await createOrganization('LITIGATION', 'DEPARTMENT', branch.id);

  assert.equal(branch.code, 'BRANCH_EAST');
  assert.equal(branch.name, 'East Branch');
  assert.equal(branch.path, `/${rootId}/${branch.id}`);
  assert.equal(branch.level, 1);
  assert.equal(department.path, `${branch.path}/${department.id}`);
  assert.equal(department.level, 2);

  const audit = await prisma.operationLog.findFirstOrThrow({ where: { targetId: branch.id } });
  assert.deepEqual(JSON.parse(audit.newValues ?? '{}'), {
    code: 'BRANCH_EAST',
    status: 'ENABLED',
    version: 1,
    type: 'BRANCH',
  });
});

test('maps a concurrent duplicate organization code race to a stable conflict', async () => {
  const results = await Promise.allSettled([
    createOrganization('DUPLICATE', 'BRANCH', rootId, 1),
    createOrganization('DUPLICATE', 'HQ_CENTER', rootId, 2),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.ok(rejected);
  assert.equal(hasCode('MASTER_DATA_CODE_CONFLICT')(rejected.reason), true);
});

test('rejects a second firm and invalid parent type', async () => {
  await assert.rejects(
    () => service.create({ code: 'SECOND_FIRM', name: 'Second Firm', type: 'FIRM', parentId: rootId } as never),
    hasCode('ORGANIZATION_HIERARCHY_INVALID'),
  );
  const branch = await createOrganization('BRANCH_A', 'BRANCH');
  await assert.rejects(
    () => createOrganization('BRANCH_B', 'BRANCH', branch.id),
    hasCode('ORGANIZATION_HIERARCHY_INVALID'),
  );
});

test('moves a subtree and increments target and descendant versions', async () => {
  const center = await createOrganization('RESEARCH', 'HQ_CENTER');
  const branch = await createOrganization('BRANCH_A', 'BRANCH');
  const department = await createOrganization('DEPARTMENT_A', 'DEPARTMENT', branch.id);
  const group = await createOrganization('GROUP_A', 'GROUP', department.id);

  const moved = await service.move(department.id, { parentId: center.id, version: department.version });
  const movedGroup = await prisma.organization.findUniqueOrThrow({ where: { id: group.id } });

  assert.equal(moved.parentId, center.id);
  assert.equal(moved.path, `${center.path}/${department.id}`);
  assert.equal(moved.level, center.level + 1);
  assert.equal(moved.version, 2);
  assert.equal(movedGroup.path, `${moved.path}/${group.id}`);
  assert.equal(movedGroup.level, moved.level + 1);
  assert.equal(movedGroup.version, 2);
});

test('rejects cycles before parent-type validation and protects the root', async () => {
  const branch = await createOrganization('BRANCH_A', 'BRANCH');
  const department = await createOrganization('DEPARTMENT_A', 'DEPARTMENT', branch.id);
  const group = await createOrganization('GROUP_A', 'GROUP', department.id);

  await assert.rejects(
    () => service.move(department.id, { parentId: group.id, version: department.version }),
    hasCode('ORGANIZATION_CYCLE'),
  );
  await assert.rejects(
    () => service.move(rootId, { parentId: branch.id, version: 1 }),
    hasCode('TRUST_ROOT_PROTECTED'),
  );
  await assert.rejects(() => service.disable(rootId, 1), hasCode('TRUST_ROOT_PROTECTED'));
});

test('rejects stale updates and enabling below a disabled ancestor', async () => {
  const branch = await createOrganization('BRANCH_A', 'BRANCH');
  const department = await createOrganization('DEPARTMENT_A', 'DEPARTMENT', branch.id);
  await service.disable(department.id, department.version);
  await service.disable(branch.id, branch.version);

  await assert.rejects(
    () => service.update(branch.id, { name: 'Stale branch', version: branch.version }),
    hasCode('VERSION_CONFLICT'),
  );
  const disabledDepartment = await prisma.organization.findUniqueOrThrow({ where: { id: department.id } });
  await assert.rejects(
    () => service.enable(department.id, disabledDepartment.version),
    hasCode('ORGANIZATION_HIERARCHY_INVALID'),
  );
});

test('blocks disable while an enabled descendant, position, or assignment is active', async () => {
  const branch = await createOrganization('BRANCH_A', 'BRANCH');
  const child = await createOrganization('DEPARTMENT_A', 'DEPARTMENT', branch.id);
  await assert.rejects(() => service.disable(branch.id, branch.version), hasCode('MASTER_DATA_IN_USE'));

  await service.disable(child.id, child.version);
  const position = await prisma.position.create({
    data: { organizationId: branch.id, code: 'LAWYER', name: 'Lawyer', categoryCode: 'LAWYER' },
  });
  await assert.rejects(() => service.disable(branch.id, branch.version), hasCode('MASTER_DATA_IN_USE'));

  await prisma.position.update({ where: { id: position.id }, data: { status: 'DISABLED' } });
  const employee = await prisma.employee.create({
    data: {
      employeeNo: 'EMP-001',
      name: 'Employee One',
      phone: '13800000000',
      type: 'LAWYER',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
      orgId: branch.id,
      positionId: position.id,
    },
  });
  await prisma.employeeAssignment.create({
    data: {
      employeeId: employee.id,
      organizationId: branch.id,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: employee.entryDate,
    },
  });
  await assert.rejects(() => service.disable(branch.id, branch.version), hasCode('MASTER_DATA_IN_USE'));
});

test('returns a deterministic tree and detail relationship counts', async () => {
  const later = await createOrganization('BRANCH_Z', 'BRANCH', rootId, 20);
  const first = await createOrganization('BRANCH_B', 'BRANCH', rootId, 10);
  const sameSort = await createOrganization('BRANCH_A', 'BRANCH', rootId, 10);

  const tree = await service.tree();
  assert.deepEqual(tree[0].children.map(item => item.id), [sameSort.id, first.id, later.id]);

  await prisma.position.create({
    data: { organizationId: first.id, code: 'LAWYER', name: 'Lawyer', categoryCode: 'LAWYER' },
  });
  const detail = await service.detail(first.id);
  assert.equal(detail.parent?.id, rootId);
  assert.deepEqual(detail.counts, { positions: 1, activeAssignments: 0 });
});

test('rolls back organization creation when audit writing fails', async () => {
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_master_data_audit() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected master data audit failure';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_master_data_audit_trigger
    BEFORE INSERT ON "operation_log"
    FOR EACH ROW EXECUTE FUNCTION fail_master_data_audit()
  `);

  await assert.rejects(() => createOrganization('ROLLBACK_BRANCH', 'BRANCH'));
  assert.equal(await prisma.organization.count({ where: { code: 'ROLLBACK_BRANCH' } }), 0);
});
