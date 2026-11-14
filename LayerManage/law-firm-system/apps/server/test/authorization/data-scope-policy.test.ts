import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combineGrantRecordSets,
  validateScopeShape,
} from '../../app/domain/authorization/data-scope-policy';

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

test('accepts every supported scope shape and normalizes custom targets', () => {
  assert.equal(validateScopeShape({ scopeType: 'ALL' }).scopeType, 'ALL');
  assert.deepEqual(validateScopeShape({ scopeType: 'ORG', organizationId: 'org-1', includeDescendants: true }), {
    scopeType: 'ORG',
    includeDescendants: true,
    organizationId: 'org-1',
    professionalTeamId: null,
    targets: [],
  });
  assert.equal(validateScopeShape({ scopeType: 'BRANCH', organizationId: 'branch-1' }).scopeType, 'BRANCH');
  assert.equal(validateScopeShape({ scopeType: 'TEAM', professionalTeamId: 'team-1' }).scopeType, 'TEAM');
  assert.equal(validateScopeShape({ scopeType: 'SELF_AND_SUBORDINATES' }).scopeType, 'SELF_AND_SUBORDINATES');
  assert.equal(validateScopeShape({ scopeType: 'SELF' }).scopeType, 'SELF');
  assert.equal(validateScopeShape({ scopeType: 'HQ_SCOPE' }).scopeType, 'HQ_SCOPE');
  assert.deepEqual(validateScopeShape({
    scopeType: 'CUSTOM',
    targets: [{ employeeId: 'employee-1' }, { organizationId: 'org-1' }],
  }).targets, [{ employeeId: 'employee-1' }, { organizationId: 'org-1' }]);
});

test('rejects fixed targets on self scopes and malformed custom targets', () => {
  assert.throws(
    () => validateScopeShape({ scopeType: 'SELF', organizationId: 'org-1' }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
  assert.throws(
    () => validateScopeShape({ scopeType: 'CUSTOM', targets: [] }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
  assert.throws(
    () => validateScopeShape({ scopeType: 'CUSTOM', targets: [{ employeeId: 'e-1', organizationId: 'org-1' }] }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
  assert.throws(
    () => validateScopeShape({ scopeType: 'CUSTOM', targets: [{ employeeId: 'e-1' }, { employeeId: 'e-1' }] }),
    hasCode('AUTHORIZATION_INPUT_INVALID'),
  );
});

test('combines grant record sets by stable first-seen union', () => {
  assert.deepEqual(combineGrantRecordSets([['a', 'b'], ['b', 'c'], [], ['a', 'd']]), ['a', 'b', 'c', 'd']);
});
