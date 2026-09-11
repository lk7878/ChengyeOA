import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import type { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { createEventServices } from '../../app/application/events/event-services-factory';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { EVENT_SUBSCRIPTION_CATALOG } from '../../app/domain/events/event-subscription-catalog';
import { drainMain } from '../events/drain-events';

const EXPECTED_DATABASE = 'chengye_oa_test';
const CONFIG = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});

export interface EventCenterRehearsalEnvironment {
  readonly databaseUrl: string;
  readonly databaseName: typeof EXPECTED_DATABASE;
}

export function assertEventCenterRehearsalEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): EventCenterRehearsalEnvironment {
  if (env.ALLOW_TEST_DB_RESET !== 'true') throw new Error('Rehearsal reset guard is required');
  if (env.EVENT_WORKER_ENABLED !== 'false') throw new Error('Rehearsal automatic worker must be disabled');
  const rawTest = env.DATABASE_URL_TEST ?? '';
  const rawDatabase = env.DATABASE_URL ?? '';
  if (rawTest.length === 0 || rawDatabase !== rawTest) throw new Error('Rehearsal database URLs must match');
  let url: URL;
  try {
    url = new URL(rawTest);
  } catch {
    throw new Error('Rehearsal database target is invalid');
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (
    url.protocol !== 'postgresql:'
    || url.hostname !== 'localhost'
    || url.port !== '55432'
    || databaseName !== EXPECTED_DATABASE
  ) {
    throw new Error('Rehearsal database must be the exact local test database');
  }
  return { databaseUrl: url.toString(), databaseName: EXPECTED_DATABASE };
}

export async function rehearseEventCenterMain(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const target = assertEventCenterRehearsalEnvironment(env);
  const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
  try {
    const privateValues = {
      reason: `event-rehearsal-reason-${randomUUID()}`,
      reviewComment: `event-rehearsal-review-${randomUUID()}`,
      businessPayload: `event-rehearsal-payload-${randomUUID()}`,
      mfaCiphertext: `event-rehearsal-ciphertext-${randomUUID()}`,
      refreshToken: `event-rehearsal-refresh-${randomUUID()}`,
    };
    await truncateApplicationData(prisma);
    await seedPilotSubscription(prisma);
    const requester = await prisma.user.create({ data: {
      username: `event.rehearsal.requester.${randomUUID()}`,
      password: randomUUID(),
    } });
    const reviewer = await prisma.user.create({ data: {
      username: `event.rehearsal.reviewer.${randomUUID()}`,
      password: randomUUID(),
    } });
    const role = await prisma.role.create({ data: {
      code: `EVENT_REHEARSAL_${randomUUID().replaceAll('-', '')}`,
      name: `Event rehearsal ${randomUUID()}`,
      type: 'BUSINESS',
    } });
    await prisma.userRole.create({ data: { userId: requester.id, roleId: role.id } });
    await prisma.mfaFactor.create({ data: {
      userId: reviewer.id,
      encryptedSecret: privateValues.mfaCiphertext,
      secretIv: 'controlled-rehearsal-iv',
      secretAuthTag: 'controlled-rehearsal-tag',
      verifiedAt: new Date(),
    } });
    await prisma.authSession.create({ data: {
      userId: reviewer.id,
      credentialVersion: 1,
      assuranceLevel: 'MFA',
      refreshTokenHash: privateValues.refreshToken,
      expiresAt: new Date(Date.now() + 60_000),
    } });

    const events = createEventServices(prisma, CONFIG, { workerId: 'event-center-rehearsal' });
    const governance = createGovernanceServices(prisma, {
      databaseName: target.databaseName,
      outboxWriter: events.outboxWriter,
      stepUp: { consume: async () => undefined },
    });
    const source = await prisma.adminOperation.create({ data: {
      operationNo: `EVENT-REHEARSAL-${randomUUID()}`,
      operationType: 'SYSTEM_ADMIN_GRANT',
      riskLevel: 'HIGH',
      reviewMode: 'PRE',
      status: 'PENDING_REVIEW',
      requesterUserId: requester.id,
      targetType: 'USER',
      targetId: randomUUID(),
      reason: privateValues.reason,
      payloadSnapshot: { privateValue: privateValues.businessPayload },
      payloadHash: 'b'.repeat(64),
      expectedTargetVersion: 1,
      idempotencyKey: randomUUID(),
    } });
    const reviewerContext: AuthorizationContext = {
      userId: reviewer.id,
      employeeId: null,
      isSystemAdmin: false,
      isSystemSuperAdmin: true,
      grants: [],
      fieldRules: [],
      permissionCodes: ['governance.review'] as PermissionCode[],
      evaluatedAt: new Date(),
    };
    await governance.review.review(reviewerContext, source.id, {
      decision: 'REJECT',
      comment: privateValues.reviewComment,
      expectedOperationVersion: source.version,
    }, 'event-center-rehearsal');

    const drainEnvironment = { ...env, DATABASE_URL: target.databaseUrl, EVENT_WORKER_ENABLED: 'false' };
    if (await drainMain([], drainEnvironment) !== 0) throw new Error('EVENT_DRAIN_FAILED');
    if (await drainMain([], drainEnvironment) !== 0) throw new Error('EVENT_DRAIN_RESTART_FAILED');

    const [eventCount, deliveryCount, successCount, notificationCount, evidence] = await Promise.all([
      prisma.eventLog.count({ where: { objectId: source.id } }),
      prisma.eventDelivery.count({ where: { event: { objectId: source.id } } }),
      prisma.eventHandlerLog.count({ where: {
        delivery: { event: { objectId: source.id } }, outcome: 'SUCCEEDED',
      } }),
      prisma.notification.count({ where: { userId: requester.id, relatedId: source.id } }),
      serializedSafeEvidence(prisma, source.id, requester.id),
    ]);
    if (eventCount !== 1 || deliveryCount !== 1 || successCount !== 1 || notificationCount !== 1) {
      throw new Error('EVENT_REHEARSAL_POSTCONDITION_FAILED');
    }
    for (const fixture of Object.values(privateValues)) {
      if (evidence.includes(fixture)) throw new Error('EVENT_REHEARSAL_EVIDENCE_UNSAFE');
    }
    process.stdout.write(
      `Event center rehearsal: events=${eventCount} deliveries=${deliveryCount} notifications=${notificationCount} status=complete\n`,
    );
  } finally {
    try {
      await truncateApplicationData(prisma);
    } finally {
      await prisma.$disconnect();
    }
  }
}

async function seedPilotSubscription(prisma: PrismaClient): Promise<void> {
  await prisma.eventSubscription.createMany({
    data: EVENT_SUBSCRIPTION_CATALOG.map(item => ({
      id: item.id,
      code: item.code,
      eventType: item.eventType,
      eventVersion: item.eventVersion,
      handlerCode: item.handlerCode,
      status: item.status,
      filterJson: Prisma.DbNull,
    })),
  });
}

async function serializedSafeEvidence(
  prisma: PrismaClient,
  operationId: string,
  requesterUserId: string,
): Promise<string> {
  const [events, deliveries, handlerLogs, notifications] = await Promise.all([
    prisma.eventLog.findMany({ where: { objectId: operationId } }),
    prisma.eventDelivery.findMany({ where: { event: { objectId: operationId } } }),
    prisma.eventHandlerLog.findMany({ where: { delivery: { event: { objectId: operationId } } } }),
    prisma.notification.findMany({ where: { userId: requesterUserId, relatedId: operationId } }),
  ]);
  return JSON.stringify({ events, deliveries, handlerLogs, notifications });
}

async function truncateApplicationData(prisma: PrismaClient): Promise<void> {
  const tables = Prisma.dmmf.datamodel.models.map(model => model.dbName ?? model.name);
  const quoted = tables.map(table => `"${table.replaceAll('"', '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} CASCADE`);
}

if (require.main === module) {
  void rehearseEventCenterMain().catch(() => {
    process.stderr.write(`Event center rehearsal failed. Reference: ${randomUUID()}\n`);
    process.exitCode = 1;
  });
}
