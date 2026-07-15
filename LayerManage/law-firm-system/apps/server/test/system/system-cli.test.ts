import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';
import type { PrismaClient } from '@prisma/client';
import {
  assertMigrationsReady,
  type MigrationExecutor,
} from '../../scripts/system/migration-status';
import {
  bootstrapMain,
  recoveryMain,
  type SystemCliDependencies,
} from '../../scripts/system/system-cli';
import {
  AlreadyInitializedError,
  DatabaseStateError,
} from '../../app/application/system/system-command-errors';
import { TerminalPrompts, type TerminalPromptDependencies } from '../../scripts/system/terminal-prompts';

const databaseUrl = 'postgresql://operator:never-display@db.example.test:55432/chengye_oa_test?schema=private';

interface PromptRecorder {
  readonly texts: string[];
  readonly secrets: string[];
  closed: boolean;
}

function fakeDependencies(
  answers: readonly string[] = [],
  overrides: Partial<SystemCliDependencies> = {},
): SystemCliDependencies & { recorder: PromptRecorder } {
  const values = [...answers];
  const recorder: PromptRecorder = { texts: [], secrets: [], closed: false };
  const output: string[] = [];
  const sink = { write: (value: string) => { output.push(value); return true; } };
  const prisma = { $disconnect: async () => undefined } as unknown as PrismaClient;

  return {
    recorder,
    isTty: true,
    prompts: {
      text: async label => {
        recorder.texts.push(label);
        return values.shift() ?? '';
      },
      secret: async label => {
        recorder.secrets.push(label);
        return values.shift() ?? '';
      },
      close: () => { recorder.closed = true; },
    },
    stdout: sink,
    stderr: sink,
    assertMigrationsReady: async () => undefined,
    createPrisma: () => prisma,
    runBootstrap: async () => ({ organizationName: 'Example Firm', username: 'root.admin' }),
    runRecovery: async () => ({ username: 'root.admin' }),
    hostname: () => 'test-host',
    randomUUID: () => 'test-reference',
    output,
    ...overrides,
  } as SystemCliDependencies & { recorder: PromptRecorder };
}

test('rejects non-TTY bootstrap before prompts, migrations, or database connection', async () => {
  let migrationChecked = false;
  let connected = false;
  const deps = fakeDependencies([], {
    isTty: false,
    assertMigrationsReady: async () => { migrationChecked = true; },
    createPrisma: () => { connected = true; throw new Error('must not connect'); },
  });

  const code = await bootstrapMain([], { DATABASE_URL: databaseUrl }, deps);

  assert.equal(code, 2);
  assert.equal(migrationChecked, false);
  assert.equal(connected, false);
  assert.deepEqual(deps.recorder.texts, []);
  assert.equal(deps.recorder.closed, true);
});

test('rejects every argument before recovery prompts, migrations, or database connection', async () => {
  let migrationChecked = false;
  let connected = false;
  const deps = fakeDependencies([], {
    assertMigrationsReady: async () => { migrationChecked = true; },
    createPrisma: () => { connected = true; throw new Error('must not connect'); },
  });

  const code = await recoveryMain(['--anything'], { DATABASE_URL: databaseUrl, ALLOW_SUPER_ADMIN_RECOVERY: 'true' }, deps);

  assert.equal(code, 2);
  assert.equal(migrationChecked, false);
  assert.equal(connected, false);
  assert.deepEqual(deps.recorder.texts, []);
  assert.equal(deps.recorder.closed, true);
});

test('rejects non-TTY recovery before prompts, migrations, or database connection', async () => {
  let migrationChecked = false;
  let connected = false;
  const deps = fakeDependencies([], {
    isTty: false,
    assertMigrationsReady: async () => { migrationChecked = true; },
    createPrisma: () => { connected = true; throw new Error('must not connect'); },
  });

  const code = await recoveryMain([], { DATABASE_URL: databaseUrl, ALLOW_SUPER_ADMIN_RECOVERY: 'true' }, deps);

  assert.equal(code, 2);
  assert.equal(migrationChecked, false);
  assert.equal(connected, false);
  assert.deepEqual(deps.recorder.texts, []);
  assert.deepEqual(deps.recorder.secrets, []);
  assert.equal(deps.recorder.closed, true);
});

test('rejects every argument before bootstrap prompts, migrations, or database connection', async () => {
  let migrationChecked = false;
  let connected = false;
  const deps = fakeDependencies([], {
    assertMigrationsReady: async () => { migrationChecked = true; },
    createPrisma: () => { connected = true; throw new Error('must not connect'); },
  });

  const code = await bootstrapMain(['--anything'], { DATABASE_URL: databaseUrl }, deps);

  assert.equal(code, 2);
  assert.equal(migrationChecked, false);
  assert.equal(connected, false);
  assert.deepEqual(deps.recorder.texts, []);
  assert.deepEqual(deps.recorder.secrets, []);
  assert.equal(deps.recorder.closed, true);
});

test('does not connect when recovery is disabled', async () => {
  let migrationChecked = false;
  let connected = false;
  const deps = fakeDependencies([], {
    assertMigrationsReady: async () => { migrationChecked = true; },
    createPrisma: () => { connected = true; throw new Error('must not run'); },
  });

  const code = await recoveryMain([], { ALLOW_SUPER_ADMIN_RECOVERY: 'false' }, deps);

  assert.equal(code, 6);
  assert.equal(migrationChecked, false);
  assert.equal(connected, false);
  assert.equal(deps.recorder.closed, true);
});

for (const { name, target, injected } of [
  { name: 'newline database name', target: 'postgresql://db.example.test/chengye%0Ainjected', injected: 'chengye\ninjected' },
  { name: 'tab database name', target: 'postgresql://db.example.test/chengye%09injected', injected: 'chengye\tinjected' },
  { name: 'NUL database name', target: 'postgresql://db.example.test/chengye%00injected', injected: 'chengye\0injected' },
  { name: 'hostless database URL', target: 'postgresql:///chengye_oa', injected: 'chengye_oa' },
  { name: 'malformed percent encoding', target: 'postgresql://db.example.test/chengye%ZZoa', injected: 'chengye%ZZoa' },
]) {
  test(`rejects ${name} before output, migrations, prompts, or database connection`, async () => {
    let migrations = 0;
    let connections = 0;
    const deps = fakeDependencies([], {
      assertMigrationsReady: async () => { migrations += 1; },
      createPrisma: () => { connections += 1; throw new Error('must not connect'); },
    });

    const code = await bootstrapMain([], { DATABASE_URL: target }, deps);
    const transcript = (deps as unknown as { output: string[] }).output.join('');

    assert.equal(code, 2);
    assert.equal(migrations, 0);
    assert.equal(connections, 0);
    assert.deepEqual(deps.recorder.texts, []);
    assert.deepEqual(deps.recorder.secrets, []);
    assert.doesNotMatch(transcript, new RegExp(injected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('mutes secret input while preserving prompt ordering, text input, and close behavior', async () => {
  let transcript = '';
  let closeCalls = 0;
  let currentAnswer: ((answer: string) => void) | undefined;
  let readlineOutput: Writable | undefined;
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      transcript += chunk.toString();
      callback();
    },
  }) as Writable & { isTTY: boolean };
  stdout.isTTY = true;
  const dependencies: TerminalPromptDependencies = {
    input: { isTTY: true } as NodeJS.ReadableStream & { isTTY?: boolean },
    output: stdout,
    createInterface: options => {
      readlineOutput = options.output as Writable;
      return {
        question: (label, callback) => {
          readlineOutput?.write(label);
          currentAnswer = callback;
        },
        close: () => { closeCalls += 1; },
      };
    },
  };
  const prompts = new TerminalPrompts(dependencies);

  const secret = prompts.secret('Password: ');
  assert.equal(transcript, 'Password: ');
  readlineOutput?.write('typed-secret');
  assert.equal(transcript, 'Password: ');
  assert.doesNotMatch(transcript, /typed-secret/);
  currentAnswer?.('typed-secret');
  assert.equal(await secret, 'typed-secret');
  assert.equal(transcript, 'Password: \n');

  const text = prompts.text('Username: ');
  readlineOutput?.write('root.admin');
  currentAnswer?.('root.admin');
  assert.equal(await text, 'root.admin');
  assert.equal(transcript, 'Password: \nUsername: root.admin');

  prompts.close();
  assert.equal(closeCalls, 1);
});

test('bootstraps with a redacted database target and exact confirmation phrase', async () => {
  let received: Record<string, unknown> | undefined;
  const deps = fakeDependencies([
    'Example Firm',
    'Root.Admin',
    'temporary-password',
    'temporary-password',
    'INITIALIZE chengye_oa_test',
  ], {
    runBootstrap: async (_prisma, input, metadata) => {
      received = { ...input, ...metadata };
      return { organizationName: input.organizationName, username: 'root.admin' };
    },
  });

  const code = await bootstrapMain([], { DATABASE_URL: databaseUrl }, deps);
  const transcript = (deps as unknown as { output: string[] }).output.join('');

  assert.equal(code, 0);
  assert.deepEqual(received, {
    organizationName: 'Example Firm',
    username: 'Root.Admin',
    password: 'temporary-password',
    databaseName: 'chengye_oa_test',
    hostname: 'test-host',
  });
  assert.match(transcript, /db\.example\.test:55432\/chengye_oa_test/);
  assert.doesNotMatch(transcript, /operator|never-display|schema=private|postgresql:/);
  assert.equal(deps.recorder.texts.at(-1), 'Type INITIALIZE chengye_oa_test to confirm: ');
  assert.deepEqual(deps.recorder.secrets, ['Temporary password: ', 'Confirm temporary password: ']);
  assert.equal(deps.recorder.closed, true);
});

test('uses normalized recovery username in the exact confirmation phrase', async () => {
  let received: Record<string, unknown> | undefined;
  const deps = fakeDependencies([
    ' Root.Admin ',
    'temporary-password',
    'temporary-password',
    'Approved incident ticket 42',
    'RECOVER chengye_oa_test root.admin',
  ], {
    runRecovery: async (_prisma, input, metadata) => {
      received = { ...input, ...metadata };
      return { username: 'root.admin' };
    },
  });

  const code = await recoveryMain([], { DATABASE_URL: databaseUrl, ALLOW_SUPER_ADMIN_RECOVERY: 'true' }, deps);

  assert.equal(code, 0);
  assert.deepEqual(received, {
    enabled: true,
    username: ' Root.Admin ',
    temporaryPassword: 'temporary-password',
    reason: 'Approved incident ticket 42',
    databaseName: 'chengye_oa_test',
    hostname: 'test-host',
  });
  assert.equal(deps.recorder.texts.at(-1), 'Type RECOVER chengye_oa_test root.admin to confirm: ');
  assert.equal(deps.recorder.closed, true);
});

test('maps known errors and never emits their raw message', async () => {
  const deps = fakeDependencies([], {
    assertMigrationsReady: async () => { throw new AlreadyInitializedError('raw service secret'); },
  });

  const code = await bootstrapMain([], { DATABASE_URL: databaseUrl }, deps);
  const transcript = (deps as unknown as { output: string[] }).output.join('');

  assert.equal(code, 3);
  assert.doesNotMatch(transcript, /raw service secret/);
  assert.equal(deps.recorder.closed, true);
});

test('maps unknown errors to a generated reference without raw details', async () => {
  const deps = fakeDependencies([], {
    assertMigrationsReady: async () => { throw new Error('postgresql://operator:never-display@hidden'); },
  });

  const code = await bootstrapMain([], { DATABASE_URL: databaseUrl }, deps);
  const transcript = (deps as unknown as { output: string[] }).output.join('');

  assert.equal(code, 70);
  assert.match(transcript, /System command failed\. Reference: test-reference/);
  assert.doesNotMatch(transcript, /never-display|hidden|postgresql:/);
  assert.equal(deps.recorder.closed, true);
});

test('rejects failed migration status without exposing Prisma output', async () => {
  const execute: MigrationExecutor = async () => {
    throw new Error('Prisma output with postgresql://operator:never-display@hidden');
  };

  await assert.rejects(
    () => assertMigrationsReady(databaseUrl, execute),
    error => error instanceof DatabaseStateError && !error.message.includes('never-display'),
  );
});

test('runs local Prisma migrate status with the process executable', async () => {
  let observed: { file: string; args: readonly string[]; databaseUrl: string | undefined } | undefined;
  const execute: MigrationExecutor = async (file, args, options) => {
    observed = { file, args, databaseUrl: options.env.DATABASE_URL };
    return { stdout: '', stderr: '' };
  };

  await assertMigrationsReady(databaseUrl, execute);

  assert.equal(observed?.file, process.execPath);
  assert.deepEqual(observed?.args.slice(1), ['migrate', 'status']);
  assert.equal(observed?.databaseUrl, databaseUrl);
});
