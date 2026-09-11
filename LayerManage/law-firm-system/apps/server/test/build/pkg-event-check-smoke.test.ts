import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const enabled = process.platform === 'win32' && process.env.RUN_PKG_EVENT_CHECK_SMOKE === 'true';
const executable = path.resolve('../dist/law-firm-system/law-firm-system.exe');
const FORBIDDEN_DIAGNOSTIC = /private-payload-value|postgresql:|PkgStrongPassword|starting|localhost:7001|Prisma|P10\d\d/i;

function smokeEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://pkg_operator:PkgStrongPassword47@127.0.0.1:1/chengye_oa?schema=public',
    JWT_SECRET: 'pkg-jwt-secret-with-at-least-32-characters',
    APP_KEYS: 'pkg-first-application-key-with-32-chars,pkg-second-application-key-with-32-chars',
    MFA_ENCRYPTION_KEY_V1: Buffer.from('pkg-smoke-32-byte-key-material!!').toString('base64'),
    CORS_ALLOWED_ORIGINS: 'https://oa.example.test',
    EVENT_WORKER_ENABLED: 'false',
  };
}

function safeTranscript(result: ReturnType<typeof spawnSync>): string {
  const diagnostics = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}\n${String(result.error ?? '')}`;
  assert.equal(
    FORBIDDEN_DIAGNOSTIC.test(diagnostics),
    false,
    'Portable event check emitted forbidden diagnostic data.',
  );
  return `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;
}

test('real Windows portable executable routes check arguments without starting Egg', {
  skip: enabled ? false : 'set RUN_PKG_EVENT_CHECK_SMOKE=true after building the Windows pkg artifact',
}, () => {
  assert.equal(fs.existsSync(executable), true, 'packaged executable must exist before smoke');
  const result = spawnSync(executable, [ 'events:check', '--private-payload-value' ], {
    encoding: 'utf8',
    env: smokeEnvironment(),
    timeout: 60_000,
    windowsHide: true,
  });

  const transcript = safeTranscript(result);
  assert.equal(result.error === undefined, true, 'Portable event check failed to start safely.');
  assert.equal(result.status, 2, 'Portable event check returned an unexpected invalid-input exit status.');
  assert.match(transcript, /Event observability input is invalid/);
});

test('real Windows portable check reaches a safe database-unavailable exit', {
  skip: enabled ? false : 'set RUN_PKG_EVENT_CHECK_SMOKE=true after building the Windows pkg artifact',
}, () => {
  assert.equal(fs.existsSync(executable), true, 'packaged executable must exist before smoke');
  const result = spawnSync(executable, [ 'events:check', '--mode=preflight' ], {
    encoding: 'utf8',
    env: smokeEnvironment(),
    timeout: 60_000,
    windowsHide: true,
  });

  const transcript = safeTranscript(result);
  assert.equal(result.error === undefined, true, 'Portable event check failed to start safely.');
  assert.equal(result.status, 5, 'Portable event check returned an unexpected database exit status.');
  assert.match(transcript, /Database state is unavailable/);
});
