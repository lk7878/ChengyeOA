import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const requireCjs = createRequire(__filename);

test('portable command router exposes server start, events:drain, and events:check only', async () => {
  const modulePath = path.resolve('scripts/lib/portable-command.js');
  assert.equal(fs.existsSync(modulePath), true, 'portable command router must exist');
  const { routePortableCommand } = requireCjs(modulePath) as {
    routePortableCommand(
      argv: readonly string[],
      dependencies: {
        runServer(): Promise<void>;
        runDrain(argv: readonly string[]): Promise<number>;
        runCheck(argv: readonly string[]): Promise<number>;
        stderr: { write(value: string): unknown };
      },
    ): Promise<number | undefined>;
  };
  const calls: string[] = [];
  const stderr: string[] = [];
  const dependencies = {
    async runServer() { calls.push('server'); },
    async runDrain(argv: readonly string[]) { calls.push(`drain:${argv.join(',')}`); return 7; },
    async runCheck(argv: readonly string[]) { calls.push(`check:${argv.join(',')}`); return 3; },
    stderr: { write(value: string) { stderr.push(value); } },
  };

  assert.equal(await routePortableCommand([], dependencies), undefined);
  assert.equal(await routePortableCommand([ 'events:drain' ], dependencies), 7);
  assert.equal(await routePortableCommand([ 'events:drain', '--forbidden-secret' ], dependencies), 7);
  assert.equal(await routePortableCommand([ 'events:check', '--mode=canary' ], dependencies), 3);
  assert.equal(await routePortableCommand([ 'events:check', '--forbidden-secret' ], dependencies), 3);
  assert.equal(await routePortableCommand([ 'unknown-secret-command' ], dependencies), 2);
  assert.deepEqual(calls, [
    'server',
    'drain:',
    'drain:--forbidden-secret',
    'check:--mode=canary',
    'check:--forbidden-secret',
  ]);
  assert.equal(stderr.join(''), 'Application command is invalid.\n');
  assert.doesNotMatch(stderr.join(''), /unknown|secret/i);
});
