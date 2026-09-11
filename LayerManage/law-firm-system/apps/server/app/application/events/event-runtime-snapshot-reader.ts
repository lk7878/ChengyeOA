import type { PrismaClient } from '@prisma/client';

import type { EventRuntimeSnapshot } from '../../domain/events/event-observability';
import type { EventWorkerHealthSnapshot } from './event-health-service';
import type { EventWorkerRuntimeStatusStore } from './event-worker-runtime-status-store';

const DISPATCHER_FAULT_CODES = [
  'HANDLER_NOT_REGISTERED',
  'SUBSCRIPTION_FILTER_INVALID',
  'EVENT_ENVELOPE_INVALID',
] as const;
const LEASE_LOST_WINDOW_MILLISECONDS = 15 * 60 * 1_000;

interface EventRuntimeSnapshotReaderOptions {
  readonly leaseSeconds: number;
  readonly now?: () => Date;
  readonly runtimeStatus: Pick<EventWorkerRuntimeStatusStore, 'read'>;
}

export class EventRuntimeSnapshotReader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: EventRuntimeSnapshotReaderOptions,
  ) {
    if (!Number.isSafeInteger(options.leaseSeconds) || options.leaseSeconds <= 0) {
      throw new TypeError('leaseSeconds must be a positive integer');
    }
  }

  async read(workerHealth?: EventWorkerHealthSnapshot): Promise<EventRuntimeSnapshot> {
    const now = validDate(this.options.now?.() ?? new Date());
    const staleLeaseBoundary = new Date(now.getTime() - this.options.leaseSeconds * 1_000);
    const leaseLostBoundary = new Date(now.getTime() - LEASE_LOST_WINDOW_MILLISECONDS);

    const [
      undispatchedCount,
      oldestUndispatched,
      dueBacklogCount,
      oldestPending,
      oldestDueRetry,
      manualCount,
      dispatcherFaultGroups,
      processingCount,
      expiredProcessingCount,
      staleExpiredProcessingCount,
      leaseLost15mCount,
      runtimeStatus,
    ] = await Promise.all([
      this.prisma.eventLog.count({ where: { dispatchedAt: null } }),
      this.prisma.eventLog.findFirst({
        where: { dispatchedAt: null },
        select: { createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.eventDelivery.count({
        where: {
          OR: [
            { status: 'PENDING' },
            { status: 'RETRY_WAIT', nextAttemptAt: { lte: now } },
          ],
        },
      }),
      this.prisma.eventDelivery.findFirst({
        where: { status: 'PENDING' },
        select: { createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.eventDelivery.findFirst({
        where: { status: 'RETRY_WAIT', nextAttemptAt: { lte: now } },
        select: { nextAttemptAt: true },
        orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.eventDelivery.count({ where: { status: 'MANUAL' } }),
      this.prisma.eventDelivery.groupBy({
        by: ['lastErrorCode'],
        where: {
          status: 'MANUAL',
          lastErrorCode: { in: [...DISPATCHER_FAULT_CODES] },
        },
        _count: { _all: true },
      }),
      this.prisma.eventDelivery.count({ where: { status: 'PROCESSING' } }),
      this.prisma.eventDelivery.count({
        where: { status: 'PROCESSING', lockedUntil: { lte: now } },
      }),
      this.prisma.eventDelivery.count({
        where: { status: 'PROCESSING', lockedUntil: { lte: staleLeaseBoundary } },
      }),
      this.prisma.eventHandlerLog.count({
        where: {
          outcome: 'LEASE_LOST',
          completedAt: { gte: leaseLostBoundary, lte: now },
        },
      }),
      this.options.runtimeStatus.read(),
    ]);

    const oldestDueBacklog = earlierDate(
      oldestPending?.createdAt ?? null,
      oldestDueRetry?.nextAttemptAt ?? null,
    );
    const unresolvedDispatcherFaultCount = dispatcherFaultGroups.reduce(
      (sum, group) => sum + group._count._all,
      0,
    );

    return {
      evaluatedAt: now,
      undispatchedCount,
      oldestUndispatchedSeconds: ageSeconds(now, oldestUndispatched?.createdAt ?? null),
      dueBacklogCount,
      oldestDueBacklogSeconds: ageSeconds(now, oldestDueBacklog),
      manualCount,
      unresolvedDispatcherFaultCount,
      processingCount,
      expiredProcessingCount,
      staleExpiredProcessingCount,
      leaseLost15mCount,
      workerConfiguredEnabled: runtimeStatus?.configuredEnabled ?? null,
      workerState: runtimeStatus?.state ?? null,
      workerProcessStartedAt: copyOptionalDate(runtimeStatus?.processStartedAt ?? null),
      lastHeartbeatAt: copyOptionalDate(runtimeStatus?.lastHeartbeatAt ?? null),
      lastSuccessfulTickAt: copyOptionalDate(runtimeStatus?.lastSuccessfulTickAt ?? null),
      consecutiveDatabaseFailures: workerHealth?.consecutiveDatabaseFailures ?? null,
    };
  }
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('event runtime snapshot clock must return a valid Date');
  }
  return new Date(value.getTime());
}

function earlierDate(first: Date | null, second: Date | null): Date | null {
  if (first === null) return copyOptionalDate(second);
  if (second === null) return copyOptionalDate(first);
  return new Date(Math.min(first.getTime(), second.getTime()));
}

function ageSeconds(now: Date, timestamp: Date | null): number {
  if (timestamp === null) return 0;
  return Math.max(0, Math.floor((now.getTime() - timestamp.getTime()) / 1_000));
}

function copyOptionalDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value.getTime());
}
