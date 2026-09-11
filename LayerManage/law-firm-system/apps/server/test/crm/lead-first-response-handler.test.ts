import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';

import { LeadRecycleScanner } from '../../app/application/crm/lead-recycle-scanner';
import {
  ClaimedEventDelivery,
  EventHandlerContext,
  EventHandlerInvocationError,
} from '../../app/application/events/event-delivery-store';
import { EventHandlerRegistry } from '../../app/application/events/event-handler-registry';
import { EventHealthService } from '../../app/application/events/event-health-service';
import { PrismaEventOutboxWriter } from '../../app/application/events/event-outbox-writer';
import {
  createEventServices,
  EventServices,
} from '../../app/application/events/event-services-factory';
import { EventWorker } from '../../app/application/events/event-worker';
import {
  LeadFirstResponseHandler,
  LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE,
} from '../../app/application/events/handlers/lead-first-response-handler';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { PermanentEventError } from '../../app/domain/events/event-errors';
import { LeadAssignedV1 } from '../../app/domain/events/event-types';
import { EventWorkerEnvironment } from '../../config/env';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-009 Task 9: 首响 pilot handler + LeadRecycleScanner 契约测试（R-2：两类测试同文件）。
// 绑定裁定（2026-07-29 dispatch coordinator decisions，覆盖 brief 字面歧义）：
//   R-1：扫描器委托 lead-assignment-service.recycleOverdueLeads 原样候选规则
//     （PRIVATE + status IN (NEW,ASSIGNED) + updatedAt < now - noFollowHours 严格小于），
//     **不得附加 firstResponseSeconds IS NULL 谓词**。「已首响不回收」是涌现不变量
//     （首个跟进要么推进 status 出 NEW/ASSIGNED，要么刷新 updatedAt，首响线索自然退出候选集），
//     而非外加条件：公海计量后被认领、认领后闲置的线索必须随认领后 N 小时回收（认领刷新
//     updatedAt），否则形成死线索漏洞（2026-07-29 M-1 用户裁定）。本文件用两个测试钉住：
//     「已计量 + updatedAt 新鲜 → 不回收」与「已计量 + ASSIGNED + updatedAt 停滞 → 回收」。
//   R-3：pilot handler 订阅 lead.assigned v1，仅做最小消费（解析纪律同
//     admin-operation-reviewed-notification-handler：parseEventPayload + handlerCode/eventType/
//     eventVersion/orderingKey 校验，不匹配 → PermanentEventError），不写业务表、不回收、不通知；
//     正常消费 → 投递 SUCCEEDED。safeSummary 只含标量 { leadId, action }。
//   系统 actor：模块级常量 { actorUserId: 'system' }，落在无外键的审计列（Lead.updatedBy /
//     LeadPoolRecord.operatedBy / OperationLog.userId）；EventLog.operatorUserId 有真 FK
//     （event_log_operatorUserId_fkey → user.id）且信封校验要求 UUID，故扫描器经 outbox 包装
//     将系统 actor 的事件 operatorUserId 落 null（系统来源事件无人为操作者，schema/信封均合法）。
//   隔离纪律（设计 §6.5）：LeadRecycleScanner 不是 EventHandler，由 EventWorker 的可选
//     tickListener 驱动；listener 抛错仅记日志（[lead-recycle-scanner] 前缀）绝不影响投递循环，
//     单条投递失败（已记录）也不得阻止 listener 执行。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/crm/lead-first-response-handler.test.ts

const EVENT_CONFIG: EventWorkerEnvironment = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});
const SCAN_NOW = new Date('2026-07-29T12:00:00.000Z');
const STALE = new Date(SCAN_NOW.getTime() - 48 * 3_600_000);
const FRESH = new Date(SCAN_NOW.getTime() - 1 * 3_600_000);

let prisma: PrismaClient;

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

/** 主客户端的事件服务图：不传 leadRecycle（无 listener），handler 路径与扫描器路径互不干扰。 */
function eventServices(): EventServices {
  return createEventServices(prisma, EVENT_CONFIG);
}

async function seedLead(
  data: Partial<Prisma.LeadUncheckedCreateInput> = {},
  client: PrismaClient = prisma,
) {
  const id = randomUUID();
  const { updatedAt, ...rest } = data;
  const lead = await client.lead.create({
    data: {
      id,
      leadNo: `L-T9-${id}`,
      name: '首响线索',
      phone: '13700001111',
      phoneHash: hashPhone('13700001111'),
      status: 'NEW',
      poolStatus: 'PUBLIC',
      createdBy: 'seed',
      ...rest,
    },
  });
  if (updatedAt) {
    // updatedAt 由 @updatedAt 自动维护；测试需要精确控制"最近跟进时间"，用裸 SQL 覆写。
    await client.$executeRaw`UPDATE "lead" SET "updatedAt" = ${updatedAt} WHERE "id" = ${id}`;
    return client.lead.findUniqueOrThrow({ where: { id } });
  }
  return lead;
}

async function createEmployeeFixture(code: string, client: PrismaClient = prisma) {
  const orgId = randomUUID();
  await client.organization.create({
    data: { id: orgId, code: `ORG_${orgId}`, name: code, type: 'BRANCH', path: `/${orgId}` },
  });
  const position = await client.position.create({
    data: {
      organizationId: orgId,
      code: `POS_${randomUUID()}`,
      name: `${code} position`,
      categoryCode: 'STAFF',
    },
  });
  return client.employee.create({
    data: {
      employeeNo: `EMP_${randomUUID()}`,
      name: code,
      phone: `1${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      type: 'SALES',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
      assignments: {
        create: {
          organizationId: orgId,
          positionId: position.id,
          assignmentType: 'PRIMARY',
          startedAt: new Date('2025-01-01'),
        },
      },
    },
  });
}

function handlerContext(
  payload: LeadAssignedV1,
  overrides: Partial<EventHandlerContext> & { payload?: unknown } = {},
): EventHandlerContext {
  return {
    deliveryId: randomUUID(),
    eventId: randomUUID(),
    handlerCode: LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE,
    orderingKey: createHash('sha256').update(`LEAD:${payload.leadId}`, 'utf8').digest('hex'),
    eventType: 'lead.assigned',
    eventVersion: 1,
    payload: payload as unknown as Prisma.JsonValue,
    traceId: `lead-first-response-test-${randomUUID()}`,
    attemptNumber: 1,
    workerId: 'lead-first-response-test-worker',
    ...overrides,
  };
}

function stubClaim(overrides: Partial<ClaimedEventDelivery> = {}): ClaimedEventDelivery {
  return {
    deliveryId: randomUUID(),
    eventId: randomUUID(),
    subscriptionId: 'subscription:lead-first-response-monitor-v1',
    handlerCode: LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE,
    orderingKey: 'a'.repeat(64),
    eventType: 'lead.assigned',
    eventVersion: 1,
    payload: {} as Prisma.JsonValue,
    traceId: `tick-listener-test-${randomUUID()}`,
    attemptNumber: 1,
    manualRetryCount: 0,
    version: 1,
    workerId: 'tick-listener-test-worker',
    startedAt: new Date(),
    lockedUntil: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function pilotRegistry(): EventHandlerRegistry {
  const registry = new EventHandlerRegistry();
  registry.register({
    handlerCode: LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE,
    eventType: 'lead.assigned',
    eventVersion: 1,
    handler: { handle: async () => undefined },
  });
  return registry;
}

test('a lead.assigned event flows through dispatcher and worker to a SUCCEEDED pilot delivery with scalar safeSummary', async () => {
  const owner = await createEmployeeFixture('负责人');
  const lead = await seedLead({
    poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: new Date(), status: 'ASSIGNED',
  });
  const payload: LeadAssignedV1 = {
    leadId: lead.id, action: 'ASSIGN', fromEmployeeId: null, toEmployeeId: owner.id,
  };
  const outbox = new PrismaEventOutboxWriter();
  await prisma.$transaction(async tx => {
    await outbox.append(tx, {
      eventType: 'lead.assigned',
      eventVersion: 1,
      objectType: 'LEAD',
      objectId: lead.id,
      operatorUserId: null,
      organizationId: null,
      branchId: null,
      teamId: null,
      payload,
      traceId: `lead-first-response-e2e-${randomUUID()}`,
      occurredAt: new Date(),
    });
  });

  const events = eventServices();
  assert.deepEqual(await events.worker.tick(), {
    dispatched: 1, claimed: 1, succeeded: 1, retryScheduled: 0, manual: 0, leaseLost: 0,
  });

  const delivery = await prisma.eventDelivery.findFirstOrThrow();
  assert.equal(delivery.handlerCode, LEAD_FIRST_RESPONSE_MONITOR_HANDLER_CODE);
  assert.equal(delivery.subscriptionId, 'subscription:lead-first-response-monitor-v1');
  assert.equal(delivery.status, 'SUCCEEDED');
  const log = await prisma.eventHandlerLog.findFirstOrThrow();
  assert.equal(log.outcome, 'SUCCEEDED');
  assert.equal(log.deliveryId, delivery.id);

  // R-3：pilot handler 不写业务表——Lead/LeadPoolRecord/Notification 全部不动。
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).version, 1);
  assert.equal(await prisma.leadPoolRecord.count(), 0);
  assert.equal(await prisma.leadFollow.count(), 0);
  assert.equal(await prisma.notification.count(), 0);
  assert.equal(await prisma.eventLog.count(), 1, 'only the seeded event exists');

  // safeSummary：严格两键 { leadId, action }，全标量。
  const summary = events.registry.safeSummary('lead.assigned', 1, payload);
  assert.deepEqual(summary, { leadId: lead.id, action: 'ASSIGN' });
  for (const value of Object.values(summary)) {
    assert.equal(typeof value, 'string', 'safeSummary carries scalars only');
  }

  // 投递成功后重复 tick 幂等：无新投递、无新处理。
  assert.deepEqual(await events.worker.tick(), {
    dispatched: 0, claimed: 0, succeeded: 0, retryScheduled: 0, manual: 0, leaseLost: 0,
  });
});

test('handler consumes a valid lead.assigned context and writes nothing', async () => {
  const owner = await createEmployeeFixture('负责人');
  const lead = await seedLead({
    poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: new Date(), status: 'ASSIGNED',
  });
  const payload: LeadAssignedV1 = {
    leadId: lead.id, action: 'CLAIM', fromEmployeeId: null, toEmployeeId: owner.id,
  };

  const handler = new LeadFirstResponseHandler();
  await prisma.$transaction(tx => handler.handle(tx, handlerContext(payload)));

  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).version, 1);
  assert.equal(await prisma.leadPoolRecord.count(), 0);
  assert.equal(await prisma.leadFollow.count(), 0);
  assert.equal(await prisma.notification.count(), 0);
  assert.equal(await prisma.eventLog.count(), 0);
});

test('handler maps every context or payload mismatch to a permanent safe error', async () => {
  const owner = await createEmployeeFixture('负责人');
  const lead = await seedLead({
    poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: new Date(), status: 'ASSIGNED',
  });
  const payload: LeadAssignedV1 = {
    leadId: lead.id, action: 'ASSIGN', fromEmployeeId: null, toEmployeeId: owner.id,
  };
  const base = handlerContext(payload);
  const handler = new LeadFirstResponseHandler();
  const cases: EventHandlerContext[] = [
    { ...base, handlerCode: 'OTHER_HANDLER' },
    { ...base, eventType: 'lead.status_changed' },
    { ...base, eventVersion: 2 },
    { ...base, orderingKey: 'f'.repeat(64) },
    { ...base, payload: { ...(payload as object), comment: 'private note' } as Prisma.JsonValue },
    { ...base, payload: { ...(payload as object), leadId: 'not-a-uuid' } as Prisma.JsonValue },
    { ...base, payload: { ...(payload as object), action: 'DELETE' } as Prisma.JsonValue },
  ];

  for (const invalid of cases) {
    await assert.rejects(
      prisma.$transaction(tx => handler.handle(tx, invalid)),
      (error: unknown) => error instanceof PermanentEventError
        && error.code === 'LEAD_FIRST_RESPONSE_SOURCE_INVALID'
        && error.message === 'LEAD_FIRST_RESPONSE_SOURCE_INVALID',
    );
  }
  assert.equal(await prisma.leadPoolRecord.count(), 0);
  assert.equal(await prisma.notification.count(), 0);
  assert.equal(await prisma.eventLog.count(), 0);
});

test('scanOnce recycles overdue unfollowed private leads with pool record, RECYCLE event and audit', async () => {
  const owner = await createEmployeeFixture('负责人');
  const staleNew = await seedLead({
    name: '逾期NEW', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: STALE,
    status: 'NEW', updatedAt: STALE,
  });
  const staleAssigned = await seedLead({
    name: '逾期ASSIGNED', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: STALE,
    status: 'ASSIGNED', updatedAt: STALE,
  });
  const staleContacted = await seedLead({
    name: '逾期CONTACTED', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: STALE,
    status: 'CONTACTED', updatedAt: STALE,
  });
  const freshPrivate = await seedLead({
    name: '新近', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: FRESH,
    status: 'ASSIGNED', updatedAt: FRESH,
  });
  const stalePublic = await seedLead({
    name: '公海', poolStatus: 'PUBLIC', status: 'NEW', updatedAt: STALE,
  });

  const scanner = new LeadRecycleScanner(
    prisma,
    { enabled: true, noFollowHours: 24 },
    new PrismaEventOutboxWriter(),
  );
  const recycled = await scanner.scanOnce(SCAN_NOW);

  assert.equal(recycled, 2);
  for (const [recycledLead, expectedStatus] of [[staleNew, 'NEW'], [staleAssigned, 'ASSIGNED']] as const) {
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: recycledLead.id } });
    assert.equal(stored.poolStatus, 'RECYCLED');
    assert.equal(stored.assignedTo, null);
    assert.equal(stored.assignedAt, null);
    assert.equal(stored.status, expectedStatus, 'recycle must not move the status state machine');
    assert.equal(stored.updatedBy, 'system', 'the module-level system actor stamps Lead.updatedBy');
  }
  for (const untouched of [staleContacted, freshPrivate, stalePublic]) {
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
    assert.equal(record.operatedBy, 'system', 'the system actor stamps LeadPoolRecord.operatedBy');
  }

  const events = await prisma.eventLog.findMany({ where: { eventType: 'lead.assigned' } });
  assert.equal(events.length, 2);
  for (const event of events) {
    // 系统来源事件：operatorUserId 落 null（EventLog.operatorUserId 有真 FK 且信封校验要求 UUID，
    // 系统 actor 'system' 不可直接写入）；审计归因由 operatedBy/updatedBy/userId 的 'system' 承担。
    assert.equal(event.operatorUserId, null, 'system-originated events carry no human operator');
    assert.equal(event.sourceModule, 'CRM');
    assert.deepEqual(event.payload, {
      leadId: event.objectId,
      action: 'RECYCLE',
      fromEmployeeId: owner.id,
      toEmployeeId: null,
    });
  }

  const audits = await prisma.operationLog.findMany({
    where: { action: 'LEAD_RECYCLE', targetType: 'LEAD' },
  });
  assert.equal(audits.length, 2);
  for (const audit of audits) {
    assert.equal(audit.userId, 'system', 'the system actor stamps OperationLog.userId');
  }
});

test('scanOnce does not recycle a lead whose updatedAt is exactly at the threshold', async () => {
  const owner = await createEmployeeFixture('负责人');
  const lead = await seedLead({
    poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: new Date('2026-07-01T00:00:00.000Z'),
    status: 'NEW', updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  });
  const scanner = new LeadRecycleScanner(
    prisma,
    { enabled: true, noFollowHours: 24 },
    new PrismaEventOutboxWriter(),
  );

  // 边界语义：updatedAt < now - hours 严格小于，恰在阈值上不回收。
  // 基准取回读后的存储值（裸 SQL 覆写可能有时区偏移，用库存值计算 now 抵消偏移）。
  const storedUpdatedAt = lead.updatedAt;
  assert.equal(await scanner.scanOnce(new Date(storedUpdatedAt.getTime() + 24 * 3_600_000)), 0);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).poolStatus, 'PRIVATE');
  assert.equal(await scanner.scanOnce(new Date(storedUpdatedAt.getTime() + 24 * 3_600_000 + 1)), 1);
});

test('scanOnce does not recycle a first-response-metered lead whose updatedAt is fresh (R-1)', async () => {
  const owner = await createEmployeeFixture('负责人');
  const lead = await seedLead({
    name: '已首响且活跃', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: FRESH,
    status: 'ASSIGNED', firstResponseSeconds: 1_800, updatedAt: FRESH,
  });
  const scanner = new LeadRecycleScanner(
    prisma,
    { enabled: true, noFollowHours: 24 },
    new PrismaEventOutboxWriter(),
  );

  assert.equal(await scanner.scanOnce(SCAN_NOW), 0);
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.poolStatus, 'PRIVATE');
  assert.equal(stored.firstResponseSeconds, 1_800);
  assert.equal(await prisma.leadPoolRecord.count(), 0);
  assert.equal(await prisma.eventLog.count(), 0);
});

test('scanOnce recycles a pool-metered lead that was claimed and then idled past the window (R-1 edge)', async () => {
  // R-1 裁定：firstResponseSeconds 非 null 不得豁免回收——公海计量后被认领、认领后闲置的线索
  // 必须随认领后 N 小时回收（认领刷新 updatedAt 后开始计时），否则形成死线索漏洞。
  const owner = await createEmployeeFixture('负责人');
  const lead = await seedLead({
    name: '公海计量后认领闲置', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: STALE,
    status: 'ASSIGNED', firstResponseSeconds: 3_600, updatedAt: STALE,
  });
  const scanner = new LeadRecycleScanner(
    prisma,
    { enabled: true, noFollowHours: 24 },
    new PrismaEventOutboxWriter(),
  );

  assert.equal(await scanner.scanOnce(SCAN_NOW), 1);
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.poolStatus, 'RECYCLED');
  assert.equal(stored.assignedTo, null);
  assert.equal(stored.firstResponseSeconds, 3_600, 'recycle preserves the metering value');
  const record = await prisma.leadPoolRecord.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.equal(record.action, 'RECYCLE');
  assert.equal(record.operatedBy, 'system');
});

test('scanOnce with enabled=false returns zero and writes nothing', async () => {
  const owner = await createEmployeeFixture('负责人');
  const lead = await seedLead({
    name: '逾期NEW', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: STALE,
    status: 'NEW', updatedAt: STALE,
  });
  const scanner = new LeadRecycleScanner(
    prisma,
    { enabled: false, noFollowHours: 24 },
    new PrismaEventOutboxWriter(),
  );

  assert.equal(await scanner.scanOnce(SCAN_NOW), 0);
  const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(stored.poolStatus, 'PRIVATE');
  assert.equal(stored.version, 1, 'disabled scanner must not touch the lead');
  assert.equal(await prisma.leadPoolRecord.count(), 0);
  assert.equal(await prisma.eventLog.count(), 0);
  assert.equal(await prisma.operationLog.count(), 0);
});

test('repeated scans are idempotent: the second scan recycles nothing', async () => {
  const owner = await createEmployeeFixture('负责人');
  await seedLead({
    name: '逾期NEW', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: STALE,
    status: 'NEW', updatedAt: STALE,
  });
  const scanner = new LeadRecycleScanner(
    prisma,
    { enabled: true, noFollowHours: 24 },
    new PrismaEventOutboxWriter(),
  );

  assert.equal(await scanner.scanOnce(SCAN_NOW), 1);
  assert.equal(await scanner.scanOnce(SCAN_NOW), 0, 'recycled leads exit the candidate set');
  assert.equal(await prisma.leadPoolRecord.count(), 1);
  assert.equal(await prisma.eventLog.count({ where: { eventType: 'lead.assigned' } }), 1);
  assert.equal(await prisma.operationLog.count({ where: { action: 'LEAD_RECYCLE' } }), 1);
});

test('a throwing tickListener never breaks the delivery loop and is logged with its own prefix', async () => {
  const now = new Date('2026-07-29T08:00:00.000Z');
  const claim = stubClaim();
  const worker = new EventWorker({
    prisma,
    dispatcher: {
      async dispatchBatch() {
        return { dispatchedCount: 1, deliveryCount: 1, manualCount: 0 };
      },
    },
    deliveryStore: {
      async claimBatch() { return [claim]; },
      async executeHandler() { return { kind: 'SUCCEEDED' } as const; },
      async recordFailure() { throw new Error('recordFailure must not be called'); },
    },
    registry: pilotRegistry(),
    health: new EventHealthService(false),
    workerId: 'tick-listener-test-worker',
    config: { pollMs: 1_000, batchSize: 25, leaseSeconds: 60 },
    now: () => now,
    tickListener: async () => { throw new Error('scanner exploded'); },
  });

  const logged: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => {
    logged.push(values.map(value => String(value)).join(' '));
  };
  let tick;
  try {
    tick = await worker.tick();
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(tick, {
    dispatched: 1, claimed: 1, succeeded: 1, retryScheduled: 0, manual: 0, leaseLost: 0,
  }, 'listener failure must not affect the delivery loop result');
  assert.equal(logged.length, 1, 'the listener failure must be logged');
  assert.ok(logged[0].includes('[lead-recycle-scanner]'), 'the log line uses the scanner prefix');
  assert.ok(logged[0].includes('scanner exploded'), 'the log line carries the listener error');
});

test('the tickListener still runs when an individual delivery fails', async () => {
  const now = new Date('2026-07-29T08:00:00.000Z');
  const claim = stubClaim();
  const listenerCalls: Date[] = [];
  const worker = new EventWorker({
    prisma,
    dispatcher: {
      async dispatchBatch() {
        return { dispatchedCount: 1, deliveryCount: 1, manualCount: 0 };
      },
    },
    deliveryStore: {
      async claimBatch() { return [claim]; },
      async executeHandler() {
        throw new EventHandlerInvocationError(
          new PermanentEventError('LEAD_FIRST_RESPONSE_SOURCE_INVALID'),
        );
      },
      async recordFailure() { return { kind: 'MANUAL' } as const; },
    },
    registry: pilotRegistry(),
    health: new EventHealthService(false),
    workerId: 'tick-listener-test-worker',
    config: { pollMs: 1_000, batchSize: 25, leaseSeconds: 60 },
    now: () => now,
    tickListener: async tickAt => { listenerCalls.push(tickAt); },
  });

  const tick = await worker.tick();

  assert.deepEqual(tick, {
    dispatched: 1, claimed: 1, succeeded: 0, retryScheduled: 0, manual: 1, leaseLost: 0,
  }, 'the permanent handler failure is recorded as MANUAL evidence');
  assert.equal(listenerCalls.length, 1, 'delivery failure must not prevent the listener');
  assert.equal(listenerCalls[0].getTime(), now.getTime(), 'the listener receives the tick clock value');
});

test('factory wires LeadRecycleScanner as the worker tickListener when leadRecycle is present', async () => {
  // 独立客户端：主客户端的服务图不带 leadRecycle（WeakMap 缓存按签名区分，避免同库冲突）。
  const wiringPrisma = createTestPrisma();
  try {
    await clearTestApplicationData(wiringPrisma);
    const owner = await createEmployeeFixture('负责人', wiringPrisma);
    const lead = await seedLead({
      name: '逾期NEW', poolStatus: 'PRIVATE', assignedTo: owner.id, assignedAt: STALE,
      status: 'NEW', updatedAt: STALE,
    }, wiringPrisma);

    const events = createEventServices(wiringPrisma, EVENT_CONFIG, {
      leadRecycle: { enabled: true, noFollowHours: 24 },
    });
    assert.deepEqual(await events.worker.tick(), {
      dispatched: 0, claimed: 0, succeeded: 0, retryScheduled: 0, manual: 0, leaseLost: 0,
    }, 'an idle tick still completes and triggers the listener');

    const stored = await wiringPrisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(stored.poolStatus, 'RECYCLED', 'the wired scanner recycles on tick');
    assert.equal(stored.updatedBy, 'system');
    const event = await wiringPrisma.eventLog.findFirstOrThrow({
      where: { eventType: 'lead.assigned', objectId: lead.id },
    });
    assert.deepEqual(event.payload, {
      leadId: lead.id, action: 'RECYCLE', fromEmployeeId: owner.id, toEmployeeId: null,
    });
    assert.equal(event.operatorUserId, null);

    // 幂等：第二个 tick 不再重复回收，扫描产出的事件尚未投递但不影响本断言边界。
    assert.deepEqual(await events.worker.tick(), {
      dispatched: 1, claimed: 1, succeeded: 1, retryScheduled: 0, manual: 0, leaseLost: 0,
    }, 'the RECYCLE event is delivered to the pilot handler on the next tick');
    assert.equal(
      await wiringPrisma.leadPoolRecord.count({ where: { leadId: lead.id, action: 'RECYCLE' } }),
      1,
      'no duplicate recycle after the second tick',
    );
    assert.equal(
      await wiringPrisma.eventLog.count({ where: { eventType: 'lead.assigned', objectId: lead.id } }),
      1,
    );
  } finally {
    await wiringPrisma.$disconnect();
  }
});
