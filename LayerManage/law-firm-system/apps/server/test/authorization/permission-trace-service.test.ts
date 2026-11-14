import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PermissionTraceService } from '../../app/application/authorization/permission-trace-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;
test.before(() => { prisma = createTestPrisma(); });
test.beforeEach(async () => { await clearTestApplicationData(prisma); });
test.after(async () => { await clearTestApplicationData(prisma); await prisma.$disconnect(); });

test('explains active sources scopes fields and stable denial without leaking predicates', async () => {
  const user = await prisma.user.create({ data: { username: 'trace.user', password: 'unused' } });
  const role = await prisma.role.create({ data: {
    name: 'Trace Role', code: 'TRACE_ROLE', type: 'BUSINESS',
    permissions: { create: { permission: { connect: { code: 'employee.read' } } } },
    fieldPermissions: { create: { resource: 'employee', fieldCode: 'employee.phone', readLevel: 'MASKED' } },
  } });
  const scope = await prisma.dataScope.create({ data: { name: 'All employees', scopeType: 'ALL' } });
  await prisma.roleDataScope.create({ data: { roleId: role.id, resource: 'employee', dataScopeId: scope.id } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const requester = context(user.id, ['permission.trace.self']);
  const trace = await new PermissionTraceService(prisma).trace(requester, user.id, 'employee.read');
  assert.equal(trace.permissionCode, 'employee.read');
  assert.equal(trace.allowed, true);
  assert.equal(trace.sources[0].sourceType, 'ROLE');
  assert.deepEqual(trace.sources[0].scopeTypes, ['ALL']);
  assert.equal(trace.fieldCapabilities[0].fieldCode, 'employee.phone');
  assert.doesNotMatch(JSON.stringify(trace), /SELECT|where|Prisma|phoneValue/i);

  const denied = await new PermissionTraceService(prisma).trace(requester, user.id, 'employee.update');
  assert.equal(denied.allowed, false);
  assert.equal(denied.refusalCode, 'PERMISSION_DENIED');
  const other = await prisma.user.create({ data: { username: 'trace.other', password: 'unused' } });
  await assert.rejects(() => new PermissionTraceService(prisma).trace(requester, other.id), hasCode('PERMISSION_DENIED'));
  await assert.doesNotReject(() => new PermissionTraceService(prisma).trace(context(user.id, ['permission.trace.any']), other.id));
});

function context(userId: string, permissionCodes: AuthorizationContext['permissionCodes']): AuthorizationContext {
  return { userId, employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: false, grants: [], fieldRules: [], permissionCodes, evaluatedAt: new Date() };
}
function hasCode(code: string) { return (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code); }
