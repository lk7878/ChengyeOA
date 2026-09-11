import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPackagedMigrationsReady,
  type PackagedMigrationStatusDependencies,
} from '../../scripts/system/migration-status';

const DATABASE_URL = 'postgresql://operator:never-display@database.example.test/chengye_oa';
const expected = [ '20260712232134_baseline', '20260722120000_events' ];

function dependencies(rows: Array<{
  migrationName: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
}>): PackagedMigrationStatusDependencies {
  return {
    listExpectedMigrationNames() { return expected; },
    async listAppliedMigrations(databaseUrl) {
      assert.equal(databaseUrl, DATABASE_URL);
      return rows;
    },
  };
}

test('packaged migration status accepts exactly the completed bundled catalog', async () => {
  await assertPackagedMigrationsReady(DATABASE_URL, dependencies(expected.map(migrationName => ({
    migrationName,
    finishedAt: new Date('2026-07-22T00:00:00.000Z'),
    rolledBackAt: null,
  }))));
});

test('packaged migration status fails closed on missing, unfinished, duplicate, or additional migrations', async () => {
  const complete = (migrationName: string) => ({
    migrationName,
    finishedAt: new Date('2026-07-22T00:00:00.000Z'),
    rolledBackAt: null,
  });
  const cases = [
    [ complete(expected[0]) ],
    [ complete(expected[0]), { ...complete(expected[1]), finishedAt: null } ],
    [ complete(expected[0]), complete(expected[1]), complete(expected[1]) ],
    [ complete(expected[0]), complete(expected[1]), complete('20260723000000_unknown') ],
  ];
  for (const rows of cases) {
    await assert.rejects(
      () => assertPackagedMigrationsReady(DATABASE_URL, dependencies(rows)),
      /Database migrations are not ready/,
    );
  }
});
