import 'dotenv/config';

import { createHash, randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import type { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { EventOperationsService } from '../../app/application/events/event-operations-service';
import { createEventServices } from '../../app/application/events/event-services-factory';
import { EventObservabilityUnavailableError } from '../../app/domain/events/event-observability-errors';
import type { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { drainMain, productionDrainCliDependencies } from '../events/drain-events';
import {
  checkEventsMain,
  productionCheckEventsCliDependencies,
  type CheckEventsCliDependencies,
} from '../events/check-events';
import { clearTestApplicationData } from '../../test/helpers/test-database';

const EXPECTED_DATABASE = 'chengye_oa_test' as const;
const WORKER_DISABLED = Object.freeze({
  enabled: false,
  pollMs: 1_000,
  batchSize: 25,
  leaseSeconds: 60,
  shutdownSeconds: 30,
});
const WORKER_ENABLED = Object.freeze({ ...WORKER_DISABLED, enabled: true });
const OBSERVABILITY = Object.freeze({
  heartbeatSeconds: 10,
  heartbeatStaleSeconds: 60,
  undispatchedBlockSeconds: 120,
  dueBacklogBlockSeconds: 300,
  leaseLostDegradedCount: 1,
  leaseLostBlockedCount: 3,
  canaryWindowMinutes: 15,
});
const SAFE_ALERT_CODES = new Set([
  'EVENT_OBS_DATABASE_UNAVAILABLE',
  'EVENT_OBS_MANUAL_PRESENT',
  'EVENT_OBS_MODE_MISMATCH',
  'EVENT_OBS_DISPATCHER_FAULT',
  'EVENT_OBS_DATABASE_FAILURES',
  'EVENT_OBS_WORKER_TICK_STALE',
  'EVENT_OBS_UNDISPATCHED_STALE',
  'EVENT_OBS_DUE_BACKLOG_STALE',
  'EVENT_OBS_LEASE_LOST',
  'EVENT_OBS_LEASE_LOST_EXCESSIVE',
  'EVENT_OBS_PROCESSING_LEASE_STALE',
]);

export interface EventObservabilityRehearsalEnvironment {
  readonly databaseUrl: string;
  readonly databaseName: typeof EXPECTED_DATABASE;
}

export function assertEventObservabilityRehearsalEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): EventObservabilityRehearsalEnvironment {
  if (env.ALLOW_TEST_DB_RESET !== 'true') throw new Error('Rehearsal reset guard is required');
  if (env.ALLOW_EVENT_OBSERVABILITY_REHEARSAL !== 'true') {
    throw new Error('Event observability rehearsal guard is required');
  }
  if (env.EVENT_WORKER_ENABLED !== 'false') throw new Error('Rehearsal automatic worker must be disabled');
  const rawTest = env.DATABASE_URL_TEST ?? '';
  const rawDatabase = env.DATABASE_URL ?? '';
  if (rawTest.length === 0 || rawDatabase !== rawTest) {
    throw new Error('Rehearsal database URLs must match literally');
  }

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
    || url.search !== '?schema=public'
    || url.hash !== ''
  ) {
    throw new Error('Rehearsal database must be the exact local test database');
  }
  return { databaseUrl: rawTest, databaseName: EXPECTED_DATABASE };
}

type CanaryStatus = 'READY' | 'DEGRADED' | 'BLOCKED';

export interface CanaryObservationResult {
  readonly status: CanaryStatus;
  readonly worstStatus: CanaryStatus;
  readonly alertCodes: readonly string[];
  readonly businessClosure?: CanaryBusinessClosureEvidence;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly elapsedSeconds: number;
  readonly checks: number;
}

export interface CanaryBusinessClosureEvidence {
  readonly events: number;
  readonly deliveries: number;
  readonly handlerLogs: number;
  readonly notifications: number;
  readonly idempotencyKeys: number;
}

export async function observeCanaryWindow(input: {
  readonly windowMilliseconds: number;
  readonly maximumTotalMilliseconds?: number;
  readonly intervalMilliseconds: number;
  readonly now: () => Date;
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly onWindowStarted?: (startedAt: Date) => Promise<void>;
  readonly readBusinessClosure?: () => Promise<CanaryBusinessClosureEvidence | undefined>;
  readonly check: () => Promise<{ readonly status: CanaryStatus; readonly alertCodes: readonly string[] }>;
}): Promise<CanaryObservationResult> {
  assertPositiveInteger(input.windowMilliseconds, 'Canary window milliseconds');
  assertPositiveInteger(input.intervalMilliseconds, 'Canary interval milliseconds');
  const maximumTotalMilliseconds = input.maximumTotalMilliseconds ?? input.windowMilliseconds * 3;
  assertPositiveInteger(maximumTotalMilliseconds, 'Canary maximum total milliseconds');
  if (maximumTotalMilliseconds < input.windowMilliseconds) {
    throw new RangeError('Canary maximum total milliseconds must cover one complete healthy window');
  }
  if ((input.onWindowStarted === undefined) !== (input.readBusinessClosure === undefined)) {
    throw new TypeError('Canary business closure hooks must be configured together');
  }
  const startedAt = validDate(input.now());
  await input.onWindowStarted?.(startedAt);
  let readySince: Date | null = startedAt;
  let worstStatus: CanaryStatus = 'READY';
  let businessClosure: CanaryBusinessClosureEvidence | undefined;
  const observedAlertCodes = new Set<string>();
  let checks = 0;
  while (true) {
    const current = await input.check();
    checks += 1;
    if (current.status !== 'BLOCKED' && input.readBusinessClosure && businessClosure === undefined) {
      const observedClosure = await input.readBusinessClosure();
      if (observedClosure) businessClosure = freezeCanaryBusinessClosure(observedClosure);
    }
    const now = validDate(input.now());
    const totalElapsed = now.getTime() - startedAt.getTime();
    if (statusRank(current.status) > statusRank(worstStatus)) worstStatus = current.status;
    for (const code of current.alertCodes) observedAlertCodes.add(code);

    if (current.status === 'BLOCKED') {
      return {
        status: 'BLOCKED',
        worstStatus: 'BLOCKED',
        alertCodes: [...observedAlertCodes].sort(),
        businessClosure,
        startedAt,
        endedAt: now,
        elapsedSeconds: Math.floor(totalElapsed / 1_000),
        checks,
      };
    }
    if (current.status === 'DEGRADED') readySince = null;
    else if (readySince === null) readySince = now;

    const readyElapsed = readySince === null ? 0 : now.getTime() - readySince.getTime();
    const healthyWindowComplete = current.status === 'READY' && readyElapsed >= input.windowMilliseconds;
    if (healthyWindowComplete && (input.readBusinessClosure === undefined || businessClosure !== undefined)) {
      return {
        status: 'READY',
        worstStatus,
        alertCodes: [...observedAlertCodes].sort(),
        businessClosure,
        startedAt,
        endedAt: now,
        elapsedSeconds: Math.floor(totalElapsed / 1_000),
        checks,
      };
    }
    if (totalElapsed >= maximumTotalMilliseconds) {
      if (worstStatus === 'READY' && current.status === 'READY' && input.readBusinessClosure && !businessClosure) {
        throw new Error('CANARY_BUSINESS_CLOSURE_FAILED');
      }
      return {
        status: worstStatus === 'READY' ? current.status : worstStatus,
        worstStatus,
        alertCodes: [...observedAlertCodes].sort(),
        businessClosure,
        startedAt,
        endedAt: now,
        elapsedSeconds: Math.floor(totalElapsed / 1_000),
        checks,
      };
    }
    const readyRemaining = readySince === null || healthyWindowComplete
      ? input.intervalMilliseconds
      : input.windowMilliseconds - readyElapsed;
    await input.wait(Math.min(
      input.intervalMilliseconds,
      readyRemaining,
      maximumTotalMilliseconds - totalElapsed,
    ));
  }
}

export interface RehearsalLifecycleResources {
  worker?: { stop(timeoutMilliseconds: number): Promise<void> };
  enabledDisconnect?: () => Promise<void>;
  protectedCleanup: () => Promise<void>;
  primaryDisconnect: () => Promise<void>;
  stopTimeoutMilliseconds: number;
}

export async function executeWithRehearsalLifecycle<T>(
  resources: RehearsalLifecycleResources,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } finally {
    await closeRehearsalResources(resources);
  }
}

async function closeRehearsalResources(resources: RehearsalLifecycleResources): Promise<void> {
  assertPositiveInteger(resources.stopTimeoutMilliseconds, 'Worker stop timeout milliseconds');
  if (resources.worker) {
    let stopped = false;
    for (let attempt = 0; attempt < 2 && !stopped; attempt += 1) {
      try {
        await resources.worker.stop(resources.stopTimeoutMilliseconds);
        stopped = true;
      } catch {
        // A second bounded, idempotent stop waits for the same in-flight tick.
      }
    }
    if (!stopped) {
      throw new Error('Event rehearsal Worker could not be quiesced safely');
    }
  }
  try {
    await resources.enabledDisconnect?.();
  } finally {
    try {
      await resources.protectedCleanup();
    } finally {
      await resources.primaryDisconnect();
    }
  }
}

function statusRank(status: CanaryStatus): number {
  return status === 'BLOCKED' ? 2 : status === 'DEGRADED' ? 1 : 0;
}

export async function advanceInjectedClockWaves(input: {
  readonly waveCount: number;
  readonly stepMilliseconds: number;
  readonly now: () => Date;
  readonly advance: (milliseconds: number) => void;
  readonly runWave: (wave: number, at: Date) => Promise<void>;
}): Promise<void> {
  assertPositiveInteger(input.waveCount, 'Wave count');
  assertPositiveInteger(input.stepMilliseconds, 'Wave step milliseconds');
  for (let wave = 0; wave < input.waveCount; wave += 1) {
    const before = validDate(input.now());
    await input.runWave(wave, before);
    input.advance(input.stepMilliseconds);
    const after = validDate(input.now());
    if (after.getTime() !== before.getTime() + input.stepMilliseconds) {
      throw new Error('Injected rehearsal clock did not advance exactly');
    }
  }
}

export interface RehearsalPhaseEvidence {
  readonly phase: string;
  readonly status: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly alertCodes: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly elapsedSeconds: number;
}

export interface EventObservabilityRehearsalResult {
  readonly status: 'READY';
  readonly phases: readonly RehearsalPhaseEvidence[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly elapsedSeconds: number;
}

interface RehearsalOutput {
  write(value: string): unknown;
}

export async function rehearseEventObservabilityMain(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    readonly windowMilliseconds?: number;
    readonly intervalMilliseconds?: number;
    readonly stdout?: RehearsalOutput;
    readonly now?: () => Date;
    readonly wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<EventObservabilityRehearsalResult> {
  const target = assertEventObservabilityRehearsalEnvironment(env);
  const windowMilliseconds = options.windowMilliseconds ?? canaryWindowMilliseconds(env);
  const intervalMilliseconds = options.intervalMilliseconds ?? Math.min(60_000, windowMilliseconds);
  assertPositiveInteger(windowMilliseconds, 'Canary window milliseconds');
  assertPositiveInteger(intervalMilliseconds, 'Canary interval milliseconds');
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? waitWithTimer;
  const stdout = options.stdout ?? process.stdout;
  const rehearsalStartedAt = validDate(now());
  const phases: RehearsalPhaseEvidence[] = [];
  const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
  let enabledPrisma: PrismaClient | undefined;
  const lifecycle: RehearsalLifecycleResources = {
    protectedCleanup: async () => { await clearTestApplicationData(prisma); },
    primaryDisconnect: async () => { await prisma.$disconnect(); },
    stopTimeoutMilliseconds: 5_000,
  };

  return executeWithRehearsalLifecycle(lifecycle, async () => {
    await clearTestApplicationData(prisma);
    const disabled = createEventServices(prisma, WORKER_DISABLED, { observability: OBSERVABILITY });
    await disabled.runtimeStatus.markDisabled();
    const preflightStarted = validDate(now());
    const preflight = await runCheck('preflight', env, target.databaseUrl);
    requireExit(preflight.code, 0, 'PREFLIGHT_FAILED');
    pushPhase(phases, stdout, phaseEvidence(
      'preflight', 'READY', {}, preflight.alertCodes, preflightStarted, validDate(now()),
    ));

    const requester = await prisma.user.create({ data: {
      username: `spec008.rehearsal.requester.${randomUUID()}`,
      password: randomUUID(),
    } });
    const reviewer = await prisma.user.create({ data: {
      username: `spec008.rehearsal.reviewer.${randomUUID()}`,
      password: randomUUID(),
    } });
    const source = await createReviewedOperation(prisma, disabled.outboxWriter, target.databaseName, requester.id, reviewer.id);
    const drainStarted = validDate(now());
    const firstDrain = await runDrain(env, target.databaseUrl);
    const secondDrain = await runDrain(env, target.databaseUrl);
    requireExit(firstDrain.code, 0, 'FIRST_DRAIN_FAILED');
    requireExit(secondDrain.code, 0, 'SECOND_DRAIN_FAILED');
    const [eventCount, deliveryCount, handlerCount, notificationCount] = await Promise.all([
      prisma.eventLog.count({ where: { objectId: source.id } }),
      prisma.eventDelivery.count({ where: { event: { objectId: source.id }, status: 'SUCCEEDED' } }),
      prisma.eventHandlerLog.count({ where: {
        delivery: { event: { objectId: source.id } }, outcome: 'SUCCEEDED',
      } }),
      prisma.notification.count({ where: { relatedId: source.id } }),
    ]);
    if (eventCount !== 1 || deliveryCount !== 1 || handlerCount !== 1 || notificationCount !== 1
      || secondDrain.claimed !== 0) throw new Error('DRAIN_POSTCONDITION_FAILED');
    pushPhase(phases, stdout, phaseEvidence('drain', 'READY', {
      events: eventCount,
      deliveries: deliveryCount,
      handlerLogs: handlerCount,
      notifications: notificationCount,
      secondDrainClaimed: secondDrain.claimed,
    }, [], drainStarted, validDate(now())));

    enabledPrisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
    lifecycle.enabledDisconnect = async () => { await enabledPrisma?.$disconnect(); };
    const enabled = createEventServices(enabledPrisma, WORKER_ENABLED, {
      observability: OBSERVABILITY,
      workerId: 'spec008-observability-rehearsal',
    });
    await enabled.runtimeStatus.markStarting();
    lifecycle.worker = enabled.worker;
    enabled.worker.start();
    const canaryEnv = { ...env, DATABASE_URL: target.databaseUrl, EVENT_WORKER_ENABLED: 'true' };
    await waitForCanaryReady(canaryEnv, target.databaseUrl, now, wait);
    let canarySource: { readonly id: string } | undefined;
    const observation = await observeCanaryWindow({
      windowMilliseconds,
      intervalMilliseconds,
      now,
      wait,
      onWindowStarted: async () => {
        canarySource = await createReviewedOperation(
          prisma,
          disabled.outboxWriter,
          target.databaseName,
          requester.id,
          reviewer.id,
        );
      },
      readBusinessClosure: async () => {
        if (!canarySource) throw new Error('CANARY_BUSINESS_SOURCE_UNAVAILABLE');
        return readCanaryBusinessClosure(prisma, canarySource.id);
      },
      check: async () => {
        const check = await runCheck('canary', canaryEnv, target.databaseUrl);
        return {
          status: check.code === 0 ? 'READY' : check.code === 3 ? 'DEGRADED' : 'BLOCKED',
          alertCodes: check.alertCodes,
        };
      },
    });
    if (observation.status !== 'READY') throw new Error('CANARY_NOT_READY');
    const canaryBusinessClosure = observation.businessClosure;
    if (!canaryBusinessClosure) throw new Error('CANARY_BUSINESS_CLOSURE_FAILED');
    pushPhase(phases, stdout, phaseEvidence('canary', observation.status, {
      checks: observation.checks,
      ...canaryBusinessClosure,
    }, observation.alertCodes, observation.startedAt, observation.endedAt));

    const faultStarted = validDate(now());
    const faultOutput = memoryOutput();
    const faultDependencies: CheckEventsCliDependencies = {
      ...productionCheckEventsCliDependencies,
      stdout: faultOutput.stdout,
      stderr: faultOutput.stderr,
      createSnapshotReader() {
        return { async read() {
          throw new Prisma.PrismaClientInitializationError('controlled availability drill', 'rehearsal');
        } } as unknown as ReturnType<CheckEventsCliDependencies['createSnapshotReader']>;
      },
    };
    const faultCode = await checkEventsMain([ '--mode=canary' ], canaryEnv, faultDependencies);
    requireExit(faultCode, 5, 'FAULT_CLASSIFICATION_FAILED');
    const operations = new EventOperationsService({
      prisma,
      registry: disabled.registry,
      health: disabled.health,
      snapshotReader: await faultDependencies.createSnapshotReader(prisma, {} as never),
      observability: OBSERVABILITY,
      workerEnabled: true,
      stepUp: { async consume() {} },
    });
    try {
      await operations.summary(operator(reviewer.id));
      throw new Error('API_FAULT_CLASSIFICATION_FAILED');
    } catch (error) {
      if (!(error instanceof EventObservabilityUnavailableError) || error.httpStatus !== 503) throw error;
    }
    const restored = await runCheck('canary', canaryEnv, target.databaseUrl);
    requireExit(restored.code, 0, 'FAULT_RECOVERY_FAILED');
    pushPhase(phases, stdout, phaseEvidence('availability', 'READY', {
      cliUnavailable: 1,
      apiUnavailable: 1,
      recovered: 1,
    }, [ 'EVENT_OBS_DATABASE_UNAVAILABLE' ], faultStarted, validDate(now())));

    const recoveryStarted = validDate(now());
    const recoveryOperation = await createOperation(prisma, requester.id, 'REJECTED');
    const recoveryEvent = await createValidEvent(prisma, recoveryOperation.id, requester.id, true);
    const subscription = await prisma.eventSubscription.findUniqueOrThrow({
      where: { code: 'admin-operation-reviewed-notification-v1' },
    });
    await prisma.eventDelivery.create({ data: {
      eventId: recoveryEvent.id,
      subscriptionId: subscription.id,
      handlerCode: subscription.handlerCode,
      orderingKey: recoveryEvent.orderingKey,
      status: 'PROCESSING',
      attemptCount: 1,
      lockedBy: 'expired-rehearsal-lease',
      lockedUntil: new Date(Date.now() - 1_000),
      startedAt: new Date(Date.now() - 61_000),
    } });
    const recoveryTick = await enabled.worker.tick();
    if (recoveryTick.leaseLost !== 0 || recoveryTick.succeeded !== 1) {
      throw new Error('LEASE_RECOVERY_FAILED');
    }
    const leaseLostCount = await prisma.eventHandlerLog.count({
      where: { delivery: { eventId: recoveryEvent.id }, outcome: 'LEASE_LOST' },
    });
    if (leaseLostCount !== 1) throw new Error('LEASE_RECOVERY_EVIDENCE_FAILED');
    pushPhase(phases, stdout, phaseEvidence('leaseRecovery', 'READY', {
      recoveredDeliveries: 1,
      leaseLostEvidence: leaseLostCount,
    }, [], recoveryStarted, validDate(now())));

    await enabled.worker.stop(5_000);
    await enabled.runtimeStatus.markStopped();
    const quarantineStarted = validDate(now());
    const unknown = await prisma.eventLog.create({ data: {
      eventType: 'admin.operation.reviewed',
      eventVersion: 2,
      sourceModule: 'ADMIN_GOVERNANCE',
      objectType: 'ADMIN_OPERATION',
      objectId: randomUUID(),
      orderingKey: createHash('sha256').update(randomUUID()).digest('hex'),
      payload: { safe: 'unsupported-version' },
      traceId: randomUUID(),
      occurredAt: new Date(),
    } });
    await disabled.dispatcher.dispatchBatch(25);
    await disabled.dispatcher.dispatchBatch(25);
    const manualCount = await prisma.eventDelivery.count({ where: { eventId: unknown.id, status: 'MANUAL' } });
    const preservedUnknown = (await prisma.eventLog.findUniqueOrThrow({ where: { id: unknown.id } })).dispatchedAt === null;
    if (manualCount !== 1 || !preservedUnknown) throw new Error('QUARANTINE_POSTCONDITION_FAILED');
    pushPhase(phases, stdout, phaseEvidence('quarantine', 'BLOCKED', {
      manual: manualCount,
      preservedEvents: preservedUnknown ? 1 : 0,
    }, [ 'EVENT_OBS_MANUAL_PRESENT' ], quarantineStarted, validDate(now())));

    const rollbackStarted = validDate(now());
    const beforeRollback = await readSafeHistoryEvidence(prisma);
    await enabled.runtimeStatus.markDisabled();
    const rollbackOperation = await createOperation(prisma, requester.id, 'REJECTED');
    await createValidEvent(prisma, rollbackOperation.id, requester.id, false);
    const stoppedTick = await enabled.worker.tick();
    const afterRollback = await readSafeHistoryEvidence(prisma);
    const rollbackSnapshot = await enabled.snapshotReader.read();
    const rollbackCheck = await runCheck(
      'preflight',
      { ...env, DATABASE_URL: target.databaseUrl, EVENT_WORKER_ENABLED: 'false' },
      target.databaseUrl,
    );
    const rollbackCounts = {
      newClaims: stoppedTick.claimed,
      eventLogsAdded: afterRollback.eventLogs - beforeRollback.eventLogs,
      deliveriesChanged: afterRollback.deliveries - beforeRollback.deliveries,
      handlerLogsChanged: afterRollback.handlerLogs - beforeRollback.handlerLogs,
      notificationsChanged: afterRollback.notifications - beforeRollback.notifications,
      idempotencyKeysChanged: afterRollback.idempotencyKeys - beforeRollback.idempotencyKeys,
      auditsChanged: afterRollback.audits - beforeRollback.audits,
    };
    if (
      rollbackCounts.newClaims !== 0
      || rollbackCounts.eventLogsAdded !== 1
      || rollbackCounts.deliveriesChanged !== 0
      || rollbackCounts.handlerLogsChanged !== 0
      || rollbackCounts.notificationsChanged !== 0
      || rollbackCounts.idempotencyKeysChanged !== 0
      || rollbackCounts.auditsChanged !== 0
      || rollbackSnapshot.workerConfiguredEnabled !== false
      || rollbackSnapshot.workerState !== 'DISABLED'
      || rollbackCheck.code !== 4
      || !rollbackCheck.alertCodes.includes('EVENT_OBS_MANUAL_PRESENT')
    ) {
      throw new Error('ROLLBACK_POSTCONDITION_FAILED');
    }
    pushPhase(phases, stdout, phaseEvidence(
      'rollback',
      rollbackSnapshot.workerState,
      rollbackCounts,
      rollbackCheck.alertCodes,
      rollbackStarted,
      validDate(now()),
    ));

    const rehearsalEndedAt = validDate(now());
    return {
      status: 'READY',
      phases,
      startedAt: rehearsalStartedAt.toISOString(),
      endedAt: rehearsalEndedAt.toISOString(),
      elapsedSeconds: elapsedSeconds(rehearsalStartedAt, rehearsalEndedAt),
    };
  });
}

async function waitForCanaryReady(
  env: NodeJS.ProcessEnv,
  databaseUrl: string,
  now: () => Date,
  wait: (milliseconds: number) => Promise<void>,
): Promise<void> {
  const startedAt = validDate(now());
  const maximumWaitMilliseconds = OBSERVABILITY.heartbeatStaleSeconds * 1_000;
  while (true) {
    const check = await runCheck('canary', env, databaseUrl);
    if (check.code === 0) return;
    if (check.code !== 3) throw new Error('CANARY_STARTUP_FAILED');
    const elapsed = validDate(now()).getTime() - startedAt.getTime();
    if (elapsed >= maximumWaitMilliseconds) throw new Error('CANARY_STARTUP_TIMEOUT');
    await wait(Math.min(250, maximumWaitMilliseconds - elapsed));
  }
}

async function readCanaryBusinessClosure(
  prisma: PrismaClient,
  operationId: string,
): Promise<CanaryBusinessClosureEvidence | undefined> {
  const [events, deliveries, handlerLogs, notifications] = await Promise.all([
    prisma.eventLog.count({ where: { objectId: operationId } }),
    prisma.eventDelivery.count({ where: {
      event: { objectId: operationId },
      status: 'SUCCEEDED',
    } }),
    prisma.eventHandlerLog.count({ where: {
      delivery: { event: { objectId: operationId } },
      outcome: 'SUCCEEDED',
    } }),
    prisma.notification.findMany({
      where: { relatedId: operationId },
      select: { deduplicationKey: true },
    }),
  ]);
  const idempotencyKeys = notifications.flatMap(item => (
    item.deduplicationKey === null ? [] : [ item.deduplicationKey ]
  ));
  if (
    events > 1
    || deliveries > 1
    || handlerLogs > 1
    || notifications.length > 1
    || idempotencyKeys.length > 1
    || new Set(idempotencyKeys).size !== idempotencyKeys.length
  ) {
    throw new Error('CANARY_BUSINESS_CLOSURE_FAILED');
  }
  if (
    events !== 1
    || deliveries !== 1
    || handlerLogs !== 1
    || notifications.length !== 1
    || idempotencyKeys.length !== 1
  ) {
    return undefined;
  }
  return {
    events,
    deliveries,
    handlerLogs,
    notifications: notifications.length,
    idempotencyKeys: idempotencyKeys.length,
  };
}

async function readSafeHistoryEvidence(prisma: PrismaClient) {
  const [eventLogs, deliveries, handlerLogs, notifications, audits, notificationKeys] = await Promise.all([
    prisma.eventLog.count(),
    prisma.eventDelivery.count(),
    prisma.eventHandlerLog.count(),
    prisma.notification.count(),
    prisma.operationLog.count(),
    prisma.notification.findMany({
      where: { deduplicationKey: { not: null } },
      select: { deduplicationKey: true },
    }),
  ]);
  const keys = notificationKeys.flatMap(item => item.deduplicationKey === null ? [] : [ item.deduplicationKey ]);
  if (new Set(keys).size !== keys.length) throw new Error('NOTIFICATION_IDEMPOTENCY_EVIDENCE_INVALID');
  return { eventLogs, deliveries, handlerLogs, notifications, idempotencyKeys: keys.length, audits };
}

async function createReviewedOperation(
  prisma: PrismaClient,
  outboxWriter: ReturnType<typeof createEventServices>['outboxWriter'],
  databaseName: string,
  requesterId: string,
  reviewerId: string,
) {
  const source = await createOperation(prisma, requesterId, 'PENDING_REVIEW');
  const governance = createGovernanceServices(prisma, {
    databaseName,
    outboxWriter,
    stepUp: { async consume() {} },
  });
  await governance.review.review(operator(reviewerId), source.id, {
    decision: 'REJECT',
    comment: `spec008-private-review-comment-${randomUUID()}`,
    expectedOperationVersion: source.version,
  }, 'spec008-observability-rehearsal');
  return source;
}

async function createOperation(prisma: PrismaClient, requesterId: string, status: 'PENDING_REVIEW' | 'REJECTED') {
  return prisma.adminOperation.create({ data: {
    operationNo: `SPEC008-REHEARSAL-${randomUUID()}`,
    operationType: 'SYSTEM_ADMIN_GRANT',
    riskLevel: 'HIGH',
    reviewMode: 'PRE',
    status,
    requesterUserId: requesterId,
    targetType: 'USER',
    targetId: randomUUID(),
    reason: `spec008-private-governance-reason-${randomUUID()}`,
    payloadSnapshot: { privateValue: `spec008-private-business-payload-${randomUUID()}` },
    payloadHash: 'b'.repeat(64),
    expectedTargetVersion: 1,
    idempotencyKey: randomUUID(),
  } });
}

async function createValidEvent(
  prisma: PrismaClient,
  operationId: string,
  requesterId: string,
  dispatched: boolean,
) {
  return prisma.eventLog.create({ data: {
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
    sourceModule: 'ADMIN_GOVERNANCE',
    objectType: 'ADMIN_OPERATION',
    objectId: operationId,
    orderingKey: createHash('sha256').update(`ADMIN_OPERATION:${operationId}`).digest('hex'),
    payload: {
      operationId,
      operationType: 'SYSTEM_ADMIN_GRANT',
      riskLevel: 'HIGH',
      decision: 'REJECT',
      status: 'REJECTED',
      requesterUserId: requesterId,
      routeUrl: `/security/admin-governance?operationId=${operationId}`,
    },
    traceId: randomUUID(),
    occurredAt: new Date(),
    dispatchedAt: dispatched ? new Date() : null,
  } });
}

async function runDrain(env: NodeJS.ProcessEnv, databaseUrl: string) {
  const output = memoryOutput();
  const code = await drainMain([], { ...env, DATABASE_URL: databaseUrl, EVENT_WORKER_ENABLED: 'false' }, {
    ...productionDrainCliDependencies,
    stdout: output.stdout,
    stderr: output.stderr,
  });
  return { code, claimed: safeCount(output.stdoutValues.join(''), 'claimed') };
}

async function runCheck(mode: 'preflight' | 'canary', env: NodeJS.ProcessEnv, databaseUrl: string) {
  const output = memoryOutput();
  const code = await checkEventsMain([ `--mode=${mode}` ], { ...env, DATABASE_URL: databaseUrl }, {
    ...productionCheckEventsCliDependencies,
    stdout: output.stdout,
    stderr: output.stderr,
  });
  const match = /(?:^| )alertCodes=([A-Z0-9_,]+|none)(?: |\r?$)/m.exec(output.stdoutValues.join(''));
  const alertCodes = !match || match[1] === 'none' ? [] : match[1].split(',');
  return { code, alertCodes };
}

function memoryOutput() {
  const stdoutValues: string[] = [];
  const stderrValues: string[] = [];
  return {
    stdoutValues,
    stderrValues,
    stdout: { write(value: string | Uint8Array) { stdoutValues.push(String(value)); return true; } } as NodeJS.WritableStream,
    stderr: { write(value: string | Uint8Array) { stderrValues.push(String(value)); return true; } } as NodeJS.WritableStream,
  };
}

function safeCount(value: string, name: string): number {
  const match = new RegExp(`(?:^| )${name}=([0-9]+)(?: |$)`).exec(value.trim());
  if (!match) throw new Error('Safe rehearsal count was unavailable');
  return Number(match[1]);
}

function operator(userId: string): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: true,
    grants: [],
    fieldRules: [],
    permissionCodes: [ 'governance.review', 'event.delivery.read' ] as PermissionCode[],
    evaluatedAt: new Date(),
  };
}

function phaseEvidence(
  phase: string,
  status: string,
  counts: Readonly<Record<string, number>>,
  alertCodes: readonly string[],
  startedAt: Date,
  endedAt: Date,
): RehearsalPhaseEvidence {
  for (const code of alertCodes) {
    if (!SAFE_ALERT_CODES.has(code)) throw new Error('Unsafe rehearsal alert code');
  }
  for (const value of Object.values(counts)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Unsafe rehearsal count');
  }
  return {
    phase,
    status,
    counts: { ...counts },
    alertCodes: [...alertCodes],
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    elapsedSeconds: elapsedSeconds(startedAt, endedAt),
  };
}

function pushPhase(phases: RehearsalPhaseEvidence[], output: RehearsalOutput, phase: RehearsalPhaseEvidence): void {
  phases.push(phase);
  output.write(`${JSON.stringify(phase)}\n`);
}

function elapsedSeconds(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1_000));
}

function canaryWindowMilliseconds(env: NodeJS.ProcessEnv): number {
  const raw = env.EVENT_OBSERVABILITY_CANARY_WINDOW_MINUTES ?? '15';
  if (!/^(?:[5-9]|[1-9][0-9]|1[01][0-9]|120)$/.test(raw)) {
    throw new Error('Canary window configuration is invalid');
  }
  return Number(raw) * 60_000;
}

function requireExit(actual: number, expected: number, code: string): void {
  if (actual !== expected) throw new Error(code);
}

function waitWithTimer(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
}

function freezeCanaryBusinessClosure(
  evidence: CanaryBusinessClosureEvidence,
): CanaryBusinessClosureEvidence {
  if (Object.values(evidence).some(value => value !== 1)) {
    throw new Error('CANARY_BUSINESS_CLOSURE_FAILED');
  }
  return Object.freeze({ ...evidence });
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Rehearsal clock must return a valid Date');
  }
  return new Date(value.getTime());
}

if (require.main === module) {
  void rehearseEventObservabilityMain().catch(() => {
    const timestamp = new Date().toISOString();
    process.stderr.write(`${JSON.stringify({
      phase: 'rehearsal',
      status: 'FAILED',
      counts: {},
      alertCodes: [],
      startedAt: timestamp,
      endedAt: timestamp,
      elapsedSeconds: 0,
    })}\n`);
    process.exitCode = 1;
  });
}
