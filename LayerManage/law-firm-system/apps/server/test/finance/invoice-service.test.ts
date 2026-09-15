import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Contract, InvoiceRequest, PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { InvoiceService } from '../../app/application/finance/invoice-service';
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

// SPEC-011 Task 5: invoice-service 契约测试（FIN-02 开票核心）。
// 形态逐段镜像 test/contract/receivable-service.test.ts（Task 9 收款段）：
//   夹具（customer/contract/invoiceRequest 直建行 + 授权上下文桩 resource=permissionCode
//   前缀）+ 范围夹具（SELF/TEAM/BRANCH 锚定合同列）+ 竞速钉法（第三方事务持合同行
//   FOR UPDATE 1s 造确定性败者）。
// 钉死点：invoice.requested 恰 5 键 / approved/rejected/completed 恰 3 键；审计只落
//   标识符（requestNo/contractId/fromStatus/toStatus/amount toFixed(2)，complete 含
//   hasInvoiceNo 布尔、invoiceNo 文本不落）；额度不变量 create 400 / approve 重验 409
//   全回滚（状态保持 PENDING）；幂等重放零事件零审计；reject 挂 invoice.approve 码。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/finance/invoice-service.test.ts

let prisma: PrismaClient;

const INVOICE_PERMISSIONS: PermissionCode[] = [
  'invoice.read',
  'invoice.create',
  'invoice.approve',
  'invoice.complete',
];
const REQUEST_NO_PATTERN = /^INV\d{6}-[A-Z0-9]{6}$/;

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

interface InvoiceContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

/** 开票授权上下文：grants 的 resource 取 permissionCode 前缀（=catalog.resource，与生产 loader 一致）。 */
function invoiceContext(userId: string, overrides: InvoiceContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? INVOICE_PERMISSIONS;
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

async function createInvoiceActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `invoice.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function invoiceServiceFor(
  userId: string,
  actor: AuditActor,
  overrides: InvoiceContextOverrides = {},
): InvoiceService {
  return new InvoiceService(prisma, actor, invoiceContext(userId, overrides));
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '开票客户',
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
      title: '开票夹具合同',
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      status: overrides.status ?? 'SIGNED',
      amount: overrides.amount ?? '10000.00',
      branchId: overrides.branchId ?? null,
      professionalTeamId: overrides.professionalTeamId ?? null,
    },
  });
}

/** 直建行夹具：绕过服务层额度不变量（审批重验/占用推高场景只能靠直建行构造）。 */
async function createInvoiceRow(overrides: {
  contractId: string;
  customerId: string;
  createdBy: string;
  amount?: string;
  status?: string;
  reason?: string | null;
}): Promise<InvoiceRequest> {
  return prisma.invoiceRequest.create({
    data: {
      requestNo: `INV-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractId: overrides.contractId,
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      amount: overrides.amount ?? '1000.00',
      status: overrides.status ?? 'PENDING',
      reason: overrides.reason ?? null,
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

// ---------- 创建 createInvoice ----------

test('createInvoice registers a PENDING invoice with invoice.requested and audit in one transaction', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);

  const view = await service.createInvoice({ contractId: contract.id, amount: '4000.00' });

  assert.ok(view.id);
  assert.match(view.requestNo, REQUEST_NO_PATTERN);
  assert.equal(view.contractId, contract.id);
  assert.equal(view.customerId, customer.id, 'customerId copied from the contract (redundant anchor)');
  assert.equal(view.amount, '4000.00');
  assert.equal(view.reason, null);
  assert.equal(view.status, 'PENDING');
  assert.equal(view.approvedBy, null);
  assert.equal(view.approvedAt, null);
  assert.equal(view.approvalComment, null);
  assert.equal(view.invoiceNo, null);
  assert.equal(view.completedBy, null);
  assert.equal(view.completedAt, null);
  assert.equal(view.createdBy, userId);
  assert.equal(view.version, 1);

  const stored = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.status, 'PENDING');
  assert.equal(stored.customerId, customer.id);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'INVOICE_REQUEST', objectId: view.id, eventType: 'invoice.requested' },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'FINANCE');
  assert.equal(event.operatorUserId, userId);
  assert.equal(event.organizationId, null);
  assert.equal(event.branchId, null, 'organizationId/branchId/teamId anchor the contract columns (none set)');
  assert.equal(event.teamId, null);
  assert.deepEqual(event.payload, {
    invoiceRequestId: view.id,
    requestNo: view.requestNo,
    contractId: contract.id,
    customerId: customer.id,
    status: 'PENDING',
  }, 'invoice.requested carries exactly five keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'INVOICE_REQUEST', targetId: view.id, action: 'INVOICE_CREATE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: view.requestNo,
    contractId: contract.id,
    amount: '4000.00',
  }, 'audit holds identifiers + amount only');
});

test('createInvoice persists reason on the row but keeps it out of audit values', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const branch = await createOrganizationFixture('BRANCH_INV');
  const team = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    branchId: branch.id,
    professionalTeamId: team.id,
  });
  const service = invoiceServiceFor(userId, actor);

  const view = await service.createInvoice({
    contractId: contract.id,
    amount: 2500.5,
    reason: '客户要求加急开票',
  });

  assert.equal(view.amount, '2500.50');
  assert.equal(view.reason, '客户要求加急开票');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'INVOICE_REQUEST', objectId: view.id, eventType: 'invoice.requested' },
  });
  assert.equal(event.branchId, branch.id, 'event branchId anchors the contract branch column');
  assert.equal(event.teamId, team.id, 'event teamId anchors the contract team column');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'INVOICE_REQUEST', targetId: view.id, action: 'INVOICE_CREATE' },
  });
  assert.ok(!operationLog.newValues?.includes('加急'), 'reason free text stays out of audit values');
});

test('createInvoice returns CONTRACT_NOT_FOUND 404 for an invisible or missing contract', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  // SELF 范围解析以 context.employeeId 填 employeeIds（不读 employee 行，合成 id 即可）。
  const scoped = invoiceServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });

  await assert.rejects(
    () => scoped.createInvoice({ contractId: foreign.id, amount: '1000.00' }),
    isContractNotFound404,
    'out-of-scope contract is indistinguishable from missing',
  );
  await assert.rejects(
    () => scoped.createInvoice({ contractId: randomUUID(), amount: '1000.00' }),
    isContractNotFound404,
  );
  assert.equal(await prisma.invoiceRequest.count({ where: { contractId: foreign.id } }), 0);
});

test('createInvoice requires the invoice.create action permission', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const denied = invoiceServiceFor(userId, actor, {
    permissionCodes: ['invoice.read', 'invoice.approve', 'invoice.complete'],
  });

  await assert.rejects(
    () => denied.createInvoice({ contractId: contract.id, amount: '1000.00' }),
    hasCode('PERMISSION_DENIED'),
  );
  assert.equal(await prisma.invoiceRequest.count({ where: { contractId: contract.id } }), 0);
});

test('createInvoice rejects non-positive, over-scale and malformed amounts with 400', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);

  const badAmounts: Array<string | number | undefined> = ['0', 0, '-1.00', '10.005', 'not-a-number', undefined];
  for (const amount of badAmounts) {
    await assert.rejects(
      () => service.createInvoice({ contractId: contract.id, amount: amount as string }),
      isValidationFailed400,
      `amount ${String(amount)} must be rejected`,
    );
  }
  assert.equal(await prisma.invoiceRequest.count({ where: { contractId: contract.id } }), 0);
});

test('createInvoice enforces the occupying-amount invariant: exact fill passes, 0.01 over fails', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
  });
  // 在途申请占额度（直建行夹具构造 8000 PENDING 占用）。
  await createInvoiceRow({
    contractId: contract.id,
    customerId: customer.id,
    createdBy: userId,
    amount: '8000.00',
  });
  const service = invoiceServiceFor(userId, actor);

  const exact = await service.createInvoice({ contractId: contract.id, amount: '2000.00' });
  assert.equal(exact.status, 'PENDING', '8000 occupied + 2000 new = contract amount exactly: passes');

  await assert.rejects(
    () => service.createInvoice({ contractId: contract.id, amount: '0.01' }),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_AMOUNT_EXCEEDED, 400),
    'occupied 10000 + 0.01 exceeds the contract amount',
  );
  assert.equal(await prisma.invoiceRequest.count({ where: { contractId: contract.id } }), 2);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.requested' } }),
    1,
    'the rejected create writes zero events',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'INVOICE_REQUEST', action: 'INVOICE_CREATE' } }),
    1,
    'the rejected create writes zero audits',
  );
});

test('createInvoice ignores REJECTED invoices in the occupying sum', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
  });
  await createInvoiceRow({
    contractId: contract.id,
    customerId: customer.id,
    createdBy: userId,
    amount: '9000.00',
    status: 'REJECTED',
  });
  const service = invoiceServiceFor(userId, actor);

  const view = await service.createInvoice({ contractId: contract.id, amount: '10000.00' });
  assert.equal(view.status, 'PENDING', 'REJECTED frees the occupation: a full-amount create passes');
});

// ---------- 审批 approveInvoice ----------

test('approveInvoice flips PENDING to APPROVED with invoice.approved and audit in one transaction', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '4000.00' });

  const view = await service.approveInvoice(created.id, { comment: '资料齐全，同意开票' });

  assert.equal(view.status, 'APPROVED');
  assert.equal(view.approvedBy, userId);
  assert.ok(view.approvedAt instanceof Date);
  assert.equal(view.approvalComment, '资料齐全，同意开票');
  assert.equal(view.version, 2, 'approve bumps the invoice version once');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'INVOICE_REQUEST', objectId: created.id, eventType: 'invoice.approved' },
  });
  assert.equal(event.sourceModule, 'FINANCE');
  assert.deepEqual(event.payload, {
    invoiceRequestId: created.id,
    contractId: contract.id,
    status: 'APPROVED',
  }, 'invoice.approved carries exactly three keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'INVOICE_REQUEST', targetId: created.id, action: 'INVOICE_APPROVE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: created.requestNo,
    contractId: contract.id,
    fromStatus: 'PENDING',
    toStatus: 'APPROVED',
  });
  assert.ok(!operationLog.newValues?.includes('资料齐全'), 'comment free text stays out of audit values');
});

test('approveInvoice replays an already-approved invoice without a new event or audit', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '4000.00' });

  const first = await service.approveInvoice(created.id, { comment: '首次审批' });
  const replayed = await service.approveInvoice(created.id, { comment: '重放审批' });

  assert.equal(replayed.status, 'APPROVED');
  assert.equal(replayed.version, first.version, 'replay returns the current projection without another flip');
  assert.deepEqual(replayed.approvedAt, first.approvedAt);
  assert.equal(replayed.approvalComment, '首次审批', 'replay does not overwrite the approval comment');

  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.approved' } }),
    1,
    'exactly one invoice.approved event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'INVOICE_REQUEST', action: 'INVOICE_APPROVE' } }),
    1,
    'exactly one INVOICE_APPROVE audit',
  );
});

test('approveInvoice rejects a REJECTED or COMPLETED invoice with INVOICE_STATE_INVALID 409', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const rejectedInvoice = await service.createInvoice({ contractId: contract.id, amount: '1000.00' });
  await service.rejectInvoice(rejectedInvoice.id, {});
  const completedInvoice = await service.createInvoice({ contractId: contract.id, amount: '2000.00' });
  await service.approveInvoice(completedInvoice.id, {});
  await service.completeInvoice(completedInvoice.id, {});

  await assert.rejects(
    () => service.approveInvoice(rejectedInvoice.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_STATE_INVALID, 409),
    'approve on REJECTED is an invalid transition',
  );
  await assert.rejects(
    () => service.approveInvoice(completedInvoice.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_STATE_INVALID, 409),
    'approve on COMPLETED is an invalid transition (not an idempotent replay)',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.approved' } }),
    1,
    'only the legitimate approve wrote an event',
  );
});

test('approveInvoice re-verifies the amount invariant and rolls back on overflow', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
  });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '2000.00' });
  // 审批间隙另一在途申请推高占用（直建行夹具绕过 create 校验，模拟状态已移动）。
  await createInvoiceRow({
    contractId: contract.id,
    customerId: customer.id,
    createdBy: userId,
    amount: '8500.00',
  });

  // 聚合口径含本单（2000）+ 在途 8500 = 10500 > 10000 → 409 全回滚。
  await assert.rejects(
    () => service.approveInvoice(created.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_AMOUNT_EXCEEDED, 409),
  );

  const stored = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'PENDING', 'rollback keeps the invoice PENDING');
  assert.equal(stored.version, 1);
  assert.equal(stored.approvedBy, null);
  assert.equal(stored.approvedAt, null);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.approved' } }),
    0,
    'rollback writes zero invoice.approved events',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'INVOICE_REQUEST', action: 'INVOICE_APPROVE' } }),
    0,
    'rollback writes zero INVOICE_APPROVE audits',
  );
});

test('concurrent approveInvoice of the same invoice succeeds twice with exactly one flip', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '4000.00' });

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
    service.approveInvoice(created.id, {}),
    service.approveInvoice(created.id, {}),
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

  const stored = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'APPROVED');
  assert.equal(stored.version, 2);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.approved' } }),
    1,
    'exactly one invoice.approved event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'INVOICE_REQUEST', action: 'INVOICE_APPROVE' } }),
    1,
    'exactly one INVOICE_APPROVE audit',
  );
});

test('approveInvoice returns INVOICE_NOT_FOUND 404 for an invisible or missing invoice', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const invoice = await createInvoiceRow({
    contractId: foreign.id,
    customerId: customer.id,
    createdBy: 'someone-else',
  });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = invoiceServiceFor(userId, actor, {
    employeeId: randomUUID(),
    scopeIds: [selfScope.id],
  });

  await assert.rejects(
    () => scoped.approveInvoice(invoice.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_NOT_FOUND, 404),
    'out-of-scope invoice is indistinguishable from missing',
  );
  await assert.rejects(
    () => scoped.approveInvoice(randomUUID(), {}),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_NOT_FOUND, 404),
  );
  const stored = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: invoice.id } });
  assert.equal(stored.status, 'PENDING', 'out-of-scope approve never mutates the invoice');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.approved' } }),
    0,
  );
});

test('approveInvoice requires the invoice.approve action permission', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '1000.00' });
  const denied = invoiceServiceFor(userId, actor, {
    permissionCodes: ['invoice.read', 'invoice.create', 'invoice.complete'],
  });

  await assert.rejects(() => denied.approveInvoice(created.id, {}), hasCode('PERMISSION_DENIED'));
  const stored = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'PENDING');
});

// ---------- 驳回 rejectInvoice（挂 invoice.approve 权限码） ----------

test('rejectInvoice flips PENDING to REJECTED with invoice.rejected and audit in one transaction', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '4000.00' });

  const view = await service.rejectInvoice(created.id, { comment: '开票信息有误' });

  assert.equal(view.status, 'REJECTED');
  assert.equal(view.approvalComment, '开票信息有误', 'rejection comment lands on approvalComment');
  assert.equal(view.version, 2);
  assert.equal(view.completedBy, null);
  assert.equal(view.completedAt, null);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'INVOICE_REQUEST', objectId: created.id, eventType: 'invoice.rejected' },
  });
  assert.equal(event.sourceModule, 'FINANCE');
  assert.deepEqual(event.payload, {
    invoiceRequestId: created.id,
    contractId: contract.id,
    status: 'REJECTED',
  }, 'invoice.rejected carries exactly three keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'INVOICE_REQUEST', targetId: created.id, action: 'INVOICE_REJECT' },
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

test('rejectInvoice replays an already-rejected invoice without a new event or audit', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '4000.00' });

  const first = await service.rejectInvoice(created.id, {});
  const replayed = await service.rejectInvoice(created.id, {});

  assert.equal(replayed.status, 'REJECTED');
  assert.equal(replayed.version, first.version);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.rejected' } }),
    1,
    'exactly one invoice.rejected event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'INVOICE_REQUEST', action: 'INVOICE_REJECT' } }),
    1,
    'exactly one INVOICE_REJECT audit',
  );
});

test('rejectInvoice rejects an APPROVED or COMPLETED invoice with INVOICE_STATE_INVALID 409', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const approvedInvoice = await service.createInvoice({ contractId: contract.id, amount: '1000.00' });
  await service.approveInvoice(approvedInvoice.id, {});
  const completedInvoice = await service.createInvoice({ contractId: contract.id, amount: '2000.00' });
  await service.approveInvoice(completedInvoice.id, {});
  await service.completeInvoice(completedInvoice.id, {});

  await assert.rejects(
    () => service.rejectInvoice(approvedInvoice.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_STATE_INVALID, 409),
    'reject on APPROVED is an invalid transition',
  );
  await assert.rejects(
    () => service.rejectInvoice(completedInvoice.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_STATE_INVALID, 409),
    'reject on COMPLETED is an invalid transition',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.rejected' } }),
    0,
  );
});

test('rejectInvoice requires the invoice.approve action permission (reject hangs on the approve code)', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '1000.00' });
  const denied = invoiceServiceFor(userId, actor, {
    permissionCodes: ['invoice.read', 'invoice.create', 'invoice.complete'],
  });

  await assert.rejects(() => denied.rejectInvoice(created.id, {}), hasCode('PERMISSION_DENIED'));
  const stored = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'PENDING');
});

test('rejectInvoice frees the occupying amount for later creates', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({
    customerId: customer.id,
    createdBy: userId,
    amount: '10000.00',
  });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '8000.00' });

  await assert.rejects(
    () => service.createInvoice({ contractId: contract.id, amount: '3000.00' }),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_AMOUNT_EXCEEDED, 400),
    '8000 PENDING occupies: 3000 more overflows',
  );
  await service.rejectInvoice(created.id, {});
  const after = await service.createInvoice({ contractId: contract.id, amount: '10000.00' });
  assert.equal(after.status, 'PENDING', 'REJECTED freed the occupation: a full-amount create passes');
});

// ---------- 完成 completeInvoice ----------

test('completeInvoice flips APPROVED to COMPLETED with invoiceNo, event and audit', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '4000.00' });
  await service.approveInvoice(created.id, {});

  const view = await service.completeInvoice(created.id, { invoiceNo: 'INV-2026-000123' });

  assert.equal(view.status, 'COMPLETED');
  assert.equal(view.invoiceNo, 'INV-2026-000123');
  assert.equal(view.completedBy, userId);
  assert.ok(view.completedAt instanceof Date);
  assert.equal(view.version, 3, 'approve + complete bump the version twice');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'INVOICE_REQUEST', objectId: created.id, eventType: 'invoice.completed' },
  });
  assert.equal(event.sourceModule, 'FINANCE');
  assert.deepEqual(event.payload, {
    invoiceRequestId: created.id,
    contractId: contract.id,
    status: 'COMPLETED',
  }, 'invoice.completed carries exactly three keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'INVOICE_REQUEST', targetId: created.id, action: 'INVOICE_COMPLETE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: created.requestNo,
    contractId: contract.id,
    fromStatus: 'APPROVED',
    toStatus: 'COMPLETED',
    hasInvoiceNo: true,
  });
  assert.ok(!operationLog.newValues?.includes('INV-2026-000123'), 'invoiceNo text stays out of audit values');
});

test('completeInvoice without invoiceNo records hasInvoiceNo false', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '4000.00' });
  await service.approveInvoice(created.id, {});

  const view = await service.completeInvoice(created.id, {});

  assert.equal(view.status, 'COMPLETED');
  assert.equal(view.invoiceNo, null);
  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'INVOICE_REQUEST', targetId: created.id, action: 'INVOICE_COMPLETE' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    requestNo: created.requestNo,
    contractId: contract.id,
    fromStatus: 'APPROVED',
    toStatus: 'COMPLETED',
    hasInvoiceNo: false,
  });
});

test('completeInvoice replays an already-completed invoice without a new event or audit', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '4000.00' });
  await service.approveInvoice(created.id, {});

  const first = await service.completeInvoice(created.id, { invoiceNo: 'INV-2026-000123' });
  const replayed = await service.completeInvoice(created.id, { invoiceNo: 'INV-2026-999999' });

  assert.equal(replayed.status, 'COMPLETED');
  assert.equal(replayed.version, first.version);
  assert.equal(replayed.invoiceNo, 'INV-2026-000123', 'replay does not overwrite the registered invoiceNo');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.completed' } }),
    1,
    'exactly one invoice.completed event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'INVOICE_REQUEST', action: 'INVOICE_COMPLETE' } }),
    1,
    'exactly one INVOICE_COMPLETE audit',
  );
});

test('completeInvoice rejects a PENDING or REJECTED invoice with INVOICE_STATE_INVALID 409', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const pendingInvoice = await service.createInvoice({ contractId: contract.id, amount: '1000.00' });
  const rejectedInvoice = await service.createInvoice({ contractId: contract.id, amount: '2000.00' });
  await service.rejectInvoice(rejectedInvoice.id, {});

  await assert.rejects(
    () => service.completeInvoice(pendingInvoice.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_STATE_INVALID, 409),
    'complete without a prior approve is an invalid transition',
  );
  await assert.rejects(
    () => service.completeInvoice(rejectedInvoice.id, {}),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_STATE_INVALID, 409),
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'INVOICE_REQUEST', eventType: 'invoice.completed' } }),
    0,
  );
});

test('completeInvoice requires the invoice.complete action permission', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({ contractId: contract.id, amount: '1000.00' });
  await service.approveInvoice(created.id, {});
  const denied = invoiceServiceFor(userId, actor, {
    permissionCodes: ['invoice.read', 'invoice.create', 'invoice.approve'],
  });

  await assert.rejects(() => denied.completeInvoice(created.id, {}), hasCode('PERMISSION_DENIED'));
  const stored = await prisma.invoiceRequest.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.status, 'APPROVED');
});

// ---------- 列表/详情 listInvoices / getInvoice ----------

test('listInvoices filters by status, contractId and customerId with pagination', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const otherCustomer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const otherContract = await createContractRow({ customerId: otherCustomer.id, createdBy: userId });
  await createInvoiceRow({ contractId: contract.id, customerId: customer.id, createdBy: userId, amount: '100.00' });
  await createInvoiceRow({ contractId: contract.id, customerId: customer.id, createdBy: userId, amount: '200.00' });
  await createInvoiceRow({
    contractId: otherContract.id,
    customerId: otherCustomer.id,
    createdBy: userId,
    amount: '300.00',
    status: 'APPROVED',
  });
  const service = invoiceServiceFor(userId, actor);

  const all = await service.listInvoices({});
  assert.equal(all.page, 1);
  assert.equal(all.pageSize, 20);
  assert.equal(all.total, 3);
  assert.equal(all.list.length, 3);

  const byStatus = await service.listInvoices({ status: 'APPROVED' });
  assert.equal(byStatus.total, 1);
  assert.equal(byStatus.list[0].contractId, otherContract.id);

  const byContract = await service.listInvoices({ contractId: contract.id });
  assert.equal(byContract.total, 2);
  assert.ok(byContract.list.every(item => item.contractId === contract.id));

  const byCustomer = await service.listInvoices({ customerId: otherCustomer.id });
  assert.equal(byCustomer.total, 1);
  assert.equal(byCustomer.list[0].customerId, otherCustomer.id);

  const paged = await service.listInvoices({ page: 2, pageSize: 2 });
  assert.equal(paged.page, 2);
  assert.equal(paged.pageSize, 2);
  assert.equal(paged.total, 3);
  assert.equal(paged.list.length, 1);
});

test('getInvoice returns the view and 404s for a missing or invisible invoice', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const service = invoiceServiceFor(userId, actor);
  const created = await service.createInvoice({
    contractId: contract.id,
    amount: '4000.00',
    reason: '首笔开票',
  });

  const view = await service.getInvoice(created.id);
  assert.equal(view.id, created.id);
  assert.equal(view.requestNo, created.requestNo);
  assert.equal(view.amount, '4000.00');
  assert.equal(view.reason, '首笔开票');
  assert.equal(view.status, 'PENDING');

  await assert.rejects(
    () => service.getInvoice(randomUUID()),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_NOT_FOUND, 404),
  );
});

test('invoice.read with no scope targets fails closed (list empty, get 404)', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const created = await createInvoiceRow({
    contractId: contract.id,
    customerId: customer.id,
    createdBy: userId,
  });
  // 仅 invoice.read 动作、零范围目标（scopeIds 空集 → 解析零谓词 → fail-closed）。
  const closed = invoiceServiceFor(userId, actor, {
    permissionCodes: ['invoice.read'],
    scopeIds: [],
  });

  const page = await closed.listInvoices({});
  assert.equal(page.total, 0, 'zero scope targets yields an empty list, never the full table');
  assert.equal(page.list.length, 0);
  await assert.rejects(
    () => closed.getInvoice(created.id),
    isFinanceError(FINANCE_ERROR_CODES.INVOICE_NOT_FOUND, 404),
    'zero scope targets yields 404, never leaks existence',
  );
});

test('SELF scope anchors InvoiceRequest via actual record.createdBy, independently of contract creator', async () => {
  const { userId, actor } = await createInvoiceActor();
  const employee = await prisma.employee.create({ data: { employeeNo: 'EMP-' + randomUUID(), name: '财务创建人', phone: '13800000011', type: 'SALES', entryDate: new Date('2025-01-01') } });
  await prisma.user.update({ where: { id: userId }, data: { employeeId: employee.id } });
  const customer = await createCustomerFixture(userId);
  const own = await createContractRow({ customerId: customer.id, createdBy: userId });
  const foreign = await createContractRow({ customerId: customer.id, createdBy: 'someone-else' });
  const hidden = await createInvoiceRow({ contractId: own.id, customerId: customer.id, createdBy: 'someone-else' });
  const visible = await createInvoiceRow({ contractId: foreign.id, customerId: customer.id, createdBy: userId });
  const selfScope = await prisma.dataScope.create({
    data: { name: `self-${randomUUID()}`, scopeType: 'SELF' },
  });
  const scoped = invoiceServiceFor(userId, actor, {
    employeeId: employee.id,
    scopeIds: [selfScope.id],
  });

  const page = await scoped.listInvoices({});
  assert.equal(page.total, 1);
  assert.equal(page.list[0].id, visible.id);
  assert.equal((await scoped.getInvoice(visible.id)).id, visible.id);
  await assert.rejects(() => scoped.getInvoice(hidden.id), (e: unknown) => (e as { httpStatus: number }).httpStatus === 404);
});

test('TEAM scope anchors InvoiceRequest via contract.professionalTeamId', async () => {
  const { userId, actor } = await createInvoiceActor();
  const branch = await createOrganizationFixture('BRANCH_TEAM_INV');
  const team = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const otherTeam = await createTeamFixture(`TEAM_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, branch.id);
  const customer = await createCustomerFixture(userId);
  const inTeam = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', professionalTeamId: team.id,
  });
  const inOtherTeam = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', professionalTeamId: otherTeam.id,
  });
  await createInvoiceRow({ contractId: inTeam.id, customerId: customer.id, createdBy: 'someone-else' });
  await createInvoiceRow({ contractId: inOtherTeam.id, customerId: customer.id, createdBy: 'someone-else' });
  const teamScope = await prisma.dataScope.create({
    data: { name: `team-${randomUUID()}`, scopeType: 'TEAM', professionalTeamId: team.id },
  });
  const scoped = invoiceServiceFor(userId, actor, { scopeIds: [teamScope.id] });

  const page = await scoped.listInvoices({});
  assert.equal(page.total, 1);
  assert.equal(page.list[0].contractId, inTeam.id);
});

test('BRANCH scope anchors InvoiceRequest via contract.branchId including the organization subtree', async () => {
  const { userId, actor } = await createInvoiceActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN_INV');
  const branchChild = await createOrganizationFixture('BRANCH_CHILD_INV', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER_INV');
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
  await createInvoiceRow({ contractId: inBranch.id, customerId: customer.id, createdBy: 'someone-else' });
  await createInvoiceRow({ contractId: inChild.id, customerId: customer.id, createdBy: 'someone-else' });
  await createInvoiceRow({ contractId: outOfBranch.id, customerId: customer.id, createdBy: 'someone-else' });
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const scoped = invoiceServiceFor(userId, actor, { scopeIds: [branchScope.id] });

  const page = await scoped.listInvoices({});
  assert.equal(page.total, 2);
  assert.deepEqual(
    page.list.map(item => item.contractId).sort(),
    [inBranch.id, inChild.id].sort(),
  );
});

test('listInvoices and getInvoice require the invoice.read action permission', async () => {
  const { userId, actor } = await createInvoiceActor();
  const customer = await createCustomerFixture(userId);
  const contract = await createContractRow({ customerId: customer.id, createdBy: userId });
  const created = await createInvoiceRow({
    contractId: contract.id,
    customerId: customer.id,
    createdBy: userId,
  });
  const denied = invoiceServiceFor(userId, actor, {
    permissionCodes: ['invoice.create', 'invoice.approve', 'invoice.complete'],
  });

  await assert.rejects(() => denied.listInvoices({}), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.getInvoice(created.id), hasCode('PERMISSION_DENIED'));
});
