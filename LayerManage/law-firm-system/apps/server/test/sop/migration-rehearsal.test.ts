import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, cp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertTestDatabaseUrl } from '../helpers/test-database';

// Opt-in: creates only randomly named schemas inside an explicitly selected _test database.
test(
  'SQ7 baseline 60 to latest and fresh install preserve historical facts and deploy reentry',
  {
    skip: process.env.SOP_MIGRATION_REHEARSAL !== 'true',
    timeout: 240000,
  },
  async () => {
    const url = assertTestDatabaseUrl(),
      schemas: string[] = [],
      clients: PrismaClient[] = [];
    const control = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const root = await mkdtemp(path.join(tmpdir(), 'chengye-sq7-migrations-'));
    const migrations = path.resolve('prisma/migrations');
    const names = (await readdir(migrations, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    assert.equal(names[59], '20260916020000_channel_permission_provision');
    assert.equal(names.length, 67);
    async function prepare(label: string, count: number) {
      const dir = path.join(root, label);
      await mkdir(path.join(dir, 'migrations'), { recursive: true });
      await writeFile(
        path.join(dir, 'schema.prisma'),
        'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n',
      );
      await cp(
        path.join(migrations, 'migration_lock.toml'),
        path.join(dir, 'migrations/migration_lock.toml'),
      );
      for (const name of names.slice(0, count))
        await cp(path.join(migrations, name), path.join(dir, 'migrations', name), { recursive: true });
      return dir;
    }
    function deploy(dir: string, databaseUrl: string) {
      // Never print the datasource URL or subprocess connection output.
      try {
        execFileSync(
          process.execPath,
          [
            require.resolve('prisma/build/index.js'),
            'migrate',
            'deploy',
            '--schema',
            path.join(dir, 'schema.prisma'),
          ],
          { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 60000 },
        );
      } catch {
        throw new Error('SQ7 isolated schema migration failed');
      }
    }
    async function schema() {
      const name = 'sq7_' + randomUUID().replaceAll('-', '');
      schemas.push(name);
      await control.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
      const target = new URL(url);
      target.searchParams.set('schema', name);
      const db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
      clients.push(db);
      return { name, db, url: target.toString() };
    }
    try {
      const baseline = await prepare('baseline', 60),
        current = await prepare('current', names.length),
        old = await schema();
      deploy(baseline, old.url);
      const customer = await old.db.customer.create({
        data: {
          customerNo: 'SQ7-HISTORY',
          name: '隔离历史客户',
          phone: '13800000000',
          phoneHash: 'fixture',
          createdBy: 'historical-unknown',
        },
      });
      const caseRow = await old.db.case.create({
        data: {
          caseNo: 'SQ7-HISTORY',
          title: '隔离历史案件',
          customerId: customer.id,
          caseType: '历史类型',
          satisfaction: 3,
          status: 'CLOSED',
          closedAt: new Date('2026-08-10'),
          version: 7,
        },
      });
      const taskId = randomUUID();
      await old.db
        .$executeRaw`INSERT INTO case_task(id,"caseId",name,"nodeType",status,"updatedAt") VALUES (${taskId},${caseRow.id},'历史任务','材料收集','COMPLETED',CURRENT_TIMESTAMP)`;
      const user = await old.db.user.create({
        data: { username: 'sq7-history', password: 'unusable-fixture' },
      });
      const role = await old.db.role.create({
        data: { code: 'SQ7_HISTORY', name: '历史岗位', type: 'BUSINESS' },
      });
      await old.db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      const before = await old.db
        .$queryRaw`SELECT id,"caseId",name,"nodeType",status,"createdAt","updatedAt" FROM case_task`;
      const access = await old.db.userRole.findMany();
      deploy(current, old.url);
      deploy(current, old.url);
      assert.deepEqual(await old.db.case.findUniqueOrThrow({ where: { id: caseRow.id } }), caseRow);
      assert.deepEqual(
        await old.db
          .$queryRaw`SELECT id,"caseId",name,"nodeType",status,"createdAt","updatedAt" FROM case_task`,
        before,
      );
      assert.deepEqual(await old.db.userRole.findMany(), access);
      const task = await old.db.caseTask.findUniqueOrThrow({ where: { id: taskId } });
      assert.equal(task.createdBy, null);
      assert.equal(task.assigneeUserId, null);
      assert.equal(task.sopInstanceId, null);
      assert.equal(task.version, 1);
      assert.equal(await old.db.satisfactionAssessment.count(), 0);
      assert.equal(await old.db.specialAnalysis.count(), 0);
      assert.equal(await old.db.sopInstance.count(), 0);
      const fresh = await schema();
      deploy(current, fresh.url);
      deploy(current, fresh.url);
      for (const target of [old, fresh]) {
        const tables = await target.db.$queryRaw<
          Array<{ name: string }>
        >`SELECT table_name AS name FROM information_schema.tables WHERE table_schema=${target.name}`;
        for (const model of Prisma.dmmf.datamodel.models)
          assert.ok(tables.some((t) => t.name === (model.dbName ?? model.name)));
        const applied = await target.db.$queryRaw<
          Array<{ count: number }>
        >`SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
        assert.equal(applied[0].count, 67);
        assert.equal(
          await target.db.permission.count({
            where: { code: { in: ['sop.material.read', 'sop.material.manage', 'quality.analysis.decide'] } },
          }),
          3,
        );
      }
      assert.equal(await fresh.db.case.count(), 0);
      assert.equal(await fresh.db.sopTemplate.count(), 0);
      assert.equal(await fresh.db.userRole.count(), 0);
      console.log(
        'SQ7 migration: baseline60→67 and fresh67; deploy reentry; 112 models; historical case/task/identity/star score unchanged; no business seeds',
      );
    } finally {
      await Promise.all(clients.map((db) => db.$disconnect()));
      for (const name of schemas) {
        assert.match(name, /^sq7_[0-9a-f]{32}$/);
        await control.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
      }
      await control.$disconnect();
      assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
      await rm(root, { recursive: true, force: true });
    }
  },
);
