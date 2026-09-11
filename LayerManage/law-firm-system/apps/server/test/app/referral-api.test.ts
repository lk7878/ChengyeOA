// SPEC-039 Task 3: 客户转介绍 HTTP API 端到端测试（登记转介绍 / 客户转介绍列表 + 权限 403 +
// 错误码透传）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/referral-api.test.ts

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

const FULL_REFERRAL_PERMISSIONS = ['lead.create', 'lead.read'];

async function createReferralSession(permissions: string[]): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { username: `referral.api.${suffix}`, password: 'not-used', employeeId: null },
  });
  const role = await prisma.role.create({
    data: {
      name: `REFERRAL API ${suffix}`,
      code: `REF_API_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
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
      name: '转介绍客户',
      phone: '13800004444',
      phoneHash: 'seed',
      status: 'SIGNED',
      createdBy: 'seed',
    },
  });
  return customer.id;
}

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

test('requires authentication for every referral endpoint', async () => {
  await app.httpRequest().post(`/api/v1/customers/${randomUUID()}/referrals`).send({ name: 'x', phone: '13900001111' }).expect(401);
  await app.httpRequest().get(`/api/v1/customers/${randomUUID()}/referrals`).expect(401);
});

test('rejects authenticated users without lead.create/lead.read permissions', async () => {
  const ordinary = await createReferralSession([]);
  const customerId = await seedCustomer();
  await app.httpRequest().post(`/api/v1/customers/${customerId}/referrals`).set(bearer(ordinary.token)).send({ name: 'x', phone: '13900001111' }).expect(403);
  await app.httpRequest().get(`/api/v1/customers/${customerId}/referrals`).set(bearer(ordinary.token)).expect(403);
});

test('registers a REFERRAL lead and lists it from the customer referrals endpoint', async () => {
  const session = await createReferralSession(FULL_REFERRAL_PERMISSIONS);
  const customerId = await seedCustomer();

  const created = await app.httpRequest()
    .post(`/api/v1/customers/${customerId}/referrals`)
    .set(bearer(session.token))
    .send({ name: '转介绍王五', phone: '13900001234', wechat: 'wx_ref', intentionLevel: 4 })
    .expect(200);
  assert.equal(created.body.code, 200);
  // POST /customers/:id/referrals 返回 CreateLeadResult 形态 { lead, duplicates }（与 POST /leads 一致）。
  assert.equal(created.body.data.lead.sourceType, 'REFERRAL');
  assert.equal(created.body.data.lead.referralCustomerId, customerId);
  assert.equal(created.body.data.lead.status, 'NEW');
  assert.ok(created.body.data.lead.leadNo.startsWith('L'));

  const list = await app.httpRequest()
    .get(`/api/v1/customers/${customerId}/referrals`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].id, created.body.data.lead.id);
  assert.equal(list.body.data.list[0].referralCustomerId, customerId);
});

test('carries referral customer-not-found and validation error codes', async () => {
  const session = await createReferralSession(FULL_REFERRAL_PERMISSIONS);
  const customerId = await seedCustomer();

  // 客户不存在 → 404 CUSTOMER_NOT_FOUND。
  const missing = await app.httpRequest()
    .post(`/api/v1/customers/${randomUUID()}/referrals`)
    .set(bearer(session.token))
    .send({ name: 'x', phone: '13900001111' })
    .expect(404);
  assert.equal(missing.body.message, 'CUSTOMER_NOT_FOUND');
  await app.httpRequest()
    .get(`/api/v1/customers/${randomUUID()}/referrals`)
    .set(bearer(session.token))
    .expect(404);

  // 缺 name → 400 VALIDATION_FAILED。
  const badBody = await app.httpRequest()
    .post(`/api/v1/customers/${customerId}/referrals`)
    .set(bearer(session.token))
    .send({ phone: '13900001111' })
    .expect(400);
  assert.equal(badBody.body.message, 'VALIDATION_FAILED');

  // 未知键 → 400。
  await app.httpRequest()
    .post(`/api/v1/customers/${customerId}/referrals`)
    .set(bearer(session.token))
    .send({ name: 'x', phone: '13900001111', bogus: true })
    .expect(400);

  // 非法分页 → 400。
  await app.httpRequest()
    .get(`/api/v1/customers/${customerId}/referrals?page=abc`)
    .set(bearer(session.token))
    .expect(400);
});
