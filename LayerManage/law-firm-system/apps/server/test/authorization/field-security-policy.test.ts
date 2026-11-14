import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIELD_CATALOG,
  fieldPolicy,
  maskField,
  resolveFieldCapability,
} from '../../app/domain/authorization/field-security-policy';

test('classifies every current sensitive and forbidden employee/user field', () => {
  assert.equal(fieldPolicy('employee', 'phone').classification, 'L3');
  assert.equal(fieldPolicy('employee', 'phone').defaultReadLevel, 'MASKED');
  assert.equal(fieldPolicy('employee', 'idCard').classification, 'L4');
  assert.equal(fieldPolicy('employee', 'idCard').defaultReadLevel, 'NONE');
  assert.equal(fieldPolicy('user', 'password').classification, 'FORBIDDEN');
  assert.equal(fieldPolicy('user', 'credentialVersion').classification, 'FORBIDDEN');
  assert.ok(FIELD_CATALOG.some(item => item.code === 'professional_team.categoryCode'));
});

test('uses deterministic masks without exposing short originals', () => {
  assert.equal(maskField('employee.phone', '13800001234'), '138****1234');
  assert.equal(maskField('employee.email', 'lawyer@example.com'), 'l***@example.com');
  assert.equal(maskField('employee.licenseNo', 'LICENSE123456'), 'LIC***3456');
  assert.equal(maskField('employee.phone', '123'), '***');
  assert.deepEqual(maskField('employee.professionalDirections', ['刑事', '民商事']), ['***', '***']);
  assert.equal(maskField('employee.idCard', '500000199001010000'), null);
});

test('defaults unknown identity/business fields to L3 and security internals to forbidden', () => {
  assert.equal(fieldPolicy('employee', 'unregisteredIdentity').classification, 'L3');
  assert.equal(fieldPolicy('customer', 'newFact').defaultReadLevel, 'MASKED');
  assert.equal(fieldPolicy('case', 'aiSummary').classification, 'L3');
  assert.equal(fieldPolicy('user', 'passwordHash').classification, 'FORBIDDEN');
  assert.equal(fieldPolicy('user', 'refreshToken').classification, 'FORBIDDEN');
});

test('keeps read write and export independent using the union of readable role grants', () => {
  assert.deepEqual(resolveFieldCapability('L3', []), { readLevel: 'MASKED', canWrite: false, canExport: false });
  assert.deepEqual(resolveFieldCapability('L3', [
    { readLevel: 'READ', canWrite: true, canExport: false },
    { readLevel: 'MASKED', canWrite: false, canExport: true },
  ]), { readLevel: 'READ', canWrite: true, canExport: true });
  assert.deepEqual(resolveFieldCapability('L2', [
    { readLevel: 'READ', canWrite: true, canExport: true },
    { readLevel: 'NONE', canWrite: true, canExport: true },
  ]), { readLevel: 'READ', canWrite: true, canExport: true });
  for (const classification of ['L2','FORBIDDEN'] as const)
    assert.deepEqual(resolveFieldCapability(classification,[{readLevel:'NONE',canWrite:true,canExport:true}]),{readLevel:'NONE',canWrite:false,canExport:false});
});
