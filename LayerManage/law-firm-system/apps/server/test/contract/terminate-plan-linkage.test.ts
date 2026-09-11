import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Contract, Payment, PaymentPlan, PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ContractService } from '../../app/application/contract/contract-service';
import { ReceivableService } from '../../app/application/contract/receivable-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  CONTRACT_ERROR_CODES,
  ContractError,
} from '../../app/domain/contract/contract-errors';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-012 Task 4: terminateContract 扩展（在途校验 + 计划取消 + 审计 canceledPlanCount）集成测试。
// 夹具沿 receivable-service.test.ts / contract-service.test.ts；矩阵：
//   1. 在途退款（PENDING/APPROVED RefundRequest）→ CONTRACT_TERMINATE_CONFLICT 409，
//      合同仍 EFFECTIVE、计划未动、零事件零审计。
//   2. 在途收款（PENDING Payment）→ 同 409 同零副作用。
//   3. REJECTED/EXECUTED 历史已决申请不阻 → terminate 成功。
//   4. 成功取消：三期（5k PENDING / 4k 收 1k PARTIAL / 2k RECEIVED）→ TERMINATED、
//      PENDING+PARTIAL 转 CANCELLED、RECEIVED 不动、receivedAmount 不变、
//      恰 2 条 payment_plan.cancelled + 1 条 contract.status_changed、
//      审计含 canceledPlanCount: 2。
//   5. 竞速 confirm-first（持锁钉法沿 receivable-service.test.ts:1119-1134）：
//      第三方持合同锁 1s → confirm 阻塞后先胜（PENDING→CONFIRMED）→ terminate 随后成功。
//      terminate-first 分支的 confirm→PAYMENT_STATE_INVALID 409 依赖 Task 5 门禁，留 Task 5 补。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/contract/terminate-plan-linkage.test.ts

let prisma: PrismaClient;

const CONTRACT_PERMISSIONS: PermissionCode[] = [
  'contract.read',
  'contract.create',
  'contract.submit',
  'contract.approve',
  'contract.sign',
  'contract.effect',
  'contract.terminate',
  'contract.void',
];

const PAYMENT_PERMISSIONS: PermissionCode[] = ['payment.read', 'payment.create', 'payment.confirm'];

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

interface ContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

function contractContext(userId: string, overrides: ContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? CONTRACT_PERMISSIONS;
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

function paymentContext(userId: string, overrides: ContextOverrides = {}): AuthorizationContext {
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

async function createActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `terminate.plan.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function serviceFor(userId: string, actor: AuditActor, overrides: ContextOverrides = {}): ContractService {
  return new ContractService(prisma, actor, contractContext(userId, overrides));
}

function receivableServiceFor(userId: string, actor: AuditActor, overrides: ContextOverrides = {}): ReceivableService {
  return new ReceivableService(prisma, actor, paymentContext(userId, overrides));
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '终止联动客户',
      phone: '13900004444',
      phoneHash: hashPhone('13900004444'),
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
  branchId?: string | null;
  professionalTeamId?: string | null;
}): Promise<Contract> {
  return prisma.contract.create({
    data: {
      contractNo: `XX-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractType: 'FIRST_SIGN',
      title: '终止联动夹具合同',
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      status: overrides.status ?? 'EFFECTIVE',
      amount: overrides.amount ?? '12000.00',
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
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

async function createRefundRequestRow(overrides: {
  contractId: string;
  customerId: string;
  createdBy: string;
  type?: string;
  amount?: string;
  status?: string;
}) {
  return prisma.refundRequest.create({
    data: {
      requestNo: `RF-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      type: overrides.type ?? 'REFUND',
      contractId: overrides.contractId,
      customerId: overrides.customerId,
      amount: overrides.amount ?? '1000.00',
      reason: '夹具退款/冲减申请',
      status: overrides.status ?? 'PENDING',
      createdBy: overrides.createdBy,
    },
  });
}

async function assertTerminateBlocked409(service: ContractService, contractId: string, reason: string): Promise<void> {
  await assert.rejects(
    () => service.terminateContract(contractId, { reason }),
    error => error instanceof ContractError
      && error.code === CONTRACT_ERROR_CODES.CONTRACT_TERMINATE_CONFLICT
      && error.httpStatus === 409,
  );
}

async function assertZeroTerminateSideEffects(contractId: string): Promise<void> {
  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  assert.equal(stored.status, 'EFFECTIVE', 'contract must remain EFFECTIVE after a blocked terminate');
  assert.equal(stored.terminatedAt, null, 'terminatedAt must stay null');
  assert.equal(
    await prisma.paymentPlan.count({ where: { contractId, status: 'CANCELLED' } }),
    0,
    'no plan may be cancelled by a blocked terminate',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT_PLAN', eventType: 'payment_plan.cancelled' } }),
    0,
    'no payment_plan.cancelled event may be emitted by a blocked terminate',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'CONTRACT', objectId: contractId, eventType: 'contract.status_changed' } }),
    0,
    'no contract.status_changed event may be emitted by a blocked terminate',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'CONTRACT', targetId: contractId, action: 'CONTRACT_TERMINATE' } }),
    0,
    'no CONTRACT_TERMINATE audit may be written by a blocked terminate',
  );
}

// SPEC-012 Task 5 门禁断言助手（confirm TERMINATED 门禁 / applyToPlan CANCELLED 排除）。
function isPaymentStateInvalid409(error: unknown): boolean {
  return error instanceof ContractError
    && error.code === CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID
    && error.httpStatus === 409;
}

function isAmountExceeded409(error: unknown): boolean {
  return error instanceof ContractError
    && error.code === CONTRACT_ERROR_CODES.PAYMENT_AMOUNT_EXCEEDED
    && error.httpStatus === 409;
}

function isContractStateInvalid409(error: unknown): boolean {
  return error instanceof ContractError
    && error.code === CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID
    && error.httpStatus === 409;
}

test('terminateContract blocks an in-flight PENDING refund request with 409 and leaves zero side effects', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  await createPlanRow({ contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00' });
  await createRefundRequestRow({ contractId: contract.id, customerId: customer.id, createdBy: userId, status: 'PENDING' });

  const service = serviceFor(userId, actor);
  await assertTerminateBlocked409(service, contract.id, '在途退款终止');
  await assertZeroTerminateSideEffects(contract.id);

  const plan = await prisma.paymentPlan.findFirstOrThrow({ where: { contractId: contract.id } });
  assert.equal(plan.status, 'PENDING', 'plan stays untouched by a blocked terminate');
});

test('terminateContract blocks an in-flight APPROVED refund request with 409 and leaves zero side effects', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  await createRefundRequestRow({ contractId: contract.id, customerId: customer.id, createdBy: userId, status: 'APPROVED' });

  const service = serviceFor(userId, actor);
  await assertTerminateBlocked409(service, contract.id, '在途批准退款终止');
  await assertZeroTerminateSideEffects(contract.id);
});

test('terminateContract blocks an in-flight PENDING payment with 409 and leaves zero side effects', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  await createPlanRow({ contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00' });
  await createPaymentRow({ contractId: contract.id, customerId: customer.id, createdBy: userId, status: 'PENDING' });

  const service = serviceFor(userId, actor);
  await assertTerminateBlocked409(service, contract.id, '在途收款终止');
  await assertZeroTerminateSideEffects(contract.id);

  const plan = await prisma.paymentPlan.findFirstOrThrow({ where: { contractId: contract.id } });
  assert.equal(plan.status, 'PENDING', 'plan stays untouched by a blocked terminate');
});

test('terminateContract ignores settled REJECTED/EXECUTED refund requests and succeeds', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  await createPlanRow({ contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00' });
  await createRefundRequestRow({ contractId: contract.id, customerId: customer.id, createdBy: userId, status: 'REJECTED' });
  await createRefundRequestRow({ contractId: contract.id, customerId: customer.id, createdBy: userId, status: 'EXECUTED' });

  const service = serviceFor(userId, actor);
  const view = await service.terminateContract(contract.id, { reason: '历史已决申请不阻终止' });

  assert.equal(view.status, 'TERMINATED');
  const plan = await prisma.paymentPlan.findFirstOrThrow({ where: { contractId: contract.id } });
  assert.equal(plan.status, 'CANCELLED', 'unsettled plan is cancelled on a successful terminate');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT_PLAN', eventType: 'payment_plan.cancelled' } }),
    1,
  );
});

test('terminateContract cancels unsettled PENDING/PARTIAL plans, keeps RECEIVED, and audits canceledPlanCount', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '11000.00',
  });
  // 合同 receivedAmount 与计划已收合计一致（计划2 收 1000 + 计划3 收 2000）。
  await prisma.contract.update({
    where: { id: contract.id },
    data: { receivedAmount: '3000.00' },
  });
  await createPlanRow({ contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00' });
  await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '4000.00',
    receivedAmount: '1000.00', status: 'PARTIAL',
  });
  await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 3, dueDate: '2026-11-01', amount: '2000.00',
    receivedAmount: '2000.00', status: 'RECEIVED',
  });

  const service = serviceFor(userId, actor);
  const view = await service.terminateContract(contract.id, { reason: '三期终止取消未清' });

  assert.equal(view.status, 'TERMINATED');
  assert.equal(view.receivedAmount, '3000.00', 'contract receivedAmount must stay unchanged by terminate');

  const stored = await prisma.paymentPlan.findMany({ where: { contractId: contract.id }, orderBy: { period: 'asc' } });
  assert.deepEqual(
    stored.map(plan => ({ period: plan.period, status: plan.status, received: plan.receivedAmount.toFixed(2) })),
    [
      { period: 1, status: 'CANCELLED', received: '0.00' },
      { period: 2, status: 'CANCELLED', received: '1000.00' },
      { period: 3, status: 'RECEIVED', received: '2000.00' },
    ],
    'PENDING and PARTIAL flip to CANCELLED; RECEIVED stays untouched; receivedAmount preserved per plan',
  );

  const cancelledEvents = await prisma.eventLog.findMany({
    where: { objectType: 'PAYMENT_PLAN', eventType: 'payment_plan.cancelled' },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(cancelledEvents.length, 2, 'exactly two payment_plan.cancelled events');
  const cancelledPlanIds = cancelledEvents.map(event => (event.payload as { planId: string }).planId).sort();
  assert.deepEqual(
    cancelledPlanIds,
    [stored[0].id, stored[1].id].sort(),
    'the two cancelled events target exactly the PENDING and PARTIAL plans',
  );
  for (const event of cancelledEvents) {
    assert.equal(event.sourceModule, 'CONTRACT');
    assert.equal(event.operatorUserId, userId);
    assert.deepEqual(event.payload, {
      planId: (event.payload as { planId: string }).planId,
      contractId: contract.id,
      status: 'CANCELLED',
    });
  }

  const statusChanged = await prisma.eventLog.findMany({
    where: { objectType: 'CONTRACT', objectId: contract.id, eventType: 'contract.status_changed' },
  });
  assert.equal(statusChanged.length, 1, 'exactly one contract.status_changed event');
  assert.deepEqual(statusChanged[0].payload, {
    contractId: contract.id,
    fromStatus: 'EFFECTIVE',
    toStatus: 'TERMINATED',
  });

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: contract.id, action: 'CONTRACT_TERMINATE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.fromStatus, 'EFFECTIVE');
  assert.equal(auditValues.toStatus, 'TERMINATED');
  assert.equal(auditValues.hasReason, true);
  assert.equal(auditValues.canceledPlanCount, 2, 'audit must carry the canceled plan count');
});

test('race: confirm-first wins under a held lock and terminate subsequently succeeds', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId, amount: '11000.00' });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const receivable = receivableServiceFor(userId, actor);
  const contractService = serviceFor(userId, actor);
  const registered = await receivable.createPayment({ contractId: contract.id, amount: '3000.00' });

  // 确定性竞速（持锁钉法沿 receivable-service.test.ts:1119-1134）：
  // 第三方事务持合同行锁 1s——confirm 的 FOR UPDATE 阻塞排队（先胜者确定），
  // 锁释放后 confirm 将 PENDING 收款确认为 CONFIRMED；随后 terminate 的在途校验
  // 读到无 PENDING 收款而放行（confirm-first 分支）。terminate-first 分支的
  // confirm→PAYMENT_STATE_INVALID 409 依赖 Task 5 门禁，留 Task 5 补断言。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 100));

  const confirmPromise = receivable.confirmPayment(registered.id, {});
  await lockHolder;
  const confirmed = await confirmPromise;
  assert.equal(confirmed.status, 'CONFIRMED', 'confirm must win the race');

  const terminated = await contractService.terminateContract(contract.id, { reason: '竞速终止' });
  assert.equal(terminated.status, 'TERMINATED', 'terminate succeeds once the PENDING payment is resolved');

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(storedPayment.status, 'CONFIRMED');
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.status, 'CANCELLED', 'the PARTIAL plan from the confirm is cancelled by terminate');
  assert.equal(storedPlan.receivedAmount.toFixed(2), '3000.00', 'plan received amount is preserved on cancel');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.status, 'TERMINATED');
  assert.equal(storedContract.receivedAmount.toFixed(2), '3000.00', 'confirm accumulation is not rolled back by terminate');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT_PLAN', eventType: 'payment_plan.cancelled' } }),
    1,
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'CONTRACT', objectId: contract.id, eventType: 'contract.status_changed' } }),
    1,
  );
  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'CONTRACT', targetId: contract.id, action: 'CONTRACT_TERMINATE' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.canceledPlanCount, 1);
});

// ==================== SPEC-012 Task 5: 竞速闭环收口 ====================
// 门禁矩阵（brief Step 1）：
//   1. 独立门禁：TERMINATED 合同 + PENDING payment → confirm PAYMENT_STATE_INVALID 409、
//      payment 仍 PENDING、零事件零审计。
//   2. applyToPlan 排除：CANCELLED 计划不被分摊，金额转后续未取消计划（贪心扫 + 指定期 409 双面）。
//   3. 竞速 terminate-first：terminate 先胜（合同 TERMINATED）→ confirm 随后门禁 409 零事件零审计。

test('confirmPayment rejects a PENDING payment on a TERMINATED contract with 409 and zero side effects', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'TERMINATED',
    amount: '5000.00',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'PENDING',
  });
  const receivable = receivableServiceFor(userId, actor);

  await assert.rejects(
    () => receivable.confirmPayment(payment.id, {}),
    isPaymentStateInvalid409,
    'confirm must be blocked once the contract is TERMINATED',
  );

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(storedPayment.status, 'PENDING', 'the blocked confirm never flips the payment');
  assert.equal(storedPayment.version, 1);
  assert.equal(storedPayment.confirmedBy, null);
  assert.equal(storedPayment.confirmedAt, null);
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.receivedAmount.toFixed(2), '0.00', 'no plan allocation on a blocked confirm');
  assert.equal(storedPlan.status, 'PENDING');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.status, 'TERMINATED');
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00', 'contract untouched by a blocked confirm');
  assert.equal(storedContract.version, 1, 'contract untouched by a blocked confirm');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', objectId: payment.id, eventType: 'payment.confirmed' } }),
    0,
    'zero payment.confirmed events on a blocked confirm',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', targetId: payment.id, action: 'PAYMENT_CONFIRM' } }),
    0,
    'zero PAYMENT_CONFIRM audits on a blocked confirm',
  );
});

test('confirmPayment skips a CANCELLED plan and routes the amount to the next non-cancelled plan', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
    amount: '10000.00',
  });
  const cancelledPlan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '4000.00', status: 'CANCELLED',
  });
  const pendingPlan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '6000.00',
  });
  const receivable = receivableServiceFor(userId, actor);
  const registered = await receivable.createPayment({ contractId: contract.id, amount: '5000.00' });

  await receivable.confirmPayment(registered.id, {});

  const afterCancelled = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: cancelledPlan.id } });
  assert.equal(afterCancelled.status, 'CANCELLED', 'a CANCELLED plan is never allocated');
  assert.equal(afterCancelled.receivedAmount.toFixed(2), '0.00');
  const afterPending = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: pendingPlan.id } });
  assert.equal(afterPending.receivedAmount.toFixed(2), '5000.00', 'amount flows to the next non-cancelled plan');
  assert.equal(afterPending.status, 'PARTIAL');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '5000.00');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', objectId: registered.id, eventType: 'payment.confirmed' } }),
    1,
    'the confirm succeeds with exactly one payment.confirmed event',
  );
});

test('confirmPayment refuses a payment designated to a CANCELLED plan with 409 and rolls back', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
    amount: '5000.00',
  });
  const cancelledPlan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00', status: 'CANCELLED',
  });
  const receivable = receivableServiceFor(userId, actor);
  const registered = await receivable.createPayment({
    contractId: contract.id,
    paymentPlanId: cancelledPlan.id,
    amount: '1000.00',
  });

  // defense-in-depth：applyToPlan 对 CANCELLED 计划原样返回剩余 → 指定期扫后仍有剩余 → 409 整事务回滚。
  await assert.rejects(
    () => receivable.confirmPayment(registered.id, {}),
    isAmountExceeded409,
    'a payment pinned to a CANCELLED plan must be refused',
  );

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(storedPayment.status, 'PENDING', 'the refused confirm rolls back the flip');
  assert.equal(storedPayment.version, 1);
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: cancelledPlan.id } });
  assert.equal(storedPlan.status, 'CANCELLED', 'the CANCELLED plan stays untouched');
  assert.equal(storedPlan.receivedAmount.toFixed(2), '0.00');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00');
  assert.equal(storedContract.version, 1);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.confirmed' } }),
    0,
    'zero payment.confirmed events on a refused confirm',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', action: 'PAYMENT_CONFIRM' } }),
    0,
    'zero PAYMENT_CONFIRM audits on a refused confirm',
  );
});

test('race: terminate-first wins under a held lock and confirm subsequently hits the TERMINATED gate', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId, amount: '11000.00' });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const receivable = receivableServiceFor(userId, actor);
  const contractService = serviceFor(userId, actor);
  const registered = await receivable.createPayment({ contractId: contract.id, amount: '3000.00' });
  const confirmed = await receivable.confirmPayment(registered.id, {});
  assert.equal(confirmed.status, 'CONFIRMED');

  // 确定性竞速（持锁钉法沿 receivable-service.test.ts:1119-1134）：
  // 第三方事务持合同行锁 1s——terminate 的在途校验读到无 PENDING 收款而放行（收款已
  // CONFIRMED），updateMany 阻塞在行锁排队；锁释放后 terminate 先胜（合同 TERMINATED、
  // 计划 CANCELLED）。随后 confirm 在 Task 5 门禁处读到已终止合同 → PAYMENT_STATE_INVALID
  // 409 零事件零审计（payment 保持 CONFIRMED 不被触碰）。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 100));

  const terminatePromise = contractService.terminateContract(contract.id, { reason: '竞速终止' });
  await lockHolder;
  const terminated = await terminatePromise;
  assert.equal(terminated.status, 'TERMINATED', 'terminate must win the race');

  await assert.rejects(
    () => receivable.confirmPayment(registered.id, {}),
    isPaymentStateInvalid409,
    'confirm on a terminated contract is caught by the Task 5 gate',
  );

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(storedPayment.status, 'CONFIRMED', 'the blocked confirm never flips the payment');
  assert.equal(storedPayment.version, 2, 'create + original confirm only');
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.status, 'CANCELLED', 'terminate cancelled the PARTIAL plan');
  assert.equal(storedPlan.receivedAmount.toFixed(2), '3000.00', 'plan received amount preserved on cancel');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.status, 'TERMINATED');
  assert.equal(storedContract.receivedAmount.toFixed(2), '3000.00', 'confirm accumulation is not rolled back by terminate');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', objectId: registered.id, eventType: 'payment.confirmed' } }),
    1,
    'the blocked confirm writes zero additional payment.confirmed events',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', targetId: registered.id, action: 'PAYMENT_CONFIRM' } }),
    1,
    'the blocked confirm writes zero additional PAYMENT_CONFIRM audits',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT_PLAN', eventType: 'payment_plan.cancelled' } }),
    1,
    'exactly one payment_plan.cancelled event from terminate',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'CONTRACT', objectId: contract.id, eventType: 'contract.status_changed' } }),
    1,
    'exactly one contract.status_changed event from terminate',
  );
});

// ==================== SPEC-014 Task 2: createPayment FOR UPDATE 竞速闭环 ====================
// 竞速 terminate-first：第三方持合同行锁 1s → terminate 先排队（先于 createPayment 取得锁）→
// createPayment 事务外预读仍见 EFFECTIVE（terminate 未提交）→ 进入事务在 FOR UPDATE 排队于
// terminate 之后 → 锁释放 terminate 先胜（TERMINATED）→ createPayment 锁后重验 TERMINATED →
// CONTRACT_STATE_TRANSITION_INVALID 409、零 payment 行、零 payment.created 事件、零
// PAYMENT_CREATE 审计。

test('race: terminate-first wins under a held lock and createPayment is blocked by the in-transaction status re-check', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
    amount: '12000.00',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '12000.00',
  });
  const receivable = receivableServiceFor(userId, actor);
  const contractService = serviceFor(userId, actor);

  // 持锁钉法（沿 receivable-service.test.ts:1119-1134）：第三方事务持合同行锁 1s。terminate
  // 先启动排队（其 updateMany 行锁在 FOR UPDATE 之后先到先得），createPayment 250ms 后启动——
  // 此刻 terminate 未提交，createPayment 事务外预读仍见 EFFECTIVE 通过 → 进入事务在 FOR
  // UPDATE 排队于 terminate 之后；锁释放后 terminate 先胜（TERMINATED、计划 CANCELLED），
  // createPayment 锁后重验 TERMINATED → 409 零行。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 100));

  const terminatePromise = contractService.terminateContract(contract.id, { reason: '竞速终止' });
  await new Promise(resolve => setTimeout(resolve, 250));

  const createPromise = receivable.createPayment({ contractId: contract.id, amount: '3000.00' });
  // 立即挂上 settle 处理（避免锁释放前 createPayment 若先拒则触发 unhandledRejection）。
  const createSettled = Promise.allSettled([createPromise]);

  await lockHolder;
  const terminated = await terminatePromise;
  assert.equal(terminated.status, 'TERMINATED', 'terminate must win the race');

  const [createResult] = await createSettled;
  assert.equal(createResult.status, 'rejected', 'createPayment must be rejected after terminate wins');
  if (createResult.status === 'rejected') {
    assert.ok(
      isContractStateInvalid409(createResult.reason),
      'createPayment rejection is CONTRACT_STATE_TRANSITION_INVALID 409',
    );
  }

  assert.equal(await prisma.payment.count({ where: { contractId: contract.id } }), 0, 'zero payment rows');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT' } }),
    0,
    'zero payment.created events on a blocked create',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT' } }),
    0,
    'zero PAYMENT_CREATE audits on a blocked create',
  );
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.status, 'CANCELLED', 'terminate cancelled the unsettled plan');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.status, 'TERMINATED');
});

// SPEC-014 F1 follow-up（terminate 侧硬化）：反向竞速残余窗关闭。
// createPayment-first 交错：createPayment 先取 Contract FOR UPDATE → INSERT PENDING 提交（不 bump
// contract version）→ terminate 的 FOR UPDATE 阻塞至 createPayment 提交 → 锁后重读必见已提交
// PENDING payment → CONTRACT_TERMINATE_CONFLICT 409 整事务回滚。合同保持 EFFECTIVE、PENDING 保留
// （不再滞留于 TERMINATED 合同——有 confirm/void/refund 处置路径）、零 terminate 副作用。

test('race: createPayment-first commits PENDING and terminate is blocked by the in-flight gate under the contract lock', async () => {
  const { userId, actor } = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
    amount: '12000.00',
  });
  await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '12000.00',
  });
  const receivable = receivableServiceFor(userId, actor);
  const contractService = serviceFor(userId, actor);

  // 持锁钉法（沿 :708-716 正向模板）：第三方事务持合同行锁 1s。createPayment 先启动排队
  // （其 FOR UPDATE 先到先得），terminate 250ms 后启动——此刻 createPayment 未提交，terminate
  // 的 FOR UPDATE 阻塞于 createPayment 之后；createPayment 提交 PENDING（version 不变）→ 锁释放
  // 后 terminate 获锁，锁后重读必见 PENDING → in-flight 闸 409，零写入。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 100));

  const createPromise = receivable.createPayment({ contractId: contract.id, amount: '3000.00' });
  await new Promise(resolve => setTimeout(resolve, 250));

  const terminatePromise = contractService.terminateContract(contract.id, { reason: '反向竞速' });
  // 立即挂上 settle 处理（避免锁释放前 terminate 若先拒则触发 unhandledRejection）。
  const terminateSettled = Promise.allSettled([terminatePromise]);

  await lockHolder;
  const created = await createPromise;
  assert.equal(created.status, 'PENDING', 'createPayment must win the race and persist PENDING');

  const [terminateResult] = await terminateSettled;
  assert.equal(terminateResult.status, 'rejected', 'terminate must be rejected after createPayment commits');
  if (terminateResult.status === 'rejected') {
    assert.ok(
      terminateResult.reason instanceof ContractError
        && terminateResult.reason.code === CONTRACT_ERROR_CODES.CONTRACT_TERMINATE_CONFLICT
        && terminateResult.reason.httpStatus === 409,
      'terminate rejection is CONTRACT_TERMINATE_CONFLICT 409',
    );
  }

  // 合同保持 EFFECTIVE，零 terminate 副作用（PENDING payment 保留、计划未取消、无 status_changed）。
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.status, 'EFFECTIVE', 'contract must remain EFFECTIVE');
  assert.equal(storedContract.terminatedAt, null, 'terminatedAt must stay null');
  const storedPayment = await prisma.payment.findFirstOrThrow({
    where: { contractId: contract.id, status: 'PENDING', deletedAt: null },
  });
  assert.equal(storedPayment.amount.toString(), '3000', 'PENDING payment persists with correct amount');
  assert.equal(
    await prisma.paymentPlan.count({ where: { contractId: contract.id, status: 'CANCELLED' } }),
    0,
    'no plan may be cancelled by a blocked terminate',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'CONTRACT', objectId: contract.id, eventType: 'contract.status_changed' } }),
    0,
    'no contract.status_changed event may be emitted by a blocked terminate',
  );
});
