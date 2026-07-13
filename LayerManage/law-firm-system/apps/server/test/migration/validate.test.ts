import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMigration, type ValidationQueryable } from '../../scripts/migration/validate';
import { TABLE_ORDER, type TableName } from '../../scripts/migration/table-plan';
import type { SnapshotRecord, SourceSnapshot, TableSnapshot } from '../../scripts/migration/types';

const TIMESTAMP = '2026-04-01 08:00:00';

function snapshot(recordsByTable: Partial<Record<TableName, SnapshotRecord[]>> = {}): SourceSnapshot {
  const tables = TABLE_ORDER.reduce<Record<TableName, TableSnapshot>>((result, table) => {
    const records = recordsByTable[table] ?? [];
    result[table] = { columns: [...new Set(records.flatMap(record => Object.keys(record)))].sort(), rowCount: records.length, records };
    return result;
  }, {} as Record<TableName, TableSnapshot>);

  return {
    generatedAt: '2026-04-01T00:00:00.000Z',
    runId: 'validate-fixture',
    source: { path: 'fixture.sqlite', sha256: 'fixture-sha256' },
    tables,
  };
}

function fixtureSnapshot(): SourceSnapshot {
  return snapshot({
    Organization: [{ id: 'org-1', name: 'Fixture firm', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    Position: [{ id: 'position-1', orgId: 'org-1', name: 'Lawyer', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    Employee: [{ id: 'employee-1', employeeNo: 'E-001', orgId: 'org-1', positionId: 'position-1', entryDate: TIMESTAMP, createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    User: [{ id: 'user-1', username: 'fixture-user', password: '$2b$10$fixturePasswordHashLiteral', employeeId: 'employee-1', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    Channel: [{ id: 'channel-1', name: 'Referral', cost: '12.50', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    Lead: [{ id: 'lead-1', name: 'Fixture lead', channelId: 'channel-1', assignedTo: 'employee-1', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    Customer: [{ id: 'customer-1', name: 'Fixture customer', leadId: 'lead-1', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    Contract: [{ id: 'contract-1', contractNo: 'C-001', customerId: 'customer-1', amount: '100.10', paidAmount: '20.20', signDate: TIMESTAMP, createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    Payment: [{ id: 'payment-1', contractId: 'contract-1', customerId: 'customer-1', amount: '50.05', receivedAmount: '30.03', dueDate: TIMESTAMP, createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    Case: [{ id: 'case-1', caseNo: 'CASE-001', customerId: 'customer-1', contractId: 'contract-1', lawyerId: 'employee-1', fee: '200.00', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    CaseTask: [{ id: 'task-1', caseId: 'case-1', name: 'Fixture task', createdAt: TIMESTAMP, updatedAt: TIMESTAMP }],
    Communication: [{ id: 'communication-1', caseId: 'case-1', content: 'private communication free text', createdAt: TIMESTAMP }],
  });
}

interface TargetOptions {
  amountTotal?: string;
  duplicateBusinessKey?: boolean;
  orphanForeignKey?: boolean;
  password?: string;
  removeId?: string;
  shiftedTimestamp?: boolean;
}

function targetFor(source: SourceSnapshot, options: TargetOptions = {}): ValidationQueryable {
  return {
    async query(text: string, values?: readonly unknown[]) {
      const [, kind, table, field] = /\/\* validation:([^:]+):([^:]+)(?::([^*]+))? \*\//.exec(text) ?? [];
      const records = source.tables[table as TableName]?.records ?? [];

      if (kind === 'ids') {
        return { rows: records.filter(record => record.id !== options.removeId).map(record => ({ id: record.id })) };
      }
      if (kind === 'foreign-key') return { rows: options.orphanForeignKey ? [{ id: 'orphan-id' }] : [] };
      if (kind === 'business-key') return { rows: options.duplicateBusinessKey ? [{ duplicateCount: 2 }] : [] };
      if (kind === 'decimal-total') {
        const total = options.amountTotal ?? records.reduce((sum, record) => sum + Number(record[field] ?? 0), 0).toFixed(2);
        return { rows: [{ total }] };
      }
      if (kind === 'timestamp') {
        const requestedIds = values?.[0] as string[];
        return {
          rows: records
            .filter(record => requestedIds.includes(String(record.id)))
            .map(record => ({
              id: record.id,
              value: options.shiftedTimestamp && table === 'Organization' && field === 'createdAt'
                ? '2026-04-01T01:00:00.000Z'
                : record[field],
            })),
        };
      }
      if (kind === 'password') {
        return { rows: records.map(record => ({ id: record.id, password: options.password ?? record.password })) };
      }
      throw new Error(`Unexpected validation query: ${text}`);
    },
  };
}

function check(report: Awaited<ReturnType<typeof validateMigration>>, name: string): { status: string; expected: unknown; actual: unknown } {
  const result = report.checks.find(candidate => candidate.check === name);
  assert.ok(result, `missing check ${name}`);
  return result;
}

test('validates an imported fixture across all tables without serializing source payloads', async () => {
  const source = fixtureSnapshot();
  const report = await validateMigration(targetFor(source), source);
  const serialized = JSON.stringify(report);

  assert.equal(report.ok, true);
  assert.equal(report.checks.filter(result => result.check === 'row-count').length, TABLE_ORDER.length);
  assert.equal(report.checks.filter(result => result.check === 'primary-ids').length, TABLE_ORDER.length);
  assert.equal(check(report, 'password-hash').status, 'PASS');
  assert.equal(serialized.includes('$2b$10$fixturePasswordHashLiteral'), false);
  assert.equal(serialized.includes('private communication free text'), false);
});

test('reports a row count and primary ID mismatch', async () => {
  const source = fixtureSnapshot();
  const report = await validateMigration(targetFor(source, { removeId: 'org-1' }), source);

  assert.equal(check(report, 'row-count').status, 'FAIL');
  assert.equal(report.ok, false);
  assert.equal(report.checks.some(result => result.check === 'primary-ids' && result.status === 'FAIL'), true);
});

test('reports orphaned required foreign keys', async () => {
  const source = fixtureSnapshot();
  const report = await validateMigration(targetFor(source, { orphanForeignKey: true }), source);

  assert.equal(report.checks.some(result => result.check === 'foreign-key' && result.status === 'FAIL'), true);
});

test('reports duplicate configured business keys', async () => {
  const source = fixtureSnapshot();
  const report = await validateMigration(targetFor(source, { duplicateBusinessKey: true }), source);

  assert.equal(report.checks.some(result => result.check === 'business-key' && result.status === 'FAIL'), true);
});

test('reports decimal total mismatches without exposing source amounts', async () => {
  const source = fixtureSnapshot();
  const report = await validateMigration(targetFor(source, { amountTotal: '999.99' }), source);
  const result = report.checks.find(candidate => candidate.check === 'decimal-total' && candidate.table === 'Contract');

  assert.equal(result?.status, 'FAIL');
  assert.equal(JSON.stringify(report).includes('100.10'), false);
});

test('reports shifted normalized timestamps', async () => {
  const source = fixtureSnapshot();
  const report = await validateMigration(targetFor(source, { shiftedTimestamp: true }), source);

  assert.equal(report.checks.some(result => result.check === 'timestamp-sample' && result.status === 'FAIL'), true);
});

test('reports changed password hashes without exposing either hash', async () => {
  const source = fixtureSnapshot();
  const report = await validateMigration(targetFor(source, { password: '$2b$10$changedPasswordHashLiteral' }), source);
  const serialized = JSON.stringify(report);

  assert.equal(check(report, 'password-hash').status, 'FAIL');
  assert.equal(serialized.includes('$2b$10$fixturePasswordHashLiteral'), false);
  assert.equal(serialized.includes('$2b$10$changedPasswordHashLiteral'), false);
});
