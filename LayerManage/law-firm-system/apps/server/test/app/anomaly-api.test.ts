import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';
import { hashPhone } from '../../app/domain/crm/lead-policy';

// SPEC-011 Task 10: anomaly HTTP API 端到端测试（FIN-05 四口径异常台账，纯只读）。
// 每口径一命中一空集；received-uninvoiced 额外钉 total=候选池语义（Task 9 ⚠️① 文档化）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/anomaly-api.test.ts

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

/** 业务会话夹具（仿 contract-api T10 先例）。 */
async function createFinanceSession(options: FinanceSessionOptions): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `finance.anom.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `FINANCE ANOM ${suffix}`,
      code: `FIN_ANOM_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
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

async function createCustomerFixture() {
  return prisma.customer.create({
    data: {
      customerNo: `CU-ANOM-${randomUUID()}`,
      name: '异常客户',
      phone: '13900001111',
      phoneHash: hashPhone('13900001111'),
      status: 'INTENT',
      createdBy: 'seed',
    },
  });
}

async function seedContract(overrides: Partial<Prisma.ContractUncheckedCreateInput> & {
  customerId: string;
}) {
  return prisma.contract.create({
    data: {
      contractNo: `CT-ANOM-${randomUUID()}`,
      contractType: 'FIRST_SIGN',
      title: '异常宿主合同',
      sourceType: 'CUSTOMER',
      status: 'EFFECTIVE',
      amount: new Prisma.Decimal('12000.00'),
      createdBy: 'seed',
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

test('requires authentication for every anomaly endpoint', async () => {
  await app.httpRequest().get('/api/v1/finance/anomalies/signed-unpaid').expect(401);
  await app.httpRequest().get('/api/v1/finance/anomalies/received-uninvoiced').expect(401);
  await app.httpRequest().get('/api/v1/finance/anomalies/first-sign-no-formal').expect(401);
  await app.httpRequest().get('/api/v1/finance/anomalies/paid-no-case').expect(401);
});

test('rejects authenticated users without anomaly.read and invalid pagination', async () => {
  const ordinary = await createFinanceSession({ permissions: [] });
  await app.httpRequest()
    .get('/api/v1/finance/anomalies/signed-unpaid')
    .set(bearer(ordinary.token))
    .expect(403);

  const reader = await createFinanceSession({ permissions: ['anomaly.read'] });
  await app.httpRequest()
    .get('/api/v1/finance/anomalies/signed-unpaid')
    .set(bearer(reader.token))
    .expect(200);
  // 分页参数非法：400 VALIDATION_FAILED。
  await app.httpRequest()
    .get('/api/v1/finance/anomalies/signed-unpaid?page=0')
    .set(bearer(reader.token))
    .expect(400);
  await app.httpRequest()
    .get('/api/v1/finance/anomalies/received-uninvoiced?pageSize=abc')
    .set(bearer(reader.token))
    .expect(400);
});

test('returns empty sets for all four anomaly measures without matching data', async () => {
  const reader = await createFinanceSession({ permissions: ['anomaly.read'] });
  for (const path of [
    'signed-unpaid', 'received-uninvoiced', 'first-sign-no-formal', 'paid-no-case',
  ]) {
    const res = await app.httpRequest()
      .get(`/api/v1/finance/anomalies/${path}`)
      .set(bearer(reader.token))
      .expect(200);
    assert.equal(res.body.data.total, 0, `${path} should be empty`);
    assert.equal(res.body.data.list.length, 0, `${path} list should be empty`);
  }
});

test('signed-unpaid hits signed/effective zero-received contracts only', async () => {
  const reader = await createFinanceSession({ permissions: ['anomaly.read'] });
  const customer = await createCustomerFixture();
  const hit = await seedContract({ customerId: customer.id, status: 'SIGNED', receivedAmount: new Prisma.Decimal('0.00') });
  const miss = await seedContract({ customerId: customer.id, status: 'EFFECTIVE', receivedAmount: new Prisma.Decimal('100.00') });

  const res = await app.httpRequest()
    .get('/api/v1/finance/anomalies/signed-unpaid')
    .set(bearer(reader.token))
    .expect(200);
  const ids = res.body.data.list.map((item: { contractId: string }) => item.contractId);
  assert.deepEqual(ids, [hit.id]);
  assert.equal(res.body.data.total, 1);
  assert.equal(res.body.data.list[0].status, 'SIGNED');
  assert.equal(res.body.data.list[0].gapAmount, null);
  assert.equal(ids.includes(miss.id), false);
});

test('received-uninvoiced reports the gap with candidate-pool total semantics', async () => {
  const reader = await createFinanceSession({ permissions: ['anomaly.read'] });
  const customer = await createCustomerFixture();
  const uncovered = await seedContract({
    customerId: customer.id,
    status: 'EFFECTIVE',
    receivedAmount: new Prisma.Decimal('1000.00'),
  });
  const covered = await seedContract({
    customerId: customer.id,
    status: 'EFFECTIVE',
    receivedAmount: new Prisma.Decimal('2000.00'),
  });
  await prisma.invoiceRequest.create({
    data: {
      requestNo: `INV-ANOM-${randomUUID()}`,
      contractId: covered.id,
      customerId: customer.id,
      amount: new Prisma.Decimal('2000.00'),
      status: 'COMPLETED',
      createdBy: 'seed',
    },
  });

  const res = await app.httpRequest()
    .get('/api/v1/finance/anomalies/received-uninvoiced')
    .set(bearer(reader.token))
    .expect(200);
  // ⚠️① Task 9 文档化：total = 候选池（scope+receivedAmount>0+未删），list = 当页过滤后子集。
  assert.equal(res.body.data.total, 2);
  const ids = res.body.data.list.map((item: { contractId: string }) => item.contractId);
  assert.deepEqual(ids, [uncovered.id]);
  assert.equal(res.body.data.list[0].gapAmount, '1000.00');
  assert.equal(ids.includes(covered.id), false);
});

test('first-sign-no-formal hits first-sign contracts without a formal contract for the customer', async () => {
  const reader = await createFinanceSession({ permissions: ['anomaly.read'] });
  const customerA = await createCustomerFixture();
  const customerB = await createCustomerFixture();
  const hit = await seedContract({ customerId: customerA.id, contractType: 'FIRST_SIGN', status: 'SIGNED' });
  const missedFirstSign = await seedContract({ customerId: customerB.id, contractType: 'FIRST_SIGN', status: 'EFFECTIVE' });
  // 同客户存在 FORMAL（非 VOID/未删）→ 豁免首签判定。
  await seedContract({ customerId: customerB.id, contractType: 'FORMAL', status: 'EFFECTIVE' });

  const res = await app.httpRequest()
    .get('/api/v1/finance/anomalies/first-sign-no-formal')
    .set(bearer(reader.token))
    .expect(200);
  const ids = res.body.data.list.map((item: { contractId: string }) => item.contractId);
  assert.deepEqual(ids, [hit.id]);
  assert.equal(res.body.data.total, 1);
  assert.equal(ids.includes(missedFirstSign.id), false);
});

test('paid-no-case hits paid formal contracts without a linked case', async () => {
  const reader = await createFinanceSession({ permissions: ['anomaly.read'] });
  const customer = await createCustomerFixture();
  const hit = await seedContract({
    customerId: customer.id,
    contractType: 'FORMAL',
    status: 'EFFECTIVE',
    receivedAmount: new Prisma.Decimal('500.00'),
  });
  const withCase = await seedContract({
    customerId: customer.id,
    contractType: 'FORMAL',
    status: 'EFFECTIVE',
    receivedAmount: new Prisma.Decimal('500.00'),
  });
  await prisma.case.create({
    data: {
      caseNo: `CA-ANOM-${randomUUID()}`,
      title: '已建案合同',
      customerId: customer.id,
      contractId: withCase.id,
      caseType: 'CONTRACT_DISPUTE',
    },
  });

  const res = await app.httpRequest()
    .get('/api/v1/finance/anomalies/paid-no-case')
    .set(bearer(reader.token))
    .expect(200);
  const ids = res.body.data.list.map((item: { contractId: string }) => item.contractId);
  assert.deepEqual(ids, [hit.id]);
  assert.equal(res.body.data.total, 1);
  assert.equal(ids.includes(withCase.id), false);
});
