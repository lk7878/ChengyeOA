import assert from 'node:assert/strict';
import test from 'node:test';

import type { Application } from 'egg';

import AppBootHook from '../../app';
import type { EventServicesFactoryOptions } from '../../app/application/events/event-services-factory';

interface FakeWorker {
  start(): void;
  stop(timeoutMs: number): Promise<void>;
}

interface FakeRuntimeStatus {
  markDisabled(): Promise<void>;
  markStarting(): Promise<void>;
  markStopped(): Promise<void>;
}

function createHarness(options: {
  enabled: boolean;
  stopError?: Error;
  statusError?: 'disabled' | 'starting' | 'stopped';
}) {
  const startCalls: number[] = [];
  const stopCalls: number[] = [];
  const info: unknown[][] = [];
  const errors: unknown[][] = [];
  const prisma = { label: 'shared-context-prisma' };
  const eventObservability = Object.freeze({
    heartbeatSeconds: 10,
    heartbeatStaleSeconds: 60,
    undispatchedBlockSeconds: 120,
    dueBacklogBlockSeconds: 300,
    leaseLostDegradedCount: 1,
    leaseLostBlockedCount: 3,
    canaryWindowMinutes: 15,
  });
  const factoryOptions: unknown[] = [];
  const order: string[] = [];
  const worker: FakeWorker = {
    start() { startCalls.push(1); order.push('worker.start'); },
    async stop(timeoutMs) {
      stopCalls.push(timeoutMs);
      order.push('worker.stop');
      if (options.stopError) throw options.stopError;
    },
  };
  const runtimeStatus: FakeRuntimeStatus = {
    async markDisabled() {
      order.push('status.disabled');
      if (options.statusError === 'disabled') throw new Error('postgresql://disabled:secret@db/private');
    },
    async markStarting() {
      order.push('status.starting');
      if (options.statusError === 'starting') throw new Error('postgresql://starting:secret@db/private');
    },
    async markStopped() {
      order.push('status.stopped');
      if (options.statusError === 'stopped') throw new Error('postgresql://stopped:secret@db/private');
    },
  };
  let factoryCalls = 0;
  const app = {
    config: {
      eventWorker: {
        enabled: options.enabled,
        pollMs: 1000,
        batchSize: 25,
        leaseSeconds: 60,
        shutdownSeconds: 30,
      },
      eventObservability,
    },
    createAnonymousContext() { return { prisma }; },
    logger: {
      info(...args: unknown[]) { info.push(args); },
      error(...args: unknown[]) { errors.push(args); },
    },
  } as unknown as Application;
  const dependencies = {
    createEventServices(
      receivedPrisma: unknown,
      _receivedConfig: unknown,
      receivedOptions?: EventServicesFactoryOptions,
    ) {
      factoryCalls += 1;
      assert.equal(receivedPrisma, prisma);
      factoryOptions.push(receivedOptions);
      return { worker, runtimeStatus };
    },
  };

  return {
    app,
    dependencies,
    errors,
    eventObservability,
    factoryOptions,
    factoryCalls: () => factoryCalls,
    info,
    order,
    startCalls,
    stopCalls,
  };
}

test('forwards the complete observability config to the shared event services factory', async () => {
  const harness = createHarness({ enabled: true });
  const hook = new AppBootHook(harness.app, harness.dependencies);

  await hook.didReady();

  assert.equal(harness.factoryOptions.length, 1);
  const options = harness.factoryOptions[0] as { observability?: unknown } | undefined;
  assert.equal(options?.observability, harness.eventObservability);
  assert.deepEqual(options?.observability, harness.eventObservability);
});

test('unit-test application does not auto-start the event worker when disabled', async () => {
  const harness = createHarness({ enabled: false });
  const hook = new AppBootHook(harness.app, harness.dependencies);

  await hook.didReady();
  await hook.beforeClose();

  assert.equal(harness.factoryCalls(), 1);
  assert.equal(harness.startCalls.length, 0);
  assert.equal(harness.stopCalls.length, 0);
  assert.deepEqual(harness.order, [ 'status.disabled' ]);
  assert.deepEqual(harness.info, [[ 'Event worker disabled.' ]]);
});

test('enabled application owns exactly one shared event worker', async () => {
  const harness = createHarness({ enabled: true });
  const hook = new AppBootHook(harness.app, harness.dependencies);

  await hook.didReady();
  await hook.didReady();

  assert.equal(harness.factoryCalls(), 1);
  assert.equal(harness.startCalls.length, 1);
  assert.deepEqual(harness.order, [ 'status.starting', 'worker.start' ]);
  assert.deepEqual(harness.info, [[ 'Event worker enabled.' ]]);
});

test('beforeClose uses the configured bounded shutdown and redacts stop failures', async () => {
  const rawError = new Error('postgresql://operator:secret@db.internal/private payload');
  const harness = createHarness({ enabled: true, stopError: rawError });
  const hook = new AppBootHook(harness.app, harness.dependencies);

  await hook.didReady();
  await hook.beforeClose();

  assert.deepEqual(harness.stopCalls, [ 30_000 ]);
  assert.deepEqual(harness.order, [ 'status.starting', 'worker.start', 'worker.stop' ]);
  const transcript = JSON.stringify(harness.errors);
  assert.match(transcript, /Event worker shutdown did not complete safely/);
  assert.doesNotMatch(transcript, /postgresql:|operator|secret|private|payload/i);
});

test('successful close records STOPPED only after the worker has stopped', async () => {
  const harness = createHarness({ enabled: true });
  const hook = new AppBootHook(harness.app, harness.dependencies);

  await hook.didReady();
  await hook.beforeClose();

  assert.deepEqual(harness.order, [
    'status.starting',
    'worker.start',
    'worker.stop',
    'status.stopped',
  ]);
});

for (const statusError of [ 'disabled', 'starting' ] as const) {
  test(`${statusError} status-write failure fails readiness closed without leaking the cause`, async () => {
    const harness = createHarness({ enabled: statusError === 'starting', statusError });
    const hook = new AppBootHook(harness.app, harness.dependencies);

    await assert.rejects(hook.didReady(), /Event worker runtime status could not be initialized safely/);

    assert.equal(harness.startCalls.length, 0);
    const transcript = JSON.stringify(harness.errors);
    assert.match(transcript, /Event worker runtime status could not be initialized safely/);
    assert.doesNotMatch(transcript, /postgresql:|disabled|starting|secret|private/i);
  });
}

test('STOPPED status-write failure is safely logged after a successful stop', async () => {
  const harness = createHarness({ enabled: true, statusError: 'stopped' });
  const hook = new AppBootHook(harness.app, harness.dependencies);

  await hook.didReady();
  await hook.beforeClose();

  assert.deepEqual(harness.order, [
    'status.starting',
    'worker.start',
    'worker.stop',
    'status.stopped',
  ]);
  const transcript = JSON.stringify(harness.errors);
  assert.match(transcript, /Event worker stopped status could not be recorded safely/);
  assert.doesNotMatch(transcript, /postgresql:|secret|private/i);
});
