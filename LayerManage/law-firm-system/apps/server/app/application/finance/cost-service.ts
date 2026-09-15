import { channelScope } from '../channel/channel-scope';
import { createOnce } from './domain-mutation';
import { buildCostScopeWhere } from './cost-scope';
import { buildCaseScopeWhere } from '../case/case-scope';
// SPEC-011 Task 8: cost-service —— 成本台账 CRUD + 软删（FIN-04）。
// 形态逐段镜像 finance/invoice-service.ts（Task 5 形态母版）：3 参构造
// (prisma, actor, authorizationContext) + 可选 outbox；requireAction 每公开方法第一行；
// assertExactKeys 入参白名单；同事务 EventLog + OperationLog。差异（已批准设计决策，
// 设计 §8）：成本=财务职能数据，按 cost.* 的创建人/组织/ALL 范围授权；
// CostEntry 模型无组织列，事件信封 organizationId/branchId/teamId 恒 null（锚点
// channelId/caseId 入载荷，registry 定 sourceModule 'FINANCE'）。
// 规则（设计 §5.3/§6.1 + 协调者裁决）：
//   锚点矩阵（assertCostAnchorShape 唯一裁决者，必填先判后禁填）仅 create 强制；
//   category/channelId/caseId 创建后不可变，update 白名单仅 amount/occurredAt/note +
//   version 必填（注入锚点字段即 VALIDATION_FAILED 400），矩阵恒保持无需复验。
//   存在性探针：channelId/caseId 提供时 findFirst 探 Channel/Case 行，不存在 →
//   VALIDATION_FAILED 400（沿 master-data 探针形态，不过滤软删）。
//   乐观锁（沿 master-data 先例）：update 事务内探查（deletedAt null，COST_NOT_FOUND
//   404）→ updateMany {id, version} → count=0 → 重读：存在且未软删 → VERSION_CONFLICT
//   409；不存在/已软删 → COST_NOT_FOUND 404（先存在性后版本）。
//   软删：delete 事务内探查 → updateMany {id, deletedAt:null} → deletedAt=now、
//   version+1；count=0 → COST_NOT_FOUND 404（含二次 delete）；软删后 get 404 list 不见。
//   审计标识符-only：create 落 costEntryId/category/amount toFixed(2)/hasNote 布尔；
//   update 落 costEntryId/category/changedFields 字段名集合（不落新值文本）；delete 恰
//   costEntryId+category；note 自由文本落行不落审计。
//   事件：cost.created 恰 4 键 {costEntryId, category, channelId, caseId}；
//   cost.updated/deleted 恰 2 键 {costEntryId, category}（均 v1）。

import { randomUUID } from 'node:crypto';

import { CostEntry, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import {
  COST_CREATED,
  COST_DELETED,
  COST_UPDATED,
  CostCreatedV1,
  CostDeletedV1,
  CostUpdatedV1,
  EventEnvelopeInput,
} from '../../domain/events/event-types';
import { FINANCE_ERROR_CODES, FinanceError } from '../../domain/finance/finance-errors';
import { assertCostAnchorShape } from '../../domain/finance/finance-policy';
import { COST_CATEGORIES, CostCategory } from '../../domain/finance/finance-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
  parseIsoDate,
} from '../../domain/master-data/master-data-validation';
import {
  CreateCostEntryInput,
  ListCostEntriesQuery,
  PagedResult,
  UpdateCostEntryInput,
} from './finance-types';
import { CostEntryView, projectCostEntry } from './finance-projection';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
// schema amount 为 Decimal(18,2)：16 位整数 + 2 位小数上限（D3 先例）。
const MAX_COST_AMOUNT = '9999999999999999.99';

export class CostService {
  private readonly authorization: AuthorizationService;
  private readonly outbox: EventOutboxWriter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
    outbox?: EventOutboxWriter,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
    this.outbox = outbox ?? new PrismaEventOutboxWriter();
  }

  /**
   * 成本登记：cost.create → 规范化（金额>0、scale≤2、≤Decimal(18,2) 上限；occurredAt
   * parseIsoDate；note 可空 ≤500）→ 锚点矩阵 assertCostAnchorShape（唯一裁决者，必填
   * 先判后禁填，违反 COST_ANCHOR_REQUIRED/FORBIDDEN 400）→ channelId/caseId 存在性
   * 探针（提供时 findFirst Channel/Case，不存在 VALIDATION_FAILED 400）→ 事务内建档
   * （createdBy 落列）→ 同事务 cost.created v1（恰 4 键）+ OperationLog COST_CREATE
   * （costEntryId/category/amount toFixed(2)/hasNote 布尔——note 自由文本落行不落审计）。
   */
  async createCostEntry(input: CreateCostEntryInput): Promise<CostEntryView> {
    this.authorization.requireAction(this.authorizationContext, 'cost.create');
    assertExactKeys(input, [
      'category',
      'amount',
      'occurredAt',
      'note',
      'channelId',
      'caseId',
      'idempotencyKey',
    ]);
    const idempotencyKey = normalizeOptionalText(input.idempotencyKey, 100);
    const scopeWhere = await buildCostScopeWhere(this.prisma, this.authorizationContext, 'cost.create');
    const amount = normalizeCostAmount(input.amount);
    const occurredAt = parseIsoDate(input.occurredAt);
    const note = normalizeOptionalText(input.note, 500);
    const channelId = normalizeOptionalText(input.channelId, 100);
    const caseId = normalizeOptionalText(input.caseId, 100);
    assertCostAnchorShape(input.category, channelId, caseId);
    if (channelId !== null) {
      const channel =
        this.authorizationContext.permissionCodes.includes('channel.read') &&
        (await this.prisma.channel.findFirst({
          where: {
            AND: [
              { id: channelId },
              await channelScope(this.prisma, this.authorizationContext, 'channel.read'),
            ],
          },
        }));
      if (!channel) throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    if (caseId !== null) {
      const anchoredCase =
        this.authorizationContext.permissionCodes.includes('case.read') &&
        (await this.prisma.case.findFirst({
          where: {
            AND: [
              { id: caseId },
              await buildCaseScopeWhere(this.prisma, this.authorizationContext, 'case.read'),
            ],
          },
        }));
      if (!anchoredCase) throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    return createOnce(
      this.prisma,
      {
        actorId: this.actor.actorUserId,
        key: idempotencyKey,
        operation: 'cost.create',
        normalized: {
          category: input.category,
          amount: amount.toFixed(2),
          occurredAt,
          note,
          channelId,
          caseId,
        },
      },
      async (tx) => {
        const entry = await tx.costEntry.create({
          data: {
            category: input.category,
            amount,
            occurredAt,
            note,
            channelId,
            caseId,
            createdBy: this.actor.actorUserId,
          },
        });
        if (
          !(await tx.costEntry.findFirst({
            where: { AND: [scopeWhere, { id: entry.id }] },
            select: { id: true },
          }))
        )
          throw new FinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404, 'cost entry not found');
        const payload: CostCreatedV1 = {
          costEntryId: entry.id,
          category: entry.category as CostCategory,
          channelId: entry.channelId,
          caseId: entry.caseId,
        };
        await this.outbox.append(tx, this.envelope(entry.id, payload, COST_CREATED));
        await tx.operationLog.create({
          data: {
            userId: this.actor.actorUserId,
            action: 'COST_CREATE',
            targetType: 'COST_ENTRY',
            targetId: entry.id,
            // 审计只落标识符+金额+hasNote 布尔：note 自由文本落行不落审计。
            newValues: JSON.stringify({
              costEntryId: entry.id,
              category: entry.category,
              amount: entry.amount.toFixed(2),
              hasNote: entry.note !== null,
            }),
            ip: this.actor.ip,
          },
        });
        return projectCostEntry(entry);
      },
      async (tx, targetId) => projectCostEntry(await this.probeCostEntry(tx, targetId, scopeWhere)),
    );
  }

  /**
   * 成本列表：cost.read + deletedAt null 恒过滤 + category（normalizeAllowedValue）/
   * channelId/caseId 直过滤 + 分页（形态镜像 listInvoices——page 默认 1、pageSize
   * 默认 20 上限 100、createdAt DESC id ASC 决胜）。列表与直链均应用当前 cost.read 范围。
   */
  async listCostEntries(query: ListCostEntriesQuery): Promise<PagedResult<CostEntryView>> {
    this.authorization.requireAction(this.authorizationContext, 'cost.read');
    assertExactKeys(query, ['page', 'pageSize', 'category', 'channelId', 'caseId']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);

    const filters: Prisma.CostEntryWhereInput[] = [
      { deletedAt: null },
      await buildCostScopeWhere(this.prisma, this.authorizationContext, 'cost.read'),
    ];
    if (query.category !== undefined) {
      filters.push({ category: normalizeAllowedValue(query.category, COST_CATEGORIES) });
    }
    const channelId = normalizeOptionalText(query.channelId, 100);
    if (channelId) filters.push({ channelId });
    const caseId = normalizeOptionalText(query.caseId, 100);
    if (caseId) filters.push({ caseId });

    const where: Prisma.CostEntryWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.costEntry.count({ where }),
      this.prisma.costEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map(projectCostEntry),
      page,
      pageSize,
      total,
    };
  }

  /**
   * 成本详情：cost.read + deletedAt null 过滤；不存在/已软删统一 COST_NOT_FOUND 404
   * 不泄露存在性。
   */
  async getCostEntry(id: string): Promise<CostEntryView> {
    this.authorization.requireAction(this.authorizationContext, 'cost.read');
    const costId = normalizeRequiredText(id, 1, 100);
    const entry = await this.prisma.costEntry.findFirst({
      where: {
        AND: [
          { id: costId, deletedAt: null },
          await buildCostScopeWhere(this.prisma, this.authorizationContext, 'cost.read'),
        ],
      },
    });
    if (!entry) {
      throw new FinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404, 'cost entry not found');
    }
    return projectCostEntry(entry);
  }

  /**
   * 成本更新：cost.update → 白名单 assertExactKeys（仅 amount/occurredAt/note/version——
   * category/channelId/caseId 创建后不可变，注入即 VALIDATION_FAILED 400）→ 事务内
   * 探查（deletedAt null，COST_NOT_FOUND 404）→ version 必填 + 提供字段规范化（至少
   * 一个可变字段，沿 position-service 空更新拒绝先例）→ updateMany {id, version}
   * （仅提供字段 + updatedBy + version+1；count=0 → 重读：存在且未软删 →
   * VERSION_CONFLICT 409，不存在/已软删 → COST_NOT_FOUND 404——先存在性后版本，沿
   * master-data 乐观锁先例）→ cost.updated v1（恰 2 键）+ OperationLog COST_UPDATE
   * （costEntryId/category/changedFields 字段名集合——新值文本不落审计）→ 重读投影。
   * 锚点矩阵不在此复验：锚点字段不可变，create 已强制，矩阵恒保持。
   */
  async updateCostEntry(id: string, input: UpdateCostEntryInput): Promise<CostEntryView> {
    this.authorization.requireAction(this.authorizationContext, 'cost.update');
    assertExactKeys(input, ['amount', 'occurredAt', 'note', 'version']);
    const costId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await buildCostScopeWhere(this.prisma, this.authorizationContext, 'cost.update');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cost_entry WHERE id = ${costId} FOR UPDATE`;
      const before = await this.probeCostEntry(tx, costId, scopeWhere);
      const version = normalizeNonNegativeInteger(input.version);
      const data: Prisma.CostEntryUpdateManyMutationInput = {
        updatedBy: this.actor.actorUserId,
        version: { increment: 1 },
      };
      const changedFields: string[] = [];
      if (input.amount !== undefined) {
        data.amount = normalizeCostAmount(input.amount);
        changedFields.push('amount');
      }
      if (input.occurredAt !== undefined) {
        data.occurredAt = parseIsoDate(input.occurredAt);
        changedFields.push('occurredAt');
      }
      if (input.note !== undefined) {
        data.note = normalizeOptionalText(input.note, 500);
        changedFields.push('note');
      }
      if (changedFields.length === 0) {
        throw new MasterDataError('VALIDATION_FAILED', 400);
      }

      const updated = await tx.costEntry.updateMany({ where: { id: before.id, version }, data });
      if (updated.count === 0) {
        const current = await tx.costEntry.findFirst({ where: { id: before.id } });
        if (!current || current.deletedAt !== null) {
          throw new FinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404, 'cost entry not found');
        }
        throw new MasterDataError('VERSION_CONFLICT', 409);
      }

      const payload: CostUpdatedV1 = {
        costEntryId: before.id,
        category: before.category as CostCategory,
      };
      await this.outbox.append(tx, this.envelope(before.id, payload, COST_UPDATED));
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'COST_UPDATE',
          targetType: 'COST_ENTRY',
          targetId: before.id,
          // 审计只落变更字段名集合（规范化顺序恒 amount/occurredAt/note），新值文本不落。
          newValues: JSON.stringify({
            costEntryId: before.id,
            category: before.category,
            changedFields,
          }),
          ip: this.actor.ip,
        },
      });
      const after = await tx.costEntry.findUniqueOrThrow({ where: { id: before.id } });
      return projectCostEntry(after);
    });
  }

  /**
   * 成本删除（软删）：cost.delete → 事务内探查（deletedAt null，COST_NOT_FOUND 404）
   * → updateMany {id, deletedAt:null} → deletedAt=now、updatedBy、version+1（count=0
   * → COST_NOT_FOUND 404，含二次 delete）→ cost.deleted v1（恰 2 键）+ OperationLog
   * COST_DELETE（恰 costEntryId+category）。软删后 get 404、list 不见（读面 deletedAt
   * null 恒过滤）。
   */
  async deleteCostEntry(id: string): Promise<{ id: string }> {
    this.authorization.requireAction(this.authorizationContext, 'cost.delete');
    const costId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await buildCostScopeWhere(this.prisma, this.authorizationContext, 'cost.delete');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cost_entry WHERE id = ${costId} FOR UPDATE`;
      const before = await this.probeCostEntry(tx, costId, scopeWhere);
      const flipped = await tx.costEntry.updateMany({
        where: { id: before.id, deletedAt: null },
        data: {
          deletedAt: new Date(),
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (flipped.count === 0) {
        throw new FinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404, 'cost entry not found');
      }

      const payload: CostDeletedV1 = {
        costEntryId: before.id,
        category: before.category as CostCategory,
      };
      await this.outbox.append(tx, this.envelope(before.id, payload, COST_DELETED));
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'COST_DELETE',
          targetType: 'COST_ENTRY',
          targetId: before.id,
          newValues: JSON.stringify({
            costEntryId: before.id,
            category: before.category,
          }),
          ip: this.actor.ip,
        },
      });
      return { id: before.id };
    });
  }

  /** 软删感知探查：不存在/已软删统一 COST_NOT_FOUND 404 不泄露存在性。 */
  private async probeCostEntry(
    tx: Prisma.TransactionClient,
    costId: string,
    scopeWhere: Prisma.CostEntryWhereInput,
  ): Promise<CostEntry> {
    const entry = await tx.costEntry.findFirst({
      where: { AND: [{ id: costId, deletedAt: null }, scopeWhere] },
    });
    if (!entry) {
      throw new FinanceError(FINANCE_ERROR_CODES.COST_NOT_FOUND, 404, 'cost entry not found');
    }
    return entry;
  }

  /**
   * 事件信封：organizationId/branchId/teamId 恒 null——成本无合同锚、CostEntry 模型
   * 无组织列（锚点 channelId/caseId 入载荷）；sourceModule 由 registry 钉 'FINANCE'。
   */
  private envelope(
    objectId: string,
    payload: CostCreatedV1 | CostUpdatedV1 | CostDeletedV1,
    eventType: string,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType: 'COST_ENTRY',
      objectId,
      operatorUserId: this.actor.actorUserId,
      organizationId: null,
      branchId: null,
      teamId: null,
      payload,
      traceId: this.actor.requestId ?? randomUUID(),
      occurredAt: new Date(),
    };
  }
}

/**
 * 成本金额入参：必填、>0、scale≤2、不超 Decimal(18,2) 精度（本地镜像
 * invoice-service normalizeInvoiceAmount 纪律——本项目惯例每服务各持一份，
 * 不 import 别件）。
 */
function normalizeCostAmount(value: unknown): Prisma.Decimal {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(value);
  } catch {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  if (!amount.isFinite() || amount.isNegative() || amount.isZero() || amount.decimalPlaces() > 2) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  if (amount.greaterThan(MAX_COST_AMOUNT)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return amount;
}

function normalizePage(value: unknown): number {
  if (value === undefined) return 1;
  const page = normalizeNonNegativeInteger(value);
  if (page < 1) throw new MasterDataError('VALIDATION_FAILED', 400);
  return page;
}

function normalizePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  const pageSize = normalizeNonNegativeInteger(value);
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new MasterDataError('VALIDATION_FAILED', 400);
  return pageSize;
}
