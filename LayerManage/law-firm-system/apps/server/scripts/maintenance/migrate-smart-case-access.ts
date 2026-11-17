import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { migrateSmartCaseAccess, previewSmartCaseAccess } from '../../app/application/smart-case/access-migration';

const db = new PrismaClient();
async function main() {
  if (!process.argv.includes('--apply')) return previewSmartCaseAccess(db);
  const expected = process.argv.find(a => a.startsWith('--expected='))?.slice(11);
  const actorId = process.argv.find(a => a.startsWith('--actor='))?.slice(8);
  if (!expected || !actorId) throw Error('先预览，应用时传入 --expected=指纹 --actor=超级管理员ID');
  return migrateSmartCaseAccess(db, actorId, expected);
}
void main().then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
