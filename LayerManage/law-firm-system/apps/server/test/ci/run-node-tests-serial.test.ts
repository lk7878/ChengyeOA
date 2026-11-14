import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  discoverSerialBackendTests,
  runSerialBackendTests,
  type SerialRunnerDependencies,
} from '../../scripts/ci/run-node-tests-serial';

function dependencies(overrides: Partial<SerialRunnerDependencies> = {}): SerialRunnerDependencies {
  return {
    discover: () => ['alpha.test.ts', 'nested/beta.test.ts'],
    spawn: () => ({ status: 0, signal: null }),
    stderr: { write: () => true },
    kill: () => true,
    platform: 'win32',
    pid: 123,
    nodeExecutable: 'node',
    tsxCliPath: 'tsx-cli',
    ...overrides,
  };
}

test('discovers every nested backend test exactly once', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'serial-backend-tests-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'alpha.test.ts'), '');
  fs.writeFileSync(path.join(root, 'nested', 'beta.test.ts'), '');
  fs.writeFileSync(path.join(root, 'nested', 'helper.ts'), '');

  assert.deepEqual(discoverSerialBackendTests(root), [
    path.join(root, 'alpha.test.ts'),
    path.join(root, 'nested', 'beta.test.ts'),
  ]);
});

test('runs each discovered file once with inherited stdout and stderr', () => {
  let invocation: { command: string; args: readonly string[]; options: { stdio: string; env: NodeJS.ProcessEnv } } | undefined;
  const code = runSerialBackendTests('project/test', 'project', dependencies({
    spawn: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, signal: null };
    },
  }));

  assert.equal(code, 0);
  assert.equal(invocation?.command, 'node');
  assert.equal(invocation?.options.stdio, 'inherit');
  assert.equal(invocation?.options.env.EGG_TYPESCRIPT, 'true');
  assert.deepEqual(invocation?.args, [
    'tsx-cli',
    '--test',
    '--test-concurrency=1',
    '--test-force-exit',
    'alpha.test.ts',
    'nested/beta.test.ts',
  ]);
});

test('fails safely without spawning when discovery returns no files', () => {
  const diagnostics: string[] = [];
  let spawned = false;
  const code = runSerialBackendTests('project/test', 'project', dependencies({
    discover: () => [],
    spawn: () => {
      spawned = true;
      return { status: 0, signal: null };
    },
    stderr: { write: message => { diagnostics.push(String(message)); return true; } },
  }));

  assert.equal(code, 1);
  assert.equal(spawned, false);
  assert.deepEqual(diagnostics, ['Backend test runner found no test files.\n']);
});

test('fails safely rather than silently skipping duplicate discovered files', () => {
  const diagnostics: string[] = [];
  let spawned = false;
  const code = runSerialBackendTests('project/test', 'project', dependencies({
    discover: () => ['alpha.test.ts', 'alpha.test.ts'],
    spawn: () => {
      spawned = true;
      return { status: 0, signal: null };
    },
    stderr: { write: message => { diagnostics.push(String(message)); return true; } },
  }));

  assert.equal(code, 1);
  assert.equal(spawned, false);
  assert.deepEqual(diagnostics, ['Backend test runner discovered duplicate test files.\n']);
});

test('propagates the selected numeric child exit code exactly', () => {
  assert.equal(runSerialBackendTests('project/test', 'project', dependencies({
    spawn: () => ({ status: 17, signal: null }),
  })), 17);
});

test('maps a spawn error to a safe diagnostic and nonzero exit', () => {
  const diagnostics: string[] = [];
  const code = runSerialBackendTests('project/test', 'project', dependencies({
    spawn: () => ({ status: null, signal: null, error: new Error('sensitive executable path') }),
    stderr: { write: message => { diagnostics.push(String(message)); return true; } },
  }));

  assert.equal(code, 1);
  assert.deepEqual(diagnostics, ['Backend test runner could not start the child process.\n']);
});

test('maps a thrown spawn error to the same safe diagnostic and nonzero exit', () => {
  const diagnostics: string[] = [];
  const code = runSerialBackendTests('project/test', 'project', dependencies({
    spawn: () => { throw new Error('sensitive executable path'); },
    stderr: { write: message => { diagnostics.push(String(message)); return true; } },
  }));

  assert.equal(code, 1);
  assert.deepEqual(diagnostics, ['Backend test runner could not start the child process.\n']);
});

test('maps a Windows child signal to a safe diagnostic and nonzero exit', () => {
  const diagnostics: string[] = [];
  let killed = false;
  const code = runSerialBackendTests('project/test', 'project', dependencies({
    spawn: () => ({ status: null, signal: 'SIGTERM' }),
    kill: () => { killed = true; return true; },
    stderr: { write: message => { diagnostics.push(String(message)); return true; } },
  }));

  assert.equal(code, 1);
  assert.equal(killed, false);
  assert.deepEqual(diagnostics, ['Backend tests terminated by signal SIGTERM.\n']);
});

test('re-raises a child signal on supported non-Windows platforms', () => {
  const raised: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const code = runSerialBackendTests('project/test', 'project', dependencies({
    platform: 'linux',
    spawn: () => ({ status: null, signal: 'SIGTERM' }),
    kill: (pid, signal) => { raised.push({ pid, signal }); return true; },
  }));

  assert.equal(code, 1);
  assert.deepEqual(raised, [{ pid: 123, signal: 'SIGTERM' }]);
});

test('safely reports a failed non-Windows signal re-raise', () => {
  const diagnostics: string[] = [];
  const code = runSerialBackendTests('project/test', 'project', dependencies({
    platform: 'linux',
    spawn: () => ({ status: null, signal: 'SIGTERM' }),
    kill: () => { throw new Error('not permitted'); },
    stderr: { write: message => { diagnostics.push(String(message)); return true; } },
  }));

  assert.equal(code, 1);
  assert.deepEqual(diagnostics, ['Backend tests terminated by signal SIGTERM and it could not be re-raised.\n']);
});
