import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { decodeBase32 } from '../../app/domain/security/base32';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
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
  for (const route of [
    '/workspaces/' + workspaceId + '/drive/shortcuts',
    '/workspaces/' + workspaceId + '/drive/recent/clear',
    '/workspaces/' + workspaceId + '/drive/shortcuts/unknown/remove',
    '/drive/nodes/' + baseId + '/visit',
  ])
    await app
      .httpRequest()
      .post('/api/v1' + route)
      .send({})
      .expect(401);
  await app.httpRequest().get('/api/v1/drive/shortcuts/unknown').expect(401);
  for (const suffix of ['/lifecycle', '/lifecycle/preview'])
    await app
      .httpRequest()
      .post('/api/v1/drive/nodes/' + baseId + suffix)
      .send({ action: 'TRASH' })
      .expect(401);
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

test(
  'drive lifecycle UI previews stale rules, retries committed moves and revokes owner/editor on trash before restoration',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
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
      const source = (
        await api('post', '/workspaces/' + workspaceId + '/drive/folders', token, {
          name: '协作目录',
        }).expect(200)
      ).body.data.id;
      const target = (
        await api('post', '/workspaces/' + workspaceId + '/drive/folders', token, {
          name: '私有目标',
        }).expect(200)
      ).body.data.id;
      await api('post', '/drive/folders/' + source + '/access', token, {
        version: 1,
        policy: { restricted: false, grants: [] },
      }).expect(200);
      const resource = (
        await api('post', '/workspaces/' + workspaceId + '/drive/bases', token, {
          name: '可恢复表格',
          parentId: source,
        }).expect(200)
      ).body.data;
      const title = (await db.collabField.findFirstOrThrow({ where: { tableId: resource.tableId } })).id;
      const record = (
        await api('post', '/tables/' + resource.tableId + '/records', editorToken, {
          schemaVersion: 1,
          values: { [title]: '多人共同保留的数据' },
        }).expect(200)
      ).body.data.id;
      const pages = [];
      for (const [id, accessToken] of [
        [owner, token],
        [editor, editorToken],
        [owner, token],
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
            user: { id, username: id, name: '生命周期测试成员', roles: [], permissions: [] },
          },
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [p1, p2, p3] = pages;
      const address = vite.resolvedUrls.local[0] + 'e2e/workspace.html?workspace=' + workspaceId;
      const editorAddress =
        vite.resolvedUrls.local[0] + 'e2e/workspace.html?base=' + resource.id + '&table=' + resource.tableId;
      await Promise.all([
        p1.goto(address + '&folder=' + source),
        p2.goto(editorAddress),
        p3.goto(editorAddress),
      ]);
      for (const page of [p2, p3])
        await page.getByRole('button', { name: '标题：多人共同保留的数据', exact: true }).waitFor();
      await p1.getByRole('button', { name: '可恢复表格操作', exact: true }).click();
      await p1.getByRole('menuitem', { name: '移动资源', exact: true }).click();
      assert.equal(await p1.getByRole('button', { name: '确认移动资源', exact: true }).isDisabled(), true);
      await p1.getByRole('combobox', { name: '移动到', exact: true }).click();
      await p1.locator('.ant-select-item-option-content').getByText('私有目标', { exact: true }).click();
      await p1.getByRole('button', { name: '预览权限影响', exact: true }).click();
      await p1.getByRole('region', { name: '权限影响预览', exact: true }).waitFor();
      await p1.getByText('以下比较授权规则，不代表受影响人数', { exact: true }).waitFor();
      const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence');
      await mkdir(evidence, { recursive: true });
      for (const width of [1440, 1024, 390]) {
        await p1.setViewportSize({ width, height: 900 });
        assert.equal(
          await p1.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
          false,
          'preview overflow at ' + width,
        );
        await p1.screenshot({ path: path.join(evidence, 'g2-preview-' + width + '.png'), fullPage: true });
      }
      await p1.setViewportSize({ width: 1440, height: 1000 });
      // Source remains manageable, but the private destination becomes inaccessible.
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: owner },
        data: { role: 'MANAGER', canManageAccess: true, rowScope: 'ALL' },
      });
      await api('get', '/drive/nodes/' + resource.id).expect(200);
      await p1
        .getByRole('region', { name: '权限影响预览', exact: true })
        .waitFor({ state: 'hidden', timeout: 5000 });
      await p1.getByRole('button', { name: '确认移动资源', exact: true }).waitFor({ state: 'hidden' });
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: owner },
        data: { role: 'OWNER' },
      });
      await p1.goto(address + '&folder=' + source);
      await p1.getByRole('button', { name: '可恢复表格操作', exact: true }).click();
      await p1.getByRole('menuitem', { name: '移动资源', exact: true }).click();
      await p1.getByRole('combobox', { name: '移动到', exact: true }).click();
      await p1.locator('.ant-select-item-option-content').getByText('私有目标', { exact: true }).click();
      await p1.getByRole('button', { name: '预览权限影响', exact: true }).click();
      await p1.getByRole('region', { name: '权限影响预览', exact: true }).waitFor();
      const sourceVersion = (await api('get', '/drive/nodes/' + source).expect(200)).body.data.version;
      await api('patch', '/drive/nodes/' + source, token, {
        name: '协作目录改名',
        version: sourceVersion,
      }).expect(200);
      await p1.getByRole('button', { name: '确认移动资源', exact: true }).click();
      await p1.getByText('目录或授权规则已变化，请重新预览后确认。', { exact: true }).waitFor();
      assert.equal(await p1.getByRole('button', { name: '确认移动资源', exact: true }).isDisabled(), true);
      await p1.getByRole('button', { name: '预览权限影响', exact: true }).click();
      await p1.getByRole('region', { name: '权限影响预览', exact: true }).waitFor();
      const moveKeys: string[] = [];
      const moveRoute = '**/api/v1/drive/nodes/' + resource.id + '/lifecycle';
      await p1.route(
        moveRoute,
        async (route: {
          request: () => { headers: () => Record<string, string> };
          fetch: () => Promise<{ status: () => number }>;
          fulfill: (value: unknown) => Promise<void>;
          continue: () => Promise<void>;
        }) => {
          moveKeys.push(route.request().headers()['idempotency-key']);
          if (moveKeys.length === 1) {
            assert.equal((await route.fetch()).status(), 200);
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: '{"message":"response_lost"}',
            });
          } else await route.continue();
        },
      );
      let revokedAt = Date.now();
      await p1.getByRole('button', { name: '确认移动资源', exact: true }).click();
      await p1.getByText('请求未完成，请检查连接后重试。', { exact: true }).waitFor();
      await p1.getByRole('button', { name: '确认移动资源', exact: true }).click();
      await p1.getByRole('button', { name: '确认移动资源', exact: true }).waitFor({ state: 'hidden' });
      await p2
        .getByRole('button', { name: '标题：多人共同保留的数据', exact: true })
        .waitFor({ state: 'hidden', timeout: 5000 });
      assert.ok(Date.now() - revokedAt < 5000);
      assert.equal(moveKeys.length, 2);
      assert.equal((await api('get', '/drive/nodes/' + resource.id).expect(200)).body.data.parentId, target);
      assert.ok(moveKeys[0] && moveKeys[0] === moveKeys[1]);
      assert.equal(
        await db.operationLog.count({ where: { targetId: resource.id, action: 'drive.move' } }),
        1,
      );
      await p1.unroute(moveRoute);
      const moveBack = { action: 'MOVE', parentId: source };
      const reviewed = (
        await api('post', '/drive/nodes/' + resource.id + '/lifecycle/preview', token, moveBack).expect(200)
      ).body.data;
      await api('post', '/drive/nodes/' + resource.id + '/lifecycle', token, {
        ...moveBack,
        previewToken: reviewed.previewToken,
      }).expect(200);
      await p2.goto(editorAddress);
      await p2.getByRole('button', { name: '标题：多人共同保留的数据', exact: true }).waitFor();
      await p1.goto(address);
      await p1.getByRole('button', { name: '协作目录改名操作', exact: true }).click();
      await p1.getByRole('menuitem', { name: '移入回收站', exact: true }).click();
      await p1.getByRole('button', { name: '预览权限影响', exact: true }).click();
      await p1.getByRole('region', { name: '权限影响预览', exact: true }).waitFor();
      revokedAt = Date.now();
      await p1.getByRole('button', { name: '确认移入回收站', exact: true }).click();
      await Promise.all(
        [p2, p3].map((page) =>
          page
            .getByRole('button', { name: '标题：多人共同保留的数据', exact: true })
            .waitFor({ state: 'hidden', timeout: 5000 }),
        ),
      );
      assert.ok(Date.now() - revokedAt < 5000);
      for (const accessToken of [token, editorToken]) {
        await api('get', '/tables/' + resource.tableId + '/records/' + record, accessToken).expect(403);
        await api('post', '/tables/' + resource.tableId + '/records/query', accessToken, {}).expect(403);
      }
      await p1.getByRole('button', { name: '确认移入回收站', exact: true }).waitFor({ state: 'hidden' });
      await p1.getByRole('button', { name: '回收站', exact: true }).click();
      await p1.getByRole('button', { name: '协作目录改名操作', exact: true }).waitFor();
      for (const width of [1440, 1024, 390]) {
        await p1.setViewportSize({ width, height: 900 });
        assert.equal(
          await p1.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
          false,
          'trash overflow at ' + width,
        );
        await p1.screenshot({ path: path.join(evidence, 'g2-trash-' + width + '.png'), fullPage: true });
      }
      await p1.setViewportSize({ width: 1440, height: 1000 });
      await api('post', '/workspaces/' + workspaceId + '/drive/folders', token, {
        name: '协作目录改名',
      }).expect(200);
      await p1.getByRole('button', { name: '协作目录改名操作', exact: true }).click();
      await p1.getByRole('menuitem', { name: '恢复资源', exact: true }).click();
      await p1.getByRole('button', { name: '预览权限影响', exact: true }).click();
      await p1.getByText('名称已存在，请换一个名称。', { exact: true }).waitFor();
      await p1.getByRole('textbox', { name: '恢复名称', exact: true }).fill('恢复后的协作目录');
      await p1.getByRole('button', { name: '预览权限影响', exact: true }).click();
      await p1.getByRole('region', { name: '权限影响预览', exact: true }).waitFor();
      await p1.getByRole('button', { name: '确认恢复资源', exact: true }).click();
      await p1.getByRole('button', { name: '确认恢复资源', exact: true }).waitFor({ state: 'hidden' });
      for (const page of [p2, p3]) {
        await page.goto(editorAddress);
        await page.getByRole('button', { name: '标题：多人共同保留的数据', exact: true }).waitFor();
      }
      assert.equal((await api('get', '/drive/nodes/' + resource.id).expect(200)).body.data.parentId, source);
      assert.equal(await db.collabRecord.count({ where: { tableId: resource.tableId } }), 1);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
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
      // More business sources make the options virtual; navigate until the requested option is rendered.
      for (
        let step = 0;
        step < 20 && !(await p1.getByText('现有 CRM · 线索表（负责人配置）', { exact: true }).count());
        step++
      )
        await p1.getByRole('combobox', { name: '创建方式', exact: true }).press('ArrowUp');
      await p1.getByText('现有 CRM · 线索表（负责人配置）', { exact: true }).click();
      await p1
        .locator('.ant-modal')
        .getByRole('button', { name: /确\s*定/ })
        .click();
      await p1.getByText('真实业务来源演练', { exact: true }).waitFor();
      assert.equal(await p1.getByRole('button', { name: '新建线索', exact: true }).isDisabled(), true);
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
      await p2.getByRole('button', { name: '业务状态：已筛选', exact: true }).waitFor({ timeout: 10000 });
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
      const [retried] = await Promise.all([
        p1.waitForRequest((r) => r.url().endsWith('/records/batch'), { timeout: 20000 }),
        p1.getByRole('button', { name: '提交 1 行', exact: true }).click({ timeout: 10000 }),
      ]);
      assert.equal(retried.headers()['idempotency-key'], lostKey);
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
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

test(
  'shortcut and recent UI share canonical data, isolate personal entries and clear revoked targets',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
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
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      const source = (
        await api('post', '/workspaces/' + workspaceId + '/drive/folders', token, {
          name: '数据来源',
        }).expect(200)
      ).body.data.id;
      const destination = (
        await api('post', '/workspaces/' + workspaceId + '/drive/folders', token, {
          name: '团队入口',
        }).expect(200)
      ).body.data.id;
      for (const id of [source, destination])
        await api('post', '/drive/folders/' + id + '/access', token, {
          version: 1,
          policy: { restricted: false, grants: [] },
        }).expect(200);
      const resource = (
        await api('post', '/workspaces/' + workspaceId + '/drive/bases', token, {
          name: '同一业务表格',
          parentId: source,
        }).expect(200)
      ).body.data;
      const title = (await db.collabField.findFirstOrThrow({ where: { tableId: resource.tableId } })).id;
      const own = (
        await api('post', '/tables/' + resource.tableId + '/records', editorToken, {
          schemaVersion: 1,
          values: { [title]: '员工本人记录' },
        }).expect(200)
      ).body.data.id;
      await api('post', '/tables/' + resource.tableId + '/records', token, {
        schemaVersion: 1,
        values: { [title]: '负责人记录' },
      }).expect(200);
      const pages = [];
      for (const [id, accessToken] of [
        [owner, token],
        [editor, editorToken],
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
            user: { id, username: id, name: '导航测试成员', roles: [], permissions: [] },
          },
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [p1, p2] = pages;
      const address = vite.resolvedUrls.local[0] + 'e2e/workspace.html?workspace=' + workspaceId;
      await Promise.all(pages.map((page) => page.goto(address + '&folder=' + source)));
      await p1.getByRole('button', { name: '同一业务表格操作', exact: true }).click();
      await p1.getByRole('menuitem', { name: '添加快捷方式', exact: true }).click();
      await p1.getByRole('combobox', { name: '存放位置', exact: true }).click();
      await p1.locator('.ant-select-item-option-content').getByText('团队入口', { exact: true }).click();
      // Wait for the portaled menu to finish closing before changing viewport coordinates.
      await p1.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' });
      const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence');
      await mkdir(evidence, { recursive: true });
      for (const width of [1440, 1024, 390]) {
        await p1.setViewportSize({ width, height: 900 });
        assert.equal(
          await p1.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
          false,
          'shortcut dialog overflow at ' + width,
        );
        await p1.screenshot({ path: path.join(evidence, 'g2b-add-' + width + '.png'), fullPage: true });
      }
      await p1.setViewportSize({ width: 1440, height: 1000 });
      const createKeys: string[] = [],
        creationRoute = '**/api/v1/workspaces/' + workspaceId + '/drive/shortcuts';
      await p1.route(
        creationRoute,
        async (route: {
          request: () => { headers: () => Record<string, string> };
          fetch: () => Promise<{ status: () => number }>;
          fulfill: (value: unknown) => Promise<void>;
          continue: () => Promise<void>;
        }) => {
          createKeys.push(route.request().headers()['idempotency-key']);
          if (createKeys.length === 1) {
            assert.equal((await route.fetch()).status(), 200);
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: '{"message":"response_lost"}',
            });
          } else await route.continue();
        },
      );
      await p1.locator('.ant-modal').getByRole('button', { name: '添加快捷方式', exact: true }).click();
      await p1.locator('.ant-modal').getByText('请求未完成，请检查连接后重试。', { exact: true }).waitFor();
      await p1.locator('.ant-modal').getByRole('button', { name: '添加快捷方式', exact: true }).click();
      await p1.getByRole('combobox', { name: '原资源', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(createKeys.length, 2);
      assert.ok(createKeys[0] && createKeys[0] === createKeys[1]);
      await p1.unroute(creationRoute);
      const shared = await db.driveShortcut.findFirstOrThrow({
        where: { targetId: resource.id, parentId: destination },
      });
      assert.equal(
        await db.operationLog.count({ where: { action: 'drive.shortcut.created', targetId: shared.id } }),
        1,
      );
      await p2.goto(address + '&folder=' + destination + '&layout=cards');
      await p2.locator('[data-resource-id="' + shared.id + '"] .drive-resource-open').click();
      await p2.getByRole('button', { name: '标题：员工本人记录', exact: true }).waitFor();
      assert.equal(new URL(p2.url()).searchParams.get('base'), resource.id);
      assert.equal(await p2.getByRole('button', { name: '标题：负责人记录', exact: true }).count(), 0);
      const visitBeforeRefresh = await db.driveVisit.findUniqueOrThrow({
        where: { userId_nodeId: { userId: editor, nodeId: resource.id } },
      });
      await api('patch', '/drive/nodes/' + resource.id, token, { version: 1, name: '表格当前名称' }).expect(
        200,
      );
      await p2
        .locator('.workspace-top')
        .getByText('表格当前名称', { exact: true })
        .waitFor({ timeout: 5000 });
      assert.deepEqual(
        await db.driveVisit.findUnique({ where: { userId_nodeId: { userId: editor, nodeId: resource.id } } }),
        visitBeforeRefresh,
        'SSE refresh must not register another visit',
      );
      await p2.getByRole('button', { name: '承业 · 云盘', exact: true }).click();
      assert.equal(new URL(p2.url()).searchParams.get('folder'), destination);
      assert.equal(new URL(p2.url()).searchParams.get('layout'), 'cards');
      await p2.goto(address + '&folder=' + source);
      await p2.getByRole('button', { name: '表格当前名称操作', exact: true }).click();
      await p2.getByRole('menuitem', { name: '添加快捷方式', exact: true }).click();
      await p2.locator('.ant-modal').getByRole('button', { name: '添加快捷方式', exact: true }).click();
      await p2.getByRole('combobox', { name: '原资源', exact: true }).waitFor({ state: 'hidden' });
      const personal = await db.driveShortcut.findFirstOrThrow({
        where: { targetId: resource.id, parentId: null, ownerId: editor },
      });
      await p2.getByRole('button', { name: '快捷方式', exact: true }).click();
      await p2.locator('[data-resource-id="' + personal.id + '"]').waitFor();
      await p1.getByRole('button', { name: '快捷方式', exact: true }).click();
      await p1.locator('[data-resource-id="' + shared.id + '"]').waitFor();
      assert.equal(await p1.locator('[data-resource-id="' + personal.id + '"]').count(), 0);
      await api('get', '/drive/shortcuts/' + personal.id, token).expect(403);
      await p2.locator('[data-resource-id="' + personal.id + '"] .drive-resource-open').click();
      await p2.getByRole('button', { name: '标题：员工本人记录', exact: true }).waitFor();
      assert.equal(new URL(p2.url()).searchParams.get('base'), resource.id);
      const detail = (
        await api('get', '/tables/' + resource.tableId + '/records/' + own, editorToken).expect(200)
      ).body.data;
      assert.equal(detail.record.id, own);
      await p2.getByRole('button', { name: '承业 · 云盘', exact: true }).click();
      assert.equal(new URL(p2.url()).searchParams.get('scope'), 'shortcuts');
      await p2.getByRole('button', { name: '最近访问', exact: true }).click();
      await p2.locator('[data-resource-id="' + resource.id + '"]').waitFor();
      assert.equal(await p2.locator('[data-resource-id="' + personal.id + '"]').count(), 0);
      assert.equal(await db.driveVisit.count({ where: { userId: editor, nodeId: resource.id } }), 1);
      assert.equal(await db.driveVisit.count({ where: { userId: owner, nodeId: resource.id } }), 0);
      for (const width of [1440, 1024, 390]) {
        await p2.setViewportSize({ width, height: 900 });
        assert.equal(
          await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
          false,
          'recent overflow at ' + width,
        );
        assert.equal(
          await p2.locator('.drive-date').first().isVisible(),
          true,
          'recent time visible at ' + width,
        );
        await p2.screenshot({ path: path.join(evidence, 'g2b-recent-' + width + '.png'), fullPage: true });
      }
      await p2.setViewportSize({ width: 1440, height: 1000 });
      await p2.getByRole('button', { name: '表格当前名称操作', exact: true }).click();
      await p2.getByRole('menuitem', { name: '添加快捷方式', exact: true }).click();
      const revokedAt = Date.now();
      await api('post', '/drive/folders/' + source + '/access', token, {
        version: 2,
        policy: { restricted: true, grants: [] },
      }).expect(200);
      await p2
        .locator('.ant-modal .ant-select-selection-item')
        .filter({ hasText: '表格当前名称' })
        .waitFor({ state: 'hidden', timeout: 5000 });
      await p2
        .locator('[data-resource-id="' + resource.id + '"]')
        .waitFor({ state: 'hidden', timeout: 5000 });
      assert.ok(Date.now() - revokedAt < 5000);
      await p2
        .locator('.ant-modal')
        .getByRole('button', { name: /^取\s*消$/ })
        .click();
      for (const id of [shared.id, personal.id])
        await api('get', '/drive/shortcuts/' + id, editorToken).expect(403);
      await p2.getByRole('button', { name: '快捷方式', exact: true }).click();
      await p2.getByText('暂无可访问的资源', { exact: true }).waitFor();
      await api('post', '/drive/folders/' + source + '/access', token, {
        version: 3,
        policy: { restricted: false, grants: [] },
      }).expect(200);
      await p2.locator('[data-resource-id="' + personal.id + '"]').waitFor({ timeout: 5000 });
      await api('post', '/drive/folders/' + destination + '/access', token, {
        version: 2,
        policy: { restricted: true, grants: [] },
      }).expect(200);
      await p2.locator('[data-resource-id="' + shared.id + '"]').waitFor({ state: 'hidden', timeout: 5000 });
      await p2
        .locator('[data-resource-id="' + personal.id + '"]')
        .getByRole('button', { name: '表格当前名称操作', exact: true })
        .click();
      await p2.getByRole('menuitem', { name: '移除快捷方式', exact: true }).click();
      await p2
        .locator('.ant-modal')
        .getByRole('button', { name: /^确\s*认$/ })
        .click();
      await p2.locator('[data-resource-id="' + personal.id + '"]').waitFor({ state: 'hidden' });
      assert.equal(
        (await api('post', '/tables/' + resource.tableId + '/records/query', editorToken, {}).expect(200))
          .body.data.total,
        1,
      );
      const ownerHistory = await db.driveVisit.count({ where: { userId: owner } });
      assert.ok(ownerHistory > 0);
      await p2.getByRole('button', { name: '最近访问', exact: true }).click();
      await p2.getByRole('button', { name: '清空最近访问', exact: true }).click();
      await p2
        .locator('.ant-modal')
        .getByRole('button', { name: /^确\s*认$/ })
        .click();
      await p2.getByText('暂无可访问的资源', { exact: true }).waitFor();
      assert.equal(await db.driveVisit.count({ where: { userId: editor } }), 0);
      assert.equal(await db.driveVisit.count({ where: { userId: owner } }), ownerHistory);
      assert.equal(await db.collabRecord.count({ where: { tableId: resource.tableId } }), 2);
      const directVisit = p2.waitForResponse(
        (response: { url: () => string; request: () => { method: () => string } }) =>
          response.url().endsWith('/drive/nodes/' + resource.id + '/visit') &&
          response.request().method() === 'POST',
      );
      await p2.goto(
        vite.resolvedUrls.local[0] + 'e2e/workspace.html?base=' + resource.id + '&table=' + resource.tableId,
      );
      assert.equal((await directVisit).status(), 200);
      await p2.getByRole('button', { name: '标题：员工本人记录', exact: true }).waitFor();
      assert.equal(await db.driveVisit.count({ where: { userId: editor, nodeId: resource.id } }), 1);
      const rootListing = p2.waitForResponse((response: { url: () => string }) =>
        response.url().includes('/drive?scope=all'),
      );
      await p2.goto(address);
      assert.equal((await rootListing).status(), 200);
      await p2.screenshot({ path: path.join(evidence, 'g2b-root-entry.png'), fullPage: true });
      assert.deepEqual(errors, []);
      await p2.getByRole('button', { name: '添加快捷方式', exact: true }).click();
      await p2.getByRole('searchbox', { name: '搜索快捷方式目标', exact: true }).fill('数据来源');
      await p2.getByRole('searchbox', { name: '搜索快捷方式目标', exact: true }).press('Enter');
      await p2.getByRole('combobox', { name: '原资源', exact: true }).click();
      await p2.locator('.ant-select-item-option-content').getByText('数据来源', { exact: true }).click();
      await p2.locator('.ant-modal').getByRole('button', { name: '添加快捷方式', exact: true }).click();
      await p2.getByRole('combobox', { name: '原资源', exact: true }).waitFor({ state: 'hidden' });
      const folderLink = await db.driveShortcut.findFirstOrThrow({
        where: { targetId: source, ownerId: editor, parentId: null, deletedAt: null },
      });
      await p2.getByRole('button', { name: '快捷方式', exact: true }).click();
      await p2.locator('[data-resource-id="' + folderLink.id + '"] .drive-resource-open').click();
      await p2.locator('[data-resource-id="' + resource.id + '"]').waitFor();
      assert.equal(new URL(p2.url()).searchParams.get('folder'), source);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'unified shell keeps real routes, three-role permissions, resource return and desktop tools across navigation',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'isolated-unified-session',
          transformIndexHtml: (html: string) => html.replace('/src/main.tsx', '/e2e/unified-harness.tsx'),
        },
      ],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin, changeOrigin: true } } },
    });
    await vite.listen();
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.COLLAB_BROWSER_CHANNEL || undefined,
    });
    const errors: string[] = [];
    try {
      const grant = async (userId: string, code: string, permissions: string[]) => {
        const role = await db.role.create({
          data: {
            name: code,
            code,
            type: code.startsWith('SYSTEM_') ? 'SYSTEM' : 'BUSINESS',
            permissions: {
              create: permissions.map((permission) => ({ permission: { connect: { code: permission } } })),
            },
          },
        });
        await db.userRole.create({
          data: { userId, roleId: role.id, validFrom: new Date(Date.now() - 1000) },
        });
        return role.id;
      };
      await grant(owner, 'SYSTEM_SUPER_ADMIN', [
        'menu.organization_personnel',
        'menu.organization',
        'organization.read',
        'menu.security_roles',
        'role.read',
        'menu.knowledge',
        'menu.smart_case',
      ]);
      const staffRole = await grant(editor, 'UNIFIED_STAFF', [
        'menu.lead_crm',
        'lead.read',
        'menu.knowledge',
        'menu.smart_case',
      ]);
      const manager = await db.user.create({
        data: { username: 'unified-manager', password: 'unused', mustChangePassword: false },
      });
      await grant(manager.id, 'UNIFIED_MANAGER', [
        'menu.lead_crm',
        'lead.read',
        'menu.customer',
        'customer.read',
      ]);
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL', canCreate: true },
      });
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      const adminToken = (await createApiSession(db, owner, 'MFA')).token;
      const managerToken = (await createApiSession(db, manager.id)).token;
      const api = (method: 'get' | 'post', route: string, bearer = adminToken, body?: unknown) => {
        const request = app.httpRequest();
        const call = request[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? call : call.send(body);
      };
      const folder = (
        await api('post', '/workspaces/' + workspaceId + '/drive/folders', adminToken, {
          name: '统一入口资料',
        }).expect(200)
      ).body.data.id;
      await api('post', '/drive/folders/' + folder + '/access', adminToken, {
        version: 1,
        policy: { restricted: false, grants: [] },
      }).expect(200);
      const base = (
        await api('post', '/workspaces/' + workspaceId + '/drive/bases', adminToken, {
          name: '统一入口测试表',
          parentId: folder,
        }).expect(200)
      ).body.data;
      const titleField = (await db.collabField.findFirstOrThrow({ where: { tableId: base.tableId } })).id;
      await api('post', '/tables/' + base.tableId + '/records', editorToken, {
        schemaVersion: 1,
        values: { [titleField]: '同一资源本人记录' },
      }).expect(200);
      const pages = [];
      for (const [id, accessToken] of [
        [owner, adminToken],
        [editor, editorToken],
        [manager.id, managerToken],
      ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        // Use source text so tsx function-name helpers cannot leak into the browser init script.
        await context.addInitScript(`
        window.unifiedTestSession = ${JSON.stringify({
          mode: 'AUTHENTICATED',
          token: accessToken,
          csrfToken: 'test',
          expiresIn: 900,
          user: { id, username: id, name: '框架验收成员', roles: [], permissions: [] },
        })};
        window.unifiedAssistantOpens = 0;
        window.chengyeDesktop = { version: 1, openAssistant: async function () { window.unifiedAssistantOpens++; } };
      `);
        const page = await context.newPage();
        page.on('pageerror', (error: Error) => errors.push(error.message));
        pages.push(page);
      }
      const [admin, staff, leader] = pages;
      const address = vite.resolvedUrls.local[0];
      await Promise.all(pages.map((page) => page.goto(address)));
      for (const page of pages) {
        await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
        assert.deepEqual(
          await page
            .getByRole('navigation', { name: '全局导航', exact: true })
            .getByRole('link')
            .allTextContents(),
          ['工作台', '云盘', '业务应用', '数据分析', '管理中心'],
        );
      }
      await admin
        .getByRole('navigation', { name: '全局导航', exact: true })
        .getByRole('link', { name: '管理中心', exact: true })
        .click();
      await admin.locator('.unified-app-card').filter({ hasText: '组织架构' }).waitFor();
      await staff
        .getByRole('navigation', { name: '全局导航', exact: true })
        .getByRole('link', { name: '管理中心', exact: true })
        .click();
      await staff.getByText('当前区域暂无已授权应用', { exact: true }).waitFor();
      await staff.goto(address + 'security/roles');
      await staff.getByText('无权访问此页面', { exact: true }).waitFor();
      await api('get', '/roles', editorToken).expect(403);
      await staff.locator('.unified-shell').evaluate((node: HTMLElement) => {
        node.dataset.persistenceCheck = 'same-shell';
      });
      const applicationsLink = staff
        .getByRole('navigation', { name: '全局导航', exact: true })
        .getByRole('link', { name: '业务应用', exact: true });
      await applicationsLink.focus();
      await applicationsLink.press('Enter');
      await staff.locator('.unified-app-card').filter({ hasText: '线索列表' }).click();
      await staff.getByRole('heading', { name: '线索工作表', exact: true }).waitFor();
      assert.equal(new URL(staff.url()).pathname, '/leads');
      await leader
        .getByRole('navigation', { name: '全局导航', exact: true })
        .getByRole('link', { name: '业务应用', exact: true })
        .click();
      await leader.locator('.unified-app-card').filter({ hasText: '客户管理' }).waitFor();
      const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence');
      await mkdir(evidence, { recursive: true });
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 900 });
        assert.equal(
          await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
          'unified business overflow ' + width,
        );
        await staff.screenshot({
          path: path.join(evidence, 'unified-business-' + width + '.png'),
          fullPage: true,
        });
      }
      await staff.getByRole('button', { name: '打开全局导航', exact: true }).click();
      await staff.getByRole('dialog').getByRole('link', { name: '云盘', exact: true }).click();
      await staff.getByRole('dialog').waitFor({ state: 'hidden' });
      await staff.setViewportSize({ width: 1440, height: 1000 });
      await staff.getByRole('heading', { name: '云盘', exact: true }).waitFor();
      assert.equal(await staff.locator('.unified-context').count(), 0);
      await staff.locator('[data-resource-id="' + folder + '"] .drive-resource-open').click();
      await staff.locator('[data-resource-id="' + base.id + '"] .drive-resource-open').click();
      await staff.getByRole('button', { name: '标题：同一资源本人记录', exact: true }).waitFor();
      assert.equal(new URL(staff.url()).searchParams.get('base'), base.id);
      assert.equal(
        await staff.locator('.unified-shell').getAttribute('data-persistence-check'),
        'same-shell',
      );
      assert.equal(await staff.getByRole('link', { name: '知识库', exact: true }).count(), 1);
      await staff.getByRole('button', { name: '智慧办案', exact: true }).click();
      await staff.waitForFunction(() => window.unifiedAssistantOpens === 1, undefined, { timeout: 5000 });
      assert.equal(await staff.evaluate(() => window.unifiedAssistantOpens), 1);
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 900 });
        assert.equal(
          await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
          'unified editor overflow ' + width,
        );
        await staff.screenshot({
          path: path.join(evidence, 'unified-editor-' + width + '.png'),
          fullPage: true,
        });
      }
      await staff.setViewportSize({ width: 1440, height: 1000 });
      await staff.getByRole('button', { name: '承业 · 云盘', exact: true }).click();
      await staff.locator('[data-resource-id="' + base.id + '"]').waitFor();
      assert.equal(new URL(staff.url()).searchParams.get('folder'), folder);
      await staff.getByRole('button', { name: '智慧办案', exact: true }).click();
      await staff.waitForFunction(() => window.unifiedAssistantOpens === 2, undefined, { timeout: 5000 });
      assert.equal(await staff.evaluate(() => window.unifiedAssistantOpens), 2);
      await staff.getByRole('button', { name: '展开全局导航', exact: true }).click();
      assert.equal(await staff.locator('.unified-expanded').count(), 1);
      await staff.getByRole('button', { name: '收起全局导航', exact: true }).click();
      await staff.getByRole('button', { name: '查找功能入口', exact: true }).click();
      await staff.getByRole('textbox', { name: '搜索功能入口', exact: true }).fill('角色');
      await staff.getByText('没有匹配的可用入口', { exact: true }).waitFor();
      await staff.keyboard.press('Escape');
      await admin.goto(address + 'roles?from=bookmark#detail');
      await admin.waitForURL('**/security/roles?from=bookmark#detail');
      await admin.locator('.unified-main .ant-table').waitFor();
      await staff.goto(address + 'inventory/not-a-page');
      await staff.getByText('页面不存在', { exact: true }).waitFor();
      await staff.goto(address + 'leads');
      await staff.getByRole('heading', { name: '线索工作表', exact: true }).waitFor();
      await db.rolePermission.deleteMany({ where: { roleId: staffRole, permission: { code: 'lead.read' } } });
      const revokedAt = Date.now();
      await staff.getByText('无权访问此页面', { exact: true }).waitFor({ timeout: 18000 });
      assert.ok(Date.now() - revokedAt < 18000);
      await api('get', '/leads', editorToken).expect(403);
      await staff.goto(address + 'apps');
      await staff.getByText('当前区域暂无已授权应用', { exact: true }).waitFor();
      assert.equal(await staff.locator('.unified-app-card').filter({ hasText: '渠道管理' }).count(), 0);
      assert.equal(await staff.locator('.unified-app-card').filter({ hasText: '线索列表' }).count(), 0);
      await staff.route(
        '**/api/v1/authorization/me',
        async (route: { fulfill: (value: unknown) => Promise<void> }) =>
          route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"message":"temporary_unavailable"}',
          }),
      );
      await staff.goto(address + 'apps');
      await staff.getByText('无法确认当前权限', { exact: true }).waitFor();
      await staff.unroute('**/api/v1/authorization/me');
      await staff.getByRole('button', { name: '重试授权', exact: true }).click();
      await staff.getByText('当前区域暂无已授权应用', { exact: true }).waitFor();
      assert.equal(await staff.locator('.unified-app-card').filter({ hasText: '渠道管理' }).count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'U4 real business routes share CRM truth, views, controlled actions and three-role permissions',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'u4-real-app',
          transformIndexHtml: (html: string) => html.replace('/src/main.tsx', '/e2e/unified-harness.tsx'),
        },
      ],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin, changeOrigin: true } } },
    });
    await vite.listen();
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.COLLAB_BROWSER_CHANNEL || undefined,
    });
    try {
      const manager = await db.user.create({
        data: { username: 'u4-browser-manager', password: 'unused', mustChangePassword: false },
      });
      const ids = [owner, editor, manager.id];
      for (const id of ids) {
        const employee = await db.employee.create({
          data: {
            name: id === editor ? '普通员工' : '负责人',
            employeeNo: randomUUID(),
            phone: '13800000000',
            type: 'SALES',
            status: 'FORMAL',
            entryDate: new Date('2025-01-01'),
          },
        });
        await db.user.update({ where: { id }, data: { employeeId: employee.id } });
        const role = await db.role.create({
          data: {
            name: 'U4 ' + id,
            code: 'U4_' + id,
            type: 'BUSINESS',
            permissions: {
              create: [
                'menu.lead_crm',
                'lead.read',
                'lead.create',
                'lead.update',
                'lead.assign',
                'lead.pool.claim',
                'lead.recycle',
              ].map((code) => ({ permission: { connect: { code } } })),
            },
          },
        });
        const scope = await db.dataScope.create({ data: { name: 'U4 CRM scope', scopeType: 'ALL' } });
        await db.roleDataScope.create({ data: { roleId: role.id, resource: 'lead', dataScopeId: scope.id } });
        await db.userRole.create({ data: { userId: id, roleId: role.id } });
      }
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL' },
      });
      const managerToken = (await createApiSession(db, manager.id)).token;
      const tokens = [token, editorToken, managerToken];
      const pages = [];
      for (let i = 0; i < ids.length; i++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          `window.unifiedTestSession = ${JSON.stringify({ mode: 'AUTHENTICATED', token: tokens[i], csrfToken: 'test', expiresIn: 900, user: { id: ids[i], username: ids[i], name: '业务验收成员', roles: [], permissions: [] } })};`,
        );
        pages.push(await context.newPage());
      }
      const [admin, staff, leader] = pages;
      const address = vite.resolvedUrls.local[0];
      const api = (method: 'get' | 'post', route: string, bearer = token, body?: unknown) => {
        const request = app.httpRequest();
        const call = request[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? call : call.send(body);
      };
      await api('get', '/collaboration/business-tables', 'invalid').expect(401);
      await admin.goto(address + 'leads');
      await admin.getByRole('button', { name: '连接业务数据', exact: true }).click();
      await admin.getByRole('combobox', { name: '连接到应用', exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('接口工作区 / 业务台账', { exact: true })
        .click();
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: /^连\s*接$/ })
        .click();
      await admin.getByRole('button', { name: '新建线索', exact: true }).waitFor();
      const businessTable = new URL(admin.url()).searchParams.get('table')!;
      await admin.goto(address + 'leads/follows');
      await admin.getByRole('button', { name: '连接业务数据', exact: true }).click();
      await admin.getByRole('combobox', { name: '连接到应用', exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('接口工作区 / 业务台账', { exact: true })
        .click();
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: /^连\s*接$/ })
        .click();
      await admin.getByRole('button', { name: '字段配置', exact: true }).waitFor();
      const followTable = new URL(admin.url()).searchParams.get('table')!;
      const other = (
        await api('post', '/tables/' + businessTable + '/business-records', token, {
          name: '负责人录入记录',
          phone: '13900008881',
        }).expect(200)
      ).body.data;
      await staff.goto(address + 'leads');
      await staff.locator('.unified-app-card').filter({ hasText: '线索工作表' }).click();
      await staff.getByRole('button', { name: '新建线索', exact: true }).click();
      await staff.getByRole('textbox', { name: '线索姓名', exact: true }).fill('统一业务线索');
      await staff.getByRole('textbox', { name: '线索联系电话', exact: true }).fill('13900008882');
      await staff.getByRole('dialog').getByRole('button', { name: '创建线索', exact: true }).click();
      await staff.getByRole('button', { name: '领取线索', exact: true }).waitFor();
      const lead = await db.lead.findFirstOrThrow({ where: { name: '统一业务线索' } });
      assert.equal(new URL(staff.url()).searchParams.get('record'), lead.id);
      assert.equal(lead.createdBy, editor);
      assert.equal(await db.collabRecord.count(), 0);
      await api('get', '/tables/' + businessTable + '/records/' + other.id, editorToken).expect(404);
      await api('post', '/tables/' + businessTable + '/records/' + other.id + '/business', editorToken, {
        action: 'CLAIM',
        version: 1,
      }).expect(404);
      await staff.getByRole('button', { name: '领取线索', exact: true }).click();
      await staff.getByRole('button', { name: '提交业务操作', exact: true }).click();
      await staff.getByRole('dialog', { name: '领取线索', exact: true }).waitFor({ state: 'hidden' });
      await staff.getByRole('button', { name: '新增跟进', exact: true }).click();
      await staff.getByRole('textbox', { name: '跟进内容', exact: true }).fill('统一工作区首次联系');
      await staff.getByRole('button', { name: '提交业务操作', exact: true }).click();
      await staff.getByText('统一工作区首次联系', { exact: true }).waitFor();
      await leader.goto(address + 'leads?base=' + baseId + '&table=' + businessTable + '&record=' + lead.id);
      await leader.getByText('统一工作区首次联系', { exact: true }).waitFor();
      assert.equal(
        (await api('post', '/tables/' + businessTable + '/records/query', managerToken, {}).expect(200)).body
          .data.total,
        2,
      );
      await staff.getByRole('button', { name: '打开线索业务详情', exact: true }).click();
      await staff.getByRole('link', { name: '在「线索工作表」中打开', exact: true }).click();
      await staff.getByRole('button', { name: '领取线索', exact: true }).waitFor();
      assert.equal(new URL(staff.url()).searchParams.get('record'), lead.id);
      // Close record before saving a personal view; the query string retains resource identity.
      await staff.locator('.ant-drawer-close').click();
      await staff.getByRole('button', { name: '创建个人视图', exact: true }).click();
      await staff.getByRole('tab', { name: '我负责的 · 个人', exact: true }).waitFor();
      const ownView = new URL(staff.url()).searchParams.get('view');
      await staff.reload();
      await staff.getByRole('tab', { name: '我负责的 · 个人', exact: true }).waitFor();
      assert.equal(new URL(staff.url()).searchParams.get('view'), ownView);
      assert.equal((await db.collabView.findUniqueOrThrow({ where: { id: ownView! } })).ownerId, editor);
      await staff.getByRole('button', { name: '在云盘中打开', exact: true }).click();
      await staff.getByRole('tab', { name: '我负责的 · 个人', exact: true }).waitFor();
      assert.equal(new URL(staff.url()).pathname, '/workspaces');
      assert.equal(new URL(staff.url()).searchParams.get('table'), businessTable);
      await staff.goto(address + 'leads/follows');
      await staff.locator('.unified-app-card').filter({ hasText: '跟进工作表' }).click();
      await staff.getByRole('button', { name: '跟进内容：统一工作区首次联系', exact: true }).waitFor();
      assert.equal(new URL(staff.url()).searchParams.get('table'), followTable);
      const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence');
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 900 });
        assert.equal(
          await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
        await staff.screenshot({ path: path.join(evidence, 'u4-follow-' + width + '.png'), fullPage: true });
      }
      await staff.setViewportSize({ width: 1440, height: 1000 });
      await api('post', '/tables/' + businessTable + '/access', token, {
        version: 1,
        policy: { restricted: true, grants: [] },
      }).expect(200);
      const hidden = (
        await api('get', '/collaboration/business-tables?source=LEADS', editorToken).expect(200)
      ).body.data;
      assert.equal(hidden.tables.length, 0);
      await api('post', '/tables/' + businessTable + '/business-records', editorToken, {
        name: '不应创建',
        phone: '13900008883',
      }).expect(403);
      await staff.goto(address + 'leads?base=' + baseId + '&table=' + businessTable + '&record=' + lead.id);
      await staff.getByText('你没有此项操作权限。').first().waitFor();
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'U5-A smoke: customer negotiation and contract workspaces preserve canonical actions and role boundaries',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'u5-real-app',
          transformIndexHtml: (html: string) => html.replace('/src/main.tsx', '/e2e/unified-harness.tsx'),
        },
      ],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin, changeOrigin: true } } },
    });
    await vite.listen();
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.COLLAB_BROWSER_CHANNEL || undefined,
    });
    try {
      const org = (await db.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } })).organizationId;
      const position = await db.position.create({
        data: { organizationId: org, code: randomUUID(), name: 'U5 岗位', categoryCode: 'SALES' },
      });
      const manager = await db.user.create({
        data: { username: 'u5-manager', password: 'unused', mustChangePassword: false },
      });
      const ids = [owner, editor, manager.id];
      for (const id of ids) {
        const employee = await db.employee.create({
          data: {
            name: id === editor ? 'U5 员工' : 'U5 负责人',
            employeeNo: randomUUID(),
            phone: '13800000000',
            type: 'SALES',
            status: 'FORMAL',
            entryDate: new Date('2025-01-01'),
          },
        });
        await db.user.update({ where: { id }, data: { employeeId: employee.id } });
        await db.employeeAssignment.create({
          data: {
            employeeId: employee.id,
            organizationId: org,
            positionId: position.id,
            assignmentType: 'PRIMARY',
            startedAt: new Date('2025-01-01'),
          },
        });
        const role = await db.role.create({
          data: {
            name: 'U5 ' + id,
            code: 'U5_' + id,
            type: 'BUSINESS',
            permissions: {
              create: [
                'menu.customer',
                'menu.contract',
                'customer.read',
                'customer.create',
                'customer.update',
                'negotiation.read',
                'negotiation.create',
                'negotiation.update',
                'contract.read',
                'contract.create',
                'contract.submit',
                'contract.sign',
              ].map((code) => ({ permission: { connect: { code } } })),
            },
          },
        });
        const scope = await db.dataScope.create({ data: { name: 'U5 scope', scopeType: 'ALL' } });
        for (const resource of ['customer', 'negotiation', 'contract'])
          await db.roleDataScope.create({ data: { roleId: role.id, resource, dataScopeId: scope.id } });
        await db.userRole.create({ data: { userId: id, roleId: role.id } });
      }
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL' },
      });
      const managerToken = (await createApiSession(db, manager.id)).token;
      const tokens = [token, editorToken, managerToken],
        pages = [],
        errors: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          `window.unifiedTestSession = ${JSON.stringify({ mode: 'AUTHENTICATED', token: tokens[i], csrfToken: 'test', expiresIn: 900, user: { id: ids[i], username: ids[i], name: '业务验收成员', roles: [], permissions: [] } })};`,
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, staff, leader] = pages,
        address = vite.resolvedUrls.local[0];
      const api = (method: 'get' | 'post', route: string, bearer = token, body?: unknown) => {
        const request = app.httpRequest();
        const call = request[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? call : call.send(body);
      };
      const tables: Record<string, string> = {};
      for (const route of ['customers', 'negotiations', 'contracts']) {
        await admin.goto(address + route);
        await admin.getByRole('button', { name: '连接业务数据', exact: true }).click();
        await admin.getByRole('combobox', { name: '连接到应用', exact: true }).click();
        await admin
          .locator('.ant-select-item-option-content')
          .getByText('接口工作区 / 业务台账', { exact: true })
          .click();
        await admin
          .getByRole('dialog')
          .getByRole('button', { name: /^连\s*接$/ })
          .click();
        await admin.getByRole('button', { name: '字段配置', exact: true }).waitFor();
        tables[route] = new URL(admin.url()).searchParams.get('table')!;
      }
      await staff.goto(address + 'customers/new');
      await staff.getByLabel('姓名', { exact: true }).fill('U5 新客户');
      await staff.getByLabel('电话', { exact: true }).fill('13900009991');
      await staff.getByRole('button', { name: '创建客户', exact: true }).click();
      await staff.getByRole('link', { name: '在「客户工作表」中打开', exact: true }).waitFor();
      const customer = await db.customer.findFirstOrThrow({ where: { name: 'U5 新客户' } });
      assert.equal(customer.createdBy, editor);
      const other = (
        await api('post', '/customers', token, { name: '负责人客户', phone: '13900009992' }).expect(200)
      ).body.data;
      await staff.getByRole('link', { name: '在「客户工作表」中打开', exact: true }).click();
      await staff.getByRole('button', { name: '客户名称：U5 新客户', exact: true }).waitFor();
      assert.equal(new URL(staff.url()).searchParams.get('record'), customer.id);
      await staff.locator('.ant-drawer-close').click();
      await staff.getByRole('button', { name: '创建个人视图', exact: true }).click();
      await staff.getByRole('tab', { name: '我创建的客户 · 个人', exact: true }).waitFor();
      const view = new URL(staff.url()).searchParams.get('view');
      await staff.reload();
      await staff.getByRole('tab', { name: '我创建的客户 · 个人', exact: true }).waitFor();
      assert.equal(new URL(staff.url()).searchParams.get('view'), view);
      await api('get', '/tables/' + tables.customers + '/records/' + other.id, editorToken).expect(404);
      await leader.goto(address + 'customers?base=' + baseId + '&table=' + tables.customers);
      await leader.getByRole('button', { name: '客户名称：负责人客户', exact: true }).waitFor();
      await staff.goto(address + 'negotiations/new');
      await staff.getByLabel('客户', { exact: true }).click();
      await staff.locator('.ant-select-item-option-content').filter({ hasText: 'U5 新客户' }).click();
      await staff.getByLabel('所属组织', { exact: true }).click();
      await staff
        .locator('.ant-select-item-option-content')
        .getByText('协作接口测试', { exact: true })
        .click();
      await staff.getByLabel('谈案人', { exact: true }).click();
      await staff.locator('.ant-select-item-option-content').getByText('U5 员工', { exact: true }).click();
      await staff.getByLabel('报价金额', { exact: true }).fill('123.45');
      await staff.getByRole('button', { name: '创建谈案', exact: true }).click();
      await staff.getByRole('button', { name: '完结谈案', exact: true }).click();
      await staff.getByRole('dialog').getByRole('button', { name: '确认完结', exact: true }).click();
      await staff.getByRole('dialog').waitFor({ state: 'hidden' });
      const negotiation = await db.negotiation.findFirstOrThrow({ where: { customerId: customer.id } });
      assert.equal(negotiation.status, 'SIGNED');
      await staff.getByRole('link', { name: '在「谈案工作表」中打开', exact: true }).click();
      await staff.getByRole('button', { name: '谈案状态：已签约', exact: true }).waitFor();
      const contract = await db.contract.create({
        data: {
          contractNo: 'U5-RISK',
          contractType: 'RISK_NOTICE',
          title: 'U5 风险告知',
          customerId: customer.id,
          branchId: org,
          createdBy: editor,
        },
      });
      await leader.goto(address + 'contracts?base=' + baseId + '&table=' + tables.contracts);
      await leader.getByRole('button', { name: '合同状态：草稿', exact: true }).waitFor();
      await staff.goto(
        address + 'contracts?base=' + baseId + '&table=' + tables.contracts + '&record=' + contract.id,
      );
      await staff.getByRole('button', { name: '打开业务详情与办理', exact: true }).click();
      await staff.getByRole('button', { name: /^提\s*交$/ }).click();
      await staff
        .locator('.ant-popconfirm')
        .getByRole('button', { name: /^(确\s*定|OK)$/ })
        .click();
      await staff.getByText('待签署', { exact: true }).waitFor();
      await leader.getByRole('button', { name: '合同状态：待签署', exact: true }).waitFor({ timeout: 15000 });
      await staff.getByRole('link', { name: '在「合同工作表」中打开', exact: true }).click();
      await staff.getByRole('button', { name: '合同状态：待签署', exact: true }).waitFor();
      assert.equal(
        (await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).status,
        'PENDING_SIGN',
      );
      await staff.locator('.ant-drawer-close').click();
      const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence');
      await mkdir(evidence, { recursive: true });
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 900 });
        assert.equal(
          await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
          'U5 table overflow ' + width,
        );
        await staff.screenshot({
          path: path.join(evidence, 'u5-contract-' + width + '.png'),
          fullPage: true,
        });
      }
      await api('post', '/tables/' + tables.contracts + '/access', token, {
        version: 1,
        policy: { restricted: true, grants: [] },
      }).expect(200);
      await api('get', '/tables/' + tables.contracts + '/records/' + contract.id, editorToken).expect(403);
      assert.equal(await db.collabRecord.count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'U5-B smoke: case workspace delivers canonical lifecycle and enforces creator and file scopes',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'u5b-real-app',
          transformIndexHtml: (html: string) => html.replace('/src/main.tsx', '/e2e/unified-harness.tsx'),
        },
      ],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin, changeOrigin: true } } },
    });
    await vite.listen();
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.COLLAB_BROWSER_CHANNEL || undefined,
    });
    try {
      const org = (await db.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } })).organizationId;
      const position = await db.position.create({
        data: { organizationId: org, code: randomUUID(), name: 'U5B 岗位', categoryCode: 'SALES' },
      });
      const manager = await db.user.create({
        data: { username: 'u5b-manager', password: 'unused', mustChangePassword: false },
      });
      const ids = [owner, editor, manager.id];
      for (const id of ids) {
        const employee = await db.employee.create({
          data: {
            name: id === editor ? 'U5B 员工' : 'U5B 负责人',
            employeeNo: randomUUID(),
            phone: '13800000000',
            type: 'SALES',
            status: 'FORMAL',
            entryDate: new Date('2025-01-01'),
          },
        });
        await db.user.update({ where: { id }, data: { employeeId: employee.id } });
        await db.employeeAssignment.create({
          data: {
            employeeId: employee.id,
            organizationId: org,
            positionId: position.id,
            assignmentType: 'PRIMARY',
            startedAt: new Date('2025-01-01'),
          },
        });
        const role = await db.role.create({
          data: {
            name: 'U5B ' + id,
            code: 'U5B_' + id,
            type: 'BUSINESS',
            permissions: {
              create: [
                'case.read',
                'case.create',
                'case.update',
                'case.delete',
                'case.close',
                'case.task.manage',
                'case.communication.create',
                'case.file.read',
                'case.file.manage',
                'menu.customer',
                'menu.contract',
                'customer.read',
                'customer.create',
                'customer.update',
                'negotiation.read',
                'negotiation.create',
                'negotiation.update',
                'contract.read',
                'contract.create',
                'contract.submit',
                'contract.sign',
              ].map((code) => ({ permission: { connect: { code } } })),
            },
          },
        });
        const scope = await db.dataScope.create({ data: { name: 'U5B scope', scopeType: 'ALL' } });
        const caseScope = await db.dataScope.create({
          data: { name: '案件范围', scopeType: id === editor ? 'SELF' : 'ALL' },
        });
        for (const resource of ['customer', 'negotiation', 'contract', 'case'])
          await db.roleDataScope.create({
            data: { roleId: role.id, resource, dataScopeId: resource === 'case' ? caseScope.id : scope.id },
          });
        await db.userRole.create({ data: { userId: id, roleId: role.id } });
      }
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL' },
      });
      const managerToken = (await createApiSession(db, manager.id)).token;
      const tokens = [token, editorToken, managerToken],
        pages = [],
        errors: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          `window.unifiedTestSession = ${JSON.stringify({ mode: 'AUTHENTICATED', token: tokens[i], csrfToken: 'test', expiresIn: 900, user: { id: ids[i], username: ids[i], name: '业务验收成员', roles: [], permissions: [] } })};`,
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, staff, leader] = pages,
        address = vite.resolvedUrls.local[0];
      const api = (method: 'get' | 'post', route: string, bearer = token, body?: unknown) => {
        const request = app.httpRequest();
        const call = request[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? call : call.send(body);
      };
      await admin.goto(address + 'cases');
      await admin.getByRole('button', { name: '连接业务数据', exact: true }).click();
      await admin.getByRole('combobox', { name: '连接到应用', exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('接口工作区 / 业务台账', { exact: true })
        .click();
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: /^连\s*接$/ })
        .click();
      await admin.getByRole('button', { name: '字段配置', exact: true }).waitFor();
      const casesTable = new URL(admin.url()).searchParams.get('table')!;
      const customer = (
        await api('post', '/customers', editorToken, { name: 'U5B 客户', phone: '13900007771' }).expect(200)
      ).body.data;
      const employee = await db.user.findUniqueOrThrow({ where: { id: editor } });
      const other = (
        await api('post', '/cases', token, {
          title: '负责人案件',
          caseType: '民事',
          customerId: customer.id,
          branchId: org,
          lawyerId: employee.employeeId,
        }).expect(200)
      ).body.data;
      await staff.goto(address + 'cases/new');
      await staff.getByLabel('案件标题', { exact: true }).fill('U5B 交付案件');
      await staff.getByLabel('所属组织', { exact: true }).click();
      await staff
        .locator('.ant-select-item-option-content')
        .getByText('协作接口测试', { exact: true })
        .click();
      await staff.getByLabel('客户', { exact: true }).fill('U5B 往返客户');
      await staff.getByRole('button', { name: '新建客户：U5B 往返客户', exact: true }).click();
      await staff.getByLabel('电话', { exact: true }).fill('13900007772');
      await staff.getByRole('button', { name: '创建客户', exact: true }).click();
      await staff.getByLabel('案件标题', { exact: true }).waitFor();
      assert.equal(await staff.getByLabel('案件标题', { exact: true }).inputValue(), 'U5B 交付案件');
      await staff.getByText('U5B 往返客户', { exact: true }).first().waitFor();
      await staff.getByLabel('主办律师', { exact: true }).click();
      await staff.locator('.ant-select-item-option-content').getByText('U5B 员工', { exact: true }).click();
      await staff.getByLabel('案由', { exact: true }).fill('民事');
      await staff
        .getByRole('dialog')
        .getByRole('button', { name: /^确\s*定$/ })
        .click();
      await staff.getByRole('button', { name: '受理案件', exact: true }).waitFor();
      const record = await db.case.findFirstOrThrow({ where: { title: 'U5B 交付案件' } });
      assert.equal(record.createdBy, editor);
      assert.equal(record.branchId, org);
      await staff.getByRole('button', { name: '受理案件', exact: true }).click();
      await staff.getByRole('button', { name: '开始办理', exact: true }).click();
      await staff.getByRole('button', { name: /新建任务$/ }).click();
      await staff.getByLabel('任务名称', { exact: true }).fill('核对交付材料');
      await staff.getByLabel('节点类型', { exact: true }).click();
      await staff.locator('.ant-select-item-option-content').first().click();
      await staff
        .getByRole('dialog')
        .getByRole('button', { name: /^确\s*定$/ })
        .click();
      await staff.getByText('核对交付材料', { exact: true }).waitFor();
      await staff.getByRole('button', { name: '开始办理', exact: true }).click();
      await staff.getByRole('button', { name: '完成', exact: true }).click();
      await staff.getByRole('button', { name: /新增沟通$/ }).click();
      await staff.getByLabel('沟通内容', { exact: true }).fill('已确认交付计划');
      await staff
        .getByRole('dialog')
        .getByRole('button', { name: /^确\s*定$/ })
        .click();
      await staff.getByText('已确认交付计划', { exact: true }).waitFor();
      await staff.locator('input[type=file]').setInputFiles({
        name: 'u5b-evidence.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('synthetic case evidence'),
      });
      await staff.getByText('u5b-evidence.txt', { exact: true }).waitFor();
      const file = await db.caseFile.findFirstOrThrow({ where: { caseId: record.id } });
      await api('get', '/cases/' + other.id, editorToken).expect(404);
      await api('get', '/tables/' + casesTable + '/records/' + other.id, editorToken).expect(404);
      await leader.goto(address + 'cases?base=' + baseId + '&table=' + casesTable);
      await leader.getByRole('button', { name: '案件名称：负责人案件', exact: true }).waitFor();
      await staff.getByRole('button', { name: /结案$/ }).first().click();
      await staff
        .getByRole('dialog')
        .getByRole('button', { name: /^结\s*案$/ })
        .click();
      await staff.getByRole('button', { name: '归档案件', exact: true }).click();
      await staff.getByText('已归档', { exact: true }).waitFor();
      await leader.getByRole('button', { name: '案件状态：已归档', exact: true }).waitFor();
      await staff.getByRole('link', { name: '在「案件工作表」中打开', exact: true }).click();
      await staff.getByRole('button', { name: '案件名称：U5B 交付案件', exact: true }).waitFor();
      assert.equal(new URL(staff.url()).searchParams.get('record'), record.id);
      await staff.locator('.ant-drawer-close').click();
      await staff.getByRole('button', { name: '创建个人视图', exact: true }).click();
      await staff.getByRole('tab', { name: '我创建的案件 · 个人', exact: true }).waitFor();
      await staff.reload();
      await staff.getByRole('tab', { name: '我创建的案件 · 个人', exact: true }).waitFor();
      await staff.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 900 });
        assert.equal(
          await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
        await staff.screenshot({
          path: path.resolve(process.cwd(), '../../var/collaboration-evidence/u5b-case-' + width + '.png'),
          fullPage: true,
        });
      }
      await staff.goto(address + 'cases?caseNo=' + encodeURIComponent(record.caseNo) + '#legacy');
      await staff.getByText('已归档', { exact: true }).waitFor();
      assert.equal(new URL(staff.url()).pathname, '/cases/' + record.id);
      assert.equal(new URL(staff.url()).hash, '#legacy');
      assert.equal(await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const gap = (
        await api('post', '/cases', token, {
          title: '待补组织案件',
          caseType: '民事',
          customerId: customer.id,
          lawyerId: employee.employeeId,
        }).expect(200)
      ).body.data;
      await api('post', '/cases/' + gap.id + '/identity', editorToken, {
        branchId: org,
        reason: '无权补录',
        version: gap.version,
      }).expect(403);
      await admin.goto(address + 'cases');
      await admin.getByRole('button', { name: '待补录案件', exact: true }).click();
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: /^补\s*录$/ })
        .click();
      await admin.getByLabel('确认所属组织', { exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('协作接口测试', { exact: true })
        .click();
      await admin.getByLabel('补录依据', { exact: true }).fill('冒烟夹具中人工确认的归属');
      await admin.getByRole('button', { name: '保存归属并记录审计', exact: true }).click();
      await admin.getByText('没有待补录案件', { exact: true }).waitFor();
      assert.equal((await db.case.findUniqueOrThrow({ where: { id: gap.id } })).branchId, org);
      assert.equal(
        await db.operationLog.count({ where: { targetId: gap.id, action: 'CASE_IDENTITY_REPAIR' } }),
        1,
      );
      await api('post', '/cases/' + gap.id + '/identity', token, {
        branchId: org,
        reason: '不许覆盖',
        version: gap.version + 1,
      }).expect(400);
      // Revocation while the detail remains open clears the cached record on its bounded refresh.
      await db.userRole.deleteMany({ where: { userId: editor } });
      await api('get', '/files/' + file.id + '/download', editorToken).expect(403);
      await staff
        .getByText('U5B 交付案件', { exact: false })
        .first()
        .waitFor({ state: 'hidden', timeout: 25000 });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'U6-A smoke: canonical finance views, precise creates, approvals, refund MFA and scoped case navigation',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'u6a-real-app',
          transformIndexHtml: (html: string) => html.replace('/src/main.tsx', '/e2e/unified-harness.tsx'),
        },
      ],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin, changeOrigin: true } } },
    });
    await vite.listen();
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.COLLAB_BROWSER_CHANNEL || undefined,
    });
    const security = (app.config as typeof app.config & { identitySecurity: { trustedOrigins: string[] } })
      .identitySecurity;
    const previousOrigins = [...security.trustedOrigins];
    security.trustedOrigins.push(new URL(vite.resolvedUrls.local[0]).origin);
    try {
      const org = (await db.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } })).organizationId;
      const position = await db.position.create({
        data: { organizationId: org, code: randomUUID(), name: 'U6A 岗位', categoryCode: 'SALES' },
      });
      const manager = await db.user.create({
        data: { username: 'u6a-manager', password: 'unused', mustChangePassword: false },
      });
      const ids = [owner, editor, manager.id];
      for (const id of ids) {
        const employee = await db.employee.create({
          data: {
            name: id === editor ? 'U6A 员工' : 'U6A 负责人',
            employeeNo: randomUUID(),
            phone: '13800000000',
            type: 'SALES',
            status: 'FORMAL',
            entryDate: new Date('2025-01-01'),
          },
        });
        await db.user.update({ where: { id }, data: { employeeId: employee.id } });
        await db.employeeAssignment.create({
          data: {
            employeeId: employee.id,
            organizationId: org,
            positionId: position.id,
            assignmentType: 'PRIMARY',
            startedAt: new Date('2025-01-01'),
          },
        });
        const role = await db.role.create({
          data: {
            name: 'U6A ' + id,
            code: 'U6A_' + id,
            type: 'BUSINESS',
            permissions: {
              create: [
                'case.read',
                'case.create',
                'case.update',
                'menu.customer',
                'menu.contract',
                'customer.read',
                'customer.create',
                'contract.read',
                'contract.create',
                'contract.submit',
                'contract.sign',
                'payment.read',
                'payment.create',
                'payment.confirm',
                'payment.void',
                'invoice.read',
                'invoice.create',
                'invoice.approve',
                'invoice.complete',
                'refund.read',
                'refund.create',
                'refund.approve',
                'refund.execute',
                'cost.read',
                'cost.create',
                'cost.update',
                'cost.delete',
                'menu.payment',
                'menu.invoice',
                'menu.refund',
                'menu.cost',
              ].map((code) => ({ permission: { connect: { code } } })),
            },
          },
        });
        const scope = await db.dataScope.create({ data: { name: 'U6A scope', scopeType: 'ALL' } });
        const caseScope = await db.dataScope.create({
          data: { name: '案件范围', scopeType: id === editor ? 'SELF' : 'ALL' },
        });
        for (const resource of ['customer', 'contract', 'case', 'payment', 'invoice', 'refund', 'cost'])
          await db.roleDataScope.create({
            data: {
              roleId: role.id,
              resource,
              dataScopeId: ['case', 'payment', 'invoice', 'refund', 'cost'].includes(resource)
                ? caseScope.id
                : scope.id,
            },
          });
        await db.userRole.create({ data: { userId: id, roleId: role.id } });
      }
      // A registration-only role allows choosing authorized contracts across creators;
      // the separate reading/confirmation role retains SELF on financial records.
      const registration = await db.role.create({
        data: {
          name: '财务登记',
          code: 'U6A_REGISTRATION',
          type: 'BUSINESS',
          permissions: {
            create: ['payment.create', 'invoice.create', 'refund.create', 'cost.create'].map((code) => ({
              permission: { connect: { code } },
            })),
          },
        },
      });
      const registrationScope = await db.dataScope.create({
        data: { name: '登记目标范围', scopeType: 'ALL' },
      });
      for (const resource of ['payment', 'invoice', 'refund', 'cost'])
        await db.roleDataScope.create({
          data: { roleId: registration.id, resource, dataScopeId: registrationScope.id },
        });
      await db.userRole.create({ data: { userId: editor, roleId: registration.id } });
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL' },
      });
      const managerSession = await createApiSession(db, manager.id, 'MFA');
      const managerToken = managerSession.token;
      const addressForCookies = vite.resolvedUrls.local[0];
      const tokens = [token, editorToken, managerToken],
        pages = [],
        errors: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        if (i === 2)
          await context.addCookies([
            { name: 'chengye_csrf', value: managerSession.csrfToken, url: addressForCookies },
          ]);
        await context.addInitScript(
          `window.unifiedTestSession = ${JSON.stringify({ mode: 'AUTHENTICATED', token: tokens[i], csrfToken: i === 2 ? managerSession.csrfToken : 'test', expiresIn: 900, user: { id: ids[i], username: ids[i], name: '业务验收成员', roles: [], permissions: [] } })};`,
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, staff, leader] = pages,
        address = vite.resolvedUrls.local[0];
      const api = (method: 'get' | 'post', route: string, bearer = token, body?: unknown) => {
        const request = app.httpRequest();
        const call = request[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? call : call.send(body);
      };
      const tables: Record<string, string> = {};
      for (const [source, route] of [
        ['PAYMENTS', 'payments'],
        ['INVOICES', 'invoices'],
        ['REFUNDS', 'refunds'],
        ['COSTS', 'costs'],
      ]) {
        await admin.goto(address + route);
        await admin.getByRole('button', { name: '连接业务数据', exact: true }).click();
        await admin.getByRole('combobox', { name: '连接到应用', exact: true }).click();
        await admin
          .locator('.ant-select-item-option-content')
          .getByText('接口工作区 / 业务台账', { exact: true })
          .click();
        await admin
          .getByRole('dialog')
          .getByRole('button', { name: /^连\s*接$/ })
          .click();
        await admin.getByRole('button', { name: '字段配置', exact: true }).waitFor();
        tables[route] = new URL(admin.url()).searchParams.get('table')!;
        assert.equal(
          (await db.collabTable.findUniqueOrThrow({ where: { id: tables[route] } })).source,
          source,
        );
      }
      const customer = await db.customer.create({
        data: {
          customerNo: randomUUID(),
          name: 'U6A 财务客户',
          phone: '13900008881',
          phoneHash: randomUUID(),
          createdBy: owner,
        },
      });
      const contract = await db.contract.create({
        data: {
          contractNo: 'U6A-CONTRACT',
          contractType: 'FORMAL',
          title: 'U6A 财务合同',
          customerId: customer.id,
          branchId: org,
          createdBy: owner,
          amount: '1000.00',
          status: 'SIGNED',
        },
      });
      const record = await db.case.create({
        data: {
          caseNo: 'U6A-CASE',
          title: 'U6A 财务案件',
          customerId: customer.id,
          contractId: contract.id,
          branchId: org,
          createdBy: editor,
          caseType: '民事',
        },
      });
      const otherContract = await db.contract.create({
        data: {
          contractNo: 'U6A-OTHER',
          contractType: 'FORMAL',
          title: '另一个合同',
          customerId: customer.id,
          branchId: org,
          createdBy: owner,
          amount: '1000.00',
          status: 'SIGNED',
        },
      });
      const other = (
        await api('post', '/payments', token, {
          contractId: contract.id,
          amount: '1.00',
          idempotencyKey: randomUUID(),
        }).expect(200)
      ).body.data;
      await api('get', '/payments/' + other.id, editorToken).expect(404);
      const contextQuery = new URLSearchParams({
        contract: contract.id,
        case: record.id,
        caseNo: record.caseNo,
      });
      const tableUrl = (route: string) =>
        address +
        route +
        '?' +
        new URLSearchParams({ ...Object.fromEntries(contextQuery), base: baseId, table: tables[route] });
      await staff.goto(tableUrl('payments'));
      await staff.getByRole('button', { name: '登记收款', exact: true }).click();
      await staff.getByRole('spinbutton', { name: '单据金额', exact: true }).fill('0.30');
      await staff.getByLabel('收款方式', { exact: true }).fill('银行转账');
      let dropped = false;
      await staff.route(
        '**/api/v1/payments',
        async (route: {
          request(): { method(): string };
          fetch(): Promise<unknown>;
          abort(reason: string): Promise<void>;
          continue(): Promise<void>;
        }) => {
          if (route.request().method() === 'POST' && !dropped) {
            dropped = true;
            await route.fetch();
            await route.abort('failed');
          } else await route.continue();
        },
      );
      const save = staff.getByRole('button', { name: '保存单据', exact: true });
      await save.click();
      await staff.getByRole('button', { name: '刷新授权与选项', exact: true }).waitFor();
      assert.equal(await db.payment.count({ where: { createdBy: editor } }), 1);
      await save.click();
      await staff.getByRole('button', { name: '确认收款', exact: true }).waitFor();
      const own = await db.payment.findFirstOrThrow({ where: { createdBy: editor } });
      assert.equal(own.amount.toFixed(2), '0.30');
      assert.equal(await db.payment.count({ where: { createdBy: editor } }), 1);
      await leader.goto(tableUrl('payments'));
      await leader.getByRole('button', { name: '收款金额：0.30', exact: true }).waitFor();
      await staff.getByRole('button', { name: '确认收款', exact: true }).click();
      await staff.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await staff.getByText('已确认', { exact: true }).waitFor();
      await leader.getByRole('button', { name: '收款状态：已确认', exact: true }).waitFor();
      assert.equal(
        (await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).receivedAmount.toFixed(2),
        '0.30',
      );
      // The same creator's different contract is excluded only by the transient context, not a saved view.
      await api('post', '/payments', editorToken, {
        contractId: otherContract.id,
        amount: '8.88',
        idempotencyKey: randomUUID(),
      }).expect(200);
      await staff.getByRole('link', { name: '返回收款工作表', exact: true }).click();
      await staff.locator('.ant-drawer-close').waitFor();
      await staff.locator('.ant-drawer-close').click();
      await staff.getByRole('button', { name: '收款金额：0.30', exact: true }).waitFor();
      assert.equal(await staff.getByRole('button', { name: '收款金额：8.88', exact: true }).count(), 0);
      await staff.getByRole('button', { name: '创建个人视图', exact: true }).click();
      await staff.getByRole('tab', { name: '我登记的收款 · 个人', exact: true }).waitFor();
      await staff.reload();
      await staff.getByRole('tab', { name: '我登记的收款 · 个人', exact: true }).waitFor();
      const personal = await db.collabView.findFirstOrThrow({
        where: { tableId: tables.payments, ownerId: editor, isDefault: false },
      });
      assert.equal(JSON.stringify(personal.config).includes(contract.id), false);
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 900 });
        assert.equal(
          await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
        await staff.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
        await staff.screenshot({
          path: path.resolve(process.cwd(), '../../var/collaboration-evidence/u6a-finance-' + width + '.png'),
          fullPage: true,
          animations: 'disabled',
        });
      }
      await staff.setViewportSize({ width: 1440, height: 1000 });
      await staff.goto(tableUrl('invoices'));
      await staff.getByRole('button', { name: '申请发票', exact: true }).click();
      await staff.getByRole('spinbutton', { name: '单据金额', exact: true }).fill('0.20');
      await staff.getByLabel('申请说明', { exact: true }).fill('冒烟开票');
      await staff.getByRole('button', { name: '保存单据', exact: true }).click();
      await staff.getByText('发票详情', { exact: true }).waitFor();
      const invoice = await db.invoiceRequest.findFirstOrThrow({ where: { createdBy: editor } });
      await leader.goto(address + 'invoices/' + invoice.id);
      await leader.getByRole('button', { name: '审批通过', exact: true }).click();
      await leader.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await leader.getByRole('button', { name: '完成开票', exact: true }).click();
      await leader.getByLabel('发票号码（可留空自动生成）', { exact: true }).fill('U6A-INVOICE');
      await leader.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await staff.getByText('已完成', { exact: true }).waitFor();
      await staff.goto(tableUrl('refunds'));
      await staff.getByRole('button', { name: '申请退款减免', exact: true }).click();
      await staff.getByLabel('原收款', { exact: true }).click();
      await staff
        .locator('.ant-select-item-option-content')
        .getByText(own.paymentNo + ' · 0.30 元', { exact: true })
        .click();
      assert.equal(
        await staff.getByRole('spinbutton', { name: '单据金额', exact: true }).inputValue(),
        '0.30',
      );
      await staff.getByLabel('申请说明', { exact: true }).fill('冒烟退款');
      await staff.getByRole('button', { name: '保存单据', exact: true }).click();
      await staff.getByText('退款减免详情', { exact: true }).waitFor();
      const refund = await db.refundRequest.findFirstOrThrow({ where: { createdBy: editor } });
      await api('post', '/refunds/' + refund.id + '/approve', managerToken, {
        expectedVersion: refund.version,
      }).expect(403);
      await leader.goto(address + 'refunds/' + refund.id);
      await leader.getByRole('button', { name: '审批通过', exact: true }).click();
      await leader.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await leader.getByRole('dialog', { name: '再次验证身份' }).waitFor();
      const factor = await db.mfaFactor.findFirstOrThrow({ where: { userId: manager.id, disabledAt: null } });
      const secret = new MfaSecretCrypto(
        new Map([[1, Buffer.from('0123456789abcdef0123456789abcdef')]]),
      ).decrypt({
        ciphertext: factor.encryptedSecret,
        iv: factor.secretIv,
        authTag: factor.secretAuthTag,
        keyVersion: factor.keyVersion,
      });
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
      const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
      const code = ((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1000000)
        .toString()
        .padStart(6, '0');
      await leader.getByLabel('当前六位验证码', { exact: true }).fill(code);
      await leader.getByRole('button', { name: '验证并继续', exact: true }).click();
      await leader.getByRole('button', { name: '执行退款减免', exact: true }).click();
      await leader.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await staff.getByText('已执行', { exact: true }).waitFor();
      assert.equal((await db.payment.findUniqueOrThrow({ where: { id: own.id } })).status, 'REFUNDED');
      assert.equal(
        (await db.contract.findUniqueOrThrow({ where: { id: contract.id } })).receivedAmount.toFixed(2),
        '0.00',
      );
      await staff.goto(tableUrl('costs'));
      await staff.getByRole('button', { name: '登记成本', exact: true }).click();
      await staff.getByText('U6A-CASE · U6A 财务案件', { exact: true }).waitFor();
      const contractOptions = await api(
        'get',
        '/contracts?branchId=' + contract.branchId,
        editorToken,
      ).expect(200);
      assert.ok(contractOptions.body.data.list.some((row: { id: string }) => row.id === contract.id));
      const caseOptions = await api('get', '/cases?branchId=' + contract.branchId, editorToken).expect(200);
      assert.ok(caseOptions.body.data.list.some((row: { caseNo: string }) => row.caseNo === 'U6A-CASE'));
      assert.equal(
        (await api('get', '/cases?branchId=nonexistent', editorToken).expect(200)).body.data.total,
        0,
      );
      await staff.getByRole('spinbutton', { name: '单据金额', exact: true }).fill('9999999999999999.99');
      await staff.getByLabel('备注', { exact: true }).fill('大额精度冒烟');
      await staff.getByRole('button', { name: '保存单据', exact: true }).click();
      await staff.getByText('成本详情', { exact: true }).waitFor();
      const cost = await db.costEntry.findFirstOrThrow({ where: { createdBy: editor } });
      assert.equal(cost.amount.toFixed(2), '9999999999999999.99');
      await staff.getByRole('button', { name: '编辑成本', exact: true }).click();
      await staff.getByRole('dialog').getByLabel('备注', { exact: true }).fill('已修改成本');
      await staff.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await staff.getByText('已修改成本', { exact: true }).waitFor();
      await staff.goto(address + 'finance?caseNo=U6A-CASE');
      await staff.getByText('U6A-CASE · U6A 财务案件', { exact: true }).waitFor();
      await staff.getByRole('link', { name: /收款工作表/ }).click();
      assert.equal(new URL(staff.url()).searchParams.get('contract'), contract.id);
      await staff.goto(address + 'costs/' + cost.id);
      await staff.getByText('已修改成本', { exact: true }).waitFor();
      await db.userRole.deleteMany({ where: { userId: editor } });
      await api('get', '/costs/' + cost.id, editorToken).expect(403);
      await staff.getByText('已修改成本', { exact: true }).waitFor({ state: 'hidden', timeout: 25000 });
      assert.equal(await db.collabRecord.count(), 0);
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const [index, context] of browser.contexts().entries())
        for (const page of context.pages()) {
          await page
            .screenshot({
              path: path.resolve(
                process.cwd(),
                '../../var/collaboration-evidence/u6a-smoke-failed-' + index + '.png',
              ),
              fullPage: true,
              animations: 'disabled',
            })
            .catch(() => undefined);
          console.error(
            'U6-A failure context',
            index,
            await page
              .locator('[role=dialog]')
              .evaluateAll((nodes) =>
                nodes.map((node) => ({
                  label: node.getAttribute('aria-label'),
                  labelledby: node.getAttribute('aria-labelledby'),
                  title: node.querySelector('.ant-modal-title')?.outerHTML,
                  text: node.textContent?.slice(0, 700),
                })),
              )
              .catch(() => []),
          );
        }
      throw error;
    } finally {
      security.trustedOrigins = previousOrigins;
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'U6-B smoke: inventory worktables, atomic stock actions, performance reviews and three role scopes',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'u6b-real-app',
          transformIndexHtml: (html: string) => html.replace('/src/main.tsx', '/e2e/unified-harness.tsx'),
        },
      ],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin, changeOrigin: true } } },
    });
    await vite.listen();
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.COLLAB_BROWSER_CHANNEL || undefined,
    });
    const security = (app.config as typeof app.config & { identitySecurity: { trustedOrigins: string[] } })
      .identitySecurity;
    const previousOrigins = [...security.trustedOrigins];
    security.trustedOrigins.push(new URL(vite.resolvedUrls.local[0]).origin);
    try {
      const org = (await db.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } })).organizationId;
      const position = await db.position.create({
        data: { organizationId: org, code: randomUUID(), name: 'U6B 岗位', categoryCode: 'SALES' },
      });
      const manager = await db.user.create({
        data: { username: 'u6b-manager', password: 'unused', mustChangePassword: false },
      });
      const ids = [owner, editor, manager.id],
        people: Record<string, string> = {};
      const permissions = [
        'menu.inventory',
        'inventory.read',
        'inventory.manage',
        'inventory.inbound',
        'inventory.outbound',
        'inventory.stocktake',
        'inventory.export',
        'employee.read',
        'performance.read',
        'performance.create',
        'performance.update',
        'performance.confirm',
      ];
      for (const id of ids) {
        const employee = await db.employee.create({
          data: {
            name: id === editor ? 'U6B 员工' : id === owner ? 'U6B 管理员' : 'U6B 负责人',
            employeeNo: randomUUID(),
            phone: '13800000000',
            type: 'SALES',
            status: 'FORMAL',
            entryDate: new Date('2025-01-01'),
          },
        });
        people[id] = employee.id;
        await db.user.update({ where: { id }, data: { employeeId: employee.id } });
        await db.employeeAssignment.create({
          data: {
            employeeId: employee.id,
            organizationId: org,
            positionId: position.id,
            assignmentType: 'PRIMARY',
            startedAt: new Date('2025-01-01'),
          },
        });
        const role = await db.role.create({
          data: {
            name: 'U6B ' + id,
            code: 'U6B_' + id,
            type: 'BUSINESS',
            permissions: { create: permissions.map((code) => ({ permission: { connect: { code } } })) },
          },
        });
        const all = await db.dataScope.create({ data: { name: '选项', scopeType: 'ALL' } });
        const scoped = await db.dataScope.create({
          data: { name: '业务范围', scopeType: id === editor ? 'SELF' : 'ALL' },
        });
        for (const resource of ['inventory', 'performance', 'employee'])
          await db.roleDataScope.create({
            data: { roleId: role.id, resource, dataScopeId: resource === 'employee' ? all.id : scoped.id },
          });
        await db.userRole.create({ data: { userId: id, roleId: role.id } });
      }
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL' },
      });
      const managerToken = (await createApiSession(db, manager.id)).token;
      const tokens = [token, editorToken, managerToken],
        pages = [],
        errors: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          `window.unifiedTestSession = ${JSON.stringify({ mode: 'AUTHENTICATED', token: tokens[i], csrfToken: 'test', expiresIn: 900, user: { id: ids[i], username: ids[i], name: '业务验收成员', roles: [], permissions: [] } })};`,
        );
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, staff, leader] = pages,
        address = vite.resolvedUrls.local[0];
      const api = (method: 'get' | 'post', route: string, bearer = token, body?: unknown) => {
        const client = app.httpRequest();
        const call = client[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? call : call.send(body);
      };
      const tables: Record<string, string> = {};
      for (const [source, route] of [
        ['INVENTORY_ITEMS', 'inventory/items'],
        ['INVENTORY_MOVEMENTS', 'inventory/movements'],
        ['INVENTORY_STOCKTAKES', 'inventory/stocktakes'],
        ['PERFORMANCES', 'performances'],
      ]) {
        await admin.goto(address + route);
        await admin.getByRole('button', { name: '连接业务数据', exact: true }).click();
        await admin.getByRole('combobox', { name: '连接到应用', exact: true }).click();
        await admin
          .locator('.ant-select-item-option-content')
          .getByText('接口工作区 / 业务台账', { exact: true })
          .click();
        await admin
          .getByRole('dialog')
          .getByRole('button', { name: /^连\s*接$/ })
          .click();
        await admin.getByRole('button', { name: '字段配置', exact: true }).waitFor();
        tables[route] = new URL(admin.url()).searchParams.get('table')!;
        assert.equal(
          (await db.collabTable.findUniqueOrThrow({ where: { id: tables[route] } })).source,
          source,
        );
      }
      const tableUrl = (route: string, extra: Record<string, string> = {}) =>
        address + route + '?' + new URLSearchParams({ base: baseId, table: tables[route], ...extra });
      await staff.goto(tableUrl('inventory/items'));
      await staff.getByRole('button', { name: '新增物品', exact: true }).click();
      await staff.getByLabel('物品名称', { exact: true }).fill('U6B 精确库存');
      await staff.getByLabel('中文分类', { exact: true }).fill('书写用品');
      let dropped = false;
      await staff.route(
        '**/api/v1/inventory/items',
        async (route: {
          request(): { method(): string };
          fetch(): Promise<unknown>;
          abort(reason: string): Promise<void>;
          continue(): Promise<void>;
        }) => {
          if (route.request().method() === 'POST' && !dropped) {
            dropped = true;
            await route.fetch();
            await route.abort('failed');
          } else await route.continue();
        },
      );
      await staff.getByRole('button', { name: '确认登记', exact: true }).click();
      await staff.getByRole('button', { name: '刷新重试', exact: true }).waitFor();
      assert.equal(await db.inventoryItem.count({ where: { createdBy: editor } }), 1);
      await staff.getByRole('button', { name: '确认登记', exact: true }).click();
      await staff.getByRole('button', { name: '登记入库', exact: true }).waitFor();
      const item = await db.inventoryItem.findFirstOrThrow({ where: { createdBy: editor } });
      const other = (
        await api('post', '/inventory/items', token, {
          name: '负责人私有物品',
          kind: 'OFFICE',
          category: '文具',
          unit: '支',
        }).expect(200)
      ).body.data;
      await api('get', '/inventory/items/' + other.id, editorToken).expect(404);
      await leader.goto(tableUrl('inventory/items'));
      await leader.getByRole('button', { name: '物品名称：U6B 精确库存', exact: true }).waitFor();
      await staff.getByRole('button', { name: '登记入库', exact: true }).click();
      await staff.getByRole('dialog').getByLabel('数量', { exact: true }).fill('10.125');
      await staff.getByRole('dialog').getByRole('button', { name: '确认登记', exact: true }).click();
      await staff.getByRole('dialog').waitFor({ state: 'hidden' });
      await leader.getByRole('button', { name: '当前库存：10.125', exact: true }).waitFor();
      await staff.getByRole('button', { name: '登记领用', exact: true }).click();
      await staff.getByRole('dialog').getByLabel('数量', { exact: true }).fill('3.025');
      await staff.getByRole('dialog').getByLabel('领用人', { exact: true }).click();
      await staff.locator('.ant-select-item-option-content').filter({ hasText: 'U6B 员工' }).click();
      await staff.getByRole('dialog').getByLabel('用途或原因', { exact: true }).fill('日常办公');
      await staff.getByRole('dialog').getByRole('button', { name: '确认登记', exact: true }).click();
      await staff.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(
        (await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock.toFixed(3),
        '7.100',
      );
      await staff.getByRole('button', { name: '物品盘点', exact: true }).click();
      await staff.getByRole('dialog').getByLabel('实盘数量', { exact: true }).fill('7');
      await staff.getByRole('dialog').getByLabel('用途或原因', { exact: true }).fill('损耗核对');
      await staff.getByRole('dialog').getByRole('button', { name: '确认登记', exact: true }).click();
      await staff.getByRole('dialog').waitFor({ state: 'hidden' });
      await staff.goto(tableUrl('inventory/movements', { action: 'OUTBOUND' }));
      await staff.getByRole('button', { name: '业务类型：领用出库', exact: true }).waitFor();
      assert.equal(await staff.getByRole('button', { name: '业务类型：入库', exact: true }).count(), 0);
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 1000 });
        await staff.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
        await staff.screenshot({
          path: path.resolve(
            process.cwd(),
            '../../var/collaboration-evidence/u6b-inventory-' + width + '.png',
          ),
          fullPage: true,
          animations: 'disabled',
        });
        assert.ok(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
      }
      await staff.setViewportSize({ width: 1440, height: 1000 });
      await staff.goto(tableUrl('performances'));
      await staff.getByRole('button', { name: '登记绩效', exact: true }).click();
      await staff.getByLabel('被考核人', { exact: true }).click();
      await staff.locator('.ant-select-item-option-content').filter({ hasText: 'U6B 员工' }).click();
      await staff.getByLabel('考核周期', { exact: true }).fill('2026-09');
      await staff.getByRole('button', { name: '保存绩效', exact: true }).click();
      await staff.getByRole('button', { name: '提交自评', exact: true }).waitFor();
      const perf = await db.performance.findFirstOrThrow({ where: { createdBy: editor } });
      await leader.goto(address + 'performances/' + perf.id);
      assert.equal(await leader.getByRole('button', { name: '提交自评', exact: true }).count(), 0);
      await leader.getByRole('button', { name: '设置目标', exact: true }).click();
      await leader.getByRole('dialog').getByLabel('考核目标', { exact: true }).fill('完成库存与客户记录核对');
      await leader.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await leader.getByRole('dialog').waitFor({ state: 'hidden' });
      await staff.getByText('完成库存与客户记录核对', { exact: true }).waitFor();
      await staff.getByRole('button', { name: '提交自评', exact: true }).click();
      await staff.getByRole('dialog').getByLabel('评分', { exact: true }).fill('85');
      await staff.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await staff.getByRole('dialog').waitFor({ state: 'hidden' });
      await leader.getByRole('button', { name: '主管评议', exact: true }).waitFor();
      await leader.getByRole('button', { name: '主管评议', exact: true }).click();
      await leader.getByRole('dialog').getByLabel('评分', { exact: true }).fill('90');
      await leader.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await leader.getByRole('dialog').waitFor({ state: 'hidden' });
      await leader.getByRole('button', { name: '确认绩效', exact: true }).click();
      await leader.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await leader.getByRole('dialog').waitFor({ state: 'hidden' });
      await staff.getByText('已确认', { exact: true }).waitFor();
      assert.equal((await db.performance.findUniqueOrThrow({ where: { id: perf.id } })).version, 5);
      await api('post', '/performances', token, {
        employeeId: people[owner],
        period: '2026-09',
        type: 'MONTHLY',
      }).expect(200);
      const ownQuery = await api(
        'post',
        '/tables/' + tables.performances + '/records/query',
        editorToken,
        {},
      ).expect(200);
      assert.equal(ownQuery.body.data.total, 1);
      const allQuery = await api(
        'post',
        '/tables/' + tables.performances + '/records/query',
        managerToken,
        {},
      ).expect(200);
      assert.equal(allQuery.body.data.total, 2);
      await staff.goto(address + 'payroll');
      await staff.getByRole('button', { name: '刷新工资表', exact: true }).waitFor();
      await staff.getByRole('link', { name: '前往审批管理', exact: true }).waitFor();
      await staff.goto(tableUrl('inventory/items'));
      await staff.getByRole('button', { name: '物品名称：U6B 精确库存', exact: true }).waitFor();
      await db.collabMember.deleteMany({ where: { workspaceId, principalId: editor } });
      await staff
        .getByRole('button', { name: '物品名称：U6B 精确库存', exact: true })
        .waitFor({ state: 'hidden', timeout: 15000 });
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const context of browser.contexts())
        for (const page of context.pages())
          console.error(
            'U6-B failure context',
            page.url(),
            (await page.locator('body').innerText()).slice(-9000),
          );
      throw error;
    } finally {
      security.trustedOrigins.splice(0, security.trustedOrigins.length, ...previousOrigins);
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'U6-C smoke: channel views, scoped dashboard, retries, concurrent edits and revocation',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'u6c-real-app',
          transformIndexHtml: (html: string) => html.replace('/src/main.tsx', '/e2e/unified-harness.tsx'),
        },
      ],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin, changeOrigin: true } } },
    });
    await vite.listen();
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.COLLAB_BROWSER_CHANNEL || undefined,
    });
    const security = (app.config as typeof app.config & { identitySecurity: { trustedOrigins: string[] } })
      .identitySecurity;
    const previousOrigins = [...security.trustedOrigins];
    security.trustedOrigins.push(new URL(vite.resolvedUrls.local[0]).origin);
    try {
      const org = (await db.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } })).organizationId;
      const position = await db.position.create({
        data: { organizationId: org, code: randomUUID(), name: 'U6C 岗位', categoryCode: 'SALES' },
      });
      const manager = await db.user.create({
        data: { username: 'u6c-manager', password: 'unused', mustChangePassword: false },
      });
      const ids = [owner, editor, manager.id],
        people: Record<string, string> = {};
      const permissions = [
        'menu.channel',
        'channel.read',
        'channel.create',
        'channel.update',
        'channel.delete',
        'user.read',
        'organization.read',
        'employee.read',
      ];
      for (const id of ids) {
        const employee = await db.employee.create({
          data: {
            name: id === editor ? 'U6C 员工' : id === owner ? 'U6C 管理员' : 'U6C 负责人',
            employeeNo: randomUUID(),
            phone: '13800000000',
            type: 'SALES',
            status: 'FORMAL',
            entryDate: new Date('2025-01-01'),
          },
        });
        people[id] = employee.id;
        await db.user.update({ where: { id }, data: { employeeId: employee.id } });
        await db.employeeAssignment.create({
          data: {
            employeeId: employee.id,
            organizationId: org,
            positionId: position.id,
            assignmentType: 'PRIMARY',
            startedAt: new Date('2025-01-01'),
          },
        });
        const role = await db.role.create({
          data: {
            name: 'U6C ' + id,
            code: 'U6C_' + id,
            type: 'BUSINESS',
            permissions: { create: permissions.map((code) => ({ permission: { connect: { code } } })) },
          },
        });
        const all = await db.dataScope.create({ data: { name: '选项', scopeType: 'ALL' } });
        const scoped = await db.dataScope.create({
          data: { name: '业务范围', scopeType: id === editor ? 'SELF' : 'ALL' },
        });
        for (const resource of ['channel', 'user', 'organization', 'employee'])
          await db.roleDataScope.create({
            data: { roleId: role.id, resource, dataScopeId: resource === 'employee' ? all.id : scoped.id },
          });
        await db.userRole.create({ data: { userId: id, roleId: role.id } });
      }
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL' },
      });
      const managerToken = (await createApiSession(db, manager.id)).token;
      const tokens = [token, editorToken, managerToken],
        pages = [],
        errors: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          `window.unifiedTestSession = ${JSON.stringify({ mode: 'AUTHENTICATED', token: tokens[i], csrfToken: 'test', expiresIn: 900, user: { id: ids[i], username: ids[i], name: '业务验收成员', roles: [], permissions: [] } })};`,
        );
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, staff, leader] = pages,
        address = vite.resolvedUrls.local[0];
      const api = (
        method: 'get' | 'post' | 'put' | 'delete',
        route: string,
        bearer = token,
        body?: unknown,
      ) => {
        const client = app.httpRequest();
        const call = client[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? call : call.send(body);
      };
      await admin.goto(address + 'channels');
      await admin.getByRole('button', { name: '连接业务数据', exact: true }).click();
      await admin.getByRole('combobox', { name: '连接到应用', exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('接口工作区 / 业务台账', { exact: true })
        .click();
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: /^连\s*接$/ })
        .click();
      await admin.getByRole('button', { name: '字段配置', exact: true }).waitFor();
      const channelTable = new URL(admin.url()).searchParams.get('table')!;
      const tableUrl = address + 'channels?' + new URLSearchParams({ base: baseId, table: channelTable });
      await staff.goto(tableUrl);
      await staff.getByRole('button', { name: '登记渠道', exact: true }).click();
      await staff.getByLabel('工作区', { exact: true }).click();
      await staff.locator('.ant-select-item-option-content').getByText('接口工作区', { exact: true }).click();
      await staff.getByLabel('所属组织', { exact: true }).click();
      await staff
        .locator('.ant-select-item-option-content')
        .getByText('协作接口测试', { exact: true })
        .click();
      await staff.getByLabel('渠道名称', { exact: true }).fill('U6C 精确渠道');
      await staff.getByLabel('渠道成本', { exact: true }).fill('90071992547409.91');
      let dropped = false;
      await staff.route(
        '**/api/v1/channels',
        async (route: {
          request(): { method(): string };
          fetch(): Promise<unknown>;
          abort(reason: string): Promise<void>;
          continue(): Promise<void>;
        }) => {
          if (route.request().method() === 'POST' && !dropped) {
            dropped = true;
            await route.fetch();
            await route.abort('failed');
          } else await route.continue();
        },
      );
      await staff.getByRole('button', { name: '保存渠道', exact: true }).click();
      await staff.getByRole('alert').waitFor();
      assert.equal(await db.channel.count({ where: { createdBy: editor } }), 1);
      await staff.getByRole('button', { name: '保存渠道', exact: true }).click();
      await staff.getByRole('button', { name: '编辑渠道', exact: true }).waitFor();
      const channel = await db.channel.findFirstOrThrow({ where: { createdBy: editor } });
      assert.equal(channel.cost?.toFixed(2), '90071992547409.91');
      const other = (
        await api('post', '/channels', token, {
          name: '负责人渠道',
          type: 'OTHER',
          branchId: org,
          cost: '0.01',
        }).expect(200)
      ).body.data;
      await api('get', '/channels/' + other.id, editorToken).expect(404);
      await staff.getByRole('link', { name: '返回渠道工作表', exact: true }).click();
      await staff.getByRole('button', { name: '渠道名称：U6C 精确渠道', exact: true }).waitFor();
      assert.equal(await staff.getByRole('button', { name: '渠道名称：负责人渠道', exact: true }).count(), 0);
      await leader.goto(tableUrl);
      await leader.getByRole('button', { name: '渠道名称：U6C 精确渠道', exact: true }).waitFor();
      await leader.getByRole('button', { name: '渠道名称：负责人渠道', exact: true }).waitFor();
      const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence');
      await mkdir(evidence, { recursive: true });
      await staff.locator('.ant-message-notice').waitFor({ state: 'hidden' });
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 1000 });
        await staff.screenshot({
          path: path.join(evidence, 'u6c-channels-' + width + '.png'),
          fullPage: true,
        });
        assert.equal(
          await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
      }
      await staff.setViewportSize({ width: 1440, height: 1000 });
      await staff.goto(address + 'channels/' + channel.id);
      await staff.getByRole('button', { name: '编辑渠道', exact: true }).click();
      await staff.getByRole('dialog').getByLabel('渠道名称', { exact: true }).fill('U6C 保留草稿');
      await api('put', '/channels/' + channel.id, managerToken, { name: '负责人已修改', version: 1 }).expect(
        200,
      );
      await staff
        .getByText('渠道已被他人修改，请核对最新详情与当前草稿', { exact: true })
        .waitFor({ timeout: 12000 });
      await staff.getByRole('dialog').getByRole('button', { name: '保存渠道', exact: true }).click();
      assert.equal((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).name, '负责人已修改');
      assert.equal(
        await staff.getByRole('dialog').getByLabel('渠道名称', { exact: true }).inputValue(),
        'U6C 保留草稿',
      );
      await staff.getByRole('button', { name: '已核对，采用最新版本', exact: true }).click();
      await staff.getByRole('dialog').getByRole('button', { name: '保存渠道', exact: true }).click();
      await staff.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal((await db.channel.findUniqueOrThrow({ where: { id: channel.id } })).version, 3);
      await staff.goto(address + 'analytics/overview');
      await staff.getByRole('heading', { name: '经营概览', exact: true }).waitFor();
      await staff.getByText('不可用', { exact: true }).first().waitFor();
      const metrics = (await api('get', '/dashboard/metrics', editorToken).expect(200)).body.data;
      assert.equal(metrics.overview.leadCount, null);
      assert.equal(metrics.overview.customerCount, null);
      assert.equal(metrics.overview.totalRevenue, null);
      assert.equal(metrics.overview.employeeCount, 3);
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 1000 });
        await staff.screenshot({
          path: path.join(evidence, 'u6c-dashboard-' + width + '.png'),
          fullPage: true,
        });
        assert.equal(
          await staff.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
      }
      const legacy = await db.channel.create({
        data: { code: 'U6C-LEGACY', name: '历史待核对渠道', type: 'OTHER' },
      });
      await admin.goto(address + 'channels');
      await admin.getByRole('button', { name: '待补录渠道', exact: true }).click();
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: /^补\s*录$/ })
        .click();
      await admin.getByLabel('确认创建人', { exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('collab-editor', { exact: true })
        .click();
      await admin.getByLabel('确认所属组织', { exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('协作接口测试', { exact: true })
        .click();
      await admin.getByLabel('补录依据', { exact: true }).fill('核对原始渠道登记记录');
      await admin.getByRole('button', { name: '保存归属并记录审计', exact: true }).click();
      await admin.getByText('没有待补录渠道', { exact: true }).waitFor();
      assert.equal((await db.channel.findUniqueOrThrow({ where: { id: legacy.id } })).createdBy, editor);
      assert.equal(
        await db.operationLog.count({ where: { action: 'CHANNEL_IDENTITY_REPAIR', targetId: legacy.id } }),
        1,
      );
      await staff.goto(address + 'channels/' + channel.id);
      await staff.getByRole('button', { name: '编辑渠道', exact: true }).click();
      await staff.getByRole('dialog').getByLabel('渠道说明', { exact: true }).fill('撤权后不能保留的草稿');
      const role = await db.userRole.findFirstOrThrow({ where: { userId: editor } });
      await db.rolePermission.deleteMany({
        where: { roleId: role.roleId, permissionId: 'permission:channel.read' },
      });
      await staff.getByRole('dialog').waitFor({ state: 'hidden', timeout: 12000 });
      await api('get', '/channels/' + channel.id, editorToken).expect(403);
      assert.equal(await staff.getByRole('button', { name: '编辑渠道', exact: true }).count(), 0);
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const context of browser.contexts())
        for (const page of context.pages())
          console.error(
            'U6-C failure context',
            page.url(),
            (await page.locator('body').innerText()).slice(-9000),
          );
      throw error;
    } finally {
      security.trustedOrigins.splice(0, security.trustedOrigins.length, ...previousOrigins);
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'U6-C management smoke: owned notifications, original approval and governance links, denied records and retry',
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
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      // Run browser libraries as in the actual dev App; rc-util test mode hardcodes duplicate DOM IDs.
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'u6c-real-app',
          transformIndexHtml: (html: string) => html.replace('/src/main.tsx', '/e2e/unified-harness.tsx'),
        },
      ],
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: origin, changeOrigin: true } } },
    });
    await vite.listen();
    const browser = await chromium.launch({
      headless: true,
      channel: process.env.COLLAB_BROWSER_CHANNEL || undefined,
    });
    const security = (app.config as typeof app.config & { identitySecurity: { trustedOrigins: string[] } })
      .identitySecurity;
    const previousOrigins = [...security.trustedOrigins];
    security.trustedOrigins.push(new URL(vite.resolvedUrls.local[0]).origin);
    try {
      const role = await db.role.create({
        data: {
          name: '通知管理',
          code: 'SYSTEM_ADMIN',
          type: 'SYSTEM',
          permissions: {
            create: [
              'approval.read',
              'menu.admin_governance',
              'governance.catalog.read',
              'governance.operation.read_self',
            ].map((code) => ({ permission: { connect: { code } } })),
          },
        },
      });
      await db.userRole.create({ data: { userId: owner, roleId: role.id } });
      const businessRole = await db.role.create({
        data: {
          name: '审批读取岗位',
          code: 'U6C_APPROVAL',
          type: 'BUSINESS',
          permissions: { create: { permission: { connect: { code: 'approval.read' } } } },
        },
      });
      await db.userRole.create({ data: { userId: owner, roleId: businessRole.id } });
      const accessToken = (await createApiSession(db, owner, 'MFA')).token;
      const definition = await db.approvalDefinition.create({
        data: {
          code: 'U6C_LINK',
          name: '通知关联审批',
          businessType: 'LEAVE',
          formSchema: { fields: [] },
          approverRule: { type: 'USER', userIds: [editor] },
          createdBy: owner,
        },
      });
      const approval = await db.approvalInstance.create({
        data: {
          definitionId: definition.id,
          definitionVersion: 1,
          businessType: 'LEAVE',
          title: '通知打开的真实审批',
          content: { reason: '验收申请' },
          applicantId: owner,
          createdBy: owner,
        },
      });
      const foreign = await db.approvalInstance.create({
        data: {
          definitionId: definition.id,
          definitionVersion: 1,
          businessType: 'LEAVE',
          title: '不应显示的审批内容',
          content: { reason: '不可见' },
          applicantId: editor,
          createdBy: editor,
        },
      });
      const operation = await db.adminOperation.create({
        data: {
          operationNo: 'GOV-U6C-LINK',
          operationType: 'SYSTEM_ADMIN_GRANT',
          riskLevel: 'HIGH',
          reviewMode: 'PRE',
          status: 'PENDING_REVIEW',
          requesterUserId: owner,
          targetType: 'USER',
          targetId: editor,
          reason: '通知定位治理验收记录',
          payloadSnapshot: { roleCode: 'SYSTEM_ADMIN' },
          payloadHash: 'a'.repeat(64),
          expectedTargetVersion: 1,
          idempotencyKey: randomUUID(),
        },
      });
      for (const row of [
        { title: '审批通知验收', relatedType: 'APPROVAL_INSTANCE', relatedId: approval.id },
        { title: '治理通知验收', relatedType: 'ADMIN_OPERATION', relatedId: operation.id },
        { title: '失效审批通知', relatedType: 'APPROVAL_INSTANCE', relatedId: foreign.id },
        { title: '外部地址通知', routeUrl: 'https://example.org' },
      ])
        await db.notification.create({
          data: { userId: owner, type: 'SYSTEM', content: '通知记录定位验收', ...row },
        });
      await db.notification.create({
        data: { userId: editor, type: 'SYSTEM', title: '其他人的通知不可见', content: '不可见' },
      });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addInitScript(
        `window.unifiedTestSession=${JSON.stringify({ mode: 'AUTHENTICATED', token: accessToken, csrfToken: 'test', expiresIn: 900, user: { id: owner, username: 'collab-owner', name: '通知验收管理员', roles: [], permissions: [] } })};`,
      );
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e: Error) => errors.push(e.message));
      const address = vite.resolvedUrls.local[0];
      await page.goto(address + 'notifications');
      const notificationTable = page.locator('.ant-table-tbody');
      await notificationTable.getByText('审批通知验收', { exact: true }).waitFor();
      assert.equal(await page.getByText('其他人的通知不可见', { exact: true }).count(), 0);
      assert.equal(
        await notificationTable.locator('tr').filter({ hasText: '外部地址通知' }).getByRole('link').count(),
        0,
      );
      await notificationTable
        .locator('tr')
        .filter({ hasText: '审批通知验收' })
        .getByRole('link', { name: '打开关联记录' })
        .click();
      assert.ok(page.url().includes('instance=' + approval.id));
      await page.getByRole('dialog').getByText('通知打开的真实审批', { exact: true }).waitFor();
      await page.goto(address + 'notifications');
      await page
        .locator('.ant-table-tbody tr')
        .filter({ hasText: '治理通知验收' })
        .getByRole('link', { name: '打开关联记录' })
        .click();
      await page.getByRole('dialog').getByText('GOV-U6C-LINK', { exact: true }).waitFor();
      assert.ok(page.url().includes('operationId=' + operation.id));
      await page.goto(address + 'notifications');
      await page
        .locator('.ant-table-tbody tr')
        .filter({ hasText: '失效审批通知' })
        .getByRole('link', { name: '打开关联记录' })
        .click();
      await page.getByText('关联审批不存在、无权查看或加载失败，请刷新重试。', { exact: true }).waitFor();
      assert.equal(await page.getByText('不应显示的审批内容', { exact: true }).count(), 0);
      await page.goto(address + 'notifications');
      await page.locator('.ant-table-tbody').getByText('审批通知验收', { exact: true }).waitFor();
      await page.route('**/api/v1/notifications?*', (route: { abort: () => Promise<void> }) => route.abort());
      await page.getByRole('button', { name: '刷新通知', exact: true }).click();
      await page
        .locator('.ant-table-tbody')
        .getByText('审批通知验收', { exact: true })
        .waitFor({ state: 'hidden' });
      await page.unroute('**/api/v1/notifications?*');
      await page.getByRole('button', { name: /^重\s*试$/ }).click();
      await page.locator('.ant-table-tbody').getByText('审批通知验收', { exact: true }).waitFor();
      await page.getByRole('button', { name: '全部标为已读', exact: true }).click();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('button')).some(
          (e) => e.textContent === '全部标为已读' && e.disabled,
        ),
      );
      assert.equal(await db.notification.count({ where: { userId: owner, isRead: false } }), 0);
      assert.equal(await db.notification.count({ where: { userId: editor, isRead: false } }), 1);
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const context of browser.contexts())
        for (const page of context.pages())
          console.error(
            'U6-C management failure',
            page.url(),
            (await page.locator('body').innerText()).slice(-7000),
          );
      throw error;
    } finally {
      security.trustedOrigins.splice(0, security.trustedOrigins.length, ...previousOrigins);
      await browser.close();
      await vite.close();
    }
  },
);
