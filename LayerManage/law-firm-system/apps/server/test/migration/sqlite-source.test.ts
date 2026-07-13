import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { createSQLiteFixtures } from '../fixtures/sqlite/create-fixtures';
import { inventorySqlite, snapshotSqlite } from '../../scripts/migration/sqlite-source';

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('inventories a fixture source without changing its hash', () => {
  const fixtures = createSQLiteFixtures();

  try {
    const before = hashFile(fixtures.primaryPath);
    const inventory = inventorySqlite(fixtures.primaryPath);
    const snapshot = snapshotSqlite(fixtures.primaryPath);

    assert.equal(inventory.source.sha256, before);
    assert.equal(inventory.tables.Organization.rowCount, 2);
    assert.equal(snapshot.tables.Organization.records.length, 2);
    assert.equal(hashFile(fixtures.primaryPath), before);
    assert.ok(!JSON.stringify(snapshot).includes('13800138000'));
  } finally {
    fixtures.cleanup();
  }
});
