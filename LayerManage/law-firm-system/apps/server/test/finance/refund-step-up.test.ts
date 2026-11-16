import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { GovernanceStepUpConsumer } from '../../app/application/admin-governance/governance-step-up';
import { ActiveSessionClaims, SessionService } from '../../app/application/auth/session-service';
import { StepUpService } from '../../app/application/auth/step-up-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { RefundService } from '../../app/application/finance/refund-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { FINANCE_ERROR_CODES, FinanceError } from '../../app/domain/finance/finance-errors';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { decodeBase32 } from '../../app/domain/security/base32';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { TotpService } from '../../app/domain/security/totp-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-013 Task 7: refund.approve 真实 Step-Up（REFUND_APPROVE 目的位消费侧契约）。
// 形态沿 admin-governance/governance-step-up.test.ts 先例：mock consumer 记录目的位/target；
// 另含一个真实 StepUpService consumer 集成——证明 digest 绑定（expectedVersion 不符 →
// STEP_UP_TARGET_MISMATCH 403）。服务构造注入 consumer（生产 finance-factory 注入
// createAuthenticationServices(ctx).stepUp），不注入时 approve 语义不变（既有 46 例不破坏）。
// 矩阵：持证通过 / 无证 403 STEP_UP_REQUIRED / 目标无法绑定（缺 expectedVersion）400 /
// expectedVersion 不符 409（前置版本冲突）/ digest 不匹配 403。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/finance/refund-step-up.test.ts

let prisma: PrismaClient;

const REFUND_PERMISSIONS: PermissionCode[] = [
  'refund.read',
  'refund.create',
  'refund.approve',
  'refund.execute',
];
const JWT_SECRET = '01234567890123456789012345678901';
const MFA_KEY = Buffer.from('0123456789abcdef0123456789abcdef');
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

test.before(() => {
  prisma = createTestPrisma();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

interface RefundContextOverrides {
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

/** 退款授权上下文：grants 的 resource 取 permissionCode 前缀（与 refund-service.test 同形）。 */
function refundContext(userId: string, overrides: RefundContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? REFUND_PERMISSIONS;
  const scopeIds = overrides.scopeIds ?? ['ALL'];
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: permissionCodes.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds,
      validUntil: null,
    })),
    fieldRules: [],
    permissionCodes,
    evaluatedAt: new Date(),
  };
}

async function createRefundActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `refund.stepup.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function refundServiceFor(
  userId: string,
  actor: AuditActor,
  stepUp?: GovernanceStepUpConsumer,
): RefundService {
  return new RefundService(prisma, actor, refundContext(userId), undefined, stepUp);
}

function claims(userId: string): ActiveSessionClaims {
  return { userId, sessionId: randomUUID(), credentialVersion: 1, assuranceLevel: 'MFA' };
}

function authorization(userId: string) {
  return { claims: claims(userId), token: `grant-${randomUUID()}` };
}

function isSecurityError(code: string, httpStatus: number): (error: unknown) => boolean {
  return error => Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === code
    && 'httpStatus' in error
    && error.httpStatus === httpStatus,
  );
}

function isValidationFailed400(error: unknown): boolean {
  return error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400;
}

function isFinanceError(code: string, httpStatus: number): (error: unknown) => boolean {
  return error => error instanceof FinanceError && error.code === code && error.httpStatus === httpStatus;
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SU-${randomUUID()}`,
      name: 'StepUp退款客户',
      phone: '13900006666',
      phoneHash: hashPhone('13900006666'),
      status: 'SIGNED',
      createdBy,
    },
  });
}

async function createContractRow(customerId: string, createdBy: string) {
  return prisma.contract.create({
    data: {
      contractNo: `XX-SU-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractType: 'FIRST_SIGN',
      title: 'StepUp夹具合同',
      customerId,
      createdBy,
      status: 'EFFECTIVE',
      amount: '10000.00',
      receivedAmount: '0.00',
    },
  });
}

async function createPaymentRow(contractId: string, customerId: string, createdBy: string) {
  return prisma.payment.create({
    data: {
      paymentNo: `PY-SU-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractId,
      customerId,
      createdBy,
      amount: '1000.00',
      status: 'CONFIRMED',
    },
  });
}

/** 直接建退款行（绕过服务层 create，聚焦 approve 的 Step-Up 前置校验）。 */
async function createRefundRow(contractId: string, customerId: string, createdBy: string) {
  return prisma.refundRequest.create({
    data: {
      requestNo: `RF-SU-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      type: 'REFUND',
      contractId,
      customerId,
      paymentId: (await prisma.payment.findFirstOrThrow({ where: { contractId }, select: { id: true } })).id,
      amount: '1000.00',
      reason: 'StepUp 夹具事由',
      status: 'PENDING',
      createdBy,
    },
  });
}

// ---------- 真实 StepUpService 集成夹具（digest 绑定证明） ----------

function codeAt(time: Date): string {
  const counter = BigInt(Math.floor(time.getTime() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(TOTP_SECRET)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/** 固定时钟变量（真实 consumer 集成用）：issue/consume/SessionService 共用同一 now，
 *  两次发证间隔推进 30s 窗口，规避 TOTP 重放（lastAcceptedCounter）拒绝。 */
let now: Date;

async function mfaSession(userId: string): Promise<ActiveSessionClaims> {
  const credentials = await new SessionService(
    prisma,
    new JwtTokenService(JWT_SECRET),
    undefined,
    () => new Date(now),
  ).create(userId, 'MFA', {});
  return { userId, sessionId: credentials.sessionId, credentialVersion: 1, assuranceLevel: 'MFA' };
}

async function seedMfaFactor(userId: string): Promise<void> {
  const encrypted = new MfaSecretCrypto(new Map([[1, MFA_KEY]])).encrypt(TOTP_SECRET);
  await prisma.mfaFactor.create({
    data: {
      userId,
      type: 'TOTP',
      encryptedSecret: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
      verifiedAt: now,
    },
  });
}

function realStepUpService(): StepUpService {
  return new StepUpService(
    prisma,
    new TotpService(),
    new MfaSecretCrypto(new Map([[1, MFA_KEY]])),
    undefined,
    () => new Date(now),
  );
}

// ---------- mock consumer 矩阵 ----------

test('consumes a REFUND_APPROVE grant bound to refundRequestId+expectedVersion before flipping', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow(customer.id, userId);
  await createPaymentRow(contract.id, customer.id, userId);
  const refund = await createRefundRow(contract.id, customer.id, userId);

  const calls: Array<{ purpose: string; target: unknown; token: string }> = [];
  const consumer: GovernanceStepUpConsumer = {
    async consume(_tx, _claims, purpose, target, rawToken) {
      calls.push({ purpose, target, token: rawToken });
    },
  };
  const service = refundServiceFor(userId, actor, consumer);
  const authz = authorization(userId);

  const view = await service.approveRefundRequest(
    refund.id,
    { comment: 'StepUp 审批通过', expectedVersion: refund.version },
    authz,
  );

  assert.equal(view.status, 'APPROVED');
  assert.equal(view.approvedBy, userId);
  assert.equal(view.version, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].purpose, 'REFUND_APPROVE');
  assert.deepEqual(calls[0].target, { refundRequestId: refund.id, expectedVersion: refund.version });
  assert.equal(calls[0].token, authz.token);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.approved' } }),
    1,
  );
});

test('rejects a missing grant with STEP_UP_REQUIRED 403 without flipping', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow(customer.id, userId);
  await createPaymentRow(contract.id, customer.id, userId);
  const refund = await createRefundRow(contract.id, customer.id, userId);
  const calls: string[] = [];
  const consumer: GovernanceStepUpConsumer = {
    async consume() { calls.push('consumed'); },
  };
  const service = refundServiceFor(userId, actor, consumer);

  await assert.rejects(
    () => service.approveRefundRequest(refund.id, { expectedVersion: refund.version }),
    isSecurityError('STEP_UP_REQUIRED', 403),
  );
  assert.equal(calls.length, 0, 'consumer must never run without a grant');
  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.version, 1);
});

test('rejects an unbindable target (missing expectedVersion) with 400', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow(customer.id, userId);
  await createPaymentRow(contract.id, customer.id, userId);
  const refund = await createRefundRow(contract.id, customer.id, userId);
  const calls: string[] = [];
  const consumer: GovernanceStepUpConsumer = {
    async consume() { calls.push('consumed'); },
  };
  const service = refundServiceFor(userId, actor, consumer);

  await assert.rejects(
    () => service.approveRefundRequest(refund.id, { comment: '缺版本号' }, authorization(userId)),
    isValidationFailed400,
  );
  await assert.rejects(
    () => service.approveRefundRequest(refund.id, { expectedVersion: 0 }, authorization(userId)),
    isValidationFailed400,
    'expectedVersion must be a safe positive integer to bind the target',
  );
  assert.equal(calls.length, 0);
  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(stored.status, 'PENDING');
});

test('rejects a stale expectedVersion with 409 before consuming the grant', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow(customer.id, userId);
  await createPaymentRow(contract.id, customer.id, userId);
  const refund = await createRefundRow(contract.id, customer.id, userId);
  const calls: string[] = [];
  const consumer: GovernanceStepUpConsumer = {
    async consume() { calls.push('consumed'); },
  };
  const service = refundServiceFor(userId, actor, consumer);

  // 客户端所见版本（2）≠ 服务重读版本（1）：陈旧目标 → 409（grant 亦不可复用）。
  await assert.rejects(
    () => service.approveRefundRequest(refund.id, { expectedVersion: 2 }, authorization(userId)),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, 409),
  );
  assert.equal(calls.length, 0, 'stale target must fail before grant consumption');
  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(stored.status, 'PENDING');
});

// Ordinary refund approval no longer issues a legacy REFUND_APPROVE proof.
test('rejects retired refund proofs while ordinary approval retains business checks and audit', async () => {
  const { userId, actor } = await createRefundActor();
  now = new Date('2099-01-02T03:04:05.000Z');
  await seedMfaFactor(userId);
  const sessionClaims = await mfaSession(userId);
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow(customer.id, userId);
  await createPaymentRow(contract.id, customer.id, userId);
  const refund = await createRefundRow(contract.id, customer.id, userId);
  await assert.rejects(() => realStepUpService().issue(sessionClaims, {
    purpose: 'REFUND_APPROVE', target: { refundRequestId: refund.id, expectedVersion: refund.version }, code: codeAt(now),
  }), isSecurityError('STEP_UP_INVALID', 403));
  assert.equal(await prisma.stepUpGrant.count({ where: { userId } }), 0);
  const view = await refundServiceFor(userId, actor).approveRefundRequest(refund.id, { expectedVersion: refund.version });
  assert.equal(view.status, 'APPROVED');
  assert.equal(await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.approved' } }), 1);
  assert.equal(await prisma.operationLog.count({ where: { targetId: refund.id, action: 'REFUND_APPROVE' } }), 1);
});
