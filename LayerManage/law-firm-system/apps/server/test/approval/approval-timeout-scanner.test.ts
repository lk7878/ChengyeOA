import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';

import { ApprovalTimeoutScanner } from '../../app/application/approval/approval-timeout-scanner';
import { createEventServices } from '../../app/application/events/event-services-factory';
import type { EventWorkerEnvironment } from '../../config/env';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-021 Task 1: approval-timeout-scanner 契约测试（服务层超时扫描 + 提醒通知 + 审计）。
// 形态沿 approval-instance-service.test.ts：直建行夹具（user/approvalInstance/approvalTask
// 受控 createdAt）+ 真实 Prisma + 断言通知/审计/dedup key/幂等/按天去重/并发 P2002/返回计数。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/approval/approval-timeout-scanner.test.ts

let prisma: PrismaClient;

const SCANNER_CONFIG = { timeoutHours: 1, dedupPrefix: 'approval-timeout', batchSize: 100 };

const EVENT_CONFIG: EventWorkerEnvironment = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});

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

async function createUser(tag: string): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `timeout.${tag}.${randomUUID()}`, password: 'x' },
  });
  return user.id;
}

/** 直建审批实例 + task 夹具（受控 createdAt 让超时窗口确定）。 */
async function createApprovalFixture(overrides: {
  assigneeId: string;
  applicantId?: string;
  instanceTitle?: string;
  nodeName?: string;
  taskCreatedAt: Date;
  instanceStatus?: string;
  taskStatus?: string;
}): Promise<{ instanceId: string; taskId: string }> {
  const applicantId = overrides.applicantId ?? overrides.assigneeId;
  const definition = await prisma.approvalDefinition.create({
    data: {
      code: `timeout.${randomUUID()}`,
      name: 'timeout fixture',
      businessType: 'EXPENSE',
      formSchema: { fields: [] } as unknown as Prisma.InputJsonValue,
      approverRule: { type: 'USER', userIds: [] } as unknown as Prisma.InputJsonValue,
      status: 'ACTIVE',
      createdBy: applicantId,
    },
  });
  const instance = await prisma.approvalInstance.create({
    data: {
      definitionId: definition.id,
      definitionVersion: 1,
      businessType: 'EXPENSE',
      title: overrides.instanceTitle ?? '超时报销单',
      content: {} as unknown as Prisma.InputJsonValue,
      applicantId,
      status: overrides.instanceStatus ?? 'PENDING',
      createdBy: applicantId,
      createdAt: overrides.taskCreatedAt,
    },
  });
  const task = await prisma.approvalTask.create({
    data: {
      instanceId: instance.id,
      nodeName: overrides.nodeName ?? '二级审批',
      assigneeId: overrides.assigneeId,
      status: overrides.taskStatus ?? 'PENDING',
      createdAt: overrides.taskCreatedAt,
    },
  });
  return { instanceId: instance.id, taskId: task.id };
}

/** UTC 天 key（与实现 dateKey 同构）：YYYY-MM-DD。 */
function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ==================== scanOnce ====================

test('scanOnce creates an APPROVAL notification and APPROVAL_TIMEOUT_NOTIFIED audit for an overdue PENDING task', async () => {
  const assigneeId = await createUser('approver');
  const now = new Date('2026-08-03T12:00:00.000Z');
  const { instanceId, taskId } = await createApprovalFixture({
    assigneeId,
    instanceTitle: '七月差旅报销',
    nodeName: '财务审批',
    taskCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
  });
  const scanner = new ApprovalTimeoutScanner(prisma, SCANNER_CONFIG);

  const notified = await scanner.scanOnce(now);

  assert.equal(notified, 1, 'one overdue task yields one reminder');
  const dedupKey = `approval-timeout:${instanceId}:${taskId}:${utcDateKey(now)}`;
  const notification = await prisma.notification.findUniqueOrThrow({ where: { deduplicationKey: dedupKey } });
  assert.equal(notification.userId, assigneeId);
  assert.equal(notification.type, 'APPROVAL');
  assert.equal(notification.title, '审批超时提醒');
  assert.match(notification.content, /七月差旅报销/, 'content carries instance title');
  assert.match(notification.content, /财务审批/, 'content carries node name');
  assert.match(notification.content, /1 小时/, 'content carries the timeout threshold');
  assert.equal(notification.relatedId, instanceId);
  assert.equal(notification.relatedType, 'APPROVAL_INSTANCE');
  assert.equal(notification.routeUrl, '/approvals?role=TODO');
  assert.match(notification.deduplicationKey, new RegExp(`^approval-timeout:${instanceId}:${taskId}:\\d{4}-\\d{2}-\\d{2}$`));

  const audit = await prisma.operationLog.findFirstOrThrow({
    where: { action: 'APPROVAL_TIMEOUT_NOTIFIED', targetType: 'APPROVAL_TASK', targetId: taskId },
  });
  assert.equal(audit.userId, assigneeId);
  assert.equal(audit.ip, 'system');
  const auditValues = JSON.parse(audit.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    taskId,
    instanceId,
    assigneeId,
    timeoutHours: SCANNER_CONFIG.timeoutHours,
  });
});

test('scanOnce does not notify a PENDING task that is recent (not past the threshold)', async () => {
  const assigneeId = await createUser('approver');
  const now = new Date('2026-08-03T12:00:00.000Z');
  await createApprovalFixture({
    assigneeId,
    taskCreatedAt: new Date('2026-08-03T11:30:00.000Z'), // 30 min < 1 hour threshold
  });
  const scanner = new ApprovalTimeoutScanner(prisma, SCANNER_CONFIG);

  const notified = await scanner.scanOnce(now);

  assert.equal(notified, 0);
  assert.equal(await prisma.notification.count({ where: { type: 'APPROVAL' } }), 0);
  assert.equal(await prisma.operationLog.count({ where: { action: 'APPROVAL_TIMEOUT_NOTIFIED' } }), 0);
});

test('scanOnce skips a PENDING task whose instance is no longer PENDING', async () => {
  const assigneeId = await createUser('approver');
  const now = new Date('2026-08-03T12:00:00.000Z');
  await createApprovalFixture({
    assigneeId,
    instanceStatus: 'APPROVED',
    taskCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
  });
  const scanner = new ApprovalTimeoutScanner(prisma, SCANNER_CONFIG);

  const notified = await scanner.scanOnce(now);

  assert.equal(notified, 0);
  assert.equal(await prisma.notification.count(), 0);
  assert.equal(await prisma.operationLog.count({ where: { action: 'APPROVAL_TIMEOUT_NOTIFIED' } }), 0);
});

test('scanOnce is idempotent within a day: a second scan does not duplicate the notification', async () => {
  const assigneeId = await createUser('approver');
  const now = new Date('2026-08-03T12:00:00.000Z');
  await createApprovalFixture({
    assigneeId,
    taskCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
  });
  const scanner = new ApprovalTimeoutScanner(prisma, SCANNER_CONFIG);

  assert.equal(await scanner.scanOnce(now), 1);
  assert.equal(
    await scanner.scanOnce(new Date('2026-08-03T18:00:00.000Z')),
    0,
    'same UTC day deduplicates',
  );

  assert.equal(await prisma.notification.count({ where: { type: 'APPROVAL' } }), 1);
  assert.equal(await prisma.operationLog.count({ where: { action: 'APPROVAL_TIMEOUT_NOTIFIED' } }), 1);
});

test('scanOnce deduplicates by day but reminds again on a later day', async () => {
  const assigneeId = await createUser('approver');
  const { instanceId, taskId } = await createApprovalFixture({
    assigneeId,
    taskCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
  });
  const scanner = new ApprovalTimeoutScanner(prisma, SCANNER_CONFIG);

  assert.equal(await scanner.scanOnce(new Date('2026-08-03T12:00:00.000Z')), 1);
  assert.equal(await scanner.scanOnce(new Date('2026-08-03T23:00:00.000Z')), 0, 'same UTC day dedupes');
  assert.equal(await scanner.scanOnce(new Date('2026-08-04T12:00:00.000Z')), 1, 'next day reminds again');

  const notifications = await prisma.notification.findMany({
    where: { type: 'APPROVAL' },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].deduplicationKey, `approval-timeout:${instanceId}:${taskId}:2026-08-03`);
  assert.equal(notifications[1].deduplicationKey, `approval-timeout:${instanceId}:${taskId}:2026-08-04`);
  assert.equal(await prisma.operationLog.count({ where: { action: 'APPROVAL_TIMEOUT_NOTIFIED' } }), 2);
});

test('scanOnce swallows a concurrent deduplicationKey P2002 conflict as already-notified', async () => {
  const task = {
    id: 'task-concurrent',
    instanceId: 'instance-concurrent',
    assigneeId: 'assignee-concurrent',
    nodeName: '二级审批',
    status: 'PENDING',
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    instance: { id: 'instance-concurrent', title: '并发报销单', applicantId: 'applicant-concurrent' },
  };
  const p2002 = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`deduplicationKey`)',
    { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['deduplicationKey'] } },
  );
  let notificationCreateCalls = 0;
  let operationLogCreateCalls = 0;
  const fakePrisma = {
    approvalTask: {
      findMany: async () => [task],
    },
    notification: {
      findMany: async () => [], // no already-notified dedup keys today
      findUnique: async () => null, // pre-check passes; the conflict lands in the create call
    },
    $transaction: async (fn: (tx: Record<string, unknown>) => Promise<number>) => {
      const tx = {
        notification: {
          create: async () => {
            notificationCreateCalls += 1;
            throw p2002;
          },
        },
        operationLog: {
          create: async () => {
            operationLogCreateCalls += 1;
            throw new Error('operationLog.create must not be reached after a P2002 notification conflict');
          },
        },
      };
      return fn(tx as never);
    },
  };

  const scanner = new ApprovalTimeoutScanner(fakePrisma as unknown as PrismaClient, SCANNER_CONFIG);
  const notified = await scanner.scanOnce(new Date('2026-08-03T12:00:00.000Z'));

  assert.equal(notified, 0, 'P2002 conflict is treated as already notified');
  assert.equal(notificationCreateCalls, 1);
  assert.equal(operationLogCreateCalls, 0);
});

test('scanOnce returns the number of reminders generated in one pass', async () => {
  const assigneeA = await createUser('approver-a');
  const assigneeB = await createUser('approver-b');
  const now = new Date('2026-08-03T12:00:00.000Z');
  await createApprovalFixture({
    assigneeId: assigneeA,
    taskCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
  });
  await createApprovalFixture({
    assigneeId: assigneeB,
    taskCreatedAt: new Date('2026-08-02T10:00:00.000Z'),
  });
  const scanner = new ApprovalTimeoutScanner(prisma, SCANNER_CONFIG);

  const notified = await scanner.scanOnce(now);

  assert.equal(notified, 2);
  assert.equal(await prisma.notification.count({ where: { type: 'APPROVAL' } }), 2);
  assert.equal(await prisma.operationLog.count({ where: { action: 'APPROVAL_TIMEOUT_NOTIFIED' } }), 2);
});

// SPEC-021 Task 2（I×1 必修，裁决 2 首选方案 a）：batchSize 饥饿边界用例——
// 超时 task > batchSize 时，恒定取最旧 batchSize 条的查询会把 101+ 永远挡在窗口外
// 漏提醒。修复：查询加 NOT IN 已通知 dedup key 谓词，窗口随批次自然推进。
test('scanOnce advances the batch window so more than batchSize overdue tasks are all reminded across passes', async () => {
  const now = new Date('2026-08-03T12:00:00.000Z');
  for (let i = 0; i < 120; i += 1) {
    const assigneeId = await createUser(`approver-${i}`);
    await createApprovalFixture({
      assigneeId,
      taskCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
    });
  }
  const scanner = new ApprovalTimeoutScanner(prisma, {
    timeoutHours: 1,
    dedupPrefix: 'approval-timeout',
    batchSize: 100,
  });

  assert.equal(await scanner.scanOnce(now), 100, 'first pass fills the batch window');
  assert.equal(
    await scanner.scanOnce(now),
    20,
    'second pass excludes already-notified task IDs so the window advances to the rest',
  );

  const notifications = await prisma.notification.findMany({ where: { type: 'APPROVAL' } });
  assert.equal(notifications.length, 120, 'all 120 overdue tasks are reminded across passes (101+ included)');
  const auditCount = await prisma.operationLog.count({ where: { action: 'APPROVAL_TIMEOUT_NOTIFIED' } });
  assert.equal(auditCount, 120, 'one APPROVAL_TIMEOUT_NOTIFIED audit per reminder');
});

// ==================== 节律接线（event-services-factory） ====================

test('event-services-factory wires approval-timeout scanOnce into the worker tick listener', async () => {
  const assigneeId = await createUser('approver');
  await createApprovalFixture({
    assigneeId,
    taskCreatedAt: new Date('2026-08-01T10:00:00.000Z'),
  });

  const events = createEventServices(prisma, EVENT_CONFIG, { approvalTimeout: { timeoutHours: 1 } });
  await events.worker.tick();

  const notifications = await prisma.notification.findMany({ where: { type: 'APPROVAL' } });
  assert.equal(notifications.length, 1, 'worker tick ran the scanner and produced one reminder');
  assert.equal(notifications[0].userId, assigneeId);
  assert.equal(notifications[0].routeUrl, '/approvals?role=TODO');
  assert.equal(
    await prisma.operationLog.count({ where: { action: 'APPROVAL_TIMEOUT_NOTIFIED' } }),
    1,
  );
});
