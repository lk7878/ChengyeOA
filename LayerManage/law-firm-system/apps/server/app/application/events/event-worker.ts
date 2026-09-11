import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { PermanentEventError, RetryableEventError } from '../../domain/events/event-errors';
import { retryDecision } from '../../domain/events/retry-policy';
import { RetryDecision } from '../../domain/events/event-types';
import {
  ClaimedEventDelivery,
  EventDeliveryStore,
  EventHandler,
  EventHandlerExecutionResult,
  EventHandlerInvocationError,
  SafeEventHandlerFailure,
} from './event-delivery-store';
import { EventHandlerRegistry } from './event-handler-registry';
import { EventHealthService } from './event-health-service';
import type { EventWorkerRuntimeStatusStore } from './event-worker-runtime-status-store';

export type { EventHandler, EventHandlerContext } from './event-delivery-store';

const DATABASE_BACKOFF_MS = [ 1_000, 2_000, 5_000, 10_000, 30_000 ] as const;

export interface WorkerTickResult {
  readonly dispatched: number;
  readonly claimed: number;
  readonly succeeded: number;
  readonly retryScheduled: number;
  readonly manual: number;
  readonly leaseLost: number;
}

export interface EventWorkerConfig {
  readonly pollMs: number;
  readonly batchSize: number;
  readonly leaseSeconds: number;
}

export interface EventWorkerTimer {
  unref?(): void;
  readonly token?: unknown;
}

export interface EventWorkerScheduler {
  setTimeout(callback: () => void | Promise<void>, delayMs: number): EventWorkerTimer;
  clearTimeout(handle: EventWorkerTimer): void;
}

interface EventDispatcherPort {
  dispatchBatch(limit: number): Promise<{
    readonly dispatchedCount: number;
    readonly deliveryCount: number;
    readonly manualCount: number;
  }>;
}

interface EventDeliveryStorePort {
  claimBatch(input: { readonly workerId: string; readonly limit: number }): Promise<ClaimedEventDelivery[]>;
  executeHandler?(claim: ClaimedEventDelivery, handler: EventHandler): Promise<EventHandlerExecutionResult>;
  recordFailure?(claim: ClaimedEventDelivery, failure: SafeEventHandlerFailure): Promise<EventHandlerExecutionResult>;
}

export interface EventWorkerOptions {
  readonly prisma: PrismaClient;
  readonly dispatcher: EventDispatcherPort;
  readonly registry: EventHandlerRegistry;
  readonly health: EventHealthService;
  readonly workerId: string;
  readonly config: EventWorkerConfig;
  readonly deliveryStore?: EventDeliveryStorePort;
  readonly now?: () => Date;
  readonly scheduler?: EventWorkerScheduler;
  readonly waitForTimeout?: (timeoutMs: number) => Promise<void>;
  readonly isDatabaseError?: (error: unknown) => boolean;
  readonly runtimeStatus?: Pick<EventWorkerRuntimeStatusStore, 'recordHeartbeat'>;
  /**
   * SPEC-009 Task 9：可选的 tick 旁挂监听（LeadRecycleScanner.scanOnce 注入点）。
   * 每次 tick() 正常完成后以 try/catch 隔离调用：listener 抛错仅记日志
   * （[lead-recycle-scanner] 前缀），绝不影响投递循环结果；单条投递失败
   * （已记录为证据）也不阻止 listener 执行。tick 自身抛出（如数据库故障）
   * 时不调用 listener——此时扫描同样无法工作。
   */
  readonly tickListener?: (now: Date) => Promise<void>;
}

export class EventWorker {
  private readonly now: () => Date;
  private readonly scheduler: EventWorkerScheduler;
  private readonly waitForTimeout: (timeoutMs: number) => Promise<void>;
  private readonly deliveryStore: EventDeliveryStorePort;
  private readonly isDatabaseError: (error: unknown) => boolean;
  private timer: EventWorkerTimer | null = null;
  private inFlight: Promise<WorkerTickResult> | null = null;
  private started = false;
  private stopping = false;
  private terminal = false;
  private scheduledDatabaseFailureCount = 0;

  constructor(private readonly options: EventWorkerOptions) {
    validateWorkerConfig(options.config);
    assertWorkerId(options.workerId);
    this.now = options.now ?? (() => new Date());
    this.scheduler = options.scheduler ?? nativeScheduler;
    this.waitForTimeout = options.waitForTimeout ?? waitWithUnrefTimer;
    this.isDatabaseError = options.isDatabaseError ?? isPrismaDatabaseUnavailable;
    this.deliveryStore = options.deliveryStore ?? new EventDeliveryStore(options.prisma, {
      leaseSeconds: options.config.leaseSeconds,
      now: this.now,
    });
  }

  tick(): Promise<WorkerTickResult> {
    if (this.stopping) return Promise.resolve(emptyTickResult());
    if (this.inFlight) return this.inFlight;

    const tracked = this.runTick().finally(() => {
      if (this.inFlight === tracked) this.inFlight = null;
    });
    this.inFlight = tracked;
    return tracked;
  }

  start(): void {
    if (this.started || this.terminal) return;
    this.started = true;
    this.stopping = false;
    this.scheduledDatabaseFailureCount = 0;
    this.schedule(0);
  }

  async stop(timeoutMs: number): Promise<void> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      throw new RangeError('Event worker stop timeout must be a non-negative integer');
    }
    this.stopping = true;
    this.started = false;
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    const inFlight = this.inFlight;
    if (!inFlight) return;
    const outcome = await Promise.race([
      inFlight.then(() => 'stopped' as const, () => 'stopped' as const),
      this.waitForTimeout(timeoutMs).then(() => 'timeout' as const),
    ]);
    if (outcome === 'timeout') {
      this.terminal = true;
      throw new Error('Event worker shutdown timed out');
    }
  }

  private async runTick(): Promise<WorkerTickResult> {
    try {
      const dispatchResult = await this.options.dispatcher.dispatchBatch(this.options.config.batchSize);
      if (this.stopping) return { ...emptyTickResult(), dispatched: dispatchResult.dispatchedCount };
      const claims = await this.deliveryStore.claimBatch({
        workerId: this.options.workerId,
        limit: this.options.config.batchSize,
      });
      const result: MutableWorkerTickResult = {
        dispatched: dispatchResult.dispatchedCount,
        claimed: claims.length,
        succeeded: 0,
        retryScheduled: 0,
        manual: dispatchResult.manualCount,
        leaseLost: 0,
      };

      for (const claim of claims) {
        const outcome = await this.processClaim(claim);
        if (outcome.kind === 'SUCCEEDED') result.succeeded += 1;
        else if (outcome.kind === 'RETRY_WAIT') result.retryScheduled += 1;
        else if (outcome.kind === 'MANUAL') result.manual += 1;
        else result.leaseLost += 1;
      }
      const successfulTickAt = validNow(this.now());
      if (this.started && !this.stopping && this.options.runtimeStatus) {
        await this.options.runtimeStatus.recordHeartbeat(successfulTickAt);
      }
      this.options.health.recordSuccessfulTick(successfulTickAt);
      if (this.options.tickListener) {
        try {
          await this.options.tickListener(successfulTickAt);
        } catch (listenerError) {
          // 隔离纪律（设计 §6.5）：listener 失败只留独立可辨识日志，绝不回馈到投递结果。
          console.error(
            '[lead-recycle-scanner] tick listener failed: %s',
            listenerError instanceof Error ? listenerError.message : String(listenerError),
          );
        }
      }
      return result;
    } catch (error) {
      if (this.isDatabaseError(error)) {
        this.options.health.recordDatabaseFailure(validNow(this.now()));
      }
      throw error;
    }
  }

  private async processClaim(claim: ClaimedEventDelivery): Promise<EventHandlerExecutionResult> {
    const executeHandler = this.deliveryStore.executeHandler?.bind(this.deliveryStore);
    const recordFailure = this.deliveryStore.recordFailure?.bind(this.deliveryStore);
    if (!executeHandler || !recordFailure) {
      throw new Error('Event delivery store does not support handler outcomes');
    }
    const handler = this.options.registry.resolve(claim.handlerCode, claim.eventType, claim.eventVersion);
    if (!handler) {
      return recordFailure(claim, {
        errorCode: 'EVENT_HANDLER_UNKNOWN',
        errorReference: randomUUID(),
        decision: { kind: 'MANUAL' },
      });
    }

    try {
      return await executeHandler(claim, handler);
    } catch (error) {
      if (!(error instanceof EventHandlerInvocationError)) throw error;
      if (this.isDatabaseError(error.handlerError)) throw error.handlerError;
      return recordFailure(claim, safeFailure(error.handlerError, claim));
    }
  }

  private schedule(delayMs: number): void {
    if (!this.started || this.stopping) return;
    const timer = this.scheduler.setTimeout(async () => {
      if (this.timer === timer) this.timer = null;
      if (!this.started || this.stopping) return;
      let nextDelay = this.options.config.pollMs;
      try {
        await this.tick();
        this.scheduledDatabaseFailureCount = 0;
      } catch (error) {
        if (this.isDatabaseError(error)) {
          const index = Math.min(this.scheduledDatabaseFailureCount, DATABASE_BACKOFF_MS.length - 1);
          nextDelay = DATABASE_BACKOFF_MS[index];
          this.scheduledDatabaseFailureCount += 1;
        } else {
          nextDelay = DATABASE_BACKOFF_MS[0];
        }
      }
      this.schedule(nextDelay);
    }, delayMs);
    this.timer = timer;
    timer.unref?.();
  }
}

type MutableWorkerTickResult = {
  -readonly [Key in keyof WorkerTickResult]: WorkerTickResult[Key];
};

export function retryDecisionForFailure(attemptNumber: number, manualRetryCount: number): RetryDecision {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new RangeError('Event handler attempt number must be a positive integer');
  }
  if (!Number.isSafeInteger(manualRetryCount) || manualRetryCount < 0) {
    throw new RangeError('Event handler manual retry count must be a non-negative integer');
  }
  if (manualRetryCount > 0) return { kind: 'MANUAL' };
  return retryDecision(attemptNumber);
}

function safeFailure(error: unknown, claim: ClaimedEventDelivery): SafeEventHandlerFailure {
  const reference = randomUUID();
  if (error instanceof PermanentEventError && isSafeErrorCode(error.code)) {
    return { errorCode: error.code, errorReference: reference, decision: { kind: 'MANUAL' } };
  }
  if (error instanceof RetryableEventError && isSafeErrorCode(error.code)) {
    return {
      errorCode: error.code,
      errorReference: reference,
      decision: retryDecisionForFailure(claim.attemptNumber, claim.manualRetryCount),
    };
  }
  return {
    errorCode: 'EVENT_HANDLER_UNKNOWN',
    errorReference: reference,
    decision: retryDecisionForFailure(claim.attemptNumber, claim.manualRetryCount),
  };
}

function isSafeErrorCode(code: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(code);
}

function isPrismaDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return /^P10(?:0\d|1[0-7])$/.test(error.code) || error.code === 'P2024' || error.code === 'P2037';
  }
  return false;
}

function emptyTickResult(): WorkerTickResult {
  return { dispatched: 0, claimed: 0, succeeded: 0, retryScheduled: 0, manual: 0, leaseLost: 0 };
}

function validateWorkerConfig(config: EventWorkerConfig): void {
  assertIntegerRange(config.pollMs, 250, 60_000, 'Event worker poll milliseconds');
  assertIntegerRange(config.batchSize, 1, 200, 'Event worker batch size');
  assertIntegerRange(config.leaseSeconds, 30, 600, 'Event worker lease seconds');
}

function assertIntegerRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
}

function assertWorkerId(workerId: string): void {
  if (typeof workerId !== 'string' || workerId.length < 1 || workerId.length > 200) {
    throw new TypeError('Event worker ID must be between 1 and 200 characters');
  }
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('Event worker clock returned an invalid date');
  return new Date(value.getTime());
}

const nativeScheduler: EventWorkerScheduler = {
  setTimeout(callback, delayMs) {
    return setTimeout(() => { void callback(); }, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

function waitWithUnrefTimer(timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref();
  });
}
