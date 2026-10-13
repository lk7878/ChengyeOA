import { crmTransaction } from '../crm/crm-transaction';
// SPEC-010 Task 6: negotiation-service —— 谈案（CRM-07）创建/列表/详情/更新/完结。
// 事务边界（设计 §6.2）：业务写入、EventLog（outbox append）、OperationLog 全部同事务。
// 动作权限：AuthorizationService.requireAction 首行（negotiation.create/read/update；close 复用 update）。
// 数据范围（设计 §8 + 协调者裁决 4）：contract-scope.buildNegotiationScopeWhere——
//   SELF→negotiatorEmployeeId/createdBy 双锚、TEAM→professionalTeamId、BRANCH/ORG→branchId 组织子树、
//   多范围 OR 并集、零谓词 fail-closed；越权详情/更新/完结统一 NEGOTIATION_NOT_FOUND(404) 不泄露。
// 创建校验（协调者裁决 2/3）：客户存在+未删+当前操作者 customer.read 范围可见（不可见统一 404）；
//   员工存在性 4a 模式（findFirst select id，缺失 MasterDataError VALIDATION_FAILED 400）；
//   leadId 存在性同理 400。
// 组织锚解析序（协调者裁决 1，Customer 无 branchId/professionalTeamId 列）：
//   显式输入 > leadId 指向 Lead 的对应列继承 > null（公海语义）。
// 更新门禁（协调者裁决 5）：仅 NEGOTIATING 可 update，否则 CONTRACT_STATE_TRANSITION_INVALID(409)；
//   version 乐观锁（updateMany where {id,version} → VERSION_CONFLICT 409）。
// 完结（协调者裁决 6）：UNSIGNED 必填原因（VALIDATION_FAILED 400）；SIGNED 置 signedAt 且拒收
//   unsignedReason（矛盾载荷 400）；终态再完结 409；同事务 negotiation.closed（载荷仅 {negotiationId,status}）。
// 金额（协调者裁决 7）：quotedAmount 以 Prisma.Decimal 接 string/number，校验非负+scale≤2+不超
//   Decimal(18,2) 精度；视图投影 string 不脱敏（设计 §8）。
// 审计：OperationLog 只落安全字段与字段键名，禁止 customerConcerns/competitorInfo/remark/unsignedReason
//   自由文本值（同 customer-service 纪律）；negotiationNo 碰撞 P2002 重试上限 2（同 lead-service）。

import { randomUUID } from 'node:crypto';

import { Negotiation, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import {
  CONTRACT_ERROR_CODES,
  ContractError,
} from '../../domain/contract/contract-errors';
import {
  EventEnvelopeInput,
  NEGOTIATION_CREATED,
  NEGOTIATION_CLOSED,
  NEGOTIATION_STATUS,
  NegotiationCreatedV1,
  NegotiationClosedV1,
  NegotiationStatus,
} from '../../domain/events/event-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import { nextNegotiationNo } from './contract-number-service';
import { buildCustomerVisibilityWhere, buildNegotiationScopeWhere } from './contract-scope';
import {
  CloseNegotiationInput,
  CreateNegotiationInput,
  NegotiationListQuery,
  NegotiationView,
  PagedResult,
  UpdateNegotiationInput,
} from './contract-types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
// 业务编号生成冲突时仅重试一次（同 lead-service BUSINESS_NO_RETRY_LIMIT 纪律）。
const BUSINESS_NO_RETRY_LIMIT = 2;
// schema quotedAmount 为 Decimal(18,2)：16 位整数 + 2 位小数上限。
const MAX_QUOTED_AMOUNT = '9999999999999999.99';

const CLOSE_OUTCOMES = ['SIGNED', 'UNSIGNED'] as const;
type CloseOutcome = (typeof CLOSE_OUTCOMES)[number];

export class NegotiationService {
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
   * 创建谈案：negotiation.create → 规范化 → 客户可见性（customer.read 语义，404 不泄露）→
   * 员工/线索存在性（400）→ 组织锚解析（显式 > lead 继承 > null）→ 同事务建档 +
   * negotiation.created v1 + OperationLog。negotiationNo 碰撞重试一次。
   */
  async createNegotiation(input: CreateNegotiationInput): Promise<NegotiationView> {
    this.authorization.requireAction(this.authorizationContext, 'negotiation.create');
    assertExactKeys(input, [
      'customerId', 'leadId', 'appointmentId', 'negotiatorEmployeeId',
      'quotedAmount', 'customerConcerns', 'competitorInfo', 'remark',
      'branchId', 'professionalTeamId',
    ]);
    const customerId = normalizeRequiredText(input.customerId, 1, 100);
    const leadId = normalizeOptionalText(input.leadId, 100);
    const appointmentId = normalizeOptionalText(input.appointmentId, 100);
    const negotiatorEmployeeId = normalizeRequiredText(input.negotiatorEmployeeId, 1, 100);
    const quotedAmount = normalizeQuotedAmount(input.quotedAmount);
    const customerConcerns = normalizeOptionalText(input.customerConcerns, 1000);
    const competitorInfo = normalizeOptionalText(input.competitorInfo, 1000);
    const remark = normalizeOptionalText(input.remark, 500);
    const explicitBranchId = normalizeOptionalText(input.branchId, 100);
    const explicitProfessionalTeamId = normalizeOptionalText(input.professionalTeamId, 100);

    // 客户校验（协调者裁决 2）：存在 + 未删 + customer.read 范围可见；不可见统一 404 不泄露。
    const customerVisibility = await buildCustomerVisibilityWhere(
      this.prisma, this.authorization, this.authorizationContext, 'customer.read',
    );
    const visibleCustomers = await this.prisma.customer.count({
      where: { AND: [customerVisibility, { id: customerId, deletedAt: null }] },
    });
    if (visibleCustomers === 0) {
      throw new ContractError(CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND, 404, 'customer not found');
    }

    // 员工存在性校验（4a 模式）：findFirst select id，缺失 VALIDATION_FAILED 400。
    const negotiator = await this.prisma.employee.findFirst({
      where: { id: negotiatorEmployeeId },
      select: { id: true },
    });
    if (!negotiator) throw new MasterDataError('VALIDATION_FAILED', 400);

    // 邀约存在性校验（Task 10 落地 Task 6 Minor② 裁决，与 leadId 探针先例对称）：
    // appointmentId 提供时探针存在（Appointment 无 deletedAt 列，schema 实证——探针即
    // 存在性校验），伪造 VALIDATION_FAILED 400；不做归属链校验（记 closeout 已知项）。
    // update 路径不接受 appointmentId（UpdateNegotiationInput 键集冻结），探针唯此一处。
    if (appointmentId !== null) {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: appointmentId },
        select: { id: true },
      });
      if (!appointment) throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    // 组织锚解析序（协调者裁决 1）：显式输入 > leadId 指向 Lead 继承 > null（公海语义）。
    let branchId = explicitBranchId;
    let professionalTeamId = explicitProfessionalTeamId;
    if (leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, deletedAt: null },
        select: { id: true, branchId: true, professionalTeamId: true },
      });
      if (!lead) throw new MasterDataError('VALIDATION_FAILED', 400);
      branchId = branchId ?? lead.branchId;
      professionalTeamId = professionalTeamId ?? lead.professionalTeamId;
    }

    const created = await this.createWithBusinessNoRetry({
      customerId,
      leadId,
      appointmentId,
      negotiatorEmployeeId,
      quotedAmount,
      customerConcerns,
      competitorInfo,
      remark,
      branchId,
      professionalTeamId,
      status: 'NEGOTIATING',
      createdBy: this.actor.actorUserId,
    });
    return projectNegotiation(created);
  }

  /** 谈案列表：negotiation.read + 范围 + status/customerId 过滤 + 分页（createdAt DESC, id ASC 决胜）。 */
  async listNegotiations(query: NegotiationListQuery): Promise<PagedResult<NegotiationView>> {
    this.authorization.requireAction(this.authorizationContext, 'negotiation.read');
    assertExactKeys(query, ['page', 'pageSize', 'status', 'customerId']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildScopeWhere('negotiation.read');

    const filters: Prisma.NegotiationWhereInput[] = [scopeWhere, { deletedAt: null }];
    if (query.status !== undefined) {
      filters.push({ status: normalizeAllowedValue(query.status, NEGOTIATION_STATUS) });
    }
    const customerId = normalizeOptionalText(query.customerId, 100);
    if (customerId) filters.push({ customerId });

    const where: Prisma.NegotiationWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.negotiation.count({ where }),
      this.prisma.negotiation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map(projectNegotiation),
      page,
      pageSize,
      total,
    };
  }

  /** 谈案详情：negotiation.read + 范围；不存在/越权统一 404 不泄露存在性。 */
  async getNegotiation(id: string): Promise<NegotiationView> {
    this.authorization.requireAction(this.authorizationContext, 'negotiation.read');
    const negotiationId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildScopeWhere('negotiation.read');
    const negotiation = await this.prisma.negotiation.findFirst({
      where: { AND: [scopeWhere, { id: negotiationId, deletedAt: null }] },
    });
    if (!negotiation) {
      throw new ContractError(CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND, 404, 'negotiation not found');
    }
    return projectNegotiation(negotiation);
  }

  /**
   * 更新谈案：negotiation.update + 范围 → 仅 NEGOTIATING 可改（否则 409）→ version 乐观锁；
   * 仅更新提供字段；谈案人变更重验员工存在性（400）；审计只落字段键名。
   */
  async updateNegotiation(id: string, input: UpdateNegotiationInput, transaction?: Prisma.TransactionClient): Promise<NegotiationView> {
    this.authorization.requireAction(this.authorizationContext, 'negotiation.update');
    const negotiationId = normalizeRequiredText(id, 1, 100);
    assertExactKeys(input, [
      'negotiatorEmployeeId', 'quotedAmount', 'customerConcerns', 'competitorInfo', 'remark',
    ]);

    const data: Prisma.NegotiationUncheckedUpdateInput = {};
    const updatedFields: string[] = [];
    if (input.negotiatorEmployeeId !== undefined) {
      data.negotiatorEmployeeId = normalizeRequiredText(input.negotiatorEmployeeId, 1, 100);
      updatedFields.push('negotiatorEmployeeId');
    }
    if (input.quotedAmount !== undefined) {
      data.quotedAmount = normalizeQuotedAmount(input.quotedAmount);
      updatedFields.push('quotedAmount');
    }
    if (input.customerConcerns !== undefined) {
      data.customerConcerns = normalizeOptionalText(input.customerConcerns, 1000);
      updatedFields.push('customerConcerns');
    }
    if (input.competitorInfo !== undefined) {
      data.competitorInfo = normalizeOptionalText(input.competitorInfo, 1000);
      updatedFields.push('competitorInfo');
    }
    if (input.remark !== undefined) {
      data.remark = normalizeOptionalText(input.remark, 500);
      updatedFields.push('remark');
    }
    const scopeWhere = await this.buildScopeWhere('negotiation.update');

    return crmTransaction(this.prisma, transaction, async tx => {
      const negotiation = await tx.negotiation.findFirst({
        where: { AND: [scopeWhere, { id: negotiationId, deletedAt: null }] },
      });
      if (!negotiation) {
        throw new ContractError(CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND, 404, 'negotiation not found');
      }
      if (negotiation.status !== 'NEGOTIATING') {
        throw new ContractError(
          CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID,
          409,
          `cannot update negotiation in status ${negotiation.status}`,
        );
      }
      if (typeof data.negotiatorEmployeeId === 'string') {
        const negotiator = await tx.employee.findFirst({
          where: { id: data.negotiatorEmployeeId },
          select: { id: true },
        });
        if (!negotiator) throw new MasterDataError('VALIDATION_FAILED', 400);
      }

      const changed = await tx.negotiation.updateMany({
        where: { id: negotiation.id, version: negotiation.version },
        data: { ...data, updatedBy: this.actor.actorUserId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'NEGOTIATION_UPDATE',
          targetType: 'NEGOTIATION',
          targetId: negotiation.id,
          // 审计只落字段键名：customerConcerns/competitorInfo/remark 为自由文本，不落值。
          newValues: JSON.stringify({
            negotiationNo: negotiation.negotiationNo,
            updatedFields: updatedFields.sort(),
          }),
          ip: this.actor.ip,
        },
      });
      const after = await tx.negotiation.findUniqueOrThrow({ where: { id: negotiation.id } });
      return projectNegotiation(after);
    });
  }

  /**
   * 完结谈案：negotiation.update + 范围 → 仅 NEGOTIATING 可完结（终态再完结 409）→
   * UNSIGNED 必填原因（400）/ SIGNED 置 signedAt 且拒收矛盾原因（400）→ version 乐观锁 →
   * 同事务 negotiation.closed v1（载荷仅 {negotiationId,status}）+ OperationLog。
   */
  async closeNegotiation(id: string, input: CloseNegotiationInput): Promise<NegotiationView> {
    this.authorization.requireAction(this.authorizationContext, 'negotiation.update');
    const negotiationId = normalizeRequiredText(id, 1, 100);
    assertExactKeys(input, ['outcome', 'unsignedReason']);
    const outcome = normalizeAllowedValue(input.outcome, CLOSE_OUTCOMES);
    const unsignedReason = normalizeCloseReason(outcome, input.unsignedReason);
    const scopeWhere = await this.buildScopeWhere('negotiation.update');

    return this.prisma.$transaction(async tx => {
      const negotiation = await tx.negotiation.findFirst({
        where: { AND: [scopeWhere, { id: negotiationId, deletedAt: null }] },
      });
      if (!negotiation) {
        throw new ContractError(CONTRACT_ERROR_CODES.NEGOTIATION_NOT_FOUND, 404, 'negotiation not found');
      }
      if (negotiation.status !== 'NEGOTIATING') {
        throw new ContractError(
          CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID,
          409,
          `cannot close negotiation in status ${negotiation.status}`,
        );
      }

      const changed = await tx.negotiation.updateMany({
        where: { id: negotiation.id, version: negotiation.version },
        data: {
          status: outcome,
          unsignedReason,
          signedAt: outcome === 'SIGNED' ? new Date() : null,
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

      const payload: NegotiationClosedV1 = { negotiationId: negotiation.id, status: outcome };
      await this.outbox.append(tx, this.envelope(negotiation.id, payload, negotiation, NEGOTIATION_CLOSED));
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'NEGOTIATION_CLOSE',
          targetType: 'NEGOTIATION',
          targetId: negotiation.id,
          // unsignedReason 为自由文本不落值（事件载荷亦不携带，审计查库）；只落结局与原因存在性。
          newValues: JSON.stringify({
            negotiationNo: negotiation.negotiationNo,
            fromStatus: 'NEGOTIATING',
            toStatus: outcome,
            hasUnsignedReason: unsignedReason !== null,
          }),
          ip: this.actor.ip,
        },
      });
      const after = await tx.negotiation.findUniqueOrThrow({ where: { id: negotiation.id } });
      return projectNegotiation(after);
    });
  }

  private async createWithBusinessNoRetry(
    data: Omit<Prisma.NegotiationUncheckedCreateInput, 'negotiationNo'>,
  ): Promise<Negotiation> {
    for (let attempt = 0; attempt < BUSINESS_NO_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(async tx => {
          const negotiation = await tx.negotiation.create({
            data: { ...data, negotiationNo: nextNegotiationNo() },
          });
          const payload: NegotiationCreatedV1 = {
            negotiationId: negotiation.id,
            customerId: negotiation.customerId,
            negotiatorEmployeeId: negotiation.negotiatorEmployeeId,
            status: 'NEGOTIATING',
          };
          await this.outbox.append(tx, this.envelope(negotiation.id, payload, negotiation, NEGOTIATION_CREATED));
          await tx.operationLog.create({
            data: {
              userId: this.actor.actorUserId,
              action: 'NEGOTIATION_CREATE',
              targetType: 'NEGOTIATION',
              targetId: negotiation.id,
              // 审计只落安全字段：禁止 customerConcerns/competitorInfo/remark 自由文本；
              // 金额非 L3（设计 §8）可落。
              newValues: JSON.stringify({
                negotiationNo: negotiation.negotiationNo,
                customerId: negotiation.customerId,
                negotiatorEmployeeId: negotiation.negotiatorEmployeeId,
                status: negotiation.status,
                quotedAmount: formatAmount(negotiation.quotedAmount),
                branchId: negotiation.branchId,
                professionalTeamId: negotiation.professionalTeamId,
              }),
              ip: this.actor.ip,
            },
          });
          return negotiation;
        });
      } catch (error) {
        if (attempt + 1 < BUSINESS_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'negotiationNo')) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /** 谈案数据范围：语义见 contract-scope 共享助手，本方法仅做委托。 */
  private async buildScopeWhere(permissionCode: PermissionCode): Promise<Prisma.NegotiationWhereInput> {
    return buildNegotiationScopeWhere(this.prisma, this.authorization, this.authorizationContext, permissionCode);
  }

  /** 事件信封：organizationId 恒 null（同 lead-service），branchId/teamId 锚定谈案自身组织列。 */
  private envelope(
    objectId: string,
    payload: NegotiationCreatedV1 | NegotiationClosedV1,
    negotiation: Pick<Negotiation, 'branchId' | 'professionalTeamId'>,
    eventType: string,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType: 'NEGOTIATION',
      objectId,
      operatorUserId: this.actor.actorUserId,
      organizationId: null,
      branchId: negotiation.branchId ?? null,
      teamId: negotiation.professionalTeamId ?? null,
      payload,
      traceId: this.actor.requestId ?? randomUUID(),
      occurredAt: new Date(),
    };
  }
}

/** Negotiation 全字段投影：金额 Decimal→string 不脱敏（设计 §8），无 L3 字段。 */
function projectNegotiation(negotiation: Negotiation): NegotiationView {
  return {
    id: negotiation.id,
    negotiationNo: negotiation.negotiationNo,
    customerId: negotiation.customerId,
    leadId: negotiation.leadId,
    appointmentId: negotiation.appointmentId,
    negotiatorEmployeeId: negotiation.negotiatorEmployeeId,
    quotedAmount: formatAmount(negotiation.quotedAmount),
    customerConcerns: negotiation.customerConcerns,
    competitorInfo: negotiation.competitorInfo,
    status: negotiation.status as NegotiationStatus,
    unsignedReason: negotiation.unsignedReason,
    signedAt: negotiation.signedAt,
    remark: negotiation.remark,
    branchId: negotiation.branchId,
    professionalTeamId: negotiation.professionalTeamId,
    createdBy: negotiation.createdBy,
    updatedBy: negotiation.updatedBy,
    version: negotiation.version,
    createdAt: negotiation.createdAt,
    updatedAt: negotiation.updatedAt,
  };
}

/**
 * 金额投影：schema 为 Decimal(18,2)，统一钉 scale=2 输出——create 视图（内存 Decimal 可能
 * 丢尾零，如 '12800.5'）与 get/list 视图（DB 回读 scale=2）因此保持一致。
 */
function formatAmount(amount: Prisma.Decimal | null): string | null {
  return amount === null ? null : amount.toFixed(2);
}

/** quotedAmount 入参：string/number → Prisma.Decimal；非负、scale≤2、不超 Decimal(18,2) 精度。 */
function normalizeQuotedAmount(value: unknown): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(value);
  } catch {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 2) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  if (amount.greaterThan(MAX_QUOTED_AMOUNT)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return amount;
}

/** 完结原因：UNSIGNED 必填（1-500）；SIGNED 拒收非空原因（矛盾载荷 400）。 */
function normalizeCloseReason(outcome: CloseOutcome, value: unknown): string | null {
  if (outcome === 'UNSIGNED') return normalizeRequiredText(value, 1, 500);
  if (normalizeOptionalText(value, 500) !== null) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return null;
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

function isUniqueConflictOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes(field);
}
