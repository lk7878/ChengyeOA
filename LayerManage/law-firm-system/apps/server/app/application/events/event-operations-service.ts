import { Prisma, PrismaClient } from '@prisma/client';

import type { EventObservabilityEnvironment } from '../../../config/env';
import type { ActiveSessionClaims } from '../auth/session-service';
import type { StepUpService } from '../auth/step-up-service';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { AuditWriter, writeAuditLog } from '../system/audit-writer';
import { AuthorizationError, AUTHORIZATION_CODES, authorizationInputError } from '../../domain/authorization/authorization-errors';
import type { StepUpPurpose } from '../../domain/security/step-up-target';
import { parseSubscriptionFilter } from '../../domain/events/subscription-filter';
import { EVENT_DISPATCH_QUARANTINE_SUBSCRIPTION_ID } from '../../domain/events/event-subscription-catalog';
import { evaluateEventRollout } from '../../domain/events/event-observability';
import {
  EventObservabilityUnavailableError,
  isEventObservabilityDatabaseError,
} from '../../domain/events/event-observability-errors';
import { EventHandlerRegistry } from './event-handler-registry';
import { EventHealthService, type EventHealthErrorCode } from './event-health-service';
import type { EventRuntimeSnapshotReader } from './event-runtime-snapshot-reader';

const DELIVERY_STATUSES = [ 'PENDING', 'RETRY_WAIT', 'PROCESSING', 'MANUAL', 'SUCCEEDED' ] as const;
const DELIVERY_STATUS_SET = new Set<string>(DELIVERY_STATUSES);
const SORT_KEYS = new Set([ 'createdAt', 'updatedAt', 'nextAttemptAt', 'status' ]);
const QUERY_KEYS = new Set([
  'page', 'pageSize', 'status', 'eventType', 'handlerCode', 'objectType', 'objectId',
  'from', 'to', 'sortBy', 'sortOrder',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const DISPATCHER_FAULT_CODES = [
  'HANDLER_NOT_REGISTERED',
  'SUBSCRIPTION_FILTER_INVALID',
  'EVENT_ENVELOPE_INVALID',
] as const satisfies readonly EventHealthErrorCode[];

export interface EventOperationsListQuery {
  readonly [key: string]: unknown;
}

export interface EventRetryAuthorization {
  readonly claims: ActiveSessionClaims;
  readonly token?: string;
  readonly ip?: string;
}

interface StepUpConsumer {
  consume(
    tx: Prisma.TransactionClient,
    claims: ActiveSessionClaims,
    purpose: StepUpPurpose,
    target: unknown,
    rawToken: string,
  ): Promise<void>;
}

export interface EventOperationsServiceOptions {
  readonly prisma: PrismaClient;
  readonly registry: EventHandlerRegistry;
  readonly health: EventHealthService;
  readonly snapshotReader: Pick<EventRuntimeSnapshotReader, 'read'>;
  readonly observability: EventObservabilityEnvironment;
  readonly workerEnabled: boolean;
  readonly stepUp?: Pick<StepUpService, 'consume'> | StepUpConsumer;
  readonly now?: () => Date;
  readonly auditWriter?: AuditWriter;
}

export class EventOperationsService {
  private readonly authorization = new AuthorizationService();
  private readonly now: () => Date;
  private readonly auditWriter: AuditWriter;

  constructor(private readonly options: EventOperationsServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.auditWriter = options.auditWriter ?? writeAuditLog;
  }

  async summary(context: AuthorizationContext) {
    this.requireRead(context);
    const now = this.validNow();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    let summaryData;
    try {
      summaryData = await Promise.all([
        this.options.prisma.eventDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
        this.options.prisma.eventDelivery.count({ where: { createdAt: { gte: since } } }),
        this.options.prisma.eventDelivery.count({ where: { createdAt: { gte: since }, status: 'SUCCEEDED' } }),
        this.options.prisma.eventDelivery.findFirst({
          where: { status: { in: ['PENDING', 'RETRY_WAIT', 'PROCESSING', 'MANUAL'] } },
          select: { createdAt: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        this.options.prisma.eventDelivery.groupBy({
          by: ['lastErrorCode'],
          where: { status: 'MANUAL', lastErrorCode: { in: [...DISPATCHER_FAULT_CODES] } },
          _count: { _all: true },
        }),
        this.options.prisma.eventDelivery.findFirst({
          where: {
            status: 'MANUAL',
            lastErrorCode: { in: [...DISPATCHER_FAULT_CODES] },
            lastErrorReference: { not: null },
          },
          select: { lastErrorCode: true, lastErrorReference: true, updatedAt: true },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        }),
        this.options.snapshotReader.read(this.options.health.workerSnapshot()),
      ]);
    } catch (error: unknown) {
      if (isEventObservabilityDatabaseError(error)) {
        throw new EventObservabilityUnavailableError();
      }
      throw error;
    }
    const [grouped, recentTotal, recentSucceeded, oldestBacklog, groupedFaults, latestFault, runtimeSnapshot] = summaryData;
    const counts = Object.fromEntries(DELIVERY_STATUSES.map(status => [status, 0])) as Record<typeof DELIVERY_STATUSES[number], number>;
    for (const entry of grouped) {
      if (DELIVERY_STATUS_SET.has(entry.status)) counts[entry.status as keyof typeof counts] = entry._count._all;
    }
    const faultCounts = Object.fromEntries(DISPATCHER_FAULT_CODES.map(code => [code, 0])) as Record<typeof DISPATCHER_FAULT_CODES[number], number>;
    for (const fault of groupedFaults) {
      if (fault.lastErrorCode && DISPATCHER_FAULT_CODES.includes(fault.lastErrorCode as typeof DISPATCHER_FAULT_CODES[number])) {
        faultCounts[fault.lastErrorCode as keyof typeof faultCounts] = fault._count._all;
      }
    }
    const unresolvedDispatcherFaultCount = Object.values(faultCounts).reduce((sum, count) => sum + count, 0);
    const latestFaultCode = latestFault?.lastErrorCode && DISPATCHER_FAULT_CODES.includes(
      latestFault.lastErrorCode as typeof DISPATCHER_FAULT_CODES[number],
    ) ? latestFault.lastErrorCode as typeof DISPATCHER_FAULT_CODES[number] : null;
    const worker = this.options.health.operationsSnapshot({
      unknownHandlerCount: faultCounts.HANDLER_NOT_REGISTERED,
      invalidFilterCount: faultCounts.SUBSCRIPTION_FILTER_INVALID,
      invalidEnvelopeCount: faultCounts.EVENT_ENVELOPE_INVALID,
      unresolvedDispatcherFaultCount,
      lastDegradedAt: unresolvedDispatcherFaultCount > 0 ? latestFault?.updatedAt ?? null : null,
      lastErrorCode: latestFaultCode,
      lastErrorReference: safeErrorReference(latestFault?.lastErrorReference ?? null),
    });
    return {
      counts,
      recent24Hours: {
        total: recentTotal,
        succeeded: recentSucceeded,
        successRate: recentTotal === 0 ? 0 : recentSucceeded / recentTotal,
      },
      longestBacklogSeconds: oldestBacklog
        ? Math.max(0, Math.floor((now.getTime() - oldestBacklog.createdAt.getTime()) / 1_000))
        : 0,
      worker,
      observability: evaluateEventRollout({
        mode: this.options.workerEnabled ? 'canary' : 'preflight',
        snapshot: runtimeSnapshot,
        config: this.options.observability,
      }),
    };
  }

  async list(context: AuthorizationContext, rawQuery: EventOperationsListQuery) {
    this.requireRead(context);
    const query = this.parseListQuery(rawQuery);
    const where: Prisma.EventDeliveryWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.handlerCode) where.handlerCode = query.handlerCode;
    const eventWhere: Prisma.EventLogWhereInput = {};
    if (query.eventType) eventWhere.eventType = query.eventType;
    if (query.objectType) eventWhere.objectType = query.objectType;
    if (query.objectId) eventWhere.objectId = query.objectId;
    if (query.from || query.to) eventWhere.occurredAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
    if (Object.keys(eventWhere).length > 0) where.event = { is: eventWhere };

    const orderBy = [
      { [query.sortBy]: query.sortOrder },
      { id: 'asc' as const },
    ] as Prisma.EventDeliveryOrderByWithRelationInput[];
    const [total, deliveries] = await Promise.all([
      this.options.prisma.eventDelivery.count({ where }),
      this.options.prisma.eventDelivery.findMany({
        where,
        select: DELIVERY_LIST_SELECT,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy,
      }),
    ]);
    return {
      list: deliveries.map(delivery => ({
        id: delivery.id,
        status: delivery.status,
        handlerCode: delivery.handlerCode,
        attemptCount: delivery.attemptCount,
        manualRetryCount: delivery.manualRetryCount,
        nextAttemptAt: delivery.nextAttemptAt,
        lastErrorCode: safeErrorCode(delivery.lastErrorCode),
        lastErrorReference: safeErrorReference(delivery.lastErrorReference),
        version: delivery.version,
        startedAt: delivery.startedAt,
        completedAt: delivery.completedAt,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        internal: delivery.subscriptionId === EVENT_DISPATCH_QUARANTINE_SUBSCRIPTION_ID,
        event: delivery.event,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async detail(context: AuthorizationContext, id: string) {
    this.requireRead(context);
    const deliveryId = requiredIdentifier(id);
    const [delivery, attemptsTotal] = await this.options.prisma.$transaction([
      this.options.prisma.eventDelivery.findUnique({
        where: { id: deliveryId },
        select: {
        ...DELIVERY_LIST_SELECT,
        handlerLogs: {
          select: {
            attemptNumber: true,
            outcome: true,
            errorCode: true,
            errorReference: true,
            durationMs: true,
            startedAt: true,
            completedAt: true,
          },
          orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
          take: 200,
        },
        event: {
          select: {
            id: true,
            eventType: true,
            eventVersion: true,
            sourceModule: true,
            objectType: true,
            objectId: true,
            traceId: true,
            occurredAt: true,
            createdAt: true,
            payload: true,
          },
        },
        },
      }),
      this.options.prisma.eventHandlerLog.count({ where: { deliveryId } }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    if (!delivery) hidden();
    const payloadSummary = this.options.registry.safeSummary(
      delivery.event.eventType,
      delivery.event.eventVersion,
      delivery.event.payload,
    );
    const safeEvent = {
      id: delivery.event.id,
      eventType: delivery.event.eventType,
      eventVersion: delivery.event.eventVersion,
      sourceModule: delivery.event.sourceModule,
      objectType: delivery.event.objectType,
      objectId: delivery.event.objectId,
      traceId: delivery.event.traceId,
      occurredAt: delivery.event.occurredAt,
      createdAt: delivery.event.createdAt,
    };
    return {
      id: delivery.id,
      status: delivery.status,
      handlerCode: delivery.handlerCode,
      attemptCount: delivery.attemptCount,
      manualRetryCount: delivery.manualRetryCount,
      nextAttemptAt: delivery.nextAttemptAt,
      lastErrorCode: safeErrorCode(delivery.lastErrorCode),
      lastErrorReference: safeErrorReference(delivery.lastErrorReference),
      version: delivery.version,
      startedAt: delivery.startedAt,
      completedAt: delivery.completedAt,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      internal: delivery.subscriptionId === EVENT_DISPATCH_QUARANTINE_SUBSCRIPTION_ID,
      event: safeEvent,
      payloadSummary,
      attemptsTotal,
      attemptsTruncated: attemptsTotal > delivery.handlerLogs.length,
      attempts: [...delivery.handlerLogs].reverse().map(attempt => ({
        ...attempt,
        errorCode: safeErrorCode(attempt.errorCode),
        errorReference: safeErrorReference(attempt.errorReference),
      })),
    };
  }

  async subscriptions(context: AuthorizationContext) {
    this.requireRead(context);
    const subscriptions = await this.options.prisma.eventSubscription.findMany({
      select: {
        id: true,
        code: true,
        eventType: true,
        eventVersion: true,
        handlerCode: true,
        status: true,
        filterJson: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    return subscriptions.map(subscription => {
      const { filterJson, ...safe } = subscription;
      return {
        ...safe,
        internal: subscription.id === EVENT_DISPATCH_QUARANTINE_SUBSCRIPTION_ID,
        filterSummary: summarizeFilter(subscription.eventType, subscription.eventVersion, filterJson),
      };
    });
  }

  async retry(
    context: AuthorizationContext,
    id: string,
    expectedVersion: number,
    authorization: EventRetryAuthorization,
  ): Promise<{ id: string; status: 'PENDING'; version: number }> {
    this.authorization.requireAction(context, 'event.delivery.retry');
    if (!context.isSystemSuperAdmin) {
      throw new AuthorizationError(AUTHORIZATION_CODES.special, 403);
    }
    const deliveryId = requiredIdentifier(id);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) authorizationInputError();
    if (!authorization || typeof authorization !== 'object' || !authorization.claims) {
      authorizationInputError();
    }
    if (authorization.claims.userId !== context.userId) {
      throw new AuthorizationError(AUTHORIZATION_CODES.authentication, 401);
    }
    const now = this.validNow();

    return this.options.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "event_delivery" WHERE "id" = ${deliveryId} FOR UPDATE
      `);
      const delivery = await tx.eventDelivery.findUnique({
        where: { id: deliveryId },
        select: {
          id: true,
          status: true,
          version: true,
          attemptCount: true,
          subscriptionId: true,
          handlerCode: true,
          lockedUntil: true,
          event: { select: { eventType: true } },
        },
      });
      if (!delivery) hidden();
      if (delivery.status !== 'MANUAL'
        || delivery.version !== expectedVersion
        || (delivery.lockedUntil !== null && delivery.lockedUntil.getTime() > now.getTime())) {
        versionConflict();
      }
      if (delivery.subscriptionId === EVENT_DISPATCH_QUARANTINE_SUBSCRIPTION_ID) {
        throw new AuthorizationError(AUTHORIZATION_CODES.quarantined, 409);
      }
      const nextVersion = delivery.version + 1;
      const updated = await tx.eventDelivery.updateMany({
        where: { id: deliveryId, status: 'MANUAL', version: expectedVersion },
        data: {
          status: 'PENDING',
          manualRetryCount: { increment: 1 },
          version: { increment: 1 },
          nextAttemptAt: null,
          lockedBy: null,
          lockedUntil: null,
          lastErrorCode: null,
          lastErrorReference: null,
          startedAt: null,
          completedAt: null,
        },
      });
      if (updated.count !== 1) versionConflict();
      await this.auditWriter(tx, {
        userId: context.userId,
        action: 'EVENT_DELIVERY_MANUAL_RETRY',
        targetType: 'EVENT_DELIVERY',
        targetId: deliveryId,
        newValues: JSON.stringify({
          deliveryId,
          eventType: delivery.event.eventType,
          handlerCode: delivery.handlerCode,
          attemptCount: delivery.attemptCount,
          version: nextVersion,
        }),
        ip: safeIp(authorization.ip),
      });
      return { id: deliveryId, status: 'PENDING' as const, version: nextVersion };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 10_000 });
  }

  private requireRead(context: AuthorizationContext): void {
    this.authorization.requireAction(context, 'event.delivery.read');
  }

  private validNow(): Date {
    const now = this.now();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Event operations clock must return a valid date');
    return new Date(now.getTime());
  }

  private parseListQuery(raw: EventOperationsListQuery) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) authorizationInputError();
    if (Object.keys(raw).some(key => !QUERY_KEYS.has(key))) authorizationInputError();
    const page = positiveQueryInteger(raw.page, 1, 10_000);
    const pageSize = positiveQueryInteger(raw.pageSize, 20, 200);
    const status = optionalEnum(raw.status, DELIVERY_STATUSES);
    const eventType = optionalText(raw.eventType, 200);
    if (eventType && !this.options.registry.supportsEventType(eventType)) authorizationInputError();
    const handlerCode = optionalText(raw.handlerCode, 100);
    if (handlerCode && !/^[A-Z][A-Z0-9_]{0,99}$/.test(handlerCode)) authorizationInputError();
    const objectType = optionalEnum(raw.objectType, ['ADMIN_OPERATION'] as const);
    const objectId = optionalIdentifier(raw.objectId);
    const from = optionalUtcTimestamp(raw.from);
    const to = optionalUtcTimestamp(raw.to);
    if (from && to && from.getTime() > to.getTime()) authorizationInputError();
    const sortBy = optionalEnum(raw.sortBy, [...SORT_KEYS]) ?? 'createdAt';
    const sortOrder = optionalEnum(raw.sortOrder, ['asc', 'desc'] as const) ?? 'desc';
    return { page, pageSize, status, eventType, handlerCode, objectType, objectId, from, to, sortBy, sortOrder };
  }
}

const DELIVERY_LIST_SELECT = {
  id: true,
  status: true,
  handlerCode: true,
  subscriptionId: true,
  attemptCount: true,
  manualRetryCount: true,
  nextAttemptAt: true,
  lastErrorCode: true,
  lastErrorReference: true,
  version: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  event: {
    select: {
      id: true,
      eventType: true,
      eventVersion: true,
      sourceModule: true,
      objectType: true,
      objectId: true,
      traceId: true,
      occurredAt: true,
      createdAt: true,
    },
  },
} as const;

function summarizeFilter(eventType: string, eventVersion: number, value: Prisma.JsonValue | null) {
  if (value === null) return { mode: 'ALL' as const };
  try {
    const filter = parseSubscriptionFilter(eventType, eventVersion, value);
    return {
      mode: 'FILTERED' as const,
      conditions: filter.all.map(clause => ({
        field: clause.field,
        operator: clause.operator,
        valueCount: clause.values.length,
      })),
    };
  } catch {
    return { mode: 'INVALID' as const };
  }
}

function positiveQueryInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) authorizationInputError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) authorizationInputError();
  return parsed;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) authorizationInputError();
  return value as T;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') authorizationInputError();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) authorizationInputError();
  return normalized;
}

function optionalIdentifier(value: unknown): string | undefined {
  const normalized = optionalText(value, 200);
  if (normalized === undefined) return undefined;
  if (!UUID_PATTERN.test(normalized)) authorizationInputError();
  return normalized;
}

function requiredIdentifier(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) authorizationInputError();
  return value;
}

function optionalUtcTimestamp(value: unknown): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') authorizationInputError();
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) authorizationInputError();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) authorizationInputError();
  const milliseconds = (match[7] ?? '').padEnd(3, '0');
  const canonical = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${milliseconds}Z`;
  if (parsed.toISOString() !== canonical) authorizationInputError();
  return parsed;
}

function safeIp(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : null;
}

function safeErrorCode(value: string | null): string | null {
  return value !== null && /^[A-Z][A-Z0-9_]{0,99}$/.test(value) ? value : null;
}

function safeErrorReference(value: string | null): string | null {
  return value !== null && UUID_PATTERN.test(value) ? value : null;
}

function hidden(): never {
  throw new AuthorizationError(AUTHORIZATION_CODES.hidden, 404);
}

function versionConflict(): never {
  throw new AuthorizationError(AUTHORIZATION_CODES.version, 409);
}
