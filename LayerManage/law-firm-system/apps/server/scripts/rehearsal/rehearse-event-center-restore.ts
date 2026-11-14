import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import type { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { createEventServices } from '../../app/application/events/event-services-factory';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { EVENT_SUBSCRIPTION_CATALOG } from '../../app/domain/events/event-subscription-catalog';
import { drainMain } from '../events/drain-events';

const SOURCE_DATABASE = 'chengye_oa_test';
const RESTORE_DATABASE = 'chengye_oa_restore_test';
const OPERATION_PREFIX = 'SPEC007-RESTORE-';
const CONFIG = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});

type Action = 'prepare' | 'verify' | 'cleanup';

async function main(): Promise<void> {
  const action = assertAction(process.argv[2]);
  const target = assertTarget(action, process.env);
  const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
  try {
    if (action === 'prepare') await prepare(prisma);
    else if (action === 'verify') await verify(prisma, target.databaseUrl);
    else await truncateApplicationData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function prepare(prisma: PrismaClient): Promise<void> {
  await truncateApplicationData(prisma);
  await seedPilotSubscription(prisma);
  const requester = await prisma.user.create({ data: {
    username: `spec007.restore.requester.${randomUUID()}`,
    password: randomUUID(),
  } });
  const reviewer = await prisma.user.create({ data: {
    username: `spec007.restore.reviewer.${randomUUID()}`,
    password: randomUUID(),
  } });
  const events = createEventServices(prisma, CONFIG, { workerId: 'spec-007-restore-prepare' });
  const governance = createGovernanceServices(prisma, {
    databaseName: SOURCE_DATABASE,
    outboxWriter: events.outboxWriter,
    stepUp: { consume: async () => undefined },
  });
  const context: AuthorizationContext = {
    userId: reviewer.id,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: true,
    grants: [],
    fieldRules: [],
    permissionCodes: ['governance.review'] as PermissionCode[],
    evaluatedAt: new Date(),
  };

  const succeeded = await createReviewedOperation(
    prisma, governance, context, requester.id, `${OPERATION_PREFIX}SUCCEEDED`,
  );
  const completed = await events.worker.tick();
  if (completed.succeeded !== 1) throw new Error('RESTORE_FIXTURE_SUCCESS_PATH_FAILED');

  const pending = await createReviewedOperation(
    prisma, governance, context, requester.id, `${OPERATION_PREFIX}PENDING`,
  );
  const pendingDispatch = await events.dispatcher.dispatchBatch(1);
  if (pendingDispatch.dispatchedCount !== 1 || pendingDispatch.deliveryCount !== 1) {
    throw new Error('RESTORE_FIXTURE_PENDING_PATH_FAILED');
  }

  const undispatched = await createReviewedOperation(
    prisma, governance, context, requester.id, `${OPERATION_PREFIX}UNDISPATCHED`,
  );
  const [undispatchedCount, pendingCount, succeededNotificationCount] = await Promise.all([
    prisma.eventLog.count({ where: { objectId: undispatched.id, dispatchedAt: null } }),
    prisma.eventDelivery.count({ where: { event: { objectId: pending.id }, status: 'PENDING' } }),
    prisma.notification.count({ where: { relatedId: succeeded.id, userId: requester.id } }),
  ]);
  if (undispatchedCount !== 1 || pendingCount !== 1 || succeededNotificationCount !== 1) {
    throw new Error('RESTORE_FIXTURE_POSTCONDITION_FAILED');
  }
  process.stdout.write(
    'Event restore fixture: events=3 deliveries=2 pending=1 succeededNotifications=1 status=prepared\n',
  );
}

async function verify(prisma: PrismaClient, databaseUrl: string): Promise<void> {
  const operations = await prisma.adminOperation.findMany({
    where: { operationNo: { startsWith: OPERATION_PREFIX } },
    select: {
      id: true,
      operationNo: true,
      requesterUserId: true,
      reason: true,
      payloadSnapshot: true,
      reviews: { select: { comment: true } },
    },
  });
  const bySuffix = (suffix: string) => operations.find(item => item.operationNo.startsWith(`${OPERATION_PREFIX}${suffix}`));
  const succeeded = bySuffix('SUCCEEDED');
  const pending = bySuffix('PENDING');
  const undispatched = bySuffix('UNDISPATCHED');
  if (!succeeded || !pending || !undispatched || operations.length !== 3) {
    throw new Error('RESTORED_OPERATIONS_INVALID');
  }
  const before = await Promise.all([
    prisma.eventLog.count({ where: { objectId: undispatched.id, dispatchedAt: null } }),
    prisma.eventDelivery.count({ where: { event: { objectId: pending.id }, status: 'PENDING' } }),
    prisma.eventDelivery.count({ where: { event: { objectId: succeeded.id }, status: 'SUCCEEDED' } }),
    prisma.eventHandlerLog.count({ where: { delivery: { event: { objectId: succeeded.id } }, outcome: 'SUCCEEDED' } }),
    prisma.notification.count({ where: { relatedId: succeeded.id, userId: succeeded.requesterUserId } }),
  ]);
  if (before.some(count => count !== 1)) throw new Error('RESTORED_EVENT_STATE_INVALID');

  const drainEnvironment = { ...process.env, DATABASE_URL: databaseUrl, EVENT_WORKER_ENABLED: 'false' };
  if (await drainMain([], drainEnvironment) !== 0) throw new Error('RESTORED_EVENT_DRAIN_FAILED');
  if (await drainMain([], drainEnvironment) !== 0) throw new Error('RESTORED_EVENT_REDRAIN_FAILED');

  const [succeededOriginal, succeededPending, succeededUndispatched, totalNotifications, unsafeEvidence] = await Promise.all([
    prisma.notification.count({ where: { relatedId: succeeded.id, userId: succeeded.requesterUserId } }),
    prisma.notification.count({ where: { relatedId: pending.id, userId: pending.requesterUserId } }),
    prisma.notification.count({ where: { relatedId: undispatched.id, userId: undispatched.requesterUserId } }),
    prisma.notification.count({ where: { userId: succeeded.requesterUserId } }),
    serializedEventEvidence(prisma, operations.map(item => item.id)),
  ]);
  if (
    succeededOriginal !== 1
    || succeededPending !== 1
    || succeededUndispatched !== 1
    || totalNotifications !== 3
  ) {
    throw new Error('RESTORED_EVENT_IDEMPOTENCY_FAILED');
  }
  const privateValues = operations.flatMap(operation => [
    operation.reason,
    privatePayloadValue(operation.payloadSnapshot),
    ...operation.reviews.map(review => review.comment),
  ]).filter((value): value is string => typeof value === 'string');
  for (const fixture of privateValues) {
    if (unsafeEvidence.includes(fixture)) throw new Error('RESTORED_EVENT_EVIDENCE_UNSAFE');
  }
  process.stdout.write(
    'Event restore verification: events=3 deliveries=3 notifications=3 originalNotificationDuplicates=0 status=complete\n',
  );
}

async function createReviewedOperation(
  prisma: PrismaClient,
  governance: ReturnType<typeof createGovernanceServices>,
  context: AuthorizationContext,
  requesterUserId: string,
  operationNoPrefix: string,
) {
  const privateValues = {
    reason: `restore-rehearsal-reason-${randomUUID()}`,
    businessPayload: `restore-rehearsal-payload-${randomUUID()}`,
    reviewComment: `restore-rehearsal-review-${randomUUID()}`,
  };
  const operation = await prisma.adminOperation.create({ data: {
    operationNo: `${operationNoPrefix}-${randomUUID()}`,
    operationType: 'SYSTEM_ADMIN_GRANT',
    riskLevel: 'HIGH',
    reviewMode: 'PRE',
    status: 'PENDING_REVIEW',
    requesterUserId,
    targetType: 'USER',
    targetId: randomUUID(),
    reason: privateValues.reason,
    payloadSnapshot: { privateValue: privateValues.businessPayload },
    payloadHash: 'b'.repeat(64),
    expectedTargetVersion: 1,
    idempotencyKey: randomUUID(),
  } });
  await governance.review.review(context, operation.id, {
    decision: 'REJECT',
    comment: privateValues.reviewComment,
    expectedOperationVersion: operation.version,
  }, 'spec-007-restore-rehearsal');
  return operation;
}

function privatePayloadValue(value: Prisma.JsonValue): string | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined;
  return typeof value.privateValue === 'string' ? value.privateValue : undefined;
}

function assertAction(value: string | undefined): Action {
  if (value === 'prepare' || value === 'verify' || value === 'cleanup') return value;
  throw new Error('RESTORE_REHEARSAL_ACTION_INVALID');
}

function assertTarget(action: Action, env: NodeJS.ProcessEnv): { databaseUrl: string } {
  if (env.ALLOW_TEST_DB_RESET !== 'true') throw new Error('RESTORE_REHEARSAL_RESET_GUARD_REQUIRED');
  if (env.ALLOW_EVENT_CENTER_RESTORE_REHEARSAL !== 'true') {
    throw new Error('RESTORE_REHEARSAL_EXPLICIT_GUARD_REQUIRED');
  }
  if (env.EVENT_WORKER_ENABLED !== 'false') throw new Error('RESTORE_REHEARSAL_WORKER_MUST_BE_DISABLED');
  const expectedDatabase = action === 'verify' ? RESTORE_DATABASE : SOURCE_DATABASE;
  const raw = env.DATABASE_URL ?? '';
  const url = new URL(raw);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (
    url.protocol !== 'postgresql:'
    || url.hostname !== 'localhost'
    || url.port !== '55432'
    || databaseName !== expectedDatabase
  ) {
    throw new Error('RESTORE_REHEARSAL_DATABASE_INVALID');
  }
  return { databaseUrl: url.toString() };
}

async function seedPilotSubscription(prisma: PrismaClient): Promise<void> {
  await prisma.eventSubscription.createMany({ data: EVENT_SUBSCRIPTION_CATALOG.map(item => ({
    id: item.id,
    code: item.code,
    eventType: item.eventType,
    eventVersion: item.eventVersion,
    handlerCode: item.handlerCode,
    status: item.status,
    filterJson: Prisma.DbNull,
  })) });
}

async function serializedEventEvidence(prisma: PrismaClient, operationIds: string[]): Promise<string> {
  const [events, deliveries, handlerLogs, notifications] = await Promise.all([
    prisma.eventLog.findMany({ where: { objectId: { in: operationIds } } }),
    prisma.eventDelivery.findMany({ where: { event: { objectId: { in: operationIds } } } }),
    prisma.eventHandlerLog.findMany({ where: { delivery: { event: { objectId: { in: operationIds } } } } }),
    prisma.notification.findMany({ where: { relatedId: { in: operationIds } } }),
  ]);
  return JSON.stringify({ events, deliveries, handlerLogs, notifications });
}

async function truncateApplicationData(prisma: PrismaClient): Promise<void> {
  const tables = Prisma.dmmf.datamodel.models.map(model => model.dbName ?? model.name);
  const quoted = tables.map(table => `"${table.replaceAll('"', '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} CASCADE`);
}

if (require.main === module) {
  void main().catch(() => {
    process.stderr.write(`Event restore rehearsal failed. Reference: ${randomUUID()}\n`);
    process.exitCode = 1;
  });
}
