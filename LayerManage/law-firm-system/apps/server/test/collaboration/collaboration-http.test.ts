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
  await app
    .httpRequest()
    .get('/api/v1/workspaces/' + workspaceId + '/drive')
    .expect(401);
  await app
    .httpRequest()
    .post('/api/v1/workspaces/' + workspaceId + '/drive/folders')
    .send({ name: '未登录' })
    .expect(401);
  await app
    .httpRequest()
    .get('/api/v1/drive/nodes/' + baseId)
    .expect(401);
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
  { skip: process.env.COLLAB_BROWSER_REHEARSAL !== 'true', timeout: 300000 },
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
      await p2.getByRole('button', { name: '标题：另一成员已更新', exact: true }).dblclick();
      await p2.getByRole('textbox', { name: '标题', exact: true }).fill('撤权时丢弃未提交草稿');
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
        .getByRole('button', { name: '提交业务操作', exact: true })
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
        .getByRole('button', { name: '提交业务操作', exact: true })
        .click();
      await p1.getByText('无需离开工作区完成跟进', { exact: true }).waitFor({ timeout: 10000 });
      await p1.getByRole('button', { name: '调整状态', exact: true }).click();
      await p1.getByRole('combobox', { name: '目标状态', exact: true }).click();
      await p1.getByText('已筛选', { exact: true }).click();
      await p1.getByRole('textbox', { name: '原因', exact: true }).fill('负责人完成复核');

      await p1
        .locator('.ant-modal:visible')
        .getByRole('button', { name: '提交业务操作', exact: true })
        .click();
      await p2.getByRole('button', { name: '业务状态：SCREENED', exact: true }).waitFor({ timeout: 10000 });
      await p2.reload();
      await p2.getByText('无需离开工作区完成跟进', { exact: true }).waitFor();
      assert.equal((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'SCREENED');
      assert.equal(await db.leadFollow.count({ where: { leadId: lead.id } }), 1);
      await p1.locator('.ant-drawer:visible .ant-drawer-close').click();
      await p1.getByRole('button', { name: '新增字段', exact: true }).click();
      await p1.getByRole('textbox', { name: '名称', exact: true }).fill('业务补充说明');
      await p1
        .locator('.ant-modal:visible')
        .getByRole('button', { name: /确\s*定/ })
        .click();
      await p1.getByRole('button', { name: '业务补充说明：空', exact: true }).waitFor();
      await p1.getByRole('button', { name: '业务补充说明：空', exact: true }).dblclick();
      await p1.getByRole('textbox', { name: '业务补充说明', exact: true }).fill('扩展字段多人协作');
      await p1
        .locator('.workspace-cell-editor')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p2
        .getByRole('button', { name: '业务补充说明：扩展字段多人协作', exact: true })
        .waitFor({ timeout: 10000 });
      await p2.reload();
      await p2.getByRole('textbox', { name: '业务补充说明', exact: true }).fill('从记录抽屉保存');
      await p1.getByRole('button', { name: '业务补充说明：扩展字段多人协作', exact: true }).dblclick();
      await p1.getByRole('textbox', { name: '业务补充说明', exact: true }).fill('对端并发修改');
      await p1
        .locator('.workspace-cell-editor')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p2
        .getByRole('button', { name: '业务补充说明：对端并发修改', exact: true })
        .waitFor({ timeout: 10000 });
      assert.equal(
        await p2.getByRole('textbox', { name: '业务补充说明', exact: true }).inputValue(),
        '从记录抽屉保存',
      );
      await p2
        .locator('.ant-drawer:visible')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p2.getByRole('button', { name: '保留本地并复核提交', exact: true }).click();

      await p2
        .locator('.ant-drawer:visible')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p1
        .getByRole('button', { name: '业务补充说明：从记录抽屉保存', exact: true })
        .waitFor({ timeout: 10000 });
      assert.equal((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, 'SCREENED');
      await p1.reload();
      await p1.getByRole('button', { name: '业务补充说明：从记录抽屉保存', exact: true }).waitFor();
      await p1.locator('.workspace-grid').hover({ position: { x: 300, y: 80 } });
      await p1.mouse.wheel(2000, 0);
      await p1.waitForFunction(() => {
        const heading = [...document.querySelectorAll('.workspace-field-heading')]
          .find((e) => e.textContent === '业务补充说明')
          ?.closest('th');
        const cell = [...document.querySelectorAll('.workspace-cell')]
          .find((e) => e.getAttribute('aria-label') === '业务补充说明：从记录抽屉保存')
          ?.closest('.ant-table-cell');
        if (!heading || !cell) return false;
        const h = heading.getBoundingClientRect(),
          c = cell.getBoundingClientRect();
        return h.left < window.innerWidth - 40 && Math.abs(h.left - c.left) < 2;
      });
      await p1.screenshot({
        path: path.resolve(process.cwd(), '../../var/collaboration-evidence/business-extensions.png'),
        fullPage: true,
      });

      await p1.goto(address);
      await p1.getByRole('button', { name: '添加记录', exact: true }).waitFor();

      await p1.getByRole('button', { name: '员工自主创建', exact: true }).click();
      await p1.getByRole('button', { name: '自定义备注', exact: true }).waitFor();
      await p2.goto(p1.url());
      await p1.getByRole('button', { name: '批量粘贴', exact: true }).click();
      await p1
        .getByRole('textbox', { name: '粘贴表格内容', exact: true })
        .fill('粘贴第一行\t同组\n粘贴第二行\t同组');
      await p1.getByRole('button', { name: '提交 2 行', exact: true }).click();
      await p2.getByRole('button', { name: '标题：粘贴第二行', exact: true }).waitFor({ timeout: 10000 });
      await p1.getByRole('button', { name: '视图配置', exact: true }).click();
      await p1.getByRole('button', { name: '上移自定义备注', exact: true }).click();
      await p1.getByRole('combobox', { name: '分组字段', exact: true }).click();
      await p1.locator('.ant-select-dropdown:visible').getByText('自定义备注', { exact: true }).click();
      await p1.keyboard.press('Escape');
      await p1.locator('.ant-drawer:visible .ant-drawer-close').click();
      await p1.getByRole('button', { name: '保存视图', exact: true }).click();
      await p1.getByText('视图配置已保存', { exact: true }).waitFor();
      await p1.reload();
      await p1.locator('.workspace-group').waitFor();
      assert.equal(await p1.locator('.workspace-field-heading').first().innerText(), '自定义备注');
      assert.match(await p1.locator('.workspace-group').innerText(), /本页 2 条 \/ 共 2 条/);
      await p1.locator('.workspace-group').click();
      assert.equal(await p1.getByRole('button', { name: '标题：粘贴第一行', exact: true }).count(), 0);
      await p1.locator('.workspace-group').click();
      await p1.getByRole('button', { name: '标题：粘贴第一行', exact: true }).waitFor();
      await p2.locator('.workspace-group').waitFor();
      // Native paste anchors to the focused cell after reordering; the snapshot survives SSE updates.
      const firstCell = p1.getByRole('button', { name: '标题：粘贴第一行', exact: true });
      await firstCell.focus();
      await firstCell.evaluate((element) => {
        const data = new DataTransfer();
        data.setData('text/plain', '保留粘贴草稿');
        element.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      });
      await p1.getByRole('textbox', { name: '粘贴表格内容', exact: true }).waitFor();
      await p2.getByRole('button', { name: '标题：粘贴第一行', exact: true }).dblclick();
      await p2.getByRole('textbox', { name: '标题', exact: true }).fill('对端先提交');
      await p2
        .locator('.workspace-cell-editor')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p1.getByRole('button', { name: '标题：对端先提交', exact: true }).waitFor({ timeout: 10000 });
      await p1.getByRole('button', { name: '提交 1 行', exact: true }).click();
      await p1.getByText(/第 1 行：这条记录已被其他成员修改/).waitFor();
      assert.equal(
        await p1.getByRole('textbox', { name: '粘贴表格内容', exact: true }).inputValue(),
        '保留粘贴草稿',
      );
      await p1
        .locator('.ant-modal:visible')
        .getByRole('button', { name: /^关\s*闭$/ })
        .last()
        .click();
      await p1.screenshot({
        path: path.resolve(process.cwd(), '../../var/collaboration-evidence/grid-operations.png'),
        fullPage: true,
      });
      // Directory changes persist and are invalidated in the other session.
      const directoryNames = () => p1.locator('.workspace-table-item > button:first-child').allTextContents();
      const originalDirectory = await directoryNames();
      await p1.getByRole('button', { name: '管理员工自主创建', exact: true }).click();
      await p1.getByRole('menuitem', { name: '上移', exact: true }).click();
      await p1.getByText('目录顺序已保存', { exact: true }).waitFor();
      const reorderedDirectory = await directoryNames();
      assert.notDeepEqual(reorderedDirectory, originalDirectory);
      await p1.reload();
      await p1.getByRole('button', { name: '拖动排序员工自主创建', exact: true }).waitFor();
      assert.deepEqual(await directoryNames(), reorderedDirectory);
      await p2.waitForFunction(
        (expected) =>
          JSON.stringify(
            [...document.querySelectorAll('.workspace-table-item > button:first-child')].map(
              (e) => e.textContent,
            ),
          ) === JSON.stringify(expected),
        reorderedDirectory,
      );
      await p1.getByRole('searchbox', { name: '搜索数据表', exact: true }).fill('员工');
      assert.equal(
        await p1.getByRole('button', { name: '拖动排序员工自主创建', exact: true }).isDisabled(),
        true,
      );
      await p1.getByRole('searchbox', { name: '搜索数据表', exact: true }).fill('');
      const dragResponse = p1.waitForResponse(
        (r) => r.url().endsWith('/tables/reorder') && r.request().method() === 'POST',
      );
      await p1
        .getByRole('button', { name: '拖动排序员工自主创建', exact: true })
        .dragTo(
          p1
            .locator('.workspace-table-item')
            .filter({ has: p1.getByRole('button', { name: '协作表', exact: true }) }),
        );
      assert.equal((await dragResponse).status(), 200);
      await p1.reload();
      await p1.getByRole('button', { name: '标题：粘贴第二行', exact: true }).waitFor();

      // Offline drafts survive; ready reloads the current state changed by another member.
      await p1.getByRole('button', { name: '标题：粘贴第二行', exact: true }).dblclick();
      await p1.getByRole('textbox', { name: '标题', exact: true }).fill('断网保留后提交');
      await a.setOffline(true);
      await p1.getByText('网络已断开，未提交草稿已保留', { exact: true }).waitFor();
      await p2.getByRole('button', { name: '标题：对端先提交', exact: true }).dblclick();
      await p2.getByRole('textbox', { name: '标题', exact: true }).fill('离线期间对端修改');
      await p2
        .locator('.workspace-cell-editor')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      const recoveredQuery = p1.waitForResponse(
        (r) => r.url().endsWith('/records/query') && r.status() === 200,
      );
      await a.setOffline(false);
      await recoveredQuery;
      assert.equal(
        await p1.getByRole('textbox', { name: '标题', exact: true }).inputValue(),
        '断网保留后提交',
      );
      await p1
        .locator('.workspace-cell-editor')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p2.getByRole('button', { name: '标题：断网保留后提交', exact: true }).waitFor({ timeout: 10000 });
      await p1
        .getByRole('button', { name: '标题：离线期间对端修改', exact: true })
        .waitFor({ timeout: 10000 });

      // Drop the response AFTER commit, then prove retry reuses the key and writes once.
      const customTableId = new URL(p1.url()).searchParams.get('table')!;
      const customTitle = await db.collabField.findFirstOrThrow({
        where: { tableId: customTableId, name: '标题' },
      });
      const beforeRetry = await db.collabRecord.findFirstOrThrow({
        where: { tableId: customTableId, values: { path: [customTitle.id], equals: '断网保留后提交' } },
      });
      const pasteCell = p1.getByRole('button', { name: '标题：断网保留后提交', exact: true });
      await pasteCell.focus();
      await pasteCell.evaluate((element) => {
        const data = new DataTransfer();
        data.setData('text/plain', '响应丢失仅写一次');
        element.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      });
      await p1.getByRole('textbox', { name: '粘贴表格内容', exact: true }).waitFor();
      let lostKey = '';
      const lostResponse = async (route) => {
        lostKey = route.request().headers()['idempotency-key'];
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort('failed');
      };
      await p1.route('**/records/batch', lostResponse);
      await p1.getByRole('button', { name: '提交 1 行', exact: true }).click();
      await p1.waitForFunction(() => !!document.querySelector('.ant-modal .ant-alert-error'));
      assert.equal(
        await p1.getByRole('textbox', { name: '粘贴表格内容', exact: true }).inputValue(),
        '响应丢失仅写一次',
      );
      await p1.unroute('**/records/batch', lostResponse);
      const retried = p1.waitForRequest((r) => r.url().endsWith('/records/batch'));
      await p1.getByRole('button', { name: '提交 1 行', exact: true }).click();
      assert.equal((await retried).headers()['idempotency-key'], lostKey);
      await p2
        .getByRole('button', { name: '标题：响应丢失仅写一次', exact: true })
        .waitFor({ timeout: 10000 });
      assert.equal(
        (await db.collabRecord.findUniqueOrThrow({ where: { id: beforeRetry.id } })).version,
        beforeRetry.version + 1,
      );
      await p1.locator('.ant-modal:visible').waitFor({ state: 'hidden' });
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
      // A real 10k x 50 dataset is fetched by page and rendered through the virtual grid.
      await p1.setViewportSize({ width: 1440, height: 1000 });
      const large = await db.collabTable.create({ data: { baseId, name: '万行表格验收', createdBy: owner } });
      const largeFields = Array.from({ length: 50 }, () => randomUUID());
      await db.collabField.createMany({
        data: largeFields.map((id, position) => ({
          id,
          tableId: large.id,
          name: '大表字段' + position,
          type: 'TEXT',
          position,
        })),
      });
      await db.collabView.create({
        data: { tableId: large.id, name: '总表', shared: true, isDefault: true, ownerId: owner },
      });
      for (let offset = 0; offset < 10000; offset += 250) {
        await db.collabRecord.createMany({
          data: Array.from({ length: 250 }, (_, n) => ({
            id: 'browser-large-' + (offset + n),
            tableId: large.id,
            ownerId: owner,
            createdBy: owner,
            updatedBy: owner,
            createdAt: new Date(Date.UTC(2025, 0, 1) + (offset + n) * 1000),
            values: Object.fromEntries(largeFields.map((id, f) => [id, '行' + (offset + n) + '列' + f])),
          })),
        });
      }
      const largeResponse = p1.waitForResponse((r) =>
        r.url().includes('/tables/' + large.id + '/records/query'),
      );
      await p1.goto(address.replace('table=' + tableId, 'table=' + large.id));
      const firstPage = (await (await largeResponse).json()).data;
      assert.equal(firstPage.total, 10000);
      assert.equal(firstPage.records.length, 50);
      await p1.getByRole('button', { name: '大表字段0：行0列0', exact: true }).waitFor();
      const rendered = await p1.locator('.ant-table-row').count();
      assert.ok(rendered > 0 && rendered < 50, 'virtual grid must mount only visible rows');
      await p1.locator('.ant-pagination-next button').click();
      await p1.getByRole('button', { name: '大表字段0：行50列0', exact: true }).waitFor();
      await p1.screenshot({ path: path.join(evidence, 'large-grid.png'), fullPage: true });
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

test(
  'cloud drive uses one UI for three roles, preserves editor identity and clears ancestor revocation',
  { skip: process.env.COLLAB_BROWSER_REHEARSAL !== 'true', timeout: 240000 },
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
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.COLLAB_BROWSER_CHANNEL || undefined,
    });
    const errors: string[] = [];
    const api = (method: 'get' | 'post' | 'patch', route: string, bearer = token, body?: unknown) => {
      const request = app.httpRequest();
      const call = request[method]('/api/v1' + route)
        .set('Authorization', 'Bearer ' + bearer)
        .set('Idempotency-Key', randomUUID());
      return body === undefined ? call : call.send(body);
    };
    try {
      const manager = await db.user.create({
        data: { username: 'drive-manager', password: 'unused', mustChangePassword: false },
      });
      const managerToken = (await createApiSession(db, manager.id)).token;
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL', canCreate: true },
      });
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      const pages = [];
      for (const [id, accessToken] of [
        [owner, token],
        [editor, editorToken],
        [manager.id, managerToken],
      ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [p1, p2, p3] = pages;
      const address = vite.resolvedUrls.local[0] + 'e2e/workspace.html?workspace=' + workspaceId;
      await Promise.all(pages.map((page) => page.goto(address)));
      for (const page of pages) await page.getByRole('heading', { name: '云盘', exact: true }).waitFor();
      assert.equal(await p2.getByRole('button', { name: '新建', exact: true }).isDisabled(), true);
      await p1.getByRole('button', { name: '新建', exact: true }).click();
      await p1.getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
      await p1.getByRole('textbox', { name: '名称', exact: true }).fill('团队资料');
      await p1
        .locator('.ant-modal')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p1.getByRole('button', { name: /团队资料 文件夹/ }).waitFor();
      assert.equal(await p2.getByRole('button', { name: /团队资料 文件夹/ }).count(), 0);
      const folder = await db.driveNode.findFirstOrThrow({ where: { workspaceId, folderName: '团队资料' } });
      // A resource is private at creation; the owner shares it using the actual permission panel.
      await api('get', '/drive/folders/' + folder.id + '/access', editorToken).expect(403);
      await p1.getByRole('button', { name: '团队资料操作', exact: true }).click();
      await p1.getByRole('menuitem', { name: '分享与权限', exact: true }).click();
      await p1.getByRole('button', { name: '文件夹权限', exact: true }).click();
      await p1.getByRole('checkbox', { name: '启用独立授权名单', exact: true }).uncheck();
      let dropped = false;
      const shareKeys: string[] = [];
      const shareRoute = '**/api/v1/drive/folders/' + folder.id + '/access';
      await p1.route(
        shareRoute,
        async (route: {
          request: () => { method: () => string; headers: () => Record<string, string> };
          fetch: () => Promise<{ status: () => number }>;
          fulfill: (value: unknown) => Promise<void>;
          continue: () => Promise<void>;
        }) => {
          if (route.request().method() === 'POST') {
            shareKeys.push(route.request().headers()['idempotency-key']);
            if (!dropped) {
              dropped = true;
              const real = await route.fetch();
              assert.equal(real.status(), 200);
              await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: '{"message":"response_lost"}',
              });
              return;
            }
          }
          await route.continue();
        },
      );
      await p1.getByRole('button', { name: '保存权限', exact: true }).click();
      await p1.locator('.ant-modal').getByText('请求未完成，请检查连接后重试。', { exact: true }).waitFor();
      await p1.screenshot({
        path: path.resolve(process.cwd(), '../../var/collaboration-evidence/g1-retry-dialog.png'),
      });
      await p1.getByRole('button', { name: '保存权限', exact: true }).click();
      await p1.getByRole('button', { name: '保存权限', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(shareKeys.length, 2);
      assert.ok(shareKeys[0] && shareKeys[0] === shareKeys[1]);
      assert.equal(
        await db.operationLog.count({ where: { action: 'drive.folder.access', targetId: folder.id } }),
        1,
      );
      await p1.unroute(shareRoute);
      await Promise.all(
        [p2, p3].map((p) => p.getByRole('button', { name: /团队资料 文件夹/ }).waitFor({ timeout: 5000 })),
      );
      await p1.getByRole('button', { name: '我的资源', exact: true }).click();
      await p1.getByRole('button', { name: /团队资料 文件夹/ }).click();
      await p1.getByRole('button', { name: '卡片布局', exact: true }).click();
      await p1.getByRole('button', { name: '新建', exact: true }).click();
      await p1.getByRole('menuitem', { name: '新建多维表格', exact: true }).click();
      await p1.getByRole('textbox', { name: '名称', exact: true }).fill('共享项目');
      await p1
        .locator('.ant-modal')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p1.getByRole('button', { name: '添加记录', exact: true }).waitFor();
      const newBase = new URL(p1.url()).searchParams.get('base')!;
      const newTable = new URL(p1.url()).searchParams.get('table')!;
      const title = await db.collabField.findFirstOrThrow({ where: { tableId: newTable } });
      await api('post', '/tables/' + newTable + '/records', token, {
        values: { [title.id]: '负责人记录' },
        schemaVersion: 1,
      }).expect(200);
      await api('post', '/tables/' + newTable + '/records', editorToken, {
        values: { [title.id]: '本人记录' },
        schemaVersion: 1,
      }).expect(200);
      await p1.getByRole('button', { name: '承业 · 云盘', exact: true }).click();
      assert.equal(new URL(p1.url()).searchParams.get('folder'), folder.id);
      await p1.getByRole('button', { name: '卡片布局', exact: true }).waitFor();
      assert.equal(
        await p1.getByRole('button', { name: '卡片布局', exact: true }).getAttribute('aria-pressed'),
        'true',
      );
      for (const page of [p2, p3]) {
        await page.getByRole('button', { name: '与我共享', exact: true }).click();
        await page.getByRole('button', { name: /团队资料 文件夹/ }).click();
        await page.getByRole('button', { name: /共享项目 多维表格/ }).click();
        await page.waitForURL((url: URL) => url.searchParams.get('base') === newBase);
        assert.equal(new URL(page.url()).searchParams.get('base'), newBase);
      }
      await p2.getByRole('button', { name: '标题：本人记录', exact: true }).waitFor();
      assert.equal(await p2.getByRole('button', { name: '标题：负责人记录', exact: true }).count(), 0);
      await p3.getByRole('button', { name: '标题：负责人记录', exact: true }).waitFor();
      await p3.getByRole('button', { name: '标题：本人记录', exact: true }).waitFor();
      await p1.getByRole('button', { name: '共享项目操作', exact: true }).click();
      await p1.getByRole('menuitem', { name: '重命名', exact: true }).click();
      await p1.getByRole('textbox', { name: '名称', exact: true }).fill('共享项目改名');
      await p1
        .locator('.ant-modal')
        .getByRole('button', { name: /^保\s*存$/ })
        .click();
      await p3
        .locator('.workspace-top')
        .getByText('共享项目改名', { exact: true })
        .waitFor({ timeout: 5000 });
      await p2.getByRole('button', { name: '承业 · 云盘', exact: true }).click();
      await p2.getByRole('button', { name: '共享项目改名操作', exact: true }).click();
      await p2.getByRole('menuitem', { name: '分享与权限', exact: true }).click();
      await p2.locator('.ant-drawer').getByText('仅可查看本人录入的记录。', { exact: true }).waitFor();
      assert.equal(await p2.getByRole('button', { name: '应用权限', exact: true }).count(), 0);
      const revokedAt = Date.now();
      await api('post', '/drive/folders/' + folder.id + '/access', token, {
        version: 2,
        policy: { restricted: true, grants: [] },
      }).expect(200);
      await Promise.all([
        p2.getByRole('button', { name: /共享项目改名 多维表格/ }).waitFor({ state: 'hidden', timeout: 5000 }),
        p3
          .getByRole('button', { name: '标题：负责人记录', exact: true })
          .waitFor({ state: 'hidden', timeout: 5000 }),
      ]);
      assert.ok(Date.now() - revokedAt < 5000);
      await p2
        .locator('.ant-drawer-body')
        .getByRole('heading', { name: '共享项目改名', exact: true })
        .waitFor({ state: 'hidden', timeout: 5000 });
      assert.equal(await p3.locator('.workspace-top').getByText('共享项目改名', { exact: true }).count(), 0);
      for (const route of ['/drive/nodes/' + newBase, '/bases/' + newBase + '/tables', '/tables/' + newTable])
        await api('get', route, editorToken).expect(403);
      await api('post', '/tables/' + newTable + '/records/query', editorToken, {}).expect(403);
      await api('post', '/tables/' + newTable + '/records', editorToken, {
        values: { [title.id]: '越权' },
        schemaVersion: 1,
      }).expect(403);
      const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence');
      await mkdir(evidence, { recursive: true });
      for (const width of [1440, 1024, 390]) {
        await p1.setViewportSize({ width, height: 900 });
        if (width === 390) {
          await p1.getByRole('button', { name: '目录', exact: true }).click();
          await p1.locator('.ant-drawer-title').getByText('资源目录', { exact: true }).waitFor();
          await p1.locator('.ant-drawer-close').click();
          await p1
            .locator('.ant-drawer-body')
            .getByRole('searchbox', { name: '搜索资源', exact: true })
            .waitFor({ state: 'hidden' });
        }
        const overflow = await p1.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        assert.equal(overflow, false, 'cloud drive overflow at ' + width);
        await p1.screenshot({ path: path.join(evidence, 'drive-' + width + '.png'), fullPage: true });
      }
      // A temporary failure offers an explicit retry and never leaves a stale listing visible.
      await p1.route(
        '**/api/v1/workspaces/*/drive?*',
        (route: { fulfill: (value: unknown) => Promise<void> }) =>
          route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' }),
      );
      await p1.getByRole('button', { name: '重试', exact: true }).waitFor({ timeout: 5000 });
      await p1.unroute('**/api/v1/workspaces/*/drive?*');
      await p1.getByRole('button', { name: '重试', exact: true }).click();
      await p1.getByRole('button', { name: /共享项目改名 多维表格/ }).waitFor();
      await p1.setViewportSize({ width: 1440, height: 1000 });
      await p1.getByRole('searchbox', { name: '搜索资源', exact: true }).fill('无匹配资源');
      await p1.getByRole('searchbox', { name: '搜索资源', exact: true }).press('Enter');
      await p1.getByText('暂无可访问的资源', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);
