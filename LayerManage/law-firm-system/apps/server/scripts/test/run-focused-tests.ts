import { spawnSync } from 'node:child_process';
import path from 'node:path';

const files = [
  path.resolve('test/app/database-health.test.ts'),
  path.resolve('test/app/health.test.ts'),
];

process.env.EGG_TYPESCRIPT = 'true';
const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), '--test', '--test-force-exit', ...files], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
