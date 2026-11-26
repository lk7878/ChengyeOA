import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentContractChoices } from '../../app/application/contract/payment-contract-choices';
import { ReceivableService } from '../../app/application/contract/receivable-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

test('receipt candidates search real relations, intersect permissions and share save rules', async () => {
  const db = createTestPrisma();
  try {
    await clearTestApplicationData(db);
    const user = await db.user.create({ data: { username: 'payment-picker', password: 'unused' } });
    const codes: PermissionCode[] = ['contract.read', 'payment.create', 'case.read'];
    const actor: AuthorizationContext = { userId: user.id, employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: false,
      permissionCodes: codes, evaluatedAt: new Date(), fieldRules: [], grants: codes.map(code => ({ sourceType: 'ROLE', sourceId: 'test', permissionCode: code, resource: code.split('.')[0], scopeIds: ['ALL'], validUntil: null })) };
    const customer = await db.customer.create({ data: { customerNo: 'CU-PICK', name: '准确客户', phone: '0', phoneHash: '0', createdBy: user.id } });
    const org = await db.organization.create({ data: { id: '4c494d86-b8ae-4df2-ac95-0f14f6f8ceaa', name: '其他组织', code: 'PICK', type: 'DEPARTMENT', path: '/4c494d86-b8ae-4df2-ac95-0f14f6f8ceaa' } });
    const contracts = [];
    for (let i = 0; i < 23; i++) contracts.push(await db.contract.create({ data: { contractType: 'FORMAL', contractNo: `REAL-${String(i).padStart(2, '0')}`, title: `历史编号-${i}`, customerId: customer.id, createdBy: user.id, amount: '100.01', status: i === 22 ? 'PENDING_SIGN' : 'EFFECTIVE', branchId: org.id } }));
    await db.case.create({ data: { caseNo: 'CASE-EXACT', title: '关联案由', caseType: '民事', customerId: customer.id, contractId: contracts[0].id, createdBy: user.id } });
    const query = (keyword = '', page = 1, ctx = actor, id?: string) => paymentContractChoices(db, ctx, { keyword, page, id });
    assert.equal((await query()).total, 22);
    assert.equal((await query('', 2)).list.length, 2);
    assert.equal((await query('准确客户')).total, 22);
    const match = (await query('CASE-EXACT')).list[0];
    assert.equal(match.id, contracts[0].id);
    assert.equal(match.label, 'REAL-00｜准确客户｜CASE-EXACT · 关联案由');
    assert.equal(match.amount, '100.01');
    assert.equal(match.organizationName, '其他组织');
    assert.equal((await query('关联案由')).total, 1);
    assert.equal((await query('历史编号-0')).list[0].id, contracts[0].id);
    assert.equal((await query('', 1, actor, contracts[22].id)).total, 0);
    const noCase = { ...actor, permissionCodes: codes.filter(c => c !== 'case.read'), grants: actor.grants.filter(g => g.permissionCode !== 'case.read') };
    assert.equal((await query('CASE-EXACT', 1, noCase)).total, 0);
    assert.equal((await query('REAL-00', 1, noCase)).list[0].caseNo, undefined);
    const single = { ...actor, grants: actor.grants.map(g => g.permissionCode === 'contract.read' ? { ...g, sourceType: 'CONTRACT_READ_GRANT' as const, sourceId: contracts[0].id, scopeIds: [] } : g) };
    assert.equal((await query('', 1, single)).total, 1);
    const denied = { ...actor, grants: actor.grants.map(g => g.permissionCode === 'payment.create' ? { ...g, scopeIds: [] } : g) };
    assert.equal((await query('', 1, denied)).total, 0);
    const service = (ctx: AuthorizationContext) => new ReceivableService(db, { actorUserId: user.id }, ctx);
    await assert.rejects(service(denied).createPayment({ contractId: contracts[0].id, amount: '1', paidAt: '2026-11-26T00:00:00.000Z' }), { code: 'CONTRACT_NOT_FOUND' });
    await assert.rejects(service(single).createPayment({ contractId: contracts[1].id, amount: '1', paidAt: '2026-11-26T00:00:00.000Z' }), { code: 'CONTRACT_NOT_FOUND' });
    await assert.rejects(service(actor).createPayment({ contractId: contracts[22].id, amount: '1', paidAt: '2026-11-26T00:00:00.000Z' }), { code: 'CONTRACT_STATE_TRANSITION_INVALID' });
    const saved = await service(single).createPayment({ contractId: contracts[0].id, amount: '1', paidAt: '2026-11-26T00:00:00.000Z' });
    assert.equal(saved.contractId, contracts[0].id);
    await db.contract.update({ where: { id: contracts[0].id }, data: { status: 'TERMINATED' } });
    assert.equal((await query('', 1, single)).total, 0);
    await assert.rejects(service(single).createPayment({ contractId: contracts[0].id, amount: '1', paidAt: '2026-11-26T00:00:00.000Z' }), { code: 'CONTRACT_STATE_TRANSITION_INVALID' });
    assert.equal((await db.contract.findUniqueOrThrow({ where: { id: contracts[0].id } })).title, '历史编号-0');
  } finally { await clearTestApplicationData(db); await db.$disconnect(); }
});
