import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRow } from '../../scripts/migration/normalize';

test('normalizes money and interprets legacy SQLite timestamps as Asia/Shanghai before converting to UTC', () => {
  assert.equal(normalizeRow('Contract', { amount: 30000 }).amount, '30000.00');
  assert.equal(normalizeRow('Payment', { receivedAmount: 0.1 + 0.2 }).receivedAmount, '0.30');
  assert.equal(
    normalizeRow('Contract', { signDate: '2026-04-01 08:00:00' }).signDate,
    '2026-04-01T00:00:00.000Z',
  );
});

test('validates and canonicalizes only the four JSON-like string fields', () => {
  assert.equal(normalizeRow('Lead', { tags: '["\u91cd\u70b9"]' }).tags, '["\u91cd\u70b9"]');
  assert.equal(normalizeRow('Customer', { tags: '["VIP"]' }).tags, '["VIP"]');
  assert.equal(normalizeRow('Contract', { paymentTerms: '{"term":"net-30"}' }).paymentTerms, '{"term":"net-30"}');
  assert.equal(normalizeRow('Case', { teamIds: '["employee-1"]' }).teamIds, '["employee-1"]');
  assert.throws(() => normalizeRow('Lead', { tags: '[invalid' }), /invalid JSON/);
});

test('rejects table and column identifiers outside the schema-derived allowlist', () => {
  assert.throws(() => normalizeRow('NotATable' as never, { id: 'id-1' }), /Unsupported table/);
  assert.throws(
    () => normalizeRow('Organization', { 'name"; DROP TABLE organization; --': 'unsafe' }),
    /Unsupported column/,
  );
});
