import { execFileSync } from 'node:child_process';

type ResetExecutor = (file: string, args: readonly string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: 'inherit';
}) => void;

export function assertSafeTestDatabaseUrl(rawUrl: string, confirmation: string | undefined): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:') throw new Error('Test reset requires PostgreSQL');
  if (!url.pathname.slice(1).endsWith('_test')) throw new Error('Test database name must end with _test');
  if (confirmation !== 'true') throw new Error('ALLOW_TEST_DB_RESET=true is required');
  return url;
}

export function resetTestDatabase(env: NodeJS.ProcessEnv = process.env, execute: ResetExecutor = execFileSync): void {
  const rawUrl = env.DATABASE_URL_TEST || '';
  assertSafeTestDatabaseUrl(rawUrl, env.ALLOW_TEST_DB_RESET);
  const prismaCli = require.resolve('prisma/build/index.js');
  execute(process.execPath, [prismaCli, 'migrate', 'reset', '--force', '--skip-seed'], {
    cwd: process.cwd(),
    env: { ...env, DATABASE_URL: rawUrl },
    stdio: 'inherit',
  });
}

if (require.main === module) resetTestDatabase();
