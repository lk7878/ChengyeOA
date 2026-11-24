import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { CaseIntakeCustomerService, caseCustomerContext } from '../../app/application/case/intake-customers';
import { CustomerService } from '../../app/application/crm/customer-service';
import { CaseService } from '../../app/application/case/case-service';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { defaultRule } from '../../app/application/collaboration/worksheet-roles';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import middleware from '../../app/middleware/worksheetAuthorization';

const db = createTestPrisma();
let lawyer: AuthorizationContext, other: AuthorizationContext;
const service = (actor: AuthorizationContext) => new CaseIntakeCustomerService(db, { actorUserId: actor.userId }, actor);
async function person(): Promise<AuthorizationContext> {
  const employee = await db.employee.create({ data: { employeeNo: key(), name: '合成律师', phone: '0', type: 'LAWYER', entryDate: new Date() } });
  const user = await db.user.create({ data: { username: key(), password: 'unused', employeeId: employee.id } });
  return { userId: user.id, employeeId: employee.id, isSystemAdmin: false, isSystemSuperAdmin: false,
    evaluatedAt: new Date(), fieldRules: [], permissionCodes: ['case.create'], grants: [{ sourceType: 'ROLE', sourceId: 'fixture',
      permissionCode: 'case.create', resource: 'case', scopeIds: ['worksheet:self'], validUntil: null }] };
}
test.beforeEach(async () => { await clearTestApplicationData(db); lawyer = await person(); other = await person(); });
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });

test('case-only lawyer creates canonical own customer, reuses same name+phone, preserves privacy and can create case', async () => {
  const input = { name: '合成客户', phone: '13800000001', address: '合成地址' };
  const [one, again] = await Promise.all([service(lawyer).create(input), service(lawyer).create(input)]);
  assert.equal(one.customer.id, again.customer.id);
  assert.equal(Number(one.reused) + Number(again.reused), 1);
  assert.equal(await db.customer.count(), 1);
  const stored = await db.customer.findUniqueOrThrow({ where: { id: one.customer.id } });
  assert.equal(stored.createdBy, lawyer.userId);
  assert.equal(stored.tags, '["律师案件登记"]');
  assert.equal((await service(lawyer).search({ keyword: '合成客户' })).total, 1);
  assert.equal((await service(other).search({ keyword: '合成客户' })).total, 0);
  const hiddenDuplicate = await service(other).create(input);
  assert.equal(hiddenDuplicate.reused, false);
  assert.notEqual(hiddenDuplicate.customer.id, one.customer.id);
  const differentPhone = await service(lawyer).create({ ...input, phone: '13800000002' });
  assert.notEqual(differentPhone.customer.id, one.customer.id);
  assert.equal((await service(lawyer).search({})).total, 2);
  await assert.rejects(new CustomerService(db, { actorUserId: lawyer.userId }, lawyer).listCustomers({}));
  await assert.rejects(new CustomerService(db, { actorUserId: lawyer.userId }, lawyer).createCustomer(input));
  const cases = new CaseService(db, { actorUserId: lawyer.userId }, caseCustomerContext(lawyer));
  const risk = await cases.screenConflict({ customerId: one.customer.id });
  assert.ok(risk);
  const row = await cases.createCase({ customerId: one.customer.id, lawyerId: lawyer.employeeId!, caseType: '民事' });
  assert.equal(row.customerId, one.customer.id);
  await assert.rejects(cases.createCase({ customerId: hiddenDuplicate.customer.id, lawyerId: lawyer.employeeId!, caseType: '民事' }));
  assert.equal(await db.operationLog.count({ where: { action: 'CASE_INTAKE_CUSTOMER_CREATE' } }), 3);
  await assert.rejects(service(lawyer).create({ ...input, createdBy: other.userId } as never));
  assert.throws(() => service({ ...lawyer, permissionCodes: [] }));
  assert.throws(() => service({ ...lawyer, employeeId: null }));
});

test('worksheet role editor can use intake without direct sharing; reader or revoked editor cannot', async () => {
  const admin: AuthorizationContext = { ...other, isSystemSuperAdmin: true, permissionCodes: PERMISSION_CATALOG.map(p => p.code), grants: PERMISSION_CATALOG.map(p => ({ sourceType: 'SYSTEM_SUPER_ADMIN', sourceId: 'test', permissionCode: p.code, resource: p.resource, scopeIds: ['ALL'], validUntil: null })) };
  const orgId = key();
  const org = await db.organization.create({ data: { id: orgId, code: key(), name: '合成组织', type: 'FIRM', path: '/' + orgId } });
  const owner = new CollaborationService(db, admin);
  const workspace = await owner.createWorkspace({ name: '合成工作区', organizationId: org.id }, key());
  const base = await owner.createBase(workspace.id, { name: '合成案件' }, key());
  const table = await owner.createTable(base.id, { name: '合成案件表', source: 'CASES' }, key());
  const role = (await db.role.create({ data: { code: key(), name: '合成角色', type: 'BUSINESS' } })).id;
  await db.userRole.create({ data: { userId: lawyer.userId, roleId: role, validFrom: new Date(0) } });
  const raw = { ...lawyer, permissionCodes: [] as AuthorizationContext['permissionCodes'], grants: [], activeRoleIds: [role] };
  const rule = { ...defaultRule('EDITOR'), rows: 'ALL', business: { permissions: ['case.read', 'case.create', 'case.update'], scopeIds: ['worksheet:self'] } };
  await db.worksheetRolePolicy.create({ data: { tableId: table.id, rules: { [role]: rule } } });
  const ctx = () => ({ method: 'POST', path: '/api/v1/cases/intake-customers', prisma: db, state: { authorization: raw }, request: { body: { worksheetId: table.id } } });
  const allowed = ctx();
  await middleware()(allowed as never, async () => undefined);
  const created = await service(allowed.state.authorization).create({ name: '角色授权客户', phone: '13800000003', worksheetId: table.id });
  assert.equal(created.customer.createdBy, lawyer.userId);
  const global = { ...ctx(), path: '/api/v1/customers' };
  await middleware()(global as never, async () => undefined);
  assert.equal(global.state.authorization.permissionCodes.includes('customer.create'), false);
  await db.worksheetRolePolicy.update({ where: { tableId: table.id }, data: { rules: { [role]: { ...defaultRule('READER'), business: { permissions: ['case.read'], scopeIds: ['worksheet:self'] } } } } });
  await assert.rejects(middleware()(ctx() as never, async () => undefined));
});
