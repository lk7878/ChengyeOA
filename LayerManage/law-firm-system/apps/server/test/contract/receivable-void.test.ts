import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Contract, Payment, PaymentPlan, PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ReceivableService } from '../../app/application/contract/receivable-service';
import { RefundService } from '../../app/application/finance/refund-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  CONTRACT_ERROR_CODES,
  ContractError,
} from '../../app/domain/contract/contract-errors';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-011 Task 7: receivable-service.voidPayment 收款冲销契约测试（FIN-03 冲销侧，
// 消费 Task 6 sweepBackReceived 资金回补唯一实现）。形态逐段镜像
// test/finance/refund-service.test.ts（Task 6 同族母版）：夹具直建行 + 授权上下文桩
// （resource=permissionCode 前缀）+ FOR UPDATE 持锁竞速钉法。
// 钉死点：payment.voided 恰 3 键 {paymentId, contractId, status}（registry sourceModule
//   CONTRACT、objectType PAYMENT——与 payment.created/confirmed 同族）；审计 PAYMENT_VOID
//   恰 5 键 {paymentNo, contractId, fromStatus:'CONFIRMED', toStatus:'VOIDED',
//   hasReason:true}——reason 自由文本落 payment.voidReason 业务列不落审计（grep 审计负载
//   零命中）；翻转谓词仅 {id, version, status:'CONFIRMED'}（协调者裁决①——软删写入路径
//   不存在，与 confirmPayment 翻转谓词同形）；败者重读已 VOIDED → 幂等返回现状（零事件
//   零审计零回补，计划/合同 version 不增），其他态 → PAYMENT_STATE_INVALID 409；
//   竞速：void vs confirmPayment 同合同锁串行——两调用均成功，总额不变式
//   receivedAmount = 6000 + 3000 − 6000 = 3000 序无关；void vs executeRefundRequest
//   同 payment（真实 RefundService 实例跨服务并发，非 mock——Task 6 评审 ⚠️① 路由项）
//   一胜一 PAYMENT_STATE_INVALID 409（败者按串行后状态走，全回滚）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/contract/receivable-void.test.ts

let prisma: PrismaClient;

const PAYMENT_PERMISSIONS: PermissionCode[] = [
  'payment.read',
  'payment.create',
  'payment.confirm',
  'payment.void',
];
const REFUND_PERMISSIONS: PermissionCode[] = [
  'refund.read',
  'refund.create',
  'refund.approve',
  'refund.execute',
];

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

interface VoidContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

/** 收款授权上下文：grants 的 resource 取 permissionCode 前缀（=catalog.resource，与生产 loader 一致）。 */
function paymentContext(userId: string, overrides: VoidContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? PAYMENT_PERMISSIONS;
  const scopeIds = overrides.scopeIds ?? ['ALL'];
  return {
    userId,
    employeeId: overrides.employeeId ?? null,
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

/** 退款授权上下文（void vs executeRefundRequest 跨服务竞速消费——真实实例，非 mock）。 */
function refundContext(userId: string): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: REFUND_PERMISSIONS.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    fieldRules: [],
    permissionCodes: REFUND_PERMISSIONS,
    evaluatedAt: new Date(),
  };
}

async function createVoidActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `void.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function receivableServiceFor(
  userId: string,
  actor: AuditActor,
  overrides: VoidContextOverrides = {},
): ReceivableService {
  return new ReceivableService(prisma, actor, paymentContext(userId, overrides));
}

function refundServiceFor(userId: string, actor: AuditActor): RefundService {
  return new RefundService(prisma, actor, refundContext(userId));
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '冲销客户',
      phone: '13900006666',
      phoneHash: hashPhone('13900006666'),
      status: 'SIGNED',
      createdBy,
    },
  });
}

async function createContractRow(overrides: {
  customerId: string;
  createdBy: string;
  amount?: string;
  status?: string;
  receivedAmount?: string;
  branchId?: string | null;
  professionalTeamId?: string | null;
}): Promise<Contract> {
  return prisma.contract.create({
    data: {
      contractNo: `XX-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractType: 'FIRST_SIGN',
      title: '冲销夹具合同',
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      status: overrides.status ?? 'SIGNED',
      amount: overrides.amount ?? '10000.00',
      receivedAmount: overrides.receivedAmount ?? '0.00',
      branchId: overrides.branchId ?? null,
      professionalTeamId: overrides.professionalTeamId ?? null,
    },
  });
}

async function createPlanRow(overrides: {
  contractId: string;
  createdBy: string;
  period: number;
  dueDate: string;
  amount: string;
  receivedAmount?: string;
  status?: string;
}): Promise<PaymentPlan> {
  return prisma.paymentPlan.create({
    data: {
      planNo: `PP-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractId: overrides.contractId,
      period: overrides.period,
      dueDate: new Date(overrides.dueDate),
      amount: overrides.amount,
      receivedAmount: overrides.receivedAmount ?? '0.00',
      status: overrides.status ?? 'PENDING',
      createdBy: overrides.createdBy,
    },
  });
}

async function createPaymentRow(overrides: {
  contractId: string;
  customerId: string;
  createdBy: string;
  amount?: string;
  status?: string;
  paymentPlanId?: string | null;
  deletedAt?: Date | null;
}): Promise<Payment> {
  return prisma.payment.create({
    data: {
      paymentNo: `PY-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractId: overrides.contractId,
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      amount: overrides.amount ?? '1000.00',
      status: overrides.status ?? 'PENDING',
      paymentPlanId: overrides.paymentPlanId ?? null,
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

async function createOrganizationFixture(code: string, parent?: { id: string; path: string }) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      code,
      name: code,
      type: 'BRANCH',
      parentId: parent?.id,
      path: parent ? `${parent.path}/${id}` : `/${id}`,
      level: parent ? parent.path.split('/').length - 1 : 0,
    },
  });
}

async function createTeamFixture(code: string, homeOrganizationId: string) {
  return prisma.professionalTeam.create({
    data: {
      code,
      name: `${code} 团队`,
      categoryCode: 'OTHER',
      homeOrganizationId,
    },
  });
}

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function isValidationFailed400(error: unknown): boolean {
  return error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400;
}

function isPaymentStateInvalid409(error: unknown): boolean {
  return error instanceof ContractError
    && error.code === CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID
    && error.httpStatus === 409;
}

function isPaymentNotFound404(error: unknown): boolean {
  return error instanceof ContractError
    && error.code === CONTRACT_ERROR_CODES.PAYMENT_NOT_FOUND
    && error.httpStatus === 404;
}

// ---------- 成功冲销（CONFIRMED→VOIDED 三方回补 + 事件/审计） ----------

test('voidPayment voids a confirmed payment, sweeps plans back to zero and emits event and audit', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  const branch = await createOrganizationFixture('BRANCH_VOID');
  const team = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  // 三期计划 5k/4k/1k（合计=合同额 10000）；confirm 8k → 一期 RECEIVED(5k)、
  // 二期 PARTIAL(3k/4k)、三期未触及；冲销 8k 后逐行回 PENDING（refund-service.test.ts
  // execute 成功用例同构形态，sweepBackReceived 逆序冲减逐行可断言）。
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
    status: 'EFFECTIVE',
    branchId: branch.id,
    professionalTeamId: team.id,
  });
  const plan1 = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const plan2 = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '4000.00',
  });
  const plan3 = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 3, dueDate: '2026-11-01', amount: '1000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({ paidAt: '2026-10-21T03:00:00.000Z', contractId: contract.id, amount: '8000.00' });
  await service.confirmPayment(registered.id, {});

  const view = await service.voidPayment(registered.id, { reason: '银行退票，冲销该笔收款' });

  assert.equal(view.id, registered.id);
  assert.equal(view.status, 'VOIDED');
  assert.equal(view.voidedBy, userId);
  assert.ok(view.voidedAt instanceof Date);
  assert.equal(view.voidReason, '银行退票，冲销该笔收款');
  assert.equal(view.version, 3, 'create + confirm + void bump the version three times');

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(storedPayment.status, 'VOIDED');
  assert.equal(storedPayment.voidedBy, userId);
  assert.ok(storedPayment.voidedAt instanceof Date);
  assert.equal(storedPayment.voidReason, '银行退票，冲销该笔收款');
  assert.equal(storedPayment.updatedBy, userId);

  // 计划/合同回补逐行断言（sweepBackReceived 逆序冲减，状态重推导，永不写 OVERDUE）。
  const after1 = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan1.id } });
  assert.equal(after1.receivedAmount.toFixed(2), '0.00');
  assert.equal(after1.status, 'PENDING');
  assert.equal(after1.version, 3, 'create + confirm + sweep');
  const after2 = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan2.id } });
  assert.equal(after2.receivedAmount.toFixed(2), '0.00');
  assert.equal(after2.status, 'PENDING');
  assert.equal(after2.version, 3);
  const after3 = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan3.id } });
  assert.equal(after3.receivedAmount.toFixed(2), '0.00');
  assert.equal(after3.status, 'PENDING');
  assert.equal(after3.version, 1, 'the never-received plan stays untouched');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00');
  assert.equal(storedContract.updatedBy, userId);
  assert.equal(storedContract.version, 3, 'confirm +1, void sweep +1');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'PAYMENT', objectId: registered.id, eventType: 'payment.voided' },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CONTRACT', 'payment.voided belongs to the CONTRACT module family');
  assert.equal(event.operatorUserId, userId);
  assert.equal(event.organizationId, null);
  assert.equal(event.branchId, branch.id, 'event branchId/teamId anchor the contract columns');
  assert.equal(event.teamId, team.id);
  assert.deepEqual(event.payload, {
    paymentId: registered.id,
    contractId: contract.id,
    status: 'VOIDED',
  }, 'payment.voided carries exactly three keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'PAYMENT', targetId: registered.id, action: 'PAYMENT_VOID' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    paymentNo: registered.paymentNo,
    contractId: contract.id,
    fromStatus: 'CONFIRMED',
    toStatus: 'VOIDED',
    hasReason: true,
  }, 'audit holds identifiers + status transition + hasReason');
  assert.ok(!operationLog.newValues?.includes('银行退票'), 'reason free text stays out of audit values');

  // 投影三字段在读路径（getPayment 视图）同步可见。
  const reread = await service.getPayment(registered.id);
  assert.equal(reread.status, 'VOIDED');
  assert.equal(reread.voidedBy, userId);
  assert.deepEqual(reread.voidedAt, view.voidedAt);
  assert.equal(reread.voidReason, '银行退票，冲销该笔收款');
});

// ---------- 状态闸（非 CONFIRMED → PAYMENT_STATE_INVALID 409） ----------

test('voidPayment rejects a PENDING payment with PAYMENT_STATE_INVALID 409 and writes nothing', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({ paidAt: '2026-10-21T03:00:00.000Z', contractId: contract.id, amount: '3000.00' });

  await assert.rejects(
    () => service.voidPayment(registered.id, { reason: '未确认不可冲销' }),
    isPaymentStateInvalid409,
    'only CONFIRMED payments are voidable',
  );

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(storedPayment.status, 'PENDING', 'a rejected void never touches the payment');
  assert.equal(storedPayment.version, 1);
  assert.equal(storedPayment.voidedBy, null);
  assert.equal(storedPayment.voidedAt, null);
  assert.equal(storedPayment.voidReason, null);
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00', 'rollback performs zero sweep');
  assert.equal(storedContract.version, 1);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.voided' } }),
    0,
    'rollback writes zero payment.voided events',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', action: 'PAYMENT_VOID' } }),
    0,
    'rollback writes zero PAYMENT_VOID audits',
  );
});

test('voidPayment rejects a REFUNDED payment with PAYMENT_STATE_INVALID 409', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const refunded = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '2000.00', status: 'REFUNDED',
  });
  const service = receivableServiceFor(userId, actor);

  await assert.rejects(
    () => service.voidPayment(refunded.id, { reason: '已退款不可冲销' }),
    isPaymentStateInvalid409,
    'REFUNDED is a terminal state for voiding',
  );

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: refunded.id } });
  assert.equal(storedPayment.status, 'REFUNDED');
  assert.equal(storedPayment.version, 1);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.voided' } }),
    0,
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', action: 'PAYMENT_VOID' } }),
    0,
  );
});

// ---------- 幂等重放（双冲销第二次零事件零审计零回补） ----------

test('voidPayment replays an already-voided payment with zero event, audit and re-sweep', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({ paidAt: '2026-10-21T03:00:00.000Z', contractId: contract.id, amount: '4000.00' });
  await service.confirmPayment(registered.id, {});

  const first = await service.voidPayment(registered.id, { reason: '首次冲销' });
  const contractAfterFirst = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  const planAfterFirst = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });

  const replayed = await service.voidPayment(registered.id, { reason: '重放冲销（不同事由）' });

  assert.equal(replayed.status, 'VOIDED');
  assert.equal(replayed.version, first.version, 'replay returns the current projection without another flip');
  assert.deepEqual(replayed.voidedAt, first.voidedAt);
  assert.equal(replayed.voidReason, '首次冲销', 'replay does not overwrite the original void reason');

  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.version, contractAfterFirst.version, 'replay does not re-sweep the contract');
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00');
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.version, planAfterFirst.version, 'replay does not re-sweep the plan');
  assert.equal(storedPlan.receivedAmount.toFixed(2), '0.00');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.voided' } }),
    1,
    'exactly one payment.voided event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', action: 'PAYMENT_VOID' } }),
    1,
    'exactly one PAYMENT_VOID audit',
  );
});

// ---------- 竞速：void vs confirmPayment（同合同锁串行，总额不变式） ----------

test('concurrent voidPayment and confirmPayment serialize on the contract lock with the total invariant', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '10000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const paymentA = await service.createPayment({ paidAt: '2026-10-21T03:00:00.000Z', contractId: contract.id, amount: '6000.00' });
  await service.confirmPayment(paymentA.id, {});
  const paymentB = await service.createPayment({ paidAt: '2026-10-21T03:00:00.000Z', contractId: contract.id, amount: '3000.00' });

  // 确定性竞速（refund-service.test.ts execute vs confirm 同型钉法）：第三方事务持合同行
  // FOR UPDATE 1s，void 与 confirm 双双阻塞在首把锁；锁释放后按串行顺序提交——不论谁先
  // 胜，终态一致：合同/计划恰被 +3000（B 确认）与 −6000（A 冲销回补）各作用一次，
  // receivedAmount 归 3000 PARTIAL；两调用均成功。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 100));

  const results = await Promise.allSettled([
    service.voidPayment(paymentA.id, { reason: '竞速冲销' }),
    service.confirmPayment(paymentB.id, {}),
  ]);
  await lockHolder;

  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 0, `both calls must succeed, got ${String(rejected[0]?.reason)}`);

  const storedPaymentA = await prisma.payment.findUniqueOrThrow({ where: { id: paymentA.id } });
  assert.equal(storedPaymentA.status, 'VOIDED');
  const storedPaymentB = await prisma.payment.findUniqueOrThrow({ where: { id: paymentB.id } });
  assert.equal(storedPaymentB.status, 'CONFIRMED');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '3000.00', '6000 + 3000 - 6000 regardless of order');
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.receivedAmount.toFixed(2), '3000.00', 'plan re-derived to the same state in either order');
  assert.equal(storedPlan.status, 'PARTIAL');
  assert.equal(
    await prisma.eventLog.count({
      where: { objectType: 'PAYMENT', objectId: paymentA.id, eventType: 'payment.voided' },
    }),
    1,
    'exactly one payment.voided event for payment A',
  );
  assert.equal(
    await prisma.eventLog.count({
      where: { objectType: 'PAYMENT', objectId: paymentB.id, eventType: 'payment.confirmed' },
    }),
    1,
    'exactly one payment.confirmed event for payment B',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', action: 'PAYMENT_VOID' } }),
    1,
    'exactly one PAYMENT_VOID audit',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', action: 'PAYMENT_CONFIRM' } }),
    2,
    'one PAYMENT_CONFIRM audit per confirmed payment (A earlier + B now)',
  );
});

// ---------- 竞速：void vs executeRefundRequest 同 payment（一胜一 409，真实跨服务实例） ----------

test('concurrent voidPayment and executeRefundRequest on the same payment produce exactly one winner', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '10000.00',
  });
  const receivable = receivableServiceFor(userId, actor);
  const payment = await receivable.createPayment({ paidAt: '2026-10-21T03:00:00.000Z', contractId: contract.id, amount: '6000.00' });
  await receivable.confirmPayment(payment.id, {});
  const refundService = refundServiceFor(userId, actor);
  const refund = await refundService.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id,
    amount: '6000.00', reason: '竞速退款申请',
  });
  await refundService.approveRefundRequest(refund.id, {});

  // 确定性竞速（FOR UPDATE 行锁钉法，Task 6 评审 ⚠️① 路由项——真实 RefundService 实例
  // 跨服务并发，非 mock）：双方同以 Contract 行 FOR UPDATE 为首把锁整体串行；胜者翻转
  // payment 并回补提交，败者取得锁后 updateMany 重评 where（status 已非 CONFIRMED）→
  // count=0 → PAYMENT_STATE_INVALID 409 全回滚（void 败：payment 留 REFUNDED；execute
  // 败：请求留 APPROVED）。一胜一 409，回补恰一次。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 100));

  const [voidResult, executeResult] = await Promise.allSettled([
    receivable.voidPayment(payment.id, { reason: '竞速冲销' }),
    refundService.executeRefundRequest(refund.id, {}),
  ]);
  await lockHolder;

  const results = [voidResult, executeResult];
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one of void/execute wins the payment flip');
  assert.equal(rejected.length, 1, 'exactly one loses with PAYMENT_STATE_INVALID 409');
  assert.ok(
    isPaymentStateInvalid409(rejected[0].reason),
    `the loser must fail with PAYMENT_STATE_INVALID 409, got ${String(rejected[0].reason)}`,
  );

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  const storedRefund = await prisma.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
  const voidedEvents = await prisma.eventLog.count({
    where: { objectType: 'PAYMENT', objectId: payment.id, eventType: 'payment.voided' },
  });
  const executedEvents = await prisma.eventLog.count({
    where: { objectType: 'REFUND_REQUEST', objectId: refund.id, eventType: 'refund.executed' },
  });
  const voidAudits = await prisma.operationLog.count({
    where: { targetType: 'PAYMENT', targetId: payment.id, action: 'PAYMENT_VOID' },
  });
  const executeAudits = await prisma.operationLog.count({
    where: { targetType: 'REFUND_REQUEST', targetId: refund.id, action: 'REFUND_EXECUTE' },
  });
  if (voidResult.status === 'fulfilled') {
    assert.equal(storedPayment.status, 'VOIDED', 'void won: payment is VOIDED');
    assert.equal(storedRefund.status, 'APPROVED', 'execute lost and rolled back to APPROVED');
    assert.equal(storedRefund.version, 2, 'create + approve only');
    assert.equal(voidedEvents, 1);
    assert.equal(executedEvents, 0, 'the losing execute writes zero refund.executed events');
    assert.equal(voidAudits, 1);
    assert.equal(executeAudits, 0, 'the losing execute writes zero REFUND_EXECUTE audits');
  } else {
    assert.equal(storedPayment.status, 'REFUNDED', 'execute won: payment is REFUNDED');
    assert.equal(storedRefund.status, 'EXECUTED');
    assert.equal(voidedEvents, 0, 'the losing void writes zero payment.voided events');
    assert.equal(executedEvents, 1);
    assert.equal(voidAudits, 0, 'the losing void writes zero PAYMENT_VOID audits');
    assert.equal(executeAudits, 1);
  }

  // 序无关不变式：胜者回补恰一次——合同/计划回到 0。
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00', 'exactly one sweep-back regardless of winner');
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.receivedAmount.toFixed(2), '0.00');
  assert.equal(storedPlan.status, 'PENDING');
});

// ---------- 入参校验（reason 必填 1-500） ----------

test('voidPayment rejects a missing, blank or overlong reason with 400', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const service = receivableServiceFor(userId, actor);

  for (const reason of [undefined, '', '   ', 'x'.repeat(501)]) {
    await assert.rejects(
      () => service.voidPayment(payment.id, { reason: reason as string }),
      isValidationFailed400,
      `reason ${String(reason?.slice(0, 20))} must be rejected (reason is required, 1-500 chars)`,
    );
  }

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(storedPayment.status, 'CONFIRMED', 'a rejected void never touches the payment');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.voided' } }),
    0,
  );
});

// ---------- 范围 fail-closed（不可见/不存在/软删 → PAYMENT_NOT_FOUND 404） ----------

test('voidPayment returns PAYMENT_NOT_FOUND 404 for an invisible, missing or soft-deleted payment', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const foreignPayment = await createPaymentRow({
    contractId: foreign.id, customerId: customer.id, createdBy: 'someone-else',
    amount: '1000.00', status: 'CONFIRMED',
  });
  const own = await createContractRow({ customerId: customer.id, createdBy: userId });
  const softDeleted = await createPaymentRow({
    contractId: own.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED', deletedAt: new Date(),
  });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  // SELF 范围解析以 context.employeeId 填 employeeIds（不读 employee 行，合成 id 即可）。
  const scoped = receivableServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });
  const service = receivableServiceFor(userId, actor);

  await assert.rejects(
    () => scoped.voidPayment(foreignPayment.id, { reason: '越权冲销' }),
    isPaymentNotFound404,
    'out-of-scope payment is indistinguishable from missing',
  );
  await assert.rejects(
    () => scoped.voidPayment(randomUUID(), { reason: '不存在' }),
    isPaymentNotFound404,
  );
  await assert.rejects(
    () => service.voidPayment(softDeleted.id, { reason: '软删探查' }),
    isPaymentNotFound404,
    'probe carries deletedAt null (coordinator ruling 1)',
  );

  const storedForeign = await prisma.payment.findUniqueOrThrow({ where: { id: foreignPayment.id } });
  assert.equal(storedForeign.status, 'CONFIRMED', 'out-of-scope void never mutates the payment');
  const storedSoftDeleted = await prisma.payment.findUniqueOrThrow({ where: { id: softDeleted.id } });
  assert.equal(storedSoftDeleted.status, 'CONFIRMED');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.voided' } }),
    0,
  );
});

// ---------- 动作权限（payment.void 为 ACTION/HIGH 码） ----------

test('voidPayment requires the payment.void action permission', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const denied = receivableServiceFor(userId, actor, {
    permissionCodes: ['payment.read', 'payment.create', 'payment.confirm'],
  });

  await assert.rejects(
    () => denied.voidPayment(payment.id, { reason: '无权限' }),
    hasCode('PERMISSION_DENIED'),
  );
  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(storedPayment.status, 'CONFIRMED');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.voided' } }),
    0,
  );
});

// ---------- SPEC-012 Task 5: sweep 保 CANCELLED（终态恒终态，仅冲减 receivedAmount） ----------

test('sweepBackReceived preserves a CANCELLED plan status when a full refund sweeps it to zero', async () => {
  const { userId, actor } = await createVoidActor();
  const customer = await createCustomerFixture(userId);
  // 终止后场景：合同 TERMINATED，计划 CANCELLED（收 1k/5k），payment 仍 CONFIRMED；
  // 整单退款 1k 触发 sweepBackReceived —— 计划 receivedAmount 冲减至 0，状态恒 CANCELLED。
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '5000.00',
    status: 'TERMINATED',
    receivedAmount: '1000.00',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
    receivedAmount: '1000.00', status: 'CANCELLED',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED', paymentPlanId: plan.id,
  });
  const refundService = refundServiceFor(userId, actor);
  const refund = await refundService.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id,
    amount: '1000.00', reason: '终止后整单退款',
  });
  await refundService.approveRefundRequest(refund.id, {});
  await refundService.executeRefundRequest(refund.id, {});

  const afterPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(afterPlan.receivedAmount.toFixed(2), '0.00', 'sweep reduces the cancelled plan received to zero');
  assert.equal(afterPlan.status, 'CANCELLED', 'CANCELLED is a terminal state — must not flip back to PENDING');
  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(storedPayment.status, 'REFUNDED', 'the refunded payment flips to REFUNDED');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00', 'contract receivedAmount swept to zero');
  assert.equal(storedContract.status, 'TERMINATED', 'contract stays TERMINATED');
});
