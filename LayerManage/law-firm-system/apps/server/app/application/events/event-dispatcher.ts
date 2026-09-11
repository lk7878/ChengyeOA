import { Prisma, PrismaClient } from '@prisma/client';

import { parseEventPayload } from '../../domain/events/event-registry';
import {
  EVENT_DISPATCH_QUARANTINE_HANDLER_CODE,
  EVENT_DISPATCH_QUARANTINE_SUBSCRIPTION_ID,
} from '../../domain/events/event-subscription-catalog';
import { matchesSubscriptionFilter, parseSubscriptionFilter } from '../../domain/events/subscription-filter';
import { EventHandlerRegistry } from './event-handler-registry';
import { EventHealthFault, EventHealthService } from './event-health-service';

const MAX_DISPATCH_BATCH_SIZE = 200;

interface LockedEvent {
  readonly id: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly sourceModule: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly orderingKey: string;
  readonly payload: Prisma.JsonValue;
}

export interface DispatchBatchResult {
  readonly dispatchedCount: number;
  readonly deliveryCount: number;
  readonly manualCount: number;
}

type DeliveryInput = {
  eventId: string;
  subscriptionId: string;
  handlerCode: string;
  orderingKey: string;
  status: 'PENDING' | 'MANUAL';
  version?: number;
  lastErrorCode?: string;
  lastErrorReference?: string;
};

export class EventDispatcher {
  private readonly reportedQuarantineEventIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: EventHandlerRegistry,
    private readonly health: EventHealthService,
  ) {}

  async dispatchBatch(limit: number): Promise<DispatchBatchResult> {
    assertBatchLimit(limit);
    const outcome = await this.prisma.$transaction(async tx => {
      const events = await tx.$queryRaw<LockedEvent[]>`
        SELECT "id", "eventType", "eventVersion", "sourceModule", "objectType", "objectId", "orderingKey", "payload"
        FROM "event_log"
        WHERE "dispatchedAt" IS NULL
        ORDER BY "createdAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `;
      if (events.length === 0) {
        return {
          result: { dispatchedCount: 0, deliveryCount: 0, manualCount: 0 },
          faults: [] as EventHealthFault[],
        };
      }

      const subscriptions = await tx.eventSubscription.findMany({
        where: { status: 'ENABLED' },
        orderBy: [ { createdAt: 'asc' }, { id: 'asc' } ],
      });
      const deliveries: DeliveryInput[] = [];
      const deliveryKeys = new Set<string>();
      const faultsByReference = new Map<string, EventHealthFault>();
      const validEventIds: string[] = [];
      let existingQuarantineCount = 0;
      const existingQuarantines = new Set((await tx.eventDelivery.findMany({
        where: {
          eventId: { in: events.map(event => event.id) },
          handlerCode: EVENT_DISPATCH_QUARANTINE_HANDLER_CODE,
          status: 'MANUAL',
        },
        select: { eventId: true },
      })).map(delivery => delivery.eventId));

      for (const event of events) {
        let parsed;
        try {
          parsed = parseEventPayload(event.eventType, event.eventVersion, event.payload);
          if (
            event.sourceModule !== parsed.sourceModule
            || event.objectType !== parsed.objectType
            || event.objectId !== parsed.objectId
            || event.orderingKey !== parsed.orderingKey
          ) {
            throw new TypeError('Stored event envelope does not match the registry');
          }
        } catch {
          if (existingQuarantines.has(event.id)) {
            if (!this.reportedQuarantineEventIds.has(event.id)) {
              existingQuarantineCount += 1;
              this.reportedQuarantineEventIds.add(event.id);
            }
            continue;
          }
          const fault = this.health.createInvalidEnvelopeFault();
          faultsByReference.set(fault.reference, fault);
          deliveries.push({
            eventId: event.id,
            subscriptionId: EVENT_DISPATCH_QUARANTINE_SUBSCRIPTION_ID,
            handlerCode: EVENT_DISPATCH_QUARANTINE_HANDLER_CODE,
            orderingKey: event.orderingKey,
            status: 'MANUAL',
            version: 1,
            lastErrorCode: fault.code,
            lastErrorReference: fault.reference,
          });
          deliveryKeys.add(`${event.id}\u0000${EVENT_DISPATCH_QUARANTINE_HANDLER_CODE}`);
          this.reportedQuarantineEventIds.add(event.id);
          continue;
        }
        validEventIds.push(event.id);
        const matchingSubscriptions = subscriptions.filter(subscription => (
          subscription.eventType === event.eventType && subscription.eventVersion === event.eventVersion
        ));
        if (matchingSubscriptions.length === 0) continue;
        for (const subscription of matchingSubscriptions) {
          const deliveryKey = `${event.id}\u0000${subscription.handlerCode}`;
          if (deliveryKeys.has(deliveryKey)) continue;

          if (!this.registry.has(subscription.handlerCode, event.eventType, event.eventVersion)) {
            const fault = this.health.createUnknownHandlerFault();
            faultsByReference.set(fault.reference, fault);
            deliveries.push({
              eventId: event.id,
              subscriptionId: subscription.id,
              handlerCode: subscription.handlerCode,
              orderingKey: event.orderingKey,
              status: 'MANUAL',
              version: 1,
              lastErrorCode: fault.code,
              lastErrorReference: fault.reference,
            });
            deliveryKeys.add(deliveryKey);
            continue;
          }

          let filter;
          try {
            filter = subscription.filterJson === null
              ? null
              : parseSubscriptionFilter(event.eventType, event.eventVersion, subscription.filterJson);
          } catch {
            const fault = this.health.createInvalidFilterFault();
            faultsByReference.set(fault.reference, fault);
            deliveries.push({
              eventId: event.id,
              subscriptionId: subscription.id,
              handlerCode: subscription.handlerCode,
              orderingKey: event.orderingKey,
              status: 'MANUAL',
              version: 1,
              lastErrorCode: fault.code,
              lastErrorReference: fault.reference,
            });
            deliveryKeys.add(deliveryKey);
            continue;
          }

          if (matchesSubscriptionFilter(filter, parsed.payload)) {
            deliveries.push({
              eventId: event.id,
              subscriptionId: subscription.id,
              handlerCode: subscription.handlerCode,
              orderingKey: event.orderingKey,
              status: 'PENDING',
            });
            deliveryKeys.add(deliveryKey);
          }
        }
      }

      const created = deliveries.length === 0
        ? []
        : await tx.eventDelivery.createManyAndReturn({
          data: deliveries,
          skipDuplicates: true,
          select: {
            eventId: true,
            status: true,
            lastErrorCode: true,
            lastErrorReference: true,
          },
        });
      const appliedFaults = created.flatMap(delivery => {
        if (delivery.status !== 'MANUAL' || delivery.lastErrorReference === null) return [];
        const fault = faultsByReference.get(delivery.lastErrorReference);
        if (!fault) throw new Error('Inserted MANUAL delivery has no matching safe health fault');
        return [ fault ];
      });
      const dispatchedAt = new Date();
      await tx.eventLog.updateMany({
        where: { id: { in: validEventIds }, dispatchedAt: null },
        data: { dispatchedAt },
      });

      return {
        result: {
          dispatchedCount: validEventIds.length,
          deliveryCount: created.length,
          manualCount: existingQuarantineCount
            + created.filter(delivery => delivery.status === 'MANUAL').length,
        },
        faults: appliedFaults,
      };
    });
    for (const fault of outcome.faults) this.health.applyFault(fault);
    return outcome.result;
  }
}

function assertBatchLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DISPATCH_BATCH_SIZE) {
    throw new RangeError(`Dispatch batch limit must be between 1 and ${MAX_DISPATCH_BATCH_SIZE}`);
  }
}
