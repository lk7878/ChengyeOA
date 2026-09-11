import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { CostEntry, PrismaClient } from '@prisma/client';

import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { CostService } from '../../app/application/finance/cost-service';
import { AuditActor } from '../../app/application/master-data/master-data-types';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { hashPhone } from '../../app/domain/crm/lead-policy';
import { FINANCE_ERROR_CODES, FinanceError } from '../../app/domain/finance/finance-errors';
import { CostCategory } from '../../app/domain/finance/finance-types';
import { MasterDataError } from '../../app/domain/master-data/master-data-errors';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

// SPEC-011 Task 8: cost-service 契约测试（FIN-04 成本台账）。
// 形态逐段镜像 test/finance/invoice-service.test.ts（Task 5 先例）：夹具（user/channel/
// customer/case 直建行 + 授权上下文桩 resource=permissionCode 前缀）+ 直建行成本夹具
// （绕过服务层构造软删/过滤场景）。成本=财务职能数据，仅权限门控无行级 scope（已批准
// 设计决策）——授权上下文桩只需管 permissionCodes，scopeIds 不参与。
// 钉死点：锚点矩阵 5 类各一正一反（REQUIRED/FORBIDDEN 400）；channelId/caseId 伪造
//   存在性 VALIDATION_FAILED 400；cost.created 恰 4 键 / updated/deleted 恰 2 键；
//   审计标识符-only（create 含 amount toFixed(2)+hasNote 布尔、note 文本不落；update
//   只落变更字段名集合；delete 恰 costEntryId+category）；category/channelId/caseId
//   创建后不可变（update 注入即 400）；version 必填缺失 400、 stale VERSION_CONFLICT
//   409；软删后 get 404 list 不见、二次 delete 404；无 cost.* 权限 403。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/finance/cost-service.test.ts

let prisma: PrismaClient;

const COST_PERMISSIONS: PermissionCode[] = [
  'cost.read',
  'cost.create',
  'cost.update',
  'cost.delete',
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

interface CostContextOverrides {
  employeeId?: string | null;
  permissionCodes?: PermissionCode[];
  scopeIds?: string[];
}

/** 成本授权上下文：grants 的 resource 取 permissionCode 前缀（=catalog.resource，与生产 loader 一致）。 */
function costContext(userId: string, overrides: CostContextOverrides = {}): AuthorizationContext {
  const permissionCodes = overrides.permissionCodes ?? COST_PERMISSIONS;
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

async function createCostActor(): Promise<{ userId: string; actor: AuditActor }> {
  const user = await prisma.user.create({
    data: { username: `cost.actor.${randomUUID()}`, password: 'x' },
  });
  return {
    userId: user.id,
    actor: { actorUserId: user.id, requestId: `req-${randomUUID()}` },
  };
}

function costServiceFor(
  userId: string,
  actor: AuditActor,
  overrides: CostContextOverrides = {},
): CostService {
  return new CostService(prisma, actor, costContext(userId, overrides));
}

async function createChannelFixture() {
  return prisma.channel.create({
    data: { code: `CH_${randomUUID()}`, name: '成本渠道', type: 'SEARCH' },
  });
}

async function createCustomerFixture(createdBy: string) {
  return prisma.customer.create({
    data: {
      customerNo: `CU-SEED-${randomUUID()}`,
      name: '成本客户',
      phone: '13900005555',
      phoneHash: hashPhone('13900005555'),
      status: 'SIGNED',
      createdBy,
    },
  });
}

async function createCaseFixture(customerId: string) {
  return prisma.case.create({
    data: {
      caseNo: `CASE-SEED-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      title: '成本夹具案件',
      customerId,
      caseType: 'CIVIL',
    },
  });
}

/** 直建行夹具：绕过服务层锚点矩阵/存在性校验（软删行、过滤场景只能靠直建行构造）。 */
async function createCostRow(overrides: {
  category: CostCategory;
  createdBy: string;
  amount?: string;
  occurredAt?: Date;
  note?: string | null;
  channelId?: string | null;
  caseId?: string | null;
  deletedAt?: Date | null;
}): Promise<CostEntry> {
  return prisma.costEntry.create({
    data: {
      category: overrides.category,
      amount: overrides.amount ?? '100.00',
      occurredAt: overrides.occurredAt ?? new Date('2026-07-15T00:00:00.000Z'),
      note: overrides.note ?? null,
      channelId: overrides.channelId ?? null,
      caseId: overrides.caseId ?? null,
      deletedAt: overrides.deletedAt ?? null,
      createdBy: overrides.createdBy,
    },
  });
}

function hasCode(code: string): (error: unknown) => boolean {
  return error => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function isValidationFailed400(error: unknown): boolean {
  return error instanceof MasterDataError && error.code === 'VALIDATION_FAILED' && error.status === 400;
}

function isVersionConflict409(error: unknown): boolean {
  return error instanceof MasterDataError && error.code === 'VERSION_CONFLICT' && error.status === 409;
}

function isFinanceError(code: string, httpStatus: number): (error: unknown) => boolean {
  return error => error instanceof FinanceError && error.code === code && error.httpStatus === httpStatus;
}

// ---------- 创建 createCostEntry ----------

test('createCostEntry registers a CHANNEL cost with cost.created and audit in one transaction', async () => {
  const { userId, actor } = await createCostActor();
  const channel = await createChannelFixture();
  const service = costServiceFor(userId, actor);

  const view = await service.createCostEntry({
    category: 'CHANNEL',
    amount: '3200.50',
    occurredAt: '2026-07-15',
    channelId: channel.id,
  });

  assert.ok(view.id);
  assert.equal(view.category, 'CHANNEL');
  assert.equal(view.amount, '3200.50');
  assert.deepEqual(view.occurredAt, new Date('2026-07-15T00:00:00.000Z'));
  assert.equal(view.note, null);
  assert.equal(view.channelId, channel.id);
  assert.equal(view.caseId, null);
  assert.equal(view.createdBy, userId);
  assert.equal(view.updatedBy, null);
  assert.equal(view.version, 1);
  assert.ok(view.createdAt instanceof Date);
  assert.ok(view.updatedAt instanceof Date);
  assert.ok(!('deletedAt' in view), 'deletedAt never leaks into the view');

  const stored = await prisma.costEntry.findUniqueOrThrow({ where: { id: view.id } });
  assert.equal(stored.category, 'CHANNEL');
  assert.equal(stored.deletedAt, null);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'COST_ENTRY', objectId: view.id, eventType: 'cost.created' },
  });
  assert.equal(event.eventVersion, 1);
  assert.equal(event.sourceModule, 'FINANCE');
  assert.equal(event.operatorUserId, userId);
  assert.equal(event.organizationId, null, 'cost carries no organization anchor');
  assert.equal(event.branchId, null);
  assert.equal(event.teamId, null);
  assert.deepEqual(event.payload, {
    costEntryId: view.id,
    category: 'CHANNEL',
    channelId: channel.id,
    caseId: null,
  }, 'cost.created carries exactly four keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'COST_ENTRY', targetId: view.id, action: 'COST_CREATE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    costEntryId: view.id,
    category: 'CHANNEL',
    amount: '3200.50',
    hasNote: false,
  }, 'create audit holds identifiers + amount + hasNote only');
});

test('createCostEntry persists note on the row but keeps it out of audit values', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);

  const view = await service.createCostEntry({
    category: 'OFFICE',
    amount: 500,
    occurredAt: '2026-07-20',
    note: '七月办公用品集中采购',
  });

  assert.equal(view.amount, '500.00');
  assert.equal(view.note, '七月办公用品集中采购');

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'COST_ENTRY', objectId: view.id, eventType: 'cost.created' },
  });
  assert.deepEqual(event.payload, {
    costEntryId: view.id,
    category: 'OFFICE',
    channelId: null,
    caseId: null,
  }, 'note free text stays out of the event payload');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'COST_ENTRY', targetId: view.id, action: 'COST_CREATE' },
  });
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.equal(auditValues.hasNote, true, 'audit records only the hasNote boolean');
  assert.ok(!operationLog.newValues?.includes('办公用品'), 'note free text stays out of audit values');
});

test('createCostEntry accepts every anchor-matrix combination (five categories, one positive each)', async () => {
  const { userId, actor } = await createCostActor();
  const channel = await createChannelFixture();
  const customer = await createCustomerFixture(userId);
  const kase = await createCaseFixture(customer.id);
  const service = costServiceFor(userId, actor);

  const channelCost = await service.createCostEntry({
    category: 'CHANNEL', amount: '10.00', occurredAt: '2026-07-01', channelId: channel.id,
  });
  assert.equal(channelCost.channelId, channel.id);
  assert.equal(channelCost.caseId, null);

  const evidenceCost = await service.createCostEntry({
    category: 'EVIDENCE', amount: '20.00', occurredAt: '2026-07-02', caseId: kase.id,
  });
  assert.equal(evidenceCost.caseId, kase.id);
  assert.equal(evidenceCost.channelId, null);

  const caseHandlingCost = await service.createCostEntry({
    category: 'CASE_HANDLING', amount: '30.00', occurredAt: '2026-07-03', caseId: kase.id,
  });
  assert.equal(caseHandlingCost.caseId, kase.id);
  assert.equal(caseHandlingCost.channelId, null);

  const laborCost = await service.createCostEntry({
    category: 'LABOR', amount: '40.00', occurredAt: '2026-07-04',
  });
  assert.equal(laborCost.channelId, null);
  assert.equal(laborCost.caseId, null);

  const officeCost = await service.createCostEntry({
    category: 'OFFICE', amount: '50.00', occurredAt: '2026-07-05',
  });
  assert.equal(officeCost.channelId, null);
  assert.equal(officeCost.caseId, null);

  assert.equal(await prisma.costEntry.count(), 5);
});

test('createCostEntry rejects every anchor-matrix violation (five categories, one negative each)', async () => {
  const { userId, actor } = await createCostActor();
  const channel = await createChannelFixture();
  const customer = await createCustomerFixture(userId);
  const kase = await createCaseFixture(customer.id);
  const service = costServiceFor(userId, actor);

  await assert.rejects(
    () => service.createCostEntry({ category: 'CHANNEL', amount: '10.00', occurredAt: '2026-07-01' }),
    isFinanceError(FINANCE_ERROR_CODES.COST_ANCHOR_REQUIRED, 400),
    'CHANNEL without channelId is REQUIRED',
  );
  await assert.rejects(
    () => service.createCostEntry({ category: 'EVIDENCE', amount: '10.00', occurredAt: '2026-07-01' }),
    isFinanceError(FINANCE_ERROR_CODES.COST_ANCHOR_REQUIRED, 400),
    'EVIDENCE without caseId is REQUIRED',
  );
  await assert.rejects(
    () => service.createCostEntry({
      category: 'CASE_HANDLING', amount: '10.00', occurredAt: '2026-07-01',
      caseId: kase.id, channelId: channel.id,
    }),
    isFinanceError(FINANCE_ERROR_CODES.COST_ANCHOR_FORBIDDEN, 400),
    'CASE_HANDLING with channelId is FORBIDDEN',
  );
  await assert.rejects(
    () => service.createCostEntry({
      category: 'LABOR', amount: '10.00', occurredAt: '2026-07-01', channelId: channel.id,
    }),
    isFinanceError(FINANCE_ERROR_CODES.COST_ANCHOR_FORBIDDEN, 400),
    'LABOR with channelId is FORBIDDEN',
  );
  await assert.rejects(
    () => service.createCostEntry({
      category: 'OFFICE', amount: '10.00', occurredAt: '2026-07-01', caseId: kase.id,
    }),
    isFinanceError(FINANCE_ERROR_CODES.COST_ANCHOR_FORBIDDEN, 400),
    'OFFICE with caseId is FORBIDDEN',
  );

  assert.equal(await prisma.costEntry.count(), 0, 'rejected creates write zero rows');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'COST_ENTRY' } }),
    0,
    'rejected creates write zero events',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'COST_ENTRY' } }),
    0,
    'rejected creates write zero audits',
  );
});

test('createCostEntry rejects a forged channelId or caseId with VALIDATION_FAILED 400', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);

  await assert.rejects(
    () => service.createCostEntry({
      category: 'CHANNEL', amount: '10.00', occurredAt: '2026-07-01', channelId: randomUUID(),
    }),
    isValidationFailed400,
    'a channelId that does not resolve to a Channel row is a validation failure',
  );
  await assert.rejects(
    () => service.createCostEntry({
      category: 'EVIDENCE', amount: '10.00', occurredAt: '2026-07-01', caseId: randomUUID(),
    }),
    isValidationFailed400,
    'a caseId that does not resolve to a Case row is a validation failure',
  );
  assert.equal(await prisma.costEntry.count(), 0);
  assert.equal(await prisma.eventLog.count({ where: { objectType: 'COST_ENTRY' } }), 0);
});

test('createCostEntry requires the cost.create action permission', async () => {
  const { userId, actor } = await createCostActor();
  const denied = costServiceFor(userId, actor, {
    permissionCodes: ['cost.read', 'cost.update', 'cost.delete'],
  });

  await assert.rejects(
    () => denied.createCostEntry({ category: 'LABOR', amount: '10.00', occurredAt: '2026-07-01' }),
    hasCode('PERMISSION_DENIED'),
  );
  assert.equal(await prisma.costEntry.count(), 0);
});

test('createCostEntry rejects non-positive, over-scale and malformed amounts with 400', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);

  const badAmounts: Array<string | number | undefined> = ['0', 0, '-1.00', '10.005', 'not-a-number', undefined];
  for (const amount of badAmounts) {
    await assert.rejects(
      () => service.createCostEntry({
        category: 'LABOR', amount: amount as string, occurredAt: '2026-07-01',
      }),
      isValidationFailed400,
      `amount ${String(amount)} must be rejected`,
    );
  }
  assert.equal(await prisma.costEntry.count(), 0);
});

test('createCostEntry rejects a malformed occurredAt and unknown extra keys with 400', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);

  const badDates: unknown[] = ['not-a-date', '2026-13-40', '2026-02-30', 123];
  for (const occurredAt of badDates) {
    await assert.rejects(
      () => service.createCostEntry({
        category: 'LABOR', amount: '10.00', occurredAt: occurredAt as string,
      }),
      isValidationFailed400,
      `occurredAt ${String(occurredAt)} must be rejected`,
    );
  }
  await assert.rejects(
    () => service.createCostEntry({
      category: 'LABOR', amount: '10.00', occurredAt: '2026-07-01', idempotencyKey: 'x',
    } as unknown as Parameters<CostService['createCostEntry']>[0]),
    isValidationFailed400,
    'assertExactKeys rejects injected keys',
  );
  assert.equal(await prisma.costEntry.count(), 0);
});

// ---------- 更新 updateCostEntry ----------

test('updateCostEntry applies provided fields, bumps the version, and writes cost.updated + audit', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'LABOR', amount: '100.00', occurredAt: '2026-07-01',
  });

  const view = await service.updateCostEntry(created.id, {
    amount: '250.75',
    occurredAt: '2026-07-20',
    note: '七月人力成本分摊',
    version: 1,
  });

  assert.equal(view.id, created.id);
  assert.equal(view.amount, '250.75');
  assert.deepEqual(view.occurredAt, new Date('2026-07-20T00:00:00.000Z'));
  assert.equal(view.note, '七月人力成本分摊');
  assert.equal(view.category, 'LABOR', 'category is immutable');
  assert.equal(view.version, 2, 'update bumps the version once');
  assert.equal(view.updatedBy, userId);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'COST_ENTRY', objectId: created.id, eventType: 'cost.updated' },
  });
  assert.equal(event.sourceModule, 'FINANCE');
  assert.equal(event.organizationId, null);
  assert.equal(event.branchId, null);
  assert.equal(event.teamId, null);
  assert.deepEqual(event.payload, {
    costEntryId: created.id,
    category: 'LABOR',
  }, 'cost.updated carries exactly two keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'COST_ENTRY', targetId: created.id, action: 'COST_UPDATE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    costEntryId: created.id,
    category: 'LABOR',
    changedFields: ['amount', 'occurredAt', 'note'],
  }, 'update audit records only the changed field names, never the new values');
  assert.ok(!operationLog.newValues?.includes('人力成本'), 'note free text stays out of audit values');
});

test('updateCostEntry applies a partial update and clears note with an empty string', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'OFFICE', amount: '100.00', occurredAt: '2026-07-01', note: '初始备注',
  });

  const noted = await service.updateCostEntry(created.id, { note: '更新后的备注', version: 1 });
  assert.equal(noted.note, '更新后的备注');
  assert.equal(noted.amount, '100.00', 'untouched fields stay intact');
  assert.deepEqual(noted.occurredAt, new Date('2026-07-01T00:00:00.000Z'));
  assert.equal(noted.version, 2);

  const cleared = await service.updateCostEntry(created.id, { note: '', version: 2 });
  assert.equal(cleared.note, null, 'empty string clears the note');
  assert.equal(cleared.version, 3);

  const audits = await prisma.operationLog.findMany({
    where: { targetType: 'COST_ENTRY', targetId: created.id, action: 'COST_UPDATE' },
    orderBy: { createdAt: 'asc' },
  });
  assert.equal(audits.length, 2);
  const firstAudit = JSON.parse(audits[0].newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(firstAudit.changedFields, ['note'], 'partial update records only the note field');
});

test('updateCostEntry rejects a missing or malformed version with 400', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'LABOR', amount: '100.00', occurredAt: '2026-07-01',
  });

  const badVersions: unknown[] = [undefined, '1', -1, 1.5];
  for (const version of badVersions) {
    await assert.rejects(
      () => service.updateCostEntry(created.id, { note: 'x', version: version as number }),
      isValidationFailed400,
      `version ${String(version)} must be rejected`,
    );
  }
  const stored = await prisma.costEntry.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.version, 1, 'rejected updates never mutate the row');
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'COST_ENTRY', eventType: 'cost.updated' } }),
    0,
  );
});

test('updateCostEntry rejects category/channelId/caseId injection with 400 (anchors are immutable)', async () => {
  const { userId, actor } = await createCostActor();
  const channel = await createChannelFixture();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'CHANNEL', amount: '100.00', occurredAt: '2026-07-01', channelId: channel.id,
  });

  const injections: Array<Record<string, unknown>> = [
    { category: 'OFFICE', version: 1 },
    { channelId: randomUUID(), version: 1 },
    { caseId: randomUUID(), version: 1 },
  ];
  for (const injection of injections) {
    await assert.rejects(
      () => service.updateCostEntry(
        created.id,
        injection as unknown as Parameters<CostService['updateCostEntry']>[1],
      ),
      isValidationFailed400,
      `injection ${JSON.stringify(injection)} must be rejected by assertExactKeys`,
    );
  }
  const stored = await prisma.costEntry.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.version, 1, 'injected updates never mutate the row');
  assert.equal(stored.category, 'CHANNEL');
  assert.equal(stored.channelId, channel.id);
  assert.equal(stored.caseId, null);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'COST_ENTRY', eventType: 'cost.updated' } }),
    0,
  );
});

test('updateCostEntry returns VERSION_CONFLICT 409 for a stale version', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'LABOR', amount: '100.00', occurredAt: '2026-07-01',
  });

  await service.updateCostEntry(created.id, { note: '第一次更新', version: 1 });

  await assert.rejects(
    () => service.updateCostEntry(created.id, { note: '过期版本更新', version: 1 }),
    isVersionConflict409,
    'replaying version 1 after the flip is a version conflict',
  );
  await assert.rejects(
    () => service.updateCostEntry(created.id, { note: '未来版本更新', version: 99 }),
    isVersionConflict409,
  );
  const stored = await prisma.costEntry.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.note, '第一次更新', 'conflicting updates never overwrite the row');
  assert.equal(stored.version, 2);
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'COST_ENTRY', eventType: 'cost.updated' } }),
    1,
    'only the legitimate update wrote an event',
  );
});

test('updateCostEntry returns COST_NOT_FOUND 404 for a missing or soft-deleted entry', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'LABOR', amount: '100.00', occurredAt: '2026-07-01',
  });
  await service.deleteCostEntry(created.id);

  await assert.rejects(
    () => service.updateCostEntry(randomUUID(), { note: 'x', version: 1 }),
    isFinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404),
  );
  await assert.rejects(
    () => service.updateCostEntry(created.id, { note: 'x', version: 2 }),
    isFinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404),
    'a soft-deleted entry is indistinguishable from missing',
  );
});

test('updateCostEntry requires the cost.update action permission', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'LABOR', amount: '100.00', occurredAt: '2026-07-01',
  });
  const denied = costServiceFor(userId, actor, {
    permissionCodes: ['cost.read', 'cost.create', 'cost.delete'],
  });

  await assert.rejects(
    () => denied.updateCostEntry(created.id, { note: 'x', version: 1 }),
    hasCode('PERMISSION_DENIED'),
  );
  const stored = await prisma.costEntry.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.version, 1);
});

// ---------- 删除 deleteCostEntry ----------

test('deleteCostEntry soft-deletes with cost.deleted + audit and hides the row from get and list', async () => {
  const { userId, actor } = await createCostActor();
  const customer = await createCustomerFixture(userId);
  const kase = await createCaseFixture(customer.id);
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'EVIDENCE', amount: '800.00', occurredAt: '2026-07-10', caseId: kase.id,
  });

  const result = await service.deleteCostEntry(created.id);
  assert.deepEqual(result, { id: created.id });

  const stored = await prisma.costEntry.findUniqueOrThrow({ where: { id: created.id } });
  assert.ok(stored.deletedAt instanceof Date, 'delete flips deletedAt instead of removing the row');
  assert.equal(stored.version, 2, 'delete bumps the version once');
  assert.equal(stored.updatedBy, userId);

  const event = await prisma.eventLog.findFirstOrThrow({
    where: { objectType: 'COST_ENTRY', objectId: created.id, eventType: 'cost.deleted' },
  });
  assert.equal(event.sourceModule, 'FINANCE');
  assert.equal(event.organizationId, null);
  assert.equal(event.branchId, null);
  assert.equal(event.teamId, null);
  assert.deepEqual(event.payload, {
    costEntryId: created.id,
    category: 'EVIDENCE',
  }, 'cost.deleted carries exactly two keys');

  const operationLog = await prisma.operationLog.findFirstOrThrow({
    where: { targetType: 'COST_ENTRY', targetId: created.id, action: 'COST_DELETE' },
  });
  assert.equal(operationLog.userId, userId);
  const auditValues = JSON.parse(operationLog.newValues ?? '{}') as Record<string, unknown>;
  assert.deepEqual(auditValues, {
    costEntryId: created.id,
    category: 'EVIDENCE',
  }, 'delete audit carries exactly costEntryId + category');

  await assert.rejects(
    () => service.getCostEntry(created.id),
    isFinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404),
    'soft-deleted entry is invisible to get',
  );
  const page = await service.listCostEntries({});
  assert.equal(page.total, 0, 'soft-deleted entry is invisible to list');
});

test('deleteCostEntry returns COST_NOT_FOUND 404 for a missing id or a second delete', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'LABOR', amount: '100.00', occurredAt: '2026-07-01',
  });

  await assert.rejects(
    () => service.deleteCostEntry(randomUUID()),
    isFinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404),
  );
  await service.deleteCostEntry(created.id);
  await assert.rejects(
    () => service.deleteCostEntry(created.id),
    isFinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404),
    'a second delete is 404, never a no-op success',
  );
  assert.equal(
    await prisma.eventLog.count({ where: { objectType: 'COST_ENTRY', eventType: 'cost.deleted' } }),
    1,
    'exactly one cost.deleted event',
  );
  assert.equal(
    await prisma.operationLog.count({ where: { targetType: 'COST_ENTRY', action: 'COST_DELETE' } }),
    1,
    'exactly one COST_DELETE audit',
  );
});

test('deleteCostEntry requires the cost.delete action permission', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'LABOR', amount: '100.00', occurredAt: '2026-07-01',
  });
  const denied = costServiceFor(userId, actor, {
    permissionCodes: ['cost.read', 'cost.create', 'cost.update'],
  });

  await assert.rejects(() => denied.deleteCostEntry(created.id), hasCode('PERMISSION_DENIED'));
  const view = await service.getCostEntry(created.id);
  assert.equal(view.id, created.id, 'denied delete leaves the row visible');
});

// ---------- 列表/详情 listCostEntries / getCostEntry ----------

test('listCostEntries filters by category, channelId and caseId with pagination, hiding soft-deleted rows', async () => {
  const { userId, actor } = await createCostActor();
  const channelA = await createChannelFixture();
  const channelB = await createChannelFixture();
  const customer = await createCustomerFixture(userId);
  const kase = await createCaseFixture(customer.id);
  await createCostRow({ category: 'CHANNEL', createdBy: userId, amount: '100.00', channelId: channelA.id });
  await createCostRow({ category: 'CHANNEL', createdBy: userId, amount: '200.00', channelId: channelA.id });
  await createCostRow({ category: 'CHANNEL', createdBy: userId, amount: '300.00', channelId: channelB.id });
  await createCostRow({ category: 'EVIDENCE', createdBy: userId, amount: '400.00', caseId: kase.id });
  await createCostRow({ category: 'LABOR', createdBy: userId, amount: '500.00' });
  await createCostRow({
    category: 'LABOR', createdBy: userId, amount: '600.00', deletedAt: new Date(),
  });
  const service = costServiceFor(userId, actor);

  const all = await service.listCostEntries({});
  assert.equal(all.page, 1);
  assert.equal(all.pageSize, 20);
  assert.equal(all.total, 5, 'soft-deleted rows are excluded');
  assert.equal(all.list.length, 5);
  assert.ok(all.list.every(item => item.amount !== '600.00'));

  const byCategory = await service.listCostEntries({ category: 'CHANNEL' });
  assert.equal(byCategory.total, 3);
  assert.ok(byCategory.list.every(item => item.category === 'CHANNEL'));

  const laborOnly = await service.listCostEntries({ category: 'LABOR' });
  assert.equal(laborOnly.total, 1, 'soft-deleted LABOR row stays hidden under a category filter');

  const byChannel = await service.listCostEntries({ channelId: channelA.id });
  assert.equal(byChannel.total, 2);
  assert.ok(byChannel.list.every(item => item.channelId === channelA.id));

  const byCase = await service.listCostEntries({ caseId: kase.id });
  assert.equal(byCase.total, 1);
  assert.equal(byCase.list[0].caseId, kase.id);

  const paged = await service.listCostEntries({ page: 3, pageSize: 2 });
  assert.equal(paged.page, 3);
  assert.equal(paged.pageSize, 2);
  assert.equal(paged.total, 5);
  assert.equal(paged.list.length, 1);
});

test('listCostEntries rejects a malformed category, page and pageSize with 400', async () => {
  const { userId, actor } = await createCostActor();
  const service = costServiceFor(userId, actor);

  await assert.rejects(
    () => service.listCostEntries({ category: 'UNKNOWN' as CostCategory }),
    isValidationFailed400,
  );
  await assert.rejects(() => service.listCostEntries({ page: 0 }), isValidationFailed400);
  await assert.rejects(() => service.listCostEntries({ pageSize: 101 }), isValidationFailed400);
  await assert.rejects(
    () => service.listCostEntries({ status: 'X' } as unknown as Parameters<CostService['listCostEntries']>[0]),
    isValidationFailed400,
    'assertExactKeys rejects injected query keys',
  );
});

test('getCostEntry returns the view and 404s for a missing or soft-deleted id', async () => {
  const { userId, actor } = await createCostActor();
  const channel = await createChannelFixture();
  const service = costServiceFor(userId, actor);
  const created = await service.createCostEntry({
    category: 'CHANNEL', amount: '1200.00', occurredAt: '2026-07-08',
    note: '渠道投放七月第一周', channelId: channel.id,
  });

  const view = await service.getCostEntry(created.id);
  assert.equal(view.id, created.id);
  assert.equal(view.category, 'CHANNEL');
  assert.equal(view.amount, '1200.00');
  assert.equal(view.note, '渠道投放七月第一周');
  assert.equal(view.channelId, channel.id);
  assert.equal(view.caseId, null);
  assert.equal(view.version, 1);

  await assert.rejects(
    () => service.getCostEntry(randomUUID()),
    isFinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404),
  );
  const deleted = await createCostRow({
    category: 'OFFICE', createdBy: userId, deletedAt: new Date(),
  });
  await assert.rejects(
    () => service.getCostEntry(deleted.id),
    isFinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404),
    'a directly soft-deleted row is indistinguishable from missing',
  );
});

test('listCostEntries and getCostEntry require the cost.read action permission', async () => {
  const { userId, actor } = await createCostActor();
  const created = await createCostRow({ category: 'LABOR', createdBy: userId });
  const denied = costServiceFor(userId, actor, {
    permissionCodes: ['cost.create', 'cost.update', 'cost.delete'],
  });

  await assert.rejects(() => denied.listCostEntries({}), hasCode('PERMISSION_DENIED'));
  await assert.rejects(() => denied.getCostEntry(created.id), hasCode('PERMISSION_DENIED'));
});
