import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';
process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
let prisma: PrismaClient;
async function createApprovalSession(permissions: string[]): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `approval.api.${suffix}`,
      password: 'not-used',
      employeeId: null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `APPROVAL ${suffix}`,
      code: `APPROVAL_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: permissions.map((code) => ({ permission: { connect: { code } } })),
      },
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = (await createApiSession(prisma, user.id)).token;
  return { userId: user.id, token };
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
  await clearTestApplicationData(prisma);
});
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});
test('old modes are retired, while the visual lifecycle uses the same authenticated permission gates', async () => {
  await app.httpRequest().get('/api/v1/approvals').expect(401);
  await app.httpRequest().get('/api/v1/workflows/instances').expect(401);
  const denied = await createApprovalSession([]);
  await app
    .httpRequest()
    .post('/api/v1/approvals')
    .set('Authorization', 'Bearer ' + denied.token)
    .send({})
    .expect(403);
  await app
    .httpRequest()
    .get('/api/v1/workflows/instances')
    .set('Authorization', 'Bearer ' + denied.token)
    .expect(403);
  const manager = await createApprovalSession([
    'approval.read',
    'approval.manage',
    'approval.apply',
    'approval.process',
  ]);
  const reviewer = await createApprovalSession(['approval.read', 'approval.process']);
  for (const path of [
    '/approvals',
    '/approvals/definitions',
    '/approvals/definitions/manage',
    '/approvals/stats',
    '/approval-ledger',
    '/approval-sync-rules',
  ]) {
    const response = await app
      .httpRequest()
      .get('/api/v1' + path)
      .set('Authorization', 'Bearer ' + manager.token)
      .expect(410);
    assert.equal(response.body.redirect, '/approvals');
  }
  for (const path of [
    '/approvals',
    '/approvals/definitions',
    '/approvals/personal-definitions',
    '/approvals/definitions/import',
    '/approvals/missing/process',
    '/approvals/missing/withdraw',
    '/approvals/missing/forward',
    '/approvals/missing/add-signers',
  ])
    await app
      .httpRequest()
      .post('/api/v1' + path)
      .set('Authorization', 'Bearer ' + manager.token)
      .send({})
      .expect(410);
  const schema = {
    fields: [{ key: 'reason', label: '申请事由', type: 'text', required: true }],
    nodes: [
      { id: 'start', name: '发起', type: 'START', x: 0, y: 0 },
      {
        id: 'review',
        name: '审核',
        type: 'APPROVAL',
        x: 0,
        y: 100,
        rule: { type: 'USER', ids: [reviewer.userId] },
        mode: 'ALL',
      },
      { id: 'end', name: '结束', type: 'END', x: 0, y: 200 },
    ],
    edges: [
      { id: 'a', from: 'start', to: 'review' },
      { id: 'b', from: 'review', to: 'end' },
    ],
  };
  const definition = await app
    .httpRequest()
    .post('/api/v1/workflows/definitions')
    .set('Authorization', 'Bearer ' + manager.token)
    .send({ name: '统一审批接口回归', schema, publish: true })
    .expect(200);
  const instance = await app
    .httpRequest()
    .post('/api/v1/workflows/instances')
    .set('Authorization', 'Bearer ' + manager.token)
    .set('idempotency-key', randomUUID())
    .send({ definitionId: definition.body.data.id, title: '统一审批申请', content: { reason: '验证' } })
    .expect(200);
  const id = instance.body.data.id;
  const inbox = await app
    .httpRequest()
    .get('/api/v1/workflows/instances?role=TODO')
    .set('Authorization', 'Bearer ' + reviewer.token)
    .expect(200);
  assert.ok(inbox.body.data.rows.some((r: { id: string }) => r.id === id));
  const done = await app
    .httpRequest()
    .post('/api/v1/workflows/instances/' + id + '/actions')
    .set('Authorization', 'Bearer ' + reviewer.token)
    .set('idempotency-key', randomUUID())
    .send({ action: 'APPROVE', version: instance.body.data.version })
    .expect(200);
  assert.equal(done.body.data.status, 'APPROVED');
  await app
    .httpRequest()
    .get('/api/v1/workflows/stats')
    .set('Authorization', 'Bearer ' + manager.token)
    .expect(200);
  assert.equal(await prisma.approvalInstance.count(), 0);
});
