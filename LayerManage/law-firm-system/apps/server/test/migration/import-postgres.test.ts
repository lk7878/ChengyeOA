import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import {
  ImportCommitUncertain,
  ImportFailure,
  importSnapshot,
  importSnapshotFromDatabaseUrl,
  type ImportPoolFactory,
} from '../../scripts/migration/import-postgres';
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

function userRecord(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    id: 'user-import',
    username: 'imported-user',
    password: '$2b$10$preservedPasswordHashLiteral',
    status: 'ENABLED',
    employeeId: null,
    lastLoginAt: null,
    createdAt: LEGACY_TIMESTAMP,
    updatedAt: LEGACY_TIMESTAMP,
    ...overrides,
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

function noQueryClient(): { client: PoolClient; queries: unknown[][] } {
  const queries: unknown[][] = [];
  const client = {
    async query(...args: unknown[]) {
      queries.push(args);
      throw new Error('query must not start during snapshot preflight');
    },
  } as unknown as PoolClient;

  return { client, queries };
}

async function assertPreflightFailure(
  fixture: SourceSnapshot,
  expected: { table: TableName; id: string; reason: 'missing-id' | 'duplicate-id' },
): Promise<void> {
  const { client, queries } = noQueryClient();

  await assert.rejects(
    () => importSnapshot(client, fixture),
    (error: unknown) => {
      assert.ok(error instanceof ImportFailure);
      assert.deepEqual(error.report, {
        inserted: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
        failures: [{ ...expected, code: 'INVALID_VALUE' }],
      });
      assert.equal(error.message, 'PostgreSQL import failed');
      return true;
    },
  );
  assert.deepEqual(queries, []);
}

test('preflights missing and empty snapshot IDs before starting any query or transaction', async () => {
  await assertPreflightFailure(
    snapshot({ Organization: [organizationRecord({ id: undefined as never })] }),
    { table: 'Organization', id: 'unknown', reason: 'missing-id' },
  );
  await assertPreflightFailure(
    snapshot({ Organization: [organizationRecord({ id: '' })] }),
    { table: 'Organization', id: 'unknown', reason: 'missing-id' },
  );
});

test('preflights identical duplicate IDs before starting any query or transaction', async () => {
  await assertPreflightFailure(
    snapshot({ Organization: [organizationRecord(), organizationRecord()] }),
    { table: 'Organization', id: 'org-import', reason: 'duplicate-id' },
  );
});

test('preflights conflicting duplicate IDs before starting any query or transaction', async () => {
  await assertPreflightFailure(
    snapshot({ Organization: [organizationRecord(), organizationRecord({ name: 'Conflicting duplicate' })] }),
    { table: 'Organization', id: 'org-import', reason: 'duplicate-id' },
  );
});

test('preserves a legitimate source ID equal to the reporting placeholder', async () => {
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      queries.push(text);
      if (text.startsWith('SELECT')) return { rowCount: 0, rows: [] };
      return { rowCount: null, rows: [] };
    },
  } as unknown as PoolClient;

  const report = await importSnapshot(client, snapshot({ Organization: [organizationRecord({ id: 'unknown' })] }));

  assert.deepEqual(report, { inserted: 1, updated: 0, skipped: 0, failed: 0, failures: [] });
  assert.equal(queries[0], 'BEGIN');
  assert.equal(queries.at(-1), 'COMMIT');
});

function lifecyclePool(
  events: string[],
  query: (text: string) => Promise<{ rowCount: number | null; rows: unknown[] }>,
) {
  const client = {
    query,
    release() {
      events.push('release');
    },
  } as unknown as PoolClient;

  return {
    async connect() {
      events.push('connect');
      return client;
    },
    async end() {
      events.push('end');
    },
  };
}

test('database URL wrapper releases the client before ending the pool on success', async () => {
  const events: string[] = [];
  const factory: ImportPoolFactory = () => lifecyclePool(events, async text => {
    events.push(text);
    return { rowCount: null, rows: [] };
  });

  const report = await importSnapshotFromDatabaseUrl(
    'postgresql://fixture-user:fixture-secret@localhost:55432/chengye_oa_test',
    snapshot({}),
    factory,
  );

  assert.deepEqual(report, { inserted: 0, updated: 0, skipped: 0, failed: 0, failures: [] });
  assert.deepEqual(events, ['connect', 'BEGIN', 'COMMIT', 'release', 'end']);
});

test('database URL wrapper releases and ends on failure without leaking the connection string', async () => {
  const databaseUrl = 'postgresql://fixture-user:fixture-secret@localhost:55432/chengye_oa_test';
  const events: string[] = [];
  const factory: ImportPoolFactory = () => lifecyclePool(events, async text => {
    events.push(text);
    if (text.startsWith('SELECT')) return { rowCount: 0, rows: [] };
    if (text.startsWith('INSERT')) {
      const error = new Error(`synthetic failure for ${databaseUrl}`) as Error & { code: string };
      error.code = '23505';
      throw error;
    }
    return { rowCount: null, rows: [] };
  });

  await assert.rejects(
    () => importSnapshotFromDatabaseUrl(databaseUrl, snapshot({ Organization: [organizationRecord()] }), factory),
    (error: unknown) => {
      assert.ok(error instanceof ImportFailure);
      assert.equal(String(error).includes(databaseUrl), false);
      assert.equal(JSON.stringify(error.report).includes(databaseUrl), false);
      return true;
    },
  );
  assert.deepEqual(events, ['connect', 'BEGIN', events[2], events[3], 'ROLLBACK', 'release', 'end']);
  assert.match(events[2], /^SELECT /);
  assert.match(events[3], /^INSERT /);
});

test('treats a rejected COMMIT as uncertain without issuing rollback or exposing the cause', async () => {
  const events: string[] = [];
  let serverCommitted = false;
  const client = {
    async query(text: string) {
      events.push(text);
      if (text === 'COMMIT') {
        serverCommitted = true;
        const error = new Error('private transport detail') as Error & { code: string };
        error.code = 'ECONNRESET';
        throw error;
      }
      return { rowCount: null, rows: [] };
    },
  } as unknown as PoolClient;

  await assert.rejects(
    () => importSnapshot(client, snapshot({})),
    (error: unknown) => {
      assert.ok(error instanceof ImportCommitUncertain);
      assert.equal(error.message, 'PostgreSQL commit outcome uncertain');
      assert.deepEqual(error.metadata, { stage: 'commit' });
      assert.equal(JSON.stringify(error).includes('private transport detail'), false);
      assert.equal(JSON.stringify(error).includes('ECONNRESET'), false);
      return true;
    },
  );
  assert.equal(serverCommitted, true);
  assert.deepEqual(events, ['BEGIN', 'COMMIT']);
});

test('database URL wrapper consumes DATABASE_URL when no explicit string is supplied', async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const expectedDatabaseUrl = 'postgresql://environment-user:environment-secret@localhost:55432/chengye_oa_test';
  const receivedUrls: string[] = [];
  const events: string[] = [];
  process.env.DATABASE_URL = expectedDatabaseUrl;

  try {
    const factory: ImportPoolFactory = (databaseUrl: string) => {
      receivedUrls.push(databaseUrl);
      return lifecyclePool(events, async text => {
        events.push(text);
        return { rowCount: null, rows: [] };
      });
    };
    await importSnapshotFromDatabaseUrl(undefined, snapshot({}), factory);
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }

  assert.deepEqual(receivedUrls, [expectedDatabaseUrl]);
  assert.deepEqual(events, ['connect', 'BEGIN', 'COMMIT', 'release', 'end']);
});

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

test('rolls back on a target-side business-key conflict without exposing the unique value', async () => {
  await withProtectedTestDatabase(async pool => {
    const client = await pool.connect();

    try {
      await importSnapshot(client, snapshot({
        User: [userRecord({ id: 'user-existing', username: 'duplicate-business-key' })],
      }));
      const fixture = snapshot({
        Organization: [organizationRecord()],
        User: [userRecord({ id: 'user-conflict', username: 'duplicate-business-key' })],
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
            failures: [{ table: 'User', id: 'user-conflict', code: '23505' }],
          });
          assert.equal(error.message, 'PostgreSQL import failed');
          assert.equal(JSON.stringify(error.report).includes('duplicate-business-key'), false);
          return true;
        },
      );

      const organizationCount = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM "organization"',
      );
      const users = await client.query<{ id: string }>('SELECT "id" FROM "user" ORDER BY "id"');
      assert.equal(organizationCount.rows[0].count, '0');
      assert.deepEqual(users.rows, [{ id: 'user-existing' }]);
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
