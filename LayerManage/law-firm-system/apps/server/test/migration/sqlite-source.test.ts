import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
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

test('rejects a WAL-backed source whose committed row is absent from the unchanged main database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chengye-oa-wal-source-'));
  const sourcePath = path.join(directory, 'wal-only.db');
  const database = new Database(sourcePath);

  try {
    database.pragma('journal_mode = WAL');
    database.exec('CREATE TABLE "Organization" (id TEXT PRIMARY KEY)');
    database.pragma('wal_checkpoint(TRUNCATE)');
    const mainBefore = hashFile(sourcePath);

    database.exec("INSERT INTO \"Organization\" (id) VALUES ('wal-only-row')");

    assert.equal(hashFile(sourcePath), mainBefore);
    assert.equal(fs.existsSync(`${sourcePath}-wal`), true);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "Organization"').get().count, 1);
    assert.throws(() => snapshotSqlite(sourcePath), /^Error: SQLite source has active sidecar$/);
    assert.throws(() => inventorySqlite(sourcePath), /^Error: SQLite source has active sidecar$/);
  } finally {
    database.close();
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test('rejects a journal sidecar created after a readonly snapshot read', () => {
  const fixtures = createSQLiteFixtures();
  const sidecar = `${fixtures.primaryPath}-journal`;

  try {
    assert.throws(
      () => snapshotSqlite(fixtures.primaryPath, {
        afterRead() {
          fs.writeFileSync(sidecar, 'fixture-sidecar');
        },
      }),
      /^Error: SQLite source has active sidecar$/,
    );
  } finally {
    fixtures.cleanup();
  }
});

test('rejects a super-journal sidecar created after a readonly inventory read', () => {
  const fixtures = createSQLiteFixtures();
  const sidecar = `${fixtures.primaryPath}-mjABCDEF912`;

  try {
    assert.throws(
      () => inventorySqlite(fixtures.primaryPath, {
        afterRead() {
          fs.writeFileSync(sidecar, 'fixture-sidecar');
        },
      }),
      /^Error: SQLite source has active sidecar$/,
    );
  } finally {
    fixtures.cleanup();
  }
});

test('rejects sidecars when Windows source-path casing differs from its directory entry', t => {
  if (process.platform !== 'win32') {
    t.skip('case-insensitive source path fixture is Windows-specific');
    return;
  }
  const fixtures = createSQLiteFixtures();

  try {
    fs.writeFileSync(`${fixtures.primaryPath}-journal`, 'fixture-sidecar');
    assert.throws(
      () => snapshotSqlite(fixtures.primaryPath.toUpperCase()),
      /^Error: SQLite source has active sidecar$/,
    );
  } finally {
    fixtures.cleanup();
  }
});

test('rejects uppercase and mixed-case Windows WAL, SHM, and journal sidecars before readonly open', t => {
  if (process.platform !== 'win32') {
    t.skip('case-insensitive sidecar fixture is Windows-specific');
    return;
  }

  for (const suffix of ['-WAL', '-sHm', '-JoUrNaL']) {
    const fixtures = createSQLiteFixtures();
    const mainBefore = hashFile(fixtures.primaryPath);
    let afterReadReached = false;
    try {
      fs.writeFileSync(`${fixtures.primaryPath}${suffix}`, 'fixture-sidecar');
      assert.throws(
        () => snapshotSqlite(fixtures.primaryPath, {
          afterRead() { afterReadReached = true; },
        }),
        /^Error: SQLite source has active sidecar$/,
      );
      assert.equal(afterReadReached, false);
      assert.equal(hashFile(fixtures.primaryPath), mainBefore);
    } finally {
      fixtures.cleanup();
    }
  }
});

test('rejects a mixed-case Windows super-journal before inventory open or hook', t => {
  if (process.platform !== 'win32') {
    t.skip('case-insensitive sidecar fixture is Windows-specific');
    return;
  }
  const fixtures = createSQLiteFixtures();
  const mainBefore = hashFile(fixtures.primaryPath);
  let afterReadReached = false;

  try {
    fs.writeFileSync(`${fixtures.primaryPath}-mJaBcDeF912`, 'fixture-sidecar');
    assert.throws(
      () => inventorySqlite(fixtures.primaryPath, {
        afterRead() { afterReadReached = true; },
      }),
      /^Error: SQLite source has active sidecar$/,
    );
    assert.equal(afterReadReached, false);
    assert.equal(hashFile(fixtures.primaryPath), mainBefore);
  } finally {
    fixtures.cleanup();
  }
});
