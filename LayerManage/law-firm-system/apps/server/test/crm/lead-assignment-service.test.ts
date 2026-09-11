import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';

import { LeadAssignmentService } from '../../app/application/crm/lead-assignment-service';
import { EventOutboxWriter } from '../../app/application/events/event-outbox-writer';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  ACTOR_EMPLOYEE_UNBOUND,
  CrmError,
  LEAD_NOT_FOUND,
  LEAD_NOT_IN_POOL,
  LEAD_STATE_TRANSITION_INVALID,
} from '../../app/domain/crm/lead-errors';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-009 Task 6: lead-assignment-service 契约测试（公海领取/分配改派/手动回收/超时回收批）。
// 绑定决策（2026-07-29 dispatch coordinator decisions，覆盖一切较早注记）：
//   1. claim 用专用动作权限 lead.pool.claim；assign/reassign→lead.assign；recycle→lead.recycle。
//   2. claim 允许 PUBLIC 或 RECYCLED；PRIVATE 一律抛 LEAD_NOT_IN_POOL(409)。
//   3. claim 的 actor 必须绑定员工（AuthorizationContext.employeeId 源自 User.employeeId 绑定列），
//      未绑定抛 ACTOR_EMPLOYEE_UNBOUND(403)。
//   4. claim/assign/reassign 置 PRIVATE+assignedAt=now()；lead.status=NEW 时经 canTransition 推进
//      到 ASSIGNED，其余 status 不变；recycle 置 RECYCLED+清 assignedTo/assignedAt，status 不变
//      （poolStatus 与 status 正交）。手动 recycle 仅允许 PRIVATE（否则 LEAD_STATE_TRANSITION_INVALID 409）。
//   5. 每次池动作同事务写 LeadPoolRecord(append-only) + lead.assigned v1 事件；status 实际流转时
//      再写 lead.status_changed v1。
//   6. 每个操作按自身权限码做 buildLeadScopeWhere 数据范围校验（与 lead-service 同语义，
//      SELF→assignedTo / TEAM→professionalTeamId / BRANCH·ORG→branchId 子树 / OR 并集 / 零谓词
//      fail-closed）；不可见 → LEAD_NOT_FOUND(404) 不泄露存在性。
//   7. recycleOverdueLeads 每条独立事务（单行失败不中断批次），返回 { recycledCount, leadIds }。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-assignment-service.test.ts

let prisma: PrismaClient;

const POOL_PERMISSIONS: PermissionCode[] = [
  'lead.read',
  'lead.pool.claim',
  'lead.assign',
  'lead.recycle',
];

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

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

interface ContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
  fieldRules?: AuthorizationContext['fieldRules'];
}

function crmContext(userId: string, overrides: ContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? POOL_PERMISSIONS;
  const scopeIds = overrides.scopeIds ?? ['ALL'];
  return {
    userId,
    employeeId: overrides.employeeId ?? null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: permissionCodes.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds,
      validUntil: null,
    })),
    fieldRules: overrides.fieldRules ?? [],
    permissionCodes,
    evaluatedAt: new Date(),
  };
}

async function createActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `pool.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function serviceFor(userId: string, actor: AuditActor, overrides: ContextOverrides = {}): LeadAssignmentService {
  return new LeadAssignmentService(prisma, actor, crmContext(userId, overrides));
}

async function seedLead(data: Partial<Prisma.LeadUncheckedCreateInput> = {}) {
  const id = randomUUID();
  const { updatedAt, ...rest } = data;
  const lead = await prisma.lead.create({
    data: {
      id,
      leadNo: `L-SEED-${id}`,
      name: '种子线索',
      phone: '13700009999',
      phoneHash: hashPhone('13700009999'),
      status: 'NEW',
      poolStatus: 'PUBLIC',
      createdBy: 'seed',
      ...rest,
    },
  });
  if (updatedAt) {
    // updatedAt 由 @updatedAt 自动维护；测试需要精确控制"最近跟进时间"，用裸 SQL 覆写。
    await prisma.$executeRaw`UPDATE "lead" SET "updatedAt" = ${updatedAt} WHERE "id" = ${id}`;
    return prisma.lead.findUniqueOrThrow({ where: { id } });
  }
  return lead;
}

async function createOrganizationFixture(code: string, parent?: { id: string; path: string }) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      code: `${code}_${id}`,
      name: code,
      type: 'BRANCH',
      parentId: parent?.id,
      path: parent ? `${parent.path}/${id}` : `/${id}`,
      level: parent ? parent.path.split('/').length - 1 : 0,
    },
  });
}

async function createEmployeeInOrg(organizationId: string, code: string) {
  const position = await prisma.position.create({
    data: {
      organizationId,
      code: `POS_${randomUUID()}`,
      name: `${code} position`,
      categoryCode: 'STAFF',
    },
  });
  return prisma.employee.create({
    data: {
      employeeNo: `EMP_${randomUUID()}`,
      name: code,
      phone: `1${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      type: 'SALES',
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

async function createEmployeeFixture(code: string) {
  const orgId = randomUUID();
  await prisma.organization.create({
    data: { id: orgId, code: `ORG_${orgId}`, name: code, type: 'BRANCH', path: `/${orgId}` },
  });
  return createEmployeeInOrg(orgId, code);
}

test('claimFromPool claims a public lead and writes the CLAIM record and events in one transaction', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const claimer = await createEmployeeInOrg(branch.id, '客服');
  const lead = await seedLead({ branchId: branch.id, status: 'NEW' });
  const service = serviceFor(userId, actor, { employeeId: claimer.id });
  const before = Date.now();

  const view = await service.claimFromPool(lead.id);

  assert.equal(view.poolStatus, 'PRIVATE');
  assert.equal(view.assignedTo, claimer.id);
  const assignedAt = view.assignedAt;
  assert.ok(assignedAt, 'claim must write assignedAt');
  assert.ok(Math.abs(assignedAt.getTime() - before) < 60_000, 'assignedAt must be now()');
  assert.equal(view.version, 2);
  // 决策 4：status=NEW 的线索在 claim 时经 canTransition 推进到 ASSIGNED。
  assert.equal(view.status, 'ASSIGNED');

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.poolStatus, 'PRIVATE');
  assert.equal(stored.assignedTo, claimer.id);
  assert.ok(stored.assignedAt);
  assert.equal(stored.updatedBy, userId);
  assert.equal(stored.status, 'ASSIGNED');

  const record = await prisma.leadPoolRecord.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.equal(record.action, 'CLAIM');
  assert.equal(record.fromEmployeeId, null);
  assert.equal(record.toEmployeeId, claimer.id);
  assert.equal(record.reason, null);
  assert.equal(record.operatedBy, userId);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.assigned', objectId: lead.id },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.objectType, 'LEAD');
  assert.equal(event.sourceModule, 'CRM');
  assert.equal(event.operatorUserId, userId);
  assert.equal(event.branchId, branch.id, 'envelope keeps the lead branch pass-through');
  assert.deepEqual(event.payload, {
    leadId: lead.id,
    action: 'CLAIM',
    fromEmployeeId: null,
    toEmployeeId: claimer.id,
  });

  const statusEvent = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.status_changed', objectId: lead.id },
  });
  assert.deepEqual(statusEvent.payload, {
    leadId: lead.id,
    fromStatus: 'NEW',
    toStatus: 'ASSIGNED',
  });
});

test('claimFromPool treats a RECYCLED lead as back-in-pool and claimable, status untouched when non-NEW', async () => {
  const { userId, actor } = await createActor();
  const claimer = await createEmployeeFixture('领取人');
  const lead = await seedLead({
    poolStatus: 'RECYCLED', assignedTo: null, assignedAt: null, status: 'ASSIGNED',
  });
  const service = serviceFor(userId, actor, { employeeId: claimer.id });

  const view = await service.claimFromPool(lead.id);

  assert.equal(view.poolStatus, 'PRIVATE');
  assert.equal(view.assignedTo, claimer.id);
  assert.equal(view.status, 'ASSIGNED', 'status only transitions from NEW');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.status_changed', objectId: lead.id } }),
    0,
  );
  const record = await prisma.leadPoolRecord.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.equal(record.action, 'CLAIM');
  assert.equal(record.fromEmployeeId, null);
  assert.equal(record.toEmployeeId, claimer.id);
  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.assigned', objectId: lead.id },
  });
  assert.deepEqual(event.payload, {
    leadId: lead.id,
    action: 'CLAIM',
    fromEmployeeId: null,
    toEmployeeId: claimer.id,
  });
});

test('claimFromPool on recycled leads pins the status boundary: NEW promotes, CONTACTED untouched', async () => {
  const { userId, actor } = await createActor();
  const claimer = await createEmployeeFixture('领取人');
  // 回收池中的 NEW 线索：领取时同样经 canTransition 推进到 ASSIGNED 并写 status_changed。
  const recycledNew = await seedLead({
    name: '回收池NEW', poolStatus: 'RECYCLED', assignedTo: null, assignedAt: null, status: 'NEW',
  });
  // 回收池中 status 已越过 ASSIGNED 的线索（如回收前已 CONTACTED）：领取只动归属，不动状态机。
  const recycledContacted = await seedLead({
    name: '回收池CONTACTED', poolStatus: 'RECYCLED', assignedTo: null, assignedAt: null, status: 'CONTACTED',
  });
  const service = serviceFor(userId, actor, { employeeId: claimer.id });

  const promoted = await service.claimFromPool(recycledNew.id);
  assert.equal(promoted.poolStatus, 'PRIVATE');
  assert.equal(promoted.status, 'ASSIGNED', 'recycled NEW lead is promoted on claim');
  const statusEvent = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.status_changed', objectId: recycledNew.id },
  });
  assert.deepEqual(statusEvent.payload, {
    leadId: recycledNew.id,
    fromStatus: 'NEW',
    toStatus: 'ASSIGNED',
  });
  const assignedEvent = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.assigned', objectId: recycledNew.id },
  });
  assert.deepEqual(assignedEvent.payload, {
    leadId: recycledNew.id,
    action: 'CLAIM',
    fromEmployeeId: null,
    toEmployeeId: claimer.id,
  });

  const untouched = await service.claimFromPool(recycledContacted.id);
  assert.equal(untouched.poolStatus, 'PRIVATE');
  assert.equal(untouched.status, 'CONTACTED', 'status beyond ASSIGNED is never moved by claim');
  assert.equal(
    await prisma.eventLog.count({
      where: { eventType: 'lead.status_changed', objectId: recycledContacted.id },
    }),
    0,
  );
});

test('claimFromPool rejects a PRIVATE lead with LEAD_NOT_IN_POOL even when the actor already owns it', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('持有人');
  const lead = await seedLead({ poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: new Date() });
  // 不做"本人重复领取"特例：私海线索一律 LEAD_NOT_IN_POOL（决策 2）。
  const service = serviceFor(userId, actor, { employeeId: owner.id });

  await assert.rejects(
    () => service.claimFromPool(lead.id),
    error => error instanceof CrmError
      && error.code === LEAD_NOT_IN_POOL
      && error.httpStatus === 409,
  );
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.version, 1);
  assert.equal(await prisma.leadPoolRecord.count(), 0);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.assigned' } }), 0);
});

test('claimFromPool returns LEAD_NOT_FOUND for missing or out-of-scope leads without leaking existence', async () => {
  const { userId, actor } = await createActor();
  const claimer = await createEmployeeFixture('领取人');
  const service = serviceFor(userId, actor, { employeeId: claimer.id });
  await assert.rejects(
    () => service.claimFromPool(randomUUID()),
    error => error instanceof CrmError
      && error.code === LEAD_NOT_FOUND
      && error.httpStatus === 404,
  );

  const branch = await createOrganizationFixture('BRANCH_VISIBLE');
  const other = await createOrganizationFixture('BRANCH_HIDDEN');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const hidden = await seedLead({ branchId: other.id, name: '外所公海' });
  const scoped = serviceFor(userId, actor, { employeeId: claimer.id, scopeIds: [branchScope.id] });
  await assert.rejects(() => scoped.claimFromPool(hidden.id), hasCode(LEAD_NOT_FOUND));
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: hidden.id } });
  assert.equal(stored.poolStatus, 'PUBLIC', 'out-of-scope claim must not touch the lead');
  assert.equal(await prisma.leadPoolRecord.count(), 0);
});

test('claimFromPool requires the lead.pool.claim permission and an employee binding', async () => {
  const { userId, actor } = await createActor();
  const claimer = await createEmployeeFixture('领取人');
  const lead = await seedLead();

  const noPermission = serviceFor(userId, actor, {
    employeeId: claimer.id,
    permissionCodes: ['lead.read', 'lead.assign', 'lead.recycle'],
  });
  await assert.rejects(() => noPermission.claimFromPool(lead.id), hasCode('PERMISSION_DENIED'));

  // 决策 3：actor 账号未绑定员工（context.employeeId=null，源自 User.employeeId 绑定列）→ 403。
  const noEmployee = serviceFor(userId, actor, { employeeId: null });
  await assert.rejects(
    () => noEmployee.claimFromPool(lead.id),
    error => error instanceof CrmError
      && error.code === ACTOR_EMPLOYEE_UNBOUND
      && error.httpStatus === 403,
  );

  assert.equal(await prisma.leadPoolRecord.count(), 0);
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.poolStatus, 'PUBLIC');
});

test('pool scope anchors on the lead row: branch-scoped claim works, SELF-only fails closed', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_POOL');
  const claimer = await createEmployeeInOrg(branch.id, '分所领取人');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  // 公海线索 assignedTo=null：范围锚定 Lead.branchId（组织子树展开），本所范围可领取。
  const inBranch = await seedLead({ branchId: branch.id, name: '本所公海' });

  const branchScoped = serviceFor(userId, actor, { employeeId: claimer.id, scopeIds: [branchScope.id] });
  const claimed = await branchScoped.claimFromPool(inBranch.id);
  assert.equal(claimed.poolStatus, 'PRIVATE');
  assert.equal(claimed.assignedTo, claimer.id);

  // 与 lead-service 同一 buildLeadScopeWhere 语义（决策 6）：SELF 范围只贡献 assignedTo 谓词，
  // 公海线索 assignedTo=null 永不命中 → SELF-only 用户 fail-closed 404
  // （公海领取的制度路径是 BRANCH/ORG 范围，与 Task 5 forward 修订一致）。
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const other = await seedLead({ branchId: branch.id, name: '另一条公海' });
  const selfScoped = serviceFor(userId, actor, { employeeId: claimer.id, scopeIds: [selfScope.id] });
  await assert.rejects(() => selfScoped.claimFromPool(other.id), hasCode(LEAD_NOT_FOUND));
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: other.id } })).poolStatus, 'PUBLIC');
});

test('SELF scope sees own private leads for assign/recycle (same buildLeadScopeWhere semantics as lead-service)', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('本人');
  const delegate = await createEmployeeFixture('同事');
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  // 决策 6：assign/recycle 与 lead-service 同范围语义，SELF 分量锚定 assignedTo ——
  // 本人持有的私海线索在 SELF 范围内可见，可改派/回收。
  const mine = await seedLead({
    poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: new Date(), status: 'ASSIGNED',
  });
  const mineToo = await seedLead({
    poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: new Date(), status: 'ASSIGNED',
  });
  const scoped = serviceFor(userId, actor, { employeeId: owner.id, scopeIds: [selfScope.id] });

  const reassigned = await scoped.assign(mine.id, delegate.id, 'SELF 范围内改派');
  assert.equal(reassigned.assignedTo, delegate.id);

  // 改派后 assignedTo 已易主，超出 SELF 范围；回收用另一条本人持有的线索。
  const recycled = await scoped.recycle(mineToo.id, 'SELF 范围内回收');
  assert.equal(recycled.poolStatus, 'RECYCLED');
  assert.equal(recycled.assignedTo, null);

  const records = await prisma.leadPoolRecord.findMany({
    where: { leadId: { in: [mine.id, mineToo.id] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  assert.deepEqual(records.map(record => record.action), ['REASSIGN', 'RECYCLE']);
});

test('assign moves a pool lead to a private owner with an ASSIGN record and events', async () => {
  const { userId, actor } = await createActor();
  const target = await createEmployeeFixture('被分配人');
  const lead = await seedLead({ status: 'NEW' });
  const denied = serviceFor(userId, actor, {
    permissionCodes: ['lead.read', 'lead.pool.claim', 'lead.recycle'],
  });
  await assert.rejects(() => denied.assign(lead.id, target.id), hasCode('PERMISSION_DENIED'));

  const service = serviceFor(userId, actor);
  const view = await service.assign(lead.id, target.id, '首分');

  assert.equal(view.poolStatus, 'PRIVATE');
  assert.equal(view.assignedTo, target.id);
  assert.ok(view.assignedAt, 'assign must write assignedAt');
  assert.equal(view.version, 2);
  assert.equal(view.status, 'ASSIGNED', 'NEW lead is promoted to ASSIGNED on assign');

  const record = await prisma.leadPoolRecord.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.equal(record.action, 'ASSIGN');
  assert.equal(record.fromEmployeeId, null);
  assert.equal(record.toEmployeeId, target.id);
  assert.equal(record.reason, '首分');
  assert.equal(record.operatedBy, userId);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.assigned', objectId: lead.id },
  });
  assert.deepEqual(event.payload, {
    leadId: lead.id,
    action: 'ASSIGN',
    fromEmployeeId: null,
    toEmployeeId: target.id,
  });
  const statusEvent = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.status_changed', objectId: lead.id },
  });
  assert.deepEqual(statusEvent.payload, {
    leadId: lead.id,
    fromStatus: 'NEW',
    toStatus: 'ASSIGNED',
  });
});

test('assign on a private lead reassigns ownership with a REASSIGN record naming the previous owner', async () => {
  const { userId, actor } = await createActor();
  const oldOwner = await createEmployeeFixture('原负责人');
  const newOwner = await createEmployeeFixture('新负责人');
  const previousAssignedAt = new Date('2026-07-01T08:00:00Z');
  const lead = await seedLead({
    poolStatus: 'PRIVATE',
    assignedTo: oldOwner.id,
    assignedAt: previousAssignedAt,
    status: 'ASSIGNED',
  });
  const service = serviceFor(userId, actor);

  const view = await service.assign(lead.id, newOwner.id, '改派');

  assert.equal(view.poolStatus, 'PRIVATE');
  assert.equal(view.assignedTo, newOwner.id);
  const assignedAt = view.assignedAt;
  assert.ok(assignedAt, 'reassign must write assignedAt');
  assert.ok(assignedAt.getTime() > previousAssignedAt.getTime(), 'reassign must refresh assignedAt');
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.status, 'ASSIGNED', 'reassign must not move a non-NEW status');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.status_changed', objectId: lead.id } }),
    0,
  );

  const record = await prisma.leadPoolRecord.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.equal(record.action, 'REASSIGN');
  assert.equal(record.fromEmployeeId, oldOwner.id);
  assert.equal(record.toEmployeeId, newOwner.id);
  assert.equal(record.reason, '改派');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.assigned', objectId: lead.id },
  });
  assert.deepEqual(event.payload, {
    leadId: lead.id,
    action: 'REASSIGN',
    fromEmployeeId: oldOwner.id,
    toEmployeeId: newOwner.id,
  });
});

test('assign rejects an unknown target employee without touching the lead', async () => {
  const { userId, actor } = await createActor();
  const lead = await seedLead();
  const service = serviceFor(userId, actor);

  await assert.rejects(() => service.assign(lead.id, randomUUID()), hasCode('VALIDATION_FAILED'));

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.poolStatus, 'PUBLIC');
  assert.equal(stored.version, 1);
  assert.equal(await prisma.leadPoolRecord.count(), 0);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.assigned' } }), 0);
});

test('assign and recycle hide out-of-branch leads with LEAD_NOT_FOUND', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_HOME');
  const other = await createOrganizationFixture('BRANCH_AWAY');
  const owner = await createEmployeeInOrg(other.id, '外所持有人');
  const target = await createEmployeeInOrg(branch.id, '本所员工');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const outLead = await seedLead({
    branchId: other.id,
    name: '外所私海',
    poolStatus: 'PRIVATE',
    assignedTo: owner.id,
    assignedAt: new Date(),
  });

  const scoped = serviceFor(userId, actor, { scopeIds: [branchScope.id] });
  await assert.rejects(() => scoped.assign(outLead.id, target.id), hasCode(LEAD_NOT_FOUND));
  await assert.rejects(() => scoped.recycle(outLead.id), hasCode(LEAD_NOT_FOUND));

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: outLead.id } });
  assert.equal(stored.assignedTo, owner.id);
  assert.equal(stored.poolStatus, 'PRIVATE');
  assert.equal(await prisma.leadPoolRecord.count(), 0);
});

test('recycle returns a private lead to the pool, clears ownership and keeps the status', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('负责人');
  const lead = await seedLead({
    poolStatus: 'PRIVATE',
    assignedTo: owner.id,
    assignedAt: new Date('2026-07-20T08:00:00Z'),
    status: 'CONTACTED',
  });
  const denied = serviceFor(userId, actor, {
    permissionCodes: ['lead.read', 'lead.pool.claim', 'lead.assign'],
  });
  await assert.rejects(() => denied.recycle(lead.id), hasCode('PERMISSION_DENIED'));

  const service = serviceFor(userId, actor);
  const view = await service.recycle(lead.id, '超时未跟进');

  assert.equal(view.poolStatus, 'RECYCLED');
  assert.equal(view.assignedTo, null);
  assert.equal(view.assignedAt, null, 'recycle must clear assignedAt');
  assert.equal(view.status, 'CONTACTED', 'recycle must not move the status state machine');

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.poolStatus, 'RECYCLED');
  assert.equal(stored.assignedTo, null);
  assert.equal(stored.assignedAt, null);
  assert.equal(stored.status, 'CONTACTED');

  const record = await prisma.leadPoolRecord.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.equal(record.action, 'RECYCLE');
  assert.equal(record.fromEmployeeId, owner.id);
  assert.equal(record.toEmployeeId, null);
  assert.equal(record.reason, '超时未跟进');
  assert.equal(record.operatedBy, userId);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.assigned', objectId: lead.id },
  });
  assert.deepEqual(event.payload, {
    leadId: lead.id,
    action: 'RECYCLE',
    fromEmployeeId: owner.id,
    toEmployeeId: null,
  });
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.status_changed', objectId: lead.id } }),
    0,
  );
});

test('recycle rejects leads that are not privately held', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const publicLead = await seedLead({ name: '公海' });
  const recycledLead = await seedLead({ name: '已回收', poolStatus: 'RECYCLED' });

  for (const lead of [publicLead, recycledLead]) {
    await assert.rejects(
      () => service.recycle(lead.id),
      error => error instanceof CrmError
        && error.code === LEAD_STATE_TRANSITION_INVALID
        && error.httpStatus === 409,
    );
  }
  assert.equal(await prisma.leadPoolRecord.count(), 0);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.assigned' } }), 0);
});

test('LeadPoolRecord is append-only across claim, reassign and recycle; operation audits carry no phone plaintext', async () => {
  const { userId, actor } = await createActor();
  const claimer = await createEmployeeFixture('领取人');
  const second = await createEmployeeFixture('第二负责人');
  const lead = await seedLead();

  await serviceFor(userId, actor, { employeeId: claimer.id }).claimFromPool(lead.id);
  const service = serviceFor(userId, actor);
  await service.assign(lead.id, second.id, '改派');
  await service.recycle(lead.id, '回收');

  const records = await prisma.leadPoolRecord.findMany({
    where: { leadId: lead.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  assert.deepEqual(records.map(record => record.action), ['CLAIM', 'REASSIGN', 'RECYCLE']);
  assert.equal(records[0].fromEmployeeId, null);
  assert.equal(records[0].toEmployeeId, claimer.id);
  assert.equal(records[1].fromEmployeeId, claimer.id);
  assert.equal(records[1].toEmployeeId, second.id);
  assert.equal(records[2].fromEmployeeId, second.id);
  assert.equal(records[2].toEmployeeId, null);
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.assigned', objectId: lead.id } }),
    3,
  );

  const audits = await prisma.operationLog.findMany({
    where: { targetType: 'LEAD', targetId: lead.id, action: { startsWith: 'LEAD_' } },
  });
  assert.equal(audits.length, 3, 'every pool mutation writes an OperationLog audit');
  for (const audit of audits) {
    assert.equal(audit.userId, userId);
    assert.equal(
      (audit.newValues ?? '').includes('13700009999'),
      false,
      'audit must not contain phone plaintext',
    );
  }
});

test('concurrent claims have exactly one winner and the loser gets a conflict error', async () => {
  const first = await createActor();
  const second = await createActor();
  const employeeA = await createEmployeeFixture('领取人A');
  const employeeB = await createEmployeeFixture('领取人B');
  const lead = await seedLead();
  const serviceA = serviceFor(first.userId, first.actor, { employeeId: employeeA.id });
  const serviceB = serviceFor(second.userId, second.actor, { employeeId: employeeB.id });

  const results = await Promise.allSettled([
    serviceA.claimFromPool(lead.id),
    serviceB.claimFromPool(lead.id),
  ]);

  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one claim may win');
  assert.equal(rejected.length, 1, 'the losing claim must fail, never silently overwrite');
  const loserCode = (rejected[0].reason as { code?: string }).code;
  assert.ok(
    loserCode === 'VERSION_CONFLICT' || loserCode === LEAD_NOT_IN_POOL,
    `loser must get a conflict-class error, got ${String(loserCode)}`,
  );

  const winner = fulfilled[0].value;
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.poolStatus, 'PRIVATE');
  assert.equal(stored.assignedTo, winner.assignedTo);
  assert.equal(stored.version, 2, 'exactly one ownership change may commit');
  assert.equal(await prisma.leadPoolRecord.count({ where: { leadId: lead.id } }), 1);
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.assigned', objectId: lead.id } }),
    1,
  );
});

test('recycleOverdueLeads recycles only stale PRIVATE leads in NEW or ASSIGNED status', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('负责人');
  const stale = new Date(Date.now() - 48 * 3_600_000);
  const recent = new Date(Date.now() - 1 * 3_600_000);
  const staleNew = await seedLead({
    name: '逾期NEW', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: stale,
    status: 'NEW', updatedAt: stale,
  });
  const staleAssigned = await seedLead({
    name: '逾期ASSIGNED', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: stale,
    status: 'ASSIGNED', updatedAt: stale,
  });
  const staleContacted = await seedLead({
    name: '逾期CONTACTED', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: stale,
    status: 'CONTACTED', updatedAt: stale,
  });
  const recentNew = await seedLead({
    name: '新近', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: recent,
    status: 'NEW', updatedAt: recent,
  });
  const publicStale = await seedLead({ name: '公海', poolStatus: 'PUBLIC', status: 'NEW', updatedAt: stale });
  const recycledStale = await seedLead({ name: '已回收', poolStatus: 'RECYCLED', status: 'NEW', updatedAt: stale });
  // 内部方法：无权限上下文也必须可执行（调用方是 Task 9 的系统扫描器，不做动作权限校验）。
  const service = serviceFor(userId, actor, { permissionCodes: [] });

  const summary = await service.recycleOverdueLeads(24);

  assert.equal(summary.recycledCount, 2);
  assert.deepEqual(summary.leadIds.slice().sort(), [staleNew.id, staleAssigned.id].sort());

  for (const [recycled, expectedStatus] of [[staleNew, 'NEW'], [staleAssigned, 'ASSIGNED']] as const) {
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: recycled.id } });
    assert.equal(stored.poolStatus, 'RECYCLED');
    assert.equal(stored.assignedTo, null);
    assert.equal(stored.assignedAt, null);
    assert.equal(stored.status, expectedStatus, 'recycle must not move the status state machine');
  }
  for (const untouched of [staleContacted, recentNew, publicStale, recycledStale]) {
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: untouched.id } });
    assert.equal(stored.poolStatus, untouched.poolStatus);
    assert.equal(stored.assignedTo, untouched.assignedTo);
  }

  const records = await prisma.leadPoolRecord.findMany({ where: { action: 'RECYCLE' } });
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.fromEmployeeId, owner.id);
    assert.equal(record.toEmployeeId, null);
    assert.equal(record.reason, 'AUTO_RECYCLE:NO_FOLLOW_24H');
    assert.equal(record.operatedBy, userId);
  }
  const events = await prisma.eventLog.findMany({ where: { eventType: 'lead.assigned' } });
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.deepEqual(event.payload, {
      leadId: event.objectId,
      action: 'RECYCLE',
      fromEmployeeId: owner.id,
      toEmployeeId: null,
    });
  }
});

test('recycleOverdueLeads does not recycle a lead whose updatedAt is exactly at the threshold', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('负责人');
  const lead = await seedLead({
    poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: new Date('2026-07-01T00:00:00.000Z'),
    status: 'NEW', updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  });
  const service = serviceFor(userId, actor);

  // 边界语义：updatedAt < now - hours 为严格小于；恰在阈值上不回收。
  // 基准取**回读后的存储值**（裸 SQL 覆写 updatedAt 在会话时区下可能发生偏移，
  // 用库存值计算 now 可抵消偏移，保证边界断言确定）。
  const storedUpdatedAt = lead.updatedAt;
  const atThreshold = await service.recycleOverdueLeads(
    24,
    new Date(storedUpdatedAt.getTime() + 24 * 3_600_000),
  );
  assert.equal(atThreshold.recycledCount, 0);
  assert.deepEqual(atThreshold.leadIds, []);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).poolStatus, 'PRIVATE');

  const pastThreshold = await service.recycleOverdueLeads(
    24,
    new Date(storedUpdatedAt.getTime() + 24 * 3_600_000 + 1),
  );
  assert.equal(pastThreshold.recycledCount, 1);
  assert.deepEqual(pastThreshold.leadIds, [lead.id]);
});

test('recycleOverdueLeads continues the batch when an individual lead fails', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('负责人');
  const older = new Date(Date.now() - 72 * 3_600_000);
  const newer = new Date(Date.now() - 48 * 3_600_000);
  // branchId 非 uuid：事件信封写入 EventLog（branchId 真 FK / uuid 校验）让该条事务确定性失败，
  // 可证明单行失败后批处理继续且该行整体回滚。
  const bad = await seedLead({
    name: '坏数据', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: older,
    status: 'NEW', branchId: 'not-a-uuid', updatedAt: older,
  });
  const good = await seedLead({
    name: '正常', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: newer,
    status: 'NEW', updatedAt: newer,
  });
  const service = serviceFor(userId, actor);

  // 修复轮决策 7：单行失败必须可观测——捕获 console.error 钩子并断言带出失败 leadId。
  const logged: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => {
    logged.push(values.map(value => String(value)).join(' '));
  };
  let summary;
  try {
    summary = await service.recycleOverdueLeads(24);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(summary.recycledCount, 1);
  assert.deepEqual(summary.leadIds, [good.id]);
  assert.equal(logged.length, 1, 'the failing row must be logged');
  assert.ok(logged[0].includes(bad.id), 'the log line must name the failed leadId');
  const badStored = await prisma.lead.findUniqueOrThrow({ where: { id: bad.id } });
  assert.equal(badStored.poolStatus, 'PRIVATE', 'failed lead must stay PRIVATE (its transaction rolled back)');
  assert.equal(badStored.assignedTo, owner.id);
  assert.equal(await prisma.leadPoolRecord.count({ where: { leadId: bad.id } }), 0);
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.assigned', objectId: bad.id } }),
    0,
  );
  const goodStored = await prisma.lead.findUniqueOrThrow({ where: { id: good.id } });
  assert.equal(goodStored.poolStatus, 'RECYCLED');
  assert.equal(await prisma.leadPoolRecord.count({ where: { leadId: good.id } }), 1);
});

test('recycleOverdueLeads rejects a non-positive or non-integer hour window', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);

  await assert.rejects(() => service.recycleOverdueLeads(0), hasCode('VALIDATION_FAILED'));
  await assert.rejects(() => service.recycleOverdueLeads(-2), hasCode('VALIDATION_FAILED'));
  await assert.rejects(() => service.recycleOverdueLeads(1.5), hasCode('VALIDATION_FAILED'));
});

test('pool operation views mask L3 fields and audit raw reads with the operation purpose', async () => {
  const { userId, actor } = await createActor();
  const claimer = await createEmployeeFixture('领取人');
  const masked = await seedLead({
    name: '脱敏线索', phone: '13800001234', phoneHash: hashPhone('13800001234'), wechat: 'wx-pool-001',
  });

  const maskedView = await serviceFor(userId, actor, { employeeId: claimer.id }).claimFromPool(masked.id);
  assert.equal(maskedView.phone, '138****1234');
  assert.equal(maskedView.wechat, '***');
  assert.equal(await prisma.operationLog.count({ where: { action: 'READ_L3_FIELDS' } }), 0);

  const readRules: AuthorizationContext['fieldRules'] = [{
    sourceRoleId: 'test-role',
    resource: 'lead',
    fieldCode: 'lead.phone',
    readLevel: 'READ',
    canWrite: true,
    canExport: false,
  }];
  const reader = serviceFor(userId, actor, { employeeId: claimer.id, fieldRules: readRules });
  const readable = await seedLead({
    name: '明文线索', phone: '13900008888', phoneHash: hashPhone('13900008888'), wechat: 'wx-pool-002',
  });
  const rawView = await reader.claimFromPool(readable.id);
  assert.equal(rawView.phone, '13900008888');
  assert.equal(rawView.wechat, '***', 'wechat stays masked without its own READ rule');

  const claimAudit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'READ_L3_FIELDS', targetType: 'LEAD', targetId: readable.id },
  });
  assert.equal(claimAudit.userId, userId);
  assert.match(claimAudit.newValues ?? '', /lead\.phone/);
  assert.match(claimAudit.newValues ?? '', /lead\.claim/);
  assert.doesNotMatch(claimAudit.newValues ?? '', /13900008888/);

  // recycle 返回视图同样脱敏 + 按操作 purpose 审计。
  const recycledView = await reader.recycle(readable.id);
  assert.equal(recycledView.phone, '13900008888');
  const audits = await prisma.operationLog.findMany({
    where: { action: 'READ_L3_FIELDS', targetType: 'LEAD', targetId: readable.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  assert.equal(audits.length, 2);
  assert.match(audits[1].newValues ?? '', /lead\.recycle/);
  assert.doesNotMatch(audits[1].newValues ?? '', /13900008888/);
});

test('claimFromPool rolls back the ownership change and pool record when the event write fails', async () => {
  const { userId, actor } = await createActor();
  const claimer = await createEmployeeFixture('领取人');
  const failingOutbox: EventOutboxWriter = {
    append: () => Promise.reject(new Error('injected outbox failure')),
  };
  const service = new LeadAssignmentService(
    prisma,
    actor,
    crmContext(userId, { employeeId: claimer.id }),
    failingOutbox,
  );
  const lead = await seedLead();

  await assert.rejects(() => service.claimFromPool(lead.id), /injected outbox failure/);

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.poolStatus, 'PUBLIC', 'lead must be rolled back');
  assert.equal(stored.version, 1);
  assert.equal(stored.assignedTo, null);
  assert.equal(await prisma.leadPoolRecord.count(), 0, 'pool record must be rolled back');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.assigned' } }),
    0,
    'event must be rolled back',
  );
});
