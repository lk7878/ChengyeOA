import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createTestPrisma } from '../helpers/test-database';

test('case identity migration preserves rows and only backfills unambiguous recorded facts', async () => {
  const db = createTestPrisma();
  try {
    await db.$transaction(async (tx) => {
      // Temporary tables shadow public tables on this transaction connection, then drop on commit.
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE "case" (id TEXT PRIMARY KEY, "contractId" TEXT, "intakeData" JSONB) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE operation_log ("targetId" TEXT, "targetType" TEXT, action TEXT, "userId" TEXT) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe(
        'CREATE TEMP TABLE contract (id TEXT PRIMARY KEY, "branchId" TEXT) ON COMMIT DROP',
      );
      await tx.$executeRawUnsafe('CREATE TEMP TABLE organization (id TEXT PRIMARY KEY) ON COMMIT DROP');
      await tx.$executeRawUnsafe(`INSERT INTO organization VALUES ('org'), ('department')`);
      await tx.$executeRawUnsafe(`INSERT INTO contract VALUES ('contract', 'org')`);
      await tx.$executeRawUnsafe(
        `INSERT INTO "case" VALUES ('audited', 'contract', NULL), ('ambiguous', NULL, '{"departmentId":"department"}'), ('unknown', NULL, NULL)`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO operation_log VALUES ('audited','CASE','CASE_CREATE','creator'), ('audited','CASE','CASE_CREATE','creator'), ('ambiguous','CASE','CASE_CREATE','a'), ('ambiguous','CASE','CASE_CREATE','b'), ('unknown','CASE','CASE_UPDATE','editor')`,
      );
      const sql = await readFile(
        'prisma/migrations/20260915210000_case_creator_organization/migration.sql',
        'utf8',
      );
      for (const statement of sql
        .replace(/^--.*$/gm, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await tx.$executeRawUnsafe(statement);
      const rows = await tx.$queryRaw<
        Array<{ id: string; createdBy: string | null; branchId: string | null }>
      >`SELECT id, "createdBy", "branchId" FROM "case" ORDER BY id`;
      assert.deepEqual(rows, [
        { id: 'ambiguous', createdBy: null, branchId: 'department' },
        { id: 'audited', createdBy: 'creator', branchId: 'org' },
        { id: 'unknown', createdBy: null, branchId: null },
      ]);
    });
  } finally {
    await db.$disconnect();
  }
});
