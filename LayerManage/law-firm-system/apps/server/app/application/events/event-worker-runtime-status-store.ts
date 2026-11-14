import { EventWorkerRuntimeStatus as PrismaEventWorkerRuntimeStatus, PrismaClient } from '@prisma/client';

export const EVENT_WORKER_PRIMARY_SLOT = 'primary' as const;

export type EventWorkerRuntimeState = 'DISABLED' | 'STARTING' | 'RUNNING' | 'STOPPED';

export interface EventWorkerRuntimeStatus {
  readonly slot: typeof EVENT_WORKER_PRIMARY_SLOT;
  readonly configuredEnabled: boolean;
  readonly state: EventWorkerRuntimeState;
  readonly processStartedAt: Date;
  readonly lastHeartbeatAt: Date | null;
  readonly lastSuccessfulTickAt: Date | null;
  readonly lastStoppedAt: Date | null;
  readonly version: number;
  readonly updatedAt: Date;
}

interface EventWorkerRuntimeStatusStoreOptions {
  readonly heartbeatSeconds: number;
  readonly now?: () => Date;
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('event worker runtime status timestamp must be a valid Date');
  }
  return new Date(value);
}

function cloneOptionalDate(value: Date | null): Date | null {
  return value === null ? null : new Date(value);
}

function toStatus(row: PrismaEventWorkerRuntimeStatus): EventWorkerRuntimeStatus {
  return {
    slot: EVENT_WORKER_PRIMARY_SLOT,
    configuredEnabled: row.configuredEnabled,
    state: row.state as EventWorkerRuntimeState,
    processStartedAt: new Date(row.processStartedAt),
    lastHeartbeatAt: cloneOptionalDate(row.lastHeartbeatAt),
    lastSuccessfulTickAt: cloneOptionalDate(row.lastSuccessfulTickAt),
    lastStoppedAt: cloneOptionalDate(row.lastStoppedAt),
    version: row.version,
    updatedAt: new Date(row.updatedAt),
  };
}

export class EventWorkerRuntimeStatusStore {
  private readonly heartbeatMilliseconds: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: EventWorkerRuntimeStatusStoreOptions,
  ) {
    if (!Number.isInteger(options.heartbeatSeconds) || options.heartbeatSeconds <= 0) {
      throw new TypeError('heartbeatSeconds must be a positive integer');
    }
    this.heartbeatMilliseconds = options.heartbeatSeconds * 1_000;
  }

  async markDisabled(at = this.now()): Promise<void> {
    const timestamp = validDate(at);
    await this.prisma.eventWorkerRuntimeStatus.upsert({
      where: { slot: EVENT_WORKER_PRIMARY_SLOT },
      create: {
        slot: EVENT_WORKER_PRIMARY_SLOT,
        configuredEnabled: false,
        state: 'DISABLED',
        processStartedAt: timestamp,
      },
      update: {
        configuredEnabled: false,
        state: 'DISABLED',
        processStartedAt: timestamp,
        lastHeartbeatAt: null,
        lastSuccessfulTickAt: null,
        lastStoppedAt: null,
        version: { increment: 1 },
      },
    });
  }

  async markStarting(at = this.now()): Promise<void> {
    const timestamp = validDate(at);
    await this.prisma.eventWorkerRuntimeStatus.upsert({
      where: { slot: EVENT_WORKER_PRIMARY_SLOT },
      create: {
        slot: EVENT_WORKER_PRIMARY_SLOT,
        configuredEnabled: true,
        state: 'STARTING',
        processStartedAt: timestamp,
      },
      update: {
        configuredEnabled: true,
        state: 'STARTING',
        processStartedAt: timestamp,
        lastHeartbeatAt: null,
        lastSuccessfulTickAt: null,
        lastStoppedAt: null,
        version: { increment: 1 },
      },
    });
  }

  async recordHeartbeat(at = this.now()): Promise<void> {
    const timestamp = validDate(at);
    const writeThreshold = new Date(timestamp.getTime() - this.heartbeatMilliseconds);
    await this.prisma.eventWorkerRuntimeStatus.updateMany({
      where: {
        slot: EVENT_WORKER_PRIMARY_SLOT,
        configuredEnabled: true,
        state: { in: [ 'STARTING', 'RUNNING' ] },
        OR: [
          { lastHeartbeatAt: null },
          { lastHeartbeatAt: { lte: writeThreshold } },
        ],
      },
      data: {
        state: 'RUNNING',
        lastHeartbeatAt: timestamp,
        lastSuccessfulTickAt: timestamp,
        version: { increment: 1 },
      },
    });
  }

  async markStopped(at = this.now()): Promise<void> {
    const timestamp = validDate(at);
    await this.prisma.eventWorkerRuntimeStatus.upsert({
      where: { slot: EVENT_WORKER_PRIMARY_SLOT },
      create: {
        slot: EVENT_WORKER_PRIMARY_SLOT,
        configuredEnabled: true,
        state: 'STOPPED',
        processStartedAt: timestamp,
        lastStoppedAt: timestamp,
      },
      update: {
        state: 'STOPPED',
        lastStoppedAt: timestamp,
        version: { increment: 1 },
      },
    });
  }

  async read(): Promise<EventWorkerRuntimeStatus | null> {
    const row = await this.prisma.eventWorkerRuntimeStatus.findUnique({
      where: { slot: EVENT_WORKER_PRIMARY_SLOT },
    });
    return row === null ? null : toStatus(row);
  }

  private now(): Date {
    return validDate(this.options.now?.() ?? new Date());
  }
}
