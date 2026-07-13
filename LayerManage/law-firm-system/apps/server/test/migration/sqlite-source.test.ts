import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { createSQLiteFixtures, FIXTURE_LITERALS } from '../fixtures/sqlite/create-fixtures';
import { inventorySqlite, snapshotSqlite } from '../../scripts/migration/sqlite-source';

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('preserves full-fidelity snapshot values without changing either source', () => {
  const fixtures = createSQLiteFixtures();

  try {
    const primaryBefore = hashFile(fixtures.primaryPath);
    const secondaryBefore = hashFile(fixtures.secondaryPath);
    const primaryInventory = inventorySqlite(fixtures.primaryPath);
    const secondaryInventory = inventorySqlite(fixtures.secondaryPath);
    const primarySnapshot = snapshotSqlite(fixtures.primaryPath);
    const secondarySnapshot = snapshotSqlite(fixtures.secondaryPath);
    const primaryUser = primarySnapshot.tables.User.records.find(record => record.id === 'user-primary');
    const secondaryUser = secondarySnapshot.tables.User.records.find(record => record.id === 'user-secondary');
    const customer = primarySnapshot.tables.Customer.records.find(record => record.id === 'customer-sensitive');
    const leadFollow = primarySnapshot.tables.LeadFollow.records.find(record => record.id === 'follow-sensitive');
    const approval = primarySnapshot.tables.Approval.records.find(record => record.id === 'approval-sensitive');

    assert.equal(primaryInventory.source.sha256, primaryBefore);
    assert.equal(secondaryInventory.source.sha256, secondaryBefore);
    assert.equal(primaryInventory.tables.Organization.rowCount, 2);
    assert.equal(primarySnapshot.tables.Organization.records.length, 2);
    assert.equal(primaryUser?.password, FIXTURE_LITERALS.primaryPassword);
    assert.equal(secondaryUser?.password, FIXTURE_LITERALS.secondaryPassword);
    assert.equal(customer?.phone, FIXTURE_LITERALS.customerPhone);
    assert.equal(customer?.email, FIXTURE_LITERALS.customerEmail);
    assert.equal(customer?.idCard, FIXTURE_LITERALS.customerIdCard);
    assert.equal(customer?.remark, FIXTURE_LITERALS.customerRemark);
    assert.equal(leadFollow?.content, FIXTURE_LITERALS.leadFollowContent);
    assert.equal(approval?.content, FIXTURE_LITERALS.approvalContent);
    assert.equal(hashFile(fixtures.primaryPath), primaryBefore);
    assert.equal(hashFile(fixtures.secondaryPath), secondaryBefore);
  } finally {
    fixtures.cleanup();
  }
});

test('rejects a source that changes between snapshot read and final hash', () => {
  const fixtures = createSQLiteFixtures();

  try {
    assert.throws(
      () => snapshotSqlite(fixtures.primaryPath, {
        afterRead() {
          fs.appendFileSync(fixtures.primaryPath, 'controlled-fixture-mutation');
        },
      }),
      /SQLite source changed during read/,
    );
  } finally {
    fixtures.cleanup();
  }
});

test('rejects a source that changes between inventory read and final hash', () => {
  const fixtures = createSQLiteFixtures();

  try {
    assert.throws(
      () => inventorySqlite(fixtures.primaryPath, {
        afterRead() {
          fs.appendFileSync(fixtures.primaryPath, 'controlled-fixture-mutation');
        },
      }),
      /SQLite source changed during read/,
    );
  } finally {
    fixtures.cleanup();
  }
});
