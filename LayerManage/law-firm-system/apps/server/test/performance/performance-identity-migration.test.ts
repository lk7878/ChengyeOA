import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createTestPrisma } from '../helpers/test-database';
test('performance identity migration preserves unknown facts and only trusts one real audited creator', async () => {
  const db = createTestPrisma();
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE performance (id TEXT PRIMARY KEY) ON COMMIT DROP');
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE operation_log ("targetId" TEXT, "targetType" TEXT, action TEXT, "userId" TEXT) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "user" (id TEXT PRIMARY KEY) ON COMMIT DROP');
      await tx.$executeRawUnsafe(`INSERT INTO "user" VALUES ('creator'), ('a'), ('b')`);
      await tx.$executeRawUnsafe(
        `INSERT INTO performance VALUES ('audited'), ('ambiguous'), ('unknown'), ('deleted-actor')`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO operation_log VALUES ('audited','PERFORMANCE','PERFORMANCE_CREATE','creator'), ('audited','PERFORMANCE','PERFORMANCE_CREATE','creator'), ('ambiguous','PERFORMANCE','PERFORMANCE_CREATE','a'), ('ambiguous','PERFORMANCE','PERFORMANCE_CREATE','b'), ('unknown','PERFORMANCE','PERFORMANCE_UPDATE','creator'), ('deleted-actor','PERFORMANCE','PERFORMANCE_CREATE','missing')`,
      );
      const sql = await readFile(
        'prisma/migrations/20260916003000_performance_identity/migration.sql',
        'utf8',
      );
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await tx.$executeRawUnsafe(statement);
      const rows =
        await tx.$queryRaw`SELECT id, "createdBy", "updatedBy", version FROM performance ORDER BY id`;
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
