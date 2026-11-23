import { hostname, userInfo } from 'node:os';
import { Prisma, PrismaClient } from '@prisma/client';
import { applyContractReadGrant } from '../../app/application/contract/contract-read-grants';

// Local operations entry point. Grant checks the supplied case/contract pair; revocation
// still works after the case is reassigned, unlinked or archived.
export async function changeContractReadGrant(db: PrismaClient, action: 'grant' | 'revoke',
  username: string, contractNo: string, caseNo?: string) {
  if (!username || !contractNo || (action !== 'grant' && action !== 'revoke') || (action === 'grant' && !caseNo)) {
    throw new Error('Use grant USERNAME CONTRACT_NO CASE_NO or revoke USERNAME CONTRACT_NO');
  }
  return db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { username }, select: { id: true, status: true } });
    const contract = await tx.contract.findUniqueOrThrow({ where: { contractNo }, select: { id: true, deletedAt: true } });
    const key = { userId: user.id, contractId: contract.id };
    if (action === 'grant') {
      if (user.status !== 'ENABLED' || contract.deletedAt ||
          !await tx.case.findFirst({ where: { caseNo, contractId: contract.id, deletedAt: null }, select: { id: true } })) {
        throw new Error('账号状态或案件与合同的关联不符合授权条件');
      }
    }
    const changed = await applyContractReadGrant(tx, action, key, {
      source: 'local-operations', operator: userInfo().username + '@' + hostname(), caseNo,
    });
    return { username, contractNo, action, changed };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

if (require.main === module) {
  const [action, username, contractNo, caseNo] = process.argv.slice(2);
  if (action !== 'grant' && action !== 'revoke') throw new Error('Expected grant or revoke');
  const db = new PrismaClient();
  changeContractReadGrant(db, action, username, contractNo, caseNo)
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.$disconnect());
}
