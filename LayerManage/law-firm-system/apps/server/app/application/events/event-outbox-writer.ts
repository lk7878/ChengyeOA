import { Prisma } from '@prisma/client';

import { validateEventEnvelope } from '../../domain/events/event-registry';
import { EventEnvelopeInput } from '../../domain/events/event-types';

export interface EventOutboxWriter {
  append(tx: Prisma.TransactionClient, input: EventEnvelopeInput): Promise<{ eventId: string }>;
}

export class PrismaEventOutboxWriter implements EventOutboxWriter {
  async append(tx: Prisma.TransactionClient, input: EventEnvelopeInput): Promise<{ eventId: string }> {
    const registered = validateEventEnvelope(input);
    const created = await tx.eventLog.create({
      data: {
        ...registered,
        payload: registered.payload as unknown as Prisma.InputJsonValue,
      },
    });
    return { eventId: created.id };
  }
}
