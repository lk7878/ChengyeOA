import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createTestPrisma } from '../helpers/test-database';
test('channel identity migration preserves unknown facts and only trusts one real audited creator', async () => {
  const db = createTestPrisma();
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE channel (id TEXT PRIMARY KEY) ON COMMIT DROP');
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE operation_log ("targetId" TEXT, "targetType" TEXT, action TEXT, "userId" TEXT) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "user" (id TEXT PRIMARY KEY) ON COMMIT DROP');
      await tx.$executeRawUnsafe(`INSERT INTO "user" VALUES ('creator'), ('a'), ('b')`);
      await tx.$executeRawUnsafe(
        `INSERT INTO channel VALUES ('audited'), ('ambiguous'), ('unknown'), ('deleted-actor')`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO operation_log VALUES ('audited','CHANNEL','CHANNEL_CREATE','creator'), ('audited','CHANNEL','CHANNEL_CREATE','creator'), ('ambiguous','CHANNEL','CHANNEL_CREATE','a'), ('ambiguous','CHANNEL','CHANNEL_CREATE','b'), ('unknown','CHANNEL','CHANNEL_UPDATE','creator'), ('deleted-actor','CHANNEL','CHANNEL_CREATE','missing')`,
      );
      const sql = await readFile('prisma/migrations/20260916013000_channel_identity/migration.sql', 'utf8');
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await tx.$executeRawUnsafe(statement);
      const rows = await tx.$queryRaw`SELECT id, "createdBy", "updatedBy", version FROM channel ORDER BY id`;
      assert.deepEqual(rows, [
        { id: 'ambiguous', createdBy: null, updatedBy: null, version: 1 },
        { id: 'audited', createdBy: 'creator', updatedBy: null, version: 1 },
        { id: 'deleted-actor', createdBy: null, updatedBy: null, version: 1 },
        { id: 'unknown', createdBy: null, updatedBy: null, version: 1 },
      ]);
    });
  } finally {
    await db.$disconnect();
  }
});


test('channel permission migration provisions an empty catalog idempotently without assigning roles', async () => {
 const db=createTestPrisma();
 try {
  await db.$transaction(async tx=>{
   const before=await tx.rolePermission.count();
   await tx.$executeRawUnsafe('CREATE TEMP TABLE permission (LIKE public.permission INCLUDING ALL) ON COMMIT DROP');
   const sql=await readFile('prisma/migrations/20260916020000_channel_permission_provision/migration.sql','utf8');
   await tx.$executeRawUnsafe(sql);await tx.$executeRawUnsafe(sql);
   const rows=await tx.$queryRawUnsafe<Array<{id:string;code:string;resource:string;path:string|null}>>('SELECT id,code,resource,path FROM permission ORDER BY code');
   assert.equal(rows.length,5);
   for(const row of rows){assert.equal(row.id,'permission:'+row.code);assert.equal(row.resource,row.code==='menu.channel'?'menu':'channel');assert.equal(row.path,row.code==='menu.channel'?'/channels':null);}
   assert.equal(await tx.rolePermission.count(),before);
  });
 } finally {await db.$disconnect();}
});
