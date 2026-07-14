import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { createSQLiteFixtures, FIXTURE_LITERALS } from '../fixtures/sqlite/create-fixtures';
import { diffSnapshots } from '../../scripts/migration/diff';
import { inventorySqlite, snapshotSqlite } from '../../scripts/migration/sqlite-source';

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function withoutVolatileFields<T extends { generatedAt: string; runId: string }>(value: T): Omit<T, 'generatedAt' | 'runId'> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'generatedAt' && key !== 'runId'),
  ) as Omit<T, 'generatedAt' | 'runId'>;
}

test('reports deterministic metadata only and leaves both fixture sources unchanged', () => {
  const fixtures = createSQLiteFixtures();

  try {
    const primaryBefore = hashFile(fixtures.primaryPath);
    const secondaryBefore = hashFile(fixtures.secondaryPath);
    const primaryInventory = inventorySqlite(fixtures.primaryPath);
    const secondaryInventory = inventorySqlite(fixtures.secondaryPath);
    const primary = snapshotSqlite(fixtures.primaryPath);
    const secondary = snapshotSqlite(fixtures.secondaryPath);
    const report = diffSnapshots(primary, secondary);
    const repeatedReport = diffSnapshots(primary, secondary);
    const serializedReports = JSON.stringify({ primaryInventory, secondaryInventory, report });

    assert.equal(report.counts.SECONDARY_ONLY, 1);
    assert.equal(report.counts.CONTENT_MISMATCH, 1);
    assert.equal(report.counts.BUSINESS_KEY_COLLISION, 1);
    assert.ok(!serializedReports.includes('"records"'));
    for (const literal of Object.values(FIXTURE_LITERALS)) {
      assert.ok(!serializedReports.includes(literal), `report exposed fixture literal: ${literal}`);
    }
    assert.deepEqual(withoutVolatileFields(repeatedReport), withoutVolatileFields(report));
    assert.equal(hashFile(fixtures.primaryPath), primaryBefore);
    assert.equal(hashFile(fixtures.secondaryPath), secondaryBefore);
  } finally {
    fixtures.cleanup();
  }
});
