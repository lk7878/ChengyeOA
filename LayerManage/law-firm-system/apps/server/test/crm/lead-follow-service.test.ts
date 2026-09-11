import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';

import { LeadFollowService } from '../../app/application/crm/lead-follow-service';
import { EventOutboxWriter } from '../../app/application/events/event-outbox-writer';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { CrmError, LEAD_NOT_FOUND } from '../../app/domain/crm/lead-errors';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-009 Task 7: lead-follow-service 契约测试（跟进记录 + 首响时长计量）。
// 绑定决策（2026-07-29 dispatch coordinator decisions）：
//   1. recordFollow=lead.update、listFollows=lead.read；范围校验用同权限码 buildLeadScopeWhere，
//      不可见 → LEAD_NOT_FOUND(404) 不泄露存在性。
//   2. type ∈ PHONE|WECHAT|VISIT|ONLINE|OTHER（否则 400 VALIDATION_FAILED）；content 必填非空；
//      createdBy=actor 标识（同 lead-service 的 actorUserId）；创建时 updatedBy=null。
//   3. 首响计量（设计 §6.4）：同事务内 lead.firstResponseSeconds IS NULL 时，
//      锚点 = assignedAt ?? createdAt，秒数 = max(0, floor((follow.createdAt - 锚点)/1000))，
//      经 version 乐观锁 updateMany 写回 Lead；计量一经写入绝不重算。
//   4. 状态推进（设计 §6.3 步骤 3）：status=ASSIGNED 且 canTransition → 同次写回推进 CONTACTED
//      并同事务发 lead.status_changed v1；NEW 不推进（NEW→CONTACTED 不在流转表）但仍计量；
//      其余 status 不动。
//      决策 4 修订（2026-07-29 用户裁定）：计量（shouldMeter）与推进（shouldPromote）解耦为
//      两个独立标志——即使计量早已完成（如公海 NEW 阶段首跟），首个见到 ASSIGNED 的跟进
//      仍推进 CONTACTED 并发事件；原"第二条起 Lead 行完全不动"仅对"已计量且非 ASSIGNED"
//      成立。仅计量的写回不发任何事件。
//   5. 每次创建写 OperationLog(LEAD_FOLLOW_CREATE)，只落安全字段（leadId/followId/type），
//      绝不落 content/nextPlan 自由文本。
//   6. listFollows 按 createdAt DESC 返回视图 {id,leadId,type,content,nextPlan,nextTime,createdBy,createdAt}。
//   7. 并发双首跟：仅一方赢得 firstResponseSeconds 写回（version 锁），败方仍落自己的 LeadFollow。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-follow-service.test.ts

let prisma: PrismaClient;

const FOLLOW_PERMISSIONS: PermissionCode[] = [
  'lead.read',
  'lead.update',
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
  const permissionCodes = overrides.permissionCodes ?? FOLLOW_PERMISSIONS;
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
    data: { username: `follow.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function serviceFor(userId: string, actor: AuditActor, overrides: ContextOverrides = {}): LeadFollowService {
  return new LeadFollowService(prisma, actor, crmContext(userId, overrides));
}

async function seedLead(data: Partial<Prisma.LeadUncheckedCreateInput> = {}) {
  const id = randomUUID();
  return prisma.lead.create({
    data: {
      id,
      leadNo: `L-SEED-${id}`,
      name: '种子线索',
      phone: '13700009999',
      phoneHash: hashPhone('13700009999'),
      status: 'NEW',
      poolStatus: 'PUBLIC',
      createdBy: 'seed',
      ...data,
    },
  });
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

test('recordFollow creates the follow with validated fields and returns the view contract', async () => {
  const { userId, actor } = await createActor();
  const lead = await seedLead();
  const nextTime = new Date('2026-08-01T09:30:00.000Z');
  const service = serviceFor(userId, actor);

  const view = await service.recordFollow(lead.id, {
    type: 'PHONE',
    content: '首次电话沟通，客户有意向',
    nextPlan: '三天后回访',
    nextTime,
  });

  assert.deepEqual(
    Object.keys(view).sort(),
    ['content', 'createdAt', 'createdBy', 'id', 'leadId', 'nextPlan', 'nextTime', 'type'],
    'LeadFollowView exposes exactly the contracted keys (no updatedBy on create view)',
  );
  assert.equal(view.leadId, lead.id);
  assert.equal(view.type, 'PHONE');
  assert.equal(view.content, '首次电话沟通，客户有意向');
  assert.equal(view.nextPlan, '三天后回访');
  assert.deepEqual(view.nextTime, nextTime);
  assert.equal(view.createdBy, userId, 'createdBy is the actor identifier (same as lead-service)');
  assert.ok(view.createdAt instanceof Date);

  const stored = await prisma.leadFollow.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.createdBy, userId);
  assert.equal(stored.updatedBy, null, 'updatedBy stays null on create (schema Minor-2 回补列)');
  assert.equal(stored.type, 'PHONE');
  assert.equal(stored.content, '首次电话沟通，客户有意向');
});

test('recordFollow rejects an unknown type, empty content, extra keys or a bad nextTime without persisting', async () => {
  const { userId, actor } = await createActor();
  const lead = await seedLead();
  const service = serviceFor(userId, actor);

  await assert.rejects(
    () => service.recordFollow(lead.id, { type: 'SMS' as never, content: 'x' }),
    hasCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => service.recordFollow(lead.id, { type: 'phone' as never, content: 'x' }),
    hasCode('VALIDATION_FAILED'),
    'type is case-sensitive against the enumeration',
  );
  await assert.rejects(
    () => service.recordFollow(lead.id, { type: 'PHONE', content: '' }),
    hasCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => service.recordFollow(lead.id, { type: 'PHONE', content: '   ' }),
    hasCode('VALIDATION_FAILED'),
    'whitespace-only content is empty after trim',
  );
  await assert.rejects(
    () => service.recordFollow(lead.id, { type: 'PHONE', content: 'x', bogus: 1 } as never),
    hasCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => service.recordFollow(lead.id, { type: 'PHONE', content: 'x', nextTime: 'not-a-date' as never }),
    hasCode('VALIDATION_FAILED'),
  );
  await assert.rejects(
    () => service.recordFollow(lead.id, { type: 'PHONE', content: 'x', nextTime: new Date('invalid') }),
    hasCode('VALIDATION_FAILED'),
  );

  assert.equal(await prisma.leadFollow.count(), 0, 'no follow row may persist on validation failure');
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).version, 1);
});

test('recordFollow requires lead.update and listFollows requires lead.read as the first statement', async () => {
  const { userId, actor } = await createActor();
  const lead = await seedLead();

  const noUpdate = serviceFor(userId, actor, { permissionCodes: ['lead.read'] });
  await assert.rejects(
    () => noUpdate.recordFollow(lead.id, { type: 'PHONE', content: 'x' }),
    hasCode('PERMISSION_DENIED'),
  );

  const noRead = serviceFor(userId, actor, { permissionCodes: ['lead.update'] });
  await assert.rejects(() => noRead.listFollows(lead.id), hasCode('PERMISSION_DENIED'));

  assert.equal(await prisma.leadFollow.count(), 0);
});

test('first follow meters firstResponseSeconds from assignedAt and promotes ASSIGNED to CONTACTED with the event', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_FOLLOW');
  const owner = await createEmployeeInOrg(branch.id, '客服');
  const assignedAt = new Date(Date.now() - 3600_000);
  const lead = await seedLead({
    branchId: branch.id,
    status: 'ASSIGNED',
    poolStatus: 'PRIVATE',
    assignedTo: owner.id,
    assignedAt,
  });
  const service = serviceFor(userId, actor);

  const view = await service.recordFollow(lead.id, { type: 'WECHAT', content: '微信首次触达' });
  assert.ok(view.id);

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.ok(stored.firstResponseSeconds !== null, 'first follow must meter firstResponseSeconds');
  assert.ok(
    Math.abs(stored.firstResponseSeconds - 3600) <= 30,
    `anchor must be assignedAt (~3600s), got ${String(stored.firstResponseSeconds)}`,
  );
  assert.equal(stored.status, 'CONTACTED', 'ASSIGNED lead is promoted to CONTACTED on first follow');
  assert.equal(stored.version, 2, 'one version-locked write-back');
  assert.equal(stored.updatedBy, userId);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.status_changed', objectId: lead.id },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.objectType, 'LEAD');
  assert.equal(event.sourceModule, 'CRM');
  assert.equal(event.operatorUserId, userId);
  assert.equal(event.branchId, branch.id, 'envelope keeps the lead branch pass-through');
  assert.deepEqual(event.payload, {
    leadId: lead.id,
    fromStatus: 'ASSIGNED',
    toStatus: 'CONTACTED',
  });
});

test('first follow on a NEW lead without assignedAt anchors on createdAt, still meters, but never promotes', async () => {
  const { userId, actor } = await createActor();
  const createdAt = new Date(Date.now() - 7200_000);
  const lead = await seedLead({ status: 'NEW', assignedAt: null, createdAt });
  const service = serviceFor(userId, actor);

  await service.recordFollow(lead.id, { type: 'PHONE', content: '公海线索直接外呼' });

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.ok(stored.firstResponseSeconds !== null);
  assert.ok(
    Math.abs(stored.firstResponseSeconds - 7200) <= 30,
    `anchor must fall back to createdAt (~7200s), got ${String(stored.firstResponseSeconds)}`,
  );
  assert.equal(stored.status, 'NEW', 'NEW -> CONTACTED is not in the transition table: no promotion');
  assert.equal(stored.version, 2, 'metering write-back still happens');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.status_changed', objectId: lead.id } }),
    0,
  );
});

test('firstResponseSeconds is clamped to zero when the anchor is in the future', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('客服');
  const lead = await seedLead({
    status: 'ASSIGNED',
    poolStatus: 'PRIVATE',
    assignedTo: owner.id,
    assignedAt: new Date(Date.now() + 3600_000),
  });
  const service = serviceFor(userId, actor);

  await service.recordFollow(lead.id, { type: 'VISIT', content: '上门拜访' });

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.firstResponseSeconds, 0, '首响时长为非负（时钟回拨/未来锚点兜底）');
});

test('the second follow never recomputes firstResponseSeconds and leaves the Lead row untouched', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('客服');
  // 决策 4 修订（2026-07-29）：本测试意图是"计量绝不重算、第二跟起 Lead 行不动"，与状态
  // 推进无关——fixture 用 CONTACTED（已度过 ASSIGNED 阶段），使两条跟进都是纯计量语义；
  // 若保持 ASSIGNED，跟进 #1 会按修订语义推进状态并发事件，混入无关覆盖。
  const lead = await seedLead({
    status: 'CONTACTED',
    poolStatus: 'PRIVATE',
    assignedTo: owner.id,
    assignedAt: new Date(Date.now() - 1800_000),
  });
  const service = serviceFor(userId, actor);

  await service.recordFollow(lead.id, { type: 'PHONE', content: '首跟' });
  const afterFirst = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(afterFirst.status, 'CONTACTED');
  assert.equal(afterFirst.version, 2, 'follow #1 still performs the metering write-back');
  const metered = afterFirst.firstResponseSeconds;
  assert.ok(metered !== null);

  await service.recordFollow(lead.id, { type: 'ONLINE', content: '二跟，发资料' });

  const afterSecond = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(afterSecond.firstResponseSeconds, metered, 'second follow must not recompute');
  assert.equal(afterSecond.version, afterFirst.version, 'second follow must not touch the Lead row');
  assert.equal(afterSecond.status, 'CONTACTED');
  assert.equal(afterSecond.updatedAt.getTime(), afterFirst.updatedAt.getTime(), 'Lead row untouched');
  assert.equal(await prisma.leadFollow.count({ where: { leadId: lead.id } }), 2);
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.status_changed', objectId: lead.id } }),
    0,
    'CONTACTED fixture never promotes: metering-only write-back emits nothing',
  );
});

test('a lead that already has firstResponseSeconds is never re-metered', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('客服');
  const lead = await seedLead({
    status: 'CONTACTED',
    poolStatus: 'PRIVATE',
    assignedTo: owner.id,
    assignedAt: new Date(Date.now() - 86_400_000),
    firstResponseSeconds: 42,
  });
  const service = serviceFor(userId, actor);

  await service.recordFollow(lead.id, { type: 'OTHER', content: '补充跟进' });

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.firstResponseSeconds, 42);
  assert.equal(stored.version, 1, 'Lead row untouched when metering already exists');
  assert.equal(stored.status, 'CONTACTED');
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.status_changed' } }), 0);
});

test('a lead metered while NEW is still promoted to CONTACTED by the first follow after being claimed (决策 4 修订)', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('客服');
  const createdAt = new Date(Date.now() - 7200_000);
  const lead = await seedLead({ status: 'NEW', poolStatus: 'PUBLIC', assignedAt: null, createdAt });
  const service = serviceFor(userId, actor);

  // 跟进 #1：公海 NEW 首跟——计量（锚点回退 createdAt），不推进、不发事件。
  await service.recordFollow(lead.id, { type: 'PHONE', content: '公海首跟外呼' });
  const afterFirst = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(afterFirst.status, 'NEW', 'NEW -> CONTACTED is not in the transition table');
  assert.ok(afterFirst.firstResponseSeconds !== null);
  assert.ok(
    Math.abs(afterFirst.firstResponseSeconds - 7200) <= 30,
    `follow #1 must meter against createdAt (~7200s), got ${String(afterFirst.firstResponseSeconds)}`,
  );
  assert.equal(afterFirst.version, 2);
  const metered = afterFirst.firstResponseSeconds;
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.status_changed', objectId: lead.id } }),
    0,
    'metering-only write-back emits nothing',
  );

  // 认领：NEW -> ASSIGNED（轻量路径：直接 prisma 更新，与本文件既有 fixture 同风格；
  // 不经 assignment-service，避免引入被测链路外的事件/审计噪音）。
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: 'ASSIGNED',
      poolStatus: 'PRIVATE',
      assignedTo: owner.id,
      assignedAt: new Date(),
    },
  });

  // 跟进 #2（修订核心场景）：计量早已完成，但首个见到 ASSIGNED 的跟进仍推进 CONTACTED。
  await service.recordFollow(lead.id, { type: 'WECHAT', content: '认领后首跟' });

  const afterSecond = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(afterSecond.status, 'CONTACTED', 'first follow seen at ASSIGNED still promotes');
  assert.equal(
    afterSecond.firstResponseSeconds,
    metered,
    'metering is never recomputed once set (re-anchoring to assignedAt would give ~0s)',
  );
  assert.equal(afterSecond.version, 3, 'follow #2 performs exactly one version-locked write-back');
  assert.equal(await prisma.leadFollow.count({ where: { leadId: lead.id } }), 2);

  const events = await prisma.eventLog.findMany({
    where: { eventType: 'lead.status_changed', objectId: lead.id },
  });
  assert.equal(events.length, 1, 'exactly one promotion event across both follows');
  assert.deepEqual(events[0].payload, {
    leadId: lead.id,
    fromStatus: 'ASSIGNED',
    toStatus: 'CONTACTED',
  });
});

test('recordFollow and listFollows hide missing or out-of-scope leads with LEAD_NOT_FOUND', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  await assert.rejects(
    () => service.recordFollow(randomUUID(), { type: 'PHONE', content: 'x' }),
    error => error instanceof CrmError && error.code === LEAD_NOT_FOUND && error.httpStatus === 404,
  );
  await assert.rejects(() => service.listFollows(randomUUID()), hasCode(LEAD_NOT_FOUND));

  const branch = await createOrganizationFixture('BRANCH_VISIBLE');
  const other = await createOrganizationFixture('BRANCH_HIDDEN');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const hidden = await seedLead({ branchId: other.id, name: '外所线索' });
  const scoped = serviceFor(userId, actor, { scopeIds: [branchScope.id] });

  await assert.rejects(
    () => scoped.recordFollow(hidden.id, { type: 'PHONE', content: 'x' }),
    hasCode(LEAD_NOT_FOUND),
  );
  await assert.rejects(() => scoped.listFollows(hidden.id), hasCode(LEAD_NOT_FOUND));

  assert.equal(await prisma.leadFollow.count(), 0, 'out-of-scope follow must not persist');
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: hidden.id } })).version, 1);
});

test('listFollows returns follows in createdAt DESC order with the view contract', async () => {
  const { userId, actor } = await createActor();
  const lead = await seedLead();
  const base = new Date('2026-07-28T08:00:00.000Z');
  for (const [index, offsetHours] of [[0, 0], [1, 1], [2, 2]] as const) {
    await prisma.leadFollow.create({
      data: {
        leadId: lead.id,
        type: 'PHONE',
        content: `跟进-${index}`,
        createdBy: 'seed',
        createdAt: new Date(base.getTime() + offsetHours * 3_600_000),
      },
    });
  }
  const service = serviceFor(userId, actor);

  const views = await service.listFollows(lead.id);

  assert.equal(views.length, 3);
  assert.deepEqual(views.map(view => view.content), ['跟进-2', '跟进-1', '跟进-0']);
  for (const view of views) {
    assert.deepEqual(
      Object.keys(view).sort(),
      ['content', 'createdAt', 'createdBy', 'id', 'leadId', 'nextPlan', 'nextTime', 'type'],
    );
    assert.equal(view.leadId, lead.id);
    assert.equal(view.createdBy, 'seed');
  }
  // LeadFollow 无 L3 字段：content 明文可见，不产生 READ_L3_FIELDS 审计。
  assert.equal(await prisma.operationLog.count({ where: { action: 'READ_L3_FIELDS' } }), 0);
});

test('every follow create writes a LEAD_FOLLOW_CREATE audit with safe fields only', async () => {
  const { userId, actor } = await createActor();
  const lead = await seedLead();
  const service = serviceFor(userId, actor);

  const view = await service.recordFollow(lead.id, {
    type: 'ONLINE',
    content: 'SECRET-CONTENT-XYZ',
    nextPlan: 'SECRET-PLAN-XYZ',
  });

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'LEAD_FOLLOW_CREATE', targetType: 'LEAD', targetId: lead.id },
  });
  assert.equal(audit.userId, userId);
  const values = audit.newValues ?? '';
  assert.match(values, new RegExp(lead.id), 'audit carries leadId');
  assert.match(values, new RegExp(view.id), 'audit carries followId');
  assert.match(values, /ONLINE/, 'audit carries the follow type');
  assert.doesNotMatch(values, /SECRET-CONTENT-XYZ/, 'audit must never carry content free text');
  assert.doesNotMatch(values, /SECRET-PLAN-XYZ/, 'audit must never carry nextPlan free text');
});

test('two concurrent first follows both persist but exactly one wins the metering write-back', async () => {
  const first = await createActor();
  const second = await createActor();
  const owner = await createEmployeeFixture('客服');
  const lead = await seedLead({
    status: 'ASSIGNED',
    poolStatus: 'PRIVATE',
    assignedTo: owner.id,
    assignedAt: new Date(Date.now() - 1800_000),
  });

  const results = await Promise.allSettled([
    serviceFor(first.userId, first.actor).recordFollow(lead.id, { type: 'PHONE', content: '并发跟进A' }),
    serviceFor(second.userId, second.actor).recordFollow(lead.id, { type: 'WECHAT', content: '并发跟进B' }),
  ]);

  const fulfilled = results.filter(result => result.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, 'the loser still commits its own LeadFollow row');

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.version, 2, 'exactly one version-locked metering write-back may commit');
  assert.ok(stored.firstResponseSeconds !== null, 'firstResponseSeconds is metered exactly once');
  assert.ok(stored.firstResponseSeconds >= 0);
  assert.equal(stored.status, 'CONTACTED');
  assert.equal(await prisma.leadFollow.count({ where: { leadId: lead.id } }), 2);
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.status_changed', objectId: lead.id } }),
    1,
    'only the winner emits the status promotion event',
  );
});

test('two concurrent follows on an already-metered ASSIGNED lead both persist but exactly one promotion event fires', async () => {
  const first = await createActor();
  const second = await createActor();
  const owner = await createEmployeeFixture('客服');
  const lead = await seedLead({
    status: 'ASSIGNED',
    poolStatus: 'PRIVATE',
    assignedTo: owner.id,
    assignedAt: new Date(Date.now() - 1800_000),
    firstResponseSeconds: 42,
  });

  const results = await Promise.allSettled([
    serviceFor(first.userId, first.actor).recordFollow(lead.id, { type: 'PHONE', content: '并发跟进A' }),
    serviceFor(second.userId, second.actor).recordFollow(lead.id, { type: 'WECHAT', content: '并发跟进B' }),
  ]);

  const fulfilled = results.filter(result => result.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, 'the loser still commits its own LeadFollow row');

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.status, 'CONTACTED');
  assert.equal(stored.firstResponseSeconds, 42, 'metering is never recomputed once set');
  assert.equal(stored.version, 2, 'exactly one version-locked promotion write-back may commit');
  assert.equal(await prisma.leadFollow.count({ where: { leadId: lead.id } }), 2);
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'lead.status_changed', objectId: lead.id } }),
    1,
    'only the version-lock winner emits the promotion event',
  );
});

test('recordFollow rolls back the follow and the metering when the status event write fails', async () => {
  const { userId, actor } = await createActor();
  const owner = await createEmployeeFixture('客服');
  const lead = await seedLead({
    status: 'ASSIGNED',
    poolStatus: 'PRIVATE',
    assignedTo: owner.id,
    assignedAt: new Date(Date.now() - 600_000),
  });
  const failingOutbox: EventOutboxWriter = {
    append: () => Promise.reject(new Error('injected outbox failure')),
  };
  const service = new LeadFollowService(prisma, actor, crmContext(userId), failingOutbox);

  await assert.rejects(
    () => service.recordFollow(lead.id, { type: 'PHONE', content: '会触发状态推进的首跟' }),
    /injected outbox failure/,
  );

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.version, 1, 'lead write-back must be rolled back');
  assert.equal(stored.status, 'ASSIGNED');
  assert.equal(stored.firstResponseSeconds, null);
  assert.equal(await prisma.leadFollow.count(), 0, 'follow row must be rolled back');
  assert.equal(await prisma.operationLog.count({ where: { action: 'LEAD_FOLLOW_CREATE' } }), 0);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.status_changed' } }), 0);
});
