import assert from 'node:assert/strict';
import test from 'node:test';
import { FieldProjectionService } from '../../app/application/authorization/field-projection-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';

function context(input: {
  superAdmin?: boolean;
  contributingRoleIds?: string[];
  fieldRules?: AuthorizationContext['fieldRules'];
} = {}): AuthorizationContext {
  const roleIds = input.contributingRoleIds ?? ['role-a'];
  return {
    userId: 'user-1',
    employeeId: 'employee-1',
    isSystemAdmin: false,
    isSystemSuperAdmin: input.superAdmin ?? false,
    grants: roleIds.map(roleId => ({
      sourceType: 'ROLE' as const,
      sourceId: `user-role-${roleId}`,
      sourceRoleId: roleId,
      permissionCode: 'employee.read' as const,
      resource: 'employee',
      scopeIds: ['ALL'],
      validUntil: null as Date | null,
    })),
    fieldRules: input.fieldRules ?? [],
    permissionCodes: ['employee.read'],
    evaluatedAt: new Date('2026-07-18T12:00:00.000Z'),
  };
}

const employee = {
  id: 'employee-1',
  employeeNo: 'EMP-001',
  name: 'Alice',
  phone: '13800000000',
  email: 'alice@example.com',
  licenseNo: 'LICENSE-1234',
  professionalDirections: ['Civil'],
  idCard: '500000199001010000',
};

test('reads L2 masks L3 omits L4 and removes forbidden fields by default', async () => {
  const service = new FieldProjectionService();
  const audits: unknown[] = [];
  const [projected] = await service.projectRecords({
    context: context(),
    resource: 'employee',
    permissionCode: 'employee.read',
    records: [employee],
    purpose: 'EMPLOYEE_DETAIL',
  }, async summary => { audits.push(summary); });

  assert.equal(projected.id, employee.id);
  assert.equal(projected.name, employee.name);
  assert.equal(projected.phone, '138****0000');
  assert.equal(projected.email, 'a***@example.com');
  assert.equal('idCard' in projected, false);
  assert.deepEqual(audits, []);

  const [user] = await service.projectRecords({
    context: { ...context(), grants: [{ ...context().grants[0], resource: 'user', permissionCode: 'user.read' }], permissionCodes: ['user.read'] },
    resource: 'user',
    permissionCode: 'user.read',
    records: [{ id: 'user-1', username: 'alice', password: 'hash', credentialVersion: 4 }],
    purpose: 'USER_DETAIL',
  }, async summary => { audits.push(summary); });
  assert.equal(user.username, 'alice');
  assert.equal('password' in user, false);
  assert.equal('credentialVersion' in user, false);
});

test('uses only contributing roles and makes NONE a hard gate', async () => {
  const service = new FieldProjectionService();
  const fieldRules: AuthorizationContext['fieldRules'] = [
    { sourceRoleId: 'role-a', resource: 'employee', fieldCode: 'employee.phone', readLevel: 'READ', canWrite: true, canExport: false },
    { sourceRoleId: 'irrelevant-role', resource: 'employee', fieldCode: 'employee.phone', readLevel: 'NONE', canWrite: false, canExport: false },
  ];
  const audits: unknown[] = [];
  const [allowed] = await service.projectRecords({
    context: context({ fieldRules }),
    resource: 'employee',
    permissionCode: 'employee.read',
    records: [employee],
    purpose: 'EMPLOYEE_DETAIL',
  }, async summary => { audits.push(summary); });
  assert.equal(allowed.phone, employee.phone);
  assert.equal(audits.length, 1);
  assert.equal(service.canWriteField(context({ fieldRules }), 'employee', 'employee.phone', 'employee.read'), true);
  assert.equal(service.canExportField(context({ fieldRules }), 'employee', 'employee.phone', 'employee.read'), false);

  const deniedContext = context({
    contributingRoleIds: ['role-a', 'role-b'],
    fieldRules: [...fieldRules, {
      sourceRoleId: 'role-b', resource: 'employee', fieldCode: 'employee.phone',
      readLevel: 'NONE', canWrite: true, canExport: true,
    }],
  });
  const [denied] = await service.projectRecords({
    context: deniedContext,
    resource: 'employee',
    permissionCode: 'employee.read',
    records: [employee],
    purpose: 'EMPLOYEE_DETAIL',
  }, async summary => { audits.push(summary); });
  assert.equal('phone' in denied, false);
  assert.equal(service.canWriteField(deniedContext, 'employee', 'employee.phone', 'employee.read'), false);
  assert.equal(service.canExportField(deniedContext, 'employee', 'employee.phone', 'employee.read'), false);
});

test('super-admin raw L3 projection is audited once while L4 remains omitted', async () => {
  const service = new FieldProjectionService();
  const audits: Array<{ fieldCodes: string[]; resultCount: number }> = [];
  const [projected] = await service.projectRecords({
    context: context({ superAdmin: true, contributingRoleIds: [] }),
    resource: 'employee',
    permissionCode: 'employee.read',
    records: [employee, { ...employee, id: 'employee-2' }],
    purpose: 'EMPLOYEE_LIST',
  }, async summary => { audits.push(summary); });

  assert.equal(projected.phone, employee.phone);
  assert.equal('idCard' in projected, false);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].fieldCodes.sort(), [
    'employee.email',
    'employee.licenseNo',
    'employee.phone',
    'employee.professionalDirections',
  ]);
  assert.equal(audits[0].resultCount, 2);
});
