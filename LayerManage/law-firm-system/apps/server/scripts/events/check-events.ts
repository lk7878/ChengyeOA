import type { PrismaClient } from '@prisma/client';

import type { EventRuntimeSnapshotReader } from '../../app/application/events/event-runtime-snapshot-reader';
import type {
  EventRolloutAlertCode,
  EventRolloutEvaluation,
  EventRolloutMode,
} from '../../app/domain/events/event-observability';
import type { AppEnvironment } from '../../config/env';

const ALERT_CODES = new Set<string>([
  'EVENT_OBS_MODE_MISMATCH',
  'EVENT_OBS_MANUAL_PRESENT',
  'EVENT_OBS_DISPATCHER_FAULT',
  'EVENT_OBS_DATABASE_FAILURES',
  'EVENT_OBS_WORKER_TICK_STALE',
  'EVENT_OBS_UNDISPATCHED_STALE',
  'EVENT_OBS_DUE_BACKLOG_STALE',
  'EVENT_OBS_LEASE_LOST',
  'EVENT_OBS_LEASE_LOST_EXCESSIVE',
  'EVENT_OBS_PROCESSING_LEASE_STALE',
] satisfies readonly EventRolloutAlertCode[]);

export interface CheckEventsCliDependencies {
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly assertMigrationsReady: (databaseUrl: string) => Promise<void>;
  readonly createPrisma: (databaseUrl: string) => PrismaClient | Promise<PrismaClient>;
  readonly createSnapshotReader: (
    prisma: PrismaClient,
    env: AppEnvironment,
  ) => EventRuntimeSnapshotReader | Promise<EventRuntimeSnapshotReader>;
}

export const productionCheckEventsCliDependencies: CheckEventsCliDependencies = {
  stdout: process.stdout,
  stderr: process.stderr,
  async assertMigrationsReady(databaseUrl) {
    const { assertMigrationsReady } = await import('../system/migration-status');
    await assertMigrationsReady(databaseUrl);
  },
  async createPrisma(databaseUrl) {
    const { PrismaClient } = await import('@prisma/client');
    return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  },
  async createSnapshotReader(prisma, env) {
    const [ snapshotReaderModule, runtimeStatusModule ] = await Promise.all([
      import('../../app/application/events/event-runtime-snapshot-reader'),
      import('../../app/application/events/event-worker-runtime-status-store'),
    ]);
    const { EventRuntimeSnapshotReader } = snapshotReaderModule;
    const { EventWorkerRuntimeStatusStore } = runtimeStatusModule;
    const runtimeStatus = new EventWorkerRuntimeStatusStore(prisma, {
      heartbeatSeconds: env.eventObservability.heartbeatSeconds,
    });
    return new EventRuntimeSnapshotReader(prisma, {
      leaseSeconds: env.eventWorker.leaseSeconds,
      runtimeStatus,
    });
  },
};

type DotenvLoader = () => Promise<void>;

const loadSourceDotenv: DotenvLoader = async () => {
  await import('dotenv/config');
};

export async function runSourceCheckEvents(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  dependencies: CheckEventsCliDependencies = productionCheckEventsCliDependencies,
  loadDotenv: DotenvLoader = loadSourceDotenv,
): Promise<number> {
  if (parseMode(argv) === null) return checkEventsMain(argv, env, dependencies);
  try {
    await loadDotenv();
  } catch {
    writeLine(dependencies.stderr, 'Event observability configuration is invalid.');
    return 2;
  }
  return checkEventsMain(argv, env, dependencies);
}

export async function checkEventsMain(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  dependencies: CheckEventsCliDependencies = productionCheckEventsCliDependencies,
): Promise<number> {
  const mode = parseMode(argv);
  if (mode === null) {
    writeLine(dependencies.stderr, 'Event observability input is invalid.');
    return 2;
  }

  let loaded: AppEnvironment;
  try {
    const { loadEnvironment } = await import('../../config/env');
    loaded = loadEnvironment(env);
    assertDatabaseTarget(loaded.databaseUrl);
  } catch {
    writeLine(dependencies.stderr, 'Event observability configuration is invalid.');
    return 2;
  }

  try {
    await dependencies.assertMigrationsReady(loaded.databaseUrl);
  } catch {
    writeLine(dependencies.stderr, 'Database state is unavailable.');
    return 5;
  }

  let prisma: PrismaClient | undefined;
  try {
    prisma = await dependencies.createPrisma(loaded.databaseUrl);
    const reader = await dependencies.createSnapshotReader(prisma, loaded);
    const snapshot = await reader.read();
    const { evaluateEventRollout } = await import('../../app/domain/events/event-observability');
    const evaluation = evaluateEventRollout({
      mode,
      snapshot,
      config: loaded.eventObservability,
    });
    writeLine(dependencies.stdout, formatEvaluation(evaluation));
    return evaluation.status === 'READY' ? 0 : evaluation.status === 'DEGRADED' ? 3 : 4;
  } catch (error: unknown) {
    if (await isDatabaseFailure(error)) {
      writeLine(dependencies.stderr, 'Database state is unavailable.');
      return 5;
    }
    writeLine(dependencies.stderr, 'Event observability check failed.');
    return 70;
  } finally {
    try {
      await prisma?.$disconnect();
    } catch {
      // Cleanup is best effort and must never expose database details.
    }
  }
}

async function isDatabaseFailure(error: unknown): Promise<boolean> {
  try {
    const [ systemErrors, observabilityErrors ] = await Promise.all([
      import('../../app/application/system/system-command-errors'),
      import('../../app/domain/events/event-observability-errors'),
    ]);
    return error instanceof systemErrors.DatabaseStateError
      || observabilityErrors.isEventObservabilityDatabaseError(error);
  } catch {
    return false;
  }
}

function parseMode(argv: readonly string[]): EventRolloutMode | null {
  if (argv.length !== 1) return null;
  if (argv[0] === '--mode=preflight') return 'preflight';
  if (argv[0] === '--mode=canary') return 'canary';
  return null;
}

function assertDatabaseTarget(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (url.protocol !== 'postgresql:' || !url.hostname || !databaseName || hasAsciiControl(databaseName)) {
    throw new TypeError('Invalid database target');
  }
}

function hasAsciiControl(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1F || code === 0x7F;
  });
}

function formatEvaluation(evaluation: EventRolloutEvaluation): string {
  const alertCodes = evaluation.alerts.map(alert => {
    if (!ALERT_CODES.has(alert.code)) throw new Error('Unsupported event observability alert code');
    return alert.code;
  });
  const { metrics } = evaluation;
  return [
    'Event observability:',
    `mode=${evaluation.mode}`,
    `status=${evaluation.status}`,
    `undispatched=${metrics.undispatchedCount}`,
    `oldestUndispatchedSeconds=${metrics.oldestUndispatchedSeconds}`,
    `dueBacklog=${metrics.dueBacklogCount}`,
    `oldestDueBacklogSeconds=${metrics.oldestDueBacklogSeconds}`,
    `manual=${metrics.manualCount}`,
    `processing=${metrics.processingCount}`,
    `expiredProcessing=${metrics.expiredProcessingCount}`,
    `staleExpiredProcessing=${metrics.staleExpiredProcessingCount}`,
    `leaseLost15m=${metrics.leaseLost15mCount}`,
    `alertCodes=${alertCodes.length === 0 ? 'none' : alertCodes.join(',')}`,
    `evaluatedAt=${evaluation.evaluatedAt.toISOString()}`,
  ].join(' ');
}

function writeLine(output: NodeJS.WritableStream, message: string): void {
  output.write(`${message}\n`);
}

if (require.main === module) {
  void runSourceCheckEvents().then(code => {
    process.exitCode = code;
  });
}
