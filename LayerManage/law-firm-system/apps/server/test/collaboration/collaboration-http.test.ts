import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
let db: PrismaClient;
let server: Server;
let origin: string;
let owner: string;
let editor: string;
let token: string;
let editorToken: string;
let baseId: string;
let tableId: string;
let fieldId: string;
let workspaceId: string;
test.before(async () => {
  db = createTestPrisma();
  await app.ready();
  server = createServer(app.callback());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const orgId = randomUUID();
  await db.organization.create({
    data: { id: orgId, code: 'HTTP_COLLAB', name: '协作接口测试', type: 'FIRM', path: '/' + orgId },
  });
  owner = (
    await db.user.create({
      data: { username: 'collab-owner', password: 'unused', mustChangePassword: false },
    })
  ).id;
  editor = (
    await db.user.create({
      data: { username: 'collab-editor', password: 'unused', mustChangePassword: false },
    })
  ).id;
  token = (await createApiSession(db, owner)).token;
  editorToken = (await createApiSession(db, editor)).token;
  const workspace = await db.collabWorkspace.create({
    data: {
      organizationId: orgId,
      name: '接口工作区',
      ownerId: owner,
      members: {
        create: [
          { principalId: owner, role: 'OWNER', canCreate: true },
          { principalId: editor, role: 'EDITOR', rowScope: 'ALL', canCreate: true },
        ],
      },
    },
  });
  workspaceId = workspace.id;
  baseId = (await db.collabBase.create({ data: { workspaceId, name: '业务台账' } })).id;
  const table = await app
    .httpRequest()
    .post('/api/v1/bases/' + baseId + '/tables')
    .set('Authorization', 'Bearer ' + token)
    .set('Idempotency-Key', randomUUID())
    .send({ name: '协作表' })
    .expect(200);
  tableId = table.body.data.id;
  fieldId = (await db.collabField.findFirstOrThrow({ where: { tableId } })).id;
});
test.after(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.close();
  await clearTestApplicationData(db);
  await db.$disconnect();
  await mm.restore();
});

test('authenticated HTTP writes persist; invalid input and unauthorized access are denied', async () => {
  await app.httpRequest().get('/api/v1/workspaces').expect(401);
  const created = await app
    .httpRequest()
    .post('/api/v1/tables/' + tableId + '/records')
    .set('Authorization', 'Bearer ' + editorToken)
    .set('Idempotency-Key', randomUUID())
    .send({ values: { [fieldId]: '双方看到同一条记录' }, schemaVersion: 1 })
    .expect(200);
  const query = await app
    .httpRequest()
    .post('/api/v1/tables/' + tableId + '/records/query')
    .set('Authorization', 'Bearer ' + token)
    .send({})
    .expect(200);
  assert.equal(query.body.data.records[0].id, created.body.data.id);
  await app
    .httpRequest()
    .patch('/api/v1/tables/' + tableId + '/records/' + created.body.data.id)
    .set('Authorization', 'Bearer ' + editorToken)
    .set('Idempotency-Key', randomUUID())
    .send({ values: {}, schemaVersion: 1, version: 2 })
    .expect(409);
  await db.collabMember.deleteMany({ where: { workspaceId, principalId: editor } });
  await app
    .httpRequest()
    .get('/api/v1/tables/' + tableId)
    .set('Authorization', 'Bearer ' + editorToken)
    .expect(403);
});

test('SSE delivers real changes and revokes an already connected member without broadcasting values', async () => {
  const abort = new AbortController();
  const frames: string[] = [];
  const response = await fetch(
    origin + '/api/v1/collaboration/events?baseId=' + baseId + '&tableId=' + tableId,
    {
      headers: { Authorization: 'Bearer ' + editorToken },
      signal: abort.signal,
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const pumping = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        frames.push(decoder.decode(chunk.value));
      }
    } catch {
      /* Abort is expected in cleanup. */
    }
  })();
  const until = async (value: string) => {
    const deadline = Date.now() + 8000;
    while (!frames.join('').includes(value) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(frames.join('').includes(value), 'missing SSE ' + value);
  };
  try {
    await until('event: ready');
    await app
      .httpRequest()
      .post('/api/v1/tables/' + tableId + '/records')
      .set('Authorization', 'Bearer ' + token)
      .set('Idempotency-Key', randomUUID())
      .send({ values: { [fieldId]: 'private-payload-never-broadcast' }, schemaVersion: 1 })
      .expect(200);
    await until('event: invalidate');
    await until('event: presence');
    assert.ok(!frames.join('').includes('private-payload-never-broadcast'));
    // Detect changed effective permissions even when no collaboration event was written.
    await db.collabMember.updateMany({
      where: { workspaceId, principalId: editor },
      data: { rowScope: 'SELF' },
    });
    await until('"kind":"access.updated"');
    const ownRows = await app
      .httpRequest()
      .post('/api/v1/tables/' + tableId + '/records/query')
      .set('Authorization', 'Bearer ' + editorToken)
      .send({})
      .expect(200);
    assert.equal(ownRows.body.data.total, 0);
    await app
      .httpRequest()
      .post('/api/v1/tables/' + tableId + '/access')
      .set('Authorization', 'Bearer ' + token)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 1, policy: { restricted: true, grants: [] } })
      .expect(200);
    await until('event: revoked');
    assert.equal(await db.collabMember.count({ where: { workspaceId, principalId: editor } }), 1);
    const listed = await app
      .httpRequest()
      .get('/api/v1/bases/' + baseId + '/tables')
      .set('Authorization', 'Bearer ' + editorToken)
      .expect(200);
    assert.equal(listed.body.data.tables.length, 0);
  } finally {
    abort.abort();
    await pumping;
  }
});

test(
  'two real browser sessions create tables, edit shared records, retain personal views and fit three widths',
  { skip: process.env.COLLAB_BROWSER_REHEARSAL !== 'true', timeout: 120000 },
  async () => {
    const webRoot = path.resolve(process.cwd(), '../web');
    const load = new Function('url', 'return import(url)');
    const { chromium } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/@playwright/test/index.mjs')).href,
    );
    const { createServer: createViteServer } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/vite/dist/node/index.js')).href,
    );
    const vite = await createViteServer({
      root: webRoot,
      configFile: path.join(webRoot, 'vite.config.ts'),
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin, changeOrigin: true } } },
    });
    await vite.listen();
    const browser = await chromium
      .launch({ headless: true, channel: process.env.COLLAB_BROWSER_CHANNEL || undefined })
      .catch(async (error: Error) => {
        await vite.close();
        throw error;
      });
    const errors: string[] = [];
    try {
      const a = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const b = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      for (const [context, id, accessToken] of [
        [a, owner, token],
        [b, editor, editorToken],
      ]) {
        await context.addInitScript(
          (session: unknown) => {
            window.collabTestSession = session;
          },
          {
            mode: 'AUTHENTICATED',
            token: accessToken,
            csrfToken: 'test',
            expiresIn: 900,
            user: { id, username: id, name: '测试成员', roles: [], permissions: [] },
          },
        );
      }
      const p1 = await a.newPage();
      const p2 = await b.newPage();
      p1.on('pageerror', (e: Error) => errors.push(e.message));
      p2.on('pageerror', (e: Error) => errors.push(e.message));
      const address = vite.resolvedUrls.local[0] + 'e2e/workspace.html?base=' + baseId + '&table=' + tableId;
      await Promise.all([p1.goto(address), p2.goto(address)]);
      try {
        await p1.getByRole('button', { name: '添加记录', exact: true }).waitFor();
      } catch (error) {
        console.error('Browser errors:', errors, 'Page:', await p1.locator('body').innerText());
        await p1.screenshot({
          path: path.resolve(process.cwd(), '../../var/collaboration-evidence/browser-failure.png'),
        });
        throw error;
      }
      await p1.getByRole('button', { name: '添加记录', exact: true }).click();
      await p1.getByRole('textbox', { name: '标题', exact: true }).fill('双账号协作验收');
      await p1
        .locator('.ant-drawer')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p2.getByRole('button', { name: '标题：双账号协作验收', exact: true }).waitFor({ timeout: 10000 });
      await p2.getByRole('button', { name: '标题：双账号协作验收', exact: true }).dblclick();
      await p2.getByRole('textbox', { name: '标题', exact: true }).fill('另一成员已更新');
      await p2
        .locator('.workspace-cell-editor')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p1.getByRole('button', { name: '标题：另一成员已更新', exact: true }).waitFor({ timeout: 10000 });
      await p2.getByRole('button', { name: '新建视图', exact: true }).click();
      await p2.getByRole('textbox', { name: '名称', exact: true }).fill('我的个人视图');
      await p2
        .locator('.ant-modal')
        .getByRole('button', { name: /确\s*定/ })
        .click();
      await p2.getByRole('tab', { name: /我的个人视图/ }).waitFor();
      assert.equal(await p1.getByRole('tab', { name: /我的个人视图/ }).count(), 0);
      await p2.reload();
      await p2.getByRole('tab', { name: /我的个人视图/ }).waitFor();
      await p2.getByRole('button', { name: '新建数据表', exact: true }).click();
      await p2.getByRole('textbox', { name: '名称', exact: true }).fill('员工自主创建');
      await p2
        .locator('.ant-modal')
        .getByRole('button', { name: /确\s*定/ })
        .click();
      await p2.locator('.workspace-heading').getByText('员工自主创建', { exact: true }).waitFor();
      await p1.getByRole('button', { name: '员工自主创建', exact: true }).waitFor({ timeout: 10000 });
      await p2.getByRole('button', { name: '新增字段', exact: true }).click();
      await p2.getByRole('textbox', { name: '名称', exact: true }).fill('自定义备注');
      await p2
        .locator('.ant-modal')
        .getByRole('button', { name: /确\s*定/ })
        .click();
      await p2.getByRole('button', { name: '自定义备注', exact: true }).waitFor();
      await p2.reload();
      await p2.getByRole('button', { name: '自定义备注', exact: true }).waitFor();
      await p2.goto(address);
      await p2.getByRole('button', { name: '标题：另一成员已更新', exact: true }).waitFor();
      await p1.getByRole('button', { name: '表权限', exact: true }).click();
      await p1.getByRole('checkbox', { name: '启用独立授权名单', exact: true }).check();
      await p1.getByRole('button', { name: '保存权限', exact: true }).click();
      await p2
        .getByRole('button', { name: '标题：另一成员已更新', exact: true })
        .waitFor({ state: 'hidden', timeout: 10000 });
      await p1.getByRole('button', { name: '表权限', exact: true }).click();
      await p1.getByRole('checkbox', { name: '启用独立授权名单', exact: true }).uncheck();
      await p1.getByRole('button', { name: '保存权限', exact: true }).click();
      await p2.reload();
      await p2.getByRole('button', { name: '标题：另一成员已更新', exact: true }).waitFor();
      const readPermissions = await db.permission.findMany({
        where: { code: { in: ['lead.read', 'lead.update', 'lead.assign'] } },
      });
      const allScope = await db.dataScope.create({ data: { name: '业务表演练范围', scopeType: 'ALL' } });
      await db.role.create({
        data: {
          name: '业务表演练角色',
          code: 'COLLAB_BROWSER_CRM',
          type: 'BUSINESS',
          permissions: { create: readPermissions.map((p) => ({ permissionId: p.id })) },
          dataScopes: { create: { resource: 'lead', dataScopeId: allScope.id } },
          userRoles: { create: [{ userId: owner }, { userId: editor }] },
        },
      });
      const org = await db.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
      const position = await db.position.create({
        data: {
          organizationId: org.organizationId,
          code: 'BROWSER-SALES',
          name: '协作业务专员',
          categoryCode: 'SALES',
        },
      });
      const target = await db.employee.create({
        data: {
          name: '协作专员',
          employeeNo: 'BROWSER-SALES',
          type: 'SALES',
          phone: '13800001234',
          status: 'FORMAL',
          entryDate: new Date('2025-01-01'),
          assignments: {
            create: {
              organizationId: org.organizationId,
              positionId: position.id,
              assignmentType: 'PRIMARY',
              startedAt: new Date('2025-01-01'),
            },
          },
        },
      });
      await db.user.update({ where: { id: editor }, data: { employeeId: target.id } });
      const lead = await db.lead.create({
        data: {
          name: '真实业务来源演练',
          leadNo: 'COLLAB-E2E',
          phone: '13800001234',
          phoneHash: randomUUID(),
          createdBy: editor,
          branchId: org.organizationId,
        },
      });
      // Reload after changing business grants: permission invalidation intentionally closes open editors.
      await p1.reload();
      await p1.getByRole('button', { name: '新建数据表', exact: true }).click();
      await p1.getByRole('textbox', { name: '名称', exact: true }).fill('真实线索表');
      await p1.getByRole('combobox', { name: '创建方式', exact: true }).click();
      await p1.getByText('现有 CRM · 线索表（负责人配置）', { exact: true }).click();
      await p1
        .locator('.ant-modal')
        .getByRole('button', { name: /确\s*定/ })
        .click();
      await p1.getByText('真实业务来源演练', { exact: true }).waitFor();
      assert.equal(await p1.getByRole('button', { name: '添加记录', exact: true }).isDisabled(), true);
      await p1.getByText('138****1234', { exact: true }).waitFor();
      await db.lead.update({
        where: { id: lead.id },
        data: { name: '原业务修改自动出现', version: { increment: 1 } },
      });
      await p1.getByText('原业务修改自动出现', { exact: true }).waitFor({ timeout: 12000 });
      await p1.getByRole('button', { name: '展开第1条记录', exact: true }).first().click();
      await p1.getByRole('button', { name: '打开线索业务详情', exact: true }).waitFor();
      const recordAddress = p1.url();
      assert.ok(recordAddress.includes('record=' + lead.id));
      await p2.goto(recordAddress);
      await p2.getByRole('button', { name: '新增跟进', exact: true }).waitFor();
      await p1.getByRole('button', { name: '分配负责人', exact: true }).click();
      await p1.locator('.ant-modal:visible').getByRole('combobox', { name: '负责人', exact: true }).click();
      await p1.getByText('协作专员', { exact: true }).last().click();
      await p1.getByRole('textbox', { name: '原因', exact: true }).fill('交由录入专员跟进');
      await p1
        .locator('.ant-modal:visible')
        .getByRole('button', { name: /^提\s*交$/ })
        .click();
      await p1.locator('.ant-modal:visible').waitFor({ state: 'hidden' });
      const assignedDeadline = Date.now() + 10000;
      while (
        (await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status !== 'ASSIGNED' &&
        Date.now() < assignedDeadline
      )
        await new Promise((r) => setTimeout(r, 50));
      await p2.reload();
      await p2.getByRole('button', { name: '新增跟进', exact: true }).click();
      await p2.getByRole('textbox', { name: '跟进内容', exact: true }).fill('无需离开工作区完成跟进');
      await p2
        .locator('.ant-modal:visible')
        .getByRole('button', { name: /^提\s*交$/ })
        .click();
      await p1.getByText('无需离开工作区完成跟进', { exact: true }).waitFor({ timeout: 10000 });
      await p1.getByRole('button', { name: '调整状态', exact: true }).click();
      await p1.getByRole('combobox', { name: '目标状态', exact: true }).click();
      await p1.getByText('已筛选', { exact: true }).click();
      await p1.getByRole('textbox', { name: '原因', exact: true }).fill('负责人完成复核');
      await p1
        .locator('.ant-modal:visible')
        .getByRole('button', { name: /^提\s*交$/ })
        .click();
      await p2.getByRole('button', { name: '业务状态：SCREENED', exact: true }).waitFor({ timeout: 10000 });
      await p2.reload();
      await p2.getByText('无需离开工作区完成跟进', { exact: true }).waitFor();
      assert.equal((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'SCREENED');
      assert.equal(await db.leadFollow.count({ where: { leadId: lead.id } }), 1);

      await p1.goto(address);
      await p1.getByRole('button', { name: '添加记录', exact: true }).waitFor();
      const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence');
      await mkdir(evidence, { recursive: true });
      for (const width of [1440, 1024, 390]) {
        await p1.setViewportSize({ width, height: 1000 });
        await p1.screenshot({ path: path.join(evidence, 'workspace-' + width + '.png'), fullPage: true });
        assert.ok(
          await p1.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          'unexpected page overflow at ' + width,
        );
        if (width === 390) {
          await p1.getByRole('button', { name: '数据表', exact: true }).click();
          await p1.locator('.ant-drawer').getByRole('button', { name: '新建数据表', exact: true }).waitFor();
        }
      }
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const context of browser.contexts())
        for (const page of context.pages()) {
          console.error('Browser failure page:', await page.locator('body').innerText());
        }
      throw error;
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);
