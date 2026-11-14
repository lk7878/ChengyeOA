import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { decodeBase32 } from '../../app/domain/security/base32';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { createServer, Server } from 'node:http';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
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

test('recycle-bin purge HTTP command removes uploaded files and cannot be invoked by editors', async () => {
  await db.driveNode.upsert({ where: { id: baseId }, update: {}, create: { id: baseId, baseId, workspaceId, kind: 'BASE', ownerId: owner } });
  const fileBody = { name: 'purge.pdf', content: Buffer.from('%PDF-1.4\npurge regression').toString('base64') };
  const file = await app.httpRequest().post(`/api/v1/tables/${tableId}/files`).set('Authorization', 'Bearer ' + token).send(fileBody).expect(200);
  const endpoint = `/api/v1/drive/nodes/${baseId}/lifecycle`;
  const trash = await app.httpRequest().post(endpoint + '/preview').set('Authorization', 'Bearer ' + token).send({ action: 'TRASH' }).expect(200);
  await app.httpRequest().post(endpoint).set('Authorization', 'Bearer ' + token).set('Idempotency-Key', randomUUID()).send({ action: 'TRASH', previewToken: trash.body.data.previewToken }).expect(200);
  await app.httpRequest().post(`/api/v1/tables/${tableId}/files`).set('Authorization', 'Bearer ' + token).send(fileBody).expect(403);
  await app.httpRequest().post(endpoint + '/preview').set('Authorization', 'Bearer ' + editorToken).send({ action: 'PURGE' }).expect(403);
  const preview = await app.httpRequest().post(endpoint + '/preview').set('Authorization', 'Bearer ' + token).send({ action: 'PURGE' }).expect(200);
  const receipt = randomUUID(), body = { action: 'PURGE', previewToken: preview.body.data.previewToken };
  await app.httpRequest().post(endpoint).set('Authorization', 'Bearer ' + token).set('Idempotency-Key', receipt).send(body).expect(200);
  await app.httpRequest().post(endpoint).set('Authorization', 'Bearer ' + token).set('Idempotency-Key', receipt).send(body).expect(200);
  assert.equal(await db.collabAttachment.count({ where: { id: file.body.data.id } }), 0);
  assert.equal(await db.collabBase.count({ where: { id: baseId } }), 0);
});

test('follow support templates accept valid recordings and enforce upload and relation authorization', async () => {
  const created=await app.httpRequest().post('/api/v1/bases/'+baseId+'/tables').set('Authorization','Bearer '+token).set('Idempotency-Key',randomUUID()).send({name:'签约转化表',template:'SIGNING_CONVERSION'}).expect(200);
  const conversion=created.body.data.id;
  const relation=await db.collabField.findFirstOrThrow({where:{tableId:conversion,name:'线索ID'}});
  const endpoint='/api/v1/tables/'+conversion+'/fields/'+relation.id+'/relation-options';
  await app.httpRequest().post(endpoint).send({}).expect(401);
  await app.httpRequest().post(endpoint).set('Authorization','Bearer '+editorToken).send({}).expect(403);
  for(const [name,bytes] of [['录音.mp3',Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000')],['录音.wav',Buffer.from('RIFF0000WAVEfmt ')],['录音.m4a',Buffer.from('\u0000\u0000\u0000\u0018ftypM4A ')]] as const) {
    const body={name,content:bytes.toString('base64')};
    const uploaded=await app.httpRequest().post('/api/v1/tables/'+tableId+'/files').set('Authorization','Bearer '+token).send(body).expect(200);
    const file=await db.collabAttachment.findUniqueOrThrow({where:{id:uploaded.body.data.id}});
    try {
      assert.ok(file.mimeType.startsWith('audio/'));
      await app.httpRequest().get('/api/v1/tables/'+tableId+'/files/'+file.id).set('Authorization','Bearer '+token).expect(200);
    } finally {
      await db.collabAttachment.delete({where:{id:file.id}});
      await unlink(path.join(process.cwd(),'var','storage','collaboration',file.storageKey));
    }
  }
  await app.httpRequest().post('/api/v1/tables/'+tableId+'/files').set('Authorization','Bearer '+token).send({name:'伪装.mp3',content:Buffer.from('not audio').toString('base64')}).expect(422);
  await db.collabMember.updateMany({where:{workspaceId,principalId:editor},data:{role:'READER'}});
  await app.httpRequest().post('/api/v1/tables/'+tableId+'/files').set('Authorization','Bearer '+editorToken).send({name:'录音.mp3',content:Buffer.from('ID3test').toString('base64')}).expect(403);
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
      const rebaseButton = p2.getByRole('button', { name: '保留本地并复核提交', exact: true });
      // Exercise keyboard confirmation without racing drawer auto-scroll and live layout updates.
      await rebaseButton.focus();
      await rebaseButton.press('Enter');
      await rebaseButton.waitFor({ state: 'hidden' });

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
      for (const [index, page] of pages.entries()) {
        try {
          await page.getByRole('heading', { name: '云盘', exact: true }).waitFor();
        } catch (error) {
          console.error('Drive initial page', index, await page.locator('body').innerText(), errors);
          throw error;
        }
      }
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
      for (const [route, heading, apiPath] of [
        ['org/tree', '组织架构', '/organizations/tree'],
        ['org/positions', '岗位管理', '/positions'],
        ['org/employees', '员工与任职', '/employees'],
        ['security/roles', '角色与权限', '/roles'],
      ]) {
        await api('get', apiPath).expect(200);
        await admin.goto(address + route);
        await admin.getByRole('heading', { name: heading, exact: true }).waitFor();
        assert.equal(await admin.locator('main').count(), 1);
      }
      await admin.getByRole('button', { name: /新建角色/ }).click();
      const roleDialog = admin.getByRole('dialog', { name: '新建业务角色' });
      await roleDialog.getByLabel('角色名称', { exact: true }).fill('U7 自定义岗位角色');
      await roleDialog.getByLabel('角色代码', { exact: true }).fill('u7_custom_role');
      await roleDialog.getByRole('button', { name: /OK|确\s*定/ }).click();
      await roleDialog.waitFor({ state: 'hidden' });
      assert.equal((await db.role.findUniqueOrThrow({ where: { code: 'U7_CUSTOM_ROLE' } })).type, 'BUSINESS');
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
                'user.read',
                'organization.read',
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
        for (const resource of ['customer', 'negotiation', 'contract', 'case', 'user', 'organization'])
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
          path: path.join(evidence, 'u7-channels-' + width + '.png'),
          fullPage: true,
        });
        assert.equal(await staff.getByRole('navigation', { name: '当前区域目录', exact: true }).count(), 0);
        assert.equal(await staff.locator('main').count(), 1);
        assert.equal(await staff.getByText('实时业务表 · 数据来自正式业务', { exact: true }).count(), 0);
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
      const readAllResponse = page.waitForResponse(
        (response: { url: () => string; request: () => { method: () => string }; status: () => number }) =>
          response.url().includes('/notifications/read-all') &&
          response.request().method() === 'POST' &&
          response.status() === 200,
      );
      await page.getByRole('button', { name: '全部标为已读', exact: true }).click();
      await readAllResponse;
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

test(
  'SQ1 real App creates edits governs disables and rolls back SOP templates with MFA and role isolation',
  { skip: process.env.COLLAB_BROWSER_REHEARSAL !== 'true', timeout: 360000 },
  async () => {
    const webRoot = path.resolve(process.cwd(), '../web'),
      load = new Function('url', 'return import(url)');
    const { chromium, expect } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/@playwright/test/index.mjs')).href,
    );
    const { createServer: createViteServer } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/vite/dist/node/index.js')).href,
    );
    const vite = await createViteServer({
      root: webRoot,
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'sq1-real-app',
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
    const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence/sq1');
    await mkdir(evidence, { recursive: true });
    const security = (app.config as typeof app.config & { identitySecurity: { trustedOrigins: string[] } })
      .identitySecurity;
    const previousOrigins = [...security.trustedOrigins];
    security.trustedOrigins.push(new URL(vite.resolvedUrls.local[0]).origin);
    const errors: string[] = [];
    try {
      for (const [id, code] of [
        [owner, 'SYSTEM_ADMIN'],
        [editor, 'SYSTEM_SUPER_ADMIN'],
      ]) {
        const role = await db.role.create({ data: { code, name: code, type: 'SYSTEM' } });
        await db.userRole.create({ data: { userId: id, roleId: role.id } });
      }
      const org = (await db.organization.findFirstOrThrow()).id;
      await db.professionalTeam.create({
        data: { code: 'SQ1_MEDICAL', name: 'SQ1医疗团队', categoryCode: 'MEDICAL', homeOrganizationId: org },
      });
      const ordinary = await db.user.create({
        data: { username: 'sq1-ordinary', password: 'unused', mustChangePassword: false },
      });
      const sessions = await Promise.all([
        createApiSession(db, owner, 'MFA'),
        createApiSession(db, editor, 'MFA'),
        createApiSession(db, ordinary.id),
      ]);
      const pages = [];
      for (const [i, id] of [owner, editor, ordinary.id].entries()) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addCookies([
          { name: 'chengye_csrf', value: sessions[i].csrfToken, url: vite.resolvedUrls.local[0] },
        ]);
        await context.addInitScript(
          'window.unifiedTestSession=' +
            JSON.stringify({
              mode: 'AUTHENTICATED',
              token: sessions[i].token,
              csrfToken: sessions[i].csrfToken,
              expiresIn: 900,
              user: { id, username: id, name: 'SQ1验收', roles: [], permissions: [] },
            }) +
            ';',
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, reviewer, staff] = pages,
        address = vite.resolvedUrls.local[0];
      await admin.goto(address + 'admin/sop-templates');
      await admin.getByRole('button', { name: '新建模板', exact: true }).click();
      const drawer = admin.getByRole('dialog', { name: '新建SOP模板' });
      await drawer.getByLabel('模板编码', { exact: true }).fill('SQ1_UI');
      await drawer.getByLabel('模板名称', { exact: true }).fill('SQ1医疗流程');
      await drawer.getByLabel('所属组织', { exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('协作接口测试', { exact: true })
        .click();
      await drawer.getByLabel('专业团队', { exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('SQ1医疗团队', { exact: true })
        .click();
      await drawer.getByLabel('适用案件类型', { exact: true }).fill('医疗纠纷');
      await drawer.getByRole('button', { name: '保存草稿', exact: true }).click();
      await admin.getByRole('heading', { name: 'SQ1医疗流程', exact: true }).waitFor();
      const template = await db.sopTemplate.findUniqueOrThrow({ where: { code: 'SQ1_UI' } });
      const revision = await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: template.id } });
      await admin.getByRole('button', { name: '编辑草稿', exact: true }).click();
      const edit = admin.getByRole('dialog', { name: '编辑SOP草稿' });
      await edit.getByLabel('节点1说明', { exact: true }).fill('已检查材料清单与适用团队');
      await edit.getByRole('button', { name: '保存草稿', exact: true }).click();
      await edit.waitFor({ state: 'hidden' });
      await expect(admin.getByLabel('节点1说明', { exact: true })).toHaveValue('已检查材料清单与适用团队');
      // A concurrent edit returns 409 while preserving the local draft.
      await admin.getByRole('button', { name: '编辑草稿', exact: true }).click();
      await edit.getByLabel('节点1说明', { exact: true }).fill('保留冲突草稿');
      const concurrent = await db.sopTemplateVersion.findUniqueOrThrow({ where: { id: revision.id } });
      await app
        .httpRequest()
        .put('/api/v1/sop/template-versions/' + revision.id)
        .set('Authorization', 'Bearer ' + sessions[0].token)
        .send({ expectedVersion: concurrent.version, content: concurrent.content })
        .expect(200);
      await edit.getByRole('button', { name: '保存草稿', exact: true }).click();
      await admin.getByText(/模板版本已变化或不可编辑/).waitFor();
      await expect(edit.getByLabel('节点1说明', { exact: true })).toHaveValue('保留冲突草稿');
      await edit.getByRole('button', { name: 'Close', exact: true }).click();
      async function mfa(page: typeof admin, userId: string) {
        await page.getByRole('dialog', { name: '再次验证身份' }).waitFor();
        const factor = await db.mfaFactor.findFirstOrThrow({ where: { userId, disabledAt: null } });
        while (
          factor.lastAcceptedCounter !== null &&
          BigInt(Math.floor(Date.now() / 30000)) <= factor.lastAcceptedCounter
        )
          await new Promise((resolve) => setTimeout(resolve, 1000));
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
        await page
          .getByLabel('当前六位验证码', { exact: true })
          .fill(
            ((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1000000)
              .toString()
              .padStart(6, '0'),
          );
        const responsePromise = page.waitForResponse((r: { url: () => string }) =>
          r.url().includes('/auth/step-up'),
        );
        await page.getByRole('button', { name: '验证并继续', exact: true }).click();
        const response = await responsePromise;
        assert.equal(response.status(), 200, JSON.stringify((await response.json()).message));
        await page.getByRole('dialog', { name: '再次验证身份' }).waitFor({ state: 'hidden' });
      }
      for (const action of ['发布', '停用', '发布']) {
        if (
          action === '发布' &&
          (await db.sopTemplateVersion.count({ where: { templateId: template.id, status: 'DISABLED' } }))
        ) {
          await admin.getByRole('button', { name: '复制此版本为新草稿', exact: true }).click();
          await admin.getByRole('button', { name: '编辑草稿', exact: true }).waitFor();
        }
        await admin.getByRole('button', { name: '申请' + action, exact: true }).click();
        const dialog = admin.getByRole('dialog', { name: '申请' + action + '模板', exact: true });
        await dialog.getByLabel('申请原因', { exact: true }).fill('已核验团队节点及适用范围后申请' + action);
        await dialog.getByRole('button', { name: '提交申请', exact: true }).click();
        await mfa(admin, owner);
        await dialog.waitFor({ state: 'hidden' });
        const op = await db.adminOperation.findFirstOrThrow({
          where: { targetType: 'SOP_TEMPLATE_VERSION', status: 'PENDING_REVIEW' },
        });
        await reviewer.goto(address + 'security/admin-governance?operationId=' + op.id);
        await reviewer.getByRole('link', { name: '核对本次申请的SOP模板版本', exact: true }).click();
        await expect(reviewer.getByLabel('节点1说明', { exact: true })).toHaveValue(
          '已检查材料清单与适用团队',
        );
        await reviewer.goto(address + 'security/admin-governance');
        await reviewer.getByRole('tab', { name: '待我审核', exact: true }).click();
        await reviewer.getByRole('button', { name: '审核 ' + op.operationNo, exact: true }).click();
        await reviewer
          .getByRole('dialog', { name: '治理审核', exact: true })
          .getByRole('button', { name: '提交审核', exact: true })
          .click();
        await mfa(reviewer, editor);
        await expect
          .poll(async () => (await db.adminOperation.findUniqueOrThrow({ where: { id: op.id } })).status)
          .toBe('SUCCEEDED');
        await admin.getByRole('button', { name: '刷新模板', exact: true }).click();
        await admin
          .getByRole('button', { name: action === '发布' ? '申请停用' : '申请发布', exact: true })
          .waitFor({ state: action === '发布' ? 'visible' : 'hidden' });
        if (action === '停用')
          await expect(admin.locator('.ant-tag').getByText('已停用', { exact: true })).toBeVisible();
      }
      assert.equal(await db.sopTemplateVersion.count({ where: { templateId: template.id } }), 2);
      assert.equal(
        (await db.sopTemplateVersion.findUniqueOrThrow({ where: { id: revision.id } })).status,
        'DISABLED',
      );
      for (const width of [1440, 1024, 390]) {
        await admin.setViewportSize({ width, height: 1000 });
        await admin.screenshot({ path: path.join(evidence, 'templates-' + width + '.png'), fullPage: true });
        assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
      }
      await app
        .httpRequest()
        .get('/api/v1/sop/templates')
        .set('Authorization', 'Bearer ' + sessions[2].token)
        .expect(403);
      await staff.goto(address + 'admin/sop-templates');
      await expect(staff.getByRole('button', { name: '新建模板', exact: true })).toHaveCount(0);
      await db.userRole.deleteMany({ where: { userId: owner } });
      await admin.getByRole('button', { name: '刷新模板', exact: true }).click();
      await admin.getByRole('heading', { name: 'SQ1医疗流程', exact: true }).waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const [i, context] of browser.contexts().entries())
        for (const page of context.pages())
          await page
            .screenshot({ path: path.join(evidence, 'failed-' + i + '.png'), fullPage: true })
            .catch(() => undefined);
      throw error;
    } finally {
      security.trustedOrigins.splice(0, security.trustedOrigins.length, ...previousOrigins);
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'SQ2 real App shares native SOP tasks across administrator manager and assignee with revocation',
  { skip: process.env.COLLAB_BROWSER_REHEARSAL !== 'true', timeout: 300000 },
  async () => {
    const webRoot = path.resolve(process.cwd(), '../web'),
      load = new Function('url', 'return import(url)');
    const { chromium, expect } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/@playwright/test/index.mjs')).href,
    );
    const { createServer: createViteServer } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/vite/dist/node/index.js')).href,
    );
    const vite = await createViteServer({
      root: webRoot,
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'sq2-real-app',
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
    const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence/sq2');
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];
    try {
      const adminRole = await db.role.create({
        data: { code: 'SYSTEM_SUPER_ADMIN', name: '系统管理员', type: 'SYSTEM' },
      });
      await db.userRole.create({ data: { userId: owner, roleId: adminRole.id } });
      const adminToken = (await createApiSession(db, owner, 'MFA')).token;
      const employee = await db.employee.create({
        data: {
          employeeNo: 'SQ2_STAFF',
          name: 'SQ2办案人',
          phone: '13800000000',
          type: 'ASSISTANT',
          entryDate: new Date(),
        },
      });
      await db.user.update({ where: { id: editor }, data: { employeeId: employee.id } });
      const self = await db.dataScope.create({ data: { name: '本人SOP', scopeType: 'SELF' } });
      const staffRole = await db.role.create({
        data: {
          code: 'SQ2_STAFF',
          name: '办理岗',
          type: 'BUSINESS',
          permissions: {
            create: ['menu.sop_tasks', 'sop.task.read', 'sop.task.execute'].map((code) => ({
              permission: { connect: { code } },
            })),
          },
          dataScopes: { create: { resource: 'sop_task', dataScopeId: self.id } },
        },
      });
      await db.userRole.create({ data: { userId: editor, roleId: staffRole.id } });
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      const manager = await db.user.create({
        data: { username: 'sq2-manager', password: 'unused', mustChangePassword: false },
      });
      const all = await db.dataScope.create({ data: { name: '团队验收全范围', scopeType: 'ALL' } });
      const managerRole = await db.role.create({
        data: {
          code: 'SQ2_MANAGER',
          name: '负责人',
          type: 'BUSINESS',
          permissions: {
            create: [
              'menu.sop_tasks',
              'sop.task.read',
              'sop.task.manage',
              'sop.task.execute',
              'sop.instance.read',
              'sop.instance.manage',
              'case.task.manage',
              'employee.read',
            ].map((code) => ({ permission: { connect: { code } } })),
          },
          dataScopes: {
            create: ['sop_task', 'sop_instance', 'case', 'employee'].map((resource) => ({
              resource,
              dataScopeId: all.id,
            })),
          },
        },
      });
      await db.userRole.create({ data: { userId: manager.id, roleId: managerRole.id } });
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL', canCreate: true },
      });
      const managerToken = (await createApiSession(db, manager.id)).token;
      const org = (await db.organization.findFirstOrThrow()).id;
      const team = await db.professionalTeam.create({
        data: { code: 'SQ2_TEAM', name: 'SQ2医疗团队', categoryCode: 'MEDICAL', homeOrganizationId: org },
      });
      const api = (method: 'get' | 'post', route: string, bearer = adminToken, body?: unknown) => {
        const client = app.httpRequest();
        const req = client[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? req : req.send(body);
      };
      const template = (
        await api('post', '/sop/templates', adminToken, {
          code: 'SQ2_UI',
          name: 'SQ2医疗交付',
          organizationId: org,
          professionalTeamId: team.id,
          caseType: '医疗纠纷',
          requestKey: randomUUID(),
          content: {
            schemaVersion: 1,
            nodes: [
              { code: 'COLLECT', name: 'SQ2材料收集' },
              { code: 'DELIVER', name: 'SQ2交付报告', dependsOn: ['COLLECT'] },
            ],
          },
        }).expect(200)
      ).body.data;
      const version = await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: template.id } });
      await db.sopTemplateVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED' } });
      await db.sopTemplate.update({ where: { id: template.id }, data: { activeVersionId: version.id } });
      const customer = await db.customer.create({
        data: {
          customerNo: 'SQ2_CUSTOMER',
          name: '保密客户',
          phone: '13800000000',
          phoneHash: 'test',
          createdBy: owner,
        },
      });
      const caseRow = await db.case.create({
        data: {
          caseNo: 'SQ2_CASE',
          title: '不向仅获派任务人员公开的案件',
          caseType: '医疗纠纷',
          customerId: customer.id,
          branchId: org,
          teamIds: JSON.stringify([team.id]),
          createdBy: owner,
        },
      });
      const table = (
        await api('post', '/bases/' + baseId + '/tables', adminToken, {
          name: 'SOP交付工作表',
          source: 'SOP_TASKS',
        }).expect(200)
      ).body.data;
      const pages = [];
      for (const [id, bearer] of [
        [owner, adminToken],
        [editor, editorToken],
        [manager.id, managerToken],
      ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          'window.unifiedTestSession=' +
            JSON.stringify({
              mode: 'AUTHENTICATED',
              token: bearer,
              csrfToken: 'test',
              expiresIn: 900,
              user: { id, username: id, name: 'SQ2验收', roles: [], permissions: [] },
            }) +
            ';',
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, staff, leader] = pages,
        address = vite.resolvedUrls.local[0],
        tableUrl = address + 'sop/tasks?' + new URLSearchParams({ base: baseId, table: table.id });
      await admin.goto(address + 'sop/instances/new?case=' + caseRow.id);
      await admin.getByLabel('已发布模板', { exact: true }).click();
      await admin
        .locator('.ant-select-item-option-content')
        .getByText('SQ2医疗交付 · 医疗纠纷', { exact: true })
        .click();
      await admin.getByRole('button', { name: '确认启动', exact: true }).click();
      await admin.getByRole('link', { name: 'SQ2材料收集', exact: true }).click();
      const task = await db.caseTask.findFirstOrThrow({ where: { caseId: caseRow.id, nodeCode: 'COLLECT' } });
      await staff.goto(tableUrl);
      await leader.goto(tableUrl);
      await leader.getByRole('button', { name: '节点任务：SQ2材料收集', exact: true }).waitFor();
      await expect(staff.getByRole('button', { name: '节点任务：SQ2材料收集', exact: true })).toHaveCount(0);
      await admin.getByRole('button', { name: '分派任务', exact: true }).click();
      await admin.getByRole('dialog', { name: '分派任务' }).getByLabel('负责人', { exact: true }).click();
      await admin.locator('.ant-select-item-option-content').getByText('SQ2办案人', { exact: true }).click();
      await admin
        .getByRole('dialog', { name: '分派任务' })
        .getByRole('button', { name: '确认办理', exact: true })
        .click();
      await staff.getByRole('button', { name: '节点任务：SQ2材料收集', exact: true }).waitFor();
      await staff.getByRole('button', { name: '创建个人视图', exact: true }).click();
      await expect
        .poll(
          async () =>
            await db.collabView.count({
              where: { tableId: table.id, ownerId: editor, name: '分派给我的任务' },
            }),
        )
        .toBe(1);
      const detail = (await api('get', '/sop/tasks/' + task.id, editorToken).expect(200)).body.data;
      assert.equal(detail.case, null);
      await api('get', '/cases/' + caseRow.id, editorToken).expect(403);
      await api('get', '/cases/' + caseRow.id + '/files', editorToken).expect(403);
      await staff.goto(address + 'sop/tasks/' + task.id);
      await staff.getByRole('button', { name: '开始办理', exact: true }).click();
      await staff
        .getByRole('dialog')
        .getByLabel('办理说明', { exact: true })
        .fill('材料已收集，保持原任务ID');
      await staff.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await expect
        .poll(async () => (await db.caseTask.findUniqueOrThrow({ where: { id: task.id } })).status)
        .toBe('IN_PROGRESS');
      await leader.getByRole('button', { name: /执行状态：.*办理|执行状态：IN_PROGRESS/ }).waitFor();
      await staff.getByRole('button', { name: '完成节点', exact: true }).click();
      await staff.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await expect
        .poll(async () => (await db.caseTask.findUniqueOrThrow({ where: { id: task.id } })).status)
        .toBe('COMPLETED');
      const second = await db.caseTask.findFirstOrThrow({
        where: { caseId: caseRow.id, nodeCode: 'DELIVER' },
      });
      await api('post', '/sop/tasks/' + second.id + '/actions', managerToken, {
        action: 'ASSIGN',
        expectedVersion: second.version,
        requestKey: randomUUID(),
        assigneeUserId: editor,
      }).expect(200);
      await staff.goto(address + 'sop/tasks/' + second.id);
      await staff.getByRole('button', { name: '开始办理', exact: true }).waitFor();
      for (const width of [1440, 1024, 390]) {
        await staff.setViewportSize({ width, height: 1000 });
        await staff.screenshot({ path: path.join(evidence, 'task-' + width + '.png'), fullPage: true });
        assert.ok(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
      }
      const current = await db.caseTask.findUniqueOrThrow({ where: { id: second.id } });
      await api('post', '/sop/tasks/' + second.id + '/actions', managerToken, {
        action: 'ASSIGN',
        expectedVersion: current.version,
        requestKey: randomUUID(),
        assigneeUserId: null,
      }).expect(200);
      await staff
        .getByRole('heading', { name: 'SQ2交付报告', exact: true })
        .waitFor({ state: 'hidden', timeout: 15000 });
      await api('get', '/sop/tasks/' + second.id, editorToken).expect(404);
      assert.equal(await db.collabRecord.count(), 0);
      assert.equal(await db.caseTask.count(), 2);
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const [i, context] of browser.contexts().entries())
        for (const page of context.pages())
          await page
            .screenshot({ path: path.join(evidence, 'failed-' + i + '.png'), fullPage: true })
            .catch(() => undefined);
      throw error;
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'SQ3 real App freezes deliverables returns revisions and uses original approvals',
  { skip: process.env.COLLAB_BROWSER_REHEARSAL !== 'true', timeout: 300000 },
  async () => {
    const webRoot = path.resolve(process.cwd(), '../web'),
      load = new Function('url', 'return import(url)');
    const { chromium, expect } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/@playwright/test/index.mjs')).href,
    );
    const { createServer: createViteServer } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/vite/dist/node/index.js')).href,
    );
    const vite = await createViteServer({
      root: webRoot,
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'sq3-real-app',
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
    const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence/sq3');
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];
    try {
      const adminRole = await db.role.create({
        data: { code: 'SYSTEM_SUPER_ADMIN', name: '系统管理员', type: 'SYSTEM' },
      });
      await db.userRole.create({ data: { userId: owner, roleId: adminRole.id } });
      const adminToken = (await createApiSession(db, owner, 'MFA')).token;
      const employee = await db.employee.create({
        data: {
          employeeNo: 'SQ3_STAFF',
          name: 'SQ3办案人',
          phone: '13800000000',
          type: 'ASSISTANT',
          entryDate: new Date(),
        },
      });
      await db.user.update({ where: { id: editor }, data: { employeeId: employee.id } });
      const self = await db.dataScope.create({ data: { name: '本人SOP', scopeType: 'SELF' } });
      const staffRole = await db.role.create({
        data: {
          code: 'SQ3_STAFF',
          name: '办理岗',
          type: 'BUSINESS',
          permissions: {
            create: ['menu.sop_tasks', 'sop.task.read', 'sop.task.execute'].map((code) => ({
              permission: { connect: { code } },
            })),
          },
          dataScopes: { create: { resource: 'sop_task', dataScopeId: self.id } },
        },
      });
      await db.userRole.create({ data: { userId: editor, roleId: staffRole.id } });
      await db.collabMember.updateMany({
        where: { workspaceId, principalId: editor },
        data: { rowScope: 'SELF' },
      });
      const manager = await db.user.create({
        data: { username: 'sq3-manager', password: 'unused', mustChangePassword: false },
      });
      const reviewerEmployee = await db.employee.create({
        data: {
          employeeNo: 'SQ3_REVIEWER',
          name: 'SQ3审核负责人',
          phone: '13800000000',
          type: 'LAWYER',
          entryDate: new Date(),
        },
      });
      await db.user.update({ where: { id: manager.id }, data: { employeeId: reviewerEmployee.id } });
      const all = await db.dataScope.create({ data: { name: '团队验收全范围', scopeType: 'ALL' } });
      const managerRole = await db.role.create({
        data: {
          code: 'SQ3_MANAGER',
          name: '负责人',
          type: 'BUSINESS',
          permissions: {
            create: [
              'menu.sop_tasks',
              'sop.task.read',
              'sop.task.manage',
              'sop.task.execute',
              'sop.report.read',
              'sop.guidance.read',
              'sop.guidance.create',
              'quality.review.read',
              'quality.review.decide',
              'approval.read',
              'approval.process',
              'case.file.read',
              'sop.instance.read',
              'sop.instance.manage',
              'case.task.manage',
              'employee.read',
            ].map((code) => ({ permission: { connect: { code } } })),
          },
          dataScopes: {
            create: ['sop_task', 'sop_instance', 'case', 'employee'].map((resource) => ({
              resource,
              dataScopeId: all.id,
            })),
          },
        },
      });
      await db.userRole.create({ data: { userId: manager.id, roleId: managerRole.id } });
      await db.collabMember.create({
        data: { workspaceId, principalId: manager.id, role: 'MANAGER', rowScope: 'ALL', canCreate: true },
      });
      const managerToken = (await createApiSession(db, manager.id)).token;
      const org = (await db.organization.findFirstOrThrow()).id;
      const team = await db.professionalTeam.create({
        data: { code: 'SQ3_TEAM', name: 'SQ3医疗团队', categoryCode: 'MEDICAL', homeOrganizationId: org },
      });
      const api = (method: 'get' | 'post', route: string, bearer = adminToken, body?: unknown) => {
        const client = app.httpRequest();
        const req = client[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? req : req.send(body);
      };
      const template = (
        await api('post', '/sop/templates', adminToken, {
          code: 'SQ3_UI',
          name: 'SQ3医疗交付',
          organizationId: org,
          professionalTeamId: team.id,
          caseType: '医疗纠纷',
          requestKey: randomUUID(),
          content: {
            schemaVersion: 1,
            nodes: [
              {
                code: 'REPORT',
                name: 'SQ3分析报告',
                reviewRequired: true,
                closeGate: true,
                materials: [{ code: 'MATERIAL', name: '分析材料', required: true }],
              },
            ],
          },
        }).expect(200)
      ).body.data;
      const version = await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: template.id } });
      await db.sopTemplateVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED' } });
      await db.sopTemplate.update({ where: { id: template.id }, data: { activeVersionId: version.id } });
      const customer = await db.customer.create({
        data: {
          customerNo: 'SQ3_CUSTOMER',
          name: '保密客户',
          phone: '13800000000',
          phoneHash: 'test',
          createdBy: owner,
        },
      });
      const caseRow = await db.case.create({
        data: {
          caseNo: 'SQ3_CASE',
          title: '不向仅获派任务人员公开的案件',
          caseType: '医疗纠纷',
          customerId: customer.id,
          branchId: org,
          teamIds: JSON.stringify([team.id]),
          createdBy: owner,
        },
      });
      const table = (
        await api('post', '/bases/' + baseId + '/tables', adminToken, {
          name: 'SOP交付工作表',
          source: 'SOP_TASKS',
        }).expect(200)
      ).body.data;
      const started = (
        await api('post', '/sop/instances', adminToken, {
          caseId: caseRow.id,
          templateVersionId: version.id,
          batchKey: 'PRIMARY',
          requestKey: randomUUID(),
        }).expect(200)
      ).body.data;
      const task = await db.caseTask.findFirstOrThrow({ where: { sopInstanceId: started.id } });
      await api('post', '/sop/tasks/' + task.id + '/actions', adminToken, {
        action: 'START',
        expectedVersion: task.version,
        requestKey: randomUUID(),
      }).expect(200);
      await api('post', '/cases/' + caseRow.id + '/files', adminToken, {
        fileName: '医疗分析材料.txt',
        fileType: 'text/plain',
        base64: Buffer.from('医疗试点隔离材料').toString('base64'),
      }).expect(200);
      const pages = [];
      for (const [id, bearer] of [
        [owner, adminToken],
        [manager.id, managerToken],
        [editor, editorToken],
      ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          'window.unifiedTestSession=' +
            JSON.stringify({
              mode: 'AUTHENTICATED',
              token: bearer,
              csrfToken: 'test',
              expiresIn: 900,
              user: { id, username: id, name: 'SQ3验收', roles: [], permissions: [] },
            }) +
            ';',
        );
        const page = await context.newPage();
        page.on('pageerror', (error: Error) => errors.push(error.message));
        pages.push(page);
      }
      const [admin, reviewer, staff] = pages,
        address = vite.resolvedUrls.local[0];
      await admin.goto(address + 'sop/tasks/' + task.id);
      await admin.getByLabel('指导内容').fill('先核对材料来源和风险说明，再提交审核');
      await admin.getByRole('button', { name: '保存指导', exact: true }).click();
      await expect.poll(async () => await db.expertGuidance.count()).toBe(1);
      let injected = 0;
      await admin.route(
        '**/api/v1/sop/tasks/' + task.id + '/submissions',
        async (route: {
          request(): { method(): string };
          continue(): Promise<void>;
          abort(reason: string): Promise<void>;
          fulfill(value: { status: number; contentType: string; body: string }): Promise<void>;
        }) => {
          if (route.request().method() !== 'POST') return route.continue();
          injected++;
          if (injected === 1) return route.abort('internetdisconnected');
          if (injected === 2)
            return route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ code: 409, message: 'SOP_VERSION_CONFLICT' }),
            });
          return route.continue();
        },
      );
      async function submit(report: string) {
        await admin.getByRole('button', { name: '提交节点成果', exact: true }).click();
        const dialog = admin.getByRole('dialog', { name: '提交节点成果' });
        await dialog.getByLabel('成果报告', { exact: true }).fill(report);
        await dialog.getByLabel('分析材料（必需）', { exact: true }).click();
        await admin
          .locator('.ant-select-item-option-content')
          .getByText('医疗分析材料.txt', { exact: true })
          .click();
        await dialog.getByLabel('成果报告', { exact: true }).click();
        await dialog.getByLabel('审核人', { exact: true }).click();
        await admin
          .locator('.ant-select-item-option-content')
          .getByText('SQ3审核负责人', { exact: true })
          .click();
        await dialog.getByLabel('成果报告', { exact: true }).click();
        await dialog.getByRole('button', { name: '提交成果', exact: true }).click();
        if (injected < 3) {
          await expect.poll(() => injected).toBe(1);
          await expect(dialog.getByLabel('成果报告', { exact: true })).toHaveValue(report);
          await expect(dialog.getByRole('button', { name: '提交成果', exact: true })).toBeEnabled({
            timeout: 15000,
          });
          await dialog.getByRole('button', { name: '提交成果', exact: true }).click();
          await dialog.getByRole('button', { name: '采用最新任务版本', exact: true }).waitFor();
          await expect(dialog.getByLabel('成果报告', { exact: true })).toHaveValue(report);
          await dialog.getByRole('button', { name: '采用最新任务版本', exact: true }).click();
          await dialog
            .getByRole('button', { name: '采用最新任务版本', exact: true })
            .waitFor({ state: 'hidden' });
          await dialog.getByRole('button', { name: '提交成果', exact: true }).click();
        }
        await dialog.waitFor({ state: 'hidden' });
      }
      await submit('第一版报告，需要负责人检查风险');
      let submission = await db.sopSubmission.findFirstOrThrow({
        where: { taskId: task.id },
        orderBy: { number: 'desc' },
      });
      await reviewer.goto(address + 'sop/submissions/' + submission.id);
      await reviewer.getByRole('heading', { name: '成果修订 1', exact: true }).waitFor();
      const downloadPromise = reviewer.waitForEvent('download');
      await reviewer.getByRole('button', { name: '医疗分析材料.txt', exact: true }).click();
      assert.equal((await downloadPromise).suggestedFilename(), '医疗分析材料.txt');
      await reviewer.getByRole('link', { name: '进入原审批中心办理', exact: true }).click();
      await reviewer
        .getByRole('dialog', { name: '审批详情', exact: true })
        .locator('.ant-modal-close')
        .click();
      await reviewer.getByRole('button', { name: '驳回', exact: true }).click();
      await reviewer
        .getByRole('dialog', { name: '驳回审批' })
        .getByLabel('审批意见（可选）')
        .fill('请补充风险与目标对齐说明');
      await reviewer.getByRole('button', { name: '确认驳回', exact: true }).click();
      await expect
        .poll(async () => (await db.caseTask.findUniqueOrThrow({ where: { id: task.id } })).status)
        .toBe('CHANGES_REQUESTED');
      await admin.getByRole('button', { name: '开始办理', exact: true }).click();
      await admin.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await submit('第二版报告：已补充风险与目标对齐说明');
      submission = await db.sopSubmission.findFirstOrThrow({
        where: { taskId: task.id },
        orderBy: { number: 'desc' },
      });
      assert.equal(submission.number, 2);
      await reviewer.goto(address + 'sop/submissions/' + submission.id);
      for (const label of ['MATERIALS检查结果', 'REPORT检查结果']) {
        await reviewer.getByLabel(label, { exact: true }).click();
        const listId = await reviewer.getByLabel(label, { exact: true }).getAttribute('aria-controls');
        assert.ok(listId);
        await reviewer
          .locator('.ant-select-dropdown')
          .filter({ has: reviewer.locator('[id=' + JSON.stringify(listId) + ']') })
          .locator('.ant-select-item-option-content')
          .getByText('通过', { exact: true })
          .click();
      }
      await reviewer.getByRole('button', { name: '保存检查清单', exact: true }).click();
      await expect
        .poll(async () =>
          JSON.stringify(
            (await db.qualityReview.findUniqueOrThrow({ where: { submissionId: submission.id } })).checklist,
          ),
        )
        .toContain('PASS');
      for (const width of [1440, 1024, 390]) {
        await reviewer.setViewportSize({ width, height: 1000 });
        await reviewer.screenshot({
          path: path.join(evidence, 'submission-' + width + '.png'),
          fullPage: true,
        });
        assert.ok(await reviewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      }
      await reviewer.setViewportSize({ width: 1440, height: 1000 });
      await reviewer.getByRole('link', { name: '进入原审批中心办理', exact: true }).click();
      await reviewer
        .getByRole('dialog', { name: '审批详情', exact: true })
        .locator('.ant-modal-close')
        .click();
      await reviewer.getByRole('button', { name: '审批通过', exact: true }).click();
      await reviewer.getByRole('button', { name: '确认通过', exact: true }).click();
      await expect
        .poll(async () => (await db.caseTask.findUniqueOrThrow({ where: { id: task.id } })).status)
        .toBe('COMPLETED');
      await api('get', '/sop/submissions/' + submission.id, editorToken).expect(403);
      await staff.goto(address + 'sop/submissions/' + submission.id);
      await expect(staff.getByText('第二版报告：已补充风险与目标对齐说明', { exact: true })).toHaveCount(0);
      await reviewer.goto(address + 'sop/submissions/' + submission.id);
      await reviewer.getByRole('heading', { name: '成果修订 2', exact: true }).waitFor();
      await db.userRole.deleteMany({ where: { userId: manager.id } });
      await reviewer
        .getByRole('heading', { name: '成果修订 2', exact: true })
        .waitFor({ state: 'hidden', timeout: 15000 });
      assert.equal(await db.sopSubmission.count(), 2);
      assert.equal(await db.collabRecord.count({ where: { tableId: table.id } }), 0);
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const [index, context] of browser.contexts().entries())
        for (const page of context.pages()) {
          await writeFile(
            path.join(evidence, 'failed-aria-' + index + '.txt'),
            await page.locator('body').ariaSnapshot(),
          );
          await writeFile(
            path.join(evidence, 'failed-dom-' + index + '.json'),
            JSON.stringify(
              await page.locator('[role=dialog]').evaluateAll((nodes: Element[]) =>
                nodes.map((node) => ({
                  hiddenAncestors: (() => {
                    const rows = [];
                    let n: Element | null = node;
                    while (n) {
                      if (n.hasAttribute('aria-hidden') || n.hasAttribute('inert'))
                        rows.push(n.outerHTML.slice(0, 220));
                      n = n.parentElement;
                    }
                    return rows;
                  })(),
                  text: node.textContent,
                  label: node.getAttribute('aria-label'),
                  labelledBy: node.getAttribute('aria-labelledby'),
                  title: document.getElementById(node.getAttribute('aria-labelledby') || '')?.textContent,
                  buttons: [...node.querySelectorAll('button')].map((b) => ({
                    text: b.textContent,
                    label: b.getAttribute('aria-label'),
                  })),
                })),
              ),
              null,
              2,
            ),
          );
        }

      for (const [i, context] of browser.contexts().entries())
        for (const page of context.pages())
          await page
            .screenshot({ path: path.join(evidence, 'failed-' + i + '.png'), fullPage: true })
            .catch(() => undefined);
      throw error;
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'SQ4 real App samples closed cases and remediates without altering original lifecycle',
  { skip: process.env.COLLAB_BROWSER_REHEARSAL !== 'true', timeout: 300000 },
  async () => {
    const webRoot = path.resolve(process.cwd(), '../web'),
      load = new Function('url', 'return import(url)');
    const { chromium, expect } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/@playwright/test/index.mjs')).href,
    );
    const { createServer: createViteServer } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/vite/dist/node/index.js')).href,
    );
    const vite = await createViteServer({
      root: webRoot,
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'sq3-real-app',
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
    const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence/sq4');
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];
    try {
      const role = await db.role.create({
        data: { code: 'SYSTEM_SUPER_ADMIN', name: '系统管理员', type: 'SYSTEM' },
      });
      await db.userRole.create({ data: { userId: owner, roleId: role.id } });
      const adminToken = (await createApiSession(db, owner, 'MFA')).token;
      const employee = await db.employee.create({
        data: {
          employeeNo: 'SQ4_EMP',
          name: 'SQ4整改员',
          phone: '13800000000',
          type: 'ASSISTANT',
          entryDate: new Date(),
        },
      });
      await db.user.update({ where: { id: editor }, data: { employeeId: employee.id } });
      const all = await db.dataScope.create({ data: { name: '获权整改范围', scopeType: 'ALL' } });
      const staffRole = await db.role.create({
        data: {
          code: 'SQ4_STAFF',
          name: '整改岗位',
          type: 'BUSINESS',
          permissions: {
            create: [
              'menu.quality',
              'case.read',
              'case.file.read',
              'case.file.manage',
              'quality.issue.read',
              'quality.issue.resolve',
            ].map((code) => ({ permission: { connect: { code } } })),
          },
          dataScopes: { create: { resource: 'case', dataScopeId: all.id } },
        },
      });
      await db.userRole.create({ data: { userId: editor, roleId: staffRole.id } });
      const outsider = await db.user.create({
          data: { username: 'sq4-outsider', password: 'unused', mustChangePassword: false },
        }),
        outsideToken = (await createApiSession(db, outsider.id)).token;
      const org = (await db.organization.findFirstOrThrow()).id,
        customer = await db.customer.create({
          data: {
            customerNo: 'SQ4_CUSTOMER',
            name: '抽检隔离客户',
            phone: '13800000000',
            phoneHash: 'test',
            createdBy: owner,
          },
        }),
        caseRow = await db.case.create({
          data: {
            caseNo: 'SQ4_CASE',
            title: '抽检隔离结案',
            customerId: customer.id,
            caseType: '医疗纠纷',
            branchId: org,
            createdBy: owner,
            status: 'CLOSED',
            closedAt: new Date('2026-08-20T00:00:00Z'),
            satisfaction: 4,
          },
        });
      const api = (method: 'get' | 'post', route: string, bearer = adminToken, body?: unknown) => {
        const client = app.httpRequest();
        const req = client[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? req : req.send(body);
      };
      const sources = [];
      for (const source of ['QUALITY_REVIEWS', 'QUALITY_ISSUES']) {
        const table = (
          await api('post', '/bases/' + baseId + '/tables', adminToken, {
            name: source === 'QUALITY_REVIEWS' ? '二级抽检' : '问题整改',
            source,
          }).expect(200)
        ).body.data;
        sources.push(table.id);
      }
      const pages = [];
      for (const [id, bearer] of [
        [owner, adminToken],
        [editor, editorToken],
        [outsider.id, outsideToken],
      ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          'window.unifiedTestSession=' +
            JSON.stringify({
              mode: 'AUTHENTICATED',
              token: bearer,
              csrfToken: 'test',
              expiresIn: 900,
              user: { id, username: id, name: 'SQ4验收', roles: [], permissions: [] },
            }) +
            ';',
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, worker, denied] = pages,
        address = vite.resolvedUrls.local[0];
      async function choose(page: typeof admin, label: string, value: string) {
        const select = page.getByLabel(label, { exact: true });
        await select.click();
        const listId = await select.getAttribute('aria-controls');
        await page
          .locator('.ant-select-dropdown')
          .filter({ has: page.locator('[id=' + JSON.stringify(listId) + ']') })
          .locator('.ant-select-item-option-content')
          .getByText(value, { exact: true })
          .click();
      }
      await admin.goto(address + 'admin/quality-rules');
      await admin.getByRole('button', { name: '新增策略版本', exact: true }).click();
      let dialog = admin.getByRole('dialog');
      await dialog.getByLabel('策略编码', { exact: true }).fill('SQ4_UI');
      await dialog.getByLabel('策略名称', { exact: true }).fill('医疗月度抽检');
      await choose(admin, '所属组织', '协作接口测试');
      await dialog.getByLabel('检查项目（每行一项）', { exact: true }).fill('材料来源检查');
      await dialog.getByRole('button', { name: '保存策略', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await admin.goto(address + 'quality/runs');
      await admin.getByRole('button', { name: '创建抽检批次', exact: true }).click();
      dialog = admin.getByRole('dialog');
      await choose(admin, '策略版本', '医疗月度抽检 v1');
      await dialog.getByLabel('月份（留空取上月）', { exact: true }).fill('2026-08');
      await dialog.getByRole('button', { name: '执行抽样', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const run = await db.qualitySamplingRun.findFirstOrThrow();
      await admin.getByRole('link', { name: '医疗月度抽检 · 2026-08 · PRIMARY', exact: true }).click();
      const inspection = await db.qualitySamplingItem.findFirstOrThrow({ where: { runId: run.id } });
      await admin.getByRole('link', { name: inspection.name, exact: true }).click();
      await choose(admin, '材料来源检查检查结果', '不通过');
      await admin.getByLabel('材料来源检查依据', { exact: true }).fill('缺少来源说明，需要补充证据');
      await admin.getByRole('button', { name: '提交检查结果', exact: true }).click();
      await expect.poll(async () => await db.qualityIssue.count()).toBe(1);
      await admin.getByRole('link', { name: '整改问题：材料来源检查', exact: true }).click();
      const issue = await db.qualityIssue.findFirstOrThrow();
      await admin.getByRole('button', { name: '分派整改', exact: true }).click();
      dialog = admin.getByRole('dialog');
      await choose(admin, '整改负责人', 'SQ4整改员');
      await dialog.getByLabel('整改期限', { exact: true }).fill('2026-10-01T09:00');
      await dialog.getByRole('button', { name: '确认办理', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await worker.goto(address + 'quality/issues/' + issue.id);
      await worker.getByRole('button', { name: '开始整改', exact: true }).click();
      await worker.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await worker.getByRole('dialog').waitFor({ state: 'hidden' });
      let offline = true;
      await worker.route(
        '**/api/v1/quality/issues/' + issue.id + '/actions',
        async (route: {
          request(): { method(): string };
          abort(reason: string): Promise<void>;
          continue(): Promise<void>;
        }) => {
          if (offline && route.request().method() === 'POST') {
            offline = false;
            return route.abort('internetdisconnected');
          }
          return route.continue();
        },
      );
      async function submit(content: string, upload = false) {
        await worker.getByRole('button', { name: '提交整改', exact: true }).click();
        const modal = worker.getByRole('dialog');
        await modal.getByLabel('办理依据', { exact: true }).fill(content);
        if (upload)
          await modal
            .getByLabel('新增整改材料', { exact: true })
            .setInputFiles({
              name: '整改来源.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('整改新增材料'),
            });
        await modal.getByRole('button', { name: '确认办理', exact: true }).click();
        if (upload) {
          await expect(modal.getByLabel('办理依据', { exact: true })).toHaveValue(content);
          await expect(modal.getByRole('button', { name: '确认办理', exact: true })).toBeEnabled({
            timeout: 15000,
          });
          await db.qualityIssue.update({ where: { id: issue.id }, data: { version: { increment: 1 } } });
          await modal.getByRole('button', { name: '确认办理', exact: true }).click();
          await modal.getByRole('button', { name: '采用最新问题版本', exact: true }).waitFor();
          await expect(modal.getByLabel('办理依据', { exact: true })).toHaveValue(content);
          await modal.getByRole('button', { name: '采用最新问题版本', exact: true }).click();
          await modal.getByRole('button', { name: '确认办理', exact: true }).click();
        }
        await modal.waitFor({ state: 'hidden' });
      }
      await submit('第一轮补正材料', true);
      await admin.getByRole('button', { name: '退回整改', exact: true }).click();
      dialog = admin.getByRole('dialog');
      await dialog.getByLabel('办理依据', { exact: true }).fill('请补充明确核验依据');
      await dialog.getByRole('button', { name: '确认办理', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await submit('第二轮补正，核验依据已齐备');
      for (const width of [1440, 1024, 390]) {
        await worker.setViewportSize({ width, height: 1000 });
        await worker.screenshot({ path: path.join(evidence, 'issue-' + width + '.png'), fullPage: true });
        assert.ok(await worker.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      }
      await admin.getByRole('button', { name: '复核通过', exact: true }).click();
      dialog = admin.getByRole('dialog');
      await dialog.getByLabel('办理依据', { exact: true }).fill('已复核整改材料与依据');
      await dialog.getByRole('button', { name: '确认办理', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await expect
        .poll(async () => (await db.qualityIssue.findUniqueOrThrow({ where: { id: issue.id } })).status)
        .toBe('CLOSED');
      assert.deepEqual(await db.case.findUniqueOrThrow({ where: { id: caseRow.id } }), caseRow);
      assert.equal(await db.issueRevision.count({ where: { issueId: issue.id } }), 6);
      assert.equal(await db.issueAttachment.count(), 1);
      await api('get', '/quality/issues/' + issue.id, outsideToken).expect(403);
      await denied.goto(address + 'quality/issues/' + issue.id);
      await expect(denied.getByText('第二轮补正，核验依据已齐备', { exact: true })).toHaveCount(0);
      const table = await api('post', '/tables/' + sources[1] + '/records/query', adminToken, {}).expect(200);
      assert.equal(table.body.data.records[0].id, issue.id);
      assert.equal(await db.collabRecord.count({ where: { tableId: { in: sources } } }), 0);
      await db.userRole.deleteMany({ where: { userId: editor } });
      await worker
        .getByRole('heading', { name: '材料来源检查', exact: true })
        .waitFor({ state: 'hidden', timeout: 15000 });
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const [i, context] of browser.contexts().entries())
        for (const page of context.pages()) {
          await writeFile(
            path.join(evidence, 'failed-aria-' + i + '.txt'),
            await page.locator('body').ariaSnapshot(),
          );
          await page
            .screenshot({ path: path.join(evidence, 'failed-' + i + '.png'), fullPage: true })
            .catch(() => undefined);
        }
      throw error;
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'SQ5 real App records low satisfaction and closes analysis through original approval',
  { skip: process.env.COLLAB_BROWSER_REHEARSAL !== 'true', timeout: 300000 },
  async () => {
    const webRoot = path.resolve(process.cwd(), '../web'),
      load = new Function('url', 'return import(url)');
    const { chromium, expect } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/@playwright/test/index.mjs')).href,
    );
    const { createServer: createViteServer } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/vite/dist/node/index.js')).href,
    );
    const vite = await createViteServer({
      root: webRoot,
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'sq3-real-app',
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
    const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence/sq5');
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];

    try {
      const role = await db.role.create({
        data: { code: 'SYSTEM_SUPER_ADMIN', name: '系统管理员', type: 'SYSTEM' },
      });
      await db.userRole.create({ data: { userId: owner, roleId: role.id } });
      const adminToken = (await createApiSession(db, owner, 'MFA')).token;
      const employee = await db.employee.create({
        data: {
          employeeNo: 'SQ5_EMP',
          name: '专项审核员',
          phone: '13800000000',
          type: 'ASSISTANT',
          entryDate: new Date(),
        },
      });
      await db.user.update({ where: { id: editor }, data: { employeeId: employee.id } });
      const all = await db.dataScope.create({ data: { name: '获权分析范围', scopeType: 'ALL' } }),
        reviewRole = await db.role.create({
          data: {
            code: 'SQ5_REVIEWER',
            name: '专项审核岗位',
            type: 'BUSINESS',
            permissions: {
              create: [
                'menu.quality',
                'case.read',
                'quality.analysis.read',
                'quality.analysis.decide',
                'approval.read',
                'approval.process',
                'approval.manage',
              ].map((code) => ({ permission: { connect: { code } } })),
            },
            dataScopes: { create: { resource: 'case', dataScopeId: all.id } },
          },
        });
      await db.userRole.create({ data: { userId: editor, roleId: reviewRole.id } });
      const outsider = await db.user.create({
          data: { username: 'sq5-outsider', password: 'unused', mustChangePassword: false },
        }),
        outsideToken = (await createApiSession(db, outsider.id)).token;
      const org = (await db.organization.findFirstOrThrow()).id,
        customer = await db.customer.create({
          data: {
            customerNo: 'SQ5_CUSTOMER',
            name: '评估隔离客户',
            phone: '13800000000',
            phoneHash: 'test',
            createdBy: owner,
          },
        }),
        caseRow = await db.case.create({
          data: {
            caseNo: 'SQ5_CASE',
            title: '评估隔离案件',
            customerId: customer.id,
            caseType: '医疗纠纷',
            branchId: org,
            createdBy: owner,
            status: 'CLOSED',
            closedAt: new Date(),
            satisfaction: 4,
          },
        });
      const api = (method: 'get' | 'post', route: string, bearer = adminToken, body?: unknown) => {
        const client = app.httpRequest();
        const req = client[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? req : req.send(body);
      };
      const table = (
        await api('post', '/bases/' + baseId + '/tables', adminToken, {
          name: '专项分析',
          source: 'QUALITY_ANALYSES',
        }).expect(200)
      ).body.data;
      const pages = [];
      for (const [id, bearer] of [
        [owner, adminToken],
        [editor, editorToken],
        [outsider.id, outsideToken],
      ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          'window.unifiedTestSession=' +
            JSON.stringify({
              mode: 'AUTHENTICATED',
              token: bearer,
              csrfToken: 'test',
              expiresIn: 900,
              user: { id, username: id, name: 'SQ5验收', roles: [], permissions: [] },
            }) +
            ';',
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, reviewer, denied] = pages,
        address = vite.resolvedUrls.local[0];
      await admin.goto(address + 'cases/' + caseRow.id + '/assessments');
      await admin.getByRole('button', { name: '登记评估', exact: true }).click();
      const dialog = admin.getByRole('dialog');
      await dialog.getByLabel('百分制分数（可空）', { exact: true }).fill('79');
      await dialog.getByLabel('评估来源', { exact: true }).fill('客户回访');
      await dialog.getByLabel('评估日期', { exact: true }).fill('2026-09-17T09:00');
      await dialog.getByLabel('证据或可核验引用', { exact: true }).fill('回访沟通记录与评价依据');
      await dialog.getByRole('button', { name: '保存评估', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const { createEventServices } = await import('../../app/application/events/event-services-factory');
      const events = createEventServices(db, {
        enabled: false,
        shutdownSeconds: 30,
        pollMs: 1000,
        batchSize: 100,
        leaseSeconds: 60,
      });
      for (let i = 0; i < 3; i++) await events.worker.tick();
      const analysis = await db.specialAnalysis.findFirstOrThrow();
      await admin.getByRole('link', { name: '专项分析 · 待分析', exact: true }).click();
      await admin.getByLabel('分析过程', { exact: true }).fill('第一轮分析过程');
      await admin.getByLabel('分析结论', { exact: true }).fill('初步结论');
      let offline = true;
      await admin.route(
        '**/api/v1/quality/special-analyses/' + analysis.id,
        async (route: {
          request(): { method(): string };
          abort(reason: string): Promise<void>;
          continue(): Promise<void>;
        }) => {
          if (offline && route.request().method() === 'POST') {
            offline = false;
            return route.abort('internetdisconnected');
          }
          return route.continue();
        },
      );
      await admin.getByRole('button', { name: '保存分析版本', exact: true }).click();
      await expect(admin.getByLabel('分析过程', { exact: true })).toHaveValue('第一轮分析过程');
      await expect(admin.getByRole('button', { name: '保存分析版本', exact: true })).toBeEnabled({
        timeout: 15000,
      });
      await db.specialAnalysis.update({ where: { id: analysis.id }, data: { version: { increment: 1 } } });
      await admin.getByRole('button', { name: '保存分析版本', exact: true }).click();
      await admin.getByRole('button', { name: '采用最新分析版本', exact: true }).click();
      await expect(admin.getByLabel('分析过程', { exact: true })).toHaveValue('第一轮分析过程');
      await admin.getByRole('button', { name: '保存分析版本', exact: true }).click();
      await expect.poll(() => db.analysisRevision.count()).toBe(1);
      async function closeAnalysis() {
        await admin.getByRole('button', { name: '申请关闭专项分析', exact: true }).click();
        const select = admin.getByLabel('关闭审核人', { exact: true });
        await select.click();
        const listId = await select.getAttribute('aria-controls');
        await admin
          .locator('.ant-select-dropdown')
          .filter({ has: admin.locator('[id=' + JSON.stringify(listId) + ']') })
          .locator('.ant-select-item-option-content')
          .getByText('专项审核员', { exact: true })
          .click();
        await admin.getByRole('dialog').getByRole('button', { name: '提交关闭审核', exact: true }).click();
        await admin.getByRole('dialog').waitFor({ state: 'hidden' });
      }
      async function openApproval() {
        const close = await db.analysisCloseRequest.findFirstOrThrow({
          where: { analysisId: analysis.id },
          orderBy: { createdAt: 'desc' },
        });
        await reviewer.goto(address + 'approvals?role=TODO&instance=' + close.approvalInstanceId);
        await reviewer
          .getByRole('dialog', { name: '审批详情', exact: true })
          .locator('.ant-modal-close')
          .click();
      }
      await closeAnalysis();
      await openApproval();
      await reviewer.getByRole('button', { name: '驳回', exact: true }).click();
      await reviewer
        .getByRole('dialog', { name: '驳回审批' })
        .getByLabel('审批意见（可选）')
        .fill('补充核实分析');
      await reviewer.getByRole('button', { name: '确认驳回', exact: true }).click();
      await expect(admin.getByLabel('分析过程', { exact: true })).toBeEnabled({ timeout: 15000 });
      await admin.getByLabel('分析过程', { exact: true }).fill('第二轮分析：核实经过并补充证据');
      await admin.getByLabel('分析结论', { exact: true }).fill('已完成核实并形成结论');
      await admin.getByRole('button', { name: '保存分析版本', exact: true }).click();
      await expect.poll(() => db.analysisRevision.count()).toBe(2);
      await closeAnalysis();
      for (const width of [1440, 1024, 390]) {
        await admin.setViewportSize({ width, height: 1000 });
        await admin.screenshot({ path: path.join(evidence, 'analysis-' + width + '.png'), fullPage: true });
        assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      }
      await admin.setViewportSize({ width: 1440, height: 1000 });
      await openApproval();
      await reviewer.getByRole('button', { name: '审批通过', exact: true }).click();
      await reviewer.getByRole('button', { name: '确认通过', exact: true }).click();
      await expect
        .poll(async () => (await db.specialAnalysis.findUniqueOrThrow({ where: { id: analysis.id } })).status)
        .toBe('CLOSED');
      const rows = (await api('post', '/tables/' + table.id + '/records/query', adminToken, {}).expect(200))
        .body.data.records;
      assert.equal(rows[0].id, analysis.id);
      assert.equal(await db.collabRecord.count({ where: { tableId: table.id } }), 0);
      assert.ok(await db.collabEvent.count({ where: { baseId, kind: 'business.changed' } }));
      assert.deepEqual(await db.case.findUniqueOrThrow({ where: { id: caseRow.id } }), caseRow);
      await api('get', '/quality/special-analyses/' + analysis.id, outsideToken).expect(403);
      await denied.goto(address + 'quality/special-analyses/' + analysis.id);
      await expect(denied.getByLabel('分析过程', { exact: true })).toHaveCount(0);
      await reviewer.goto(address + 'quality/special-analyses/' + analysis.id);
      await reviewer.getByRole('heading', { name: '低满意度专项分析', exact: true }).waitFor();
      await db.userRole.deleteMany({ where: { userId: editor } });
      await reviewer
        .getByRole('heading', { name: '低满意度专项分析', exact: true })
        .waitFor({ state: 'hidden', timeout: 15000 });
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const [i, context] of browser.contexts().entries())
        for (const page of context.pages()) {
          await writeFile(
            path.join(evidence, 'failed-aria-' + i + '.txt'),
            await page.locator('body').ariaSnapshot(),
          );
          await page
            .screenshot({ path: path.join(evidence, 'failed-' + i + '.png'), fullPage: true })
            .catch(() => undefined);
        }
      throw error;
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test(
  'SQ6 real App preserves pre-case materials and original business continuation',
  { skip: process.env.COLLAB_BROWSER_REHEARSAL !== 'true', timeout: 300000 },
  async () => {
    const webRoot = path.resolve(process.cwd(), '../web'),
      load = new Function('url', 'return import(url)');
    const { chromium, expect } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/@playwright/test/index.mjs')).href,
    );
    const { createServer: createViteServer } = await load(
      pathToFileURL(path.join(webRoot, 'node_modules/vite/dist/node/index.js')).href,
    );
    const vite = await createViteServer({
      root: webRoot,
      cacheDir: path.join(webRoot, 'node_modules/.vite-collaboration-rehearsal'),
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
      optimizeDeps: {
        rolldownOptions: { transform: { define: { 'process.env.NODE_ENV': JSON.stringify('development') } } },
      },
      configFile: path.join(webRoot, 'vite.config.ts'),
      plugins: [
        {
          name: 'sq3-real-app',
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
    const evidence = path.resolve(process.cwd(), '../../var/collaboration-evidence/sq6');
    await mkdir(evidence, { recursive: true });
    const errors: string[] = [];

    try {
      const role = await db.role.create({
        data: { code: 'SYSTEM_SUPER_ADMIN', name: '系统管理员', type: 'SYSTEM' },
      });
      await db.userRole.create({ data: { userId: owner, roleId: role.id } });
      const adminToken = (await createApiSession(db, owner, 'MFA')).token,
        org = (await db.organization.findFirstOrThrow()).id,
        team = await db.professionalTeam.create({
          data: { code: 'SQ6_UI', name: '医疗前期团队', categoryCode: 'MEDICAL', homeOrganizationId: org },
        });
      const employee = await db.employee.create({
        data: {
          employeeNo: 'SQ6_REVIEW',
          name: '前期审核员',
          phone: '13800000000',
          type: 'ASSISTANT',
          entryDate: new Date(),
        },
      });
      await db.user.update({ where: { id: editor }, data: { employeeId: employee.id } });
      const all = await db.dataScope.create({ data: { name: '获权前期范围', scopeType: 'ALL' } }),
        reviewRole = await db.role.create({
          data: {
            code: 'SQ6_REVIEW',
            name: '审核岗位',
            type: 'BUSINESS',
            permissions: {
              create: [
                'sop.task.read',
                'sop.report.read',
                'sop.material.read',
                'quality.review.read',
                'quality.review.decide',
                'approval.read',
                'approval.process',
                'lead.read',
                'contract.read',
                'case.read',
              ].map((code) => ({ permission: { connect: { code } } })),
            },
            dataScopes: {
              create: ['sop_task', 'lead', 'contract', 'case'].map((resource) => ({
                resource,
                dataScopeId: all.id,
              })),
            },
          },
        });
      await db.userRole.create({ data: { userId: editor, roleId: reviewRole.id } });
      const workerEmployee = await db.employee.create({
          data: {
            employeeNo: 'SQ6_WORKER',
            name: '仅任务协作员',
            phone: '13800000000',
            type: 'ASSISTANT',
            entryDate: new Date(),
          },
        }),
        self = await db.dataScope.create({ data: { name: '本人前期', scopeType: 'SELF' } }),
        workerRole = await db.role.create({
          data: {
            code: 'SQ6_WORKER',
            name: '任务协作',
            type: 'BUSINESS',
            permissions: {
              create: ['sop.task.read', 'sop.task.execute', 'sop.report.read', 'sop.material.read'].map(
                (code) => ({ permission: { connect: { code } } }),
              ),
            },
            dataScopes: { create: { resource: 'sop_task', dataScopeId: self.id } },
          },
        }),
        workerUser = await db.user.create({
          data: {
            username: 'sq6-worker',
            password: 'unused',
            mustChangePassword: false,
            employeeId: workerEmployee.id,
            userRoles: { create: { roleId: workerRole.id } },
          },
        }),
        workerToken = (await createApiSession(db, workerUser.id)).token;
      const api = (method: 'get' | 'post' | 'put', route: string, bearer = adminToken, body?: unknown) => {
        const client = app.httpRequest();
        const req = client[method]('/api/v1' + route)
          .set('Authorization', 'Bearer ' + bearer)
          .set('Idempotency-Key', randomUUID());
        return body === undefined ? req : req.send(body);
      };
      const template = (
          await api('post', '/sop/templates', adminToken, {
            code: 'SQ6_UI',
            name: '医疗前期样例',
            organizationId: org,
            professionalTeamId: team.id,
            caseType: '医疗纠纷',
            requestKey: randomUUID(),
            content: {
              schemaVersion: 1,
              nodes: [
                {
                  code: 'PRE',
                  name: '前期报告',
                  reviewRequired: true,
                  materials: [{ code: 'DOC', name: '来源材料', required: true }],
                },
                { code: 'ANALYSIS', name: '委托分析' },
                { code: 'CASE', name: '案件办理' },
              ],
            },
          }).expect(200)
        ).body.data,
        version = await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: template.id } });
      await db.sopTemplateVersion.update({ where: { id: version.id }, data: { status: 'PUBLISHED' } });
      await db.sopTemplate.update({ where: { id: template.id }, data: { activeVersionId: version.id } });
      const lead = await db.lead.create({
          data: {
            leadNo: 'SQ6_UI_LEAD',
            name: '前期隔离客户',
            phone: '13800000000',
            phoneHash: 'test',
            status: 'VISITED',
            branchId: org,
            professionalTeamId: team.id,
            createdBy: owner,
          },
        }),
        table = (
          await api('post', '/bases/' + baseId + '/tables', adminToken, {
            name: '前期与案件任务',
            source: 'SOP_TASKS',
          }).expect(200)
        ).body.data;
      const pages = [];
      for (const [id, bearer] of [
        [owner, adminToken],
        [editor, editorToken],
        [workerUser.id, workerToken],
      ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(
          'window.unifiedTestSession=' +
            JSON.stringify({
              mode: 'AUTHENTICATED',
              token: bearer,
              csrfToken: 'test',
              expiresIn: 900,
              user: { id, username: id, name: 'SQ6验收', roles: [], permissions: [] },
            }) +
            ';',
        );
        const page = await context.newPage();
        page.on('pageerror', (e: Error) => errors.push(e.message));
        pages.push(page);
      }
      const [admin, reviewer, worker] = pages,
        address = vite.resolvedUrls.local[0];
      async function choose(page: typeof admin, label: string, value: string) {
        const select = page.getByLabel(label, { exact: true });
        await select.click();
        const listId = await select.getAttribute('aria-controls');
        await page
          .locator('.ant-select-dropdown')
          .filter({ has: page.locator('[id=' + JSON.stringify(listId) + ']') })
          .locator('.ant-select-item-option-content')
          .getByText(value, { exact: true })
          .click();
      }
      async function startUi(selected: string) {
        await choose(admin, '已发布模板', '医疗前期样例 · 医疗纠纷');
        await admin.getByRole('checkbox', { name: '前期报告', exact: true }).waitFor();
        for (const label of ['前期报告', '委托分析', '案件办理'])
          await admin.getByRole('checkbox', { name: label, exact: true }).setChecked(label === selected);
        await admin.getByRole('button', { name: '确认启动', exact: true }).click();
        await admin.waitForURL(/\/sop\/instances\/[0-9a-f-]+$/);
        return admin.url().split('/').at(-1)!;
      }
      await admin.goto(address + 'leads/' + lead.id);
      await admin.getByRole('button', { name: '启动前期SOP', exact: true }).click();
      const firstId = await startUi('前期报告');
      assert.equal(await db.case.count(), 0);
      assert.equal(await db.contract.count(), 0);
      const firstTask = await db.caseTask.findFirstOrThrow({ where: { sopInstanceId: firstId } });
      await api('post', '/sop/tasks/' + firstTask.id + '/actions', adminToken, {
        action: 'ASSIGN',
        expectedVersion: firstTask.version,
        requestKey: randomUUID(),
        assigneeUserId: workerUser.id,
      }).expect(200);
      await admin.getByRole('link', { name: '前期报告', exact: true }).click();
      await admin.getByRole('button', { name: '开始办理', exact: true }).click();
      await admin.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await admin.getByRole('dialog').waitFor({ state: 'hidden' });
      let offline = true;
      await admin.route(
        '**/api/v1/sop/tasks/' + firstTask.id + '/source-materials',
        async (route: {
          request(): { method(): string };
          abort(reason: string): Promise<void>;
          continue(): Promise<void>;
        }) => {
          if (offline && route.request().method() === 'POST') {
            offline = false;
            return route.abort('internetdisconnected');
          }
          return route.continue();
        },
      );
      await admin
        .getByLabel('前期材料文件', { exact: true })
        .setInputFiles({
          name: '线索原始材料.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('隔离前期原始材料'),
        });
      await admin.getByRole('button', { name: '保存前期材料', exact: true }).click();
      await expect(admin.getByRole('button', { name: '保存前期材料', exact: true })).toBeEnabled({
        timeout: 15000,
      });
      await admin.getByRole('button', { name: '保存前期材料', exact: true }).click();
      await expect.poll(() => db.sopSourceFile.count()).toBe(1);
      const file = await db.sopSourceFile.findFirstOrThrow();
      async function submit(report: string) {
        await admin.getByRole('button', { name: '提交节点成果', exact: true }).click();
        await admin.getByRole('dialog').getByLabel('成果报告', { exact: true }).fill(report);
        await choose(admin, '来源材料（必需）', '线索原始材料.txt');
        await admin.getByLabel('来源材料（必需）', { exact: true }).press('Escape');
        await choose(admin, '审核人', '前期审核员');
        await admin.getByRole('dialog').getByRole('button', { name: '提交成果', exact: true }).click();
        await admin.getByRole('dialog').waitFor({ state: 'hidden' });
        return db.sopSubmission.findFirstOrThrow({
          where: { taskId: firstTask.id },
          orderBy: { number: 'desc' },
        });
      }
      let sub = await submit('第一轮前期分析报告');
      await reviewer.goto(address + 'sop/submissions/' + sub.id);
      const download = reviewer.waitForEvent('download');
      await reviewer.getByRole('button', { name: '线索原始材料.txt', exact: true }).click();
      assert.equal((await download).suggestedFilename(), '线索原始材料.txt');
      await reviewer.getByRole('link', { name: '进入原审批中心办理', exact: true }).click();
      await reviewer
        .getByRole('dialog', { name: '审批详情', exact: true })
        .locator('.ant-modal-close')
        .click();
      await reviewer.getByRole('button', { name: '驳回', exact: true }).click();
      await reviewer
        .getByRole('dialog', { name: '驳回审批' })
        .getByLabel('审批意见（可选）')
        .fill('补充核验依据');
      await reviewer.getByRole('button', { name: '确认驳回', exact: true }).click();
      await admin.getByRole('button', { name: '开始办理', exact: true }).click();
      await admin.getByRole('dialog').getByRole('button', { name: '确认办理', exact: true }).click();
      await admin.getByRole('dialog').waitFor({ state: 'hidden' });
      sub = await submit('第二轮前期分析，核验依据齐备');
      await reviewer.goto(address + 'sop/submissions/' + sub.id);
      for (const label of ['MATERIALS检查结果', 'REPORT检查结果']) await choose(reviewer, label, '通过');
      await reviewer.getByRole('button', { name: '保存检查清单', exact: true }).click();
      await expect
        .poll(async () =>
          JSON.stringify(
            (await db.qualityReview.findUniqueOrThrow({ where: { submissionId: sub.id } })).checklist,
          ),
        )
        .toContain('PASS');
      await reviewer.getByRole('link', { name: '进入原审批中心办理', exact: true }).click();
      await reviewer
        .getByRole('dialog', { name: '审批详情', exact: true })
        .locator('.ant-modal-close')
        .click();
      await reviewer.getByRole('button', { name: '审批通过', exact: true }).click();
      await reviewer.getByRole('button', { name: '确认通过', exact: true }).click();
      await expect
        .poll(async () => (await db.caseTask.findUniqueOrThrow({ where: { id: firstTask.id } })).status)
        .toBe('COMPLETED');
      const frozenTask = await db.caseTask.findUniqueOrThrow({ where: { id: firstTask.id } });
      await worker.goto(address + 'sop/tasks/' + firstTask.id);
      await worker.getByRole('heading', { name: '前期报告', exact: true }).waitFor();
      await api('get', '/sop/tasks/' + firstTask.id + '/source-materials', workerToken).expect(403);
      await expect(worker.getByRole('button', { name: '线索原始材料.txt', exact: true })).toHaveCount(0);
      const customer = (
        await api('post', '/leads/' + lead.id + '/convert', adminToken, {
          customer: { name: '真实转换客户', phone: '13800000000' },
          contact: { name: '联系人', phone: '13800000000', relation: '本人', isPrimary: true },
        }).expect(200)
      ).body.data;
      async function contract(type: string, sourceId?: string) {
        const row = (
          await api('post', '/contracts', adminToken, {
            contractType: type,
            title: type + '前期合同',
            customerId: customer.id,
            branchId: org,
            professionalTeamId: team.id,
            amount: '100',
            ...(sourceId ? { sourceType: 'ANALYSIS', sourceId } : {}),
          }).expect(200)
        ).body.data;
        const state = (await api('post', '/contracts/' + row.id + '/submit', adminToken, {}).expect(200)).body
          .data;
        if (state.status === 'PENDING_APPROVAL')
          await api('post', '/contracts/' + row.id + '/approve', adminToken, {}).expect(200);
        await api('post', '/contracts/' + row.id + '/sign', adminToken, {}).expect(200);
        if (type !== 'RISK_NOTICE')
          await api('post', '/contracts/' + row.id + '/effect', adminToken, {}).expect(200);
        return row;
      }
      const firstContract = await contract('FIRST_SIGN'),
        engagement = await db.analysisEngagement.findUniqueOrThrow({
          where: { contractId: firstContract.id },
        });
      await admin.goto(address + 'contracts/' + firstContract.id);
      await admin.getByRole('button', { name: '启动分析委托SOP', exact: true }).click();
      const midId = await startUi('委托分析');
      await contract('RISK_NOTICE');
      const formal = await contract('FORMAL', engagement.id),
        caseRow = await db.case.findUniqueOrThrow({ where: { contractId: formal.id } });
      await api('put', '/cases/' + caseRow.id, adminToken, {
        version: caseRow.version,
        caseType: '医疗纠纷',
        teamIds: [team.id],
      }).expect(200);
      await admin.goto(address + 'cases/' + caseRow.id);
      await admin.getByRole('link', { name: '启动SOP流程', exact: true }).click();
      const lastId = await startUi('案件办理');
      for (const [from, to] of [
        [firstId, midId],
        [midId, lastId],
      ]) {
        await admin.goto(address + 'sop/instances/' + from);
        await admin.getByRole('button', { name: '关联后续流程', exact: true }).focus();
        await admin.keyboard.press('Enter');
        const target = to === midId ? engagement.engagementNo : caseRow.title;
        await choose(admin, '后续流程', target + ' · PRIMARY');
        await admin.getByLabel('接续依据', { exact: true }).fill('真实客户和生效合同接续');
        if (from === firstId) {
          await db.sopInstance.update({ where: { id: from }, data: { version: { increment: 1 } } });
          const conflict = admin.waitForResponse((r: { url(): string; status(): number }) => r.url().endsWith('/continuations') && r.status() === 409);
          await admin.getByRole('dialog').getByRole('button', { name: '确认接续', exact: true }).click();
          await conflict;
          await expect(admin.getByLabel('接续依据', { exact: true })).toHaveValue('真实客户和生效合同接续');
          await admin.getByRole('button', { name: '刷新接续候选并采用最新版本', exact: true }).click();
          await expect(admin.getByRole('dialog').getByRole('button', { name: '确认接续', exact: true })).toBeEnabled();
        }
        await admin.getByRole('dialog').getByRole('button', { name: '确认接续', exact: true }).click();
        await admin.getByRole('dialog').waitFor({ state: 'hidden' });
      }
      for (const width of [1440, 1024, 390]) {
        await admin.setViewportSize({ width, height: 1000 });
        await admin.screenshot({
          path: path.join(evidence, 'continuation-' + width + '.png'),
          fullPage: true,
        });
        assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      }
      assert.equal(await db.sopContinuation.count(), 2);
      assert.equal(await db.caseTask.count(), 3);
      assert.equal(await db.case.count(), 1);
      assert.equal(await db.contract.count(), 3);
      assert.equal(await db.caseFile.count(), 0);
      assert.equal(await db.sopSourceFile.count(), 1);
      assert.deepEqual(await db.caseTask.findUniqueOrThrow({ where: { id: firstTask.id } }), frozenTask);
      const records = (
        await api('post', '/tables/' + table.id + '/records/query', adminToken, {}).expect(200)
      ).body.data.records;
      assert.equal(records.length, 3);
      assert.ok(records.some((r: { id: string }) => r.id === firstTask.id));
      assert.equal(await db.collabRecord.count({ where: { tableId: table.id } }), 0);
      await api('get', '/sop/tasks/' + firstTask.id + '/source-materials/' + file.id, workerToken).expect(
        403,
      );
      await db.userRole.deleteMany({ where: { userId: workerUser.id } });
      await worker
        .getByRole('heading', { name: '前期报告', exact: true })
        .waitFor({ state: 'hidden', timeout: 15000 });
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const [i, context] of browser.contexts().entries())
        for (const page of context.pages()) {
          await writeFile(
            path.join(evidence, 'failed-aria-' + i + '.txt'),
            await page.locator('body').ariaSnapshot(),
          );
          await page
            .screenshot({ path: path.join(evidence, 'failed-' + i + '.png'), fullPage: true })
            .catch(() => undefined);
        }
      throw error;
    } finally {
      await browser.close();
      await vite.close();
    }
  },
);

test('global read-only preview uses the target permissions and keeps the administrator session intact',async()=>{
  const role=await db.role.create({data:{code:'SYSTEM_SUPER_ADMIN',name:'管理',type:'SYSTEM'}});
  await db.userRole.create({data:{userId:owner,roleId:role.id}});
  const grant=await createApiSession(db,owner,'MFA');
  const prefix='/api/v1/permission-preview/read';
  const call=(url:string,method:'get'|'post',bearer=grant.token)=>app.httpRequest()[method](prefix+url)
    .set('Authorization','Bearer '+bearer).set('X-OA-Preview-Kind','MEMBER').set('X-OA-Preview-Id',editor);
  const summary=await call('/authorization/me','get').expect(200);
  assert.equal(summary.body.data.userId,editor);
  assert.equal(summary.body.data.isSystemSuperAdmin,false);
  const desc=await call('/tables/'+tableId,'get').expect(200);
  assert.equal(desc.body.data.access.level,2);
  await call('/tables/'+tableId+'/records','post').send({}).expect(403);
  await call('/authorization/me','get',editorToken).expect(403);
  const self=await app.httpRequest().get('/api/v1/authorization/me').set('Authorization','Bearer '+grant.token).expect(200);
  assert.equal(self.body.data.userId,owner);
  // Reproduce the private application used by the role-center preview.
  await db.collabBase.update({where:{id:baseId},data:{accessPolicy:{restricted:true,grants:[]}}});
  const adminRequest=(method:'get'|'post'|'put',path:string)=>app.httpRequest()[method]('/api/v1'+path)
    .set('Authorization','Bearer '+grant.token);
  const previewPath='/tables/'+tableId+'/permission-preview';
  const preview=await adminRequest('post',previewPath).send({target:'PRESET',id:'EDITOR'}).expect(200);
  assert.ok(preview.body.data.fields.some((field:{id:string})=>field.id===fieldId));
  assert.equal(preview.body.data.canEdit,true);
  const denied=await adminRequest('post',previewPath).send({target:'MEMBER',id:editor}).expect(403);
  assert.equal(denied.body.message,'WORKSHEET_PREVIEW_TARGET_DENIED');
  const reader=await adminRequest('post',previewPath).send({target:'PRESET',id:'READER'}).expect(200);
  assert.equal(reader.body.data.canEdit,false);
  await app.httpRequest().post('/api/v1'+previewPath).set('Authorization','Bearer '+editorToken)
    .send({target:'PRESET',id:'EDITOR'}).expect(403);

  const businessRole=await db.role.create({data:{code:'XZ1',name:'行政主管',type:'BUSINESS'}});
  const costs=['cost.read','cost.create','cost.update','cost.delete','file.sensitive.download','data.bulk_export'];
  const catalog=(await adminRequest('get','/permissions/catalog').expect(200)).body.data as {code:string;businessRoleAssignable:boolean}[];
  assert.ok(costs.every(code=>catalog.some(p=>p.code===code && p.businessRoleAssignable)));
  assert.equal(catalog.find(p=>p.code==='role.permission.manage')?.businessRoleAssignable,false);
  const rolePath='/roles/'+businessRole.id+'/permissions';
  const saved=await adminRequest('put',rolePath).send({permissionCodes:costs,version:businessRole.version}).expect(200);
  assert.deepEqual([...saved.body.data.permissionCodes].sort(),[...costs].sort());
  await adminRequest('put',rolePath).send({permissionCodes:[...costs,'role.permission.manage'],version:saved.body.data.version}).expect(403);
  const reopened=await adminRequest('get','/roles/'+businessRole.id).expect(200);
  assert.deepEqual(reopened.body.data.permissionCodes,saved.body.data.permissionCodes);
  if (process.env.COLLAB_BROWSER_REHEARSAL === 'true') {
    const root=path.resolve(process.cwd(),'../web');
    const load=new Function('url','return import(url)');
    const {chromium}=await load(pathToFileURL(path.join(root,'node_modules/@playwright/test/index.mjs')).href);
    const {createServer:startVite}=await load(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
    const vite=await startVite({root,configFile:path.join(root,'vite.config.ts'),
      cacheDir:path.join(root,'node_modules/.vite-worksheet-preview'),
      define:{'process.env.NODE_ENV':JSON.stringify('development')},
      server:{fs:{allow:[root,path.resolve(root,'../server/app/domain/workflow')]},host:'127.0.0.1',port:0,proxy:{'/api':{target:origin,changeOrigin:true}}}});
    await vite.listen();
    const browser=await chromium.launch({headless:true,channel:process.env.COLLAB_BROWSER_CHANNEL || undefined});
    try {
      const page=await browser.newPage();
      await page.addInitScript('if (window===window.parent) window.unifiedTestSession='+JSON.stringify({
        mode:'AUTHENTICATED',token:grant.token,csrfToken:'test',expiresIn:900,user:{id:owner,username:'collab-owner',name:'预览验收管理员',roles:[],permissions:[]}}));
      const address=vite.resolvedUrls.local[0];
      await page.route((url:URL)=>url.href===address || url.href===address+'security/roles',async (route:any)=>{
        if(route.request().frame()!==page.mainFrame())return route.continue();
        const response=await route.fetch();
        await route.fulfill({response,body:(await response.text()).replace('/src/main.tsx','/e2e/unified-harness.tsx')});
      });
      await page.goto(address);
      await page.getByRole('button',{name:'权限预览',exact:true}).click();
      const drawer=page.getByRole('dialog',{name:'预览设置'});
      await drawer.getByRole('combobox').last().click();
      await page.locator('.ant-select-item-option').filter({hasText:'collab-editor'}).click();
      const frame=page.frameLocator('iframe[title="当前页面权限预览"]');
      await frame.getByRole('heading',{name:'承业中心',exact:true}).waitFor();
      assert.equal(await frame.getByRole('button',{name:'权限预览',exact:true}).count(),0);
      await page.getByRole('button',{name:'切换预览对象'}).click();
      await drawer.getByRole('combobox').first().click();
      await page.locator('.ant-select-item-option').filter({hasText:'协作表'}).click();
      await drawer.getByRole('combobox').last().click();
      await page.locator('.ant-select-item-option').filter({hasText:'阅读者'}).click();
      await page.getByRole('region',{name:'权限预览'}).getByRole('columnheader',{name:'标题'}).waitFor();
      assert.equal(await page.getByRole('region',{name:'权限预览'}).getByRole('button',{name:'新增',exact:true}).count(),0);
      await page.getByRole('button',{name:'退出预览'}).click();
      await page.getByRole('button',{name:'权限预览',exact:true}).waitFor();
      await page.goto(address+'security/roles');
      await page.getByRole('button',{name:'工作表权限',exact:true}).click();
      await page.getByRole('menuitem',{name:'编辑者',exact:true}).click();
      await page.getByRole('button',{name:'保存并预览',exact:true}).click();
      await page.getByRole('region',{name:'权限预览'}).getByRole('columnheader',{name:'标题'}).waitFor();
      await page.getByRole('button',{name:'退出预览'}).click();
      await page.getByRole('button',{name:'编辑行政主管',exact:true}).click();
      await page.getByText('高级设置 · 操作代码、数据范围及字段规则',{exact:true}).click();
      await page.getByRole('tab',{name:'操作权限',exact:true}).click();
      assert.equal(await page.getByRole('checkbox',{name:'管理角色权限（系统保留）',exact:true}).isDisabled(),true);
      const permission=page.getByRole('checkbox',{name:'查看异常数据',exact:true});
      await permission.check();
      await Promise.all([
        page.waitForResponse((r:{url():string;status():number})=>r.url().endsWith(rolePath) && r.status()===200),
        page.getByRole('button',{name:/保存操作权限/}).click()
      ]);
      const actual=(await adminRequest('get','/roles/'+businessRole.id).expect(200)).body.data.permissionCodes;
      assert.deepEqual(actual.sort(),[...costs,'anomaly.read'].sort());
      const {AuthorizationContextLoader}=await import('../../app/application/authorization/authorization-context-loader');
      const {DriveService}=await import('../../app/application/collaboration/drive-service');
      const {ensureModuleWorkspace}=await import('../../app/application/collaboration/module-workspaces');
      const actor=await new AuthorizationContextLoader(db).load(owner);
      const drive=new DriveService(db,actor);
      const existingBase=await db.collabBase.findUniqueOrThrow({where:{id:baseId}});
      const fixtures=[];
      for(const [group,source,name] of [['HUMAN_RESOURCES','INVENTORY_STOCKTAKES','员工名册'],['ADMINISTRATION','INVENTORY_MOVEMENTS','行政费用'],['INVENTORY','INVENTORY_ITEMS','物品名录']]) {
        const workspace=await ensureModuleWorkspace(db,existingBase.workspaceId,group,owner);
        const item=await drive.createDriveBase(workspace.id,{name,moduleSource:source,connectBusiness:source==='INVENTORY_ITEMS'},randomUUID());
        await db.collabTable.update({where:{id:item.tableId},data:{name}});
        fixtures.push({...item,name,source,workspaceName:workspace.name});
      }
      await page.getByRole('dialog',{name:'配置角色 · 行政主管',exact:true}).locator('.ant-drawer-close').click();
      await page.getByRole('button',{name:'新建角色',exact:true}).click();
      const wizard=page.getByRole('dialog',{name:'新建角色',exact:true});
      await wizard.getByRole('textbox',{name:'角色名称',exact:true}).fill('行政主管验收');
      assert.equal(await wizard.getByRole('checkbox',{name:'基础办公',exact:true}).isChecked(),true);
      await wizard.getByRole('button',{name:'下一步',exact:true}).click();
      for(const fixture of fixtures) {
        await wizard.getByRole('menuitem',{name:fixture.workspaceName,exact:true}).click();
        await wizard.getByRole('combobox',{name:fixture.name+'权限',exact:true}).click();
        await page.locator('.ant-select-dropdown:visible').getByText(fixture.source==='INVENTORY_ITEMS'?'查看':'编辑',{exact:true}).click();
      }
      await wizard.getByRole('button',{name:'下一步',exact:true}).click();
      const createdResponse=page.waitForResponse((r:any)=>r.url().endsWith('/api/v1/roles')&&r.request().method()==='POST');
      await wizard.getByRole('button',{name:'核对并创建',exact:true}).click();
      const createdResult=await createdResponse;
      assert.equal(createdResult.status(),200);
      const createdRole=(await createdResult.json()).data;
      assert.match(createdRole.code,/^ROLE_[A-F0-9]{24}$/);
      assert.ok(createdRole.permissionCodes.includes('approval.process'));
      const member=await db.user.create({data:{username:'office-role-acceptance',password:'unused',userRoles:{create:{roleId:createdRole.id}}}});
      const session=await createApiSession(db,member.id);
      const memberApi=(method:'get'|'post',path:string)=>app.httpRequest()[method]('/api/v1'+path).set('Authorization','Bearer '+session.token);
      for(const fixture of fixtures) {
        const detail=(await memberApi('get','/tables/'+fixture.tableId).expect(200)).body.data;
        assert.equal(detail.access.level,fixture.source==='INVENTORY_ITEMS'?1:2);
        assert.equal(detail.canDeleteRecords,false);
        assert.equal(detail.access.canManageAccess,false);
        await memberApi('post','/tables/'+fixture.tableId+'/export').send({}).expect(403);
        const simulated=await adminRequest('post','/tables/'+fixture.tableId+'/permission-preview').send({target:'MEMBER',id:member.id}).expect(200);
        assert.equal(simulated.body.data.canDelete,false);
      }
      const expense=fixtures.find(f=>f.source==='INVENTORY_MOVEMENTS')!;
      const expenseDetail=(await memberApi('get','/tables/'+expense.tableId).expect(200)).body.data;
      const applicant=expenseDetail.fields.find((f:any)=>f.name==='申请人').id;
      await memberApi('post','/tables/'+expense.tableId+'/records').set('Idempotency-Key',randomUUID())
        .send({schemaVersion:expenseDetail.table.schemaVersion,values:{[applicant]:'验收员工',[expenseDetail.fields.find((f:any)=>f.name==='采购日期') .id]:'2026-11-14T00:00:00.000Z',[expenseDetail.fields.find((f:any)=>f.name==='产品名称').id]:'验收用品'}}).expect(200);
      const ordinary=await browser.newPage();
      await ordinary.addInitScript('if (window===window.parent) window.unifiedTestSession='+JSON.stringify({
        mode:'AUTHENTICATED',token:session.token,csrfToken:session.csrfToken,expiresIn:900,user:{id:member.id,username:member.username,name:'验收员工',roles:[],permissions:[]}}));
      await ordinary.route((url:URL)=>url.origin===new URL(address).origin,async(route:any)=>{
        if(route.request().frame()!==ordinary.mainFrame()||route.request().resourceType()!=='document')return route.continue();
        const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('/src/main.tsx','/e2e/unified-harness.tsx')});
      });
      await ordinary.goto(address+'inventory/movements?'+new URLSearchParams({base:expense.id,table:expense.tableId}));
      await ordinary.getByRole('columnheader',{name:/申请人/}).waitFor();
      await ordinary.getByText('验收员工',{exact:true}).first().waitFor();
      assert.equal(await ordinary.getByRole('button',{name:'批量导入',exact:true}).count(),0);
      await ordinary.getByText('实时同步已连接',{exact:true}).waitFor();
      assert.equal(await ordinary.getByRole('alert').count(),0);
      await ordinary.getByRole('columnheader',{name:/申请人/}).waitFor();
      await ordinary.screenshot({path:'/tmp/oa1114-office-role.png',fullPage:true});
      await ordinary.close();

    } catch(error) {
      for(const context of browser.contexts()) for(const page of context.pages()) {
        await writeFile('/tmp/oa1114-role-browser-failure.txt',await page.locator('body').ariaSnapshot()).catch(()=>undefined);
        await page.screenshot({path:'/tmp/oa1114-role-browser-failure.png',fullPage:true}).catch(()=>undefined);
      }
      throw error;
    } finally {await browser.close();await vite.close();}
  }
});

test('November feedback browser: menu labels, personal upload, medical lookup and worksheet move',async()=>{
  const role=await db.role.create({data:{code:'SYSTEM_SUPER_ADMIN',name:'管理员',type:'SYSTEM'}});
  await db.userRole.create({data:{userId:owner,roleId:role.id}});
  const grant=await createApiSession(db,owner,'MFA');
  const api=(method:'get'|'post'|'put',url:string)=>app.httpRequest()[method]('/api/v1'+url).set('Authorization','Bearer '+grant.token).set('Idempotency-Key',randomUUID());
  await app.httpRequest().put('/api/v1/navigation-menu').set('Authorization','Bearer '+editorToken).send({version:0,nodes:[]}).expect(403);
  const follows=(await api('post','/bases/'+baseId+'/tables').send({name:'客户跟进记录表',source:'FOLLOWS'}).expect(200)).body.data;
  const medical=(await api('post','/bases/'+baseId+'/tables').send({name:'病例评估表',template:'MEDICAL_ASSESSMENT'}).expect(200)).body.data;
  const org=(await db.collabWorkspace.findUniqueOrThrow({where:{id:workspaceId}})).organizationId;
  const lead=await db.lead.create({data:{leadNo:randomUUID(),name:'浏览器客户',phone:'13800000000',phoneHash:randomUUID(),branchId:org,createdBy:owner}});
  await db.leadFollow.create({data:{leadId:lead.id,type:'PHONE',content:'测试跟进',createdBy:owner}});
  const target=(await api('post','/workspaces/'+workspaceId+'/bases').send({name:'行政事务目标目录'}).expect(200)).body.data;
  if(process.env.COLLAB_BROWSER_REHEARSAL!=='true')return;
  const root=path.resolve(process.cwd(),'../web'),load=new Function('url','return import(url)');
  const {chromium,expect:browserExpect}=await load(pathToFileURL(path.join(root,'node_modules/@playwright/test/index.mjs')).href);
  const {createServer:startVite}=await load(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href);
  const vite=await startVite({root,configFile:path.join(root,'vite.config.ts'),cacheDir:path.join(root,'node_modules/.vite-november-feedback'),define:{'process.env.NODE_ENV':JSON.stringify('development')},server:{fs:{allow:[root,path.resolve(root,'../server/app/domain/workflow')]},host:'127.0.0.1',port:0,proxy:{'/api':{target:origin,changeOrigin:true}}}});
  await vite.listen();const browser=await chromium.launch({headless:true,channel:process.env.COLLAB_BROWSER_CHANNEL||undefined});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const address=vite.resolvedUrls.local[0];
  try{
    await page.addInitScript('window.unifiedTestSession='+JSON.stringify({mode:'AUTHENTICATED',token:grant.token,csrfToken:'test',expiresIn:900,user:{id:owner,username:'collab-owner',name:'验收管理员',roles:[],permissions:[]}}));
    await page.route((url:URL)=>url.origin===new URL(address).origin,async(route:any)=>{if(route.request().frame()!==page.mainFrame()||route.request().resourceType()!=='document')return route.continue();const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('/src/main.tsx','/e2e/unified-harness.tsx')});});
    await page.goto(address+'admin/navigation');
    await page.getByRole('heading',{name:'菜单管理',exact:true}).waitFor();
    await page.getByText('跟进工作表',{exact:true}).click();
    await page.getByRole('textbox',{name:'展示名称'}).fill('客户跟进验收');
    const menuSaved=page.waitForResponse((r:any)=>r.url().endsWith('/api/v1/navigation-menu')&&r.request().method()==='PUT');
    await page.getByRole('button',{name:'保存菜单',exact:true}).click();assert.equal((await menuSaved).status(),200);
    await page.goto(address+'apps');
    await page.getByRole('link',{name:'承业中心',exact:true}).waitFor();
    const nav=page.getByRole('navigation',{name:'当前区域目录'});
    await nav.getByRole('link',{name:'客户跟进验收',exact:true}).waitFor();
    assert.equal(await nav.getByRole('link',{name:'客户跟进验收',exact:true}).getAttribute('href'),'/leads/follows');
    await page.screenshot({path:'/tmp/oa-feedback-navigation.png',fullPage:true});
    await page.goto(address+'workspaces?scope=mine');
    const files=page.getByRole('region',{name:'个人文件'});
    await files.getByRole('button',{name:'上传文件',exact:true}).waitFor();
    await files.locator('input[type=file][multiple]').first().setInputFiles({name:'人工验收.txt',mimeType:'text/plain',buffer:Buffer.from('人工验收文件')});
    await files.getByText('人工验收.txt',{exact:true}).waitFor();
    const fileRow=files.getByRole('row').filter({hasText:'人工验收.txt'});
    await fileRow.getByRole('button',{name:'分享与权限'}).click();
    const share=page.getByRole('dialog',{name:'分享与权限 · 人工验收.txt'});
    await share.getByRole('combobox',{name:'搜索分享对象'}).fill('collab-editor');
    await page.locator('.ant-select-dropdown:visible').getByText('collab-editor（用户）',{exact:true}).click();
    await share.getByRole('button',{name:'保存分享',exact:true}).click();
    await share.waitFor({state:'hidden'});
    const stored=await db.personalFile.findFirstOrThrow({where:{name:'人工验收.txt'}});
    await app.httpRequest().get('/api/v1/personal-files/'+stored.id+'/download').set('Authorization','Bearer '+editorToken).expect(200);
    await page.locator('.ant-drawer-content-wrapper').waitFor({state:'hidden'});
    await page.screenshot({path:'/tmp/oa-feedback-personal-files.png',fullPage:true});
    await page.goto(address+'leads/follows?'+new URLSearchParams({base:baseId,table:medical.id}));
    await page.getByRole('button',{name:'添加记录',exact:true}).click();
    const record=page.getByRole('dialog',{name:'新增记录',exact:true});
    await record.getByRole('textbox',{name:'ID',exact:true}).fill('BROWSER-001');
    await record.getByRole('combobox',{name:'关联客户',exact:true}).fill('浏览器客户');
    await page.locator('.ant-select-dropdown:visible').getByText('浏览器客户 · 客户跟进记录表',{exact:true}).click();
    await browserExpect(record.getByRole('textbox',{name:'患者姓名',exact:true})).toHaveValue('浏览器客户');
    assert.equal(await record.getByRole('textbox',{name:'患者姓名',exact:true}).inputValue(),'浏览器客户');
    assert.equal(await record.getByRole('textbox',{name:'患者姓名',exact:true}).isDisabled(),true);
    const saved=page.waitForResponse((r:any)=>r.url().endsWith('/tables/'+medical.id+'/records')&&r.request().method()==='POST');
    await record.getByRole('button',{name:/^保\s*存$/}).click();assert.equal((await saved).status(),200);await record.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'移动工作表',exact:true}).click();
    const move=page.getByRole('dialog',{name:'移动工作表',exact:true});
    await move.getByRole('combobox',{name:'目标目录'}).click();
    await page.locator('.ant-select-dropdown:visible').getByText('接口工作区 / 行政事务目标目录',{exact:true}).click();
    await move.getByRole('button',{name:'预览移动',exact:true}).click();
    await move.getByRole('button',{name:'确认移动',exact:true}).click();
    await move.waitFor({state:'hidden'});
    await page.waitForURL((url:URL)=>url.searchParams.get('base')===target.id);
    await page.getByText('实时同步已连接',{exact:true}).waitFor();
    assert.equal((await db.collabTable.findUniqueOrThrow({where:{id:medical.id}})).baseId,target.id);
    assert.equal(await db.collabRecord.count({where:{tableId:medical.id}}),1);
    await page.screenshot({path:'/tmp/oa-feedback-medical-moved.png',fullPage:true});
    await page.goto(address+'leads/follows?'+new URLSearchParams({base:baseId,table:medical.id}));
    await page.waitForURL((url:URL)=>url.searchParams.get('base')===target.id);
    await page.getByRole('columnheader',{name:/患者姓名/}).waitFor();
    assert.equal(await db.leadFollow.count({where:{leadId:lead.id}}),1);void follows;
  }catch(error){await writeFile('/tmp/oa-feedback-browser-error.txt',await page.locator('body').ariaSnapshot());await page.screenshot({path:'/tmp/oa-feedback-browser-error.png',fullPage:true});throw error;}
  finally{await browser.close();await vite.close();}
});
