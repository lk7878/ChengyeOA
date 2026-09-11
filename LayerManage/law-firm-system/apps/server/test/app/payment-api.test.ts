import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';
import { hashPhone } from '../../app/domain/crm/lead-policy';

// SPEC-010 Task 10: payment HTTP API 端到端测试（登记-确认/冲抵/幂等/范围/404 锁）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/payment-api.test.ts

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
let prisma: PrismaClient;

type ScopeFixture =
  | { kind: 'ALL' }
  | { kind: 'SELF' }
  | { kind: 'TEAM'; professionalTeamId: string }
  | { kind: 'BRANCH'; organizationId: string; includeDescendants?: boolean }
  | { kind: 'ORG'; organizationId: string };

interface ContractSessionOptions {
  permissions: string[];
  scope?: ScopeFixture;
  employeeId?: string | null;
}

/** 业务会话夹具（仿 lead-api T10 先例）：BUSINESS 角色 + RolePermission connect by code + 每 resource 一行数据范围。 */
async function createContractSession(options: ContractSessionOptions): Promise<{ userId: string; token: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `contract.pay.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `CONTRACT PAY ${suffix}`,
      code: `CT_PAY_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
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

const FULL_PAYMENT_PERMISSIONS = [
  'payment.create', 'payment.read', 'payment.confirm', 'payment.void',
  'contract.create', 'contract.read', 'contract.submit', 'contract.approve',
  'contract.sign', 'contract.effect',
  'customer.read',
];

async function createOrgFixture(code: string, parent?: { id: string; path: string }) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      code: `${code}_${id.replaceAll('-', '').slice(0, 12)}`,
      name: code,
      type: 'BRANCH',
      parentId: parent?.id,
      path: parent ? `${parent.path}/${id}` : `/${id}`,
      level: parent ? parent.path.split('/').length - 1 : 0,
    },
  });
}

async function createTeamFixture(homeOrganizationId: string, code: string) {
  return prisma.professionalTeam.create({
    data: {
      code: `TEAM_${code}_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: `Team ${code}`,
      categoryCode: 'CIVIL',
      homeOrganizationId,
    },
  });
}

async function createEmployeeFixture() {
  return prisma.employee.create({
    data: {
      employeeNo: `EMP_${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      name: '范围员工',
      phone: `1${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      type: 'SALES',
      status: 'FORMAL',
      entryDate: new Date('2025-01-01'),
    },
  });
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-PAY-${randomUUID()}`,
      name: '收款客户',
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
      contractNo: `CT-PAY-${randomUUID()}`,
      contractType: 'FIRST_SIGN',
      title: '收款宿主合同',
      sourceType: 'CUSTOMER',
      status: 'EFFECTIVE',
      amount: new Prisma.Decimal('12000.00'),
      ...overrides,
    },
  });
}

async function seedPayment(overrides: Partial<Prisma.PaymentUncheckedCreateInput> & {
  contractId: string;
  customerId: string;
  createdBy: string;
}) {
  return prisma.payment.create({
    data: {
      paymentNo: `PY-API-${randomUUID()}`,
      amount: new Prisma.Decimal('100.00'),
      status: 'PENDING',
      ...overrides,
    },
  });
}

/**
 * 经 API 把 FIRST_SIGN 合同推到 EFFECTIVE（submit→PENDING_APPROVAL→approve→PENDING_SIGN
 * →sign→SIGNED→effect；paymentTerms 缺省时生效生成一期全额计划）。
 */
async function createEffectiveContract(
  token: string,
  customerId: string,
  input: { amount: string; paymentTerms?: string },
): Promise<string> {
  const created = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(token))
    .send({ contractType: 'FIRST_SIGN', title: '收款链路合同', customerId, ...input })
    .expect(200);
  const id = created.body.data.id as string;
  await app.httpRequest().post(`/api/v1/contracts/${id}/submit`).set(bearer(token)).send({}).expect(200);
  await app.httpRequest().post(`/api/v1/contracts/${id}/approve`).set(bearer(token)).send({}).expect(200);
  await app.httpRequest().post(`/api/v1/contracts/${id}/sign`).set(bearer(token)).send({}).expect(200);
  const effected = await app.httpRequest()
    .post(`/api/v1/contracts/${id}/effect`)
    .set(bearer(token))
    .send({})
    .expect(200);
  assert.equal(effected.body.data.status, 'EFFECTIVE');
  return id;
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

test('requires authentication for every payment endpoint', async () => {
  await app.httpRequest().get('/api/v1/payments').expect(401);
  await app.httpRequest().post('/api/v1/payments').send({ contractId: randomUUID(), amount: '1' }).expect(401);
  await app.httpRequest().get(`/api/v1/payments/${randomUUID()}`).expect(401);
  await app.httpRequest().post(`/api/v1/payments/${randomUUID()}/confirm`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/payments/${randomUUID()}/void`).send({ reason: 'x' }).expect(401);
});

test('rejects authenticated users without payment permissions', async () => {
  const ordinary = await createContractSession({ permissions: [] });
  const denied = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(ordinary.token))
    .send({ contractId: randomUUID(), amount: '100' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest().get('/api/v1/payments').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest()
    .post(`/api/v1/payments/${randomUUID()}/confirm`)
    .set(bearer(ordinary.token))
    .send({})
    .expect(403);

  // 只有 payment.read：读通、登记与确认拒。
  const reader = await createContractSession({ permissions: ['payment.read'] });
  await app.httpRequest().get('/api/v1/payments').set(bearer(reader.token)).expect(200);
  await app.httpRequest()
    .post(`/api/v1/payments/${randomUUID()}/confirm`)
    .set(bearer(reader.token))
    .send({})
    .expect(403);
});

test('registers, reads, and confirms payments with plan offset, audit rows, and confirm idempotency', async () => {
  const session = await createContractSession({ permissions: FULL_PAYMENT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contractId = await createEffectiveContract(session.token, customer.id, { amount: '12000' });

  // 生效生成默认一期全额计划。
  const plans = await app.httpRequest()
    .get(`/api/v1/contracts/${contractId}/plans`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(plans.body.data.length, 1);
  assert.equal(plans.body.data[0].amount, '12000.00');

  const registered = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, amount: '5000', method: 'BANK', remark: '首期款' })
    .expect(200);
  assert.equal(registered.body.code, 200);
  assert.match(registered.body.data.paymentNo, /^PY\d{6}-[0-9A-Z]{6}$/);
  assert.equal(registered.body.data.status, 'PENDING');
  assert.equal(registered.body.data.amount, '5000.00');
  assert.equal(registered.body.data.customerId, customer.id);
  const paymentId = registered.body.data.id as string;

  // 详情（payment.read + 范围包裹）。
  const detail = await app.httpRequest()
    .get(`/api/v1/payments/${paymentId}`)
    .set(bearer(session.token))
    .expect(200);
  assert.equal(detail.body.data.id, paymentId);

  const confirmed = await app.httpRequest()
    .post(`/api/v1/payments/${paymentId}/confirm`)
    .set(bearer(session.token))
    .send({})
    .expect(200);
  assert.equal(confirmed.body.data.status, 'CONFIRMED');
  assert.equal(confirmed.body.data.confirmedBy, session.userId);
  assert.ok(confirmed.body.data.confirmedAt);

  // 三方联动：计划 PARTIAL + 合同累计 5000。
  const planAfter = await prisma.paymentPlan.findFirstOrThrow({ where: { contractId } });
  assert.equal(planAfter.receivedAmount.toFixed(2), '5000.00');
  assert.equal(planAfter.status, 'PARTIAL');
  const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  assert.equal(contractAfter.receivedAmount.toFixed(2), '5000.00');

  // 审计：登记/确认各一行（金额只在登记行，确认行只落标识符+前后状态）。
  const createAudit = await prisma.operationLog.findFirst({
    where: { userId: session.userId, action: 'PAYMENT_CREATE', targetType: 'PAYMENT', targetId: paymentId },
  });
  assert.ok(createAudit, 'expected a PAYMENT_CREATE audit row from the API call');
  assert.equal(JSON.stringify(createAudit.newValues).includes('首期款'), false);
  const confirmAudit = await prisma.operationLog.findFirst({
    where: { userId: session.userId, action: 'PAYMENT_CONFIRM', targetType: 'PAYMENT', targetId: paymentId },
  });
  assert.ok(confirmAudit, 'expected a PAYMENT_CONFIRM audit row from the API call');

  // 幂等：confirm 重放经 API 返回现状不翻倍（零重冲零重复事件零重复审计）。
  const replay = await app.httpRequest()
    .post(`/api/v1/payments/${paymentId}/confirm`)
    .set(bearer(session.token))
    .send({})
    .expect(200);
  assert.equal(replay.body.data.status, 'CONFIRMED');
  const contractAfterReplay = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  assert.equal(contractAfterReplay.receivedAmount.toFixed(2), '5000.00');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'payment.confirmed', objectId: paymentId } }),
    1,
  );
  assert.equal(
    await prisma.operationLog.count({
      where: { action: 'PAYMENT_CONFIRM', targetType: 'PAYMENT', targetId: paymentId },
    }),
    1,
  );

  // 列表 + status 过滤。
  const pendingList = await app.httpRequest()
    .get('/api/v1/payments?status=PENDING')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(pendingList.body.data.total, 0);
  const confirmedList = await app.httpRequest()
    .get('/api/v1/payments?status=CONFIRMED')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(confirmedList.body.data.total, 1);
  assert.equal(confirmedList.body.data.list[0].id, paymentId);
});

test('rejects payment overflow at confirm with PAYMENT_AMOUNT_EXCEEDED 409 and rolls back fully', async () => {
  const session = await createContractSession({ permissions: FULL_PAYMENT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contractId = await createEffectiveContract(session.token, customer.id, { amount: '12000' });

  // 登记 5000 确认成功。
  const first = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, amount: '5000' })
    .expect(200);
  await app.httpRequest()
    .post(`/api/v1/payments/${first.body.data.id}/confirm`)
    .set(bearer(session.token))
    .send({})
    .expect(200);

  // 登记 8000：确认时扫完一期（余 7000）仍有剩余 → 409 整事务回滚零残留。
  const overflow = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, amount: '8000' })
    .expect(200);
  const exceeded = await app.httpRequest()
    .post(`/api/v1/payments/${overflow.body.data.id}/confirm`)
    .set(bearer(session.token))
    .send({})
    .expect(409);
  assert.equal(exceeded.body.message, 'PAYMENT_AMOUNT_EXCEEDED');
  const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  assert.equal(contractAfter.receivedAmount.toFixed(2), '5000.00', 'overflow confirm must roll back');
  const planAfter = await prisma.paymentPlan.findFirstOrThrow({ where: { contractId } });
  assert.equal(planAfter.receivedAmount.toFixed(2), '5000.00', 'plan offset must roll back');
  const overflowPayment = await prisma.payment.findUniqueOrThrow({ where: { id: overflow.body.data.id } });
  assert.equal(overflowPayment.status, 'PENDING', 'rejected confirm leaves the payment PENDING');

  // 指定期次冲抵：超期余额 409。
  const plan = await prisma.paymentPlan.findFirstOrThrow({ where: { contractId } });
  const designated = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, paymentPlanId: plan.id, amount: '7100' })
    .expect(200);
  const designatedExceeded = await app.httpRequest()
    .post(`/api/v1/payments/${designated.body.data.id}/confirm`)
    .set(bearer(session.token))
    .send({})
    .expect(409);
  assert.equal(designatedExceeded.body.message, 'PAYMENT_AMOUNT_EXCEEDED');
});

test('carries payment validation and state error codes through the API envelope', async () => {
  const session = await createContractSession({ permissions: FULL_PAYMENT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contractId = await createEffectiveContract(session.token, customer.id, { amount: '12000' });

  // 伪造 paymentPlanId：VALIDATION_FAILED 400。
  const forgedPlan = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, paymentPlanId: randomUUID(), amount: '100' })
    .expect(400);
  assert.equal(forgedPlan.body.message, 'VALIDATION_FAILED');

  // 金额非正数：VALIDATION_FAILED 400。
  await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, amount: '-5' })
    .expect(400);
  await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, amount: '0' })
    .expect(400);

  // 合同不存在：CONTRACT_NOT_FOUND 404。
  const noContract = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId: randomUUID(), amount: '100' })
    .expect(404);
  assert.equal(noContract.body.message, 'CONTRACT_NOT_FOUND');

  // 草稿合同禁收款：CONTRACT_STATE_TRANSITION_INVALID 409。
  const draft = await app.httpRequest()
    .post('/api/v1/contracts')
    .set(bearer(session.token))
    .send({ contractType: 'FIRST_SIGN', title: '草稿合同', customerId: customer.id })
    .expect(200);
  const draftRejected = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId: draft.body.data.id, amount: '100' })
    .expect(409);
  assert.equal(draftRejected.body.message, 'CONTRACT_STATE_TRANSITION_INVALID');

  // 收款不存在：PAYMENT_NOT_FOUND 404（详情与确认同形）。
  const missingGet = await app.httpRequest()
    .get(`/api/v1/payments/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missingGet.body.message, 'PAYMENT_NOT_FOUND');
  const missingConfirm = await app.httpRequest()
    .post(`/api/v1/payments/${randomUUID()}/confirm`)
    .set(bearer(session.token))
    .send({})
    .expect(404);
  assert.equal(missingConfirm.body.message, 'PAYMENT_NOT_FOUND');
});

test('voids a confirmed payment end to end with sweep-back, list status, and idempotent replay', async () => {
  const session = await createContractSession({ permissions: FULL_PAYMENT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contractId = await createEffectiveContract(session.token, customer.id, { amount: '12000' });

  const registered = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, amount: '5000' })
    .expect(200);
  const paymentId = registered.body.data.id as string;
  await app.httpRequest()
    .post(`/api/v1/payments/${paymentId}/confirm`)
    .set(bearer(session.token))
    .send({})
    .expect(200);

  // 冲销：CONFIRMED→VOIDED + 资金回补。
  const voided = await app.httpRequest()
    .post(`/api/v1/payments/${paymentId}/void`)
    .set(bearer(session.token))
    .send({ reason: '重复收款' })
    .expect(200);
  assert.equal(voided.body.data.status, 'VOIDED');
  assert.ok(voided.body.data.voidedAt);
  assert.equal(voided.body.data.voidReason, '重复收款');
  const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  assert.equal(contractAfter.receivedAmount.toFixed(2), '0.00', 'void must sweep back contract receivedAmount');
  const planAfter = await prisma.paymentPlan.findFirstOrThrow({ where: { contractId } });
  assert.equal(planAfter.receivedAmount.toFixed(2), '0.00', 'void must sweep back plan receivedAmount');

  // 列表 status 断言。
  const voidedList = await app.httpRequest()
    .get('/api/v1/payments?status=VOIDED')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(voidedList.body.data.total, 1);
  assert.equal(voidedList.body.data.list[0].id, paymentId);

  // 幂等：void 重放返回现状零重复事件零重复审计零重复回补。
  const replay = await app.httpRequest()
    .post(`/api/v1/payments/${paymentId}/void`)
    .set(bearer(session.token))
    .send({ reason: '重复收款' })
    .expect(200);
  assert.equal(replay.body.data.status, 'VOIDED');
  const contractAfterReplay = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  assert.equal(contractAfterReplay.receivedAmount.toFixed(2), '0.00');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'payment.voided', objectId: paymentId } }),
    1,
  );
  assert.equal(
    await prisma.operationLog.count({
      where: { action: 'PAYMENT_VOID', targetType: 'PAYMENT', targetId: paymentId },
    }),
    1,
  );
});

test('rejects void without payment.void permission and voiding a non-confirmed payment', async () => {
  // 无 payment.void 会话：中权拦截 403 PERMISSION_DENIED（不触服务层，付款状态不变）。
  const withoutVoid = await createContractSession({
    permissions: ['payment.create', 'payment.read', 'payment.confirm', 'contract.create', 'contract.read',
      'contract.submit', 'contract.approve', 'contract.sign', 'contract.effect', 'customer.read'],
  });
  const denied = await app.httpRequest()
    .post(`/api/v1/payments/${randomUUID()}/void`)
    .set(bearer(withoutVoid.token))
    .send({ reason: 'x' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');

  // 全权会话（含 payment.void）：确认付款 → 冲销 → 状态机/校验/404。
  const session = await createContractSession({ permissions: FULL_PAYMENT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contractId = await createEffectiveContract(session.token, customer.id, { amount: '12000' });
  const registered = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, amount: '100' })
    .expect(200);
  const paymentId = registered.body.data.id as string;
  await app.httpRequest()
    .post(`/api/v1/payments/${paymentId}/confirm`)
    .set(bearer(session.token))
    .send({})
    .expect(200);

  // 非 CONFIRMED 冲销：PENDING → 409 PAYMENT_STATE_INVALID。
  const pending = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, amount: '50' })
    .expect(200);
  const stateInvalid = await app.httpRequest()
    .post(`/api/v1/payments/${pending.body.data.id}/void`)
    .set(bearer(session.token))
    .send({ reason: 'x' })
    .expect(409);
  assert.equal(stateInvalid.body.message, 'PAYMENT_STATE_INVALID');

  // void 缺 reason：400 VALIDATION_FAILED。
  const noReason = await app.httpRequest()
    .post(`/api/v1/payments/${paymentId}/void`)
    .set(bearer(session.token))
    .send({})
    .expect(400);
  assert.equal(noReason.body.message, 'VALIDATION_FAILED');

  // void 不存在：404 PAYMENT_NOT_FOUND。
  const missing = await app.httpRequest()
    .post(`/api/v1/payments/${randomUUID()}/void`)
    .set(bearer(session.token))
    .send({ reason: 'x' })
    .expect(404);
  assert.equal(missing.body.message, 'PAYMENT_NOT_FOUND');
});

test('enforces all four data scope kinds on payment lists through the contract wrap', async () => {
  const customer = await createCustomerFixture('seed');
  const branch = await createOrgFixture('PAY_BRANCH_MAIN');
  const branchChild = await createOrgFixture('PAY_BRANCH_CHILD', branch);
  const other = await createOrgFixture('PAY_BRANCH_OTHER');
  const team = await createTeamFixture(branch.id, 'PAYSCOPE');
  const org = await createOrgFixture('PAY_ORG_MAIN');
  const orgChild = await createOrgFixture('PAY_ORG_CHILD', org);
  const employee = await createEmployeeFixture();

  // SELF：范围锚合同 createdBy=读取者本人（employeeId 仅作锚启闭——同 contract 侧先例）。
  const selfReader = await createContractSession({
    permissions: ['payment.read'],
    scope: { kind: 'SELF' },
    employeeId: employee.id,
  });
  const ownContract = await seedContract({ customerId: customer.id, createdBy: selfReader.userId });
  const ownPayment = await seedPayment({ contractId: ownContract.id, customerId: customer.id, createdBy: 'seed' });

  const teamContract = await seedContract({ customerId: customer.id, createdBy: 'seed', professionalTeamId: team.id });
  const teamPayment = await seedPayment({ contractId: teamContract.id, customerId: customer.id, createdBy: 'seed' });

  const branchContract = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: branch.id });
  const branchPayment = await seedPayment({ contractId: branchContract.id, customerId: customer.id, createdBy: 'seed' });
  const childContract = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: branchChild.id });
  const childPayment = await seedPayment({ contractId: childContract.id, customerId: customer.id, createdBy: 'seed' });
  const otherContract = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: other.id });
  const otherPayment = await seedPayment({ contractId: otherContract.id, customerId: customer.id, createdBy: 'seed' });

  const orgContract = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: org.id });
  const orgPayment = await seedPayment({ contractId: orgContract.id, customerId: customer.id, createdBy: 'seed' });
  const orgChildContract = await seedContract({ customerId: customer.id, createdBy: 'seed', branchId: orgChild.id });
  const orgChildPayment = await seedPayment({ contractId: orgChildContract.id, customerId: customer.id, createdBy: 'seed' });

  const selfList = await app.httpRequest()
    .get('/api/v1/payments')
    .set(bearer(selfReader.token))
    .expect(200);
  assert.deepEqual(selfList.body.data.list.map((item: { id: string }) => item.id), [ownPayment.id]);

  const teamReader = await createContractSession({
    permissions: ['payment.read'],
    scope: { kind: 'TEAM', professionalTeamId: team.id },
  });
  const teamList = await app.httpRequest()
    .get('/api/v1/payments')
    .set(bearer(teamReader.token))
    .expect(200);
  assert.deepEqual(teamList.body.data.list.map((item: { id: string }) => item.id), [teamPayment.id]);

  const branchReader = await createContractSession({
    permissions: ['payment.read'],
    scope: { kind: 'BRANCH', organizationId: branch.id },
  });
  const branchList = await app.httpRequest()
    .get('/api/v1/payments')
    .set(bearer(branchReader.token))
    .expect(200);
  assert.deepEqual(
    branchList.body.data.list.map((item: { id: string }) => item.id).sort(),
    [branchPayment.id, childPayment.id].sort(),
  );
  const branchHidden = await app.httpRequest()
    .get(`/api/v1/payments/${otherPayment.id}`)
    .set(bearer(branchReader.token))
    .expect(404);
  assert.equal(branchHidden.body.message, 'PAYMENT_NOT_FOUND');

  const orgReader = await createContractSession({
    permissions: ['payment.read'],
    scope: { kind: 'ORG', organizationId: org.id },
  });
  const orgList = await app.httpRequest()
    .get('/api/v1/payments')
    .set(bearer(orgReader.token))
    .expect(200);
  assert.deepEqual(orgList.body.data.list.map((item: { id: string }) => item.id), [orgPayment.id]);
  await app.httpRequest()
    .get(`/api/v1/payments/${orgChildPayment.id}`)
    .set(bearer(orgReader.token))
    .expect(404);
});

test('does not expose prototype payment routes removed by the rebuild (404 locks)', async () => {
  const session = await createContractSession({ permissions: FULL_PAYMENT_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contractId = await createEffectiveContract(session.token, customer.id, { amount: '12000' });
  const registered = await app.httpRequest()
    .post('/api/v1/payments')
    .set(bearer(session.token))
    .send({ contractId, amount: '100' })
    .expect(200);
  const paymentId = registered.body.data.id as string;

  // 原型物理删除/退款端点已整体移除（FTN-001 §3.6：收款无业务删除；退款归 SPEC-011）。
  await app.httpRequest()
    .put(`/api/v1/payments/${paymentId}`)
    .set(bearer(session.token))
    .send({ amount: '1' })
    .expect(404);
  await app.httpRequest()
    .delete(`/api/v1/payments/${paymentId}`)
    .set(bearer(session.token))
    .expect(404);
  await app.httpRequest()
    .post(`/api/v1/payments/${paymentId}/refund`)
    .set(bearer(session.token))
    .send({})
    .expect(404);
});
