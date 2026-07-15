import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { discoverBackendTests } from '../test/test-files';

const files = discoverBackendTests(path.resolve('test'));
if (files.length === 0) throw new Error('No backend test files found');
process.env.EGG_TYPESCRIPT = 'true';
const result = spawnSync(process.execPath, [
  require.resolve('tsx/cli'),
  '--test',
  '--test-concurrency=1',
  '--test-force-exit',
  ...files,
], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
