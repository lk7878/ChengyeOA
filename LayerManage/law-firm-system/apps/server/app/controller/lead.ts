// SPEC-009 Task 10: lead HTTP 控制器（整体替代 SPEC-001 原型）。
// 纪律：薄控制器——只做传输层解析（query 数字/ISO 日期/Idempotency-Key 头）与入口存在性校验，
// 业务校验/权限/范围/脱敏全部在 Task 5-9 冻结服务层；服务抛出的 MasterDataError/CrmError
// 原样传播给 errorHandler（CrmError 按实例 httpStatus 映射，不切换 code 字符串）。
// R-10d：branchId/professionalTeamId 在入口验证存在性（400），不得置 null（会破坏 BRANCH 范围
// 可见性）——原样透传会进入 EventLog 真 FK，伪造值将 P2003 成 500。
// 终审条目 2（同族封闭）：channelId/campaignId/referralCustomerId 同为真 relation
// （schema Lead.channel/campaign/referralCustomer），按 4a 同款模式入口验存在——
// 只验存在不验组织归属（与 4a 同语义），伪造值 400 不触服务层。

import { Controller } from 'egg';

import {
  appointmentService,
  leadAssignmentService,
  leadFollowService,
  leadService,
} from '../application/crm/crm-factory';
import { LeadFollowType } from '../application/crm/lead-follow-service';
import {
  ConvertContactInput,
  ConvertCustomerInput,
  CreateLeadInput,
  LeadListQuery,
} from '../application/crm/lead-types';
import { MasterDataError } from '../domain/master-data/master-data-errors';
import { assertExactKeys, parseIsoDate } from '../domain/master-data/master-data-validation';
import { LeadStatus, PoolStatus } from '../domain/crm/lead-policy';

export default class LeadController extends Controller {
  /** POST /api/v1/leads（lead.create）。Idempotency-Key 头 → 自然键幂等回放。 */
  async create() {
    const { ctx } = this;
    const body = ctx.request.body;
    assertExactKeys(body, [
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
    await this.assertOrganizationExists(body.branchId);
    await this.assertProfessionalTeamExists(body.professionalTeamId);
    await this.assertCampaignExists(body.campaignId);
    await this.assertReferralCustomerExists(body.referralCustomerId);
    this.respond(
      await leadService(ctx).createLead(
        body as unknown as CreateLeadInput,
        optionalHeader(ctx.get('idempotency-key')),
      ),
    );
  }

  /** GET /api/v1/leads（lead.read）。 */
  async index() {
    this.respond(await leadService(this.ctx).listLeads(parseLeadListQuery(this.ctx.query)));
  }

  /**
   * GET /api/v1/leads/pool（lead.read，R-10k）：公海列表，poolStatus 缺省 'PUBLIC'。
   * 已知限制：RECYCLED 池线索仅经显式 ?poolStatus=RECYCLED 可见（统一可领取视图需服务层扩展，
   * 属冻结边界外，申报为 final triage Minor）。
   */
  async pool() {
    const query = parseLeadListQuery(this.ctx.query);
    if (query.poolStatus === undefined) query.poolStatus = 'PUBLIC';
    this.respond(await leadService(this.ctx).listLeads(query));
  }

  /** GET /api/v1/leads/:id（lead.read）。 */
  async show() {
    this.respond(await leadService(this.ctx).getLead(this.ctx.params.id));
  }

  /**
   * PATCH /api/v1/leads/:id（lead.update，R-10j）：状态流转端点。
   * 服务层无字段更新方法（设计如此），body 恒为 { targetStatus, reason }。
   */
  async update() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ['targetStatus', 'reason']);
    this.respond(
      await leadService(this.ctx).transitionStatus(
        this.ctx.params.id,
        body.targetStatus as LeadStatus,
        body.reason as string,
      ),
    );
  }

  /** POST /api/v1/leads/:id/assign（lead.assign）：分配/改派。 */
  async assign() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ['toEmployeeId', 'reason']);
    this.respond(
      await leadAssignmentService(this.ctx).assign(
        this.ctx.params.id,
        body.toEmployeeId as string,
        body.reason as string | undefined,
      ),
    );
  }

  /** POST /api/v1/leads/:id/recycle（lead.recycle）：手动回收（仅私海）。 */
  async recycle() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ['reason']);
    this.respond(
      await leadAssignmentService(this.ctx).recycle(this.ctx.params.id, body.reason as string | undefined),
    );
  }

  /** POST /api/v1/leads/pool/claim（lead.pool.claim）：公海领取，body { leadId }。 */
  async claim() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ['leadId']);
    this.respond(await leadAssignmentService(this.ctx).claimFromPool(body.leadId as string));
  }

  /** POST /api/v1/leads/:id/convert（lead.convert）：转客户，body { customer, contact }。 */
  async convert() {
    const { ctx } = this;
    const body = ctx.request.body;
    assertExactKeys(body, ['customer', 'contact']);
    this.respond(
      await leadService(ctx).convertToCustomer(
        ctx.params.id,
        body.customer as ConvertCustomerInput,
        body.contact as ConvertContactInput,
        optionalHeader(ctx.get('idempotency-key')),
      ),
    );
  }

  /** POST /api/v1/leads/:id/follows（lead.update）：记录跟进。 */
  async follow() {
    const body = this.ctx.request.body;
    assertExactKeys(body, ['type', 'content', 'nextPlan', 'nextTime']);
    this.respond(
      await leadFollowService(this.ctx).recordFollow(this.ctx.params.id, {
        type: body.type as LeadFollowType,
        content: body.content as string,
        nextPlan: body.nextPlan as string | undefined,
        nextTime: body.nextTime === undefined ? undefined : parseIsoDate(body.nextTime),
      }),
    );
  }

  /** GET /api/v1/leads/:id/follows（lead.read）。 */
  async follows() {
    this.respond(await leadFollowService(this.ctx).listFollows(this.ctx.params.id));
  }
  async allFollows() {
    this.respond(await leadFollowService(this.ctx).listAllFollows(this.ctx.query));
  }

  /** GET /api/v1/leads/:id/appointments（appointment.read，R-10a 嵌套形态）。 */
  async appointments() {
    this.respond(await appointmentService(this.ctx).listAppointments(this.ctx.params.id));
  }

  /**
   * R-10d 入口存在性校验：Organization 无 deletedAt 列（schema 实证），按 id 直查。
   * 仅在非空字符串时校验；空串/null 经服务层 normalizeOptionalText 归 null，不构成 FK 风险。
   */
  private async assertOrganizationExists(value: unknown): Promise<void> {
    if (typeof value !== 'string' || value.trim().length === 0) return;
    const organization = await this.ctx.prisma.organization.findFirst({
      where: { id: value.trim() },
      select: { id: true },
    });
    if (!organization) throw new MasterDataError('VALIDATION_FAILED', 400);
  }

  private async assertProfessionalTeamExists(value: unknown): Promise<void> {
    if (typeof value !== 'string' || value.trim().length === 0) return;
    const team = await this.ctx.prisma.professionalTeam.findFirst({
      where: { id: value.trim() },
      select: { id: true },
    });
    if (!team) throw new MasterDataError('VALIDATION_FAILED', 400);
  }

  /**
   * 终审条目 2：channelId/campaignId/referralCustomerId 入口存在性校验（4a 同款）。
   * Channel/Campaign 无 deletedAt 列（schema 实证），按 id 直查；Customer 有软删，
   * 但软删行仍是合法 FK 目标（不触发 P2003），故同样只按 id 验存在——与 4a 同语义，
   * 不验组织归属、不验生命周期状态。
   */
  private async assertCampaignExists(value: unknown): Promise<void> {
    if (typeof value !== 'string' || value.trim().length === 0) return;
    const campaign = await this.ctx.prisma.campaign.findFirst({
      where: { id: value.trim() },
      select: { id: true },
    });
    if (!campaign) throw new MasterDataError('VALIDATION_FAILED', 400);
  }

  private async assertReferralCustomerExists(value: unknown): Promise<void> {
    if (typeof value !== 'string' || value.trim().length === 0) return;
    const customer = await this.ctx.prisma.customer.findFirst({
      where: { id: value.trim() },
      select: { id: true },
    });
    if (!customer) throw new MasterDataError('VALIDATION_FAILED', 400);
  }

  private respond(data: unknown): void {
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function parseLeadListQuery(input: unknown): LeadListQuery {
  assertExactKeys(input, ['page', 'pageSize', 'status', 'poolStatus', 'channelId', 'assignedTo', 'keyword']);
  const query: LeadListQuery = {};
  if (input.page !== undefined) query.page = parseQueryInteger(input.page);
  if (input.pageSize !== undefined) query.pageSize = parseQueryInteger(input.pageSize);
  if (input.status !== undefined) query.status = input.status as LeadStatus;
  if (input.poolStatus !== undefined) query.poolStatus = input.poolStatus as PoolStatus;
  if (input.channelId !== undefined) query.channelId = input.channelId as string;
  if (input.assignedTo !== undefined) query.assignedTo = input.assignedTo as string;
  if (input.keyword !== undefined) query.keyword = input.keyword as string;
  return query;
}

/** query 数字解析：非法形态 400（服务层 normalizePage 只接受 number，传输层先行把关）。 */
function parseQueryInteger(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return Number(value);
}

function optionalHeader(value: string): string | undefined {
  return value === '' ? undefined : value;
}
