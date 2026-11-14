import { channelScope } from '../channel/channel-scope';
import { crmTransaction } from './crm-transaction';
// SPEC-009 Task 5: lead-service —— 线索录入（去重提示）、状态流转、转客户。
// 事务边界（设计 §6.2）：业务写入与 EventLog 同事务（SPEC-007 outbox append）。
// 数据范围：SPEC-004 范围解析三分量锚定线索自身列——SELF→assignedTo、TEAM→professionalTeamId、
// BRANCH/ORG→branchId（组织子树展开）、ALL→不过滤；多范围 OR 并集，无授权范围 fail-closed；
// 未分配公海线索对本所范围可见（Task 6 公海领取前提）；越权详情返回 404 不泄露存在性。
// 动作权限：AuthorizationService.requireAction（lead.create / lead.read / lead.update / lead.convert）。
// 字段权限：lead-projection 按 FieldProjectionService.fieldCapability 的 readLevel 脱敏 L3 字段。
// 幂等设计：Lead/Customer 表无 idempotencyKey 列且本任务不加列——createLead 以 (phoneHash, createdBy)
// 为幂等身份（同一 key 的重试携带相同电话），convertToCustomer 以 leadId 为幂等身份
// （Customer.sourceLeadId 唯一）；命中既有记录直接返回，不重复写事件。
// 审计：OperationLog 只落安全字段（leadNo/customerNo/name/status 等），禁止 phone/wechat 明文。

import { randomUUID } from 'node:crypto';

import { Customer, Lead, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { FieldProjectionService } from '../authorization/field-projection-service';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import {
  CrmError,
  CUSTOMER_ALREADY_CONVERTED,
  CUSTOMER_NOT_FOUND,
  LEAD_NOT_FOUND,
  LEAD_STATE_TRANSITION_INVALID,
} from '../../domain/crm/lead-errors';
import {
  canTransition,
  findDuplicateSignals,
  hashPhone,
  hashWechat,
  LEAD_STATUS,
  LeadStatus,
  normalizePhone,
  POOL_STATUS,
  REACTIVATE_ENABLED,
} from '../../domain/crm/lead-policy';
import {
  CUSTOMER_CREATED,
  EventEnvelopeInput,
  LEAD_CREATED,
  LEAD_STATUS_CHANGED,
} from '../../domain/events/event-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeName,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import { LeadFieldPermissions, projectCustomer, projectLead } from './lead-projection';
import { auditRawL3Access } from './lead-audit';
import { makeBusinessNo } from './business-no';
import { buildLeadScopeWhere } from './lead-scope';
import {
  ConvertContactInput,
  ConvertCustomerInput,
  CreateLeadInput,
  CreateLeadResult,
  CreateReferralLeadInput,
  CUSTOMER_TYPES,
  CustomerView,
  LeadListQuery,
  LEAD_SOURCE_TYPES,
  LeadView,
  PagedResult,
} from './lead-types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
// 业务编号生成冲突时仅重试一次（设计 §10：leadNo/customerNo 为可读编号，碰撞概率极低）。
const BUSINESS_NO_RETRY_LIMIT = 2;

export class LeadService {
  private readonly authorization: AuthorizationService;
  private readonly fieldProjection: FieldProjectionService;
  private readonly outbox: EventOutboxWriter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
    outbox?: EventOutboxWriter,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
    this.fieldProjection = new FieldProjectionService();
    this.outbox = outbox ?? new PrismaEventOutboxWriter();
  }

  async createLead(
    input: CreateLeadInput,
    idempotencyKey?: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<CreateLeadResult> {
    this.authorization.requireAction(this.authorizationContext, 'lead.create');
    assertExactKeys(input, [
      'name',
      'phone',
      'wechat',
      'channelId',
      'sourceDetail',
      'sourceType',
      'campaignId',
      'referralCustomerId',
      'intentionLevel',
      'tags',
      'branchId',
      'professionalTeamId',
    ]);
    const name = normalizeName(input.name);
    const phone = normalizePhone(input.phone);
    const phoneHash = hashPhone(phone);
    const wechat = normalizeOptionalText(input.wechat, 100);
    const wechatHash = hashWechat(wechat);
    const channelId = normalizeOptionalText(input.channelId, 100);
    if (channelId) {
      const channel =
        this.authorizationContext.permissionCodes.includes('channel.read') &&
        (await (transaction ?? this.prisma).channel.findFirst({
          where: {
            AND: [
              { id: channelId },
              await channelScope(this.prisma, this.authorizationContext, 'channel.read'),
            ],
          },
          select: { id: true },
        }));
      if (!channel) throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    const sourceDetail = normalizeOptionalText(input.sourceDetail, 200);
    const sourceType =
      input.sourceType === undefined ? 'MANUAL' : normalizeAllowedValue(input.sourceType, LEAD_SOURCE_TYPES);
    const campaignId = normalizeOptionalText(input.campaignId, 100);
    const referralCustomerId = normalizeOptionalText(input.referralCustomerId, 100);
    const intentionLevel =
      input.intentionLevel === undefined ? 3 : normalizeIntentionLevel(input.intentionLevel);
    const tags = normalizeOptionalText(input.tags, 500);
    const branchId = normalizeOptionalText(input.branchId, 100);
    const professionalTeamId = normalizeOptionalText(input.professionalTeamId, 100);
    const idempotency = normalizeOptionalText(idempotencyKey, 200);

    // 诚实幂等（本任务不加幂等表列）：同一 idempotencyKey 的重试携带相同电话，
    // 以 (phoneHash, createdBy) 作为幂等身份；命中即返回首次记录，duplicates 置空、不再写事件。
    if (idempotency) {
      const existing = await this.prisma.lead.findFirst({
        where: { phoneHash, createdBy: this.actor.actorUserId, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (existing) {
        return { lead: projectLead(existing, this.leadFieldPermissions()), duplicates: [] };
      }
    }

    // 去重只读探测在创建事务之前（设计 §9：phoneHash/wechatHash 精确匹配，无全表正则）。
    const candidates = await (transaction ?? this.prisma).lead.findMany({
      where: {
        deletedAt: null,
        OR: [{ phoneHash }, ...(wechatHash ? [{ wechatHash }] : []), { name }],
      },
      select: { id: true, name: true, phoneHash: true, wechatHash: true },
    });
    const duplicates = findDuplicateSignals({ name, phoneHash, wechatHash }, candidates);

    const created = await this.createLeadWithBusinessNoRetry(
      {
        name,
        phone,
        phoneHash,
        wechat,
        wechatHash,
        channelId,
        sourceDetail,
        sourceType,
        campaignId,
        referralCustomerId,
        intentionLevel,
        tags,
        branchId,
        professionalTeamId,
        status: 'NEW',
        poolStatus: 'PUBLIC',
        createdBy: this.actor.actorUserId,
      },
      transaction,
    );

    const result: CreateLeadResult = {
      lead: projectLead(created, this.leadFieldPermissions()),
      duplicates,
    };
    return result;
  }

  /** 转介绍登记：lead.create → 客户存在探针（404）→ 委托 createLead 强制 sourceType=REFERRAL + referralCustomerId 绑定（防伪造）。 */
  async createReferralLead(customerId: string, input: CreateReferralLeadInput): Promise<CreateLeadResult> {
    this.authorization.requireAction(this.authorizationContext, 'lead.create');
    const id = normalizeRequiredText(customerId, 1, 100);
    assertExactKeys(input, ['name', 'phone', 'wechat', 'intentionLevel', 'tags']);
    const customer = await this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!customer) throw new CrmError(CUSTOMER_NOT_FOUND, 404, 'customer not found');
    return this.createLead({
      name: input.name,
      phone: input.phone,
      wechat: input.wechat,
      intentionLevel: input.intentionLevel,
      tags: input.tags,
      sourceType: 'REFERRAL',
      referralCustomerId: id,
    });
  }

  async transitionStatus(
    leadId: string,
    target: LeadStatus,
    reason: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<LeadView> {
    this.authorization.requireAction(this.authorizationContext, 'lead.update');
    const targetStatus = normalizeAllowedValue(target, LEAD_STATUS);
    const transitionReason = normalizeRequiredText(reason, 1, 500);
    const scopeWhere = await this.buildLeadScopeWhere('lead.update');

    return crmTransaction(this.prisma, transaction, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { AND: [scopeWhere, { id: leadId, deletedAt: null }] },
      });
      if (!lead) throw new CrmError(LEAD_NOT_FOUND, 404, 'lead not found');
      const fromStatus = lead.status as LeadStatus;
      assertTransitionAllowed(fromStatus, targetStatus);

      const changed = await tx.lead.updateMany({
        where: { id: lead.id, version: lead.version },
        data: { status: targetStatus, updatedBy: this.actor.actorUserId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

      await this.outbox.append(
        tx,
        this.envelope(
          'LEAD',
          lead.id,
          {
            leadId: lead.id,
            fromStatus,
            toStatus: targetStatus,
          },
          lead,
          LEAD_STATUS_CHANGED,
        ),
      );
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'LEAD_STATUS_TRANSITION',
          targetType: 'LEAD',
          targetId: lead.id,
          newValues: JSON.stringify({ fromStatus, toStatus: targetStatus, reason: transitionReason }),
          ip: this.actor.ip,
        },
      });

      const after = await tx.lead.findUniqueOrThrow({ where: { id: lead.id } });
      return projectLead(after, this.leadFieldPermissions());
    });
  }

  async convertToCustomer(
    leadId: string,
    customerInput: ConvertCustomerInput,
    contactInput: ConvertContactInput,
    idempotencyKey?: string,
  ): Promise<CustomerView> {
    this.authorization.requireAction(this.authorizationContext, 'lead.convert');
    assertExactKeys(customerInput, [
      'name',
      'phone',
      'wechat',
      'email',
      'address',
      'customerType',
      'tags',
      'remark',
    ]);
    assertExactKeys(contactInput, ['name', 'phone', 'wechat', 'relation', 'isPrimary']);
    const customerName = normalizeName(customerInput.name);
    const customerPhone = normalizePhone(customerInput.phone);
    const customerWechat = normalizeOptionalText(customerInput.wechat, 100);
    const customerEmail = normalizeOptionalText(customerInput.email, 200);
    const customerAddress = normalizeOptionalText(customerInput.address, 500);
    const customerType =
      customerInput.customerType === undefined
        ? 'INDIVIDUAL'
        : normalizeAllowedValue(customerInput.customerType, CUSTOMER_TYPES);
    const customerTags = normalizeOptionalText(customerInput.tags, 500);
    const customerRemark = normalizeOptionalText(customerInput.remark, 500);
    const contactName = normalizeName(contactInput.name);
    const contactPhone = normalizePhone(contactInput.phone);
    const contactWechat = normalizeOptionalText(contactInput.wechat, 100);
    const contactRelation = normalizeOptionalText(contactInput.relation, 50);
    const contactIsPrimary = normalizeBoolean(contactInput.isPrimary, true);
    const idempotency = normalizeOptionalText(idempotencyKey, 200);
    const scopeWhere = await this.buildLeadScopeWhere('lead.convert');

    // 诚实幂等：转客户的幂等身份是 leadId 本身（Customer.sourceLeadId 唯一）。
    // 带 idempotencyKey 重试时，若 lead 已 CONVERTED 且客户已落库，返回既有客户而不抛错。
    if (idempotency) {
      const converted = await this.findConvertedCustomer(leadId, scopeWhere);
      if (converted) return projectCustomer(converted, this.customerFieldPermissions());
    }

    let customer: Customer;
    try {
      customer = await this.convertWithBusinessNoRetry(
        leadId,
        scopeWhere,
        {
          name: customerName,
          phone: customerPhone,
          phoneHash: hashPhone(customerPhone),
          wechat: customerWechat,
          email: customerEmail,
          address: customerAddress,
          customerType,
          tags: customerTags,
          remark: customerRemark,
          status: 'POTENTIAL',
          createdBy: this.actor.actorUserId,
        },
        {
          name: contactName,
          phone: contactPhone,
          phoneHash: hashPhone(contactPhone),
          wechat: contactWechat,
          relation: contactRelation,
          isPrimary: contactIsPrimary,
          createdBy: this.actor.actorUserId,
        },
      );
    } catch (error) {
      // 并发下首个请求已转化成功：带幂等键的重试返回胜出的既有客户。
      if (idempotency && error instanceof CrmError && error.code === CUSTOMER_ALREADY_CONVERTED) {
        const winner = await this.findConvertedCustomer(leadId, scopeWhere);
        if (winner) return projectCustomer(winner, this.customerFieldPermissions());
      }
      throw error;
    }

    return projectCustomer(customer, this.customerFieldPermissions());
  }

  async getLead(leadId: string): Promise<LeadView> {
    this.authorization.requireAction(this.authorizationContext, 'lead.read');
    const scopeWhere = await this.buildLeadScopeWhere('lead.read');
    const lead = await this.prisma.lead.findFirst({
      where: { AND: [scopeWhere, { id: leadId, deletedAt: null }] },
    });
    if (!lead) throw new CrmError(LEAD_NOT_FOUND, 404, 'lead not found');
    const fieldPermissions = this.leadFieldPermissions();
    await this.auditRawL3Access('LEAD', lead.id, 'lead', fieldPermissions, 1, 'lead.detail');
    return projectLead(lead, fieldPermissions);
  }

  async listLeads(query: LeadListQuery): Promise<PagedResult<LeadView>> {
    this.authorization.requireAction(this.authorizationContext, 'lead.read');
    assertExactKeys(query, [
      'page',
      'pageSize',
      'status',
      'poolStatus',
      'channelId',
      'assignedTo',
      'keyword',
    ]);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildLeadScopeWhere('lead.read');

    const filters: Prisma.LeadWhereInput[] = [scopeWhere, { deletedAt: null }];
    if (query.status !== undefined)
      filters.push({ status: normalizeAllowedValue(query.status, LEAD_STATUS) });
    if (query.poolStatus !== undefined)
      filters.push({ poolStatus: normalizeAllowedValue(query.poolStatus, POOL_STATUS) });
    const channelId = normalizeOptionalText(query.channelId, 100);
    if (channelId) filters.push({ channelId });
    const assignedTo = normalizeOptionalText(query.assignedTo, 100);
    if (assignedTo) filters.push({ assignedTo });
    const keyword = normalizeOptionalText(query.keyword, 100);
    if (keyword) {
      const keywordOr: Prisma.LeadWhereInput[] = [
        { name: { contains: keyword } },
        { leadNo: { contains: keyword } },
      ];
      try {
        keywordOr.push({ phoneHash: hashPhone(normalizePhone(keyword)) });
      } catch {
        // 关键字不是合法电话：跳过 hash 精确匹配，仅按名称/编号模糊。
      }
      filters.push({ OR: keywordOr });
    }

    const where: Prisma.LeadWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const fieldPermissions = this.leadFieldPermissions();
    await this.auditRawL3Access('LEAD', 'LIST', 'lead', fieldPermissions, rows.length, 'lead.list');
    return {
      list: rows.map((row) => projectLead(row, fieldPermissions)),
      page,
      pageSize,
      total,
    };
  }

  /** 客户转介绍线索列表：lead.read → 客户存在探针（404）→ 过滤 referralCustomerId + sourceType REFERRAL + 分页。 */
  async listReferrals(customerId: string, query: LeadListQuery): Promise<PagedResult<LeadView>> {
    this.authorization.requireAction(this.authorizationContext, 'lead.read');
    const id = normalizeRequiredText(customerId, 1, 100);
    assertExactKeys(query, ['page', 'pageSize']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const customer = await this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!customer) throw new CrmError(CUSTOMER_NOT_FOUND, 404, 'customer not found');

    const where: Prisma.LeadWhereInput = { referralCustomerId: id, sourceType: 'REFERRAL', deletedAt: null };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const fieldPermissions = this.leadFieldPermissions();
    return {
      list: rows.map((row) => projectLead(row, fieldPermissions)),
      page,
      pageSize,
      total,
    };
  }

  private async createLeadWithBusinessNoRetry(
    data: Omit<Prisma.LeadUncheckedCreateInput, 'leadNo'>,
    transaction?: Prisma.TransactionClient,
  ): Promise<Lead> {
    for (let attempt = 0; attempt < BUSINESS_NO_RETRY_LIMIT; attempt += 1) {
      try {
        return await crmTransaction(this.prisma, transaction, async (tx) => {
          const lead = await tx.lead.create({ data: { ...data, leadNo: makeBusinessNo('L') } });
          await this.outbox.append(
            tx,
            this.envelope(
              'LEAD',
              lead.id,
              {
                leadId: lead.id,
                status: 'NEW' as LeadStatus,
                poolStatus: 'PUBLIC',
                channelId: lead.channelId,
              },
              lead,
              LEAD_CREATED,
            ),
          );
          await tx.operationLog.create({
            data: {
              userId: this.actor.actorUserId,
              action: 'LEAD_CREATE',
              targetType: 'LEAD',
              targetId: lead.id,
              // 审计只留安全字段：禁止 phone/wechat 明文（L3）。
              newValues: JSON.stringify({
                leadNo: lead.leadNo,
                name: lead.name,
                status: lead.status,
                poolStatus: lead.poolStatus,
                sourceType: lead.sourceType,
                channelId: lead.channelId,
              }),
              ip: this.actor.ip,
            },
          });
          return lead;
        });
      } catch (error) {
        if (!transaction && attempt + 1 < BUSINESS_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'leadNo'))
          continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  private async convertWithBusinessNoRetry(
    leadId: string,
    scopeWhere: Prisma.LeadWhereInput,
    customerData: Omit<Prisma.CustomerUncheckedCreateInput, 'customerNo' | 'sourceLeadId'>,
    contactData: Omit<Prisma.ContactUncheckedCreateInput, 'customerId'>,
  ): Promise<Customer> {
    for (let attempt = 0; attempt < BUSINESS_NO_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const lead = await tx.lead.findFirst({
            where: { AND: [scopeWhere, { id: leadId, deletedAt: null }] },
          });
          if (!lead) throw new CrmError(LEAD_NOT_FOUND, 404, 'lead not found');
          if (lead.status === 'CONVERTED') {
            throw new CrmError(CUSTOMER_ALREADY_CONVERTED, 409, 'lead already converted');
          }
          const existing = await tx.customer.findUnique({
            where: { sourceLeadId: lead.id },
            select: { id: true },
          });
          if (existing) throw new CrmError(CUSTOMER_ALREADY_CONVERTED, 409, 'lead already converted');
          assertTransitionAllowed(lead.status as LeadStatus, 'CONVERTED');

          const customer = await tx.customer.create({
            data: {
              ...customerData,
              customerNo: makeBusinessNo('C'),
              sourceLeadId: lead.id,
            },
          });
          await tx.contact.create({ data: { ...contactData, customerId: customer.id } });
          const changed = await tx.lead.updateMany({
            where: { id: lead.id, version: lead.version },
            data: { status: 'CONVERTED', updatedBy: this.actor.actorUserId, version: { increment: 1 } },
          });
          if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);
          await this.outbox.append(
            tx,
            this.envelope(
              'CUSTOMER',
              customer.id,
              {
                customerId: customer.id,
                sourceLeadId: lead.id,
                status: 'POTENTIAL',
              },
              lead,
              CUSTOMER_CREATED,
            ),
          );
          await tx.operationLog.create({
            data: {
              userId: this.actor.actorUserId,
              action: 'LEAD_CONVERT_TO_CUSTOMER',
              targetType: 'CUSTOMER',
              targetId: customer.id,
              // 审计只留安全字段：禁止 phone/wechat 明文（L3）。
              newValues: JSON.stringify({
                customerNo: customer.customerNo,
                name: customer.name,
                status: customer.status,
                customerType: customer.customerType,
                sourceLeadId: lead.id,
              }),
              ip: this.actor.ip,
            },
          });
          return customer;
        });
      } catch (error) {
        if (isUniqueConflictOn(error, 'sourceLeadId')) {
          throw new CrmError(CUSTOMER_ALREADY_CONVERTED, 409, 'lead already converted');
        }
        if (attempt + 1 < BUSINESS_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'customerNo')) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /**
   * 幂等重试探测：lead 已 CONVERTED 且客户已落库时返回该客户；其余情况（lead 不存在/
   * 未转化/已转化但客户缺失）返回 null，交由主事务流程抛出对应的稳定错误码。
   */
  private async findConvertedCustomer(
    leadId: string,
    scopeWhere: Prisma.LeadWhereInput,
  ): Promise<Customer | null> {
    const lead = await this.prisma.lead.findFirst({
      where: { AND: [scopeWhere, { id: leadId, deletedAt: null }] },
      select: { id: true, status: true },
    });
    if (!lead || lead.status !== 'CONVERTED') return null;
    return this.prisma.customer.findUnique({ where: { sourceLeadId: lead.id } });
  }

  /**
   * lead 数据范围：语义见 lead-scope 共享助手（SELF→assignedTo / TEAM→professionalTeamId /
   * BRANCH·ORG→branchId 子树 / OR 并集 / 零谓词 fail-closed）。
   * Task 6 起实现下沉到 lead-scope（行为不变），本方法仅做委托。
   */
  private async buildLeadScopeWhere(permissionCode: PermissionCode): Promise<Prisma.LeadWhereInput> {
    return buildLeadScopeWhere(this.prisma, this.authorization, this.authorizationContext, permissionCode);
  }

  /**
   * L3 明文读取审计（仿 employee-projection 的 projectAuthorizedEmployeeDetail 模板）：
   * 仅当 phone/wechat 以 READ 级明文输出时落 READ_L3_FIELDS；MASKED/NONE 输出不审计。
   * 审计内容经 sanitizeAuthorizationChanges 清洗，不含任何明文值。
   * Task 6 起实现下沉到 lead-audit 共享助手（行为不变），本方法仅做委托。
   */
  private async auditRawL3Access(
    targetType: 'LEAD' | 'CUSTOMER',
    targetId: string,
    resource: 'lead' | 'customer',
    fieldPermissions: LeadFieldPermissions,
    resultCount: number,
    purpose: string,
  ): Promise<void> {
    return auditRawL3Access(
      this.prisma,
      this.actor,
      targetType,
      targetId,
      resource,
      fieldPermissions,
      resultCount,
      purpose,
    );
  }

  private leadFieldPermissions(): LeadFieldPermissions {
    return {
      phone: this.fieldProjection.fieldCapability(
        this.authorizationContext,
        'lead',
        'lead.phone',
        'lead.read',
      ).readLevel,
      wechat: this.fieldProjection.fieldCapability(
        this.authorizationContext,
        'lead',
        'lead.wechat',
        'lead.read',
      ).readLevel,
    };
  }

  private customerFieldPermissions(): LeadFieldPermissions {
    return {
      phone: this.fieldProjection.fieldCapability(
        this.authorizationContext,
        'customer',
        'customer.phone',
        'customer.read',
      ).readLevel,
      wechat: this.fieldProjection.fieldCapability(
        this.authorizationContext,
        'customer',
        'customer.wechat',
        'customer.read',
      ).readLevel,
    };
  }

  private envelope(
    objectType: 'LEAD' | 'CUSTOMER',
    objectId: string,
    payload: unknown,
    lead: Pick<Lead, 'branchId' | 'professionalTeamId'>,
    eventType: string,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType,
      objectId,
      operatorUserId: this.actor.actorUserId,
      organizationId: null,
      branchId: lead.branchId ?? null,
      teamId: lead.professionalTeamId ?? null,
      payload,
      traceId: this.actor.requestId ?? randomUUID(),
      occurredAt: new Date(),
    };
  }
}

/** REACTIVATE_ENABLED 门禁必须先于 canTransition：false 时任何涉及 NURTURE 的流转一律拒绝。 */
function assertTransitionAllowed(fromStatus: LeadStatus, targetStatus: LeadStatus): void {
  if (!REACTIVATE_ENABLED && (fromStatus === 'NURTURE' || targetStatus === 'NURTURE')) {
    throw new CrmError(LEAD_STATE_TRANSITION_INVALID, 409, 'nurture transitions are disabled');
  }
  if (!canTransition(fromStatus, targetStatus)) {
    throw new CrmError(
      LEAD_STATE_TRANSITION_INVALID,
      409,
      `cannot transition ${fromStatus} to ${targetStatus}`,
    );
  }
}

function normalizeIntentionLevel(value: unknown): number {
  const level = normalizeNonNegativeInteger(value);
  if (level < 1 || level > 5) throw new MasterDataError('VALIDATION_FAILED', 400);
  return level;
}

function normalizeBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') throw new MasterDataError('VALIDATION_FAILED', 400);
  return value;
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
