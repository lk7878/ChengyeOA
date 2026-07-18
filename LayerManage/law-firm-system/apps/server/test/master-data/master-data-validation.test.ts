import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeEmployeeNo,
  normalizeName,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeStableCode,
  normalizeStringArray,
  normalizeVersion,
  parseIsoDate,
} from '../../app/domain/master-data/master-data-validation';
import { hasCode } from './test-helpers';

test('normalizes stable codes and employee numbers', () => {
  assert.equal(normalizeStableCode(' branch_01 '), 'BRANCH_01');
  assert.equal(normalizeEmployeeNo(' emp-001 '), 'EMP-001');
  assert.throws(() => normalizeStableCode('1-branch'), hasCode('VALIDATION_FAILED'));
  assert.throws(() => normalizeEmployeeNo('employee number with spaces'), hasCode('VALIDATION_FAILED'));
});

test('normalizes names and bounded optional text', () => {
  assert.equal(normalizeName('  Chengye Branch  '), 'Chengye Branch');
  assert.equal(normalizeOptionalText('  short note  ', 20), 'short note');
  assert.equal(normalizeOptionalText('   ', 20), null);
  assert.throws(() => normalizeName('x'), hasCode('VALIDATION_FAILED'));
  assert.throws(() => normalizeOptionalText('too long', 3), hasCode('VALIDATION_FAILED'));
});

test('parses strict dates, non-negative integers, and optimistic versions', () => {
  assert.equal(parseIsoDate('2026-07-18').toISOString(), '2026-07-18T00:00:00.000Z');
  assert.equal(parseIsoDate('2026-07-18T01:02:03.000Z').toISOString(), '2026-07-18T01:02:03.000Z');
  assert.equal(normalizeNonNegativeInteger(0), 0);
  assert.equal(normalizeVersion(2), 2);
  assert.throws(() => parseIsoDate('18/07/2026'), hasCode('VALIDATION_FAILED'));
  assert.throws(() => normalizeNonNegativeInteger(-1), hasCode('VALIDATION_FAILED'));
  assert.throws(() => normalizeVersion(0), hasCode('VALIDATION_FAILED'));
});

test('normalizes string arrays and allowed literal values', () => {
  assert.deepEqual(normalizeStringArray(['  Civil ', 'Criminal'], 3, 20), ['Civil', 'Criminal']);
  assert.equal(normalizeAllowedValue('BRANCH', ['FIRM', 'BRANCH'] as const), 'BRANCH');
  assert.throws(() => normalizeStringArray(['Civil', 'Civil'], 3, 20), hasCode('VALIDATION_FAILED'));
  assert.throws(() => normalizeAllowedValue('OTHER', ['FIRM', 'BRANCH'] as const), hasCode('VALIDATION_FAILED'));
});

test('rejects unknown DTO keys and non-record bodies', () => {
  assert.doesNotThrow(() => assertExactKeys({ code: 'BRANCH_01', name: 'Branch' }, ['code', 'name']));
  assert.throws(() => assertExactKeys({ code: 'BRANCH_01', injected: true }, ['code']), hasCode('VALIDATION_FAILED'));
  assert.throws(() => assertExactKeys(null, ['code']), hasCode('VALIDATION_FAILED'));
});
