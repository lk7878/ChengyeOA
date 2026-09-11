import { randomUUID } from 'node:crypto';

export type EventHealthErrorCode =
  | 'HANDLER_NOT_REGISTERED'
  | 'SUBSCRIPTION_FILTER_INVALID'
  | 'EVENT_ENVELOPE_INVALID'
  | 'EVENT_WORKER_DATABASE_FAILURE';

export interface EventHealthSnapshot {
  readonly status: 'healthy' | 'degraded';
  readonly workerEnabled: boolean;
  readonly unknownHandlerCount: number;
  readonly invalidFilterCount: number;
  readonly invalidEnvelopeCount: number;
  readonly lastDegradedAt: Date | null;
  readonly lastErrorCode: EventHealthErrorCode | null;
  readonly lastErrorReference: string | null;
}

export interface EventHealthFault {
  readonly code: EventHealthErrorCode;
  readonly reference: string;
}

export interface EventWorkerHealthSnapshot {
  readonly status: 'healthy' | 'degraded';
  readonly workerEnabled: boolean;
  readonly lastSuccessfulTickAt: Date | null;
  readonly lastDatabaseFailureAt: Date | null;
  readonly consecutiveDatabaseFailures: number;
  readonly databaseFailureTotal: number;
  readonly lastErrorCode: 'EVENT_WORKER_DATABASE_FAILURE' | null;
  readonly lastErrorReference: string | null;
}

export interface PersistentDispatcherHealthSnapshot {
  readonly unknownHandlerCount: number;
  readonly invalidFilterCount: number;
  readonly invalidEnvelopeCount: number;
  readonly unresolvedDispatcherFaultCount: number;
  readonly lastDegradedAt: Date | null;
  readonly lastErrorCode: Exclude<EventHealthErrorCode, 'EVENT_WORKER_DATABASE_FAILURE'> | null;
  readonly lastErrorReference: string | null;
}

export interface EventOperationsHealthSnapshot extends Omit<EventWorkerHealthSnapshot, 'lastErrorCode'> {
  readonly unknownHandlerCount: number;
  readonly invalidFilterCount: number;
  readonly invalidEnvelopeCount: number;
  readonly unresolvedDispatcherFaultCount: number;
  readonly lastDegradedAt: Date | null;
  readonly lastErrorCode: EventHealthErrorCode | null;
}

export class EventHealthService {
  private unknownHandlerCount = 0;
  private invalidFilterCount = 0;
  private invalidEnvelopeCount = 0;
  private lastDegradedAt: Date | null = null;
  private lastErrorCode: EventHealthErrorCode | null = null;
  private lastErrorReference: string | null = null;
  private lastSuccessfulTickAt: Date | null = null;
  private lastDatabaseFailureAt: Date | null = null;
  private consecutiveDatabaseFailures = 0;
  private databaseFailureTotal = 0;
  private lastWorkerErrorReference: string | null = null;

  constructor(private readonly workerEnabled: boolean) {}

  createUnknownHandlerFault(): EventHealthFault {
    return this.createFault('HANDLER_NOT_REGISTERED');
  }

  createInvalidFilterFault(): EventHealthFault {
    return this.createFault('SUBSCRIPTION_FILTER_INVALID');
  }

  createInvalidEnvelopeFault(): EventHealthFault {
    return this.createFault('EVENT_ENVELOPE_INVALID');
  }

  recordDatabaseFailure(at = new Date()): EventHealthFault {
    const fault = this.createFault('EVENT_WORKER_DATABASE_FAILURE');
    this.lastDatabaseFailureAt = copyValidDate(at);
    this.consecutiveDatabaseFailures += 1;
    this.databaseFailureTotal += 1;
    this.lastWorkerErrorReference = fault.reference;
    return fault;
  }

  recordSuccessfulTick(at = new Date()): void {
    this.lastSuccessfulTickAt = copyValidDate(at);
    this.consecutiveDatabaseFailures = 0;
    this.lastWorkerErrorReference = null;
  }

  applyFault(fault: EventHealthFault): void {
    if (fault.code === 'HANDLER_NOT_REGISTERED') this.unknownHandlerCount += 1;
    else if (fault.code === 'SUBSCRIPTION_FILTER_INVALID') this.invalidFilterCount += 1;
    else if (fault.code === 'EVENT_ENVELOPE_INVALID') this.invalidEnvelopeCount += 1;
    else throw new TypeError('Worker database faults must be recorded through recordDatabaseFailure');
    this.lastDegradedAt = new Date();
    this.lastErrorCode = fault.code;
    this.lastErrorReference = fault.reference;
  }

  snapshot(): EventHealthSnapshot {
    return {
      status: this.lastErrorCode === null ? 'healthy' : 'degraded',
      workerEnabled: this.workerEnabled,
      unknownHandlerCount: this.unknownHandlerCount,
      invalidFilterCount: this.invalidFilterCount,
      invalidEnvelopeCount: this.invalidEnvelopeCount,
      lastDegradedAt: this.lastDegradedAt === null ? null : new Date(this.lastDegradedAt.getTime()),
      lastErrorCode: this.lastErrorCode,
      lastErrorReference: this.lastErrorReference,
    };
  }

  workerSnapshot(): EventWorkerHealthSnapshot {
    return {
      status: this.consecutiveDatabaseFailures === 0 ? 'healthy' : 'degraded',
      workerEnabled: this.workerEnabled,
      lastSuccessfulTickAt: copyNullableDate(this.lastSuccessfulTickAt),
      lastDatabaseFailureAt: copyNullableDate(this.lastDatabaseFailureAt),
      consecutiveDatabaseFailures: this.consecutiveDatabaseFailures,
      databaseFailureTotal: this.databaseFailureTotal,
      lastErrorCode: this.consecutiveDatabaseFailures === 0 ? null : 'EVENT_WORKER_DATABASE_FAILURE',
      lastErrorReference: this.consecutiveDatabaseFailures === 0 ? null : this.lastWorkerErrorReference,
    };
  }

  operationsSnapshot(dispatcher: PersistentDispatcherHealthSnapshot): EventOperationsHealthSnapshot {
    const worker = this.workerSnapshot();
    const dispatcherDegraded = dispatcher.unresolvedDispatcherFaultCount > 0;
    const databaseDegraded = worker.consecutiveDatabaseFailures > 0;
    const dispatcherIsLatest = dispatcherDegraded && (
      worker.lastDatabaseFailureAt === null
      || dispatcher.lastDegradedAt === null
      || dispatcher.lastDegradedAt.getTime() >= worker.lastDatabaseFailureAt.getTime()
    );
    return {
      ...worker,
      status: dispatcherDegraded || databaseDegraded ? 'degraded' : 'healthy',
      unknownHandlerCount: dispatcher.unknownHandlerCount,
      invalidFilterCount: dispatcher.invalidFilterCount,
      invalidEnvelopeCount: dispatcher.invalidEnvelopeCount,
      unresolvedDispatcherFaultCount: dispatcher.unresolvedDispatcherFaultCount,
      lastDegradedAt: latestDate(
        dispatcherDegraded ? dispatcher.lastDegradedAt : null,
        databaseDegraded ? worker.lastDatabaseFailureAt : null,
      ),
      lastErrorCode: dispatcherIsLatest
        ? dispatcher.lastErrorCode
        : databaseDegraded ? worker.lastErrorCode : dispatcher.lastErrorCode,
      lastErrorReference: dispatcherIsLatest
        ? dispatcher.lastErrorReference
        : databaseDegraded ? worker.lastErrorReference : dispatcher.lastErrorReference,
    };
  }

  private createFault(code: EventHealthErrorCode): EventHealthFault {
    return Object.freeze({ code, reference: randomUUID() });
  }
}

function copyValidDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('Event health timestamp must be valid');
  return new Date(value.getTime());
}

function copyNullableDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value.getTime());
}

function latestDate(first: Date | null, second: Date | null): Date | null {
  if (first === null) return copyNullableDate(second);
  if (second === null) return copyNullableDate(first);
  return new Date(Math.max(first.getTime(), second.getTime()));
}
