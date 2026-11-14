import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Contract, PaymentPlan, PrismaClient } from '@prisma/client';

import { cancelUnsettledPlans } from '../../app/application/contract/receivable-service';
import { PrismaEventOutboxWriter } from '../../app/application/events/event-outbox-writer';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-012 Task 3: cancelUnsettledPlans 模块函数契约测试。
// 终止联动的唯一计划取消实现：调用方须已持 Contract 行 FOR UPDATE 锁；未清计划
// （PENDING/PARTIAL）逐计划转 CANCELLED（amount 保原始期望额、receivedAmount 保实际
// 已收）、version+1；RECEIVED 不动；同事务 outbox 逐计划发 payment_plan.cancelled
// （sourceModule CONTRACT / objectType PAYMENT_PLAN / payload 恰三键）。
// 测试矩阵 4 例：混合批量（5k PENDING / 4k 收 1k PARTIAL / 2k RECEIVED）→ CANCELLED×2；
// 逐事件（恰 2 条、payload 逐键、sourceModule/objectType）；vacuous（全 RECEIVED → 0/零
// 事件）；金额保持（amount 原值、receivedAmount 实际已收 1k 不动）。
// 串行运行：npx tsx --test --test-force-exit --test-concurrency=1 test/contract/plan-cancel.test.ts

let prisma: PrismaClient;

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

async function createActor(): Promise<string> {
  const user = await prisma.user.create({
    data: { username: `plan.cancel.actor.${randomUUID()}`, password: 'x' },
  });
  return user.id;
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '计划取消客户',
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
      title: '计划取消夹具合同',
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      status: overrides.status ?? 'SIGNED',
      amount: overrides.amount ?? '11000.00',
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

test('cancelUnsettledPlans flips PENDING and PARTIAL to CANCELLED, leaves RECEIVED alone, and returns the count', async () => {
  const userId = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const pending = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const partial = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '4000.00',
    receivedAmount: '1000.00', status: 'PARTIAL',
  });
  const received = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 3, dueDate: '2026-11-01', amount: '2000.00',
    receivedAmount: '2000.00', status: 'RECEIVED',
  });
  const outbox = new PrismaEventOutboxWriter();

  const result = await prisma.$transaction(tx =>
    cancelUnsettledPlans(tx, contract, outbox, userId));

  assert.deepEqual(result, { canceledCount: 2 });

  const stored = await prisma.paymentPlan.findMany({
    where: { contractId: contract.id },
    orderBy: { period: 'asc' },
  });
  assert.deepEqual(stored.map(plan => plan.id), [pending.id, partial.id, received.id]);
  assert.equal(stored[0].status, 'CANCELLED', 'PENDING flips to CANCELLED');
  assert.equal(stored[1].status, 'CANCELLED', 'PARTIAL flips to CANCELLED');
  assert.equal(stored[2].status, 'RECEIVED', 'RECEIVED stays untouched');
  assert.equal(stored[0].version, 2, 'PENDING bumps version once');
  assert.equal(stored[1].version, 2, 'PARTIAL bumps version once');
  assert.equal(stored[2].version, 1, 'RECEIVED version is untouched');
});

test('cancelUnsettledPlans emits exactly one payment_plan.cancelled per cancelled plan', async () => {
  const userId = await createActor();
  const customer = await createCustomerFixture(userId);
  const branch = await createOrganizationFixture('BRANCH_CANCEL');
  const team = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    branchId: branch.id,
    professionalTeamId: team.id,
  });
  const pending = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const partial = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '4000.00',
    receivedAmount: '1000.00', status: 'PARTIAL',
  });
  const received = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 3, dueDate: '2026-11-01', amount: '2000.00',
    receivedAmount: '2000.00', status: 'RECEIVED',
  });
  const outbox = new PrismaEventOutboxWriter();

  const result = await prisma.$transaction(tx =>
    cancelUnsettledPlans(tx, contract, outbox, userId));
  assert.equal(result.canceledCount, 2);

  const events = await prisma.eventLog.findMany({
    where: { eventType: 'payment_plan.cancelled', objectType: 'PAYMENT_PLAN' },
    orderBy: { objectId: 'asc' },
  });
  assert.equal(events.length, 2, 'exactly two payment_plan.cancelled events');
  assert.deepEqual(
    new Set(events.map(event => event.objectId)),
    new Set([pending.id, partial.id]),
    'one event per cancelled plan; the RECEIVED plan gets none',
  );
  for (const event of events) {
    assert.equal(event.eventVersion, 1);
    assert.equal(event.sourceModule, 'CONTRACT');
    assert.equal(event.operatorUserId, userId);
    assert.equal(event.organizationId, null);
    assert.equal(event.branchId, branch.id, 'event branchId anchors the contract branch column');
    assert.equal(event.teamId, team.id, 'event teamId anchors the contract team column');
    assert.deepEqual(event.payload, {
      planId: event.objectId,
      contractId: contract.id,
      status: 'CANCELLED',
    }, 'payload carries exactly three keys {planId, contractId, status}');
    assert.ok(event.traceId && event.traceId.length > 0, 'traceId is present (randomUUID)');
  }
  const receivedEvents = await prisma.eventLog.findMany({ where: { objectId: received.id } });
  assert.equal(receivedEvents.length, 0, 'the RECEIVED plan emits no event');
});

test('cancelUnsettledPlans on an all-RECEIVED contract is a no-op with zero events', async () => {
  const userId = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const receivedOne = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
    receivedAmount: '5000.00', status: 'RECEIVED',
  });
  const receivedTwo = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '6000.00',
    receivedAmount: '6000.00', status: 'RECEIVED',
  });
  const outbox = new PrismaEventOutboxWriter();

  const result = await prisma.$transaction(tx =>
    cancelUnsettledPlans(tx, contract, outbox, userId));

  assert.deepEqual(result, { canceledCount: 0 });
  for (const planId of [receivedOne.id, receivedTwo.id]) {
    const plan = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: planId } });
    assert.equal(plan.status, 'RECEIVED', 'RECEIVED stays untouched');
    assert.equal(plan.version, 1, 'no version bump on a vacuous run');
  }
  assert.equal(
    await prisma.eventLog.count({ where: { eventType: 'payment_plan.cancelled' } }),
    0,
    'zero payment_plan.cancelled events',
  );
});

test('cancelUnsettledPlans preserves the original amount and the actual receivedAmount on cancelled plans', async () => {
  const userId = await createActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const pending = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 1, dueDate: '2026-09-01', amount: '5000.00',
  });
  const partial = await createPlanRow({
    contractId: contract.id, createdBy: userId, period: 2, dueDate: '2026-10-01', amount: '4000.00',
    receivedAmount: '1000.00', status: 'PARTIAL',
  });
  const outbox = new PrismaEventOutboxWriter();

  const result = await prisma.$transaction(tx =>
    cancelUnsettledPlans(tx, contract, outbox, userId));
  assert.equal(result.canceledCount, 2);

  const storedPending = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(storedPending.status, 'CANCELLED');
  assert.equal(storedPending.amount.toFixed(2), '5000.00', 'amount keeps the original expected value');
  assert.equal(storedPending.receivedAmount.toFixed(2), '0.00');

  const storedPartial = await prisma.paymentPlan.findUniqueOrThrow({ where: { id: partial.id } });
  assert.equal(storedPartial.status, 'CANCELLED');
  assert.equal(storedPartial.amount.toFixed(2), '4000.00', 'amount keeps the original expected value');
  assert.equal(storedPartial.receivedAmount.toFixed(2), '1000.00', 'receivedAmount keeps the actual 1k received');
});
