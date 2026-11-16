import test from 'node:test';
import assert from 'node:assert/strict';
import { administratorOnlyOperation, highRiskOperation } from '../../app/application/auth/high-risk-operation';
import { requiresGovernanceStepUp } from '../../app/application/admin-governance/governance-step-up';
import { GOVERNED_OPERATION_CATALOG } from '../../app/domain/admin-governance/operation-catalog';

test('permission and personnel exemptions retain the independent administrator classification', () => {
  const routes: Array<[string, string, Record<string, unknown>?]> = [
    ['POST', '/api/v1/roles'], ['PUT', '/api/v1/roles/r1'], ['DELETE', '/api/v1/roles/r1'],
    ...['permissions', 'data-scopes', 'field-permissions', 'worksheets', 'applications', 'disable', 'enable', 'apply']
      .map(action => ['POST', `/api/v1/roles/r1/${action}`] as [string, string]),
    ['POST', '/api/v1/worksheet-permissions/w1'],
    ['POST', '/api/v1/users/u1/role-grants'], ['POST', '/api/v1/users/u1/role-grants/g1/revoke'],
    ['POST', '/api/v1/users/u1/roles'], ['POST', '/api/v1/users/u1/special-grants'],
    ['POST', '/api/v1/users/u1/special-grants/g1/revoke'],
    ['PUT', '/api/v1/employees/e1/account-binding'],
    ['PATCH', '/api/v1/organizations/o1', { managerEmployeeId: 'e1' }],
    ['POST', '/api/v1/users/u1/password-reset'],
  ];
  for (const [method, path, body] of routes) {
    for (const alias of [path, path.toUpperCase() + '/']) {
      assert.equal(highRiskOperation(method, alias, body), null, alias);
      assert.ok(administratorOnlyOperation(method, alias, body), alias);
    }
  }
});

test('all existing governed actions retain catalog risk/review while exempt; future high-risk actions default to verification', () => {
  for (const [operationType, entry] of Object.entries(GOVERNED_OPERATION_CATALOG)) {
    assert.equal(requiresGovernanceStepUp(entry.riskLevel, operationType), false, operationType);
    if (entry.riskLevel === 'HIGH' || entry.riskLevel === 'CRITICAL') assert.equal(entry.reviewMode, 'PRE');
    if (entry.riskLevel === 'CRITICAL') assert.ok(entry.confirmationTemplate);
  }
  assert.equal(requiresGovernanceStepUp('HIGH', 'FUTURE_OPERATION'), true);
  assert.equal(requiresGovernanceStepUp('CRITICAL', 'FUTURE_OPERATION'), true);
});

test('permanent destruction and route aliases remain protected', () => {
  for (const [method, path, body] of [
    ['DELETE', '/api/v1/files/f1', {}], ['DELETE', '/api/v1/approval-files/f1', {}],
    ['PATCH', '/api/v1/tables/t1', { remove: true }],
    ['PUT', '/api/v1/cases/c1', { removeAttachmentIds: ['f1'] }],
  ] as const) {
    assert.ok(highRiskOperation(method, path, body));
    assert.ok(highRiskOperation(method, path.toUpperCase() + '/', body));
  }
});
