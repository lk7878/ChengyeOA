import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';

import { LeadService } from '../../app/application/crm/lead-service';
import { CreateLeadInput } from '../../app/application/crm/lead-types';
import { EventOutboxWriter } from '../../app/application/events/event-outbox-writer';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  CrmError,
  CUSTOMER_ALREADY_CONVERTED,
  LEAD_NOT_FOUND,
  LEAD_STATE_TRANSITION_INVALID,
} from '../../app/domain/crm/lead-errors';
import { hashPhone, normalizePhone } from '../../app/domain/crm/lead-policy';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-009 Task 5: lead-service 契约测试（录入/去重提示/幂等/状态流转/转客户/数据范围/字段脱敏）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-service.test.ts

let prisma: PrismaClient;

const CRM_PERMISSIONS: PermissionCode[] = [
  'channel.read',
  'lead.read',
  'lead.create',
  'lead.update',
  'lead.convert',
  'customer.read',
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
  return (error) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

interface ContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
  fieldRules?: AuthorizationContext['fieldRules'];
}

function crmContext(userId: string, overrides: ContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? CRM_PERMISSIONS;
  const scopeIds = overrides.scopeIds ?? ['ALL'];
  return {
    userId,
    employeeId: overrides.employeeId ?? null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: permissionCodes.map((permissionCode) => ({
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
    data: { username: `lead.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function serviceFor(userId: string, actor: AuditActor, overrides: ContextOverrides = {}): LeadService {
  return new LeadService(prisma, actor, crmContext(userId, overrides));
}

function leadInput(overrides: Partial<CreateLeadInput> = {}): CreateLeadInput {
  return {
    name: '张三',
    phone: '13800001234',
    sourceType: 'MANUAL',
    ...overrides,
  };
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

test('createLead persists the lead with a generated leadNo and writes lead.created in one transaction', async () => {
  const { userId, actor } = await createActor();
  const channel = await prisma.channel.create({
    data: { code: `CH_${randomUUID()}`, name: '搜索渠道', type: 'SEARCH' },
  });
  const service = serviceFor(userId, actor);

  const { lead, duplicates } = await service.createLead(leadInput({ channelId: channel.id }));

  assert.equal(duplicates.length, 0);
  assert.ok(lead.id);
  // leadNo 格式（设计 §10）：L + yyMMdd + '-' + 6 位随机字母数字。
  assert.match(lead.leadNo, /^L\d{6}-[0-9A-Z]{6}$/);
  assert.equal(lead.status, 'NEW');
  assert.equal(lead.poolStatus, 'PUBLIC');
  assert.equal(lead.channelId, channel.id);

  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.phoneHash, hashPhone(normalizePhone('13800001234')));
  assert.equal(stored.createdBy, userId);
  assert.equal(stored.channelId, channel.id);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'LEAD', objectId: lead.id },
  });
  assert.equal(event.eventType, 'lead.created');
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CRM');
  assert.equal(event.operatorUserId, userId);
  assert.deepEqual(event.payload, {
    leadId: lead.id,
    status: 'NEW',
    poolStatus: 'PUBLIC',
    channelId: channel.id,
  });
});

test('createLead returns non-blocking duplicate signals without leaking plaintext phone', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const first = await service.createLead(leadInput({ name: '李四', phone: '13800001234' }));

  const second = await service.createLead(leadInput({ name: '李四', phone: '+86 138-0000-1234' }));

  assert.notEqual(second.lead.id, first.lead.id, 'duplicate hints must not block creation');
  assert.ok(
    second.duplicates.some((signal) => signal.leadId === first.lead.id && signal.type === 'PHONE'),
    'expected a PHONE duplicate signal for the first lead',
  );
  assert.ok(
    second.duplicates.some((signal) => signal.leadId === first.lead.id && signal.type === 'NAME'),
    'expected a NAME duplicate signal for the first lead',
  );
  assert.equal(JSON.stringify(second.duplicates).includes('13800001234'), false);
  assert.equal(JSON.stringify(second.duplicates).includes('李四'), false);
});

test('createLead with a repeated idempotencyKey returns the first lead and writes no duplicate event', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const idempotencyKey = `idem-${randomUUID()}`;

  const first = await service.createLead(leadInput(), idempotencyKey);
  const second = await service.createLead(leadInput(), idempotencyKey);

  assert.equal(second.lead.id, first.lead.id);
  assert.equal(second.lead.leadNo, first.lead.leadNo);
  assert.equal(await prisma.lead.count(), 1);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.created' } }), 1);
});

test('createLead idempotency is backed by phoneHash + createdBy, not process memory', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  // 模拟"首次请求已落库但进程状态丢失"（重启/多实例）：库里已有同电话、同创建人的线索，
  // 服务内不存在任何内存记录。带 idempotencyKey 的重试必须命中已有记录而不是新建。
  const seeded = await seedLead({
    name: '张三',
    phone: '13800001234',
    phoneHash: hashPhone(normalizePhone('13800001234')),
    createdBy: userId,
  });

  const replay = await service.createLead(leadInput(), `idem-${randomUUID()}`);

  assert.equal(replay.lead.id, seeded.id);
  assert.deepEqual(replay.duplicates, []);
  assert.equal(await prisma.lead.count(), 1);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.created' } }), 0);
});

test('createLead requires the lead.create action permission', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor, { permissionCodes: ['lead.read'] });

  await assert.rejects(() => service.createLead(leadInput()), hasCode('PERMISSION_DENIED'));
  assert.equal(await prisma.lead.count(), 0);
});

test('transitionStatus allows NEW to ASSIGNED and writes lead.status_changed', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const { lead } = await service.createLead(leadInput());

  const updated = await service.transitionStatus(lead.id, 'ASSIGNED', '分配给客服跟进');

  assert.equal(updated.status, 'ASSIGNED');
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.status, 'ASSIGNED');
  assert.equal(stored.version, 2);
  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'lead.status_changed', objectId: lead.id },
  });
  assert.deepEqual(event.payload, {
    leadId: lead.id,
    fromStatus: 'NEW',
    toStatus: 'ASSIGNED',
  });
});

test('transitionStatus rejects NEW to VISITED with LEAD_STATE_TRANSITION_INVALID', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const { lead } = await service.createLead(leadInput());

  await assert.rejects(
    () => service.transitionStatus(lead.id, 'VISITED', '跳级流转'),
    (error) =>
      error instanceof CrmError && error.code === LEAD_STATE_TRANSITION_INVALID && error.httpStatus === 409,
  );
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.status, 'NEW');
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.status_changed' } }), 0);
});

test('transitionStatus gates NURTURE transitions while REACTIVATE_ENABLED is false', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lost = await seedLead({ status: 'LOST' });
  const nurtured = await seedLead({ status: 'NURTURE', name: '沉淀线索' });

  // canTransition 状态机本身允许 LOST→NURTURE 与 NURTURE→CONTACTED；
  // service 必须先检查 REACTIVATE_ENABLED，false 时一律拒绝。
  await assert.rejects(
    () => service.transitionStatus(lost.id, 'NURTURE', '进入二次营销池'),
    hasCode(LEAD_STATE_TRANSITION_INVALID),
  );
  await assert.rejects(
    () => service.transitionStatus(nurtured.id, 'CONTACTED', '唤醒线索'),
    hasCode(LEAD_STATE_TRANSITION_INVALID),
  );
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lost.id } })).status, 'LOST');
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: nurtured.id } })).status, 'NURTURE');
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.status_changed' } }), 0);
});

test('convertToCustomer creates Customer + Contact + CONVERTED + customer.created atomically', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'VISITED' });

  const customer = await service.convertToCustomer(
    lead.id,
    { name: '王五', phone: '13900001111', customerType: 'INDIVIDUAL' },
    { name: '王五', phone: '13900001111', relation: '本人', isPrimary: true },
  );

  assert.ok(customer.id);
  // customerNo 与 leadNo 同规则：C + yyMMdd + '-' + 6 位随机字母数字。
  assert.match(customer.customerNo, /^C\d{6}-[0-9A-Z]{6}$/);
  assert.equal(customer.sourceLeadId, lead.id);
  assert.equal(customer.status, 'POTENTIAL');

  const storedCustomer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  assert.equal(storedCustomer.phoneHash, hashPhone(normalizePhone('13900001111')));
  assert.equal(storedCustomer.createdBy, userId);

  const contact = await prisma.contact.findFirstOrThrow({ where: { customerId: customer.id } });
  assert.equal(contact.isPrimary, true);
  assert.equal(contact.phoneHash, hashPhone(normalizePhone('13900001111')));

  const storedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(storedLead.status, 'CONVERTED');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { eventType: 'customer.created', objectType: 'CUSTOMER', objectId: customer.id },
  });
  assert.equal(event.sourceModule, 'CRM');
  assert.equal(event.operatorUserId, userId);
  assert.deepEqual(event.payload, {
    customerId: customer.id,
    sourceLeadId: lead.id,
    status: 'POTENTIAL',
  });
});

test('convertToCustomer rejects a lead that is already CONVERTED', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'VISITED' });
  await service.convertToCustomer(
    lead.id,
    { name: '王五', phone: '13900001111' },
    { name: '王五', phone: '13900001111' },
  );

  await assert.rejects(
    () =>
      service.convertToCustomer(
        lead.id,
        { name: '王五', phone: '13900001111' },
        { name: '王五', phone: '13900001111' },
      ),
    (error) =>
      error instanceof CrmError && error.code === CUSTOMER_ALREADY_CONVERTED && error.httpStatus === 409,
  );
  assert.equal(await prisma.customer.count(), 1);
});

test('convertToCustomer with an idempotencyKey returns the existing customer for an already-converted lead', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const lead = await seedLead({ status: 'VISITED' });
  // 首次转客户不带 key（进程内无任何幂等记录），模拟重试方只持有 idempotencyKey。
  const first = await service.convertToCustomer(
    lead.id,
    { name: '王五', phone: '13900001111' },
    { name: '王五', phone: '13900001111' },
  );

  const replay = await service.convertToCustomer(
    lead.id,
    { name: '王五', phone: '13900001111' },
    { name: '王五', phone: '13900001111' },
    `idem-${randomUUID()}`,
  );

  assert.equal(replay.id, first.id);
  assert.equal(replay.customerNo, first.customerNo);
  assert.equal(await prisma.customer.count(), 1);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'customer.created' } }), 1);
});

test('convertToCustomer rolls back the whole transaction when the event write fails', async () => {
  const { userId, actor } = await createActor();
  const failingOutbox: EventOutboxWriter = {
    append: () => Promise.reject(new Error('injected outbox failure')),
  };
  const service = new LeadService(prisma, actor, crmContext(userId), failingOutbox);
  const lead = await seedLead({ status: 'VISITED' });

  await assert.rejects(
    () =>
      service.convertToCustomer(
        lead.id,
        { name: '王五', phone: '13900001111' },
        { name: '王五', phone: '13900001111' },
      ),
    /injected outbox failure/,
  );

  assert.equal(await prisma.customer.count(), 0, 'customer must be rolled back');
  assert.equal(await prisma.contact.count(), 0, 'contact must be rolled back');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'customer.created' } }),
    0,
    'event must be rolled back',
  );
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'VISITED');
});

test('listLeads and getLead enforce the SELF data scope without leaking existence', async () => {
  const { userId, actor } = await createActor();
  const employeeA = await createEmployeeFixture('客服A');
  const employeeB = await createEmployeeFixture('客服B');
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const mine = await seedLead({ name: '我的线索', assignedTo: employeeA.id, poolStatus: 'PRIVATE' });
  const others = await seedLead({ name: '他人线索', assignedTo: employeeB.id, poolStatus: 'PRIVATE' });

  const scoped = serviceFor(userId, actor, {
    employeeId: employeeA.id,
    scopeIds: [selfScope.id],
  });

  const page = await scoped.listLeads({});
  assert.deepEqual(
    page.list.map((item) => item.id),
    [mine.id],
  );
  assert.equal(page.total, 1);

  const fetched = await scoped.getLead(mine.id);
  assert.equal(fetched.id, mine.id);

  await assert.rejects(
    () => scoped.getLead(others.id),
    (error) => error instanceof CrmError && error.code === LEAD_NOT_FOUND && error.httpStatus === 404,
  );
});

test('BRANCH scope anchors on Lead.branchId: unassigned in-branch leads stay visible (public pool)', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const branchChild = await createOrganizationFixture('BRANCH_CHILD', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所客服');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  // 公海未分配线索：assignedTo=null，但 branchId 落在范围内（含子机构子树）必须可见。
  const unassignedInBranch = await seedLead({ name: '分所公海线索', branchId: branch.id });
  const unassignedInChild = await seedLead({ name: '子机构公海线索', branchId: branchChild.id });
  const unassignedOut = await seedLead({ name: '外所公海线索', branchId: other.id });

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });

  const page = await scoped.listLeads({});
  assert.deepEqual(
    page.list.map((item) => item.id).sort(),
    [unassignedInBranch.id, unassignedInChild.id].sort(),
  );
  assert.equal(page.total, 2);
  await assert.rejects(() => scoped.getLead(unassignedOut.id), hasCode(LEAD_NOT_FOUND));
});

test('BRANCH scope does not expose out-of-branch leads even when assigned to the viewer', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所客服');
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  // 负责人是本人但 branchId 在范围外：用户只持有 BRANCH 授权（无 SELF）→ 不可见。
  const mineOutOfBranch = await seedLead({
    name: '我的外所线索',
    assignedTo: clerk.id,
    branchId: other.id,
    poolStatus: 'PRIVATE',
  });
  const inBranch = await seedLead({ name: '分所线索', branchId: branch.id });

  const scoped = serviceFor(userId, actor, { employeeId: clerk.id, scopeIds: [branchScope.id] });

  const page = await scoped.listLeads({});
  assert.deepEqual(
    page.list.map((item) => item.id),
    [inBranch.id],
  );
  assert.equal(page.total, 1);
  await assert.rejects(() => scoped.getLead(mineOutOfBranch.id), hasCode(LEAD_NOT_FOUND));
});

test('TEAM scope anchors on Lead.professionalTeamId regardless of assignee', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const team = await prisma.professionalTeam.create({
    data: {
      code: `TEAM_${randomUUID()}`,
      name: '刑辩团队',
      categoryCode: 'OTHER',
      homeOrganizationId: branch.id,
    },
  });
  const otherTeam = await prisma.professionalTeam.create({
    data: {
      code: `TEAM_${randomUUID()}`,
      name: '民商团队',
      categoryCode: 'OTHER',
      homeOrganizationId: branch.id,
    },
  });
  const teamScope = await prisma.dataScope.create({
    data: { name: `team-${randomUUID()}`, scopeType: 'TEAM', professionalTeamId: team.id },
  });
  const inTeam = await seedLead({ name: '团队线索', professionalTeamId: team.id });
  const inOtherTeam = await seedLead({ name: '他团队线索', professionalTeamId: otherTeam.id });

  const scoped = serviceFor(userId, actor, { scopeIds: [teamScope.id] });

  const page = await scoped.listLeads({});
  assert.deepEqual(
    page.list.map((item) => item.id),
    [inTeam.id],
  );
  assert.equal(page.total, 1);
  await assert.rejects(() => scoped.getLead(inOtherTeam.id), hasCode(LEAD_NOT_FOUND));
});

test('SELF and BRANCH scopes union: own assigned leads plus all in-branch leads', async () => {
  const { userId, actor } = await createActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN');
  const other = await createOrganizationFixture('BRANCH_OTHER');
  const clerk = await createEmployeeInOrg(branch.id, '分所客服');
  const colleague = await createEmployeeInOrg(branch.id, '同事');
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });

  const mineOutOfBranch = await seedLead({
    name: '我的外所线索',
    assignedTo: clerk.id,
    branchId: other.id,
    poolStatus: 'PRIVATE',
  });
  const colleagueInBranch = await seedLead({
    name: '同事分所线索',
    assignedTo: colleague.id,
    branchId: branch.id,
    poolStatus: 'PRIVATE',
  });
  const unassignedInBranch = await seedLead({ name: '分所公海', branchId: branch.id });
  const outOfBoth = await seedLead({
    name: '外所他人线索',
    assignedTo: colleague.id,
    branchId: other.id,
    poolStatus: 'PRIVATE',
  });

  const scoped = serviceFor(userId, actor, {
    employeeId: clerk.id,
    scopeIds: [selfScope.id, branchScope.id],
  });

  const page = await scoped.listLeads({});
  assert.deepEqual(
    page.list.map((item) => item.id).sort(),
    [mineOutOfBranch.id, colleagueInBranch.id, unassignedInBranch.id].sort(),
  );
  assert.equal(page.total, 3);
  await assert.rejects(() => scoped.getLead(outOfBoth.id), hasCode(LEAD_NOT_FOUND));
});

test('lead projection masks phone and wechat without L3 READ field permission', async () => {
  const { userId, actor } = await createActor();
  const { lead } = await serviceFor(userId, actor).createLead(
    leadInput({ phone: '13800001234', wechat: 'wx-lead-001' }),
  );

  const masked = await serviceFor(userId, actor).getLead(lead.id);
  assert.equal(masked.phone, '138****1234');
  assert.equal(masked.wechat, '***');

  const readable = await serviceFor(userId, actor, {
    fieldRules: [
      {
        sourceRoleId: 'test-role',
        resource: 'lead',
        fieldCode: 'lead.phone',
        readLevel: 'READ',
        canWrite: true,
        canExport: false,
      },
    ],
  }).getLead(lead.id);
  assert.equal(readable.phone, '13800001234');
  assert.equal(readable.wechat, '***', 'wechat stays masked without its own READ rule');
});

test('getLead writes READ_L3_FIELDS authorization audit only when raw L3 phone is disclosed', async () => {
  const { userId, actor } = await createActor();
  const { lead } = await serviceFor(userId, actor).createLead(leadInput());

  // 脱敏输出不触发 L3 明文审计。
  await serviceFor(userId, actor).getLead(lead.id);
  assert.equal(await prisma.operationLog.count({ where: { action: 'READ_L3_FIELDS' } }), 0);

  const reader = serviceFor(userId, actor, {
    fieldRules: [
      {
        sourceRoleId: 'test-role',
        resource: 'lead',
        fieldCode: 'lead.phone',
        readLevel: 'READ',
        canWrite: true,
        canExport: false,
      },
    ],
  });
  const view = await reader.getLead(lead.id);
  assert.equal(view.phone, '13800001234');

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'READ_L3_FIELDS', targetType: 'LEAD', targetId: lead.id },
  });
  assert.equal(audit.userId, userId);
  assert.match(audit.newValues ?? '', /lead\.phone/);
  assert.doesNotMatch(audit.newValues ?? '', /13800001234/);
});

test('createLead and convertToCustomer write OperationLog audit without phone or wechat plaintext', async () => {
  const { userId, actor } = await createActor();
  const service = serviceFor(userId, actor);
  const { lead } = await service.createLead(leadInput({ wechat: 'wx-secret-001' }));

  const createAudit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'LEAD', targetId: lead.id, action: 'LEAD_CREATE' },
  });
  assert.equal(createAudit.userId, userId);
  assert.equal((createAudit.newValues ?? '').includes('13800001234'), false);
  assert.equal((createAudit.newValues ?? '').includes('wx-secret-001'), false);

  const visited = await seedLead({ status: 'VISITED' });
  const customer = await service.convertToCustomer(
    visited.id,
    { name: '王五', phone: '13900001111', wechat: 'wx-cust-002' },
    { name: '王五', phone: '13900001111' },
  );
  const convertAudit = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CUSTOMER', targetId: customer.id, action: 'LEAD_CONVERT_TO_CUSTOMER' },
  });
  assert.equal(convertAudit.userId, userId);
  assert.equal((convertAudit.newValues ?? '').includes('13900001111'), false);
  assert.equal((convertAudit.newValues ?? '').includes('wx-cust-002'), false);
});
