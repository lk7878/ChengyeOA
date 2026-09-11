import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Contract, Payment, PaymentPlan, Prisma, PrismaClient, RefundRequest } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { ReceivableService, sweepBackReceived } from '../../app/application/contract/receivable-service';
import { RefundService } from '../../app/application/finance/refund-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  CONTRACT_ERROR_CODES,
  ContractError,
} from '../../app/domain/contract/contract-errors';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { FINANCE_ERROR_CODES, FinanceError } from '../../app/domain/finance/finance-errors';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-011 Task 6: refund-service 契约测试（FIN-03 退款/减免 + sweepBackReceived 资金回补，
// 本 SPEC 风险最高点）。形态逐段镜像 test/finance/invoice-service.test.ts（Task 5 同族
// 母版）：夹具（customer/contract/paymentPlan/payment/refundRequest 直建行 + 授权上下文桩
// resource=permissionCode 前缀）+ 范围夹具（SELF/TEAM/BRANCH 锚定合同列）+ 竞速钉法
// （第三方事务持合同行 FOR UPDATE 1s 造确定性败者）。
// 钉死点：refund.requested 恰 6 键（无 amount——amount toFixed(2) 落 REFUND_CREATE 审计）/
//   approved/rejected 恰 3 键 / executed 恰 5 键（paymentId/planId 一实一空）；审计只落
//   标识符（create/execute 含 hasReason:true、execute 含 paymentId 或 planId）；approve 无
//   额度重验（协调者裁决 1，与 invoice 不同）；reject 挂 refund.approve 码（catalog 无
//   refund.reject，设计裁决 12 同型）；REFUND 执行翻转 {status:'CONFIRMED'}→REFUNDED
//   count=0 → PAYMENT_STATE_INVALID 409 全回滚；WAIVER 执行重验失败 →
//   WAIVER_AMOUNT_EXCEEDED 409 全回滚；sweepBackReceived 计划逆序（dueDate DESC,
//   period DESC）逐期冲减 + 下溢守卫 PAYMENT_STATE_INVALID 409 + 无计划 vacuous。
// 跨服务竞速（execute vs voidPayment）不写——brief 明示归 Task 7 测试文件。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/finance/refund-service.test.ts

let prisma: PrismaClient;

const REFUND_PERMISSIONS: PermissionCode[] = [
  'refund.read',
  'refund.create',
  'refund.approve',
  'refund.execute',
];
const PAYMENT_PERMISSIONS: PermissionCode[] = ['payment.read', 'payment.create', 'payment.confirm'];
const REQUEST_NO_PATTERN = /^RF\d{6}-[A-Z0-9]{6}$/;

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
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

/** 退款授权上下文：grants 的 resource 取 permissionCode 前缀（=catalog.resource，与生产 loader 一致）。 */
function refundContext(userId: string, overrides: RefundContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? REFUND_PERMISSIONS;
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

/** 收款授权上下文（execute vs confirmPayment 竞速与 WAIVER 重验推高场景消费）。 */
function paymentContext(userId: string): AuthorizationContext {
  return {
    userId,
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: PAYMENT_PERMISSIONS.map(permissionCode => ({
      sourceType: 'ROLE' as const,
      sourceId: `${userId}-grant-${permissionCode}`,
      sourceRoleId: 'test-role',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    fieldRules: [],
    permissionCodes: PAYMENT_PERMISSIONS,
    evaluatedAt: new Date(),
  };
}

async function createRefundActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `refund.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function refundServiceFor(
  userId: string,
  actor: AuditActor,
  overrides: RefundContextOverrides = {},
): RefundService {
  return new RefundService(prisma, actor, refundContext(userId, overrides));
}

function receivableServiceFor(userId: string, actor: AuditActor): ReceivableService {
  return new ReceivableService(prisma, actor, paymentContext(userId));
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '退款客户',
      phone: '13900005555',
      phoneHash: hashPhone('13900005555'),
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
      title: '退款夹具合同',
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
    },
  });
}

/** 直建行夹具：绕过服务层校验（在途重复/执行重验推高/越权探查场景只能靠直建行构造）。 */
async function createRefundRow(overrides: {
  contractId: string;
  customerId: string;
  createdBy: string;
  type?: string;
  paymentId?: string | null;
  planId?: string | null;
  amount?: string;
  reason?: string;
  status?: string;
}): Promise<RefundRequest> {
  return prisma.refundRequest.create({
    data: {
      requestNo: `RF-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      type: overrides.type ?? 'REFUND',
      contractId: overrides.contractId,
      customerId: overrides.customerId,
      paymentId: overrides.paymentId ?? null,
      planId: overrides.planId ?? null,
      amount: overrides.amount ?? '1000.00',
      reason: overrides.reason ?? '夹具事由',
      status: overrides.status ?? 'PENDING',
      createdBy: overrides.createdBy,
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

function isFinanceError(code: string, httpStatus: number): (error: unknown) => boolean {
  return error => error instanceof FinanceError && error.code === code && error.httpStatus === httpStatus;
}

function isContractNotFound404(error: unknown): boolean {
  return error instanceof ContractError
    && error.code === CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND
    && error.httpStatus === 404;
}

function isPaymentStateInvalid409(error: unknown): boolean {
  return error instanceof ContractError
    && error.code === CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID
    && error.httpStatus === 409;
}

// ---------- sweepBackReceived（退款/冲销共享资金回补，Task 7 voidPayment 消费） ----------

test('sweepBackReceived unwinds received plans newest-first and re-derives statuses', async () => {
  const { userId } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  // 三期计划 5k/3k/2k 全 RECEIVED（brief Step 1 钉死形态），合同累计 10000。
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
    status: 'EFFECTIVE',
    receivedAmount: '10000.00',
  });
  const plan1 = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01',
    amount: '5000.00', receivedAmount: '5000.00', status: 'RECEIVED',
  });
  const plan2 = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01',
    amount: '3000.00', receivedAmount: '3000.00', status: 'RECEIVED',
  });
  const plan3 = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 3, dueDate: '2026-11-01',
    amount: '2000.00', receivedAmount: '2000.00', status: 'RECEIVED',
  });

  // 调用方须已持 Contract 行 FOR UPDATE 锁（函数文档钉死的前置，测试同纪律模拟）。
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await sweepBackReceived(tx, contract.id, new Prisma.Decimal('4000.00'), userId);
  });

  // 逆序冲减：第三期 2k→0 PENDING；第二期 3k 冲 2k→1k PARTIAL；第一期不动。
  const after3 = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan3.id } });
  assert.equal(after3.receivedAmount.toFixed(2), '0.00');
  assert.equal(after3.status, 'PENDING');
  assert.equal(after3.version, 2);
  const after2 = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan2.id } });
  assert.equal(after2.receivedAmount.toFixed(2), '1000.00');
  assert.equal(after2.status, 'PARTIAL');
  assert.equal(after2.version, 2);
  const after1 = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan1.id } });
  assert.equal(after1.receivedAmount.toFixed(2), '5000.00', 'newest-first sweep never touches the oldest plan');
  assert.equal(after1.status, 'RECEIVED');
  assert.equal(after1.version, 1, 'untouched plan keeps its version');

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(stored.receivedAmount.toFixed(2), '6000.00');
  assert.equal(stored.updatedBy, userId);
  assert.equal(stored.version, 2);
});

test('sweepBackReceived rejects an over-sweep beyond contract receivedAmount with 409 and rolls back', async () => {
  const { userId } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
    status: 'EFFECTIVE',
    receivedAmount: '3000.00',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01',
    amount: '5000.00', receivedAmount: '3000.00', status: 'PARTIAL',
  });

  await assert.rejects(
    () => prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
      await sweepBackReceived(tx, contract.id, new Prisma.Decimal('3000.01'), userId);
    }),
    isPaymentStateInvalid409,
    'sweep-back exceeding the contract receivedAmount trips the underflow guard',
  );

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(stored.receivedAmount.toFixed(2), '3000.00', 'rollback leaves the contract untouched');
  assert.equal(stored.version, 1);
  const afterPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(afterPlan.receivedAmount.toFixed(2), '3000.00', 'rollback leaves the plan untouched');
  assert.equal(afterPlan.status, 'PARTIAL');
  assert.equal(afterPlan.version, 1);
});

test('sweepBackReceived on a planless contract only reduces the contract total (vacuous plan sweep)', async () => {
  const { userId } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  // SIGNED 未生效收款：合同级累计为唯一载体（confirmPayment 裁决④同语义），无计划行。
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
    receivedAmount: '5000.00',
  });

  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await sweepBackReceived(tx, contract.id, new Prisma.Decimal('2000.00'), userId);
  });

  const stored = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(stored.receivedAmount.toFixed(2), '3000.00');
  assert.equal(stored.version, 2);
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: contract.id } }), 0);
});

// ---------- 创建 createRefundRequest（REFUND/WAIVER 类型分流） ----------

test('createRefundRequest registers a REFUND request with refund.requested (6 keys, no amount) and audit', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const branch = await createOrganizationFixture('BRANCH_RF');
  const team = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
    branchId: branch.id,
    professionalTeamId: team.id,
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '4000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);

  const view = await service.createRefundRequest({
    type: 'REFUND',
    contractId: contract.id,
    paymentId: payment.id,
    amount: '4000.00',
    reason: '客户缴费后解除委托，申请全额退款',
  });

  assert.ok(view.id);
  assert.match(view.requestNo, REQUEST_NO_PATTERN);
  assert.equal(view.type, 'REFUND');
  assert.equal(view.contractId, contract.id);
  assert.equal(view.customerId, customer.id, 'customerId copied from the contract (redundant anchor)');
  assert.equal(view.paymentId, payment.id);
  assert.equal(view.planId, null);
  assert.equal(view.amount, '4000.00');
  assert.equal(view.reason, '客户缴费后解除委托，申请全额退款');
  assert.equal(view.status, 'PENDING');
  assert.equal(view.approvedBy, null);
  assert.equal(view.executedBy, null);
  assert.equal(view.executedAt, null);
  assert.equal(view.createdBy, userId);
  assert.equal(view.version, 1);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'REFUND_REQUEST', objectId: view.id, eventType: 'refund.requested' },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'FINANCE');
  assert.equal(event.operatorUserId, userId);
  assert.equal(event.organizationId, null);
  assert.equal(event.branchId, branch.id, 'event branchId/teamId anchor the contract columns');
  assert.equal(event.teamId, team.id);
  assert.deepEqual(event.payload, {
    refundRequestId: view.id,
    requestNo: view.requestNo,
    type: 'REFUND',
    contractId: contract.id,
    customerId: customer.id,
    status: 'PENDING',
  }, 'refund.requested carries exactly six keys (amount stays out of the event)');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'REFUND_REQUEST', targetId: view.id, action: 'REFUND_CREATE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: view.requestNo,
    type: 'REFUND',
    contractId: contract.id,
    amount: '4000.00',
    hasReason: true,
  }, 'audit holds identifiers + amount toFixed(2) + hasReason');
  assert.ok(!operationLog.newValues?.includes('解除委托'), 'reason free text stays out of audit values');
});

test('createRefundRequest registers a WAIVER request with planId anchor and type-specific audit', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const service = refundServiceFor(userId, actor);

  const view = await service.createRefundRequest({
    type: 'WAIVER',
    contractId: contract.id,
    planId: plan.id,
    amount: '2000.00',
    reason: '困难客户部分减免',
  });

  assert.equal(view.type, 'WAIVER');
  assert.equal(view.paymentId, null);
  assert.equal(view.planId, plan.id);
  assert.equal(view.status, 'PENDING');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'REFUND_REQUEST', objectId: view.id, eventType: 'refund.requested' },
  });
  assert.deepEqual(event.payload, {
    refundRequestId: view.id,
    requestNo: view.requestNo,
    type: 'WAIVER',
    contractId: contract.id,
    customerId: customer.id,
    status: 'PENDING',
  }, 'refund.requested carries exactly six keys for WAIVER too');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'REFUND_REQUEST', targetId: view.id, action: 'REFUND_CREATE' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: view.requestNo,
    type: 'WAIVER',
    contractId: contract.id,
    amount: '2000.00',
    hasReason: true,
  });
});

test('createRefundRequest REFUND rejects a missing or foreign payment with 400', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const foreignContract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const foreignPayment = await createPaymentRow({
    contractId: foreignContract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.createRefundRequest({
      type: 'REFUND', contractId: contract.id, amount: '1000.00', reason: '缺 paymentId',
    }),
    isValidationFailed400,
    'REFUND without paymentId is a validation failure',
  );
  await assert.rejects(
    () => service.createRefundRequest({
      type: 'REFUND', contractId: contract.id, paymentId: randomUUID(), amount: '1000.00', reason: '不存在',
    }),
    isValidationFailed400,
    'REFUND against a missing payment is a validation failure',
  );
  await assert.rejects(
    () => service.createRefundRequest({
      type: 'REFUND', contractId: contract.id, paymentId: foreignPayment.id, amount: '1000.00', reason: '属他合同',
    }),
    isValidationFailed400,
    'REFUND against a payment of another contract is a validation failure',
  );
  assert.equal(await prisma.refundRequest.count({ where: { contractId: contract.id } }), 0);
});

test('createRefundRequest REFUND rejects a non-CONFIRMED payment with PAYMENT_STATE_INVALID 409', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const pendingPayment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'PENDING',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.createRefundRequest({
      type: 'REFUND', contractId: contract.id, paymentId: pendingPayment.id, amount: '1000.00', reason: '未确认收款',
    }),
    isPaymentStateInvalid409,
    'only CONFIRMED payments are refundable',
  );
  assert.equal(await prisma.refundRequest.count({ where: { contractId: contract.id } }), 0);
});

test('createRefundRequest REFUND rejects an amount differing from the payment amount with 400', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '4000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.createRefundRequest({
      type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '3999.99', reason: '金额不符',
    }),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_AMOUNT_MISMATCH, 400),
    'refund amount must equal the payment amount exactly',
  );
  assert.equal(await prisma.refundRequest.count({ where: { contractId: contract.id } }), 0);
});

test('createRefundRequest REFUND rejects an in-flight request for the same payment but frees a REJECTED one', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const pendingTarget = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const approvedTarget = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '2000.00', status: 'CONFIRMED',
  });
  const rejectedTarget = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '3000.00', status: 'CONFIRMED',
  });
  await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: pendingTarget.id, amount: '1000.00', status: 'PENDING',
  });
  await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: approvedTarget.id, amount: '2000.00', status: 'APPROVED',
  });
  await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: rejectedTarget.id, amount: '3000.00', status: 'REJECTED',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.createRefundRequest({
      type: 'REFUND', contractId: contract.id, paymentId: pendingTarget.id, amount: '1000.00', reason: '重复申请',
    }),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, 409),
    'a PENDING refund request blocks a duplicate for the same payment',
  );
  await assert.rejects(
    () => service.createRefundRequest({
      type: 'REFUND', contractId: contract.id, paymentId: approvedTarget.id, amount: '2000.00', reason: '重复申请',
    }),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, 409),
    'an APPROVED refund request blocks a duplicate for the same payment',
  );

  const freed = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: rejectedTarget.id, amount: '3000.00', reason: '驳回后重新申请',
  });
  assert.equal(freed.status, 'PENDING', 'REJECTED frees the in-flight slot');
});

test('createRefundRequest REFUND rejects a planId anchor with 400 (cross anchors forbidden)', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.createRefundRequest({
      type: 'REFUND', contractId: contract.id, paymentId: payment.id, planId: plan.id,
      amount: '1000.00', reason: '交叉锚点',
    }),
    isValidationFailed400,
    'REFUND anchors paymentId only; planId is forbidden',
  );
});

test('createRefundRequest WAIVER rejects a missing or foreign plan with 400', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const foreignContract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const foreignPlan = await createPlanRow({
    contractId: foreignContract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.createRefundRequest({
      type: 'WAIVER', contractId: contract.id, amount: '1000.00', reason: '缺 planId',
    }),
    isValidationFailed400,
    'WAIVER without planId is a validation failure',
  );
  await assert.rejects(
    () => service.createRefundRequest({
      type: 'WAIVER', contractId: contract.id, planId: randomUUID(), amount: '1000.00', reason: '不存在',
    }),
    isValidationFailed400,
    'WAIVER against a missing plan is a validation failure',
  );
  await assert.rejects(
    () => service.createRefundRequest({
      type: 'WAIVER', contractId: contract.id, planId: foreignPlan.id, amount: '1000.00', reason: '属他合同',
    }),
    isValidationFailed400,
    'WAIVER against a plan of another contract is a validation failure',
  );
});

test('createRefundRequest WAIVER rejects a paymentId anchor with 400 (cross anchors forbidden)', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.createRefundRequest({
      type: 'WAIVER', contractId: contract.id, planId: plan.id, paymentId: payment.id,
      amount: '1000.00', reason: '交叉锚点',
    }),
    isValidationFailed400,
    'WAIVER anchors planId only; paymentId is forbidden',
  );
});

test('createRefundRequest WAIVER rejects a RECEIVED plan with WAIVER_PLAN_STATE_INVALID 409', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01',
    amount: '5000.00', receivedAmount: '5000.00', status: 'RECEIVED',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.createRefundRequest({
      type: 'WAIVER', contractId: contract.id, planId: plan.id, amount: '1000.00', reason: '已收满',
    }),
    isFinanceError(FINANCE_ERROR_CODES.WAIVER_PLAN_STATE_INVALID, 409),
    'only PENDING/PARTIAL plans are waivable',
  );
});

test('createRefundRequest WAIVER enforces the remainder: exact fill passes, 0.01 over fails', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const partialPlan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01',
    amount: '5000.00', receivedAmount: '3000.00', status: 'PARTIAL',
  });
  const service = refundServiceFor(userId, actor);

  const exact = await service.createRefundRequest({
    type: 'WAIVER', contractId: contract.id, planId: partialPlan.id, amount: '2000.00', reason: '恰满余额',
  });
  assert.equal(exact.status, 'PENDING', 'waiver equal to the plan remainder passes');

  const overPlan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01',
    amount: '5000.00', receivedAmount: '3000.00', status: 'PARTIAL',
  });
  await assert.rejects(
    () => service.createRefundRequest({
      type: 'WAIVER', contractId: contract.id, planId: overPlan.id, amount: '2000.01', reason: '超额一分',
    }),
    isFinanceError(FINANCE_ERROR_CODES.WAIVER_AMOUNT_EXCEEDED, 400),
    'waiver above the plan remainder fails with 400 at creation',
  );
  assert.equal(
    await prisma.refundRequest.count({ where: { contractId: contract.id, type: 'WAIVER', planId: overPlan.id } }),
    0,
    'the rejected waiver writes zero rows',
  );
});

test('createRefundRequest rejects a missing or blank reason with 400', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);

  for (const reason of [undefined, '', '   ']) {
    await assert.rejects(
      () => service.createRefundRequest({
        type: 'REFUND', contractId: contract.id, paymentId: payment.id,
        amount: '1000.00', reason: reason as string,
      }),
      isValidationFailed400,
      `reason ${String(reason)} must be rejected (reason is required for refund/waiver)`,
    );
  }
  assert.equal(await prisma.refundRequest.count({ where: { contractId: contract.id } }), 0);
});

test('createRefundRequest rejects an unknown type and malformed amounts with 400', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.createRefundRequest({
      type: 'DISCOUNT' as 'REFUND', contractId: contract.id, paymentId: payment.id,
      amount: '1000.00', reason: '未知类型',
    }),
    isValidationFailed400,
    'type must be REFUND or WAIVER',
  );
  for (const amount of ['0', 0, '-1.00', '10.005', 'not-a-number', undefined]) {
    await assert.rejects(
      () => service.createRefundRequest({
        type: 'REFUND', contractId: contract.id, paymentId: payment.id,
        amount: amount as string, reason: '金额非法',
      }),
      isValidationFailed400,
      `amount ${String(amount)} must be rejected`,
    );
  }
  assert.equal(await prisma.refundRequest.count({ where: { contractId: contract.id } }), 0);
});

test('createRefundRequest returns CONTRACT_NOT_FOUND 404 for an invisible or missing contract', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const payment = await createPaymentRow({
    contractId: foreign.id, customerId: customer.id, createdBy: 'someone-else',
    amount: '1000.00', status: 'CONFIRMED',
  });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  // SELF 范围解析以 context.employeeId 填 employeeIds（不读 employee 行，合成 id 即可）。
  const scoped = refundServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });

  await assert.rejects(
    () => scoped.createRefundRequest({
      type: 'REFUND', contractId: foreign.id, paymentId: payment.id, amount: '1000.00', reason: '越权合同',
    }),
    isContractNotFound404,
    'out-of-scope contract is indistinguishable from missing',
  );
  await assert.rejects(
    () => scoped.createRefundRequest({
      type: 'REFUND', contractId: randomUUID(), paymentId: payment.id, amount: '1000.00', reason: '不存在',
    }),
    isContractNotFound404,
  );
  assert.equal(await prisma.refundRequest.count({ where: { contractId: foreign.id } }), 0);
});

test('createRefundRequest requires the refund.create action permission', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const denied = refundServiceFor(userId, actor, {
    permissionCodes: ['refund.read', 'refund.approve', 'refund.execute'],
  });

  await assert.rejects(
    () => denied.createRefundRequest({
      type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '1000.00', reason: '无权限',
    }),
    hasCode('PERMISSION_DENIED'),
  );
  assert.equal(await prisma.refundRequest.count({ where: { contractId: contract.id } }), 0);
});

// ---------- 审批 approveRefundRequest（refund.approve 为 SPECIAL/CRITICAL 码） ----------

test('approveRefundRequest flips PENDING to APPROVED with refund.approved (3 keys) and audit', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '4000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '4000.00', reason: '退款审批测试',
  });

  const view = await service.approveRefundRequest(created.id, { comment: '主管同意退款' });

  assert.equal(view.status, 'APPROVED');
  assert.equal(view.approvedBy, userId);
  assert.ok(view.approvedAt instanceof Date);
  assert.equal(view.approvalComment, '主管同意退款');
  assert.equal(view.version, 2, 'approve bumps the refund version once');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'REFUND_REQUEST', objectId: created.id, eventType: 'refund.approved' },
  });
  assert.equal(event.sourceModule, 'FINANCE');
  assert.deepEqual(event.payload, {
    refundRequestId: created.id,
    contractId: contract.id,
    status: 'APPROVED',
  }, 'refund.approved carries exactly three keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'REFUND_REQUEST', targetId: created.id, action: 'REFUND_APPROVE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: created.requestNo,
    contractId: contract.id,
    fromStatus: 'PENDING',
    toStatus: 'APPROVED',
  });
  assert.ok(!operationLog.newValues?.includes('主管同意'), 'comment free text stays out of audit values');
});

test('approveRefundRequest replays an already-approved request without a new event or audit', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '4000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '4000.00', reason: '重放测试',
  });

  const first = await service.approveRefundRequest(created.id, { comment: '首次审批' });
  const replayed = await service.approveRefundRequest(created.id, { comment: '重放审批' });

  assert.equal(replayed.status, 'APPROVED');
  assert.equal(replayed.version, first.version, 'replay returns the current projection without another flip');
  assert.deepEqual(replayed.approvedAt, first.approvedAt);
  assert.equal(replayed.approvalComment, '首次审批', 'replay does not overwrite the approval comment');

  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.approved' } }),
    1,
    'exactly one refund.approved event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'REFUND_REQUEST', action: 'REFUND_APPROVE' } }),
    1,
    'exactly one REFUND_APPROVE audit',
  );
});

test('approveRefundRequest rejects a REJECTED or EXECUTED request with REFUND_STATE_INVALID 409', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const rejectedTarget = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const executedTarget = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '2000.00', status: 'CONFIRMED',
  });
  const rejectedRefund = await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: rejectedTarget.id, amount: '1000.00', status: 'REJECTED',
  });
  const executedRefund = await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: executedTarget.id, amount: '2000.00', status: 'EXECUTED',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.approveRefundRequest(rejectedRefund.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, 409),
    'approve on REJECTED is an invalid transition',
  );
  await assert.rejects(
    () => service.approveRefundRequest(executedRefund.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, 409),
    'approve on EXECUTED is an invalid transition (not an idempotent replay)',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.approved' } }),
    0,
  );
});

test('concurrent approveRefundRequest of the same request succeeds twice with exactly one flip', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '4000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '4000.00', reason: '审批竞速',
  });

  // 确定性竞速（receivable-service.test.ts confirm 竞速先例的 FOR UPDATE 行锁钉法）：
  // 第三方事务持合同行锁 1s，两个审批事务的 findFirst 均先读到 PENDING v1，随后双双阻塞
  // 在 FOR UPDATE；锁释放后胜者翻转+事件+审计一并提交，败者取得锁后 updateMany 重评
  // where（status 已 APPROVED）→ count=0 → 重读走幂等重放路径成功返回——双调用均成功，
  // 恰翻转一次。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 100));

  const results = await Promise.allSettled([
    service.approveRefundRequest(created.id, {}),
    service.approveRefundRequest(created.id, {}),
  ]);
  await lockHolder;

  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 2, 'both approves succeed (loser replays idempotently)');
  assert.equal(rejected.length, 0, `no call may fail, got ${String(rejected[0]?.reason)}`);
  for (const result of fulfilled) {
    assert.equal(result.value.status, 'APPROVED');
    assert.equal(result.value.version, 2, 'exactly one flip commits');
  }

  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'APPROVED');
  assert.equal(stored.version, 2);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.approved' } }),
    1,
    'exactly one refund.approved event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'REFUND_REQUEST', action: 'REFUND_APPROVE' } }),
    1,
    'exactly one REFUND_APPROVE audit',
  );
});

test('approveRefundRequest returns REFUND_NOT_FOUND 404 for an invisible or missing request', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const refund = await createRefundRow({
    contractId: foreign.id, customerId: customer.id, createdBy: 'someone-else',
  });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = refundServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });

  await assert.rejects(
    () => scoped.approveRefundRequest(refund.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, 404),
    'out-of-scope refund request is indistinguishable from missing',
  );
  await assert.rejects(
    () => scoped.approveRefundRequest(randomUUID(), {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, 404),
  );
  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(stored.status, 'PENDING', 'out-of-scope approve never mutates the request');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.approved' } }),
    0,
  );
});

test('approveRefundRequest requires the refund.approve special permission', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '1000.00', reason: '权限测试',
  });
  const denied = refundServiceFor(userId, actor, {
    permissionCodes: ['refund.read', 'refund.create', 'refund.execute'],
  });

  // refund.approve 为 SPECIAL/CRITICAL 预存码：缺失抛 SPECIAL_PERMISSION_REQUIRED 403（非 PERMISSION_DENIED）。
  await assert.rejects(() => denied.approveRefundRequest(created.id, {}), hasCode('SPECIAL_PERMISSION_REQUIRED'));
  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'PENDING');
});

// ---------- 驳回 rejectRefundRequest（挂 refund.approve 权限码——catalog 无 refund.reject） ----------

test('rejectRefundRequest flips PENDING to REJECTED with refund.rejected (3 keys) and audit', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '4000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '4000.00', reason: '驳回测试',
  });

  const view = await service.rejectRefundRequest(created.id, { comment: '退款凭证不足' });

  assert.equal(view.status, 'REJECTED');
  assert.equal(view.approvedBy, userId);
  assert.ok(view.approvedAt instanceof Date);
  assert.equal(view.approvalComment, '退款凭证不足', 'rejection comment lands on approvalComment');
  assert.equal(view.version, 2);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'REFUND_REQUEST', objectId: created.id, eventType: 'refund.rejected' },
  });
  assert.equal(event.sourceModule, 'FINANCE');
  assert.deepEqual(event.payload, {
    refundRequestId: created.id,
    contractId: contract.id,
    status: 'REJECTED',
  }, 'refund.rejected carries exactly three keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'REFUND_REQUEST', targetId: created.id, action: 'REFUND_REJECT' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: created.requestNo,
    contractId: contract.id,
    fromStatus: 'PENDING',
    toStatus: 'REJECTED',
  });
});

test('rejectRefundRequest replays an already-rejected request without a new event or audit', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '4000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '4000.00', reason: '驳回重放',
  });

  const first = await service.rejectRefundRequest(created.id, {});
  const replayed = await service.rejectRefundRequest(created.id, {});

  assert.equal(replayed.status, 'REJECTED');
  assert.equal(replayed.version, first.version);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.rejected' } }),
    1,
    'exactly one refund.rejected event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'REFUND_REQUEST', action: 'REFUND_REJECT' } }),
    1,
    'exactly one REFUND_REJECT audit',
  );
});

test('rejectRefundRequest rejects an APPROVED or EXECUTED request with REFUND_STATE_INVALID 409', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const approvedTarget = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const executedTarget = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '2000.00', status: 'CONFIRMED',
  });
  const approvedRefund = await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: approvedTarget.id, amount: '1000.00', status: 'APPROVED',
  });
  const executedRefund = await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: executedTarget.id, amount: '2000.00', status: 'EXECUTED',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.rejectRefundRequest(approvedRefund.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, 409),
    'reject on APPROVED is an invalid transition',
  );
  await assert.rejects(
    () => service.rejectRefundRequest(executedRefund.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, 409),
    'reject on EXECUTED is an invalid transition',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.rejected' } }),
    0,
  );
});

test('rejectRefundRequest requires the refund.approve special permission (reject hangs on the approve code)', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id, amount: '1000.00', reason: '驳回权限',
  });
  const denied = refundServiceFor(userId, actor, {
    permissionCodes: ['refund.read', 'refund.create', 'refund.execute'],
  });

  await assert.rejects(() => denied.rejectRefundRequest(created.id, {}), hasCode('SPECIAL_PERMISSION_REQUIRED'));
  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'PENDING');
});

// ---------- 执行 executeRefundRequest（FIN-03 回补核心） ----------

test('executeRefundRequest refunds a confirmed payment and sweeps plans back to zero newest-first', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  // 三期计划 5k/4k/1k（合计=合同额 10000）；confirm 8k → 一期 RECEIVED(5k)、
  // 二期 PARTIAL(3k/4k)、三期未触及（brief Step 4 钉死语义：退款 8k 单笔后计划逐行回
  // PENDING/PENDING/（未触及）PENDING；计划金额口径 5k/4k/1k 为使"二期 PARTIAL"成立的
  // 唯一形态——5k/3k/2k 下 confirm 8k 恰将二期收满为 RECEIVED，与钉死语义矛盾）。
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
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
  const receivable = receivableServiceFor(userId, actor);
  const registered = await receivable.createPayment({ contractId: contract.id, amount: '8000.00' });
  await receivable.confirmPayment(registered.id, {});

  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: registered.id,
    amount: '8000.00', reason: '解除委托全额退款',
  });
  await service.approveRefundRequest(created.id, {});

  const view = await service.executeRefundRequest(created.id, {});

  assert.equal(view.status, 'EXECUTED');
  assert.equal(view.executedBy, userId);
  assert.ok(view.executedAt instanceof Date);
  assert.equal(view.version, 3, 'create + approve + execute bump the version three times');

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(storedPayment.status, 'REFUNDED');
  assert.equal(storedPayment.version, 3, 'create + confirm + refund flip');

  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00', 'sweep returns the contract total to zero');

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

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'REFUND_REQUEST', objectId: created.id, eventType: 'refund.executed' },
  });
  assert.equal(event.sourceModule, 'FINANCE');
  assert.deepEqual(event.payload, {
    refundRequestId: created.id,
    contractId: contract.id,
    paymentId: registered.id,
    planId: null,
    status: 'EXECUTED',
  }, 'refund.executed carries exactly five keys (REFUND anchors paymentId, planId null)');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'REFUND_REQUEST', targetId: created.id, action: 'REFUND_EXECUTE' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: created.requestNo,
    type: 'REFUND',
    contractId: contract.id,
    paymentId: registered.id,
    fromStatus: 'APPROVED',
    toStatus: 'EXECUTED',
    hasReason: true,
  });
});

test('executeRefundRequest on a planless SIGNED contract only sweeps the contract total', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  // 生效前收款（SIGNED 未生效，无计划行——confirmPayment 裁决④：合同级累计为唯一约束）。
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'SIGNED',
  });
  const receivable = receivableServiceFor(userId, actor);
  const registered = await receivable.createPayment({ contractId: contract.id, amount: '3000.00' });
  await receivable.confirmPayment(registered.id, {});

  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: registered.id,
    amount: '3000.00', reason: '生效前收款退回',
  });
  await service.approveRefundRequest(created.id, {});

  const view = await service.executeRefundRequest(created.id, {});

  assert.equal(view.status, 'EXECUTED');
  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(storedPayment.status, 'REFUNDED');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00', 'planless sweep is contract-level only');
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: contract.id } }), 0);
});

test('executeRefundRequest replays an already-executed request with zero event, audit and re-sweep', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const receivable = receivableServiceFor(userId, actor);
  const registered = await receivable.createPayment({ contractId: contract.id, amount: '4000.00' });
  await receivable.confirmPayment(registered.id, {});
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: registered.id,
    amount: '4000.00', reason: '幂等重放测试',
  });
  await service.approveRefundRequest(created.id, {});

  const first = await service.executeRefundRequest(created.id, {});
  const contractAfterFirst = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  const planAfterFirst = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });

  const replayed = await service.executeRefundRequest(created.id, {});

  assert.equal(replayed.status, 'EXECUTED');
  assert.equal(replayed.version, first.version, 'replay returns the current projection without another flip');
  assert.deepEqual(replayed.executedAt, first.executedAt);

  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.version, contractAfterFirst.version, 'replay does not re-sweep the contract');
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00');
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.version, planAfterFirst.version, 'replay does not re-sweep the plan');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.executed' } }),
    1,
    'exactly one refund.executed event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'REFUND_REQUEST', action: 'REFUND_EXECUTE' } }),
    1,
    'exactly one REFUND_EXECUTE audit',
  );
});

test('executeRefundRequest rejects a PENDING or REJECTED request with REFUND_STATE_INVALID 409', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const pendingTarget = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const rejectedTarget = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '2000.00', status: 'CONFIRMED',
  });
  const pendingRefund = await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: pendingTarget.id, amount: '1000.00', status: 'PENDING',
  });
  const rejectedRefund = await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: rejectedTarget.id, amount: '2000.00', status: 'REJECTED',
  });
  const service = refundServiceFor(userId, actor);

  await assert.rejects(
    () => service.executeRefundRequest(pendingRefund.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, 409),
    'execute without a prior approve is an invalid transition',
  );
  await assert.rejects(
    () => service.executeRefundRequest(rejectedRefund.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_STATE_INVALID, 409),
    'execute on REJECTED is an invalid transition',
  );
  const pendingPayment = await prisma.payment.findUniqueOrThrow({ where: { id: pendingTarget.id } });
  assert.equal(pendingPayment.status, 'CONFIRMED', 'a rejected execute never touches the payment');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.executed' } }),
    0,
  );
});

test('executeRefundRequest rolls back with PAYMENT_STATE_INVALID 409 when the payment is no longer CONFIRMED', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const receivable = receivableServiceFor(userId, actor);
  const registered = await receivable.createPayment({ contractId: contract.id, amount: '4000.00' });
  await receivable.confirmPayment(registered.id, {});
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: registered.id,
    amount: '4000.00', reason: '并发败者测试',
  });
  await service.approveRefundRequest(created.id, {});
  // 审批间隙支付已被并发 void/refund 胜者移出 CONFIRMED（带外直改模拟——Task 7 voidPayment
  // 交付前以直建行等价模拟；跨服务竞速用例归 Task 7 测试文件）。
  await prisma.payment.update({ where: { id: registered.id }, data: { status: 'REFUNDED' } });

  await assert.rejects(
    () => service.executeRefundRequest(created.id, {}),
    isPaymentStateInvalid409,
    'the CONFIRMED flip guard catches a payment moved by a concurrent winner',
  );

  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'APPROVED', 'full rollback keeps the request APPROVED');
  assert.equal(stored.version, 2);
  assert.equal(stored.executedBy, null);
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '4000.00', 'rollback performs zero sweep');
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.receivedAmount.toFixed(2), '4000.00');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.executed' } }),
    0,
    'rollback writes zero refund.executed events',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'REFUND_REQUEST', action: 'REFUND_EXECUTE' } }),
    0,
    'rollback writes zero REFUND_EXECUTE audits',
  );
});

test('concurrent executeRefundRequest and confirmPayment serialize on the contract lock with a consistent outcome', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '10000.00',
  });
  const receivable = receivableServiceFor(userId, actor);
  const paymentA = await receivable.createPayment({ contractId: contract.id, amount: '6000.00' });
  await receivable.confirmPayment(paymentA.id, {});
  const paymentB = await receivable.createPayment({ contractId: contract.id, amount: '3000.00' });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: paymentA.id,
    amount: '6000.00', reason: '竞速退款',
  });
  await service.approveRefundRequest(created.id, {});

  // 确定性竞速（FOR UPDATE 行锁钉法）：第三方事务持合同行锁 1s，execute 与 confirm 双双
  // 阻塞在首把锁；锁释放后按串行顺序提交——不论谁先胜，终态一致：contract/plan 恰被
  // +3000（B 确认）与 −6000（A 退款回补）各作用一次，receivedAmount 归 3000 PARTIAL。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 100));

  const results = await Promise.allSettled([
    service.executeRefundRequest(created.id, {}),
    receivable.confirmPayment(paymentB.id, {}),
  ]);
  await lockHolder;

  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 0, `both calls must succeed, got ${String(rejected[0]?.reason)}`);

  const storedPaymentA = await prisma.payment.findUniqueOrThrow({ where: { id: paymentA.id } });
  assert.equal(storedPaymentA.status, 'REFUNDED');
  const storedPaymentB = await prisma.payment.findUniqueOrThrow({ where: { id: paymentB.id } });
  assert.equal(storedPaymentB.status, 'CONFIRMED');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '3000.00', '6000 + 3000 - 6000 regardless of order');
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.receivedAmount.toFixed(2), '3000.00');
  assert.equal(storedPlan.status, 'PARTIAL');
  const storedRefund = await prisma.refundRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(storedRefund.status, 'EXECUTED');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.executed' } }),
    1,
    'exactly one refund.executed event',
  );
  assert.equal(
    await prisma.eventLog.count({
      where: { objectType: 'PAYMENT', objectId: paymentB.id, eventType: 'payment.confirmed' },
    }),
    1,
    'exactly one payment.confirmed event for payment B',
  );
});

test('executeRefundRequest waives a PARTIAL plan down to its receivedAmount and flips it to RECEIVED', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
    receivedAmount: '3000.00',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01',
    amount: '5000.00', receivedAmount: '3000.00', status: 'PARTIAL',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'WAIVER', contractId: contract.id, planId: plan.id, amount: '2000.00', reason: '减免至已收',
  });
  await service.approveRefundRequest(created.id, {});

  const view = await service.executeRefundRequest(created.id, {});

  assert.equal(view.status, 'EXECUTED');
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.amount.toFixed(2), '3000.00', 'plan amount reduced by the waiver');
  assert.equal(storedPlan.receivedAmount.toFixed(2), '3000.00');
  assert.equal(storedPlan.status, 'RECEIVED', 'receivedAmount reaches the new amount');
  assert.equal(storedPlan.version, 2);
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '3000.00', 'waiver never moves the contract total');
  assert.equal(storedContract.version, 1, 'waiver never writes the contract row');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'REFUND_REQUEST', objectId: created.id, eventType: 'refund.executed' },
  });
  assert.deepEqual(event.payload, {
    refundRequestId: created.id,
    contractId: contract.id,
    paymentId: null,
    planId: plan.id,
    status: 'EXECUTED',
  }, 'refund.executed carries exactly five keys (WAIVER anchors planId, paymentId null)');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'REFUND_REQUEST', targetId: created.id, action: 'REFUND_EXECUTE' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: created.requestNo,
    type: 'WAIVER',
    contractId: contract.id,
    planId: plan.id,
    fromStatus: 'APPROVED',
    toStatus: 'EXECUTED',
    hasReason: true,
  });
});

test('executeRefundRequest re-derives PENDING-plan statuses: full waiver to zero-amount RECEIVED, partial stays PENDING', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
  });
  const fullPlan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '2000.00',
  });
  const partialPlan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '5000.00',
  });
  const service = refundServiceFor(userId, actor);

  // 全额豁免 PENDING 计划：amount 归零，receivedAmount(0) ≥ 新 amount(0) → 零元 RECEIVED。
  const fullWaiver = await service.createRefundRequest({
    type: 'WAIVER', contractId: contract.id, planId: fullPlan.id, amount: '2000.00', reason: '全额豁免',
  });
  await service.approveRefundRequest(fullWaiver.id, {});
  await service.executeRefundRequest(fullWaiver.id, {});
  const afterFull = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: fullPlan.id } });
  assert.equal(afterFull.amount.toFixed(2), '0.00');
  assert.equal(afterFull.receivedAmount.toFixed(2), '0.00');
  assert.equal(afterFull.status, 'RECEIVED', 'a fully waived PENDING plan becomes a zero-amount RECEIVED plan');

  // 部分豁免 PENDING 计划：receivedAmount(0) < 新 amount → 保持 PENDING。
  const partialWaiver = await service.createRefundRequest({
    type: 'WAIVER', contractId: contract.id, planId: partialPlan.id, amount: '2000.00', reason: '部分豁免',
  });
  await service.approveRefundRequest(partialWaiver.id, {});
  await service.executeRefundRequest(partialWaiver.id, {});
  const afterPartial = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: partialPlan.id } });
  assert.equal(afterPartial.amount.toFixed(2), '3000.00');
  assert.equal(afterPartial.receivedAmount.toFixed(2), '0.00');
  assert.equal(afterPartial.status, 'PENDING');
});

test('executeRefundRequest re-verifies the waiver remainder and rolls back with WAIVER_AMOUNT_EXCEEDED 409', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, amount: '10000.00', status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'WAIVER', contractId: contract.id, planId: plan.id, amount: '3000.00', reason: '减免重验测试',
  });
  await service.approveRefundRequest(created.id, {});
  // 审批间隙第三方先 confirm 推高 receivedAmount（0→3000）：余额 5000−3000=2000 < 3000。
  const receivable = receivableServiceFor(userId, actor);
  const registered = await receivable.createPayment({ contractId: contract.id, amount: '3000.00' });
  await receivable.confirmPayment(registered.id, {});

  await assert.rejects(
    () => service.executeRefundRequest(created.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.WAIVER_AMOUNT_EXCEEDED, 409),
    'execution-time re-verification fails with 409 (creation-time default 400 overridden)',
  );

  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'APPROVED', 'full rollback keeps the request APPROVED');
  assert.equal(stored.version, 2);
  assert.equal(stored.executedBy, null);
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.amount.toFixed(2), '5000.00', 'rollback leaves the plan amount untouched');
  assert.equal(storedPlan.receivedAmount.toFixed(2), '3000.00');
  assert.equal(storedPlan.status, 'PARTIAL');
  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(storedPayment.status, 'CONFIRMED', 'the third-party confirm is unaffected');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'REFUND_REQUEST', eventType: 'refund.executed' } }),
    0,
    'rollback writes zero refund.executed events',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'REFUND_REQUEST', action: 'REFUND_EXECUTE' } }),
    0,
    'rollback writes zero REFUND_EXECUTE audits',
  );
});

test('executeRefundRequest returns REFUND_NOT_FOUND 404 for an invisible or missing request', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const refund = await createRefundRow({
    contractId: foreign.id, customerId: customer.id, createdBy: 'someone-else', status: 'APPROVED',
  });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = refundServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });

  await assert.rejects(
    () => scoped.executeRefundRequest(refund.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, 404),
    'out-of-scope refund request is indistinguishable from missing',
  );
  await assert.rejects(
    () => scoped.executeRefundRequest(randomUUID(), {}),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, 404),
  );
  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(stored.status, 'APPROVED', 'out-of-scope execute never mutates the request');
});

test('executeRefundRequest requires the refund.execute action permission', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const refund = await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: payment.id, amount: '1000.00', status: 'APPROVED',
  });
  const denied = refundServiceFor(userId, actor, {
    permissionCodes: ['refund.read', 'refund.create', 'refund.approve'],
  });

  await assert.rejects(() => denied.executeRefundRequest(refund.id, {}), hasCode('PERMISSION_DENIED'));
  const stored = await prisma.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(stored.status, 'APPROVED');
});

// ---------- 列表/详情 listRefundRequests / getRefundRequest ----------

test('listRefundRequests filters by status, type, contractId and customerId with pagination', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const otherCustomer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const otherContract = await createContractRow({ customerId: otherCustomer.id, createdBy: userId });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '1000.00', status: 'CONFIRMED',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '2000.00',
  });
  await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    paymentId: payment.id, amount: '1000.00',
  });
  await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    type: 'WAIVER', planId: plan.id, amount: '200.00',
  });
  await createRefundRow({
    contractId: otherContract.id, customerId: otherCustomer.id, createdBy: userId,
    amount: '300.00', status: 'APPROVED',
  });
  const service = refundServiceFor(userId, actor);

  const all = await service.listRefundRequests({});
  assert.equal(all.page, 1);
  assert.equal(all.pageSize, 20);
  assert.equal(all.total, 3);
  assert.equal(all.list.length, 3);

  const byStatus = await service.listRefundRequests({ status: 'APPROVED' });
  assert.equal(byStatus.total, 1);
  assert.equal(byStatus.list[0].contractId, otherContract.id);

  const byType = await service.listRefundRequests({ type: 'WAIVER' });
  assert.equal(byType.total, 1);
  assert.equal(byType.list[0].planId, plan.id);

  const byContract = await service.listRefundRequests({ contractId: contract.id });
  assert.equal(byContract.total, 2);
  assert.ok(byContract.list.every(item => item.contractId === contract.id));

  const byCustomer = await service.listRefundRequests({ customerId: otherCustomer.id });
  assert.equal(byCustomer.total, 1);
  assert.equal(byCustomer.list[0].customerId, otherCustomer.id);

  const paged = await service.listRefundRequests({ page: 2, pageSize: 2 });
  assert.equal(paged.page, 2);
  assert.equal(paged.pageSize, 2);
  assert.equal(paged.total, 3);
  assert.equal(paged.list.length, 1);
});

test('getRefundRequest returns the view and 404s for a missing or invisible request', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id, createdBy: userId, status: 'EFFECTIVE',
  });
  const payment = await createPaymentRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
    amount: '4000.00', status: 'CONFIRMED',
  });
  const service = refundServiceFor(userId, actor);
  const created = await service.createRefundRequest({
    type: 'REFUND', contractId: contract.id, paymentId: payment.id,
    amount: '4000.00', reason: '详情查询',
  });

  const view = await service.getRefundRequest(created.id);
  assert.equal(view.id, created.id);
  assert.equal(view.requestNo, created.requestNo);
  assert.equal(view.type, 'REFUND');
  assert.equal(view.amount, '4000.00');
  assert.equal(view.reason, '详情查询');
  assert.equal(view.status, 'PENDING');

  await assert.rejects(
    () => service.getRefundRequest(randomUUID()),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, 404),
  );
});

test('refund.read with no scope targets fails closed (list empty, get 404)', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const created = await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
  });
  // 仅 refund.read 动作、零范围目标（scopeIds 空集 → 解析零谓词 → fail-closed）。
  const closed = refundServiceFor(userId, actor, {
    permissionCodes: ['refund.read'],
    scopeIds: [],
  });

  const page = await closed.listRefundRequests({});
  assert.equal(page.total, 0, 'zero scope targets yields an empty list, never the full table');
  assert.equal(page.list.length, 0);
  await assert.rejects(
    () => closed.getRefundRequest(created.id),
    isFinanceError(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, 404),
    'zero scope targets yields 404, never leaks existence',
  );
});

test('SELF scope anchors RefundRequest via contract.createdBy', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const own = await createContractRow({ customerId: customer.id, createdBy: userId });
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  await createRefundRow({ contractId: own.id, customerId: customer.id, createdBy: userId });
  await createRefundRow({ contractId: foreign.id, customerId: customer.id, createdBy: 'someone-else' });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = refundServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });

  const page = await scoped.listRefundRequests({});
  assert.equal(page.total, 1);
  assert.equal(page.list[0].contractId, own.id);
});

test('TEAM scope anchors RefundRequest via contract.professionalTeamId', async () => {
  const { userId, actor } = await createRefundActor();
  const branch = await createOrganizationFixture('BRANCH_TEAM_RF');
  const team = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const otherTeam = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const customer = await createCustomerFixture(userId);
  const inTeam = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', professionalTeamId: team.id,
  });
  const inOtherTeam = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', professionalTeamId: otherTeam.id,
  });
  await createRefundRow({ contractId: inTeam.id, customerId: customer.id, createdBy: 'someone-else' });
  await createRefundRow({ contractId: inOtherTeam.id, customerId: customer.id, createdBy: 'someone-else' });
  const teamScope = await prisma.dataScope.create({
    data: { name: `team-${randomUUID()}`, scopeType: 'TEAM', professionalTeamId: team.id },
  });
  const scoped = refundServiceFor(userId, actor, { scopeIds: [teamScope.id] });

  const page = await scoped.listRefundRequests({});
  assert.equal(page.total, 1);
  assert.equal(page.list[0].contractId, inTeam.id);
});

test('BRANCH scope anchors RefundRequest via contract.branchId including the organization subtree', async () => {
  const { userId, actor } = await createRefundActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN_RF');
  const branchChild = await createOrganizationFixture('BRANCH_CHILD_RF', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER_RF');
  const customer = await createCustomerFixture(userId);
  const inBranch = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', branchId: branch.id,
  });
  const inChild = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', branchId: branchChild.id,
  });
  const outOfBranch = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', branchId: other.id,
  });
  await createRefundRow({ contractId: inBranch.id, customerId: customer.id, createdBy: 'someone-else' });
  await createRefundRow({ contractId: inChild.id, customerId: customer.id, createdBy: 'someone-else' });
  await createRefundRow({ contractId: outOfBranch.id, customerId: customer.id, createdBy: 'someone-else' });
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const scoped = refundServiceFor(userId, actor, { scopeIds: [branchScope.id] });

  const page = await scoped.listRefundRequests({});
  assert.equal(page.total, 2);
  assert.deepEqual(
    page.list.map(item => item.contractId).sort(),
    [inBranch.id, inChild.id].sort(),
  );
});

test('listRefundRequests and getRefundRequest require the refund.read action permission', async () => {
  const { userId, actor } = await createRefundActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const created = await createRefundRow({
    contractId: contract.id, customerId: customer.id, createdBy: userId,
  });
  const denied = refundServiceFor(userId, actor, {
    permissionCodes: ['refund.create', 'refund.approve', 'refund.execute'],
  });

  await assert.rejects(() => denied.listRefundRequests({}), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.getRefundRequest(created.id), hasCode('PERMISSION_DENIED'));
});
