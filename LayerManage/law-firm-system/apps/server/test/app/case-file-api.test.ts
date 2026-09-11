// SPEC-042 Task 3: 案件文件 HTTP API 端到端测试（上传/列表/下载/删除 + 权限 403 + 错误码）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/case-file-api.test.ts

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

const FULL_FILE_PERMISSIONS = ['case.read', 'case.create', 'case.file.read', 'case.file.manage'];

async function createFileSession(permissions: string[]): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { username: `casefile.api.${suffix}`, password: 'not-used', employeeId: null },
  });
  const role = await prisma.role.create({
    data: {
      name: `CASE FILE API ${suffix}`,
      code: `CF_API_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: permissions.map(code => ({ permission: { connect: { code } } })),
      },
    },
  });
  const resources = [...new Set(permissions.map(code => code.split('.')[0]))];
  for (const resource of resources) {
    const dataScope = await prisma.dataScope.create({
      data: {
        name: `Scope ${resource} ${suffix}`,
        scopeType: 'ALL',
        includeDescendants: false,
        organizationId: null,
        professionalTeamId: null,
      },
    });
    await prisma.roleDataScope.create({ data: { roleId: role.id, resource, dataScopeId: dataScope.id } });
  }
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = (await createApiSession(prisma, user.id)).token;
  return { userId: user.id, token };
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function seedCustomer(): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      customerNo: `CU-${randomUUID()}`,
      name: '文件案客户',
      phone: '13800000000',
      phoneHash: 'seed',
      status: 'SIGNED',
      createdBy: 'seed',
    },
  });
  return customer.id;
}

const SAMPLE_BASE64 = Buffer.from('api case file content').toString('base64');

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('requires authentication for every case file endpoint', async () => {
  const caseId = randomUUID();
  const fileId = randomUUID();
  await app.httpRequest().get(`/api/v1/cases/${caseId}/files`).expect(401);
  await app.httpRequest().post(`/api/v1/cases/${caseId}/files`).send({ fileName: 'x', fileType: 'text/plain', base64: SAMPLE_BASE64 }).expect(401);
  await app.httpRequest().get(`/api/v1/files/${fileId}/download`).expect(401);
  await app.httpRequest().delete(`/api/v1/files/${fileId}`).expect(401);
});

test('rejects authenticated users without case.file permissions', async () => {
  const session = await createFileSession(['case.read', 'case.create']);
  const customerId = await seedCustomer();
  const created = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: '文件案', customerId, caseType: '民事' })
    .expect(200);
  const caseId = created.body.data.id as string;

  await app.httpRequest().get(`/api/v1/cases/${caseId}/files`).set(bearer(session.token)).expect(403);
  await app.httpRequest()
    .post(`/api/v1/cases/${caseId}/files`)
    .set(bearer(session.token))
    .send({ fileName: 'x', fileType: 'text/plain', base64: SAMPLE_BASE64 })
    .expect(403);
  await app.httpRequest().get(`/api/v1/files/${randomUUID()}/download`).set(bearer(session.token)).expect(403);
  await app.httpRequest().delete(`/api/v1/files/${randomUUID()}`).set(bearer(session.token)).expect(403);
});

test('uploads, lists, downloads, and deletes a case file end to end', async () => {
  const session = await createFileSession(FULL_FILE_PERMISSIONS);
  const customerId = await seedCustomer();
  const created = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: '证据案', customerId, caseType: '民事' })
    .expect(200);
  const caseId = created.body.data.id as string;

  const uploaded = await app.httpRequest()
    .post(`/api/v1/cases/${caseId}/files`)
    .set(bearer(session.token))
    .send({ fileName: '证据.txt', fileType: 'text/plain', base64: SAMPLE_BASE64 })
    .expect(200);
  assert.equal(uploaded.body.code, 200);
  assert.equal(uploaded.body.data.fileName, '证据.txt');
  assert.equal(uploaded.body.data.fileSize, Buffer.byteLength('api case file content'));
  const fileId = uploaded.body.data.id as string;

  const list = await app.httpRequest()
    .get(`/api/v1/cases/${caseId}/files`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].id, fileId);

  const download = await app.httpRequest()
    .get(`/api/v1/files/${fileId}/download`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(download.body.data.base64, SAMPLE_BASE64);
  assert.equal(download.body.data.fileName, '证据.txt');

  const removed = await app.httpRequest()
    .delete(`/api/v1/files/${fileId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(removed.body.data.id, fileId);

  const afterDelete = await app.httpRequest()
    .get(`/api/v1/cases/${caseId}/files`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(afterDelete.body.data.total, 0);
});

test('carries case file validation and not-found error codes', async () => {
  const session = await createFileSession(FULL_FILE_PERMISSIONS);
  const customerId = await seedCustomer();
  const created = await app.httpRequest()
    .post('/api/v1/cases')
    .set(bearer(session.token))
    .send({ title: '文件案', customerId, caseType: '民事' })
    .expect(200);
  const caseId = created.body.data.id as string;

  // 案件不存在 → 404 CASE_NOT_FOUND。
  const missingCase = await app.httpRequest()
    .post(`/api/v1/cases/${randomUUID()}/files`)
    .set(bearer(session.token))
    .send({ fileName: 'x', fileType: 'text/plain', base64: SAMPLE_BASE64 })
    .expect(404);
  assert.equal(missingCase.body.message, 'CASE_NOT_FOUND');

  // 非法 base64 → 400 CASE_FILE_INVALID。
  const badBase64 = await app.httpRequest()
    .post(`/api/v1/cases/${caseId}/files`)
    .set(bearer(session.token))
    .send({ fileName: 'x', fileType: 'text/plain', base64: '!!!' })
    .expect(400);
  assert.equal(badBase64.body.message, 'CASE_FILE_INVALID');

  // 文件不存在 → 404 CASE_FILE_NOT_FOUND。
  const missingFile = await app.httpRequest()
    .get(`/api/v1/files/${randomUUID()}/download`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missingFile.body.message, 'CASE_FILE_NOT_FOUND');
  await app.httpRequest()
    .delete(`/api/v1/files/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
});
