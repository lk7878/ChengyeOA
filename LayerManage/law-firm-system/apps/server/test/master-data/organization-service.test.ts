import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { OrganizationService } from '../../app/application/master-data/organization-service';
import { OrganizationType } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { hasCode } from './test-helpers';

let prisma: PrismaClient;
let rootId: string;
let actorUserId: string;
let service: OrganizationService;

const ORGANIZATION_PERMISSIONS: PermissionCode[] = [
  'organization.read',
  'organization.create',
  'organization.update',
  'organization.move',
  'organization.status.manage',
];

function authorizationContext(permissionCodes: PermissionCode[], scopeIds = ['ALL']): AuthorizationContext {
  return {
    userId: actorUserId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: scopeIds.includes('ALL'),
    grants: permissionCodes.map(permissionCode => ({
      sourceType: 'ROLE',
      sourceId: 'organization-test-role',
      permissionCode,
      resource: 'organization',
      scopeIds,
      validUntil: null as Date | null,
    })),
    fieldRules: [],
    permissionCodes,
    evaluatedAt: new Date('2026-07-18T12:00:00.000Z'),
  };
}

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
  sort?: number,
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
  service = new OrganizationService(
    prisma,
    { actorUserId, ip: '127.0.0.1' },
    authorizationContext(ORGANIZATION_PERMISSIONS),
  );
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
    sort: 20,
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
  const first = await createOrganization('BRANCH_B', 'BRANCH', rootId, 11);
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

test('keeps business options branch-scoped while denying management details', async () => {
  const branchA = await createOrganization('BRANCH_A', 'BRANCH');
  const departmentA = await createOrganization('DEPARTMENT_A', 'DEPARTMENT', branchA.id);
  const branchB = await createOrganization('BRANCH_B', 'BRANCH');
  const branchScope = await prisma.dataScope.create({
    data: {
      name: 'Branch A scope',
      scopeType: 'BRANCH',
      organizationId: branchA.id,
      includeDescendants: true,
    },
  });
  const scoped = new OrganizationService(
    prisma,
    { actorUserId, ip: '127.0.0.1' },
    authorizationContext(['organization.read'], [branchScope.id]),
  );

  const tree = await scoped.options();
  assert.deepEqual(tree.map(item => item.id), [branchA.id]);
  assert.deepEqual(tree[0].children.map(item => item.id), [departmentA.id]);
  assert.equal('manager' in tree[0], false);
  await assert.rejects(() => scoped.detail(departmentA.id), hasCode('SUPER_ADMIN_REQUIRED'));
  await assert.rejects(
    () => scoped.detail(branchB.id),
    hasCode('SUPER_ADMIN_REQUIRED'),
  );
});

test('SPEC-003-A denies every management operation to an ordinary administrator with all permission codes', async () => {
  const branch = await createOrganization('BRANCH_A', 'BRANCH');
  const context = { ...authorizationContext(ORGANIZATION_PERMISSIONS), isSystemSuperAdmin: false, isSystemAdmin: true };
  const ordinary = new OrganizationService(prisma, { actorUserId }, context);
  for (const action of [
    () => ordinary.tree(), () => ordinary.detail(branch.id), () => ordinary.managerOptions(),
    () => ordinary.create({ code: 'DENIED', name: 'Denied', type: 'DEPARTMENT', parentId: rootId }),
    () => ordinary.update(branch.id, { name: 'Denied', version: 1 }),
    () => ordinary.move(branch.id, { parentId: rootId, version: 1 }),
    () => ordinary.disable(branch.id, 1), () => ordinary.enable(branch.id, 1),
    () => ordinary.remove(branch.id, 1),
    () => ordinary.copy(branch.id, { code: 'DENIED', name: 'Denied', type: 'BRANCH', parentId: rootId, sourceVersion: 1 }),
  ]) await assert.rejects(action, hasCode('SUPER_ADMIN_REQUIRED'));
});

test('honors exact organization, HQ, and super-admin organization scopes', async () => {
  const branchA = await createOrganization('BRANCH_A', 'BRANCH');
  const departmentA = await createOrganization('DEPARTMENT_A', 'DEPARTMENT', branchA.id);
  const hq = await createOrganization('HQ', 'HQ_CENTER');
  const hqDepartment = await createOrganization('HQ_DEPARTMENT', 'DEPARTMENT', hq.id);
  const nestedBranchId = randomUUID();
  await prisma.organization.create({
    data: {
      id: nestedBranchId, code: 'HQ_NESTED_BRANCH', name: 'Nested branch', type: 'BRANCH',
      parentId: hq.id, path: `${hq.path}/${nestedBranchId}`, level: hq.level + 1,
    },
  });
  const exactScope = await prisma.dataScope.create({
    data: { name: 'Branch A exact', scopeType: 'ORG', organizationId: branchA.id, includeDescendants: false },
  });
  const hqScope = await prisma.dataScope.create({ data: { name: 'HQ scope', scopeType: 'HQ_SCOPE' } });

  const exact = new OrganizationService(
    prisma, { actorUserId }, authorizationContext(['organization.read'], [exactScope.id]),
  );
  assert.deepEqual((await exact.options()).map(item => item.id), [branchA.id]);
  await assert.rejects(() => exact.detail(departmentA.id), hasCode('SUPER_ADMIN_REQUIRED'));

  const hqOnly = new OrganizationService(
    prisma, { actorUserId }, authorizationContext(['organization.read'], [hqScope.id]),
  );
  const hqTree = await hqOnly.options();
  assert.deepEqual(hqTree.map(item => item.id), [hq.id]);
  assert.deepEqual(hqTree[0].children.map(item => item.id), [hqDepartment.id]);
  await assert.rejects(() => hqOnly.detail(nestedBranchId), hasCode('SUPER_ADMIN_REQUIRED'));

  assert.equal((await service.detail(nestedBranchId)).id, nestedBranchId);
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

test('characterizes governance-shared sort and status mutations with audit output', async () => {
  const branch = await createOrganization('SHARED_ORG', 'BRANCH');
  const updated = await service.update(branch.id, { sort: 17, version: branch.version });
  const disabled = await service.disable(branch.id, updated.version);
  const enabled = await service.enable(branch.id, disabled.version);

  assert.deepEqual(
    { sort: updated.sort, disabled: disabled.status, enabled: enabled.status, version: enabled.version },
    { sort: 17, disabled: 'DISABLED', enabled: 'ENABLED', version: 4 },
  );
  const logs = await prisma.operationLog.findMany({ where: { targetId: branch.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(logs.map(log => log.action), ['CREATE', 'UPDATE', 'DISABLE', 'ENABLE']);
  assert.deepEqual(JSON.parse(logs[1].newValues ?? '{}'), {
    code: 'SHARED_ORG', type: 'BRANCH', sort: 17, status: 'ENABLED', version: 2,
  });
});

async function managerEmployee(employeeNo: string, status = 'FORMAL') {
  return prisma.employee.create({ data: { employeeNo, name: employeeNo + '负责人', phone: '13800000001', type: 'LAWYER', status, entryDate: new Date('2026-01-01') } });
}

test('SPEC-003-A sets, changes and clears managers and rejects inactive or nonexistent employees', async () => {
  const first = await managerEmployee('MANAGER_01');
  const second = await managerEmployee('MANAGER_02', 'PROBATION');
  const leaved = await managerEmployee('MANAGER_03', 'LEAVED');
  const org = await service.create({ code: 'MANAGED', name: '律师部门', type: 'DEPARTMENT', parentId: rootId, managerEmployeeId: first.id });
  assert.equal(org.manager?.id, first.id);
  const updated = await service.update(org.id, { version: org.version, managerEmployeeId: second.id });
  assert.equal(updated.manager?.id, second.id);
  assert.equal((await service.detail(org.id)).manager?.employeeNo, second.employeeNo);
  const cleared = await service.update(org.id, { version: updated.version, managerEmployeeId: null });
  assert.equal(cleared.managerEmployeeId, null);
  for (const id of [leaved.id, randomUUID()]) {
    await assert.rejects(() => service.update(org.id, { version: cleared.version, managerEmployeeId: id }), hasCode('ORGANIZATION_MANAGER_INVALID'));
  }
  await assert.rejects(() => service.update(org.id, { version: 1, managerEmployeeId: first.id }), hasCode('VERSION_CONFLICT'));
  const candidates = await service.managerOptions('MANAGER_');
  assert.deepEqual(new Set(candidates.map(item => item.id)), new Set([first.id, second.id]));
  assert.deepEqual(Object.keys(candidates[0]).sort(), ['employeeNo', 'id', 'name', 'status']);
});

test('SPEC-003-A copies all descendants and positions without assignments or inherited managers', async () => {
  const branch = await createOrganization('SOURCE_BRANCH', 'BRANCH');
  const dept = await createOrganization('SOURCE_DEPT', 'DEPARTMENT', branch.id);
  const group = await createOrganization('SOURCE_GROUP', 'GROUP', dept.id);
  const employee = await managerEmployee('SOURCE_MANAGER');
  await service.update(dept.id, { version: 1, managerEmployeeId: employee.id });
  for (const organizationId of [branch.id, dept.id, group.id]) {
    await prisma.position.create({ data: { organizationId, code: 'LAWYER', name: '律师岗位', categoryCode: 'LEGAL', level: 2, responsibilities: '法律服务' } });
  }
  const position = await prisma.position.findFirstOrThrow({ where: { organizationId: dept.id } });
  await prisma.employeeAssignment.create({ data: { organizationId: dept.id, positionId: position.id, employeeId: employee.id, assignmentType: 'PRIMARY', startedAt: employee.entryDate } });
  const copy = await service.copy(branch.id, { sourceVersion: 1, code: 'COPY_BRANCH', name: '复制分所', type: 'BRANCH', parentId: rootId, sort: 9 });
  const nodes = await prisma.organization.findMany({ where: { OR: [{ id: copy.id }, { path: { startsWith: copy.path + '/' } }] }, orderBy: { level: 'asc' } });
  assert.equal(nodes.length, 3);
  assert.deepEqual(nodes.map(node => node.type), ['BRANCH', 'DEPARTMENT', 'GROUP']);
  assert.equal(nodes[1].parentId, copy.id);
  assert.equal(nodes[2].path, nodes[1].path + '/' + nodes[2].id);
  assert.ok(nodes.every(node => node.version === 1 && node.managerEmployeeId === null));
  assert.ok(nodes.every(node => /^[A-Z][A-Z0-9_]{1,31}$/.test(node.code)));
  assert.ok(nodes.every(node => ![branch.id, dept.id, group.id].includes(node.id)));
  const copiedPositions = await prisma.position.findMany({ where: { organizationId: { in: nodes.map(node => node.id) } } });
  assert.equal(copiedPositions.length, 3);
  assert.ok(copiedPositions.every(item => item.code === 'LAWYER' && item.responsibilities === '法律服务' && item.version === 1));
  assert.equal(await prisma.employeeAssignment.count({ where: { organizationId: { in: nodes.map(node => node.id) } } }), 0);
  assert.equal((await service.detail(dept.id)).manager?.id, employee.id);
  const audit = await prisma.operationLog.findFirstOrThrow({ where: { targetId: copy.id, action: 'COPY' } });
  assert.equal(JSON.parse(audit.newValues!).copiedPositionCount, 3);
  assert.equal(JSON.parse(audit.newValues!).copiedOrganizationCount, 3);
  const withManager = await service.copy(branch.id, { sourceVersion: 1, code: 'MANAGED_COPY', name: '指定负责人副本', type: 'BRANCH', parentId: rootId, managerEmployeeId: employee.id });
  assert.equal(withManager.managerEmployeeId, employee.id);
  assert.equal(withManager.manager?.id, employee.id);
});

test('SPEC-003-A rejects invalid copies and leaves no partial organizations or positions', async () => {
  const branch = await createOrganization('SOURCE_BRANCH', 'BRANCH');
  await createOrganization('SOURCE_DEPT', 'DEPARTMENT', branch.id);
  const base = { sourceVersion: 1, code: 'COPY_BRANCH', name: '复制分所', type: 'BRANCH' as const, parentId: rootId };
  const before = await prisma.organization.count();
  await assert.rejects(() => service.copy(branch.id, { ...base, sourceVersion: 9 }), hasCode('VERSION_CONFLICT'));
  await assert.rejects(() => service.copy(branch.id, { ...base, code: branch.code }), hasCode('MASTER_DATA_CODE_CONFLICT'));
  await assert.rejects(() => service.copy(branch.id, { ...base, type: 'DEPARTMENT' }), hasCode('ORGANIZATION_HIERARCHY_INVALID'));
  await assert.rejects(() => service.copy(rootId, base), hasCode('TRUST_ROOT_PROTECTED'));
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_master_data_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_master_data_audit_trigger BEFORE INSERT ON "operation_log" FOR EACH ROW EXECUTE FUNCTION fail_master_data_audit()`);
  await assert.rejects(() => service.copy(branch.id, base));
  assert.equal(await prisma.organization.count(), before);
  assert.equal(await prisma.position.count(), 0);
});

test('SPEC-003-A deletes only unreferenced leaves, protects root and retains delete audit', async () => {
  const branch = await createOrganization('DELETE_BRANCH', 'BRANCH');
  const leaf = await createOrganization('DELETE_DEPT', 'DEPARTMENT', branch.id);
  await assert.rejects(() => service.remove(rootId, 1), hasCode('TRUST_ROOT_PROTECTED'));
  await assert.rejects(() => service.remove(branch.id, 1), hasCode('ORGANIZATION_DELETE_IN_USE'));
  await assert.rejects(() => service.remove(leaf.id, 2), hasCode('VERSION_CONFLICT'));
  await service.remove(leaf.id, 1);
  assert.equal(await prisma.organization.findUnique({ where: { id: leaf.id } }), null);
  assert.equal(await prisma.operationLog.count({ where: { targetId: leaf.id, action: 'DELETE' } }), 1);
  await prisma.position.create({ data: { organizationId: branch.id, code: 'DISABLED', name: '历史岗位', categoryCode: 'LEGAL', status: 'DISABLED' } });
  await assert.rejects(() => service.remove(branch.id, 1), hasCode('ORGANIZATION_DELETE_IN_USE'));
});

test('SPEC-003-A rolls back deletion if the audit cannot be written', async () => {
  const org = await createOrganization('DELETE_ROLLBACK', 'DEPARTMENT');
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_master_data_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_master_data_audit_trigger BEFORE INSERT ON "operation_log" FOR EACH ROW EXECUTE FUNCTION fail_master_data_audit()`);
  await assert.rejects(() => service.remove(org.id, 1));
  assert.equal(await prisma.organization.count({ where: { id: org.id } }), 1);
});

test('SPEC-003-B enforces globally unique sorting, including root, inactive organizations and shared governance updates', async () => {
  const { updateOrganizationTx } = await import('../../app/application/master-data/transactional-master-data-commands');
  const branch = await createOrganization('SORT_BRANCH', 'BRANCH', rootId, 10);
  const department = await createOrganization('SORT_DEPT', 'DEPARTMENT', branch.id, 20);
  await assert.rejects(() => service.create({ code: 'CONFLICT', name: '重复号码', type: 'BRANCH', parentId: rootId, sort: 10 }), hasCode('ORGANIZATION_SORT_CONFLICT'));
  await assert.rejects(() => service.update(rootId, { sort: 20, version: 1 }), hasCode('ORGANIZATION_SORT_CONFLICT'));
  await assert.rejects(() => prisma.$transaction(tx => updateOrganizationTx(tx, { actorUserId }, branch.id, { sort: 20, version: 1 })), hasCode('ORGANIZATION_SORT_CONFLICT'));
  const unchanged = await service.update(branch.id, { sort: 10, version: 1 });
  assert.equal(unchanged.sort, 10);
  await service.disable(department.id, 1);
  await assert.rejects(() => service.update(branch.id, { name: '改名', sort: 20, version: unchanged.version }), hasCode('ORGANIZATION_SORT_CONFLICT'));
  await service.update(branch.id, { sort: 30, version: unchanged.version });
  const reused = await createOrganization('SORT_REUSED', 'BRANCH', rootId, 10);
  assert.equal(reused.sort, 10);
});

test('SPEC-003-B only one concurrent organization can claim a sorting number', async () => {
  const results = await Promise.allSettled([
    createOrganization('SORT_RACE_A', 'BRANCH', rootId, 33),
    createOrganization('SORT_RACE_B', 'BRANCH', rootId, 33),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')!;
  assert.ok(hasCode('ORGANIZATION_SORT_CONFLICT')(rejected.reason));
});

test('SPEC-003-B copied descendants receive new sorting numbers and keep sibling order', async () => {
  const branch = await createOrganization('SORT_SOURCE', 'BRANCH');
  await createOrganization('SORT_Z', 'DEPARTMENT', branch.id, 40);
  await createOrganization('SORT_A', 'DEPARTMENT', branch.id, 50);
  const copied = await service.copy(branch.id, { code: 'SORT_COPY', name: '排序副本', type: 'BRANCH', parentId: rootId, sourceVersion: 1 });
  const children = await prisma.organization.findMany({ where: { parentId: copied.id }, orderBy: { sort: 'asc' } });
  assert.deepEqual(children.map(node => node.name), ['SORT_Z name', 'SORT_A name']);
  assert.ok(children.every(node => node.sort > copied.sort));
  const all = await prisma.organization.findMany({ select: { sort: true } });
  assert.equal(new Set(all.map(node => node.sort)).size, all.length);
  await assert.rejects(() => service.copy(branch.id, { code: 'SORT_BAD_COPY', name: '重复排序副本', type: 'BRANCH', parentId: rootId, sourceVersion: 1, sort: 40 }), hasCode('ORGANIZATION_SORT_CONFLICT'));
});
