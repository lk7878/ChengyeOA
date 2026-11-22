import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
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
    await changeContractReadGrant(db, 'revoke', reader.username, 'A');
    const revoked = await auth.load(reader.id);
    assert.deepEqual(revoked.permissionCodes, []);
    await assert.rejects(new ContractService(db, { actorUserId: reader.id }, revoked).getContract(first.id));
    assert.equal(await db.operationLog.count({ where: { targetId: first.id, action: { in: ['GRANT_CONTRACT_READ','REVOKE_CONTRACT_READ'] } } }), 2);
  } finally {
    await db.$disconnect();
  }
});
