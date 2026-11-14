import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAccessPurpose,
  parseGrantReason,
  parseRoleGrantInput,
  parseSpecialGrantInput,
} from '../../app/domain/authorization/authorization-validation';

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

test('normalizes grant reasons and access purposes at exact limits', () => {
  assert.equal(parseGrantReason(`  ${'r'.repeat(10)}  `), 'r'.repeat(10));
  assert.equal(parseGrantReason('r'.repeat(500)), 'r'.repeat(500));
  assert.equal(parseAccessPurpose(`  ${'p'.repeat(10)}  `), 'p'.repeat(10));
  assert.equal(parseAccessPurpose('p'.repeat(200)), 'p'.repeat(200));
  assert.throws(() => parseGrantReason('r'.repeat(9)), hasCode('AUTHORIZATION_INPUT_INVALID'));
  assert.throws(() => parseGrantReason('r'.repeat(501)), hasCode('AUTHORIZATION_INPUT_INVALID'));
  assert.throws(() => parseAccessPurpose('short'), hasCode('ACCESS_PURPOSE_REQUIRED'));
  assert.throws(() => parseAccessPurpose('p'.repeat(201)), hasCode('ACCESS_PURPOSE_REQUIRED'));
});

test('parses permanent and temporary role grants with a 90-day maximum', () => {
  const validFrom = '2026-07-19T00:00:00.000Z';
  const validUntil = '2026-10-17T00:00:00.000Z';

  assert.deepEqual(parseRoleGrantInput({ source: 'PERMANENT', validFrom }), {
    source: 'PERMANENT',
    validFrom: new Date(validFrom),
    validUntil: null,
    reason: null,
  });
  assert.deepEqual(parseRoleGrantInput({ source: 'TEMPORARY', validFrom, validUntil, reason: '项目临时授权期限说明' }), {
    source: 'TEMPORARY',
    validFrom: new Date(validFrom),
    validUntil: new Date(validUntil),
    reason: '项目临时授权期限说明',
  });
  assert.throws(
    () => parseRoleGrantInput({ source: 'TEMPORARY', validFrom, validUntil: '2026-10-17T00:00:00.001Z', reason: '项目临时授权期限说明' }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
  assert.throws(
    () => parseRoleGrantInput({ source: 'PERMANENT', validFrom, validUntil, unexpected: true }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
});

test('parses special grants with strict keys and a 30-day maximum', () => {
  const valid = parseSpecialGrantInput({
    permissionCode: 'employee.high_sensitive.read',
    dataScopeId: 'scope-1',
    validFrom: '2026-07-19T00:00:00.000Z',
    validUntil: '2026-08-18T00:00:00.000Z',
    reason: '核验员工执业身份信息',
  });
  assert.equal(valid.permissionCode, 'employee.high_sensitive.read');
  assert.equal(valid.dataScopeId, 'scope-1');
  assert.throws(
    () => parseSpecialGrantInput({
      permissionCode: 'employee.high_sensitive.read',
      dataScopeId: 'scope-1',
      validFrom: '2026-07-19T00:00:00.000Z',
      validUntil: '2026-08-18T00:00:00.001Z',
      reason: '核验员工执业身份信息',
    }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
  assert.throws(
    () => parseSpecialGrantInput({
      permissionCode: 'organization.read',
      dataScopeId: 'scope-1',
      validFrom: '2026-07-19T00:00:00.000Z',
      validUntil: '2026-07-20T00:00:00.000Z',
      reason: '不能直接授予普通动作权限',
    }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
});
