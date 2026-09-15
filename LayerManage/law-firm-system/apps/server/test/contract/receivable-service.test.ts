import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Contract, Payment, PaymentPlan, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import {
  assertPaymentTermsStructurallyValid,
  generatePlansForEffect,
  ReceivableService,
} from '../../app/application/contract/receivable-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import {
  CONTRACT_ERROR_CODES,
  ContractError,
} from '../../app/domain/contract/contract-errors';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-010 Task 8: receivable-service 计划生成段契约测试（CON-07）。
// generatePlansForEffect 为 module function（tx 由调用方事务传入）：默认一期/多期解析/
// 校验失败 RECEIVABLE_PLAN_MISMATCH 400 整事务回滚零残留。收款段归 Task 9。
// Task 9 追加：ReceivableService 收款段（FIN-01）——登记（payment.create，合同状态门禁
// SIGNED/EFFECTIVE+伪造 planId 400+金额>0 scale≤2）/确认（payment.confirm，FOR UPDATE
// 合同行互斥+幂等翻转+冲抵三方联动+超额 409 回滚零残留+重放零重冲）/列表与计划查询
// （payment.read，范围经 contract 包裹）/无业务删除方法（FTN-001 §3.6）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/contract/receivable-service.test.ts

let prisma: PrismaClient;

const PLAN_NO_PATTERN = /^PP\d{6}-[A-Z0-9]{6}$/;
const EFFECTIVE_DATE = new Date('2026-08-01T00:00:00.000Z');

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

function isPlanMismatch400(error: unknown): boolean {
  return error instanceof ContractError
    && error.code === CONTRACT_ERROR_CODES.RECEIVABLE_PLAN_MISMATCH
    && error.httpStatus === 400;
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '应收客户',
      phone: '13900003333',
      phoneHash: hashPhone('13900003333'),
      status: 'SIGNED',
      createdBy,
    },
  });
}

async function createContractRow(overrides: {
  customerId: string;
  createdBy: string;
  amount?: string;
  paymentTerms?: string | null;
  status?: string;
  branchId?: string | null;
  professionalTeamId?: string | null;
}): Promise<Contract> {
  return prisma.contract.create({
    data: {
      contractNo: `XX-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractType: 'FIRST_SIGN',
      title: '应收计划夹具合同',
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      status: overrides.status ?? 'SIGNED',
      amount: overrides.amount ?? '12000.00',
      paymentTerms: overrides.paymentTerms ?? null,
      branchId: overrides.branchId ?? null,
      professionalTeamId: overrides.professionalTeamId ?? null,
    },
  });
}

test('generatePlansForEffect creates the default single-period plan when paymentTerms is null', async () => {
  const user = await prisma.user.create({ data: { username: `plan.actor.${randomUUID()}`, password: 'x' } });
  const customer = await createCustomerFixture(user.id);
  const contract = await createContractRow({ customerId: customer.id, createdBy: user.id });

  const plans = await prisma.$transaction(tx =>
    generatePlansForEffect(tx, contract, EFFECTIVE_DATE, user.id));

  assert.equal(plans.length, 1);
  const [plan] = plans;
  assert.match(plan.planNo, PLAN_NO_PATTERN);
  assert.equal(plan.contractId, contract.id);
  assert.equal(plan.period, 1);
  assert.deepEqual(plan.dueDate, new Date('2026-08-31T00:00:00.000Z'), 'default dueDate = effectiveDate + 30 days');
  assert.equal(plan.amount.toFixed(2), '12000.00');
  assert.equal(plan.receivedAmount.toFixed(2), '0.00');
  assert.equal(plan.status, 'PENDING');
  assert.equal(plan.createdBy, user.id, 'plan createdBy = effect operator (coordinator ruling)');
  assert.equal(plan.version, 1);

  const stored = await prisma.paymentPlan.findMany({ where: { contractId: contract.id } });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, plan.id);
});

test('generatePlansForEffect treats an empty paymentTerms string as the default single period', async () => {
  const user = await prisma.user.create({ data: { username: `plan.actor.${randomUUID()}`, password: 'x' } });
  const customer = await createCustomerFixture(user.id);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: user.id,
    amount: '500.00',
    paymentTerms: '   ',
  });

  const plans = await prisma.$transaction(tx =>
    generatePlansForEffect(tx, contract, EFFECTIVE_DATE, user.id));

  assert.equal(plans.length, 1);
  assert.equal(plans[0].period, 1);
  assert.equal(plans[0].amount.toFixed(2), '500.00');
  assert.deepEqual(plans[0].dueDate, new Date('2026-08-31T00:00:00.000Z'));
});

test('generatePlansForEffect parses multi-period paymentTerms and creates all periods in order', async () => {
  const user = await prisma.user.create({ data: { username: `plan.actor.${randomUUID()}`, password: 'x' } });
  const customer = await createCustomerFixture(user.id);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: user.id,
    paymentTerms: JSON.stringify({
      plans: [
        { period: 1, dueDate: '2026-09-01', amount: '4000.00' },
        { period: 2, dueDate: '2026-10-01', amount: '4000.00' },
        { period: 3, dueDate: '2026-11-01', amount: '4000.00' },
      ],
    }),
  });

  const plans = await prisma.$transaction(tx =>
    generatePlansForEffect(tx, contract, EFFECTIVE_DATE, user.id));

  assert.equal(plans.length, 3);
  assert.deepEqual(plans.map(plan => plan.period), [1, 2, 3]);
  assert.deepEqual(
    plans.map(plan => plan.dueDate),
    [
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-11-01T00:00:00.000Z'),
    ],
  );
  for (const plan of plans) {
    assert.equal(plan.amount.toFixed(2), '4000.00');
    assert.equal(plan.status, 'PENDING');
    assert.equal(plan.receivedAmount.toFixed(2), '0.00');
    assert.match(plan.planNo, PLAN_NO_PATTERN);
    assert.equal(plan.createdBy, user.id);
  }
  assert.equal(new Set(plans.map(plan => plan.planNo)).size, 3, 'planNo values are distinct');

  const stored = await prisma.paymentPlan.findMany({
    where: { contractId: contract.id },
    orderBy: { period: 'asc' },
  });
  assert.deepEqual(stored.map(plan => plan.id), plans.map(plan => plan.id));
});

test('generatePlansForEffect rejects malformed JSON with RECEIVABLE_PLAN_MISMATCH 400 and rolls back', async () => {
  const user = await prisma.user.create({ data: { username: `plan.actor.${randomUUID()}`, password: 'x' } });
  const customer = await createCustomerFixture(user.id);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: user.id,
    paymentTerms: '{not-json',
  });

  await assert.rejects(
    () => prisma.$transaction(tx => generatePlansForEffect(tx, contract, EFFECTIVE_DATE, user.id)),
    isPlanMismatch400,
  );
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: contract.id } }), 0, 'rollback leaves zero plans');
});

test('generatePlansForEffect rejects a non-conforming structure', async () => {
  const user = await prisma.user.create({ data: { username: `plan.actor.${randomUUID()}`, password: 'x' } });
  const customer = await createCustomerFixture(user.id);

  for (const paymentTerms of ['{"items":[]}', '[]', '{"plans":{}}', '{"plans":[]}']) {
    const contract = await createContractRow({
      customerId: customer.id,
      createdBy: user.id,
      paymentTerms,
    });
    await assert.rejects(
      () => prisma.$transaction(tx => generatePlansForEffect(tx, contract, EFFECTIVE_DATE, user.id)),
      isPlanMismatch400,
      `paymentTerms ${paymentTerms} must be rejected`,
    );
    assert.equal(await prisma.paymentPlan.count({ where: { contractId: contract.id } }), 0);
  }
});

test('generatePlansForEffect rejects non-consecutive or misordered periods', async () => {
  const user = await prisma.user.create({ data: { username: `plan.actor.${randomUUID()}`, password: 'x' } });
  const customer = await createCustomerFixture(user.id);

  const cases = [
    // 跳期 1→3。
    [
      { period: 1, dueDate: '2026-09-01', amount: '6000.00' },
      { period: 3, dueDate: '2026-10-01', amount: '6000.00' },
    ],
    // 乱序 2→1。
    [
      { period: 2, dueDate: '2026-09-01', amount: '6000.00' },
      { period: 1, dueDate: '2026-10-01', amount: '6000.00' },
    ],
    // 非整数期次。
    [
      { period: 1, dueDate: '2026-09-01', amount: '6000.00' },
      { period: '2', dueDate: '2026-10-01', amount: '6000.00' },
    ],
  ];
  for (const plans of cases) {
    const contract = await createContractRow({
      customerId: customer.id,
      createdBy: user.id,
      paymentTerms: JSON.stringify({ plans }),
    });
    await assert.rejects(
      () => prisma.$transaction(tx => generatePlansForEffect(tx, contract, EFFECTIVE_DATE, user.id)),
      isPlanMismatch400,
    );
    assert.equal(await prisma.paymentPlan.count({ where: { contractId: contract.id } }), 0);
  }
});

test('generatePlansForEffect rejects when the plan sum differs from the contract amount', async () => {
  const user = await prisma.user.create({ data: { username: `plan.actor.${randomUUID()}`, password: 'x' } });
  const customer = await createCustomerFixture(user.id);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: user.id,
    paymentTerms: JSON.stringify({
      plans: [
        { period: 1, dueDate: '2026-09-01', amount: '5000.00' },
        { period: 2, dueDate: '2026-10-01', amount: '6000.00' },
      ],
    }),
  });

  await assert.rejects(
    () => prisma.$transaction(tx => generatePlansForEffect(tx, contract, EFFECTIVE_DATE, user.id)),
    (error: unknown) => isPlanMismatch400(error)
      && /11000\.00/.test((error as Error).message)
      && /12000\.00/.test((error as Error).message),
    'message carries both the plan sum and the contract amount',
  );
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: contract.id } }), 0, 'rollback leaves zero plans');
});

test('generatePlansForEffect rejects invalid amounts and due dates', async () => {
  const user = await prisma.user.create({ data: { username: `plan.actor.${randomUUID()}`, password: 'x' } });
  const customer = await createCustomerFixture(user.id);

  const cases = [
    [{ period: 1, dueDate: '2026-09-01', amount: 'not-a-number' }],
    [{ period: 1, dueDate: '2026-09-01', amount: '-1.00' }],
    [{ period: 1, dueDate: '2026-09-01', amount: '12000.005' }],
    [{ period: 1, dueDate: 'not-a-date', amount: '12000.00' }],
    [{ period: 1, amount: '12000.00' }],
  ];
  for (const plans of cases) {
    const contract = await createContractRow({
      customerId: customer.id,
      createdBy: user.id,
      paymentTerms: JSON.stringify({ plans }),
    });
    await assert.rejects(
      () => prisma.$transaction(tx => generatePlansForEffect(tx, contract, EFFECTIVE_DATE, user.id)),
      isPlanMismatch400,
      `plans ${JSON.stringify(plans)} must be rejected`,
    );
    assert.equal(await prisma.paymentPlan.count({ where: { contractId: contract.id } }), 0);
  }
});

// ============ 终审修复轮 F-1/F-2：create 侧结构预校验 + dueDate ISO 形态 ============

test('generatePlansForEffect rejects non-ISO dueDate forms with MISMATCH 400 and rolls back', async () => {
  const user = await prisma.user.create({ data: { username: `plan.actor.${randomUUID()}`, password: 'x' } });
  const customer = await createCustomerFixture(user.id);

  // 裸 new Date() 可解析的非 ISO 形态（F-2 前被静默接受，时区漂移源）。
  const cases = [
    [{ period: 1, dueDate: '09/01/2026', amount: '12000.00' }],
    [{ period: 1, dueDate: '2026-09-01 10:00', amount: '12000.00' }],
    [{ period: 1, dueDate: '2026-9-1', amount: '12000.00' }],
  ];
  for (const plans of cases) {
    const contract = await createContractRow({
      customerId: customer.id,
      createdBy: user.id,
      paymentTerms: JSON.stringify({ plans }),
    });
    await assert.rejects(
      () => prisma.$transaction(tx => generatePlansForEffect(tx, contract, EFFECTIVE_DATE, user.id)),
      isPlanMismatch400,
      `dueDate ${plans[0].dueDate} must be rejected as non-ISO`,
    );
    assert.equal(await prisma.paymentPlan.count({ where: { contractId: contract.id } }), 0);
  }
});

test('assertPaymentTermsStructurallyValid passes null, blank and well-formed terms without touching the database', async () => {
  // null/空白 → 默认一期恒良构，预验 vacuous 通过。
  assert.doesNotThrow(() => assertPaymentTermsStructurallyValid(null, new Prisma.Decimal('12000.00')));
  assert.doesNotThrow(() => assertPaymentTermsStructurallyValid('   ', new Prisma.Decimal('12000.00')));

  // 多期良构（ISO date 与 ISO datetime 两种 dueDate 形态均合法）。
  assert.doesNotThrow(() => assertPaymentTermsStructurallyValid(
    JSON.stringify({
      plans: [
        { period: 1, dueDate: '2026-09-01', amount: '4000.00' },
        { period: 2, dueDate: '2026-10-01T10:30:00Z', amount: '8000.00' },
      ],
    }),
    new Prisma.Decimal('12000.00'),
  ));

  // 零额合同的零额单期（create 缺省 amount 视 Decimal(0) 的合法场景）。
  assert.doesNotThrow(() => assertPaymentTermsStructurallyValid(
    JSON.stringify({ plans: [{ period: 1, dueDate: '2026-09-01', amount: '0.00' }] }),
    new Prisma.Decimal(0),
  ));

  // 纯函数只验不建：不触碰数据库（本用例零夹具即证据）。
  assert.equal(await prisma.paymentPlan.count(), 0);
  assert.equal(await prisma.contract.count(), 0);
});

test('assertPaymentTermsStructurallyValid rejects the full malformed family with MISMATCH 400', () => {
  const amount = new Prisma.Decimal('12000.00');
  const cases: Array<{ label: string; paymentTerms: string }> = [
    { label: 'malformed JSON', paymentTerms: '{not-json' },
    { label: 'unknown top-level key', paymentTerms: '{"items":[]}' },
    { label: 'empty plans array', paymentTerms: '{"plans":[]}' },
    {
      label: 'non-consecutive periods',
      paymentTerms: JSON.stringify({
        plans: [
          { period: 1, dueDate: '2026-09-01', amount: '6000.00' },
          { period: 3, dueDate: '2026-10-01', amount: '6000.00' },
        ],
      }),
    },
    {
      label: 'sum differs from the contract amount',
      paymentTerms: JSON.stringify({
        plans: [
          { period: 1, dueDate: '2026-09-01', amount: '5000.00' },
          { period: 2, dueDate: '2026-10-01', amount: '6000.00' },
        ],
      }),
    },
    {
      label: 'unknown entry key',
      paymentTerms: JSON.stringify({
        plans: [{ period: 1, dueDate: '2026-09-01', amount: '12000.00', extra: 1 }],
      }),
    },
    {
      label: 'negative amount',
      paymentTerms: JSON.stringify({
        plans: [{ period: 1, dueDate: '2026-09-01', amount: '-1.00' }],
      }),
    },
    {
      label: 'non-ISO dueDate (US form)',
      paymentTerms: JSON.stringify({
        plans: [{ period: 1, dueDate: '09/01/2026', amount: '12000.00' }],
      }),
    },
    {
      label: 'non-ISO dueDate (space datetime)',
      paymentTerms: JSON.stringify({
        plans: [{ period: 1, dueDate: '2026-09-01 10:00', amount: '12000.00' }],
      }),
    },
  ];
  for (const { label, paymentTerms } of cases) {
    assert.throws(
      () => assertPaymentTermsStructurallyValid(paymentTerms, amount),
      isPlanMismatch400,
      `${label} must be rejected`,
    );
  }
});

// ==================== Task 9: 收款段（登记/确认三方联动，FIN-01） ====================

const PAYMENT_PERMISSIONS: PermissionCode[] = ['payment.read', 'payment.create', 'payment.confirm'];
const PAYMENT_NO_PATTERN = /^PY\d{6}-[A-Z0-9]{6}$/;

interface PaymentContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

/** 收款授权上下文：grants 的 resource 取 permissionCode 前缀（=catalog.resource，与生产 loader 一致）。 */
function paymentContext(userId: string, overrides: PaymentContextOverrides = {}): AuthorizationContext {
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

async function createPaymentActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `payment.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function receivableServiceFor(
  userId: string,
  actor: AuditActor,
  overrides: PaymentContextOverrides = {},
): ReceivableService {
  return new ReceivableService(prisma, actor, paymentContext(userId, overrides));
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

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function isValidationFailed400(error: unknown): boolean {
  return error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400;
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

// ---------- 登记 createPayment ----------

test('createPayment registers a PENDING payment with payment.created and audit in one transaction', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = receivableServiceFor(userId, actor);

  const view = await service.createPayment({ contractId: contract.id, amount: '4000.00' });

  assert.ok(view.id);
  assert.match(view.paymentNo, PAYMENT_NO_PATTERN);
  assert.equal(view.contractId, contract.id);
  assert.equal(view.paymentPlanId, null);
  assert.equal(view.customerId, customer.id, 'customerId copied from the contract (redundant anchor)');
  assert.equal(view.amount, '4000.00');
  assert.equal(view.status, 'PENDING');
  assert.equal(view.method, null);
  assert.equal(view.account, null);
  assert.equal(view.paidAt, null);
  assert.equal(view.remark, null);
  assert.equal(view.confirmedBy, null);
  assert.equal(view.confirmedAt, null);
  assert.equal(view.createdBy, userId);
  assert.equal(view.version, 1);

  const stored = await prisma.payment.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.customerId, customer.id);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'PAYMENT', objectId: view.id, eventType: 'payment.created' },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'CONTRACT');
  assert.equal(event.operatorUserId, userId);
  assert.equal(event.organizationId, null);
  assert.equal(event.branchId, null, 'organizationId/branchId/teamId anchor the contract columns (none set)');
  assert.equal(event.teamId, null);
  assert.deepEqual(event.payload, {
    paymentId: view.id,
    paymentNo: view.paymentNo,
    contractId: contract.id,
    customerId: customer.id,
    status: 'PENDING',
  }, 'payment.created carries exactly five keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'PAYMENT', targetId: view.id, action: 'PAYMENT_CREATE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    paymentNo: view.paymentNo,
    contractId: contract.id,
    amount: '4000.00',
  }, 'audit holds identifiers + amount only');
});

test('createPayment persists method/account/paidAt/remark on the row but keeps them out of audit values', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const branch = await createOrganizationFixture('BRANCH_PAY');
  const team = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    branchId: branch.id,
    professionalTeamId: team.id,
  });
  const service = receivableServiceFor(userId, actor);

  const view = await service.createPayment({
    contractId: contract.id,
    amount: 2500.5,
    method: '银行转账',
    account: '招商银行 6225 **** 0001',
    paidAt: '2026-08-15T10:30:00Z',
    remark: '客户首付款线下已到账',
  });

  assert.equal(view.amount, '2500.50');
  assert.equal(view.method, '银行转账');
  assert.equal(view.account, '招商银行 6225 **** 0001');
  assert.deepEqual(view.paidAt, new Date('2026-08-15T10:30:00.000Z'));
  assert.equal(view.remark, '客户首付款线下已到账');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'PAYMENT', objectId: view.id, eventType: 'payment.created' },
  });
  assert.equal(event.branchId, branch.id, 'event branchId anchors the contract branch column');
  assert.equal(event.teamId, team.id, 'event teamId anchors the contract team column');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'PAYMENT', targetId: view.id, action: 'PAYMENT_CREATE' },
  });
  assert.ok(!operationLog.newValues?.includes('银行转账'), 'method free text stays out of audit values');
  assert.ok(!operationLog.newValues?.includes('招商银行'), 'account free text stays out of audit values');
  assert.ok(!operationLog.newValues?.includes('首付款'), 'remark free text stays out of audit values');
});

test('createPayment rejects a DRAFT contract with CONTRACT_STATE_TRANSITION_INVALID 409 and writes nothing', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'DRAFT',
  });
  const service = receivableServiceFor(userId, actor);

  await assert.rejects(
    () => service.createPayment({ contractId: contract.id, amount: '1000.00' }),
    isContractStateInvalid409,
  );
  assert.equal(await prisma.payment.count({ where: { contractId: contract.id } }), 0);
  assert.equal(await prisma.eventLog.count({ where: { objectType: 'PAYMENT' } }), 0);
});

test('createPayment rejects a forged paymentPlanId with VALIDATION_FAILED 400', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const otherContract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const foreignPlan = await createPlanRow({
    contractId: otherContract.id,
    createdBy: userId,
    period: 1,
    dueDate: '2026-09-01',
    amount: '12000.00',
  });
  const service = receivableServiceFor(userId, actor);

  await assert.rejects(
    () => service.createPayment({
      contractId: contract.id,
      paymentPlanId: foreignPlan.id,
      amount: '1000.00',
    }),
    isValidationFailed400,
    'a plan owned by another contract must be rejected',
  );
  await assert.rejects(
    () => service.createPayment({
      contractId: contract.id,
      paymentPlanId: randomUUID(),
      amount: '1000.00',
    }),
    isValidationFailed400,
    'a nonexistent plan must be rejected',
  );
  assert.equal(await prisma.payment.count({ where: { contractId: contract.id } }), 0);
});

test('createPayment rejects non-positive, over-scale and malformed amounts with 400', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = receivableServiceFor(userId, actor);

  const badAmounts: Array<string | number | undefined> = ['0', 0, '-1.00', '10.005', 'not-a-number', undefined];
  for (const amount of badAmounts) {
    await assert.rejects(
      () => service.createPayment({ contractId: contract.id, amount: amount as string }),
      isValidationFailed400,
      `amount ${String(amount)} must be rejected`,
    );
  }
  assert.equal(await prisma.payment.count({ where: { contractId: contract.id } }), 0);
});

test('createPayment accepts an EFFECTIVE contract and a paymentPlanId owned by the contract', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id,
    createdBy: userId,
    period: 1,
    dueDate: '2026-09-01',
    amount: '12000.00',
  });
  const service = receivableServiceFor(userId, actor);

  const view = await service.createPayment({
    contractId: contract.id,
    paymentPlanId: plan.id,
    amount: '4000.00',
  });
  assert.equal(view.status, 'PENDING');
  assert.equal(view.paymentPlanId, plan.id);
});

test('createPayment returns CONTRACT_NOT_FOUND 404 for an invisible or missing contract', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  // SELF 范围解析以 context.employeeId 填 employeeIds（不读 employee 行，合成 id 即可）。
  const scoped = receivableServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });

  await assert.rejects(
    () => scoped.createPayment({ contractId: foreign.id, amount: '1000.00' }),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
    'out-of-scope contract is indistinguishable from missing',
  );
  await assert.rejects(
    () => scoped.createPayment({ contractId: randomUUID(), amount: '1000.00' }),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );
  assert.equal(await prisma.payment.count({ where: { contractId: foreign.id } }), 0);
});

test('createPayment requires the payment.create action permission', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const denied = receivableServiceFor(userId, actor, {
    permissionCodes: ['payment.read', 'payment.confirm'],
  });

  await assert.rejects(
    () => denied.createPayment({ contractId: contract.id, amount: '1000.00' }),
    hasCode('PERMISSION_DENIED'),
  );
  assert.equal(await prisma.payment.count({ where: { contractId: contract.id } }), 0);
});

// ---------- 确认 confirmPayment ----------

test('confirmPayment applies a designated plan exactly to RECEIVED and accumulates the contract', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
  });
  const planOne = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '4000.00',
  });
  const planTwo = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '8000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({
    contractId: contract.id,
    paymentPlanId: planOne.id,
    amount: '4000.00',
  });

  const view = await service.confirmPayment(registered.id, {});

  assert.equal(view.status, 'CONFIRMED');
  assert.equal(view.confirmedBy, userId);
  assert.ok(view.confirmedAt instanceof Date);
  assert.equal(view.version, 2, 'confirm bumps the payment version once');

  const storedPlanOne = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planOne.id } });
  assert.equal(storedPlanOne.receivedAmount.toFixed(2), '4000.00');
  assert.equal(storedPlanOne.status, 'RECEIVED', 'PARTIAL→RECEIVED boundary: exactly full flips to RECEIVED');
  const storedPlanTwo = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planTwo.id } });
  assert.equal(storedPlanTwo.receivedAmount.toFixed(2), '0.00', 'designated confirm touches only its own plan');
  assert.equal(storedPlanTwo.status, 'PENDING');

  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '4000.00');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'PAYMENT', objectId: registered.id, eventType: 'payment.confirmed' },
  });
  assert.equal(event.sourceModule, 'CONTRACT');
  assert.deepEqual(event.payload, {
    paymentId: registered.id,
    contractId: contract.id,
    status: 'CONFIRMED',
  }, 'payment.confirmed carries exactly three keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'PAYMENT', targetId: registered.id, action: 'PAYMENT_CONFIRM' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? {}) as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    paymentNo: registered.paymentNo,
    contractId: contract.id,
    fromStatus: 'PENDING',
    toStatus: 'CONFIRMED',
  });
});

test('confirmPayment sweeps plans in dueDate order across periods when no plan is designated', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
  });
  const plans = [
    await createPlanRow({ contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '4000.00' }),
    await createPlanRow({ contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '4000.00' }),
    await createPlanRow({ contractId: contract.id, createdBy: userId, period: 3, dueDate: '2026-11-01', amount: '4000.00' }),
  ];
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({ contractId: contract.id, amount: '5000.00' });

  await service.confirmPayment(registered.id, {});

  const stored = await prisma.paymentPlan.findMany({
    where: { contractId: contract.id },
    orderBy: { period: 'asc' },
  });
  assert.deepEqual(
    stored.map(plan => ({ id: plan.id, received: plan.receivedAmount.toFixed(2), status: plan.status })),
    [
      { id: plans[0].id, received: '4000.00', status: 'RECEIVED' },
      { id: plans[1].id, received: '1000.00', status: 'PARTIAL' },
      { id: plans[2].id, received: '0.00', status: 'PENDING' },
    ],
    'greedy sweep fills the earliest due plan first and spills into the next',
  );
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '5000.00');
});

test('confirmPayment walks a plan PENDING to PARTIAL to RECEIVED across sequential confirms', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '4000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const first = await service.createPayment({ contractId: contract.id, amount: '2000.00' });
  const second = await service.createPayment({ contractId: contract.id, amount: '2000.00' });

  await service.confirmPayment(first.id, {});
  let storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.receivedAmount.toFixed(2), '2000.00');
  assert.equal(storedPlan.status, 'PARTIAL');

  await service.confirmPayment(second.id, {});
  storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.receivedAmount.toFixed(2), '4000.00');
  assert.equal(storedPlan.status, 'RECEIVED');

  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '4000.00', 'contract accumulates both confirms');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.confirmed' } }),
    2,
  );
});

test('confirmPayment on a SIGNED contract without plans accumulates only the contract (vacuous sweep)', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '5000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({ contractId: contract.id, amount: '2000.00' });

  const view = await service.confirmPayment(registered.id, {});
  assert.equal(view.status, 'CONFIRMED');

  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '2000.00', 'signed-not-effective confirm bumps the contract only');
  assert.equal(await prisma.paymentPlan.count({ where: { contractId: contract.id } }), 0);
  assert.equal(
    await prisma.eventLog.count({
      where: { objectType: 'PAYMENT', objectId: registered.id, eventType: 'payment.confirmed' },
    }),
    1,
  );
});

test('confirmPayment rejects a payment exceeding the designated plan remainder and rolls back everything', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
    status: 'EFFECTIVE',
  });
  const planOne = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '4000.00',
  });
  const planTwo = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '4000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({
    contractId: contract.id,
    paymentPlanId: planOne.id,
    amount: '5000.00',
  });

  // 合同级约束本可通过（0+5000≤10000）——409 证明单期溢出判定（applied 取 min 后扫完仍有剩余）。
  await assert.rejects(
    () => service.confirmPayment(registered.id, {}),
    isAmountExceeded409,
  );

  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(payment.status, 'PENDING', 'rollback keeps the payment PENDING');
  assert.equal(payment.version, 1);
  assert.equal(payment.confirmedBy, null);
  assert.equal(payment.confirmedAt, null);
  for (const planId of [planOne.id, planTwo.id]) {
    const plan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planId } });
    assert.equal(plan.receivedAmount.toFixed(2), '0.00', 'rollback leaves plan receivedAmount untouched');
    assert.equal(plan.status, 'PENDING');
  }
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.confirmed' } }),
    0,
    'rollback writes zero payment.confirmed events',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', action: 'PAYMENT_CONFIRM' } }),
    0,
    'rollback writes zero PAYMENT_CONFIRM audits',
  );
});

test('confirmPayment rejects a payment exceeding the sweep remainder across plans', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
    status: 'EFFECTIVE',
  });
  await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '4000.00',
  });
  await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '4000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({ contractId: contract.id, amount: '9000.00' });

  // 合同级本可通过（0+9000≤10000）——409 证明扫完仍有剩余的期溢出判定。
  await assert.rejects(() => service.confirmPayment(registered.id, {}), isAmountExceeded409);

  const plans = await prisma.paymentPlan.findMany({ where: { contractId: contract.id } });
  for (const plan of plans) {
    assert.equal(plan.receivedAmount.toFixed(2), '0.00', 'rollback leaves every plan untouched');
    assert.equal(plan.status, 'PENDING');
  }
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(payment.status, 'PENDING');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.confirmed' } }),
    0,
  );
});

test('confirmPayment rejects contract-level overflow on a planless SIGNED contract', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '5000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const first = await service.createPayment({ contractId: contract.id, amount: '3000.00' });
  const second = await service.createPayment({ contractId: contract.id, amount: '3000.00' });

  await service.confirmPayment(first.id, {});
  await assert.rejects(
    () => service.confirmPayment(second.id, {}),
    isAmountExceeded409,
    'receivedAmount 3000 + 3000 exceeds contract amount 5000',
  );

  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: second.id } });
  assert.equal(payment.status, 'PENDING', 'the rejected confirm leaves the payment PENDING');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '3000.00', 'only the first confirm accumulates');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.confirmed' } }),
    1,
  );
});

test('confirmPayment replays an already-confirmed payment without double-applying', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '4000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({ contractId: contract.id, amount: '3000.00' });

  const first = await service.confirmPayment(registered.id, {});
  const replayed = await service.confirmPayment(registered.id, {});

  assert.equal(replayed.status, 'CONFIRMED');
  assert.equal(replayed.version, first.version, 'replay returns the current projection without another flip');
  assert.deepEqual(replayed.confirmedAt, first.confirmedAt);

  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.receivedAmount.toFixed(2), '3000.00', 'replay does not double-apply the plan');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '3000.00', 'replay does not double-apply the contract');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.confirmed' } }),
    1,
    'exactly one payment.confirmed event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', action: 'PAYMENT_CONFIRM' } }),
    1,
    'exactly one PAYMENT_CONFIRM audit',
  );
});

test('concurrent confirmPayment of the same payment succeeds twice with exactly one application', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    status: 'EFFECTIVE',
  });
  const plan = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({ contractId: contract.id, amount: '3000.00' });

  // 确定性竞速（contract-service.test.ts:1406-1455 effect 竞速先例的 FOR UPDATE 行锁钉法）：
  // 第三方事务持合同行锁 1s，两个确认事务的 findFirst 均先读到 PENDING v1，随后双双阻塞
  // 在 FOR UPDATE；锁释放后胜者翻转+冲抵+事件+审计一并提交，败者取得锁后 updateMany
  // 重评 where（status 已 CONFIRMED）→ count=0 → 重读走幂等重放路径成功返回——
  // 双调用均成功，三方联动恰应用一次。
  const lockHolder = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }, { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 100));

  const results = await Promise.allSettled([
    service.confirmPayment(registered.id, {}),
    service.confirmPayment(registered.id, {}),
  ]);
  await lockHolder;

  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 2, 'both confirms succeed (loser replays idempotently)');
  assert.equal(rejected.length, 0, `no call may fail, got ${String(rejected[0]?.reason)}`);
  for (const result of fulfilled) {
    assert.equal(result.value.status, 'CONFIRMED');
    assert.equal(result.value.version, 2, 'exactly one flip commits');
  }

  const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(storedPayment.status, 'CONFIRMED');
  assert.equal(storedPayment.version, 2);
  const storedPlan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: plan.id } });
  assert.equal(storedPlan.receivedAmount.toFixed(2), '3000.00', 'plan applied exactly once');
  assert.equal(storedPlan.status, 'PARTIAL');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '3000.00', 'contract accumulated exactly once');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.confirmed' } }),
    1,
    'exactly one payment.confirmed event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'PAYMENT', action: 'PAYMENT_CONFIRM' } }),
    1,
    'exactly one PAYMENT_CONFIRM audit',
  );
});

test('confirmPayment returns PAYMENT_NOT_FOUND 404 for an invisible or missing payment', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const payment = await createPaymentRow({
    contractId: foreign.id,
    customerId: customer.id,
    createdBy: 'someone-else',
  });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = receivableServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });

  await assert.rejects(
    () => scoped.confirmPayment(payment.id, {}),
    hasCode(CONTRACT_ERROR_CODES.PAYMENT_NOT_FOUND),
    'out-of-scope payment is indistinguishable from missing',
  );
  await assert.rejects(
    () => scoped.confirmPayment(randomUUID(), {}),
    hasCode(CONTRACT_ERROR_CODES.PAYMENT_NOT_FOUND),
  );
  const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.equal(stored.status, 'PENDING', 'out-of-scope confirm never mutates the payment');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'PAYMENT', eventType: 'payment.confirmed' } }),
    0,
  );
});

test('confirmPayment requires the payment.confirm action permission', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = receivableServiceFor(userId, actor);
  const registered = await service.createPayment({ contractId: contract.id, amount: '1000.00' });
  const denied = receivableServiceFor(userId, actor, {
    permissionCodes: ['payment.read', 'payment.create'],
  });

  await assert.rejects(() => denied.confirmPayment(registered.id, {}), hasCode('PERMISSION_DENIED'));
  const stored = await prisma.payment.findUniqueOrThrow({ where: { id: registered.id } });
  assert.equal(stored.status, 'PENDING');
  const storedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
  assert.equal(storedContract.receivedAmount.toFixed(2), '0.00');
});

// ---------- 列表 listPayments / listPlans ----------

test('listPayments filters by status, contractId and customerId with pagination', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const otherCustomer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const otherContract = await createContractRow({ customerId: otherCustomer.id, createdBy: userId });
  await createPaymentRow({ contractId: contract.id, customerId: customer.id, createdBy: userId, amount: '100.00' });
  await createPaymentRow({ contractId: contract.id, customerId: customer.id, createdBy: userId, amount: '200.00' });
  await createPaymentRow({
    contractId: otherContract.id,
    customerId: otherCustomer.id,
    createdBy: userId,
    amount: '300.00',
    status: 'CONFIRMED',
  });
  await createPaymentRow({
    contractId: contract.id,
    customerId: customer.id,
    createdBy: userId,
    amount: '400.00',
    deletedAt: new Date(),
  });
  const service = receivableServiceFor(userId, actor);

  const all = await service.listPayments({});
  assert.equal(all.page, 1);
  assert.equal(all.pageSize, 20);
  assert.equal(all.total, 3, 'soft-deleted payments are excluded');
  assert.equal(all.list.length, 3);

  const byStatus = await service.listPayments({ status: 'CONFIRMED' });
  assert.equal(byStatus.total, 1);
  assert.equal(byStatus.list[0].contractId, otherContract.id);

  const byContract = await service.listPayments({ contractId: contract.id });
  assert.equal(byContract.total, 2);
  assert.ok(byContract.list.every(item => item.contractId === contract.id));

  const byCustomer = await service.listPayments({ customerId: otherCustomer.id });
  assert.equal(byCustomer.total, 1);
  assert.equal(byCustomer.list[0].customerId, otherCustomer.id);

  const paged = await service.listPayments({ page: 2, pageSize: 2 });
  assert.equal(paged.page, 2);
  assert.equal(paged.pageSize, 2);
  assert.equal(paged.total, 3);
  assert.equal(paged.list.length, 1);
});

test('SELF scope anchors Payment via actual record.createdBy, independently of contract creator', async () => {
  const { userId, actor } = await createPaymentActor();
  const employee = await prisma.employee.create({ data: { employeeNo: 'EMP-' + randomUUID(), name: '财务创建人', phone: '13800000011', type: 'SALES', entryDate: new Date('2025-01-01') } });
  await prisma.user.update({ where: { id: userId }, data: { employeeId: employee.id } });
  const customer = await createCustomerFixture(userId);
  const own = await createContractRow({ customerId: customer.id, createdBy: userId });
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const hidden = await createPaymentRow({ contractId: own.id, customerId: customer.id, createdBy: 'someone-else' });
  const visible = await createPaymentRow({ contractId: foreign.id, customerId: customer.id, createdBy: userId });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = receivableServiceFor(userId, actor, {
    employeeId: employee.id,
    scopeIds: [selfScope.id],
  });

  const page = await scoped.listPayments({});
  assert.equal(page.total, 1);
  assert.equal(page.list[0].id, visible.id);
  assert.equal((await scoped.getPayment(visible.id)).id, visible.id);
  await assert.rejects(() => scoped.getPayment(hidden.id), (e: unknown) => (e as { httpStatus: number }).httpStatus === 404);
});

test('TEAM scope anchors Payment via contract.professionalTeamId', async () => {
  const { userId, actor } = await createPaymentActor();
  const branch = await createOrganizationFixture('BRANCH_TEAM_PAY');
  const team = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const otherTeam = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const customer = await createCustomerFixture(userId);
  const inTeam = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', professionalTeamId: team.id,
  });
  const inOtherTeam = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', professionalTeamId: otherTeam.id,
  });
  await createPaymentRow({ contractId: inTeam.id, customerId: customer.id, createdBy: 'someone-else' });
  await createPaymentRow({ contractId: inOtherTeam.id, customerId: customer.id, createdBy: 'someone-else' });
  const teamScope = await prisma.dataScope.create({
    data: { name: `team-${randomUUID()}`, scopeType: 'TEAM', professionalTeamId: team.id },
  });
  const scoped = receivableServiceFor(userId, actor, { scopeIds: [teamScope.id] });

  const page = await scoped.listPayments({});
  assert.equal(page.total, 1);
  assert.equal(page.list[0].contractId, inTeam.id);
});

test('BRANCH scope anchors Payment via contract.branchId including the organization subtree', async () => {
  const { userId, actor } = await createPaymentActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN_PAY');
  const branchChild = await createOrganizationFixture('BRANCH_CHILD_PAY', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER_PAY');
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
  await createPaymentRow({ contractId: inBranch.id, customerId: customer.id, createdBy: 'someone-else' });
  await createPaymentRow({ contractId: inChild.id, customerId: customer.id, createdBy: 'someone-else' });
  await createPaymentRow({ contractId: outOfBranch.id, customerId: customer.id, createdBy: 'someone-else' });
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const scoped = receivableServiceFor(userId, actor, { scopeIds: [branchScope.id] });

  const page = await scoped.listPayments({});
  assert.equal(page.total, 2);
  assert.deepEqual(
    page.list.map(item => item.contractId).sort(),
    [inBranch.id, inChild.id].sort(),
  );
});

test('ORG scope anchors Payment via contract.branchId without descendants', async () => {
  const { userId, actor } = await createPaymentActor();
  const org = await createOrganizationFixture('ORG_MAIN_PAY');
  const orgChild = await createOrganizationFixture('ORG_CHILD_PAY', org);
  const customer = await createCustomerFixture(userId);
  const inOrg = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', branchId: org.id,
  });
  const inChild = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', branchId: orgChild.id,
  });
  await createPaymentRow({ contractId: inOrg.id, customerId: customer.id, createdBy: 'someone-else' });
  await createPaymentRow({ contractId: inChild.id, customerId: customer.id, createdBy: 'someone-else' });
  const orgScope = await prisma.dataScope.create({
    data: { name: `org-${randomUUID()}`, scopeType: 'ORG', organizationId: org.id },
  });
  const scoped = receivableServiceFor(userId, actor, { scopeIds: [orgScope.id] });

  const page = await scoped.listPayments({});
  assert.equal(page.total, 1);
  assert.equal(page.list[0].contractId, inOrg.id);
});

test('listPlans returns plans ordered by period after the contract visibility check', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const planTwo = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '4000.00',
  });
  const planOne = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '4000.00',
  });
  const planThree = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 3, dueDate: '2026-11-01', amount: '4000.00',
  });
  const service = receivableServiceFor(userId, actor);

  const views = await service.listPlans(contract.id);
  assert.deepEqual(
    views.map(view => view.id),
    [planOne.id, planTwo.id, planThree.id],
    'plans are ordered by period ASC regardless of insertion order',
  );
  assert.equal(views[0].planNo, planOne.planNo);
  assert.equal(views[0].amount, '4000.00');
  assert.equal(views[0].receivedAmount, '0.00');
  assert.equal(views[0].status, 'PENDING');
  assert.deepEqual(views[0].dueDate, new Date('2026-09-01T00:00:00.000Z'));

  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = receivableServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });
  await assert.rejects(
    () => scoped.listPlans(foreign.id),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
    'invisible contract yields 404, never leaks plan existence',
  );
  await assert.rejects(
    () => scoped.listPlans(randomUUID()),
    hasCode(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND),
  );
});

test('listPayments and listPlans require the payment.read action permission', async () => {
  const { userId, actor } = await createPaymentActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const denied = receivableServiceFor(userId, actor, {
    permissionCodes: ['payment.create', 'payment.confirm'],
  });

  await assert.rejects(() => denied.listPayments({}), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.listPlans(contract.id), hasCode('PERMISSION_DENIED'));
});

test('ReceivableService exposes no business delete method (FTN-001 §3.6)', async () => {
  const { userId, actor } = await createPaymentActor();
  const service = receivableServiceFor(userId, actor) as unknown as Record<string, unknown>;
  assert.equal(service.deletePayment, undefined, 'no deletePayment business endpoint may exist');
});
