import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { ImportFailure, importSnapshot } from '../../scripts/migration/import-postgres';
import { resetTestDatabase } from '../../scripts/db/reset-test-db';
import { TABLE_ORDER, type TableName } from '../../scripts/migration/table-plan';
import type { SnapshotRecord, SourceSnapshot, TableSnapshot } from '../../scripts/migration/types';
import { assertSafeSeedTestDatabaseUrl } from '../db/seed-test-database-url';

const LEGACY_TIMESTAMP = '2026-04-01 08:00:00';

function organizationRecord(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    id: 'org-import',
    name: 'Imported firm',
    type: 'FIRM',
    parentId: null,
    sort: 0,
    status: 'ENABLED',
    createdAt: LEGACY_TIMESTAMP,
    updatedAt: LEGACY_TIMESTAMP,
    ...overrides,
  };
}

function userRecord(): SnapshotRecord {
  return {
    id: 'user-import',
    username: 'imported-user',
    password: '$2b$10$preservedPasswordHashLiteral',
    status: 'ENABLED',
    employeeId: null,
    lastLoginAt: null,
    createdAt: LEGACY_TIMESTAMP,
    updatedAt: LEGACY_TIMESTAMP,
  };
}

function leadRecord(): SnapshotRecord {
  return {
    id: 'lead-import',
    name: 'Imported lead',
    phone: '13800138000',
    wechat: null,
    channelId: null,
    sourceDetail: 'raw source free-text data',
    intentionLevel: 3,
    status: 'NEW',
    assignedTo: null,
    isValid: true,
    invalidReason: null,
    tags: '["\u91cd\u70b9"]',
    createdAt: LEGACY_TIMESTAMP,
    updatedAt: LEGACY_TIMESTAMP,
  };
}

function snapshot(recordsByTable: Partial<Record<TableName, SnapshotRecord[]>>): SourceSnapshot {
  const tables = TABLE_ORDER.reduce<Record<TableName, TableSnapshot>>((result, table) => {
    const records = recordsByTable[table] ?? [];
    result[table] = {
      columns: [...new Set(records.flatMap(record => Object.keys(record)))].sort(),
      rowCount: records.length,
      records,
    };
    return result;
  }, {} as Record<TableName, TableSnapshot>);

  return {
    generatedAt: '2026-04-01T00:00:00.000Z',
    runId: 'task-7-test',
    source: { path: 'fixture.sqlite', sha256: 'fixture-sha256' },
    tables,
  };
}

async function withProtectedTestDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseUrl = assertSafeSeedTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  resetTestDatabase(process.env);
  const pool = new Pool({ connectionString: databaseUrl.toString(), max: 1 });

  try {
    await run(pool);
  } finally {
    await pool.end();
  }
}

test('imports a snapshot idempotently with zero second-run inserts and unchanged table counts', async () => {
  await withProtectedTestDatabase(async pool => {
    const client = await pool.connect();

    try {
      const fixture = snapshot({ Organization: [organizationRecord()], User: [userRecord()], Lead: [leadRecord()] });
      const first = await importSnapshot(client, fixture);
      const firstCount = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM "organization"');
      const second = await importSnapshot(client, fixture);
      const secondCount = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM "organization"');
      const protectedValues = await client.query<{ password: string; phone: string; sourceDetail: string }>(
        'SELECT (SELECT "password" FROM "user" WHERE "id" = $1) AS "password", '
          + '(SELECT "phone" FROM "lead" WHERE "id" = $2) AS "phone", '
          + '(SELECT "sourceDetail" FROM "lead" WHERE "id" = $2) AS "sourceDetail"',
        ['user-import', 'lead-import'],
      );

      assert.deepEqual(first, { inserted: 3, updated: 0, skipped: 0, failed: 0, failures: [] });
      assert.deepEqual(second, { inserted: 0, updated: 0, skipped: 3, failed: 0, failures: [] });
      assert.equal(firstCount.rows[0].count, '1');
      assert.equal(secondCount.rows[0].count, firstCount.rows[0].count);
      assert.deepEqual(protectedValues.rows, [{
        password: '$2b$10$preservedPasswordHashLiteral',
        phone: '13800138000',
        sourceDetail: 'raw source free-text data',
      }]);
    } finally {
      client.release();
    }
  });
});

test('updates a changed row without changing its preserved id', async () => {
  await withProtectedTestDatabase(async pool => {
    const client = await pool.connect();

    try {
      await importSnapshot(client, snapshot({ Organization: [organizationRecord()] }));
      const report = await importSnapshot(client, snapshot({ Organization: [organizationRecord({ name: 'Renamed firm' })] }));
      const stored = await client.query<{ id: string; name: string }>('SELECT "id", "name" FROM "organization"');

      assert.deepEqual(report, { inserted: 0, updated: 1, skipped: 0, failed: 0, failures: [] });
      assert.deepEqual(stored.rows, [{ id: 'org-import', name: 'Renamed firm' }]);
    } finally {
      client.release();
    }
  });
});

test('rolls back the entire ordered import and reports only failing table id and error code', async () => {
  await withProtectedTestDatabase(async pool => {
    const client = await pool.connect();

    try {
      const fixture = snapshot({
        Organization: [organizationRecord()],
        Position: [{
          id: 'position-invalid',
          name: 'Invalid position',
          orgId: 'missing-organization',
          level: 0,
          responsibilities: null,
          status: 'ENABLED',
          createdAt: LEGACY_TIMESTAMP,
          updatedAt: LEGACY_TIMESTAMP,
        }],
      });

      await assert.rejects(
        () => importSnapshot(client, fixture),
        (error: unknown) => {
          assert.ok(error instanceof ImportFailure);
          assert.deepEqual(error.report, {
            inserted: 1,
            updated: 0,
            skipped: 0,
            failed: 1,
            failures: [{ table: 'Position', id: 'position-invalid', code: '23503' }],
          });
          assert.equal(error.message, 'PostgreSQL import failed');
          return true;
        },
      );

      const count = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM "organization"');
      assert.equal(count.rows[0].count, '0');
    } finally {
      client.release();
    }
  });
});

test('rejects malicious snapshot column identifiers before issuing dynamic SQL', async () => {
  await withProtectedTestDatabase(async pool => {
    const client = await pool.connect();

    try {
      const malicious = organizationRecord({ 'name"; DROP TABLE organization; --': 'never execute' });
      await assert.rejects(
        () => importSnapshot(client, snapshot({ Organization: [malicious] })),
        (error: unknown) => {
          assert.ok(error instanceof ImportFailure);
          assert.deepEqual(error.report.failures, [{ table: 'Organization', id: 'org-import', code: 'INVALID_IDENTIFIER' }]);
          assert.equal(error.message, 'PostgreSQL import failed');
          assert.equal(JSON.stringify(error.report).includes('never execute'), false);
          return true;
        },
      );

      const count = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM "organization"');
      assert.equal(count.rows[0].count, '0');
    } finally {
      client.release();
    }
  });
});
