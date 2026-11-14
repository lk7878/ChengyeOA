import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import {
  EVENT_WORKER_PRIMARY_SLOT,
  EventWorkerRuntimeStatusStore,
} from '../../app/application/events/event-worker-runtime-status-store';
import { createTestPrisma } from '../helpers/test-database';

const T0 = new Date('2026-07-23T00:00:00.000Z');
const T10 = new Date('2026-07-23T00:00:10.000Z');
const T15 = new Date('2026-07-23T00:00:15.000Z');
const T20 = new Date('2026-07-23T00:00:20.000Z');
const T30 = new Date('2026-07-23T00:00:30.000Z');
const T40 = new Date('2026-07-23T00:00:40.000Z');

let prisma: PrismaClient;

function store(now: () => Date = () => T0): EventWorkerRuntimeStatusStore {
  return new EventWorkerRuntimeStatusStore(prisma, { heartbeatSeconds: 10, now });
}

function assertSafeShape(value: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(value).sort(), [
    'configuredEnabled',
    'lastHeartbeatAt',
    'lastStoppedAt',
    'lastSuccessfulTickAt',
    'processStartedAt',
    'slot',
    'state',
    'updatedAt',
    'version',
  ]);
  assert.doesNotMatch(JSON.stringify(Object.keys(value)), /workerId|lockedBy|host(?:name)?|pid|payload|error|message|stack/i);
}

test.before(async () => { prisma = createTestPrisma(); });
test.beforeEach(async () => { await prisma.eventWorkerRuntimeStatus.deleteMany(); });
test.after(async () => {
  await prisma.eventWorkerRuntimeStatus.deleteMany();
  await prisma.$disconnect();
});

test('uses the primary singleton slot and initially reads null', async () => {
  assert.equal(EVENT_WORKER_PRIMARY_SLOT, 'primary');
  assert.equal(await store().read(), null);
});

test('markDisabled persists a safe DISABLED singleton using the injected clock', async () => {
  const subject = store(() => new Date(T0));

  await subject.markDisabled();

  const status = await subject.read();
  assert.ok(status);
  assertSafeShape(status as unknown as Record<string, unknown>);
  assert.equal(status.slot, 'primary');
  assert.equal(status.configuredEnabled, false);
  assert.equal(status.state, 'DISABLED');
  assert.deepEqual(status.processStartedAt, T0);
  assert.equal(status.lastHeartbeatAt, null);
  assert.equal(status.lastSuccessfulTickAt, null);
  assert.equal(status.lastStoppedAt, null);
  assert.equal(status.version, 1);
  assert.ok(status.updatedAt instanceof Date);
  assert.equal(await prisma.eventWorkerRuntimeStatus.count(), 1);
});

test('markStarting and the first successful heartbeat transition to RUNNING', async () => {
  const subject = store();

  await subject.markStarting(T0);
  await subject.recordHeartbeat(T10);

  const status = await subject.read();
  assert.ok(status);
  assert.equal(status.slot, 'primary');
  assert.equal(status.configuredEnabled, true);
  assert.equal(status.state, 'RUNNING');
  assert.deepEqual(status.processStartedAt, T0);
  assert.deepEqual(status.lastHeartbeatAt, T10);
  assert.deepEqual(status.lastSuccessfulTickAt, T10);
  assert.equal(status.lastStoppedAt, null);
  assert.equal(status.version, 2);
  assert.ok(status.updatedAt instanceof Date);
  assert.equal(await prisma.eventWorkerRuntimeStatus.count(), 1);
});

test('throttles an early heartbeat and writes a heartbeat at the interval boundary', async () => {
  const subject = store();
  await subject.markStarting(T0);
  await subject.recordHeartbeat(T10);
  const afterFirstHeartbeat = await subject.read();
  assert.ok(afterFirstHeartbeat);

  await subject.recordHeartbeat(T15);
  const afterNoop = await subject.read();
  assert.ok(afterNoop);
  assert.deepEqual(afterNoop.lastHeartbeatAt, T10);
  assert.deepEqual(afterNoop.lastSuccessfulTickAt, T10);
  assert.equal(afterNoop.version, 2);
  assert.deepEqual(afterNoop.updatedAt, afterFirstHeartbeat.updatedAt);

  await subject.recordHeartbeat(T20);
  const afterBoundary = await subject.read();
  assert.ok(afterBoundary);
  assert.deepEqual(afterBoundary.lastHeartbeatAt, T20);
  assert.deepEqual(afterBoundary.lastSuccessfulTickAt, T20);
  assert.equal(afterBoundary.version, 3);
});

test('markStopped retains successful tick evidence and repeated lifecycle calls keep one row', async () => {
  const subject = store();
  await subject.markStarting(T0);
  await subject.recordHeartbeat(T10);
  await subject.markStopped(T30);
  await subject.markStopped(T40);

  const stopped = await subject.read();
  assert.ok(stopped);
  assert.equal(stopped.configuredEnabled, true);
  assert.equal(stopped.state, 'STOPPED');
  assert.deepEqual(stopped.processStartedAt, T0);
  assert.deepEqual(stopped.lastHeartbeatAt, T10);
  assert.deepEqual(stopped.lastSuccessfulTickAt, T10);
  assert.deepEqual(stopped.lastStoppedAt, T40);
  assert.equal(stopped.version, 4);

  await subject.markStarting(T40);
  const restarted = await subject.read();
  assert.ok(restarted);
  assert.equal(restarted.state, 'STARTING');
  assert.deepEqual(restarted.processStartedAt, T40);
  assert.equal(restarted.lastHeartbeatAt, null);
  assert.equal(restarted.lastSuccessfulTickAt, null);
  assert.equal(restarted.lastStoppedAt, null);
  assert.equal(restarted.version, 5);
  assert.equal(await prisma.eventWorkerRuntimeStatus.count(), 1);
});

test('rejects STOPPED timestamps before the last heartbeat or successful tick without changing the row', async () => {
  const subject = store();
  await subject.markStarting(T0);
  await subject.recordHeartbeat(T10);

  for (const invalidStop of [ new Date('2026-07-23T00:00:05.000Z'), new Date('2026-07-23T00:00:09.000Z') ]) {
    await assert.rejects(
      subject.markStopped(invalidStop),
      () => true,
    );
    const afterRejectedStop = await subject.read();
    assert.ok(afterRejectedStop);
    assert.equal(afterRejectedStop.state, 'RUNNING');
    assert.equal(afterRejectedStop.version, 2);
    assert.deepEqual(afterRejectedStop.lastHeartbeatAt, T10);
    assert.deepEqual(afterRejectedStop.lastSuccessfulTickAt, T10);
    assert.equal(afterRejectedStop.lastStoppedAt, null);
  }
});

test('concurrent due heartbeats from independent clients advance the singleton exactly once', async () => {
  const prismaA = createTestPrisma();
  const prismaB = createTestPrisma();
  try {
    const setup = store();
    await setup.markStarting(T0);
    await setup.recordHeartbeat(T10);
    const storeA = new EventWorkerRuntimeStatusStore(prismaA, { heartbeatSeconds: 10 });
    const storeB = new EventWorkerRuntimeStatusStore(prismaB, { heartbeatSeconds: 10 });

    await Promise.all([
      storeA.recordHeartbeat(T20),
      storeB.recordHeartbeat(T20),
    ]);

    const status = await setup.read();
    assert.ok(status);
    assert.equal(status.state, 'RUNNING');
    assert.equal(status.version, 3);
    assert.deepEqual(status.lastHeartbeatAt, T20);
    assert.deepEqual(status.lastSuccessfulTickAt, T20);
    assert.equal(await prisma.eventWorkerRuntimeStatus.count(), 1);
  } finally {
    await Promise.all([ prismaA.$disconnect(), prismaB.$disconnect() ]);
  }
});

test('returns defensive Date copies', async () => {
  const subject = store();
  await subject.markStarting(T0);
  await subject.recordHeartbeat(T10);
  const first = await subject.read();
  assert.ok(first?.lastHeartbeatAt);
  first.processStartedAt.setTime(0);
  first.lastHeartbeatAt.setTime(0);
  first.lastSuccessfulTickAt?.setTime(0);
  first.updatedAt.setTime(0);

  const second = await subject.read();
  assert.ok(second);
  assert.deepEqual(second.processStartedAt, T0);
  assert.deepEqual(second.lastHeartbeatAt, T10);
  assert.deepEqual(second.lastSuccessfulTickAt, T10);
  assert.notEqual(second.updatedAt.getTime(), 0);
});

test('rejects invalid lifecycle timestamps before accessing PostgreSQL', async () => {
  const subject = store();
  const invalid = new Date(Number.NaN);

  await assert.rejects(subject.markDisabled(invalid), /valid Date/);
  await assert.rejects(subject.markStarting(invalid), /valid Date/);
  await assert.rejects(subject.recordHeartbeat(invalid), /valid Date/);
  await assert.rejects(subject.markStopped(invalid), /valid Date/);
  assert.equal(await prisma.eventWorkerRuntimeStatus.count(), 0);
});
