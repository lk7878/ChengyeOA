import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

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

export interface AppliedMigrationStatus {
  readonly migrationName: string;
  readonly finishedAt: Date | null;
  readonly rolledBackAt: Date | null;
}

export interface PackagedMigrationStatusDependencies {
  listExpectedMigrationNames(): readonly string[];
  listAppliedMigrations(databaseUrl: string): Promise<readonly AppliedMigrationStatus[]>;
}

const packagedMigrationStatusDependencies: PackagedMigrationStatusDependencies = {
  listExpectedMigrationNames() {
    const directory = path.resolve(__dirname, '../../prisma/migrations');
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, 'migration.sql')))
      .map(entry => entry.name)
      .sort();
  },
  async listAppliedMigrations(databaseUrl) {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      return await prisma.$queryRaw<AppliedMigrationStatus[]>`
        SELECT
          "migration_name" AS "migrationName",
          "finished_at" AS "finishedAt",
          "rolled_back_at" AS "rolledBackAt"
        FROM "_prisma_migrations"
        ORDER BY "started_at" ASC, "id" ASC
      `;
    } finally {
      await prisma.$disconnect();
    }
  },
};

export async function assertPackagedMigrationsReady(
  databaseUrl: string,
  dependencies: PackagedMigrationStatusDependencies = packagedMigrationStatusDependencies,
): Promise<void> {
  try {
    const expected = [...dependencies.listExpectedMigrationNames()];
    const applied = (await dependencies.listAppliedMigrations(databaseUrl))
      .filter(migration => migration.rolledBackAt === null);
    const appliedNames = applied.map(migration => migration.migrationName);
    if (expected.length === 0
      || new Set(expected).size !== expected.length
      || applied.some(migration => migration.finishedAt === null)
      || new Set(appliedNames).size !== appliedNames.length
      || expected.length !== appliedNames.length
      || expected.some(name => !appliedNames.includes(name))) {
      throw new Error('migration catalog mismatch');
    }
  } catch {
    throw new DatabaseStateError('Database migrations are not ready');
  }
}

export async function assertMigrationsReady(
  databaseUrl: string,
  execute: MigrationExecutor = executeMigration,
): Promise<void> {
  if (typeof (process as NodeJS.Process & { pkg?: unknown }).pkg !== 'undefined') {
    return assertPackagedMigrationsReady(databaseUrl);
  }
  try {
    await execute(process.execPath, [ require.resolve('prisma/build/index.js'), 'migrate', 'status' ], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  } catch {
    throw new DatabaseStateError('Database migrations are not ready');
  }
}
