import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { validateEventEnvelope } from '../../domain/events/event-registry';

/** One round trip; all three writes participate in the caller's domain transaction. */
export async function appendCollaborationChange(
  tx: Prisma.TransactionClient,
  actorId: string,
  baseId: string,
  kind: string,
  targetId: string,
) {
  const event = validateEventEnvelope({
    eventType: 'collaboration.changed',
    eventVersion: 1,
    objectType: 'COLLAB_BASE',
    objectId: baseId,
    operatorUserId: actorId,
    organizationId: null,
    branchId: null,
    teamId: null,
    payload: { baseId },
    traceId: randomUUID(),
    occurredAt: new Date(),
  });
  await tx.$executeRaw`
    WITH invalidation AS (
      INSERT INTO collab_event ("baseId", kind) VALUES (${baseId}, ${kind})
    ), outbox AS (
      INSERT INTO event_log (id, "eventType", "eventVersion", "sourceModule", "objectType",
        "objectId", "orderingKey", "operatorUserId", payload, "traceId", "occurredAt")
      VALUES (${randomUUID()}, ${event.eventType}, ${event.eventVersion}, ${event.sourceModule},
        ${event.objectType}, ${event.objectId}, ${event.orderingKey}, ${event.operatorUserId},
        ${JSON.stringify(event.payload)}::jsonb, ${event.traceId}, ${event.occurredAt})
    )
    INSERT INTO operation_log (id, "userId", action, "targetType", "targetId")
    VALUES (${randomUUID()}, ${actorId}, ${kind}, 'COLLAB', ${targetId})
  `;
}
