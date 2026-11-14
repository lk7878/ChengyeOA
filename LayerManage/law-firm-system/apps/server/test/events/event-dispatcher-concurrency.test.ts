import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { EventDispatcher } from '../../app/application/events/event-dispatcher';
import { EventHandlerRegistry } from '../../app/application/events/event-handler-registry';
import { EventHealthService } from '../../app/application/events/event-health-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let setupPrisma: PrismaClient;
let prismaA: PrismaClient;
let prismaB: PrismaClient;

function createRegistry(): EventHandlerRegistry {
  const registry = new EventHandlerRegistry();
  registry.register({
    handlerCode: 'ADMIN_OPERATION_REVIEWED_NOTIFICATION',
    eventType: 'admin.operation.reviewed',
    eventVersion: 1,
  });
  registry.validate();
  return registry;
}

async function removeDispatchRollbackTrigger(): Promise<void> {
  await setupPrisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_event_dispatch_for_test ON "event_log"');
  await setupPrisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_event_dispatch_for_test()');
}

test.before(async () => {
  setupPrisma = createTestPrisma();
  prismaA = createTestPrisma();
  prismaB = createTestPrisma();
  await removeDispatchRollbackTrigger();
});
test.beforeEach(async () => { await clearTestApplicationData(setupPrisma); });
test.after(async () => {
  await removeDispatchRollbackTrigger();
  await clearTestApplicationData(setupPrisma);
  await Promise.all([ setupPrisma.$disconnect(), prismaA.$disconnect(), prismaB.$disconnect() ]);
});

test('two Prisma clients snapshot an event into one idempotent delivery', async () => {
  const operationId = randomUUID();
  const requesterUserId = randomUUID();
  const eventId = (await setupPrisma.eventLog.create({
    data: {
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
        decision: 'APPROVE',
        status: 'APPROVED',
        requesterUserId,
        routeUrl: `/security/admin-governance?operationId=${operationId}`,
      },
      traceId: `dispatcher-concurrency-${randomUUID()}`,
      occurredAt: new Date(),
    },
  })).id;
  const registry = createRegistry();
  const dispatcherA = new EventDispatcher(prismaA, registry, new EventHealthService(false));
  const dispatcherB = new EventDispatcher(prismaB, registry, new EventHealthService(false));

  const results = await Promise.all([ dispatcherA.dispatchBatch(25), dispatcherB.dispatchBatch(25) ]);

  assert.equal(results.reduce((sum, result) => sum + result.dispatchedCount, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.deliveryCount, 0), 1);
  assert.equal(await setupPrisma.eventDelivery.count({ where: { eventId } }), 1);
  assert.ok((await setupPrisma.eventLog.findUniqueOrThrow({ where: { id: eventId } })).dispatchedAt);
});
