import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';
import { hashPhone } from '../../app/domain/crm/lead-policy';

// SPEC-011 Task 10: invoice HTTP API 端到端测试（开票申请 create/approve/reject/complete 全链、
// 动作路由、白名单、错误码透传、404 锁）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/invoice-api.test.ts

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

type ScopeFixture =
  | { kind: 'ALL' }
  | { kind: 'SELF' }
  | { kind: 'TEAM'; professionalTeamId: string }
  | { kind: 'BRANCH'; organizationId: string; includeDescendants?: boolean }
  | { kind: 'ORG'; organizationId: string };

interface FinanceSessionOptions {
  permissions: string[];
  scope?: ScopeFixture;
  employeeId?: string | null;
}

/** 业务会话夹具（仿 contract-api T10 先例）：BUSINESS 角色 + RolePermission connect by code + 每 resource 一行数据范围。 */
async function createFinanceSession(options: FinanceSessionOptions): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `finance.inv.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `FINANCE INV ${suffix}`,
      code: `FIN_INV_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
      type: 'BUSINESS',
      permissions: {
        create: options.permissions.map(code => ({ permission: { connect: { code } } })),
      },
    },
  });
  const scope = options.scope ?? { kind: 'ALL' };
  const resources = [...new Set(options.permissions.map(code => code.split('.')[0]))];
  for (const resource of resources) {
    const dataScope = await prisma.dataScope.create({
      data: {
        name: `Scope ${resource} ${suffix}`,
        scopeType: scope.kind,
        includeDescendants: scope.kind === 'BRANCH' ? scope.includeDescendants ?? true : false,
        organizationId: scope.kind === 'BRANCH' || scope.kind === 'ORG' ? scope.organizationId : null,
        professionalTeamId: scope.kind === 'TEAM' ? scope.professionalTeamId : null,
      },
    });
    await prisma.roleDataScope.create({
      data: { roleId: role.id, resource, dataScopeId: dataScope.id },
    });
  }
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const token = (await createApiSession(prisma, user.id)).token;
  return { userId: user.id, token };
}

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

const FULL_INVOICE_PERMISSIONS = [
  'invoice.create', 'invoice.read', 'invoice.approve', 'invoice.complete',
];

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-INV-${randomUUID()}`,
      name: '开票客户',
      phone: '13900001111',
      phoneHash: hashPhone('13900001111'),
      status: 'INTENT',
      createdBy,
    },
  });
}

async function seedContract(overrides: Partial<Prisma.ContractUncheckedCreateInput> & {
  customerId: string;
  createdBy: string;
}) {
  return prisma.contract.create({
    data: {
      contractNo: `CT-INV-${randomUUID()}`,
      contractType: 'FIRST_SIGN',
      title: '开票宿主合同',
      sourceType: 'CUSTOMER',
      status: 'EFFECTIVE',
      amount: new Prisma.Decimal('12000.00'),
      ...overrides,
    },
  });
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

test('requires authentication for every invoice endpoint', async () => {
  await app.httpRequest().get('/api/v1/invoices').expect(401);
  await app.httpRequest().post('/api/v1/invoices').send({ contractId: randomUUID(), amount: '1' }).expect(401);
  await app.httpRequest().get(`/api/v1/invoices/${randomUUID()}`).expect(401);
  await app.httpRequest().post(`/api/v1/invoices/${randomUUID()}/approve`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/invoices/${randomUUID()}/reject`).send({ comment: 'x' }).expect(401);
  await app.httpRequest().post(`/api/v1/invoices/${randomUUID()}/complete`).send({}).expect(401);
});

test('rejects authenticated users without invoice permissions', async () => {
  const ordinary = await createFinanceSession({ permissions: [] });
  const denied = await app.httpRequest()
    .post('/api/v1/invoices')
    .set(bearer(ordinary.token))
    .send({ contractId: randomUUID(), amount: '100' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest().get('/api/v1/invoices').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest()
    .post(`/api/v1/invoices/${randomUUID()}/complete`)
    .set(bearer(ordinary.token))
    .send({})
    .expect(403);

  // 只有 invoice.read：读通、写与动作拒。
  const reader = await createFinanceSession({ permissions: ['invoice.read'] });
  await app.httpRequest().get('/api/v1/invoices').set(bearer(reader.token)).expect(200);
  await app.httpRequest()
    .post(`/api/v1/invoices/${randomUUID()}/approve`)
    .set(bearer(reader.token))
    .send({})
    .expect(403);
});

test('creates, approves, completes, and lists invoices end to end', async () => {
  const session = await createFinanceSession({ permissions: FULL_INVOICE_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contract = await seedContract({ customerId: customer.id, createdBy: session.userId });

  const created = await app.httpRequest()
    .post('/api/v1/invoices')
    .set(bearer(session.token))
    .send({ contractId: contract.id, amount: '5000', reason: '首期开票' })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.match(created.body.data.requestNo, /^INV\d{6}-[0-9A-Z]{6}$/);
  assert.equal(created.body.data.status, 'PENDING');
  assert.equal(created.body.data.amount, '5000.00');
  assert.equal(created.body.data.contractId, contract.id);
  assert.equal(created.body.data.customerId, customer.id);
  const invoiceId = created.body.data.id as string;

  const detail = await app.httpRequest()
    .get(`/api/v1/invoices/${invoiceId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(detail.body.data.id, invoiceId);

  const list = await app.httpRequest()
    .get('/api/v1/invoices')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].id, invoiceId);

  const approved = await app.httpRequest()
    .post(`/api/v1/invoices/${invoiceId}/approve`)
    .set(bearer(session.token))
    .send({ comment: '同意' })
    .expect(200);
  assert.equal(approved.body.data.status, 'APPROVED');
  assert.equal(approved.body.data.approvedBy, session.userId);
  assert.ok(approved.body.data.approvedAt);

  const completed = await app.httpRequest()
    .post(`/api/v1/invoices/${invoiceId}/complete`)
    .set(bearer(session.token))
    .send({ invoiceNo: 'INV-NO-2026-001' })
    .expect(200);
  assert.equal(completed.body.data.status, 'COMPLETED');
  assert.equal(completed.body.data.invoiceNo, 'INV-NO-2026-001');
  assert.ok(completed.body.data.completedAt);

  // 幂等：complete 重放返回现状不翻倍。
  const replay = await app.httpRequest()
    .post(`/api/v1/invoices/${invoiceId}/complete`)
    .set(bearer(session.token))
    .send({ invoiceNo: 'INV-NO-2026-001' })
    .expect(200);
  assert.equal(replay.body.data.status, 'COMPLETED');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'invoice.completed', objectId: invoiceId } }),
    1,
  );
  assert.equal(
    await prisma.operationLog.count({
      where: { action: 'INVOICE_COMPLETE', targetType: 'INVOICE_REQUEST', targetId: invoiceId },
    }),
    1,
  );

  // 列表 status 过滤。
  const completedList = await app.httpRequest()
    .get('/api/v1/invoices?status=COMPLETED')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(completedList.body.data.total, 1);
  const pendingList = await app.httpRequest()
    .get('/api/v1/invoices?status=PENDING')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(pendingList.body.data.total, 0);
});

test('supports reject transition and keeps capacity accounting', async () => {
  const session = await createFinanceSession({ permissions: FULL_INVOICE_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contract = await seedContract({ customerId: customer.id, createdBy: session.userId });

  const created = await app.httpRequest()
    .post('/api/v1/invoices')
    .set(bearer(session.token))
    .send({ contractId: contract.id, amount: '3000', reason: '驳回测试' })
    .expect(200);
  const invoiceId = created.body.data.id as string;

  const rejected = await app.httpRequest()
    .post(`/api/v1/invoices/${invoiceId}/reject`)
    .set(bearer(session.token))
    .send({ comment: '发票信息有误' })
    .expect(200);
  assert.equal(rejected.body.data.status, 'REJECTED');

  // REJECTED 释放占用：同一合同可再开满额申请。
  const recreated = await app.httpRequest()
    .post('/api/v1/invoices')
    .set(bearer(session.token))
    .send({ contractId: contract.id, amount: '12000' })
    .expect(200);
  assert.equal(recreated.body.data.status, 'PENDING');
});

test('carries invoice validation and state error codes through the API envelope', async () => {
  const session = await createFinanceSession({ permissions: FULL_INVOICE_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contract = await seedContract({ customerId: customer.id, createdBy: session.userId });

  // body 未知键：400 VALIDATION_FAILED。
  const unknownKey = await app.httpRequest()
    .post('/api/v1/invoices')
    .set(bearer(session.token))
    .send({ contractId: contract.id, amount: '100', bogus: true })
    .expect(400);
  assert.equal(unknownKey.body.message, 'VALIDATION_FAILED');

  // 合同不存在：404 CONTRACT_NOT_FOUND。
  const noContract = await app.httpRequest()
    .post('/api/v1/invoices')
    .set(bearer(session.token))
    .send({ contractId: randomUUID(), amount: '100' })
    .expect(404);
  assert.equal(noContract.body.message, 'CONTRACT_NOT_FOUND');

  // 开票申请不存在：404 INVOICE_NOT_FOUND。
  const missing = await app.httpRequest()
    .get(`/api/v1/invoices/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missing.body.message, 'INVOICE_NOT_FOUND');

  // 超额：合同金额 12000，申请 12001 → 400 INVOICE_AMOUNT_EXCEEDED。
  const exceeded = await app.httpRequest()
    .post('/api/v1/invoices')
    .set(bearer(session.token))
    .send({ contractId: contract.id, amount: '12001' })
    .expect(400);
  assert.equal(exceeded.body.message, 'INVOICE_AMOUNT_EXCEEDED');

  // complete 非 APPROVED（PENDING）→ 409 INVOICE_STATE_INVALID。
  const pending = await app.httpRequest()
    .post('/api/v1/invoices')
    .set(bearer(session.token))
    .send({ contractId: contract.id, amount: '2000' })
    .expect(200);
  const stateInvalid = await app.httpRequest()
    .post(`/api/v1/invoices/${pending.body.data.id}/complete`)
    .set(bearer(session.token))
    .send({})
    .expect(409);
  assert.equal(stateInvalid.body.message, 'INVOICE_STATE_INVALID');

  // 审批时额度重验 409（协调者裁决 EXCEEDED 双态）：创建后直改合同金额使聚合超标。
  const forApprove = await app.httpRequest()
    .post('/api/v1/invoices')
    .set(bearer(session.token))
    .send({ contractId: contract.id, amount: '6000' })
    .expect(200);
  await prisma.contract.update({
    where: { id: contract.id },
    data: { amount: new Prisma.Decimal('5000.00') },
  });
  const approveExceeded = await app.httpRequest()
    .post(`/api/v1/invoices/${forApprove.body.data.id}/approve`)
    .set(bearer(session.token))
    .send({})
    .expect(409);
  assert.equal(approveExceeded.body.message, 'INVOICE_AMOUNT_EXCEEDED');
});

test('enforces the contract data scope on invoice lists', async () => {
  const customer = await createCustomerFixture('seed');
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP_INV_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: '范围员工',
      phone: `1${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      type: 'SALES',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
    },
  });
  const reader = await createFinanceSession({
    permissions: ['invoice.read'],
    scope: { kind: 'SELF' },
    employeeId: employee.id,
  });
  const ownContract = await seedContract({ customerId: customer.id, createdBy: reader.userId });
  const otherContract = await seedContract({ customerId: customer.id, createdBy: 'seed' });
  await prisma.invoiceRequest.create({
    data: {
      requestNo: `INV-SEED-${randomUUID()}`,
      contractId: ownContract.id,
      customerId: customer.id,
      amount: new Prisma.Decimal('100.00'),
      status: 'PENDING',
      createdBy: reader.userId,
    },
  });
  await prisma.invoiceRequest.create({
    data: {
      requestNo: `INV-SEED-${randomUUID()}`,
      contractId: otherContract.id,
      customerId: customer.id,
      amount: new Prisma.Decimal('100.00'),
      status: 'PENDING',
      createdBy: 'seed',
    },
  });

  const list = await app.httpRequest()
    .get('/api/v1/invoices')
    .set(bearer(reader.token))
    .expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].contractId, ownContract.id);

  const hidden = await app.httpRequest()
    .get(`/api/v1/invoices/${(await prisma.invoiceRequest.findFirstOrThrow({ where: { contractId: otherContract.id } })).id}`)
    .set(bearer(reader.token))
    .expect(404);
  assert.equal(hidden.body.message, 'INVOICE_NOT_FOUND');
});
