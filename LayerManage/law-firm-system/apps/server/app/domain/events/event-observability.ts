import type { EventObservabilityEnvironment } from '../../../config/env';

export type EventRolloutMode = 'preflight' | 'canary';
export type EventRolloutStatus = 'READY' | 'DEGRADED' | 'BLOCKED';
export type EventRolloutAlertCode =
  | 'EVENT_OBS_MODE_MISMATCH'
  | 'EVENT_OBS_MANUAL_PRESENT'
  | 'EVENT_OBS_DISPATCHER_FAULT'
  | 'EVENT_OBS_DATABASE_FAILURES'
  | 'EVENT_OBS_WORKER_TICK_STALE'
  | 'EVENT_OBS_UNDISPATCHED_STALE'
  | 'EVENT_OBS_DUE_BACKLOG_STALE'
  | 'EVENT_OBS_LEASE_LOST'
  | 'EVENT_OBS_LEASE_LOST_EXCESSIVE'
  | 'EVENT_OBS_PROCESSING_LEASE_STALE';

export interface EventRolloutAlert {
  readonly code: EventRolloutAlertCode;
  readonly severity: 'DEGRADED' | 'BLOCKED';
  readonly value: number | boolean | null;
  readonly threshold: number | boolean | null;
}

export type EventWorkerRuntimeState = 'DISABLED' | 'STARTING' | 'RUNNING' | 'STOPPED';

export interface EventRuntimeSnapshot {
  readonly evaluatedAt: Date;
  readonly undispatchedCount: number;
  readonly oldestUndispatchedSeconds: number;
  readonly dueBacklogCount: number;
  readonly oldestDueBacklogSeconds: number;
  readonly manualCount: number;
  readonly unresolvedDispatcherFaultCount: number;
  readonly processingCount: number;
  readonly expiredProcessingCount: number;
  readonly staleExpiredProcessingCount: number;
  readonly leaseLost15mCount: number;
  readonly workerConfiguredEnabled: boolean | null;
  readonly workerState: EventWorkerRuntimeState | null;
  readonly workerProcessStartedAt: Date | null;
  readonly lastHeartbeatAt: Date | null;
  readonly lastSuccessfulTickAt: Date | null;
  readonly consecutiveDatabaseFailures: number | null;
}

export interface EventObservabilityMetrics {
  readonly undispatchedCount: number;
  readonly oldestUndispatchedSeconds: number;
  readonly dueBacklogCount: number;
  readonly oldestDueBacklogSeconds: number;
  readonly manualCount: number;
  readonly processingCount: number;
  readonly expiredProcessingCount: number;
  readonly staleExpiredProcessingCount: number;
  readonly leaseLost15mCount: number;
  readonly lastSuccessfulTickAt: Date | null;
  readonly lastHeartbeatAt: Date | null;
}

export interface EventRolloutEvaluation {
  readonly status: EventRolloutStatus;
  readonly mode: EventRolloutMode;
  readonly evaluatedAt: Date;
  readonly metrics: EventObservabilityMetrics;
  readonly alerts: readonly EventRolloutAlert[];
}

export interface EvaluateEventRolloutInput {
  readonly mode: EventRolloutMode;
  readonly snapshot: EventRuntimeSnapshot;
  readonly config: EventObservabilityEnvironment;
}

export function evaluateEventRollout(input: EvaluateEventRolloutInput): EventRolloutEvaluation {
  const { config, mode, snapshot } = input;
  validateSnapshot(snapshot);

  const alerts: EventRolloutAlert[] = [];
  const startingWithinGrace = isStartingWithinGrace(snapshot, config);
  const runningRuntime = snapshot.workerConfiguredEnabled === true
    && snapshot.workerState === 'RUNNING'
    && snapshot.workerProcessStartedAt !== null
    && snapshot.lastHeartbeatAt !== null
    && snapshot.lastSuccessfulTickAt !== null;
  const runtimeAligned = mode === 'canary'
    ? runningRuntime
    : snapshot.workerConfiguredEnabled === false && snapshot.workerState === 'DISABLED';

  if (!runtimeAligned) {
    alerts.push({
      code: 'EVENT_OBS_MODE_MISMATCH',
      severity: mode === 'canary' && startingWithinGrace ? 'DEGRADED' : 'BLOCKED',
      value: true,
      threshold: false,
    });
  }

  if (snapshot.manualCount >= 1) {
    alerts.push(blocked('EVENT_OBS_MANUAL_PRESENT', snapshot.manualCount, 1));
  }
  if (snapshot.unresolvedDispatcherFaultCount >= 1) {
    alerts.push(blocked('EVENT_OBS_DISPATCHER_FAULT', snapshot.unresolvedDispatcherFaultCount, 1));
  }
  if (snapshot.workerProcessStartedAt && snapshot.consecutiveDatabaseFailures !== null
    && snapshot.consecutiveDatabaseFailures >= 3) {
    alerts.push(blocked('EVENT_OBS_DATABASE_FAILURES', snapshot.consecutiveDatabaseFailures, 3));
  }

  const tickAgeSeconds = oldestRuntimeAgeSeconds(snapshot);
  if (runtimeAligned && tickAgeSeconds !== null && tickAgeSeconds >= config.heartbeatStaleSeconds) {
    alerts.push(blocked('EVENT_OBS_WORKER_TICK_STALE', tickAgeSeconds, config.heartbeatStaleSeconds));
  }
  if (snapshot.undispatchedCount > 0 && snapshot.oldestUndispatchedSeconds >= config.undispatchedBlockSeconds) {
    alerts.push(blocked('EVENT_OBS_UNDISPATCHED_STALE', snapshot.oldestUndispatchedSeconds, config.undispatchedBlockSeconds));
  }
  if (snapshot.dueBacklogCount > 0 && snapshot.oldestDueBacklogSeconds >= config.dueBacklogBlockSeconds) {
    alerts.push(blocked('EVENT_OBS_DUE_BACKLOG_STALE', snapshot.oldestDueBacklogSeconds, config.dueBacklogBlockSeconds));
  }
  if (snapshot.leaseLost15mCount >= config.leaseLostBlockedCount) {
    alerts.push(blocked('EVENT_OBS_LEASE_LOST_EXCESSIVE', snapshot.leaseLost15mCount, config.leaseLostBlockedCount));
  } else if (snapshot.leaseLost15mCount >= config.leaseLostDegradedCount) {
    alerts.push({
      code: 'EVENT_OBS_LEASE_LOST',
      severity: 'DEGRADED',
      value: snapshot.leaseLost15mCount,
      threshold: config.leaseLostDegradedCount,
    });
  }
  if (snapshot.staleExpiredProcessingCount >= 1) {
    alerts.push(blocked('EVENT_OBS_PROCESSING_LEASE_STALE', snapshot.staleExpiredProcessingCount, 1));
  }

  alerts.sort((left, right) => severityOrder(left.severity) - severityOrder(right.severity)
    || left.code.localeCompare(right.code));
  return {
    status: alerts.some(alert => alert.severity === 'BLOCKED')
      ? 'BLOCKED'
      : alerts.length > 0 ? 'DEGRADED' : 'READY',
    mode,
    evaluatedAt: copyDate(snapshot.evaluatedAt),
    metrics: {
      undispatchedCount: snapshot.undispatchedCount,
      oldestUndispatchedSeconds: snapshot.oldestUndispatchedSeconds,
      dueBacklogCount: snapshot.dueBacklogCount,
      oldestDueBacklogSeconds: snapshot.oldestDueBacklogSeconds,
      manualCount: snapshot.manualCount,
      processingCount: snapshot.processingCount,
      expiredProcessingCount: snapshot.expiredProcessingCount,
      staleExpiredProcessingCount: snapshot.staleExpiredProcessingCount,
      leaseLost15mCount: snapshot.leaseLost15mCount,
      lastSuccessfulTickAt: copyNullableDate(snapshot.lastSuccessfulTickAt),
      lastHeartbeatAt: copyNullableDate(snapshot.lastHeartbeatAt),
    },
    alerts,
  };
}

function blocked(code: EventRolloutAlertCode, value: number, threshold: number): EventRolloutAlert {
  return { code, severity: 'BLOCKED', value, threshold };
}

function severityOrder(severity: EventRolloutAlert['severity']): number {
  return severity === 'BLOCKED' ? 0 : 1;
}

function isStartingWithinGrace(snapshot: EventRuntimeSnapshot, config: EventObservabilityEnvironment): boolean {
  if (snapshot.workerConfiguredEnabled !== true || snapshot.workerState !== 'STARTING' || !snapshot.workerProcessStartedAt) {
    return false;
  }
  const elapsedSeconds = (snapshot.evaluatedAt.getTime() - snapshot.workerProcessStartedAt.getTime()) / 1_000;
  return elapsedSeconds >= 0 && elapsedSeconds < config.heartbeatStaleSeconds;
}

function oldestRuntimeAgeSeconds(snapshot: EventRuntimeSnapshot): number | null {
  const ages = [snapshot.lastHeartbeatAt, snapshot.lastSuccessfulTickAt]
    .filter((value): value is Date => value !== null)
    .map(value => Math.max(0, (snapshot.evaluatedAt.getTime() - value.getTime()) / 1_000));
  return ages.length === 0 ? null : Math.max(...ages);
}

function validateSnapshot(snapshot: EventRuntimeSnapshot): void {
  for (const [name, value] of Object.entries({
    undispatchedCount: snapshot.undispatchedCount,
    oldestUndispatchedSeconds: snapshot.oldestUndispatchedSeconds,
    dueBacklogCount: snapshot.dueBacklogCount,
    oldestDueBacklogSeconds: snapshot.oldestDueBacklogSeconds,
    manualCount: snapshot.manualCount,
    unresolvedDispatcherFaultCount: snapshot.unresolvedDispatcherFaultCount,
    processingCount: snapshot.processingCount,
    expiredProcessingCount: snapshot.expiredProcessingCount,
    staleExpiredProcessingCount: snapshot.staleExpiredProcessingCount,
    leaseLost15mCount: snapshot.leaseLost15mCount,
  })) {
    validateFiniteNonNegative(name, value);
  }
  if (snapshot.consecutiveDatabaseFailures !== null) {
    validateFiniteNonNegative('consecutiveDatabaseFailures', snapshot.consecutiveDatabaseFailures);
  }
  validateDate('evaluatedAt', snapshot.evaluatedAt);
  for (const [name, value] of [
    ['workerProcessStartedAt', snapshot.workerProcessStartedAt],
    ['lastHeartbeatAt', snapshot.lastHeartbeatAt],
    ['lastSuccessfulTickAt', snapshot.lastSuccessfulTickAt],
  ] as const) {
    if (value !== null) validateDate(name, value);
  }
}

function validateFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
}

function validateDate(name: string, value: Date): void {
  if (Number.isNaN(value.getTime())) throw new Error(`${name} must be a valid date`);
}

function copyDate(value: Date): Date {
  return new Date(value.getTime());
}

function copyNullableDate(value: Date | null): Date | null {
  return value === null ? null : copyDate(value);
}
