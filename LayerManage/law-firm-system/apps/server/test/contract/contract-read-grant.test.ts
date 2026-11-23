import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { listContractReadGrants, manageContractReadGrant } from '../../app/application/contract/contract-read-grants';
import { ContractService } from '../../app/application/contract/contract-service';
import { changeContractReadGrant } from '../../scripts/system/contract-read-grant';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

test('one account can read exactly the granted contract, until revoked', async () => {
  const db = createTestPrisma();
  try {
    await clearTestApplicationData(db);
    const reader = await db.user.create({ data: { username: 'reader', password: 'unused' } });
    const other = await db.user.create({ data: { username: 'other', password: 'unused' } });
    const customer = await db.customer.create({ data: {
      customerNo: 'C', name: '测试', phone: '0', phoneHash: '0', createdBy: other.id,
    } });
    const makeContract = (contractNo: string) => db.contract.create({ data: {
      contractNo, contractType: 'FORMAL', title: '测试合同', customerId: customer.id, createdBy: other.id,
    } });
    const first = await makeContract('A'), second = await makeContract('B');
    await db.case.create({ data: {
      caseNo: 'CASE-A', caseType: '民事', title: '测试案件', customerId: customer.id, contractId: first.id,
    } });
    const auth = new AuthorizationContextLoader(db);
    await assert.rejects(changeContractReadGrant(db, 'grant', reader.username, 'B', 'CASE-A'));
    assert.equal((await changeContractReadGrant(db, 'grant', reader.username, 'A', 'CASE-A')).changed, true);
    assert.equal((await changeContractReadGrant(db, 'grant', reader.username, 'A', 'CASE-A')).changed, false);
    const ctx = await auth.load(reader.id);
    assert.deepEqual(ctx.permissionCodes, ['contract.read']);
    assert.deepEqual((await auth.load(other.id)).permissionCodes, []);
    const service = new ContractService(db, { actorUserId: reader.id }, ctx);
    assert.deepEqual((await service.listContracts({})).list.map(c => c.id), [first.id]);
    assert.equal((await service.getContract(first.id)).id, first.id);
    await assert.rejects(service.getContract(second.id), /contract not found/);
    const admin = { userId: other.id, isSystemSuperAdmin: true };
    const ordinary = { userId: reader.id, isSystemSuperAdmin: false };
    const key = { userId: reader.id, contractId: second.id };
    assert.deepEqual((await listContractReadGrants(db, admin, reader.id)).map(row => row.contract.id), [first.id]);
    await assert.rejects(listContractReadGrants(db, ordinary, other.id), /PERMISSION_DENIED/);
    for (const action of ['grant', 'revoke'] as const) {
      await assert.rejects(manageContractReadGrant(db, ordinary, action, key), /PERMISSION_DENIED/);
      await assert.rejects(manageContractReadGrant(db, admin, action, { ...key, userId: admin.userId }), /PRIVILEGE_ESCALATION/);
    }
    assert.deepEqual(await manageContractReadGrant(db, admin, 'grant', key), { changed: true });
    assert.deepEqual(await manageContractReadGrant(db, admin, 'grant', key), { changed: false });
    const expanded = new ContractService(db, { actorUserId: reader.id }, await auth.load(reader.id));
    assert.equal((await expanded.getContract(second.id)).id, second.id);
    await db.user.update({ where: { id: reader.id }, data: { status: 'DISABLED' } });
    assert.deepEqual(await manageContractReadGrant(db, admin, 'revoke', key), { changed: true });
    assert.deepEqual(await manageContractReadGrant(db, admin, 'revoke', key), { changed: false });
    await assert.rejects(manageContractReadGrant(db, admin, 'grant', key), /RESOURCE_NOT_FOUND/);
    await db.user.update({ where: { id: reader.id }, data: { status: 'ENABLED' } });
    assert.deepEqual((await listContractReadGrants(db, admin, reader.id)).map(row => row.contract.id), [first.id]);
    const afterRevoke = new ContractService(db, { actorUserId: reader.id }, await auth.load(reader.id));
    await assert.rejects(afterRevoke.getContract(second.id), /contract not found/);
    assert.equal((await afterRevoke.getContract(first.id)).id, first.id);
    assert.equal(await db.operationLog.count({ where: { targetId: second.id, userId: admin.userId } }), 2);
    await changeContractReadGrant(db, 'revoke', reader.username, 'A');
    const revoked = await auth.load(reader.id);
    assert.deepEqual(revoked.permissionCodes, []);
    await assert.rejects(new ContractService(db, { actorUserId: reader.id }, revoked).getContract(first.id));
    assert.equal(await db.operationLog.count({ where: { targetId: first.id, action: { in: ['GRANT_CONTRACT_READ','REVOKE_CONTRACT_READ'] } } }), 2);
  } finally {
    await db.$disconnect();
  }
});
