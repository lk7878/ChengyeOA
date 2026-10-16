import { crmTransaction } from '../crm/crm-transaction';
// SPEC-009 Task 8: customer-service —— 客户主数据 + 联系人（ContactService 内联，决策 15）。
// 事务边界（设计 §6.2）：业务写入、EventLog（outbox append）、OperationLog 全部同事务。
// 动作权限：customer.read/create/update/delete；customer.merge 不实现（无方法、无路由）。
//   每个公开方法首条语句即 AuthorizationService.requireAction。
// 数据范围（决策 11）：Customer 无组织列——resolveScopeTargets(context,'customer',code) 取
//   三分量后锚定：SELF/员工维度 → createdBy = context.userId（与 lead-service 写 createdBy
//   同一身份串 actorUserId）；TEAM → sourceLead.professionalTeamId；BRANCH/ORG →
//   sourceLead.branchId（组织子树展开）；ALL → 不过滤。sourceLeadId=null 的客户仅命中
//   SELF-createdBy 谓词与 ALL。多范围 OR 并集，零谓词 fail-closed；越权一律
//   LEAD_NOT_FOUND(404)（错误码表无 CUSTOMER_NOT_FOUND，按决策复用），不泄露存在性。
// 直建（决策 12）：normalizePhone+hashPhone 双写；customerNo=makeBusinessNo('CU')；status 默认
//   POTENTIAL（提供则校验 CUSTOMER_STATUS）；sourceLeadId 恒 null（转化路径 lead-service
//   convertToCustomer 独占写入）；直建不做去重拦截。同事务发 customer.created v1。
// 更新（决策 13）：version 乐观锁（updateMany where {id,version} → VERSION_CONFLICT 409）；
//   仅更新提供字段；phone 变更重算 phone+phoneHash。
// 读取（决策 14）：范围 + customer-projection 脱敏（customer.read 锚定 customer.phone/
//   customer.wechat 字段能力）+ 明文实际输出时 auditRawL3Access（purpose 'customer.read'；
//   列表 targetId 'LIST' 哨兵）。
// 联系人（决策 15）：add/update/remove=customer.update，list=customer.read；电话 normalize+
//   hash 双写；@@unique([customerId,phoneHash]) P2002 → VALIDATION_FAILED(409)；
//   isPrimary=true 同事务清除该客户其他联系人主标记；removeContact 软删（deletedAt）；
//   listContacts 排除软删按 createdAt ASC（id ASC 决胜）；电话/wechat 按 customer.read
//   字段能力脱敏，明文输出时同样落 READ_L3_FIELDS。
// 审计：OperationLog 只落安全字段（customerNo/name/status/字段键名等），禁止 phone/wechat/
//   remark 自由文本。customerNo 碰撞 P2002 重试上限 2（同 lead-service 纪律）。

import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { FieldProjectionService } from '../authorization/field-projection-service';
import { buildCustomerVisibilityWhere } from '../contract/contract-scope';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { CrmError, CUSTOMER_IN_USE, LEAD_NOT_FOUND } from '../../domain/crm/lead-errors';
import { hashPhone, normalizePhone } from '../../domain/crm/lead-policy';
import {
  CUSTOMER_CREATED,
  CUSTOMER_STATUS,
  CustomerCreatedV1,
  CustomerStatus,
  EventEnvelopeInput,
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
import { auditRawL3Access } from './lead-audit';
import { makeBusinessNo } from './business-no';
import {
  ContactView,
  CustomerFieldPermissions,
  projectContact,
  projectCustomer,
} from './customer-projection';
import { CustomerMetrics, CUSTOMER_TYPES, CustomerType, CustomerView, PagedResult } from './lead-types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const BUSINESS_NO_RETRY_LIMIT = 2;

const CUSTOMER_READ_PURPOSE = 'customer.read';

export type { ContactView } from './customer-projection';

export interface CreateCustomerInput {
  name: string;
  phone: string;
  wechat?: string;
  email?: string;
  address?: string;
  customerType?: CustomerType;
  status?: CustomerStatus;
  tags?: string;
  remark?: string;
}

export interface UpdateCustomerInput {
  version?: number;
  name?: string;
  phone?: string;
  wechat?: string;
  email?: string;
  address?: string;
  customerType?: CustomerType;
  status?: CustomerStatus;
  tags?: string;
  remark?: string;
}

export interface CustomerListQuery {
  page?: number;
  pageSize?: number;
  status?: CustomerStatus;
  customerType?: CustomerType;
  keyword?: string;
}

export interface AddContactInput {
  name: string;
  phone: string;
  wechat?: string;
  relation?: string;
  isPrimary?: boolean;
}

export interface UpdateContactInput {
  name?: string;
  phone?: string;
  wechat?: string;
  relation?: string;
  isPrimary?: boolean;
}

export class CustomerService {
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

  /**
   * 直建客户（决策 12）：customer.create 权限 → 规范化（电话双写 hash）→ 同事务建档 +
   * customer.created v1（sourceLeadId 恒 null）+ OperationLog。customerNo 碰撞重试一次。
   */
  async createCustomer(input: CreateCustomerInput): Promise<CustomerView> {
    this.authorization.requireAction(this.authorizationContext, 'customer.create');
    assertExactKeys(input, [
      'name',
      'phone',
      'wechat',
      'email',
      'address',
      'customerType',
      'status',
      'tags',
      'remark',
    ]);
    const name = normalizeName(input.name);
    const phone = normalizePhone(input.phone);
    const phoneHash = hashPhone(phone);
    const wechat = normalizeOptionalText(input.wechat, 100);
    const email = normalizeOptionalText(input.email, 200);
    const address = normalizeOptionalText(input.address, 500);
    const customerType =
      input.customerType === undefined
        ? 'INDIVIDUAL'
        : normalizeAllowedValue(input.customerType, CUSTOMER_TYPES);
    const status =
      input.status === undefined ? 'POTENTIAL' : normalizeAllowedValue(input.status, CUSTOMER_STATUS);
    const tags = normalizeOptionalText(input.tags, 500);
    const remark = normalizeOptionalText(input.remark, 500);

    for (let attempt = 0; attempt < BUSINESS_NO_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma
          .$transaction(async (tx) => {
            const customer = await tx.customer.create({
              data: {
                customerNo: makeBusinessNo('CU'),
                name,
                phone,
                phoneHash,
                wechat,
                email,
                address,
                status,
                customerType,
                // 决策 12：sourceLeadId 转化路径独占，直建恒 null。
                sourceLeadId: null,
                tags,
                remark,
                createdBy: this.actor.actorUserId,
              },
            });
            const payload: CustomerCreatedV1 = {
              customerId: customer.id,
              sourceLeadId: null,
              status: customer.status as CustomerStatus,
            };
            await this.outbox.append(tx, this.envelope(customer.id, payload));
            await tx.operationLog.create({
              data: {
                userId: this.actor.actorUserId,
                action: 'CUSTOMER_CREATE',
                targetType: 'CUSTOMER',
                targetId: customer.id,
                // 审计只落安全字段：禁止 phone/wechat/remark 自由文本。
                newValues: JSON.stringify({
                  customerNo: customer.customerNo,
                  name: customer.name,
                  status: customer.status,
                  customerType: customer.customerType,
                }),
                ip: this.actor.ip,
              },
            });
            return customer;
          })
          .then((created) => projectCustomer(created, this.customerFieldPermissions()));
      } catch (error) {
        if (attempt + 1 < BUSINESS_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'customerNo')) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /**
   * 更新客户（决策 13）：customer.update 权限 + 范围（不可见 404）→ version 乐观锁写回
   * 仅提供字段；phone 变更重算 phone+phoneHash；OperationLog 记录变更字段键名。
   */
  async updateCustomer(customerId: string, input: UpdateCustomerInput, transaction?: Prisma.TransactionClient): Promise<CustomerView> {
    this.authorization.requireAction(this.authorizationContext, 'customer.update');
    const id = normalizeRequiredText(customerId, 1, 100);
    assertExactKeys(input, [
      'name',
      'phone',
      'wechat',
      'email',
      'address',
      'customerType',
      'status',
      'tags',
      'remark',
      'version',
    ]);
    const version = input.version === undefined ? undefined : normalizeCustomerVersion(input.version);

    const data: Prisma.CustomerUncheckedUpdateInput = {};
    const updatedFields: string[] = [];
    if (input.name !== undefined) {
      data.name = normalizeName(input.name);
      updatedFields.push('name');
    }
    if (input.phone !== undefined) {
      const phone = normalizePhone(input.phone);
      data.phone = phone;
      data.phoneHash = hashPhone(phone);
      updatedFields.push('phone');
    }
    if (input.wechat !== undefined) {
      data.wechat = normalizeOptionalText(input.wechat, 100);
      updatedFields.push('wechat');
    }
    if (input.email !== undefined) {
      data.email = normalizeOptionalText(input.email, 200);
      updatedFields.push('email');
    }
    if (input.address !== undefined) {
      data.address = normalizeOptionalText(input.address, 500);
      updatedFields.push('address');
    }
    if (input.customerType !== undefined) {
      data.customerType = normalizeAllowedValue(input.customerType, CUSTOMER_TYPES);
      updatedFields.push('customerType');
    }
    if (input.status !== undefined) {
      data.status = normalizeAllowedValue(input.status, CUSTOMER_STATUS);
      updatedFields.push('status');
    }
    if (input.tags !== undefined) {
      data.tags = normalizeOptionalText(input.tags, 500);
      updatedFields.push('tags');
    }
    if (input.remark !== undefined) {
      data.remark = normalizeOptionalText(input.remark, 500);
      updatedFields.push('remark');
    }
    const scopeWhere = await this.buildCustomerScopeWhere('customer.update');

    return crmTransaction(this.prisma, transaction, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { AND: [scopeWhere, { id, deletedAt: null }] },
      });
      if (!customer) throw new CrmError(LEAD_NOT_FOUND, 404, 'customer not found');
      if (version !== undefined && version !== customer.version)
        throw new MasterDataError('VERSION_CONFLICT', 409);

      const changed = await tx.customer.updateMany({
        where: { id: customer.id, version: customer.version, deletedAt: null },
        data: { ...data, updatedBy: this.actor.actorUserId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CUSTOMER_UPDATE',
          targetType: 'CUSTOMER',
          targetId: customer.id,
          // 审计只落字段键名，不落任何值（phone/wechat/remark 值均敏感）。
          newValues: JSON.stringify({ customerNo: customer.customerNo, updatedFields: updatedFields.sort() }),
          ip: this.actor.ip,
        },
      });
      const after = await tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
      return projectCustomer(after, this.customerFieldPermissions());
    });
  }

  /** SPEC-CUSTOMER-CRUD-20260914：软删除、业务关联保护与审计使用同一事务。 */
  async deleteCustomer(customerId: string, input: { version: number }, transaction?: Prisma.TransactionClient): Promise<void> {
    this.authorization.requireAction(this.authorizationContext, 'customer.delete');
    const id = normalizeRequiredText(customerId, 1, 100);
    assertExactKeys(input, ['version']);
    const version = normalizeCustomerVersion(input.version);
    const scopeWhere = await this.buildCustomerScopeWhere('customer.delete');
    await crmTransaction(this.prisma, transaction, async (tx) => {
      const visible = await tx.customer.findFirst({ where: { AND: [scopeWhere, { id, deletedAt: null }] } });
      if (!visible) throw new CrmError(LEAD_NOT_FOUND, 404, 'customer not found');
      await tx.$queryRaw`SELECT id FROM customer WHERE id = ${id} FOR UPDATE`;
      const customer = await tx.customer.findFirst({
        where: { AND: [scopeWhere, { id, deletedAt: null }] },
        include: {
          _count: {
            select: {
              referrals: true,
              cases: true,
              contracts: true,
              payments: true,
              negotiations: true,
              analysisEngagements: true,
              invoiceRequests: true,
              refundRequests: true,
            },
          },
        },
      });
      if (!customer) throw new CrmError(LEAD_NOT_FOUND, 404, 'customer not found');
      if (customer.version !== version) throw new MasterDataError('VERSION_CONFLICT', 409);
      if (customer.sourceLeadId || Object.values(customer._count).some((count) => count > 0)) {
        throw new CrmError(CUSTOMER_IN_USE, 409, '客户已关联业务记录，无法删除');
      }
      const deletedAt = new Date();
      const changed = await tx.customer.updateMany({
        where: { id, version, deletedAt: null },
        data: { deletedAt, updatedBy: this.actor.actorUserId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);
      await tx.contact.updateMany({ where: { customerId: id, deletedAt: null }, data: { deletedAt } });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CUSTOMER_DELETE',
          targetType: 'CUSTOMER',
          targetId: id,
          newValues: JSON.stringify({ customerNo: customer.customerNo, version }),
          ip: this.actor.ip,
        },
      });
    });
  }

  /** 客户详情（决策 14）：范围 + 脱敏投影；明文实际输出时落 READ_L3_FIELDS。 */
  async getCustomer(customerId: string): Promise<CustomerView> {
    this.authorization.requireAction(this.authorizationContext, 'customer.read');
    const id = normalizeRequiredText(customerId, 1, 100);
    const scopeWhere = await this.buildCustomerScopeWhere('customer.read');
    const customer = await this.prisma.customer.findFirst({
      where: { AND: [scopeWhere, { id, deletedAt: null }] },
    });
    if (!customer) throw new CrmError(LEAD_NOT_FOUND, 404, 'customer not found');
    const fieldPermissions = this.customerFieldPermissions();
    await auditRawL3Access(
      this.prisma,
      this.actor,
      'CUSTOMER',
      customer.id,
      'customer',
      fieldPermissions,
      1,
      CUSTOMER_READ_PURPOSE,
    );
    // SPEC-031 经营指标（复购 + 转介绍）注入视图。
    const metrics = await this.aggregateCustomerMetrics([customer.id]);
    return projectCustomer(customer, fieldPermissions, metrics[customer.id]);
  }

  /** 客户列表（决策 14）：范围 + 过滤 + 分页 + 脱敏；明文输出时以 'LIST' 哨兵落审计。 */
  async listCustomers(query: CustomerListQuery): Promise<PagedResult<CustomerView>> {
    this.authorization.requireAction(this.authorizationContext, 'customer.read');
    assertExactKeys(query, ['page', 'pageSize', 'status', 'customerType', 'keyword']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildCustomerScopeWhere('customer.read');

    const filters: Prisma.CustomerWhereInput[] = [scopeWhere, { deletedAt: null }];
    if (query.status !== undefined)
      filters.push({ status: normalizeAllowedValue(query.status, CUSTOMER_STATUS) });
    if (query.customerType !== undefined) {
      filters.push({ customerType: normalizeAllowedValue(query.customerType, CUSTOMER_TYPES) });
    }
    const keyword = normalizeOptionalText(query.keyword, 100);
    if (keyword) {
      const keywordOr: Prisma.CustomerWhereInput[] = [
        { name: { contains: keyword } },
        { customerNo: { contains: keyword } },
      ];
      try {
        keywordOr.push({ phoneHash: hashPhone(normalizePhone(keyword)) });
      } catch {
        // 关键字不是合法电话：跳过 hash 精确匹配，仅按名称/编号模糊。
      }
      filters.push({ OR: keywordOr });
    }

    const where: Prisma.CustomerWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const fieldPermissions = this.customerFieldPermissions();
    await auditRawL3Access(
      this.prisma,
      this.actor,
      'CUSTOMER',
      'LIST',
      'customer',
      fieldPermissions,
      rows.length,
      CUSTOMER_READ_PURPOSE,
    );
    // SPEC-031 经营指标（复购 + 转介绍）——分页批量聚合。
    const metricsMap = await this.aggregateCustomerMetrics(rows.map((row) => row.id));
    return {
      list: rows.map((row) => projectCustomer(row, fieldPermissions, metricsMap[row.id])),
      page,
      pageSize,
      total,
    };
  }

  /**
   * SPEC-031 客户经营指标批量聚合：合同 count + min/max createdAt（deletedAt null）、
   * 线索 referralCustomerId count——复购数 = max(0, contractCount-1)（首单后每单为复购）。
   * 缺省零值（无合同/无转介绍）；customerIds 空 → 空 map。
   */
  private async aggregateCustomerMetrics(customerIds: string[]): Promise<Record<string, CustomerMetrics>> {
    const result: Record<string, CustomerMetrics> = {};
    for (const id of customerIds) {
      result[id] = {
        contractCount: 0,
        repurchaseCount: 0,
        referralCount: 0,
        firstContractAt: null,
        latestContractAt: null,
      };
    }
    if (customerIds.length === 0) return result;

    const [contracts, referrals] = await Promise.all([
      this.prisma.contract.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, deletedAt: null },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.prisma.lead.groupBy({
        by: ['referralCustomerId'],
        where: { referralCustomerId: { in: customerIds } },
        _count: { _all: true },
      }),
    ]);

    for (const contract of contracts) {
      const entry = result[contract.customerId];
      if (!entry) continue;
      entry.contractCount = contract._count._all;
      entry.repurchaseCount = Math.max(0, contract._count._all - 1);
      entry.firstContractAt = contract._min.createdAt;
      entry.latestContractAt = contract._max.createdAt;
    }
    for (const referral of referrals) {
      const entry = referral.referralCustomerId ? result[referral.referralCustomerId] : undefined;
      if (entry) entry.referralCount = referral._count._all;
    }
    return result;
  }

  /**
   * 新增联系人（决策 15）：customer.update 权限 + 客户可见（404）→ 同事务清除其他主联系人
   * （isPrimary=true 时）→ 建档；[customerId,phoneHash] 唯一冲突 P2002 → VALIDATION_FAILED(409)。
   */
  async addContact(customerId: string, input: AddContactInput): Promise<ContactView> {
    this.authorization.requireAction(this.authorizationContext, 'customer.update');
    const id = normalizeRequiredText(customerId, 1, 100);
    assertExactKeys(input, ['name', 'phone', 'wechat', 'relation', 'isPrimary']);
    const name = normalizeName(input.name);
    const phone = normalizePhone(input.phone);
    const phoneHash = hashPhone(phone);
    const wechat = normalizeOptionalText(input.wechat, 100);
    const relation = normalizeOptionalText(input.relation, 50);
    const isPrimary = normalizeBoolean(input.isPrimary, false);
    const scopeWhere = await this.buildCustomerScopeWhere('customer.update');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { AND: [scopeWhere, { id, deletedAt: null }] },
          select: { id: true },
        });
        if (!customer) throw new CrmError(LEAD_NOT_FOUND, 404, 'customer not found');

        if (isPrimary) {
          await tx.contact.updateMany({
            where: { customerId: customer.id, deletedAt: null },
            data: { isPrimary: false },
          });
        }
        const contact = await tx.contact.create({
          data: {
            customerId: customer.id,
            name,
            phone,
            phoneHash,
            wechat,
            relation,
            isPrimary,
            createdBy: this.actor.actorUserId,
          },
        });
        await tx.operationLog.create({
          data: {
            userId: this.actor.actorUserId,
            action: 'CONTACT_CREATE',
            targetType: 'CUSTOMER',
            targetId: customer.id,
            // 审计只落安全字段：禁止 phone/wechat 明文。
            newValues: JSON.stringify({ customerId: customer.id, contactId: contact.id, isPrimary }),
            ip: this.actor.ip,
          },
        });
        return projectContact(contact, this.customerFieldPermissions());
      });
    } catch (error) {
      if (isUniqueConflictOn(error, 'phoneHash')) {
        throw new MasterDataError('VALIDATION_FAILED', 409);
      }
      throw error;
    }
  }

  /** 联系人列表（决策 15）：customer.read；排除软删，createdAt ASC（id ASC 决胜）；脱敏 + 明文审计。 */
  async listContacts(customerId: string): Promise<ContactView[]> {
    this.authorization.requireAction(this.authorizationContext, 'customer.read');
    const id = normalizeRequiredText(customerId, 1, 100);
    const scopeWhere = await this.buildCustomerScopeWhere('customer.read');
    const customer = await this.prisma.customer.findFirst({
      where: { AND: [scopeWhere, { id, deletedAt: null }] },
      select: { id: true },
    });
    if (!customer) throw new CrmError(LEAD_NOT_FOUND, 404, 'customer not found');
    const contacts = await this.prisma.contact.findMany({
      where: { customerId: customer.id, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const fieldPermissions = this.customerFieldPermissions();
    await auditRawL3Access(
      this.prisma,
      this.actor,
      'CUSTOMER',
      customer.id,
      'customer',
      fieldPermissions,
      contacts.length,
      CUSTOMER_READ_PURPOSE,
    );
    return contacts.map((contact) => projectContact(contact, fieldPermissions));
  }

  /**
   * 更新联系人（决策 15）：customer.update；同客户归属校验（404）；phone 变更重算 hash；
   * isPrimary=true 同事务清除该客户其他主标记；唯一冲突 → VALIDATION_FAILED(409)。
   */
  async updateContact(
    customerId: string,
    contactId: string,
    input: UpdateContactInput,
  ): Promise<ContactView> {
    this.authorization.requireAction(this.authorizationContext, 'customer.update');
    const id = normalizeRequiredText(customerId, 1, 100);
    const targetContactId = normalizeRequiredText(contactId, 1, 100);
    assertExactKeys(input, ['name', 'phone', 'wechat', 'relation', 'isPrimary']);

    const data: Prisma.ContactUncheckedUpdateInput = {};
    const updatedFields: string[] = [];
    if (input.name !== undefined) {
      data.name = normalizeName(input.name);
      updatedFields.push('name');
    }
    if (input.phone !== undefined) {
      const phone = normalizePhone(input.phone);
      data.phone = phone;
      data.phoneHash = hashPhone(phone);
      updatedFields.push('phone');
    }
    if (input.wechat !== undefined) {
      data.wechat = normalizeOptionalText(input.wechat, 100);
      updatedFields.push('wechat');
    }
    if (input.relation !== undefined) {
      data.relation = normalizeOptionalText(input.relation, 50);
      updatedFields.push('relation');
    }
    if (input.isPrimary !== undefined) {
      data.isPrimary = normalizeBoolean(input.isPrimary, false);
      updatedFields.push('isPrimary');
    }
    const scopeWhere = await this.buildCustomerScopeWhere('customer.update');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { AND: [scopeWhere, { id, deletedAt: null }] },
          select: { id: true },
        });
        if (!customer) throw new CrmError(LEAD_NOT_FOUND, 404, 'customer not found');
        const contact = await tx.contact.findFirst({
          where: { id: targetContactId, customerId: customer.id, deletedAt: null },
        });
        if (!contact) throw new CrmError(LEAD_NOT_FOUND, 404, 'contact not found');

        if (data.isPrimary === true) {
          await tx.contact.updateMany({
            where: { customerId: customer.id, deletedAt: null, id: { not: contact.id } },
            data: { isPrimary: false },
          });
        }
        const updated = await tx.contact.update({ where: { id: contact.id }, data });
        await tx.operationLog.create({
          data: {
            userId: this.actor.actorUserId,
            action: 'CONTACT_UPDATE',
            targetType: 'CUSTOMER',
            targetId: customer.id,
            newValues: JSON.stringify({
              customerId: customer.id,
              contactId: contact.id,
              updatedFields: updatedFields.sort(),
            }),
            ip: this.actor.ip,
          },
        });
        return projectContact(updated, this.customerFieldPermissions());
      });
    } catch (error) {
      if (isUniqueConflictOn(error, 'phoneHash')) {
        throw new MasterDataError('VALIDATION_FAILED', 409);
      }
      throw error;
    }
  }

  /** 删除联系人（决策 15）：软删（deletedAt）；不存在/已删/越权一律 404。 */
  async removeContact(customerId: string, contactId: string): Promise<void> {
    this.authorization.requireAction(this.authorizationContext, 'customer.update');
    const id = normalizeRequiredText(customerId, 1, 100);
    const targetContactId = normalizeRequiredText(contactId, 1, 100);
    const scopeWhere = await this.buildCustomerScopeWhere('customer.update');

    await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { AND: [scopeWhere, { id, deletedAt: null }] },
        select: { id: true },
      });
      if (!customer) throw new CrmError(LEAD_NOT_FOUND, 404, 'customer not found');
      const contact = await tx.contact.findFirst({
        where: { id: targetContactId, customerId: customer.id, deletedAt: null },
        select: { id: true },
      });
      if (!contact) throw new CrmError(LEAD_NOT_FOUND, 404, 'contact not found');

      await tx.contact.update({ where: { id: contact.id }, data: { deletedAt: new Date() } });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CONTACT_REMOVE',
          targetType: 'CUSTOMER',
          targetId: customer.id,
          newValues: JSON.stringify({ customerId: customer.id, contactId: contact.id }),
          ip: this.actor.ip,
        },
      });
    });
  }

  /**
   * customer 数据范围（决策 11）：Customer 无组织列——
   *   SELF/员工维度 → 实际目标员工对应账户的 createdBy；
   *   TEAM          → sourceLead.professionalTeamId IN resolution.professionalTeamIds；
   *   BRANCH/ORG    → sourceLead.branchId IN 组织子树展开 id 集；
   *   ALL           → 不过滤。
   * sourceLeadId=null 仅命中 SELF 谓词与 ALL；多范围 OR 并集；零谓词 fail-closed。
   */
  private async buildCustomerScopeWhere(permissionCode: PermissionCode): Promise<Prisma.CustomerWhereInput> {
    return buildCustomerVisibilityWhere(
      this.prisma,
      this.authorization,
      this.authorizationContext,
      permissionCode,
    );
  }

  /** customer.read 锚定的 phone/wechat 字段能力（同 lead-service customerFieldPermissions）。 */
  private customerFieldPermissions(): CustomerFieldPermissions {
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

  /** customer.created v1 信封：Customer 无组织列，branchId/teamId 恒 null。 */
  private envelope(objectId: string, payload: CustomerCreatedV1): EventEnvelopeInput {
    return {
      eventType: CUSTOMER_CREATED,
      eventVersion: 1,
      objectType: 'CUSTOMER',
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

function normalizeBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') throw new MasterDataError('VALIDATION_FAILED', 400);
  return value;
}

function normalizeCustomerVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
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
