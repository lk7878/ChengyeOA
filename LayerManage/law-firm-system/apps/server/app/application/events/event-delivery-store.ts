import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

const MAX_BATCH_SIZE = 200;
const MIN_LEASE_SECONDS = 30;
const MAX_LEASE_SECONDS = 600;
const STORE_TRANSACTION_OPTIONS = Object.freeze({ maxWait: 1_000, timeout: 10_000 });
const HANDLER_TRANSACTION_MAX_WAIT_MS = 1_000;
const HANDLER_LEASE_MARGIN_MS = 1_000;

interface ClaimCandidate {
  readonly id: string;
  readonly eventId: string;
  readonly subscriptionId: string;
  readonly handlerCode: string;
  readonly orderingKey: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly manualRetryCount: number;
  readonly lockedBy: string | null;
  readonly lockedUntil: Date | null;
  readonly version: number;
  readonly startedAt: Date | null;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: Prisma.JsonValue;
  readonly traceId: string;
  readonly createdAt: Date;
}

export interface ClaimedEventDelivery {
  readonly deliveryId: string;
  readonly eventId: string;
  readonly subscriptionId: string;
  readonly handlerCode: string;
  readonly orderingKey: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: Prisma.JsonValue;
  readonly traceId: string;
  readonly attemptNumber: number;
  readonly manualRetryCount: number;
  readonly version: number;
  readonly workerId: string;
  readonly startedAt: Date;
  readonly lockedUntil: Date;
}

export interface ClaimBatchInput {
  readonly workerId: string;
  readonly limit: number;
}

export interface EventDeliveryStoreOptions {
  readonly leaseSeconds: number;
  readonly now?: () => Date;
}

export interface EventHandlerContext {
  readonly deliveryId: string;
  readonly eventId: string;
  readonly handlerCode: string;
  readonly orderingKey: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: Prisma.JsonValue;
  readonly traceId: string;
  readonly attemptNumber: number;
  readonly workerId: string;
}

export interface EventHandler {
  handle(tx: Prisma.TransactionClient, context: EventHandlerContext): Promise<void>;
}

export interface SafeEventHandlerFailure {
  readonly errorCode: string;
  readonly errorReference: string;
  readonly decision: { readonly kind: 'RETRY_WAIT'; readonly delayMs: number } | { readonly kind: 'MANUAL' };
}

export type EventHandlerExecutionResult =
  | { readonly kind: 'SUCCEEDED' }
  | { readonly kind: 'RETRY_WAIT'; readonly nextAttemptAt: Date }
  | { readonly kind: 'MANUAL' }
  | { readonly kind: 'LEASE_LOST' };

export class EventHandlerInvocationError extends Error {
  constructor(readonly handlerError: unknown) {
    super('Event handler invocation failed');
    this.name = 'EventHandlerInvocationError';
  }
}

export class EventDeliveryStore {
  private readonly leaseMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    options: EventDeliveryStoreOptions,
  ) {
    if (!Number.isSafeInteger(options.leaseSeconds)
      || options.leaseSeconds < MIN_LEASE_SECONDS
      || options.leaseSeconds > MAX_LEASE_SECONDS) {
      throw new RangeError(`Event delivery lease seconds must be between ${MIN_LEASE_SECONDS} and ${MAX_LEASE_SECONDS}`);
    }
    this.leaseMs = options.leaseSeconds * 1_000;
    this.now = options.now ?? (() => new Date());
  }

  async claimBatch(input: ClaimBatchInput): Promise<ClaimedEventDelivery[]> {
    assertWorkerId(input.workerId);
    assertBatchLimit(input.limit);

    return this.prisma.$transaction(async tx => {
      const now = validNow(this.now());
      const lockedUntil = new Date(now.getTime() + this.leaseMs);
      const candidates = await tx.$queryRaw<ClaimCandidate[]>`
        SELECT
          delivery."id",
          delivery."eventId",
          delivery."subscriptionId",
          delivery."handlerCode",
          delivery."orderingKey",
          delivery."status",
          delivery."attemptCount",
          delivery."manualRetryCount",
          delivery."lockedBy",
          delivery."lockedUntil",
          delivery."version",
          delivery."startedAt",
          delivery."createdAt",
          event."eventType",
          event."eventVersion",
          event."payload",
          event."traceId"
        FROM "event_delivery" delivery
        INNER JOIN "event_log" event ON event."id" = delivery."eventId"
        WHERE (
          delivery."status" = 'PENDING'
          OR (
            delivery."status" = 'RETRY_WAIT'
            AND delivery."nextAttemptAt" <= ${now}
          )
          OR (
            delivery."status" = 'PROCESSING'
            AND delivery."lockedUntil" <= ${now}
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "event_delivery" earlier
          INNER JOIN "event_log" earlier_event ON earlier_event."id" = earlier."eventId"
          WHERE earlier."handlerCode" = delivery."handlerCode"
            AND earlier."orderingKey" = delivery."orderingKey"
            AND earlier."status" <> 'SUCCEEDED'
            AND (
              earlier_event."createdAt" < event."createdAt"
              OR (
                earlier_event."createdAt" = event."createdAt"
                AND earlier_event."id" < event."id"
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "event_log" earlier_source
          WHERE earlier_source."orderingKey" = event."orderingKey"
            AND earlier_source."dispatchedAt" IS NULL
            AND (
              earlier_source."createdAt" < event."createdAt"
              OR (
                earlier_source."createdAt" = event."createdAt"
                AND earlier_source."id" < event."id"
              )
            )
        )
        ORDER BY event."createdAt" ASC, event."id" ASC, delivery."id" ASC
        FOR UPDATE OF delivery SKIP LOCKED
        LIMIT ${input.limit}
      `;

      const claims: ClaimedEventDelivery[] = [];
      for (const candidate of candidates) {
        if (candidate.status === 'PROCESSING') {
          await recordLostLease(tx, candidate, now);
        }

        const updated = await tx.eventDelivery.updateMany({
          where: { id: candidate.id, version: candidate.version },
          data: {
            status: 'PROCESSING',
            lockedBy: input.workerId,
            lockedUntil,
            attemptCount: { increment: 1 },
            nextAttemptAt: null,
            startedAt: now,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new Error('Locked event delivery changed during claim');

        claims.push(Object.freeze({
          deliveryId: candidate.id,
          eventId: candidate.eventId,
          subscriptionId: candidate.subscriptionId,
          handlerCode: candidate.handlerCode,
          orderingKey: candidate.orderingKey,
          eventType: candidate.eventType,
          eventVersion: candidate.eventVersion,
          payload: candidate.payload,
          traceId: candidate.traceId,
          attemptNumber: candidate.attemptCount + 1,
          manualRetryCount: candidate.manualRetryCount,
          version: candidate.version + 1,
          workerId: input.workerId,
          startedAt: new Date(now.getTime()),
          lockedUntil: new Date(lockedUntil.getTime()),
        }));
      }
      return claims;
    }, STORE_TRANSACTION_OPTIONS);
  }

  async executeHandler(
    claim: ClaimedEventDelivery,
    handler: EventHandler,
  ): Promise<EventHandlerExecutionResult> {
    const requestedAt = validNow(this.now());
    const remainingLeaseMs = claim.lockedUntil.getTime() - requestedAt.getTime();
    const timeout = Math.floor(
      remainingLeaseMs - HANDLER_TRANSACTION_MAX_WAIT_MS - HANDLER_LEASE_MARGIN_MS,
    );
    if (timeout <= 0) return { kind: 'LEASE_LOST' };
    try {
      return await this.prisma.$transaction(async tx => {
        const before = validNow(this.now());
        if (!await ownsLiveLease(tx, claim, before)) return { kind: 'LEASE_LOST' } as const;

        try {
          await handler.handle(tx, {
            deliveryId: claim.deliveryId,
            eventId: claim.eventId,
            handlerCode: claim.handlerCode,
            orderingKey: claim.orderingKey,
            eventType: claim.eventType,
            eventVersion: claim.eventVersion,
            payload: claim.payload,
            traceId: claim.traceId,
            attemptNumber: claim.attemptNumber,
            workerId: claim.workerId,
          });
        } catch (error) {
          throw new EventHandlerInvocationError(error);
        }

        const completedAt = validNow(this.now());
        if (!await ownsLiveLease(tx, claim, completedAt)) throw new LeaseLostAfterHandlerError();
        await tx.eventHandlerLog.create({
          data: {
            deliveryId: claim.deliveryId,
            attemptNumber: claim.attemptNumber,
            workerId: claim.workerId,
            outcome: 'SUCCEEDED',
            durationMs: safeDurationMs(claim.startedAt, completedAt),
            startedAt: claim.startedAt,
            completedAt,
          },
        });
        const updated = await tx.eventDelivery.updateMany({
          where: {
            id: claim.deliveryId,
            version: claim.version,
            status: 'PROCESSING',
            lockedBy: claim.workerId,
            lockedUntil: { gt: completedAt },
          },
          data: {
            status: 'SUCCEEDED',
            lockedBy: null,
            lockedUntil: null,
            nextAttemptAt: null,
            lastErrorCode: null,
            lastErrorReference: null,
            completedAt,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new LeaseLostAfterHandlerError();
        return { kind: 'SUCCEEDED' } as const;
      }, { maxWait: HANDLER_TRANSACTION_MAX_WAIT_MS, timeout });
    } catch (error) {
      if (error instanceof LeaseLostAfterHandlerError) return { kind: 'LEASE_LOST' };
      throw error;
    }
  }

  async recordFailure(
    claim: ClaimedEventDelivery,
    failure: SafeEventHandlerFailure,
  ): Promise<EventHandlerExecutionResult> {
    assertSafeFailure(failure);
    return this.prisma.$transaction(async tx => {
      const completedAt = validNow(this.now());
      if (!await ownsLiveLease(tx, claim, completedAt)) return { kind: 'LEASE_LOST' } as const;
      const nextAttemptAt = failure.decision.kind === 'RETRY_WAIT'
        ? new Date(completedAt.getTime() + failure.decision.delayMs)
        : null;
      const outcome = failure.decision.kind === 'RETRY_WAIT' ? 'RETRY_SCHEDULED' : 'MANUAL_REQUIRED';

      await tx.eventHandlerLog.create({
        data: {
          deliveryId: claim.deliveryId,
          attemptNumber: claim.attemptNumber,
          workerId: claim.workerId,
          outcome,
          errorCode: failure.errorCode,
          errorReference: failure.errorReference,
          durationMs: safeDurationMs(claim.startedAt, completedAt),
          startedAt: claim.startedAt,
          completedAt,
        },
      });
      const updated = await tx.eventDelivery.updateMany({
        where: {
          id: claim.deliveryId,
          version: claim.version,
          status: 'PROCESSING',
          lockedBy: claim.workerId,
          lockedUntil: { gt: completedAt },
        },
        data: {
          status: failure.decision.kind,
          lockedBy: null,
          lockedUntil: null,
          nextAttemptAt,
          lastErrorCode: failure.errorCode,
          lastErrorReference: failure.errorReference,
          completedAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new Error('Event delivery lease changed while recording a failure');
      return failure.decision.kind === 'RETRY_WAIT'
        ? { kind: 'RETRY_WAIT', nextAttemptAt: nextAttemptAt! } as const
        : { kind: 'MANUAL' } as const;
    }, STORE_TRANSACTION_OPTIONS);
  }
}

interface OwnedLeaseRow {
  readonly id: string;
}

async function ownsLiveLease(
  tx: Prisma.TransactionClient,
  claim: ClaimedEventDelivery,
  now: Date,
): Promise<boolean> {
  const rows = await tx.$queryRaw<OwnedLeaseRow[]>`
    SELECT "id"
    FROM "event_delivery"
    WHERE "id" = ${claim.deliveryId}
      AND "version" = ${claim.version}
      AND "status" = 'PROCESSING'
      AND "lockedBy" = ${claim.workerId}
      AND "lockedUntil" > ${now}
    FOR UPDATE
  `;
  return rows.length === 1;
}

class LeaseLostAfterHandlerError extends Error {}

async function recordLostLease(
  tx: Prisma.TransactionClient,
  candidate: ClaimCandidate,
  completedAt: Date,
): Promise<void> {
  const startedAt = candidate.startedAt && candidate.startedAt <= completedAt
    ? candidate.startedAt
    : completedAt;
  await tx.eventHandlerLog.create({
    data: {
      deliveryId: candidate.id,
      attemptNumber: candidate.attemptCount,
      workerId: candidate.lockedBy ?? 'unknown-worker',
      outcome: 'LEASE_LOST',
      errorCode: 'EVENT_HANDLER_LEASE_LOST',
      errorReference: randomUUID(),
      durationMs: safeDurationMs(startedAt, completedAt),
      startedAt,
      completedAt,
    },
  });
}

function safeDurationMs(startedAt: Date, completedAt: Date): number {
  return Math.min(2_147_483_647, Math.max(0, completedAt.getTime() - startedAt.getTime()));
}

function assertSafeFailure(failure: SafeEventHandlerFailure): void {
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(failure.errorCode)) {
    throw new TypeError('Event handler error code must be a stable uppercase code');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(failure.errorReference)) {
    throw new TypeError('Event handler error reference must be a UUID');
  }
  if (failure.decision.kind === 'RETRY_WAIT'
    && (!Number.isSafeInteger(failure.decision.delayMs) || failure.decision.delayMs < 0)) {
    throw new TypeError('Event handler retry delay must be a non-negative integer');
  }
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('Event delivery clock returned an invalid date');
  return new Date(value.getTime());
}

function assertWorkerId(workerId: string): void {
  if (typeof workerId !== 'string' || workerId.length < 1 || workerId.length > 200) {
    throw new TypeError('Event worker ID must be between 1 and 200 characters');
  }
}

function assertBatchLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new RangeError(`Event delivery batch limit must be between 1 and ${MAX_BATCH_SIZE}`);
  }
}
