// SPEC-009 Task 10: customer HTTP 控制器（整体替代 SPEC-001 原型）。
// 薄控制器纪律同 lead.ts：传输层解析（query 数字）→ 调冻结服务 → 包络响应；
// 联系人的电话重复冲突由服务层抛 MasterDataError('VALIDATION_FAILED', 409)，
// errorHandler 按实例 status 透传 409（不切换 code 字符串）。
// 路由面（R-10f + 用户裁决 C1 增量）：CRUD + contacts 查/增/改/删；跨模块只读子资源
// （/contracts /cases /payments，原型遗留）不在路由表——前端 360 视图归 Task 11 重组。
// C1 增量：GET /:id/contacts 为用户批准的纯追加（同日历范围查询先例），服务方法
// listContacts 本就存在（customer.read + 范围 + 脱敏 + L3 审计），此处仅暴露传输层。

import { Controller } from 'egg';

import { customerService, leadService } from '../application/crm/crm-factory';
import {
  AddContactInput,
  CreateCustomerInput,
  CustomerListQuery,
  UpdateContactInput,
  UpdateCustomerInput,
} from '../application/crm/customer-service';
import { CustomerStatus } from '../domain/events/event-types';
import { CreateReferralLeadInput, CustomerType, LeadListQuery } from '../application/crm/lead-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys } from '../domain/master-data/master-data-validation';

const CUSTOMER_BODY_KEYS = [
  'name', 'phone', 'wechat', 'email', 'address', 'customerType', 'status', 'tags', 'remark',
] as const;
const CONTACT_BODY_KEYS = ['name', 'phone', 'wechat', 'relation', 'isPrimary'] as const;
// SPEC-039：客户域转介绍登记入参白名单（sourceType/referralCustomerId 由服务层强制绑定）。
const REFERRAL_BODY_KEYS = ['name', 'phone', 'wechat', 'intentionLevel', 'tags'] as const;
const REFERRAL_LIST_QUERY_KEYS = ['page', 'pageSize'] as const;

export default class CustomerController extends Controller {
  /** POST /api/v1/customers（customer.create）：直建客户（sourceLeadId 恒 null）。 */
  async create() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CUSTOMER_BODY_KEYS);
    this.respond(await customerService(this.ctx).createCustomer(body as unknown as CreateCustomerInput));
  }

  /** GET /api/v1/customers（customer.read）。 */
  async index() {
    this.respond(await customerService(this.ctx).listCustomers(parseCustomerListQuery(this.ctx.query)));
  }

  /** GET /api/v1/customers/:id（customer.read）。 */
  async show() {
    this.respond(await customerService(this.ctx).getCustomer(this.ctx.params.id));
  }

  /** PATCH /api/v1/customers/:id（customer.update）：仅更新提供字段。 */
  async update() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CUSTOMER_BODY_KEYS);
    this.respond(await customerService(this.ctx).updateCustomer(
      this.ctx.params.id,
      body as unknown as UpdateCustomerInput,
    ));
  }

  /** GET /api/v1/customers/:id/contacts（customer.read）：排除软删，createdAt ASC。 */
  async listContacts() {
    this.respond(await customerService(this.ctx).listContacts(this.ctx.params.id));
  }

  /** POST /api/v1/customers/:id/contacts（customer.update）：新增联系人。 */
  async addContact() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CONTACT_BODY_KEYS);
    this.respond(await customerService(this.ctx).addContact(
      this.ctx.params.id,
      body as unknown as AddContactInput,
    ));
  }

  /** PATCH /api/v1/customers/:id/contacts/:contactId（customer.update）。 */
  async updateContact() {
    const body = this.ctx.request.body;
    assertExactKeys(body, CONTACT_BODY_KEYS);
    this.respond(await customerService(this.ctx).updateContact(
      this.ctx.params.id,
      this.ctx.params.contactId,
      body as unknown as UpdateContactInput,
    ));
  }

  /** DELETE /api/v1/customers/:id/contacts/:contactId（customer.update）：软删。 */
  async removeContact() {
    await customerService(this.ctx).removeContact(this.ctx.params.id, this.ctx.params.contactId);
    this.respond(null);
  }

  /** POST /api/v1/customers/:id/referrals（lead.create，SPEC-039）：客户详情登记转介绍线索（强制 REFERRAL + 绑定该客户）。 */
  async createReferral() {
    const body = this.ctx.request.body;
    assertExactKeys(body, REFERRAL_BODY_KEYS);
    this.respond(await leadService(this.ctx).createReferralLead(this.ctx.params.id, body as unknown as CreateReferralLeadInput));
  }

  /** GET /api/v1/customers/:id/referrals（lead.read，SPEC-039）：客户转介绍线索列表（分页）。 */
  async listReferrals() {
    this.respond(await leadService(this.ctx).listReferrals(this.ctx.params.id, parseReferralListQuery(this.ctx.query)));
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseCustomerListQuery(input: unknown): CustomerListQuery {
  assertExactKeys(input, ['page', 'pageSize', 'status', 'customerType', 'keyword']);
  const query: CustomerListQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.status !== undefined) query.status = input.status as CustomerStatus;
  if (input.customerType !== undefined) query.customerType = input.customerType as CustomerType;
  if (input.keyword !== undefined) query.keyword = input.keyword as string;
  return query;
}

/** query 数字解析：非法形态 400（与 lead 控制器同一纪律）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}

/** 转介绍列表查询解析：page/pageSize 透传（服务层数字校验）。 */
function parseReferralListQuery(input: unknown): LeadListQuery {
  assertExactKeys(input, REFERRAL_LIST_QUERY_KEYS);
  const query: LeadListQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  return query;
}
