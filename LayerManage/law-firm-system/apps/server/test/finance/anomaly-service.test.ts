import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Contract, InvoiceRequest, PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { AnomalyService } from '../../app/application/finance/anomaly-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-011 Task 9: anomaly-service 契约测试（FIN-05 四口径异常台账）。
// 形态逐段镜像 test/finance/invoice-service.test.ts（Task 5 先例）：夹具（user/customer/
// contract/invoiceRequest/case 直建行 + 授权上下文桩 resource=permissionCode 前缀）+
// 范围夹具（SELF/TEAM/BRANCH 锚定合同列，沿 invoice-service 先例）。本服务为纯只读
// （零事务/零事件/零审计/零 outbox），测试只断言查询视图与错误码。
// 钉死点（brief Step 1）：
//   每口径命中件逐字段断言（含 gapAmount）+ 不命中对照件（已收合同/signed-unpaid 被
//     EFFECTIVE 但已收排除/有 FORMAL 客户豁免首签判定/已建案合同排除/VOID FORMAL 不豁免
//     首签判定——即 FORMAL 但 VOID 的不算"有正式合同"）；
//   scope fail-closed（无范围授权全空）；
//   分页参数非法 400（page=0/pageSize=0/pageSize>100/未知键）；
//   缺 anomaly.read 403。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/finance/anomaly-service.test.ts

let prisma: PrismaClient;

const ANOMALY_PERMISSIONS: PermissionCode[] = ['anomaly.read'];

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

interface AnomalyContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

/** 异常台账授权上下文：grants 的 resource 取 permissionCode 前缀（=catalog.resource，与生产 loader 一致）。 */
function anomalyContext(userId: string, overrides: AnomalyContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? ANOMALY_PERMISSIONS;
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

async function createAnomalyActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `anomaly.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function anomalyServiceFor(
  userId: string,
  actor: AuditActor,
  overrides: AnomalyContextOverrides = {},
): AnomalyService {
  return new AnomalyService(prisma, actor, anomalyContext(userId, overrides));
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '异常台账客户',
      phone: '13900006666',
      phoneHash: hashPhone('13900006666'),
      status: 'SIGNED',
      createdBy,
    },
  });
}

/** 直建行合同夹具：绕过服务层状态机/编号生成（四口径过滤场景只能靠直建行构造）。 */
async function createContractRow(overrides: {
  customerId: string;
  createdBy: string;
  contractType?: string;
  status?: string;
  amount?: string;
  receivedAmount?: string;
  branchId?: string | null;
  professionalTeamId?: string | null;
  signDate?: Date | null;
  effectiveDate?: Date | null;
  deletedAt?: Date | null;
}): Promise<Contract> {
  return prisma.contract.create({
    data: {
      contractNo: `XX-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractType: overrides.contractType ?? 'FIRST_SIGN',
      title: '异常台账夹具合同',
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      status: overrides.status ?? 'SIGNED',
      amount: overrides.amount ?? '10000.00',
      receivedAmount: overrides.receivedAmount ?? '0.00',
      branchId: overrides.branchId ?? null,
      professionalTeamId: overrides.professionalTeamId ?? null,
      signDate: overrides.signDate ?? null,
      effectiveDate: overrides.effectiveDate ?? null,
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

/** 直建行开票申请夹具：PENDING 不计入已开（口径 2 只认 COMPLETED）。 */
async function createInvoiceRow(overrides: {
  contractId: string;
  customerId: string;
  createdBy: string;
  amount?: string;
  status?: string;
}): Promise<InvoiceRequest> {
  return prisma.invoiceRequest.create({
    data: {
      requestNo: `INV-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      contractId: overrides.contractId,
      customerId: overrides.customerId,
      createdBy: overrides.createdBy,
      amount: overrides.amount ?? '1000.00',
      status: overrides.status ?? 'PENDING',
    },
  });
}

/** 直建行案件夹具：contractId 1:1 锚定合同（口径 4 已建案排除）。 */
async function createCaseRow(overrides: {
  contractId: string;
  customerId: string;
}): Promise<{ id: string }> {
  const created = await prisma.case.create({
    data: {
      caseNo: `CASE-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      title: '异常台账夹具案件',
      customerId: overrides.customerId,
      contractId: overrides.contractId,
      caseType: 'CIVIL',
    },
  });
  return { id: created.id };
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

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function isValidationFailed400(error: unknown): boolean {
  return error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400;
}

// ---------- 口径 1 signed-unpaid ----------

test('listSignedUnpaid returns SIGNED/EFFECTIVE unpaid contracts with gapAmount null and excludes received/unsigned/deleted', async () => {
  const { userId, actor } = await createAnomalyActor();
  const customer = await createCustomerFixture(userId);
  const signDate = new Date('2026-08-01T00:00:00.000Z');
  const effectiveDate = new Date('2026-08-15T00:00:00.000Z');
  const hitSigned = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED',
    amount: '10000.00', receivedAmount: '0.00',
    signDate, effectiveDate: null,
  });
  const hitEffective = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'EFFECTIVE',
    amount: '5000.00', receivedAmount: '0.00',
    signDate, effectiveDate,
  });
  // 不命中对照：已收（EFFECTIVE 但 receivedAmount>0）/ 未签（DRAFT）/ 软删。
  await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'EFFECTIVE',
    amount: '8000.00', receivedAmount: '3000.00',
  });
  await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'DRAFT',
    amount: '7000.00', receivedAmount: '0.00',
  });
  await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED',
    amount: '6000.00', receivedAmount: '0.00', deletedAt: new Date(),
  });
  const service = anomalyServiceFor(userId, actor);

  const page = await service.listSignedUnpaid({});

  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 20);
  assert.equal(page.total, 2, 'only SIGNED/EFFECTIVE with receivedAmount=0 and not deleted');
  const byId = new Map(page.list.map(view => [view.contractId, view]));
  assert.equal(byId.size, 2);
  const signed = byId.get(hitSigned.id);
  assert.ok(signed, 'SIGNED unpaid hit present');
  assert.equal(signed.contractNo, hitSigned.contractNo);
  assert.equal(signed.contractType, 'FIRST_SIGN');
  assert.equal(signed.customerId, customer.id);
  assert.equal(signed.amount, '10000.00');
  assert.equal(signed.receivedAmount, '0.00');
  assert.equal(signed.status, 'SIGNED');
  assert.deepEqual(signed.signDate, signDate);
  assert.equal(signed.effectiveDate, null);
  assert.equal(signed.gapAmount, null, 'signed-unpaid gapAmount is always null');
  const effective = byId.get(hitEffective.id);
  assert.ok(effective, 'EFFECTIVE unpaid hit present');
  assert.equal(effective.amount, '5000.00');
  assert.equal(effective.status, 'EFFECTIVE');
  assert.deepEqual(effective.effectiveDate, effectiveDate);
  assert.equal(effective.gapAmount, null);
});

// ---------- 口径 2 received-uninvoiced ----------

test('listReceivedUninvoiced filters by COMPLETED invoice sum and reports received - invoiced gapAmount', async () => {
  const { userId, actor } = await createAnomalyActor();
  const customer = await createCustomerFixture(userId);
  // 命中：无任何 COMPLETED 发票 → gap = 全额 received。
  const hitNoInvoice = await createContractRow({
    customerId: customer.id, createdBy: userId,
    amount: '10000.00', receivedAmount: '5000.00',
  });
  // 命中：COMPLETED 3000 < received 8000 → gap 5000.00。
  const hitPartial = await createContractRow({
    customerId: customer.id, createdBy: userId,
    amount: '10000.00', receivedAmount: '8000.00',
  });
  await createInvoiceRow({
    contractId: hitPartial.id, customerId: customer.id, createdBy: userId,
    amount: '3000.00', status: 'COMPLETED',
  });
  // 命中：仅 PENDING 发票不计入已开 → gap 5000.00（PENDING 不算 COMPLETED）。
  const hitPendingOnly = await createContractRow({
    customerId: customer.id, createdBy: userId,
    amount: '10000.00', receivedAmount: '5000.00',
  });
  await createInvoiceRow({
    contractId: hitPendingOnly.id, customerId: customer.id, createdBy: userId,
    amount: '5000.00', status: 'PENDING',
  });
  // 不命中对照：已全额开票（received == invoiced）。
  const fullyInvoiced = await createContractRow({
    customerId: customer.id, createdBy: userId,
    amount: '10000.00', receivedAmount: '8000.00',
  });
  await createInvoiceRow({
    contractId: fullyInvoiced.id, customerId: customer.id, createdBy: userId,
    amount: '8000.00', status: 'COMPLETED',
  });
  // 不命中对照：未收（receivedAmount = 0）。
  await createContractRow({
    customerId: customer.id, createdBy: userId,
    amount: '10000.00', receivedAmount: '0.00',
  });
  await createContractRow({
    customerId: customer.id, createdBy: userId,
    amount: '10000.00', receivedAmount: '0.00',
  });
  const service = anomalyServiceFor(userId, actor);

  const page = await service.listReceivedUninvoiced({});

  // total = 候选池（receivedAmount>0 且未删）：hitNoInvoice/hitPartial/hitPendingOnly + 全额开票件 = 4。
  assert.equal(page.total, 4, 'total is the candidate pool (received>0) before page-level invoice filtering');
  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 20);
  const byId = new Map(page.list.map(view => [view.contractId, view]));
  assert.equal(byId.size, 3, 'fully-invoiced and zero-received contracts are excluded in memory');
  const noInvoice = byId.get(hitNoInvoice.id);
  assert.ok(noInvoice);
  assert.equal(noInvoice.receivedAmount, '5000.00');
  assert.equal(noInvoice.gapAmount, '5000.00', 'gap = received - 0 for a contract with no COMPLETED invoice');
  const partial = byId.get(hitPartial.id);
  assert.ok(partial);
  assert.equal(partial.receivedAmount, '8000.00');
  assert.equal(partial.gapAmount, '5000.00', 'gap = 8000 - 3000');
  const pendingOnly = byId.get(hitPendingOnly.id);
  assert.ok(pendingOnly, 'PENDING invoice does not count toward invoiced sum');
  assert.equal(pendingOnly.gapAmount, '5000.00', 'gap = 5000 - 0 (PENDING ignored)');
  for (const view of page.list) {
    assert.notEqual(view.gapAmount, null, 'received-uninvoiced always carries a gapAmount');
  }
});

// ---------- 口径 3 first-sign-no-formal ----------

test('listFirstSignNoFormal exempts customers with a FORMAL contract but not VOID or deleted FORMAL ones', async () => {
  const { userId, actor } = await createAnomalyActor();
  // 命中：客户无任何 FORMAL。
  const customerNoFormal = await createCustomerFixture(userId);
  const hit = await createContractRow({
    customerId: customerNoFormal.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED',
  });
  // 不命中对照：同客户存在非 VOID FORMAL → 豁免首签判定。
  const customerHasFormal = await createCustomerFixture(userId);
  const exempted = await createContractRow({
    customerId: customerHasFormal.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED',
  });
  await createContractRow({
    customerId: customerHasFormal.id, createdBy: userId,
    contractType: 'FORMAL', status: 'SIGNED',
  });
  // 命中：FORMAL 但 VOID 不算"有正式合同"（none 过滤 status not VOID）。
  const customerVoidFormal = await createCustomerFixture(userId);
  const voidFormalNotExempt = await createContractRow({
    customerId: customerVoidFormal.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED',
  });
  await createContractRow({
    customerId: customerVoidFormal.id, createdBy: userId,
    contractType: 'FORMAL', status: 'VOID',
  });
  // 命中：FORMAL 但软删不算"有正式合同"（deletedAt null 入 none 条件）。
  const customerDeletedFormal = await createCustomerFixture(userId);
  const deletedFormalNotExempt = await createContractRow({
    customerId: customerDeletedFormal.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'EFFECTIVE',
  });
  await createContractRow({
    customerId: customerDeletedFormal.id, createdBy: userId,
    contractType: 'FORMAL', status: 'SIGNED', deletedAt: new Date(),
  });
  // 不命中对照：未签首签（DRAFT）。
  await createContractRow({
    customerId: customerNoFormal.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'DRAFT',
  });
  const service = anomalyServiceFor(userId, actor);

  const page = await service.listFirstSignNoFormal({});

  assert.equal(page.total, 3, 'hit / VOID-formal not exempt / deleted-formal not exempt');
  const byId = new Map(page.list.map(view => [view.contractId, view]));
  assert.ok(byId.has(hit.id));
  assert.equal(byId.get(hit.id)!.gapAmount, null);
  assert.ok(!byId.has(exempted.id), 'customer with a live FORMAL contract exempts first-sign judgment');
  assert.ok(byId.has(voidFormalNotExempt.id), 'VOID FORMAL does not count as a formal contract');
  assert.ok(byId.has(deletedFormalNotExempt.id), 'deleted FORMAL does not count as a formal contract');
});

// ---------- 口径 4 paid-no-case ----------

test('listPaidNoCase returns FORMAL received contracts without a case and excludes case-linked/unreceived/non-Formal/deleted', async () => {
  const { userId, actor } = await createAnomalyActor();
  const customer = await createCustomerFixture(userId);
  const hit = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FORMAL', status: 'EFFECTIVE',
    amount: '20000.00', receivedAmount: '12000.00',
  });
  // 不命中对照：已建案。
  const withCase = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FORMAL', status: 'EFFECTIVE',
    amount: '20000.00', receivedAmount: '12000.00',
  });
  await createCaseRow({ contractId: withCase.id, customerId: customer.id });
  // 不命中对照：未收（receivedAmount = 0）。
  await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FORMAL', status: 'SIGNED',
    amount: '20000.00', receivedAmount: '0.00',
  });
  // 不命中对照：非 FORMAL。
  await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED',
    amount: '20000.00', receivedAmount: '12000.00',
  });
  // 不命中对照：软删。
  await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FORMAL', status: 'EFFECTIVE',
    amount: '20000.00', receivedAmount: '12000.00', deletedAt: new Date(),
  });
  const service = anomalyServiceFor(userId, actor);

  const page = await service.listPaidNoCase({});

  assert.equal(page.total, 1, 'only FORMAL received without case and not deleted');
  assert.equal(page.list.length, 1);
  const view = page.list[0];
  assert.equal(view.contractId, hit.id);
  assert.equal(view.contractNo, hit.contractNo);
  assert.equal(view.contractType, 'FORMAL');
  assert.equal(view.customerId, customer.id);
  assert.equal(view.amount, '20000.00');
  assert.equal(view.receivedAmount, '12000.00');
  assert.equal(view.status, 'EFFECTIVE');
  assert.equal(view.gapAmount, null, 'paid-no-case gapAmount is always null');
});

// ---------- scope fail-closed ----------

test('anomaly.read with no scope targets fails closed (all four ledgers empty)', async () => {
  const { userId, actor } = await createAnomalyActor();
  const customer = await createCustomerFixture(userId);
  const hitSignedUnpaid = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED',
    amount: '10000.00', receivedAmount: '0.00',
  });
  const hitReceivedUninvoiced = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED',
    amount: '10000.00', receivedAmount: '5000.00',
  });
  const hitFirstSign = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED',
  });
  const hitPaidNoCase = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FORMAL', status: 'EFFECTIVE',
    amount: '10000.00', receivedAmount: '5000.00',
  });
  assert.ok(hitSignedUnpaid && hitReceivedUninvoiced && hitFirstSign && hitPaidNoCase);
  // 仅 anomaly.read 动作、零范围目标（scopeIds 空集 → 解析零谓词 → fail-closed）。
  const closed = anomalyServiceFor(userId, actor, {
    permissionCodes: ANOMALY_PERMISSIONS,
    scopeIds: [],
  });

  const signedUnpaid = await closed.listSignedUnpaid({});
  assert.equal(signedUnpaid.total, 0, 'zero scope targets yields an empty signed-unpaid ledger');
  assert.equal(signedUnpaid.list.length, 0);
  const receivedUninvoiced = await closed.listReceivedUninvoiced({});
  assert.equal(receivedUninvoiced.total, 0, 'zero scope targets yields an empty received-uninvoiced ledger');
  assert.equal(receivedUninvoiced.list.length, 0);
  const firstSignNoFormal = await closed.listFirstSignNoFormal({});
  assert.equal(firstSignNoFormal.total, 0, 'zero scope targets yields an empty first-sign-no-formal ledger');
  assert.equal(firstSignNoFormal.list.length, 0);
  const paidNoCase = await closed.listPaidNoCase({});
  assert.equal(paidNoCase.total, 0, 'zero scope targets yields an empty paid-no-case ledger');
  assert.equal(paidNoCase.list.length, 0);
});

test('BRANCH scope anchors the anomaly ledgers via contract.branchId including the organization subtree', async () => {
  const { userId, actor } = await createAnomalyActor();
  const branch = await createOrganizationFixture('BRANCH_MAIN_ANOMALY');
  const branchChild = await createOrganizationFixture('BRANCH_CHILD_ANOMALY', branch);
  const other = await createOrganizationFixture('BRANCH_OTHER_ANOMALY');
  const customer = await createCustomerFixture(userId);
  const inBranch = await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', branchId: branch.id,
    contractType: 'FIRST_SIGN', status: 'SIGNED', receivedAmount: '0.00',
  });
  await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', branchId: branchChild.id,
    contractType: 'FIRST_SIGN', status: 'SIGNED', receivedAmount: '0.00',
  });
  await createContractRow({
    customerId: customer.id, createdBy: 'someone-else', branchId: other.id,
    contractType: 'FIRST_SIGN', status: 'SIGNED', receivedAmount: '0.00',
  });
  const branchScope = await prisma.dataScope.create({
    data: { name: `branch-${randomUUID()}`, scopeType: 'BRANCH', organizationId: branch.id },
  });
  const scoped = anomalyServiceFor(userId, actor, { scopeIds: [branchScope.id] });

  const page = await scoped.listSignedUnpaid({});
  assert.equal(page.total, 2, 'BRANCH scope covers the organization subtree');
  assert.ok(page.list.some(view => view.contractId === inBranch.id));
});

// ---------- 分页 ----------

test('pagination defaults and page 2 envelopes are shaped like listContracts (createdAt DESC, id ASC)', async () => {
  const { userId, actor } = await createAnomalyActor();
  const customer = await createCustomerFixture(userId);
  const first = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED', receivedAmount: '0.00',
  });
  const second = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED', receivedAmount: '0.00',
  });
  const third = await createContractRow({
    customerId: customer.id, createdBy: userId,
    contractType: 'FIRST_SIGN', status: 'SIGNED', receivedAmount: '0.00',
  });
  const service = anomalyServiceFor(userId, actor);

  const page1 = await service.listSignedUnpaid({ page: 1, pageSize: 2 });
  assert.equal(page1.page, 1);
  assert.equal(page1.pageSize, 2);
  assert.equal(page1.total, 3);
  assert.equal(page1.list.length, 2);
  // createdAt DESC：third > second（id ASC 决胜）。
  assert.equal(page1.list[0].contractId, third.id);
  assert.equal(page1.list[1].contractId, second.id);

  const page2 = await service.listSignedUnpaid({ page: 2, pageSize: 2 });
  assert.equal(page2.page, 2);
  assert.equal(page2.list.length, 1);
  assert.equal(page2.list[0].contractId, first.id);

  const defaults = await service.listSignedUnpaid({});
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 20);
  assert.equal(defaults.total, 3);
});

test('anomaly ledgers reject invalid pagination with VALIDATION_FAILED 400', async () => {
  const { userId, actor } = await createAnomalyActor();
  const service = anomalyServiceFor(userId, actor);

  await assert.rejects(() => service.listSignedUnpaid({ page: 0 }), isValidationFailed400);
  await assert.rejects(() => service.listSignedUnpaid({ page: -1 }), isValidationFailed400);
  await assert.rejects(() => service.listSignedUnpaid({ pageSize: 0 }), isValidationFailed400);
  await assert.rejects(() => service.listSignedUnpaid({ pageSize: 101 }), isValidationFailed400);
  // 未知键同样白名单拒绝（assertExactKeys）。
  await assert.rejects(
    () => service.listSignedUnpaid({ page: 1, status: 'SIGNED' }),
    isValidationFailed400,
  );
  // 四口径分页非法一致 400。
  await assert.rejects(() => service.listReceivedUninvoiced({ pageSize: 0 }), isValidationFailed400);
  await assert.rejects(() => service.listFirstSignNoFormal({ pageSize: 0 }), isValidationFailed400);
  await assert.rejects(() => service.listPaidNoCase({ pageSize: 0 }), isValidationFailed400);
});

// ---------- 权限 ----------

test('all four anomaly ledgers require the anomaly.read action permission (403 without it)', async () => {
  const { userId, actor } = await createAnomalyActor();
  const denied = anomalyServiceFor(userId, actor, {
    permissionCodes: [], // 无 anomaly.read → requireAction 抛 PERMISSION_DENIED 403。
  });

  await assert.rejects(() => denied.listSignedUnpaid({}), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.listReceivedUninvoiced({}), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.listFirstSignNoFormal({}), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.listPaidNoCase({}), hasCode('PERMISSION_DENIED'));
});
