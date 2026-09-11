import 'dotenv/config';

import { Prisma, PrismaClient } from '@prisma/client';

import type { EventServices } from '../../app/application/events/event-services-factory';
import { createEventServices } from '../../app/application/events/event-services-factory';
import { DatabaseStateError } from '../../app/application/system/system-command-errors';
import type { EventWorkerEnvironment } from '../../config/env';
import { loadEnvironment } from '../../config/env';
import { assertMigrationsReady } from '../system/migration-status';

interface DrainOutput {
  write(value: string): unknown;
}

type DrainEventServices = Pick<EventServices, 'dispatcher' | 'worker'>;

export interface DrainCliDependencies {
  readonly stdout: DrainOutput;
  readonly stderr: DrainOutput;
  assertMigrationsReady(databaseUrl: string): Promise<void>;
  createPrisma(databaseUrl: string): PrismaClient;
  createEventServices(
    prisma: PrismaClient,
    config: EventWorkerEnvironment,
  ): DrainEventServices;
}

export const productionDrainCliDependencies: DrainCliDependencies = {
  stdout: process.stdout,
  stderr: process.stderr,
  assertMigrationsReady,
  createPrisma: databaseUrl => new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
  createEventServices,
};

interface DrainCounts {
  dispatched: number;
  claimed: number;
  succeeded: number;
  retryScheduled: number;
  manual: number;
  leaseLost: number;
}

export async function drainMain(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: DrainCliDependencies = productionDrainCliDependencies,
): Promise<number> {
  if (argv.length !== 0) {
    writeLine(deps.stderr, 'Event drain input is invalid.');
    return 2;
  }

  let databaseUrl: string;
  let workerConfig: EventWorkerEnvironment;
  try {
    const loaded = loadEnvironment({ ...env, EVENT_WORKER_ENABLED: 'false' });
    assertDatabaseTarget(loaded.databaseUrl);
    databaseUrl = loaded.databaseUrl;
    workerConfig = loaded.eventWorker;
  } catch {
    writeLine(deps.stderr, 'Event drain configuration is invalid.');
    return 2;
  }

  try {
    await deps.assertMigrationsReady(databaseUrl);
  } catch {
    writeLine(deps.stderr, 'Database state is unavailable.');
    return 5;
  }

  let prisma: PrismaClient | undefined;
  try {
    prisma = deps.createPrisma(databaseUrl);
    const services = deps.createEventServices(prisma, workerConfig);
    const counts = await drainUntilIdle(services, workerConfig.batchSize);
    const status = counts.manual === 0 ? 'complete' : 'manual_attention_required';
    writeLine(deps.stdout, formatCounts(counts, status));
    return counts.manual === 0 ? 0 : 4;
  } catch (error) {
    if (error instanceof DatabaseStateError || isPrismaDatabaseError(error)) {
      writeLine(deps.stderr, 'Database state is unavailable.');
      return 5;
    }
    writeLine(deps.stderr, 'Event drain failed.');
    return 70;
  } finally {
    try {
      await prisma?.$disconnect();
    } catch {
      // Cleanup is best effort and must never expose database details.
    }
  }
}

async function drainUntilIdle(services: DrainEventServices, batchSize: number): Promise<DrainCounts> {
  const total: DrainCounts = {
    dispatched: 0,
    claimed: 0,
    succeeded: 0,
    retryScheduled: 0,
    manual: 0,
    leaseLost: 0,
  };
  let emptyRounds = 0;

  while (emptyRounds < 2) {
    const dispatched = await services.dispatcher.dispatchBatch(batchSize);
    const worked = await services.worker.tick();
    total.dispatched += dispatched.dispatchedCount + worked.dispatched;
    total.claimed += worked.claimed;
    total.succeeded += worked.succeeded;
    total.retryScheduled += worked.retryScheduled;
    total.manual += dispatched.manualCount + worked.manual;
    total.leaseLost += worked.leaseLost;

    const empty = dispatched.dispatchedCount === 0
      && worked.dispatched === 0
      && worked.claimed === 0;
    emptyRounds = empty ? emptyRounds + 1 : 0;
  }
  return total;
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

function isPrismaDatabaseError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientInitializationError
    || error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientUnknownRequestError
    || error instanceof Prisma.PrismaClientValidationError
    || error instanceof Prisma.PrismaClientRustPanicError;
}

function formatCounts(counts: DrainCounts, status: 'complete' | 'manual_attention_required'): string {
  return [
    'Event drain:',
    `dispatched=${counts.dispatched}`,
    `claimed=${counts.claimed}`,
    `succeeded=${counts.succeeded}`,
    `retryScheduled=${counts.retryScheduled}`,
    `manual=${counts.manual}`,
    `leaseLost=${counts.leaseLost}`,
    `status=${status}`,
  ].join(' ');
}

function writeLine(output: DrainOutput, message: string): void {
  output.write(`${message}\n`);
}

if (require.main === module) {
  void drainMain().then(code => {
    process.exitCode = code;
  });
}
