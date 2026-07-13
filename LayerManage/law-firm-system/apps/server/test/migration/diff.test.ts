import assert from 'node:assert/strict';
import test from 'node:test';
import { createSQLiteFixtures } from '../fixtures/sqlite/create-fixtures';
import { diffSnapshots } from '../../scripts/migration/diff';
import { snapshotSqlite } from '../../scripts/migration/sqlite-source';

function withoutVolatileFields<T extends { generatedAt: string; runId: string }>(value: T): Omit<T, 'generatedAt' | 'runId'> {
  const { generatedAt: _generatedAt, runId: _runId, ...stable } = value;
  return stable;
}

test('reports deterministic ID and business-key conflicts without sensitive values', () => {
  const fixtures = createSQLiteFixtures();

  try {
    const primary = snapshotSqlite(fixtures.primaryPath);
    const secondary = snapshotSqlite(fixtures.secondaryPath);
    const report = diffSnapshots(primary, secondary);
    const repeatedReport = diffSnapshots(primary, secondary);

    assert.equal(report.counts.SECONDARY_ONLY, 1);
    assert.equal(report.counts.CONTENT_MISMATCH, 1);
    assert.equal(report.counts.BUSINESS_KEY_COLLISION, 1);
    assert.ok(report.conflicts.every(conflict => !JSON.stringify(conflict).includes('13800138000')));
    assert.deepEqual(withoutVolatileFields(repeatedReport), withoutVolatileFields(report));
  } finally {
    fixtures.cleanup();
  }
});
