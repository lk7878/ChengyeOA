import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { EventRuntimeSnapshotReader } from '../../app/application/events/event-runtime-snapshot-reader';
import { EventWorkerRuntimeStatusStore } from '../../app/application/events/event-worker-runtime-status-store';
import type { EventRuntimeSnapshot } from '../../app/domain/events/event-observability';
import { DatabaseStateError } from '../../app/application/system/system-command-errors';
import {
  checkEventsMain,
  productionCheckEventsCliDependencies,
  runSourceCheckEvents,
  type CheckEventsCliDependencies,
} from '../../scripts/events/check-events';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

const SECRET_DATABASE_URL = 'postgresql://event_operator:never-display@db.example.test:55432/chengye_oa_test?schema=private';
const SECRET_ARGUMENT = '--payload=private-notification-content';
const RAW_ERROR = 'Prisma P1001 postgresql://raw-error-secret private payload';
const EVALUATED_AT = new Date('2026-07-23T12:00:00.000Z');
const databaseConfigured = Boolean(process.env.DATABASE_URL_TEST);
const FORBIDDEN_DIAGNOSTIC = /postgresql:|never-display|private|notification|payload|raw-error|Prisma|P10\d\d|workerId|lockedBy|secret/i;
const BASE_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: SECRET_DATABASE_URL,
  JWT_SECRET: '01234567890123456789012345678901',
  APP_KEYS: 'first-32-character-application-key,second-32-character-app-key',
  MFA_ENCRYPTION_KEY_V1: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
  EVENT_WORKER_ENABLED: 'false',
  EVENT_WORKER_POLL_MS: '250',
  EVENT_WORKER_BATCH_SIZE: '25',
  EVENT_WORKER_LEASE_SECONDS: '60',
  EVENT_WORKER_SHUTDOWN_SECONDS: '30',
};

function snapshot(overrides: Partial<EventRuntimeSnapshot> = {}): EventRuntimeSnapshot {
  return {
    evaluatedAt: EVALUATED_AT,
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
    workerConfiguredEnabled: false,
    workerState: 'DISABLED',
    workerProcessStartedAt: EVALUATED_AT,
    lastHeartbeatAt: null,
    lastSuccessfulTickAt: null,
    consecutiveDatabaseFailures: null,
    ...overrides,
  };
}

interface Harness {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly dependencies: CheckEventsCliDependencies;
  readonly migrationCalls: () => number;
  readonly prismaCalls: () => number;
  readonly readerCalls: () => number;
  readonly readCalls: () => number;
  readonly disconnectCalls: () => number;
}

function harness(options: {
  readonly value?: EventRuntimeSnapshot;
  readonly migrationError?: Error;
  readonly readError?: Error;
  readonly disconnectError?: Error;
} = {}): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let migrations = 0;
  let prismaCreations = 0;
  let readers = 0;
  let reads = 0;
  let disconnects = 0;
  const fakePrisma = {
    async $disconnect() {
      disconnects += 1;
      if (options.disconnectError) throw options.disconnectError;
    },
  } as PrismaClient;
  const dependencies: CheckEventsCliDependencies = {
    stdout: { write(value) { stdout.push(String(value)); return true; } } as NodeJS.WritableStream,
    stderr: { write(value) { stderr.push(String(value)); return true; } } as NodeJS.WritableStream,
    async assertMigrationsReady(databaseUrl) {
      migrations += 1;
      assert.equal(
        databaseUrl === SECRET_DATABASE_URL,
        true,
        'Migration gate received an unexpected database target.',
      );
      if (options.migrationError) throw options.migrationError;
    },
    createPrisma(databaseUrl) {
      prismaCreations += 1;
      assert.equal(
        databaseUrl === SECRET_DATABASE_URL,
        true,
        'Prisma factory received an unexpected database target.',
      );
      return fakePrisma;
    },
    createSnapshotReader(prisma, env) {
      readers += 1;
      assert.equal(prisma, fakePrisma);
      assert.equal(
        env.databaseUrl === SECRET_DATABASE_URL,
        true,
        'Snapshot reader received an unexpected database target.',
      );
      return {
        async read() {
          reads += 1;
          if (options.readError) throw options.readError;
          return options.value ?? snapshot();
        },
      } as EventRuntimeSnapshotReader;
    },
  };
  return {
    stdout,
    stderr,
    dependencies,
    migrationCalls: () => migrations,
    prismaCalls: () => prismaCreations,
    readerCalls: () => readers,
    readCalls: () => reads,
    disconnectCalls: () => disconnects,
  };
}

function transcript(subject: Harness): string {
  return `${subject.stdout.join('')}\n${subject.stderr.join('')}`;
}

function assertSafe(subject: Harness): void {
  assert.equal(
    FORBIDDEN_DIAGNOSTIC.test(transcript(subject)),
    false,
    'Event observability CLI emitted forbidden diagnostic data.',
  );
}

function assertSafeText(value: string): void {
  assert.equal(
    FORBIDDEN_DIAGNOSTIC.test(value),
    false,
    'Event observability test transcript contained forbidden diagnostic data.',
  );
}

test('cold module load does not read a working-directory dotenv file', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'event-check-cold-'));
  try {
    fs.writeFileSync(
      path.join(temporaryDirectory, '.env'),
      'EVENT_CHECK_COLD_MARKER=loaded-from-dotenv\n',
      'utf8',
    );
    const commandModule = path.resolve('scripts/events/check-events.ts');
    const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
    const probe = [
      'const before = process.env.EVENT_CHECK_COLD_MARKER;',
      `require(${JSON.stringify(commandModule)});`,
      "process.stdout.write(process.env.EVENT_CHECK_COLD_MARKER === before ? 'UNCHANGED' : 'CHANGED');",
    ].join(' ');
    const result = spawnSync(process.execPath, [ tsxCli, '--eval', probe ], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      env: Object.fromEntries(
        Object.entries(process.env).filter(([ key ]) => key !== 'EVENT_CHECK_COLD_MARKER'),
      ),
      windowsHide: true,
    });
    const diagnostics = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${String(result.error ?? '')}`;

    assertSafeText(diagnostics);
    assert.equal(result.error === undefined, true, 'Cold module probe failed to start safely.');
    assert.equal(result.status, 0, 'Cold module probe returned an unexpected exit status.');
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'UNCHANGED');
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('cold module load defers the rollout policy until a valid check runs', () => {
  const commandModule = path.resolve('scripts/events/check-events.ts');
  const policyModule = path.resolve('app/domain/events/event-observability.ts');
  const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
  const probe = [
    `const policy = require.resolve(${JSON.stringify(policyModule)});`,
    `require(${JSON.stringify(commandModule)});`,
    "process.stdout.write(require.cache[policy] === undefined ? 'DEFERRED' : 'EAGER');",
  ].join(' ');
  const result = spawnSync(process.execPath, [ tsxCli, '--eval', probe ], {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  });
  const diagnostics = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${String(result.error ?? '')}`;

  assertSafeText(diagnostics);
  assert.equal(result.error === undefined, true, 'Cold policy probe failed to start safely.');
  assert.equal(result.status, 0, 'Cold policy probe returned an unexpected exit status.');
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'DEFERRED');
});

test('cold module load defers the event-check runtime graph until a valid check runs', () => {
  const commandModule = path.resolve('scripts/events/check-events.ts');
  const runtimeModules = [
    path.resolve('app/application/events/event-runtime-snapshot-reader.ts'),
    path.resolve('app/application/events/event-worker-runtime-status-store.ts'),
    path.resolve('app/application/system/system-command-errors.ts'),
    path.resolve('app/domain/events/event-observability-errors.ts'),
    path.resolve('config/env.ts'),
    path.resolve('scripts/system/migration-status.ts'),
  ];
  const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
  const probe = [
    `const runtime = ${JSON.stringify(runtimeModules)}.map(value => require.resolve(value));`,
    `require(${JSON.stringify(commandModule)});`,
    "process.stdout.write(runtime.every(value => require.cache[value] === undefined) ? 'DEFERRED' : 'EAGER');",
  ].join(' ');
  const result = spawnSync(process.execPath, [ tsxCli, '--eval', probe ], {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  });
  const diagnostics = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${String(result.error ?? '')}`;

  assertSafeText(diagnostics);
  assert.equal(result.error === undefined, true, 'Cold runtime probe failed to start safely.');
  assert.equal(result.status, 0, 'Cold runtime probe returned an unexpected exit status.');
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'DEFERRED');
});

test('source entry rejects invalid arguments before invoking its dotenv loader', async () => {
  const subject = harness();
  let dotenvLoads = 0;
  const code = await runSourceCheckEvents(
    [ SECRET_ARGUMENT ],
    {},
    subject.dependencies,
    async () => { dotenvLoads += 1; },
  );

  assertSafe(subject);
  assert.equal(code, 2);
  assert.equal(dotenvLoads, 0);
  assert.equal(subject.migrationCalls(), 0);
  assert.equal(subject.prismaCalls(), 0);
  assert.equal(subject.stderr.join(''), 'Event observability input is invalid.\n');
});

test('source entry loads dotenv only after accepting one exact mode token', async () => {
  const subject = harness();
  const sourceEnv: NodeJS.ProcessEnv = {};
  let dotenvLoads = 0;
  const code = await runSourceCheckEvents(
    [ '--mode=preflight' ],
    sourceEnv,
    subject.dependencies,
    async () => {
      dotenvLoads += 1;
      Object.assign(sourceEnv, BASE_ENV);
    },
  );

  assertSafe(subject);
  assert.equal(code, 0);
  assert.equal(dotenvLoads, 1);
  assert.equal(subject.migrationCalls(), 1);
  assert.equal(subject.prismaCalls(), 1);
});

test('rejects missing, duplicate, split-form, unknown, and secret-bearing arguments before configuration or database access', async () => {
  for (const argv of [
    [],
    [ '--mode', 'preflight' ],
    [ '--mode=preflight', '--mode=preflight' ],
    [ '--mode=preflight', '--unknown' ],
    [ '--mode=unknown' ],
    [ SECRET_ARGUMENT ],
  ]) {
    const subject = harness();
    const code = await checkEventsMain(argv, {}, subject.dependencies);
    assertSafe(subject);
    assert.equal(code, 2, 'Invalid CLI arguments must return exit 2.');
    assert.equal(subject.migrationCalls(), 0);
    assert.equal(subject.prismaCalls(), 0);
    assert.equal(subject.readerCalls(), 0);
    assert.equal(subject.readCalls(), 0);
    assert.equal(subject.disconnectCalls(), 0);
    assert.deepEqual(subject.stdout, []);
    assert.equal(subject.stderr.join(''), 'Event observability input is invalid.\n');
  }
});

test('accepts only one exact preflight or canary mode and maps READY, DEGRADED, and BLOCKED to 0, 3, and 4', async () => {
  const cases = [
    {
      argv: [ '--mode=preflight' ],
      value: snapshot(),
      expectedCode: 0,
      expectedStatus: 'READY',
      expectedAlerts: 'none',
    },
    {
      argv: [ '--mode=canary' ],
      value: snapshot({
        workerConfiguredEnabled: true,
        workerState: 'STARTING',
        workerProcessStartedAt: new Date(EVALUATED_AT.getTime() - 10_000),
      }),
      expectedCode: 3,
      expectedStatus: 'DEGRADED',
      expectedAlerts: 'EVENT_OBS_MODE_MISMATCH',
    },
    {
      argv: [ '--mode=preflight' ],
      value: snapshot({ manualCount: 1 }),
      expectedCode: 4,
      expectedStatus: 'BLOCKED',
      expectedAlerts: 'EVENT_OBS_MANUAL_PRESENT',
    },
  ] as const;

  for (const scenario of cases) {
    const subject = harness({ value: scenario.value });
    const code = await checkEventsMain(scenario.argv, BASE_ENV, subject.dependencies);
    assertSafe(subject);
    assert.equal(code, scenario.expectedCode);
    assert.equal(subject.migrationCalls(), 1);
    assert.equal(subject.prismaCalls(), 1);
    assert.equal(subject.readerCalls(), 1);
    assert.equal(subject.readCalls(), 1);
    assert.equal(subject.disconnectCalls(), 1);
    assert.deepEqual(subject.stderr, []);
    assert.equal(
      subject.stdout.join(''),
      `Event observability: mode=${scenario.argv[0].slice('--mode='.length)} status=${scenario.expectedStatus} `
        + 'undispatched=0 oldestUndispatchedSeconds=0 dueBacklog=0 oldestDueBacklogSeconds=0 '
        + `manual=${scenario.value.manualCount} processing=0 expiredProcessing=0 staleExpiredProcessing=0 `
        + `leaseLost15m=0 alertCodes=${scenario.expectedAlerts} evaluatedAt=${EVALUATED_AT.toISOString()}\n`,
    );
    assert.equal(subject.stdout.length, 1);
  }
});

test('prints fixed fields in fixed order and comma-separated stable alert codes', async () => {
  const subject = harness({
    value: snapshot({
      undispatchedCount: 2,
      oldestUndispatchedSeconds: 120,
      dueBacklogCount: 3,
      oldestDueBacklogSeconds: 300,
      manualCount: 1,
      processingCount: 4,
      expiredProcessingCount: 2,
      staleExpiredProcessingCount: 1,
      leaseLost15mCount: 3,
    }),
  });

  const code = await checkEventsMain([ '--mode=preflight' ], BASE_ENV, subject.dependencies);
  assertSafe(subject);
  assert.equal(code, 4);
  assert.equal(
    subject.stdout.join(''),
    'Event observability: mode=preflight status=BLOCKED undispatched=2 oldestUndispatchedSeconds=120 '
      + 'dueBacklog=3 oldestDueBacklogSeconds=300 manual=1 processing=4 expiredProcessing=2 '
      + 'staleExpiredProcessing=1 leaseLost15m=3 '
      + 'alertCodes=EVENT_OBS_DUE_BACKLOG_STALE,EVENT_OBS_LEASE_LOST_EXCESSIVE,EVENT_OBS_MANUAL_PRESENT,EVENT_OBS_PROCESSING_LEASE_STALE,EVENT_OBS_UNDISPATCHED_STALE '
      + `evaluatedAt=${EVALUATED_AT.toISOString()}\n`,
  );
  assert.equal(subject.stdout.length, 1);
});

test('maps invalid configuration to 2 before migrations and database access', async () => {
  const subject = harness();
  const code = await checkEventsMain([ '--mode=preflight' ], {
    ...BASE_ENV,
    JWT_SECRET: 'short',
  }, subject.dependencies);

  assertSafe(subject);
  assert.equal(code, 2);
  assert.equal(subject.migrationCalls(), 0);
  assert.equal(subject.prismaCalls(), 0);
  assert.equal(subject.disconnectCalls(), 0);
  assert.equal(subject.stderr.join(''), 'Event observability configuration is invalid.\n');
});

test('rejects unsafe database targets before migrations, Prisma, or reader creation', async () => {
  const cases = [
    'mysql://event-operator@example.test/chengye_oa_test',
    'postgresql:///chengye_oa_test',
    'postgresql://example.test',
    'postgresql://example.test/chengye%0Aoa_test',
    'postgresql://[',
  ];

  for (const databaseUrl of cases) {
    const subject = harness();
    const code = await checkEventsMain(
      [ '--mode=preflight' ],
      { ...BASE_ENV, DATABASE_URL: databaseUrl },
      subject.dependencies,
    );

    assertSafe(subject);
    assert.equal(code, 2, 'Unsafe database targets must return exit 2.');
    assert.equal(subject.migrationCalls(), 0);
    assert.equal(subject.prismaCalls(), 0);
    assert.equal(subject.readerCalls(), 0);
    assert.equal(subject.readCalls(), 0);
    assert.equal(subject.disconnectCalls(), 0);
    assert.deepEqual(subject.stdout, []);
    assert.equal(subject.stderr.join(''), 'Event observability configuration is invalid.\n');
  }
});

test('maps migration and database failures to 5 without raw errors and always disconnects an opened client', async () => {
  const migration = harness({ migrationError: new DatabaseStateError(RAW_ERROR) });
  const migrationCode = await checkEventsMain([ '--mode=preflight' ], BASE_ENV, migration.dependencies);
  assertSafe(migration);
  assert.equal(migrationCode, 5);
  assert.equal(migration.prismaCalls(), 0);
  assert.equal(migration.disconnectCalls(), 0);
  assert.equal(migration.stderr.join(''), 'Database state is unavailable.\n');

  const database = harness({ readError: new DatabaseStateError(RAW_ERROR) });
  const databaseCode = await checkEventsMain([ '--mode=preflight' ], BASE_ENV, database.dependencies);
  assertSafe(database);
  assert.equal(databaseCode, 5);
  assert.equal(database.disconnectCalls(), 1);
  assert.equal(database.stderr.join(''), 'Database state is unavailable.\n');
});

test('maps unexpected failures and disconnect failures to safe exit 70 without replacing a completed evaluation', async () => {
  const unexpected = harness({ readError: new Error(RAW_ERROR) });
  const unexpectedCode = await checkEventsMain([ '--mode=preflight' ], BASE_ENV, unexpected.dependencies);
  assertSafe(unexpected);
  assert.equal(unexpectedCode, 70);
  assert.equal(unexpected.disconnectCalls(), 1);
  assert.equal(unexpected.stderr.join(''), 'Event observability check failed.\n');

  const completed = harness({ disconnectError: new Error(RAW_ERROR) });
  const completedCode = await checkEventsMain([ '--mode=preflight' ], BASE_ENV, completed.dependencies);
  assertSafe(completed);
  assert.equal(completedCode, 0);
  assert.equal(completed.stderr.join(''), '');
});

test('real PostgreSQL preflight returns READY for DISABLED clean state and BLOCKED with only MANUAL evidence', {
  skip: databaseConfigured ? false : 'DATABASE_URL_TEST is required for the PostgreSQL smoke test',
}, async () => {
  const databaseUrl = process.env.DATABASE_URL_TEST as string;
  const seedPrisma = createTestPrisma();
  const clients: PrismaClient[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    await clearTestApplicationData(seedPrisma);
    await new EventWorkerRuntimeStatusStore(seedPrisma, { heartbeatSeconds: 10 }).markDisabled(EVALUATED_AT);
    const dependencies: CheckEventsCliDependencies = {
      ...productionCheckEventsCliDependencies,
      stdout: { write(value) { stdout.push(String(value)); return true; } } as NodeJS.WritableStream,
      stderr: { write(value) { stderr.push(String(value)); return true; } } as NodeJS.WritableStream,
      async assertMigrationsReady(receivedUrl) {
        assert.equal(receivedUrl === databaseUrl, true, 'Migration gate received an unexpected database target.');
      },
      createPrisma(receivedUrl) {
        assert.equal(receivedUrl === databaseUrl, true, 'Prisma factory received an unexpected database target.');
        const client = new PrismaClient({ datasources: { db: { url: receivedUrl } } });
        clients.push(client);
        return client;
      },
    };
    const env = { ...BASE_ENV, DATABASE_URL: databaseUrl };

    assert.equal(await checkEventsMain([ '--mode=preflight' ], env, dependencies), 0);
    const ready = stdout.shift() ?? '';
    assertSafeText(`${ready}\n${stderr.join('')}`);
    assert.match(ready, /^Event observability: mode=preflight status=READY .*alertCodes=none evaluatedAt=.*Z\n$/);

    const event = await seedPrisma.eventLog.create({
      data: {
        eventType: `check.${randomUUID()}`,
        eventVersion: 1,
        sourceModule: 'check-test',
        objectType: 'CHECK_TEST',
        objectId: randomUUID(),
        orderingKey: createHash('sha256').update(randomUUID()).digest('hex'),
        payload: { privateValue: 'must-never-print' },
        traceId: randomUUID(),
        occurredAt: EVALUATED_AT,
        dispatchedAt: EVALUATED_AT,
        createdAt: EVALUATED_AT,
      },
    });
    const subscription = await seedPrisma.eventSubscription.create({
      data: {
        code: `check-subscription-${randomUUID()}`,
        eventType: event.eventType,
        eventVersion: 1,
        handlerCode: `CHECK_HANDLER_${randomUUID().replaceAll('-', '').toUpperCase()}`,
      },
    });
    await seedPrisma.eventDelivery.create({
      data: {
        eventId: event.id,
        subscriptionId: subscription.id,
        handlerCode: subscription.handlerCode,
        orderingKey: event.orderingKey,
        status: 'MANUAL',
        lastErrorCode: 'EVENT_HANDLER_FAILED',
        lastErrorReference: 'must-never-print',
        createdAt: EVALUATED_AT,
        updatedAt: EVALUATED_AT,
      },
    });

    assert.equal(await checkEventsMain([ '--mode=preflight' ], env, dependencies), 4);
    const blocked = stdout.shift() ?? '';
    const blockedDiagnostics = `${blocked}\n${stderr.join('')}`;
    assertSafeText(blockedDiagnostics);
    assert.equal(
      /EVENT_HANDLER_FAILED|must-never-print/i.test(blockedDiagnostics),
      false,
      'PostgreSQL smoke transcript contained forbidden stored event data.',
    );
    assert.match(blocked, /^Event observability: mode=preflight status=BLOCKED /);
    assert.match(blocked, / manual=1 /);
    assert.match(blocked, / alertCodes=EVENT_OBS_MANUAL_PRESENT /);
    assert.equal(stderr.join(''), '');
  } finally {
    await clearTestApplicationData(seedPrisma);
    await Promise.allSettled(clients.map(client => client.$disconnect()));
    await seedPrisma.$disconnect();
  }
});

test('package exposes the source events:check command and packaged script asset', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
    pkg?: { assets?: string[] };
  };
  assert.equal(manifest.scripts?.['events:check'], 'tsx scripts/events/check-events.ts');
  assert.equal(manifest.pkg?.assets?.includes('dist/scripts/events/check-events.js'), true);
});
