import { execFile } from 'node:child_process';
import { DatabaseStateError } from '../../app/application/system/system-command-errors';

export interface MigrationExecutionOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type MigrationExecutor = (
  file: string,
  args: readonly string[],
  options: MigrationExecutionOptions,
) => Promise<{ stdout: string; stderr: string }>;

const executeMigration: MigrationExecutor = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, [...args], { cwd: options.cwd, env: options.env, windowsHide: true }, (error, stdout, stderr) => {
    if (error) {
      reject(error);
      return;
    }
    resolve({ stdout: String(stdout), stderr: String(stderr) });
  });
});

export async function assertMigrationsReady(
  databaseUrl: string,
  execute: MigrationExecutor = executeMigration,
): Promise<void> {
  try {
    await execute(process.execPath, [ require.resolve('prisma/build/index.js'), 'migrate', 'status' ], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  } catch {
    throw new DatabaseStateError('Database migrations are not ready');
  }
}
