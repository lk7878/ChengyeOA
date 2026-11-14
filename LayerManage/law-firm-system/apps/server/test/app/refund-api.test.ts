import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { SessionService } from '../../app/application/auth/session-service';
import { decodeBase32 } from '../../app/domain/security/base32';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { TotpService } from '../../app/domain/security/totp-service';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { createApiSession } from '../helpers/auth-session';

const JWT_SECRET = '01234567890123456789012345678901';
const MFA_KEY = Buffer.from('0123456789abcdef0123456789abcdef');

// SPEC-011 Task 10: refund HTTP API 端到端测试（REFUND/WAIVER create-approve-execute 全链、
// reject、SPECIAL/CRITICAL refund.approve 缺权实证、错误码透传、404 锁）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/app/refund-api.test.ts

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
      username: `finance.rf.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `FINANCE RF ${suffix}`,
      code: `FIN_RF_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
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

/** MFA 会话夹具（Task 7 Step-Up 消费）：同 createFinanceSession 权限/范围装配，但创建
 *  已验证 TOTP 因子 + MFA 会话并返回 secret，供 /v1/auth/step-up 发证。 */
async function createMfaFinanceSession(options: FinanceSessionOptions): Promise<{
  userId: string; token: string; csrfToken: string; secret: string;
}> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `finance.mfa.${suffix}`,
      password: 'not-used',
      employeeId: options.employeeId ?? null,
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `FINANCE MFA ${suffix}`,
      code: `FIN_MFA_${suffix.replaceAll('-', '').slice(0, 20).toUpperCase()}`,
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
  const secret = new TotpService().generateSecret();
  const encrypted = new MfaSecretCrypto(new Map([[1, MFA_KEY]])).encrypt(secret);
  await prisma.mfaFactor.create({
    data: {
      userId: user.id,
      type: 'TOTP',
      encryptedSecret: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      verifiedAt: new Date(),
    },
  });
  const credentials = await new SessionService(prisma, new JwtTokenService(JWT_SECRET)).create(
    user.id, 'MFA', {},
  );
  return { userId: user.id, token: credentials.accessToken, csrfToken: credentials.csrfToken, secret };
}

function totpCode(secret: string): string {
  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/** 经 /v1/auth/step-up 发证（CSRF + Origin + Cookie 三件套，沿 admin-governance API 先例）。
 *  重置 lastAcceptedCounter：同一 30s 窗口多次发证会被 TOTP 重放防护拒绝，测试矩阵多证场景
 *  需先清计数器（生产单动作单证不受影响）。 */
async function issueStepUp(
  session: { userId: string; token: string; csrfToken: string; secret: string },
  purpose: string,
  target: unknown,
): Promise<string> {
  await prisma.mfaFactor.updateMany({
    where: { userId: session.userId, disabledAt: null },
    data: { lastAcceptedCounter: null },
  });
  const response = await app.httpRequest().post('/api/v1/auth/step-up')
    .set(bearer(session.token))
    .set('Origin', 'http://localhost:3000')
    .set('X-CSRF-Token', session.csrfToken)
    .set('Cookie', `chengye_csrf=${session.csrfToken}`)
    .send({ purpose, target, code: totpCode(session.secret) })
    .expect(200);
  return response.body.data.stepUpToken as string;
}

const FULL_REFUND_PERMISSIONS = [
  'refund.create', 'refund.read', 'refund.approve', 'refund.execute',
];

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-RF-${randomUUID()}`,
      name: '退款客户',
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
      contractNo: `CT-RF-${randomUUID()}`,
      contractType: 'FIRST_SIGN',
      title: '退款宿主合同',
      sourceType: 'CUSTOMER',
      status: 'EFFECTIVE',
      amount: new Prisma.Decimal('12000.00'),
      ...overrides,
    },
  });
}

async function seedConfirmedPayment(overrides: Partial<Prisma.PaymentUncheckedCreateInput> & {
  contractId: string;
  customerId: string;
  createdBy: string;
}) {
  return prisma.payment.create({
    data: {
      paymentNo: `PY-RF-${randomUUID()}`,
      amount: new Prisma.Decimal('1000.00'),
      status: 'CONFIRMED',
      ...overrides,
    },
  });
}

async function seedPlan(overrides: Partial<Prisma.PaymentPlanUncheckedCreateInput> & {
  contractId: string;
  createdBy: string;
}) {
  return prisma.paymentPlan.create({
    data: {
      planNo: `PP-RF-${randomUUID()}`,
      period: 1,
      dueDate: new Date('2026-09-01'),
      amount: new Prisma.Decimal('5000.00'),
      receivedAmount: new Prisma.Decimal('0.00'),
      status: 'PENDING',
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

test('requires authentication for every refund endpoint', async () => {
  await app.httpRequest().get('/api/v1/refunds').expect(401);
  await app.httpRequest().post('/api/v1/refunds').send({ type: 'REFUND', amount: '1', reason: 'x' }).expect(401);
  await app.httpRequest().get(`/api/v1/refunds/${randomUUID()}`).expect(401);
  await app.httpRequest().post(`/api/v1/refunds/${randomUUID()}/approve`).send({}).expect(401);
  await app.httpRequest().post(`/api/v1/refunds/${randomUUID()}/reject`).send({ comment: 'x' }).expect(401);
  await app.httpRequest().post(`/api/v1/refunds/${randomUUID()}/execute`).send({}).expect(401);
});

test('rejects authenticated users without refund permissions, including the SPECIAL approve gate', async () => {
  const ordinary = await createFinanceSession({ permissions: [] });
  const denied = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(ordinary.token))
    .send({ type: 'REFUND', contractId: randomUUID(), paymentId: randomUUID(), amount: '100', reason: 'x' })
    .expect(403);
  assert.equal(denied.body.message, 'PERMISSION_DENIED');
  await app.httpRequest().get('/api/v1/refunds').set(bearer(ordinary.token)).expect(403);
  await app.httpRequest()
    .post(`/api/v1/refunds/${randomUUID()}/execute`)
    .set(bearer(ordinary.token))
    .send({})
    .expect(403);

  // 只有 refund.read：读通、写与动作拒。
  const reader = await createFinanceSession({ permissions: ['refund.read'] });
  await app.httpRequest().get('/api/v1/refunds').set(bearer(reader.token)).expect(200);
  await app.httpRequest()
    .post(`/api/v1/refunds/${randomUUID()}/approve`)
    .set(bearer(reader.token))
    .send({})
    .expect(403);

  // Task 6 实证：refund.approve 为 SPECIAL/CRITICAL 预存码——缺失抛 SPECIAL_PERMISSION_REQUIRED
  // （非 PERMISSION_DENIED）。挂 approve 码的 reject 路由同证。
  const customer = await createCustomerFixture('seed');
  const contract = await seedContract({ customerId: customer.id, createdBy: 'seed' });
  const payment = await seedConfirmedPayment({ contractId: contract.id, customerId: customer.id, createdBy: 'seed' });
  await prisma.contract.update({
    where: { id: contract.id },
    data: { receivedAmount: new Prisma.Decimal('1000.00') },
  });
  const withoutApprove = await createFinanceSession({
    permissions: ['refund.create', 'refund.read', 'refund.execute'],
  });
  const created = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(withoutApprove.token))
    .send({ type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '1000', reason: '权限测试' })
    .expect(200);
  const specialApprove = await app.httpRequest()
    .post(`/api/v1/refunds/${created.body.data.id}/approve`)
    .set(bearer(withoutApprove.token))
    .send({})
    .expect(403);
  assert.equal(specialApprove.body.message, 'SPECIAL_PERMISSION_REQUIRED');
  const specialReject = await app.httpRequest()
    .post(`/api/v1/refunds/${created.body.data.id}/reject`)
    .set(bearer(withoutApprove.token))
    .send({ comment: 'x' })
    .expect(403);
  assert.equal(specialReject.body.message, 'SPECIAL_PERMISSION_REQUIRED');
});

test('creates, approves, executes a REFUND end to end with sweep-back', async () => {
  const session = await createMfaFinanceSession({ permissions: FULL_REFUND_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contract = await seedContract({
    customerId: customer.id,
    createdBy: session.userId,
    receivedAmount: new Prisma.Decimal('1000.00'),
  });
  const payment = await seedConfirmedPayment({
    contractId: contract.id,
    customerId: customer.id,
    createdBy: session.userId,
  });

  const created = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(session.token))
    .send({ type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '1000', reason: '客户撤单' })
    .expect(200);
  assert.equal(created.body.code, 200);
  assert.match(created.body.data.requestNo, /^RF\d{6}-[0-9A-Z]{6}$/);
  assert.equal(created.body.data.status, 'PENDING');
  assert.equal(created.body.data.type, 'REFUND');
  assert.equal(created.body.data.paymentId, payment.id);
  assert.equal(created.body.data.amount, '1000.00');
  const refundId = created.body.data.id as string;

  const list = await app.httpRequest()
    .get('/api/v1/refunds')
    .set(bearer(session.token))
    .expect(200);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.list[0].id, refundId);

  // Task 7：refund.approve 真实 Step-Up——先 /v1/auth/step-up 发证（REFUND_APPROVE 目的位，
  // target 绑定 refundRequestId+expectedVersion），再持证审批。
  const stepUpToken = await issueStepUp(session, 'REFUND_APPROVE', {
    refundRequestId: refundId,
    expectedVersion: created.body.data.version as number,
  });
  const approved = await app.httpRequest()
    .post(`/api/v1/refunds/${refundId}/approve`)
    .set(bearer(session.token))
    .set('X-Step-Up-Token', stepUpToken)
    .send({ comment: '同意退款', expectedVersion: created.body.data.version as number })
    .expect(200);
  assert.equal(approved.body.data.status, 'APPROVED');

  const executed = await app.httpRequest()
    .post(`/api/v1/refunds/${refundId}/execute`)
    .set(bearer(session.token))
    .send({})
    .expect(200);
  assert.equal(executed.body.data.status, 'EXECUTED');
  assert.ok(executed.body.data.executedAt);

  // 冲销联动：payment REFUNDED + 合同 receivedAmount 回补到 0。
  const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(paymentAfter.status, 'REFUNDED');
  const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(contractAfter.receivedAmount.toFixed(2), '0.00');

  // 幂等：execute 重放返回现状零重复事件零重复审计。
  const replay = await app.httpRequest()
    .post(`/api/v1/refunds/${refundId}/execute`)
    .set(bearer(session.token))
    .send({})
    .expect(200);
  assert.equal(replay.body.data.status, 'EXECUTED');
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'refund.executed', objectId: refundId } }),
    1,
  );
  assert.equal(
    await prisma.operationLog.count({
      where: { action: 'REFUND_EXECUTE', targetType: 'REFUND_REQUEST', targetId: refundId },
    }),
    1,
  );
});

test('creates, approves, executes a WAIVER end to end with plan decrement', async () => {
  const session = await createMfaFinanceSession({ permissions: FULL_REFUND_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contract = await seedContract({ customerId: customer.id, createdBy: session.userId });
  const plan = await seedPlan({ contractId: contract.id, createdBy: session.userId });

  const created = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(session.token))
    .send({ type: 'WAIVER', contractId: contract.id, planId: plan.id, amount: '2000', reason: '减免' })
    .expect(200);
  assert.equal(created.body.data.type, 'WAIVER');
  assert.equal(created.body.data.planId, plan.id);
  const refundId = created.body.data.id as string;

  const stepUpToken = await issueStepUp(session, 'REFUND_APPROVE', {
    refundRequestId: refundId,
    expectedVersion: created.body.data.version as number,
  });
  await app.httpRequest()
    .post(`/api/v1/refunds/${refundId}/approve`)
    .set(bearer(session.token))
    .set('X-Step-Up-Token', stepUpToken)
    .send({ expectedVersion: created.body.data.version as number })
    .expect(200);
  const executed = await app.httpRequest()
    .post(`/api/v1/refunds/${refundId}/execute`)
    .set(bearer(session.token))
    .send({})
    .expect(200);
  assert.equal(executed.body.data.status, 'EXECUTED');

  const planAfter = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(planAfter.amount.toFixed(2), '3000.00');
  assert.equal(planAfter.status, 'PENDING');
});

test('approves without MFA while preserving version validation, permission gates and audit',async()=>{
  const session=await createFinanceSession({permissions:FULL_REFUND_PERMISSIONS});
  const customer=await createCustomerFixture(session.userId);
  const contract=await seedContract({customerId:customer.id,createdBy:session.userId});
  const plan=await seedPlan({contractId:contract.id,createdBy:session.userId});
  const created=await app.httpRequest().post('/api/v1/refunds').set(bearer(session.token)).send({type:'WAIVER',contractId:contract.id,planId:plan.id,amount:'500',reason:'无需二次验证'}).expect(200);
  const id=created.body.data.id;
  await app.httpRequest().post('/api/v1/refunds/'+id+'/approve').set(bearer(session.token)).send({}).expect(400);
  await app.httpRequest().post('/api/v1/refunds/'+id+'/approve').set(bearer(session.token)).send({expectedVersion:99}).expect(409);
  const approved=await app.httpRequest().post('/api/v1/refunds/'+id+'/approve').set(bearer(session.token)).send({expectedVersion:1}).expect(200);
  assert.equal(approved.body.data.status,'APPROVED');
  assert.equal(await prisma.operationLog.count({where:{targetId:id,action:'REFUND_APPROVE'}}),1);
  assert.equal(await prisma.eventLog.count({where:{objectId:id,eventType:'refund.approved'}}),1);
});

test('supports reject transition', async () => {
  const session = await createFinanceSession({ permissions: FULL_REFUND_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contract = await seedContract({ customerId: customer.id, createdBy: session.userId });
  const plan = await seedPlan({ contractId: contract.id, createdBy: session.userId });

  const created = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(session.token))
    .send({ type: 'WAIVER', contractId: contract.id, planId: plan.id, amount: '1000', reason: '驳回测试' })
    .expect(200);
  const refundId = created.body.data.id as string;

  const rejected = await app.httpRequest()
    .post(`/api/v1/refunds/${refundId}/reject`)
    .set(bearer(session.token))
    .send({ comment: '不予减免' })
    .expect(200);
  assert.equal(rejected.body.data.status, 'REJECTED');
});

test('carries refund validation and state error codes through the API envelope', async () => {
  const session = await createFinanceSession({ permissions: FULL_REFUND_PERMISSIONS });
  const customer = await createCustomerFixture(session.userId);
  const contract = await seedContract({ customerId: customer.id, createdBy: session.userId });
  const plan = await seedPlan({ contractId: contract.id, createdBy: session.userId });

  // body 未知键：400 VALIDATION_FAILED。
  const unknownKey = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(session.token))
    .send({ type: 'WAIVER', contractId: contract.id, planId: plan.id, amount: '100', reason: 'x', bogus: true })
    .expect(400);
  assert.equal(unknownKey.body.message, 'VALIDATION_FAILED');

  // 合同不存在：404 CONTRACT_NOT_FOUND。
  const noContract = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(session.token))
    .send({ type: 'WAIVER', contractId: randomUUID(), planId: plan.id, amount: '100', reason: 'x' })
    .expect(404);
  assert.equal(noContract.body.message, 'CONTRACT_NOT_FOUND');

  // 退款/减免申请不存在：404 REFUND_NOT_FOUND。
  const missing = await app.httpRequest()
    .get(`/api/v1/refunds/${randomUUID()}`)
    .set(bearer(session.token))
    .expect(404);
  assert.equal(missing.body.message, 'REFUND_NOT_FOUND');

  // WAIVER 超额（plan 余额 5000，申请 6000）→ 400 WAIVER_AMOUNT_EXCEEDED。
  const exceeded = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(session.token))
    .send({ type: 'WAIVER', contractId: contract.id, planId: plan.id, amount: '6000', reason: 'x' })
    .expect(400);
  assert.equal(exceeded.body.message, 'WAIVER_AMOUNT_EXCEEDED');

  // execute 非 APPROVED（PENDING）→ 409 REFUND_STATE_INVALID。
  const pending = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(session.token))
    .send({ type: 'WAIVER', contractId: contract.id, planId: plan.id, amount: '500', reason: 'x' })
    .expect(200);
  const stateInvalid = await app.httpRequest()
    .post(`/api/v1/refunds/${pending.body.data.id}/execute`)
    .set(bearer(session.token))
    .send({})
    .expect(409);
  assert.equal(stateInvalid.body.message, 'REFUND_STATE_INVALID');

  // REFUND 金额与收款逐分不等：400 REFUND_AMOUNT_MISMATCH。
  const refundContract = await seedContract({
    customerId: customer.id,
    createdBy: session.userId,
    receivedAmount: new Prisma.Decimal('1000.00'),
  });
  const payment = await seedConfirmedPayment({
    contractId: refundContract.id,
    customerId: customer.id,
    createdBy: session.userId,
  });
  const mismatch = await app.httpRequest()
    .post('/api/v1/refunds')
    .set(bearer(session.token))
    .send({ type: 'REFUND', contractId: refundContract.id, paymentId: payment.id, amount: '999.99', reason: 'x' })
    .expect(400);
  assert.equal(mismatch.body.message, 'REFUND_AMOUNT_MISMATCH');
});
