import assert from 'node:assert/strict';
import test from 'node:test';
import { EventObservabilityEnvironment } from '../../config/env';
import { EventRuntimeSnapshot, evaluateEventRollout } from '../../app/domain/events/event-observability';

const config: EventObservabilityEnvironment = {
  heartbeatSeconds: 10,
  heartbeatStaleSeconds: 60,
  undispatchedBlockSeconds: 120,
  dueBacklogBlockSeconds: 300,
  leaseLostDegradedCount: 1,
  leaseLostBlockedCount: 3,
  canaryWindowMinutes: 15,
};

const evaluatedAt = new Date('2026-07-23T00:00:00.000Z');

function healthySnapshot(overrides: Partial<EventRuntimeSnapshot> = {}): EventRuntimeSnapshot {
  return {
    evaluatedAt,
    undispatchedCount: 0,
    oldestUndispatchedSeconds: 0,
    dueBacklogCount: 0,
    oldestDueBacklogSeconds: 0,
    manualCount: 0,
    unresolvedDispatcherFaultCount: 0,
    processingCount: 0,
    expiredProcessingCount: 0,
    staleExpiredProcessingCount: 0,
    leaseLost15mCount: 0,
    workerConfiguredEnabled: true,
    workerState: 'RUNNING',
    workerProcessStartedAt: new Date('2026-07-22T23:00:00.000Z'),
    lastHeartbeatAt: new Date('2026-07-22T23:59:55.000Z'),
    lastSuccessfulTickAt: new Date('2026-07-22T23:59:55.000Z'),
    consecutiveDatabaseFailures: 0,
    ...overrides,
  };
}

test('preflight requires a disabled worker while canary requires an enabled running worker', () => {
  const snapshot = healthySnapshot();
  assert.deepEqual(evaluateEventRollout({ mode: 'preflight', snapshot, config }).alerts, [{
    code: 'EVENT_OBS_MODE_MISMATCH', severity: 'BLOCKED', value: true, threshold: false,
  }]);
  assert.equal(evaluateEventRollout({ mode: 'canary', snapshot, config }).status, 'READY');
});

test('preflight accepts only an aligned disabled runtime', () => {
  const disabled = evaluateEventRollout({
    mode: 'preflight',
    snapshot: healthySnapshot({
      workerConfiguredEnabled: false,
      workerState: 'DISABLED',
      workerProcessStartedAt: null,
      lastHeartbeatAt: null,
      lastSuccessfulTickAt: null,
      consecutiveDatabaseFailures: null,
    }),
    config,
  });
  assert.equal(disabled.status, 'READY');

  for (const overrides of [
    { workerConfiguredEnabled: false, workerState: 'RUNNING' as const },
    { workerConfiguredEnabled: true, workerState: 'DISABLED' as const },
    { workerConfiguredEnabled: true, workerState: 'RUNNING' as const },
  ]) {
    assert.deepEqual(
      evaluateEventRollout({ mode: 'preflight', snapshot: healthySnapshot(overrides), config }).alerts[0],
      { code: 'EVENT_OBS_MODE_MISMATCH', severity: 'BLOCKED', value: true, threshold: false },
    );
  }
});

test('manual events block rollout at the first event', () => {
  const snapshot = healthySnapshot();
  assert.deepEqual(
    evaluateEventRollout({ mode: 'canary', snapshot: { ...snapshot, manualCount: 1 }, config }).alerts,
    [{ code: 'EVENT_OBS_MANUAL_PRESENT', severity: 'BLOCKED', value: 1, threshold: 1 }],
  );
});

test('rollout policy applies thresholds inclusively', () => {
  const cases: Array<{
    name: string;
    below: Partial<EventRuntimeSnapshot>;
    at: Partial<EventRuntimeSnapshot>;
    code: string;
    severity: 'DEGRADED' | 'BLOCKED';
  }> = [
    {
      name: 'unresolved dispatcher faults',
      below: { unresolvedDispatcherFaultCount: 0 },
      at: { unresolvedDispatcherFaultCount: 1 },
      code: 'EVENT_OBS_DISPATCHER_FAULT',
      severity: 'BLOCKED',
    },
    {
      name: 'same-process database failures',
      below: { consecutiveDatabaseFailures: 2 },
      at: { consecutiveDatabaseFailures: 3 },
      code: 'EVENT_OBS_DATABASE_FAILURES',
      severity: 'BLOCKED',
    },
    {
      name: 'worker tick staleness',
      below: { lastSuccessfulTickAt: new Date('2026-07-22T23:59:01.000Z') },
      at: { lastSuccessfulTickAt: new Date('2026-07-22T23:59:00.000Z') },
      code: 'EVENT_OBS_WORKER_TICK_STALE',
      severity: 'BLOCKED',
    },
    {
      name: 'undispatched age',
      below: { undispatchedCount: 1, oldestUndispatchedSeconds: 119 },
      at: { undispatchedCount: 1, oldestUndispatchedSeconds: 120 },
      code: 'EVENT_OBS_UNDISPATCHED_STALE',
      severity: 'BLOCKED',
    },
    {
      name: 'due backlog age',
      below: { dueBacklogCount: 1, oldestDueBacklogSeconds: 299 },
      at: { dueBacklogCount: 1, oldestDueBacklogSeconds: 300 },
      code: 'EVENT_OBS_DUE_BACKLOG_STALE',
      severity: 'BLOCKED',
    },
    {
      name: 'lease loss degraded threshold',
      below: { leaseLost15mCount: 0 },
      at: { leaseLost15mCount: 1 },
      code: 'EVENT_OBS_LEASE_LOST',
      severity: 'DEGRADED',
    },
    {
      name: 'lease loss blocked threshold',
      below: { leaseLost15mCount: 2 },
      at: { leaseLost15mCount: 3 },
      code: 'EVENT_OBS_LEASE_LOST_EXCESSIVE',
      severity: 'BLOCKED',
    },
    {
      name: 'stale processing leases',
      below: { staleExpiredProcessingCount: 0 },
      at: { staleExpiredProcessingCount: 1 },
      code: 'EVENT_OBS_PROCESSING_LEASE_STALE',
      severity: 'BLOCKED',
    },
  ];

  for (const scenario of cases) {
    const below = evaluateEventRollout({ mode: 'canary', snapshot: healthySnapshot(scenario.below), config });
    assert.equal(below.alerts.some(alert => alert.code === scenario.code), false, scenario.name);

    const at = evaluateEventRollout({ mode: 'canary', snapshot: healthySnapshot(scenario.at), config });
    assert.deepEqual(
      at.alerts.find(alert => alert.code === scenario.code),
      {
        code: scenario.code,
        severity: scenario.severity,
        value: scenario.code === 'EVENT_OBS_WORKER_TICK_STALE'
          ? 60
          : scenario.code === 'EVENT_OBS_UNDISPATCHED_STALE'
            ? 120
            : scenario.code === 'EVENT_OBS_DUE_BACKLOG_STALE'
              ? 300
              : scenario.code === 'EVENT_OBS_LEASE_LOST'
                ? 1
                : scenario.code === 'EVENT_OBS_LEASE_LOST_EXCESSIVE'
                  ? 3
                  : scenario.code === 'EVENT_OBS_DATABASE_FAILURES' ? 3 : 1,
        threshold: scenario.code === 'EVENT_OBS_WORKER_TICK_STALE'
          ? 60
          : scenario.code === 'EVENT_OBS_UNDISPATCHED_STALE'
            ? 120
            : scenario.code === 'EVENT_OBS_DUE_BACKLOG_STALE'
              ? 300
              : scenario.code === 'EVENT_OBS_LEASE_LOST'
                ? 1
                : scenario.code === 'EVENT_OBS_LEASE_LOST_EXCESSIVE'
                  ? 3
                  : scenario.code === 'EVENT_OBS_DATABASE_FAILURES' ? 3 : 1,
      },
      scenario.name,
    );
  }
});

test('canary blocks configuration and runtime mismatches, with a bounded STARTING grace period', () => {
  const mismatches: Array<Partial<EventRuntimeSnapshot>> = [
    { workerConfiguredEnabled: false },
    { workerState: 'DISABLED' },
    { workerState: 'STOPPED' },
    { workerState: null },
    { workerConfiguredEnabled: null },
    { workerState: 'STARTING', workerProcessStartedAt: null },
    { workerState: 'STARTING', workerProcessStartedAt: new Date('2026-07-22T23:59:00.000Z') },
  ];
  for (const overrides of mismatches) {
    const evaluation = evaluateEventRollout({ mode: 'canary', snapshot: healthySnapshot(overrides), config });
    assert.deepEqual(evaluation.alerts[0], {
      code: 'EVENT_OBS_MODE_MISMATCH',
      severity: 'BLOCKED',
      value: true,
      threshold: false,
    });
  }

  const starting = evaluateEventRollout({
    mode: 'canary',
    snapshot: healthySnapshot({
      workerState: 'STARTING',
      workerProcessStartedAt: new Date('2026-07-22T23:59:01.000Z'),
    }),
    config,
  });
  assert.deepEqual(starting.alerts, [{
    code: 'EVENT_OBS_MODE_MISMATCH',
    severity: 'DEGRADED',
    value: true,
    threshold: false,
  }]);
});

test('preflight blocks an enabled STARTING worker even inside canary grace', () => {
  const evaluation = evaluateEventRollout({
    mode: 'preflight',
    snapshot: healthySnapshot({
      workerState: 'STARTING',
      workerProcessStartedAt: new Date('2026-07-22T23:59:01.000Z'),
    }),
    config,
  });
  assert.deepEqual(evaluation.alerts, [{
    code: 'EVENT_OBS_MODE_MISMATCH', severity: 'BLOCKED', value: true, threshold: false,
  }]);
});

test('missing runtime state blocks without manufacturing database or tick alerts', () => {
  const evaluation = evaluateEventRollout({
    mode: 'canary',
    snapshot: healthySnapshot({
      workerConfiguredEnabled: null,
      workerState: null,
      workerProcessStartedAt: null,
      lastHeartbeatAt: null,
      lastSuccessfulTickAt: null,
      consecutiveDatabaseFailures: null,
    }),
    config,
  });
  assert.deepEqual(evaluation.alerts, [
    { code: 'EVENT_OBS_MODE_MISMATCH', severity: 'BLOCKED', value: true, threshold: false },
  ]);
});

test('database failures are evaluated only with a same-process runtime start', () => {
  const sameProcess = evaluateEventRollout({
    mode: 'canary',
    snapshot: healthySnapshot({ consecutiveDatabaseFailures: 3 }),
    config,
  });
  assert.deepEqual(sameProcess.alerts.find(alert => alert.code === 'EVENT_OBS_DATABASE_FAILURES'), {
    code: 'EVENT_OBS_DATABASE_FAILURES',
    severity: 'BLOCKED',
    value: 3,
    threshold: 3,
  });

  const noProcessStart = evaluateEventRollout({
    mode: 'canary',
    snapshot: healthySnapshot({ workerProcessStartedAt: null, consecutiveDatabaseFailures: 3 }),
    config,
  });
  assert.equal(noProcessStart.alerts.some(alert => alert.code === 'EVENT_OBS_DATABASE_FAILURES'), false);
  assert.equal(noProcessStart.alerts[0]?.code, 'EVENT_OBS_MODE_MISMATCH');
});

test('RUNNING requires both heartbeat and successful-tick timestamps', () => {
  for (const overrides of [
    { lastHeartbeatAt: null },
    { lastSuccessfulTickAt: null },
    { lastHeartbeatAt: null, lastSuccessfulTickAt: null },
  ]) {
    assert.deepEqual(evaluateEventRollout({ mode: 'canary', snapshot: healthySnapshot(overrides), config }).alerts, [{
      code: 'EVENT_OBS_MODE_MISMATCH', severity: 'BLOCKED', value: true, threshold: false,
    }]);
  }
});

test('lease loss is degraded from the degraded threshold until the blocked threshold', () => {
  for (const leaseLost15mCount of [config.leaseLostDegradedCount, config.leaseLostBlockedCount - 1]) {
    const evaluation = evaluateEventRollout({
      mode: 'canary',
      snapshot: healthySnapshot({ leaseLost15mCount }),
      config,
    });
    assert.deepEqual(evaluation.alerts, [{
      code: 'EVENT_OBS_LEASE_LOST',
      severity: 'DEGRADED',
      value: leaseLost15mCount,
      threshold: config.leaseLostDegradedCount,
    }]);
    assert.equal(evaluation.status, 'DEGRADED');
  }

  const blocked = evaluateEventRollout({
    mode: 'canary',
    snapshot: healthySnapshot({ leaseLost15mCount: config.leaseLostBlockedCount }),
    config,
  });
  assert.deepEqual(blocked.alerts, [{
    code: 'EVENT_OBS_LEASE_LOST_EXCESSIVE',
    severity: 'BLOCKED',
    value: config.leaseLostBlockedCount,
    threshold: config.leaseLostBlockedCount,
  }]);
});

test('alerts are stable: BLOCKED precedes DEGRADED and codes sort within a severity', () => {
  const evaluation = evaluateEventRollout({
    mode: 'canary',
    snapshot: healthySnapshot({
      manualCount: 1,
      unresolvedDispatcherFaultCount: 1,
      leaseLost15mCount: 1,
    }),
    config,
  });
  assert.deepEqual(evaluation.alerts.map(alert => [alert.severity, alert.code]), [
    ['BLOCKED', 'EVENT_OBS_DISPATCHER_FAULT'],
    ['BLOCKED', 'EVENT_OBS_MANUAL_PRESENT'],
    ['DEGRADED', 'EVENT_OBS_LEASE_LOST'],
  ]);
  assert.equal(evaluation.status, 'BLOCKED');
});

test('evaluation validates counts and returns defensive date copies without internal runtime fields', () => {
  assert.throws(
    () => evaluateEventRollout({ mode: 'canary', snapshot: healthySnapshot({ manualCount: Number.NaN }), config }),
    /manualCount.*finite non-negative/i,
  );
  assert.throws(
    () => evaluateEventRollout({ mode: 'canary', snapshot: healthySnapshot({ oldestDueBacklogSeconds: -1 }), config }),
    /oldestDueBacklogSeconds.*finite non-negative/i,
  );

  const snapshot = healthySnapshot();
  const evaluation = evaluateEventRollout({ mode: 'canary', snapshot, config });
  assert.notEqual(evaluation.evaluatedAt, snapshot.evaluatedAt);
  assert.notEqual(evaluation.metrics.lastHeartbeatAt, snapshot.lastHeartbeatAt);
  assert.notEqual(evaluation.metrics.lastSuccessfulTickAt, snapshot.lastSuccessfulTickAt);
  snapshot.evaluatedAt.setUTCFullYear(2000);
  snapshot.lastHeartbeatAt?.setUTCFullYear(2000);
  snapshot.lastSuccessfulTickAt?.setUTCFullYear(2000);
  assert.equal(evaluation.evaluatedAt.toISOString(), '2026-07-23T00:00:00.000Z');
  assert.equal(evaluation.metrics.lastHeartbeatAt?.toISOString(), '2026-07-22T23:59:55.000Z');
  assert.equal(evaluation.metrics.lastSuccessfulTickAt?.toISOString(), '2026-07-22T23:59:55.000Z');
  assert.deepEqual(Object.keys(evaluation.metrics).sort(), [
    'dueBacklogCount',
    'expiredProcessingCount',
    'lastHeartbeatAt',
    'lastSuccessfulTickAt',
    'leaseLost15mCount',
    'manualCount',
    'oldestDueBacklogSeconds',
    'oldestUndispatchedSeconds',
    'processingCount',
    'staleExpiredProcessingCount',
    'undispatchedCount',
  ]);
});
