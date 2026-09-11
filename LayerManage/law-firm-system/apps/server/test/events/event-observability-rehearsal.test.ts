import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeWithRehearsalLifecycle,
  observeCanaryWindow,
  type RehearsalLifecycleResources,
} from '../../scripts/rehearsal/rehearse-event-observability';

test('READY after DEGRADED requires a new complete healthy window and retains the degraded evidence', async () => {
  const clock = mutableClock();
  const results = [
    { status: 'READY' as const, alertCodes: [] },
    { status: 'DEGRADED' as const, alertCodes: [ 'EVENT_OBS_LEASE_LOST' ] },
    { status: 'READY' as const, alertCodes: [] },
  ];
  let index = 0;

  const observation = await observeCanaryWindow({
    windowMilliseconds: 2_000,
    maximumTotalMilliseconds: 6_000,
    intervalMilliseconds: 1_000,
    now: clock.now,
    wait: clock.wait,
    check: async () => results[Math.min(index++, results.length - 1)],
  });

  assert.equal(observation.status, 'READY');
  assert.equal(observation.worstStatus, 'DEGRADED');
  assert.deepEqual(observation.alertCodes, [ 'EVENT_OBS_LEASE_LOST' ]);
  assert.equal(observation.elapsedSeconds, 4);
  assert.equal(observation.checks, 5);
});

test('persistent DEGRADED fails closed at the explicit maximum total window', async () => {
  const clock = mutableClock();
  const observation = await observeCanaryWindow({
    windowMilliseconds: 2_000,
    maximumTotalMilliseconds: 3_000,
    intervalMilliseconds: 1_000,
    now: clock.now,
    wait: clock.wait,
    check: async () => ({ status: 'DEGRADED', alertCodes: [ 'EVENT_OBS_LEASE_LOST' ] }),
  });

  assert.equal(observation.status, 'DEGRADED');
  assert.equal(observation.worstStatus, 'DEGRADED');
  assert.deepEqual(observation.alertCodes, [ 'EVENT_OBS_LEASE_LOST' ]);
  assert.equal(observation.elapsedSeconds, 3);
  assert.equal(observation.checks, 4);
});

test('BLOCKED terminates the observation immediately and retains its safe alert', async () => {
  const clock = mutableClock();
  let checks = 0;
  const observation = await observeCanaryWindow({
    windowMilliseconds: 5_000,
    maximumTotalMilliseconds: 15_000,
    intervalMilliseconds: 1_000,
    now: clock.now,
    wait: clock.wait,
    check: async () => {
      checks += 1;
      return checks === 1
        ? { status: 'READY', alertCodes: [] }
        : { status: 'BLOCKED', alertCodes: [ 'EVENT_OBS_MANUAL_PRESENT' ] };
    },
  });

  assert.equal(observation.status, 'BLOCKED');
  assert.equal(observation.worstStatus, 'BLOCKED');
  assert.deepEqual(observation.alertCodes, [ 'EVENT_OBS_MANUAL_PRESENT' ]);
  assert.equal(observation.elapsedSeconds, 1);
  assert.equal(observation.checks, 2);
});

test('canary records governed creation and background closure inside its measurement boundary without drain or tick', async () => {
  const clock = mutableClock();
  const order: string[] = [];
  let nowCalls = 0;
  let releaseGovernedEvent!: () => void;
  const governedEventCreated = new Promise<void>(resolve => { releaseGovernedEvent = resolve; });
  let businessClosure: {
    events: number;
    deliveries: number;
    handlerLogs: number;
    notifications: number;
    idempotencyKeys: number;
  } | undefined;
  void (async () => {
    await governedEventCreated;
    businessClosure = {
      events: 1,
      deliveries: 1,
      handlerLogs: 1,
      notifications: 1,
      idempotencyKeys: 1,
    };
    order.push('background Worker completion');
  })();

  const observation = await observeCanaryWindow({
    windowMilliseconds: 2_000,
    maximumTotalMilliseconds: 6_000,
    intervalMilliseconds: 1_000,
    now: () => {
      if (nowCalls === 0) order.push('window start');
      nowCalls += 1;
      return clock.now();
    },
    wait: clock.wait,
    onWindowStarted: async () => {
      order.push('governed event create');
      releaseGovernedEvent();
    },
    readBusinessClosure: async () => businessClosure,
    check: async () => ({ status: 'READY', alertCodes: [] }),
  });
  order.push('window end');

  assert.deepEqual(order, [
    'window start',
    'governed event create',
    'background Worker completion',
    'window end',
  ]);
  assert.deepEqual(observation.businessClosure, businessClosure);
});

for (const phase of [ 'canary', 'availability', 'leaseRecovery' ] as const) {
  test(`${phase} injected failure stops and quiesces the Worker before disconnect and protected cleanup`, async () => {
    const order: string[] = [];
    const resources = lifecycleResources(order);

    await assert.rejects(
      executeWithRehearsalLifecycle(resources, async () => { throw new Error(`INJECTED_${phase}`); }),
      new RegExp(`INJECTED_${phase}`),
    );

    assert.deepEqual(order, [ 'stop', 'enabledDisconnect', 'cleanup', 'primaryDisconnect' ]);
  });
}

test('one bounded stop failure retries idempotently before any disconnect or destructive cleanup', async () => {
  const order: string[] = [];
  let stops = 0;
  const resources = lifecycleResources(order);
  resources.worker = {
    async stop() {
      order.push('stop');
      stops += 1;
      if (stops === 1) throw new Error('INJECTED_STOP_FAILURE');
    },
  };

  await assert.rejects(
    executeWithRehearsalLifecycle(resources, async () => { throw new Error('INJECTED_CANARY'); }),
    /INJECTED_CANARY/,
  );

  assert.deepEqual(order, [ 'stop', 'stop', 'enabledDisconnect', 'cleanup', 'primaryDisconnect' ]);
});

function mutableClock() {
  const clock = { value: new Date('2026-07-24T03:00:00.000Z') };
  return {
    now: () => clock.value,
    async wait(milliseconds: number) {
      clock.value = new Date(clock.value.getTime() + milliseconds);
    },
  };
}

function lifecycleResources(order: string[]): RehearsalLifecycleResources {
  return {
    worker: { async stop() { order.push('stop'); } },
    enabledDisconnect: async () => { order.push('enabledDisconnect'); },
    protectedCleanup: async () => { order.push('cleanup'); },
    primaryDisconnect: async () => { order.push('primaryDisconnect'); },
    stopTimeoutMilliseconds: 5,
  };
}
