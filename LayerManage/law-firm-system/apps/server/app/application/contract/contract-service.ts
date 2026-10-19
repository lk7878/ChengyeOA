import { notifyDeliveryChange } from '../collaboration/delivery-change';
// SPEC-010 Task 7: contract-service A —— 合同（CON）创建四来源/提交/审批/驳回/签署。
// 形态逐字对齐 Task 6 negotiation-service：构造（prisma+actor+context+可选 outbox）、
// requireAction 首行、同事务 EventLog（outbox append）+ OperationLog、P2002 编号重试上限 2、
// version 乐观锁（updateMany where {id,version} → VERSION_CONFLICT 409）、金额 Prisma.Decimal。
// 动作链（协调者裁决 7）：submit（DRAFT→政策分流）/approve（PENDING_APPROVAL→PENDING_SIGN）/
//   reject（PENDING_APPROVAL→DRAFT，comment 必填 400）/sign（PENDING_SIGN→SIGNED，esign 预留字段）——
//   全部 requireAction 首行 → 动作级范围 → canTransitionContract 状态机（非法 409）→
//   version 乐观锁 → 同事务 contract.status_changed（载荷 {contractId,fromStatus,toStatus}）。
//   reject 后重新 submit 合法（DRAFT 可再提交，状态机天然允许）。
// 创建校验（协调者裁决 2/3/4/5/6/8）：
//   客户存在+未删+contract.create 动作级范围可见（不可见统一 CONTRACT_NOT_FOUND 404 不泄露）；
//   sourceType=NEGOTIATION 时 negotiationId 必填，4a 探针存在+deletedAt=null，且
//     negotiation.customerId 必须等于 input.customerId（不一致 VALIDATION_FAILED 400）；
//   parentContractId：SUPPLEMENT 必填、他类型禁填（提供 400）；探针存在+未删+状态
//     NOT IN ('VOID','TERMINATED')；不校验与 customerId 归属（补充协议挂父合同即语义充分，
//     父合同自身已锚客户——裁决 3 钉死）；
//   branchId/professionalTeamId 提供时 4a 探针 Organization/ProfessionalTeam findFirst
//     select id+code（缺失 400）——杜绝事件写入 event_log Restrict FK P2003 路径（裁决 4，
//     回应 Task 6 concern①）；branchCode/teamCode 从探针 code 解析供 nextContractNo，缺省 HQ/ALL；
//   templateCode 提供时探针 enabled=true → 快照 templateCode+templateVersion（缺失/disabled 400）；
//   金额 amount≥0（Decimal(18,2) 精度界同 D3），投影 toFixed(2)；
//   paymentTerms 结构预校验（终审修复轮 F-1，stuck-SIGNED 根除）：显式提供时复用
//     receivable-service 同一解析器只验不建，畸形/期次断裂/合计≠金额一律
//     RECEIVABLE_PLAN_MISMATCH 400 零写入——创建和工作表金额修改均执行此校验，
//     effect 侧校验不变构成双闸；金额缺省视 Decimal(0)（与 schema @default(0) 一致）。
// 审计纪律（裁决 9）：OperationLog 只落编号/类型/id/状态/金额与布尔存在性；approvalComment
//   属业务字段落库但不进审计值（approve/reject 审计仅落 hasComment 布尔）。
// Task 8 追加（生效事务矩阵 + 终止/作废，协调者裁决 :65/:66）：
//   terminate/void 复用 transitionContract 骨架（changes 注入 terminatedAt/terminateReason
//     或 voidedAt/voidReason；auditExtras 注入 { hasReason: true }——原因自由文本不落
//     OperationLog，理由持久化在合同行业务列，scope 内可读）；reason 必填 400。
//   effect 不复用骨架（事件类型不同+副作用矩阵+effectiveDate 入参），另写 effectContract，
//     严格同序：requireAction 首行 → scope 探查 → EFFECTIVE 幂等首查（重放返回现状，零副
//     作用）→ 状态判定（RISK_NOTICE 政策门禁 409）→ 乐观锁翻转（先翻转后副作用，
//     count!==1 → VERSION_CONFLICT 整事务回滚）→ 矩阵副作用（FORMAL 风险告知门禁 →
//     generatePlansForEffect 计划生成 → FIRST_SIGN 分析委托/FORMAL 案件最小建档）→
//     contract.effective 事件（6 键载荷，不发 status_changed）→ OperationLog → 重读投影。
//     矩阵内任一步失败整事务回滚（含翻转），零计划/零案件/零事件残留。
// 自裁决（申报备评审）：
//   S1 非 NEGOTIATION 来源携带 negotiationId → 矛盾载荷 VALIDATION_FAILED 400（沿 Task 6 D2 先例）；
//   S2 客户可见性范围解析 resource='contract'（buildCustomerVisibilityWhere 新增可选形参）——
//      裁决 8 "contract.create 动作级客户可见" 的唯一可运行解读：授权上下文按
//      (resource, permissionCode) 双键过滤授权，'customer'+'contract.create' 恒空集；
//   S3 reject 不写 approvedBy/approvedAt（驳回非审批通过；操作者由 OperationLog.userId 承载），
//      approvalComment 落库驳回原因；submittedBy/At 保留首次提交值，重新 submit 覆盖为最新。
//   S8 effect 的 idempotencyKey 仅作接口位校验不持久化（设计 §6.3 状态机天然幂等已覆盖；
//      合同域无幂等键存储先例）。

import { randomUUID } from 'node:crypto';

import { Contract, Prisma, PrismaClient } from '@prisma/client';

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
  canTransitionContract,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  ContractAction,
  ContractStatus,
  ContractType,
} from '../../domain/contract/contract-policy';
import {
  CONTRACT_CREATED,
  CONTRACT_EFFECTIVE,
  CONTRACT_SOURCE_TYPES,
  CONTRACT_STATUS_CHANGED,
  ContractCreatedV1,
  ContractEffectiveV1,
  ContractStatusChangedV1,
  EventEnvelopeInput,
} from '../../domain/events/event-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
  parseIsoDate,
} from '../../domain/master-data/master-data-validation';
import { nextCaseNo, nextContractNo, nextEngagementNo } from './contract-number-service';
import { projectContract } from './contract-projection';
import { buildContractScopeWhere, buildCustomerVisibilityWhere, buildNegotiationScopeWhere } from './contract-scope';
import {
  ApproveContractInput,
  ContractListQuery,
  ContractView,
  CreateContractInput,
  EffectContractInput,
  PagedResult,
  RejectContractInput,
  SignContractInput,
  TerminateContractInput,
  VoidContractInput,
} from './contract-types';
import {
  assertPaymentTermsStructurallyValid,
  cancelUnsettledPlans,
  generatePlansForEffect,
} from './receivable-service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
// 业务编号生成冲突时仅重试一次（同 lead-service BUSINESS_NO_RETRY_LIMIT 纪律）。
const BUSINESS_NO_RETRY_LIMIT = 2;
// schema amount 为 Decimal(18,2)：16 位整数 + 2 位小数上限（D3 先例）。
const MAX_CONTRACT_AMOUNT = '9999999999999999.99';

/** 本服务覆盖的流转动作子集（submit/approve/reject/sign 归 Task 7；terminate/void 归 Task 8，effect 另写同形态方法）。 */
type TransitionAction = Extract<ContractAction, 'submit' | 'approve' | 'reject' | 'sign' | 'terminate' | 'void'>;

export class ContractService {
  private readonly authorization: AuthorizationService;
  private readonly outbox: EventOutboxWriter;

  /** Worksheet mutations use the same transaction as extensions, audit and collaboration events. */
  async mutateDraft(
    id: string,
    input: Record<string, unknown>,
    deleting: boolean,
    tx: Prisma.TransactionClient,
  ) {
    const permission = deleting ? 'contract.delete' : 'contract.update';
    this.authorization.requireAction(this.authorizationContext, permission);
    assertExactKeys(input, deleting ? ['version'] : ['version', 'title', 'amount']);
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${id} FOR UPDATE`;
    const scope = await this.buildScopeWhere(permission);
    const current = await tx.contract.findFirst({ where: { AND: [scope, { id, deletedAt: null }] } });
    if (!current) throw new ContractError('CONTRACT_NOT_FOUND', 404, 'contract not found');
    if (current.version !== normalizeNonNegativeInteger(input.version))
      throw new MasterDataError('VERSION_CONFLICT', 409);
    if (deleting ? !['DRAFT', 'VOID'].includes(current.status) : current.status !== 'DRAFT')
      throw new ContractError(
        'CONTRACT_GRID_STATE_INVALID',
        409,
        'contract state prevents worksheet mutation',
      );
    // Keep signed documents and downstream financial/case records intact, even after voiding.
    const linked = await tx.contract.count({
      where: {
        id,
        OR: [
          { supplements: { some: { deletedAt: null } } },
          { paymentPlans: { some: {} } },
          { payments: { some: {} } },
          { case: { isNot: null } },
          { analysisEngagement: { isNot: null } },
          { invoiceRequests: { some: {} } },
          { refundRequests: { some: {} } },
        ],
      },
    });
    if (linked || current.receivedAmount.greaterThan(0) || current.signDate || current.esignLinkId)
      throw new ContractError('CONTRACT_GRID_IN_USE', 409, 'contract has downstream references');
    const data: Prisma.ContractUpdateManyMutationInput = {
      updatedBy: this.actor.actorUserId,
      version: { increment: 1 },
    };
    if (deleting) data.deletedAt = new Date();
    else {
      if (input.title !== undefined) data.title = normalizeRequiredText(input.title, 1, 200);
      if (Object.hasOwn(input, 'amount')) {
        const amount = normalizeContractAmount(input.amount);
        if (amount === undefined) throw new MasterDataError('VALIDATION_FAILED', 400);
        assertPaymentTermsStructurallyValid(current.paymentTerms, amount);
        data.amount = amount;
      }
      if (input.title === undefined && input.amount === undefined)
        throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    const changed = await tx.contract.updateMany({
      where: { id, version: current.version, deletedAt: null },
      data,
    });
    if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);
    await tx.operationLog.create({
      data: {
        userId: this.actor.actorUserId,
        action: permission,
        targetType: 'CONTRACT',
        targetId: id,
        newValues: JSON.stringify({
          version: current.version + 1,
          fields: Object.keys(input).filter((k) => k !== 'version'),
        }),
        ip: this.actor.ip,
      },
    });
    await notifyDeliveryChange(tx, this.actor.actorUserId, id);
    return { id, version: current.version + 1 };
  }

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
   * 创建合同：contract.create → 规范化 → 来源/依附/模板/组织锚/金额校验（探针在创建
   * 事务之外，D7 先例；竞争窗口由 FK 约束兜底）→ 客户 contract.create 动作级可见性
   * （不可见 404）→ 同事务建档（编号 nextContractNo 同事务取号）+ contract.created v1 +
   * OperationLog。contractNo 碰撞重试一次。初始状态 DRAFT。
   */
  async createContract(input: CreateContractInput): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.create');
    assertExactKeys(input, [
      'contractType', 'title', 'customerId', 'sourceType', 'sourceId', 'negotiationId',
      'parentContractId', 'templateCode', 'amount', 'paymentTerms', 'startDate', 'endDate',
      'terms', 'branchId', 'professionalTeamId',
    ]);
    const contractType = normalizeAllowedValue(input.contractType, CONTRACT_TYPES);
    const title = normalizeRequiredText(input.title, 1, 200);
    const customerId = normalizeRequiredText(input.customerId, 1, 100);
    const sourceType = input.sourceType === undefined
      ? 'CUSTOMER'
      : normalizeAllowedValue(input.sourceType, CONTRACT_SOURCE_TYPES);
    const sourceId = normalizeOptionalText(input.sourceId, 100);
    const negotiationId = normalizeOptionalText(input.negotiationId, 100);
    const parentContractId = normalizeOptionalText(input.parentContractId, 100);
    const templateCode = normalizeOptionalText(input.templateCode, 100);
    const amount = normalizeContractAmount(input.amount);
    const paymentTerms = normalizeOptionalText(input.paymentTerms, 500);
    const startDate = normalizeOptionalDate(input.startDate);
    const endDate = normalizeOptionalDate(input.endDate);
    const terms = normalizeOptionalText(input.terms, 5000);
    const branchId = normalizeOptionalText(input.branchId, 100);
    const professionalTeamId = normalizeOptionalText(input.professionalTeamId, 100);

    // 来源耦合（裁决 2 + 自裁决 S1）：NEGOTIATION 必填 negotiationId；他来源禁填（矛盾载荷 400）。
    if (sourceType === 'NEGOTIATION' && negotiationId === null) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    if (sourceType !== 'NEGOTIATION' && negotiationId !== null) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    // 依附耦合（裁决 3）：SUPPLEMENT 必填 parentContractId；他类型禁填（提供 400）。
    if (contractType === 'SUPPLEMENT' && parentContractId === null) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    if (contractType !== 'SUPPLEMENT' && parentContractId !== null) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    // paymentTerms 结构预校验（终审修复轮 F-1，stuck-SIGNED 根除——无 update API，
    // create 预验一次即永真）：复用 receivable-service 同一解析器只验不建；金额缺省
    // 视 Decimal(0)（与 schema @default(0) 一致）。失败 RECEIVABLE_PLAN_MISMATCH 400
    // 零写入；effect 侧校验不变构成双闸。纯校验置于 DB 探针之前（同来源/依附耦合序）。
    if (paymentTerms !== null) {
      assertPaymentTermsStructurallyValid(paymentTerms, amount ?? new Prisma.Decimal(0));
    }

    // 客户校验（裁决 8）：存在 + 未删 + contract.create 动作级范围可见；不可见统一 404 不泄露。
    const customerVisibility = await buildCustomerVisibilityWhere(
      this.prisma, this.authorization, this.authorizationContext, 'contract.create', 'contract',
    );
    const visibleCustomers = await this.prisma.customer.count({
      where: { AND: [customerVisibility, { id: customerId, deletedAt: null }] },
    });
    if (visibleCustomers === 0) {
      throw new ContractError(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, 404, 'customer not found');
    }

    // 谈案探针（裁决 2，4a 模式）：存在+未删，且客户归属必须与 input.customerId 一致（400）。
    if (negotiationId !== null) {
      const negotiation = await this.prisma.negotiation.findFirst({
        where: { id: negotiationId, deletedAt: null },
        select: { id: true, customerId: true },
      });
      if (!negotiation || negotiation.customerId !== customerId) {
        throw new MasterDataError('VALIDATION_FAILED', 400);
      }
    }

    // 父合同探针（裁决 3）：存在+未删+非 VOID/TERMINATED；不校验与 customerId 归属。
    if (parentContractId !== null) {
      const parent = await this.prisma.contract.findFirst({
        where: { id: parentContractId, deletedAt: null, status: { notIn: ['VOID', 'TERMINATED'] } },
        select: { id: true },
      });
      if (!parent) throw new MasterDataError('VALIDATION_FAILED', 400);
    }

    // 模板探针（裁决 5）：code 匹配+enabled → 快照 code+version；缺失/disabled 400。
    let templateVersion: number | null = null;
    if (templateCode !== null) {
      const template = await this.prisma.contractTemplate.findFirst({
        where: { code: templateCode, enabled: true },
        select: { id: true, version: true },
      });
      if (!template) throw new MasterDataError('VALIDATION_FAILED', 400);
      templateVersion = template.version;
    }

    // 显式组织锚探针（裁决 4，EventLog FK Restrict 防御）：findFirst select id+code，
    // 缺失 400；code 顺带供 nextContractNo 解析，缺省 HQ/ALL。
    let branchCode: string | null = null;
    if (branchId !== null) {
      const branch = await this.prisma.organization.findFirst({
        where: { id: branchId },
        select: { id: true, code: true },
      });
      if (!branch) throw new MasterDataError('VALIDATION_FAILED', 400);
      branchCode = branch.code;
    }
    let teamCode: string | null = null;
    if (professionalTeamId !== null) {
      const team = await this.prisma.professionalTeam.findFirst({
        where: { id: professionalTeamId },
        select: { id: true, code: true },
      });
      if (!team) throw new MasterDataError('VALIDATION_FAILED', 400);
      teamCode = team.code;
    }

    const created = await this.createWithBusinessNoRetry({
      contractType,
      title,
      customerId,
      sourceType,
      sourceId,
      negotiationId,
      parentContractId,
      templateCode,
      templateVersion,
      branchId,
      professionalTeamId,
      ...(amount !== undefined ? { amount } : {}),
      paymentTerms,
      startDate,
      endDate,
      terms,
      status: 'DRAFT',
      createdBy: this.actor.actorUserId,
    }, { contractType, branchCode, teamCode });
    return projectContract(created);
  }

  /**
   * 提交合同：contract.submit + 动作级范围 → 状态机 submit（DRAFT→requiresApproval?
   * PENDING_APPROVAL:PENDING_SIGN，类型政策分流在 canTransitionContract 内）→ 置
   * submittedBy/At → version 乐观锁 → 同事务 contract.status_changed + OperationLog。
   */
  async submitContract(id: string): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.submit');
    const submittedAt = new Date();
    return this.transitionContract(id, 'contract.submit', 'submit', 'CONTRACT_SUBMIT', {
      data: { submittedBy: this.actor.actorUserId, submittedAt },
      auditExtras: () => ({}),
    });
  }

  /**
   * 审批通过：contract.approve + 动作级范围 → 状态机 approve（PENDING_APPROVAL→PENDING_SIGN；
   * requiresApproval=false 类型被政策门禁拦截 409）→ 置 approvedBy/At + 可选 comment →
   * version 乐观锁 → 同事务事件 + OperationLog（approvalComment 不落审计值，仅 hasComment）。
   */
  async approveContract(id: string, input: ApproveContractInput): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.approve');
    assertExactKeys(input, ['comment']);
    const comment = normalizeOptionalText(input.comment, 500);
    const approvedAt = new Date();
    return this.transitionContract(id, 'contract.approve', 'approve', 'CONTRACT_APPROVE', {
      data: {
        approvedBy: this.actor.actorUserId,
        approvedAt,
        approvalComment: comment,
      },
      auditExtras: () => ({ hasComment: comment !== null }),
    });
  }

  /**
   * 驳回：contract.approve + 动作级范围 → comment 必填（400）→ 状态机 reject
   * （PENDING_APPROVAL→DRAFT）→ approvalComment 落库原因（approvedBy/At 不写——自裁决 S3）→
   * version 乐观锁 → 同事务事件 + OperationLog。驳回后 DRAFT 可重新 submit（状态机天然允许）。
   */
  async rejectContract(id: string, input: RejectContractInput): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.approve');
    assertExactKeys(input, ['comment']);
    const comment = normalizeRequiredText(input.comment, 1, 500);
    return this.transitionContract(id, 'contract.approve', 'reject', 'CONTRACT_REJECT', {
      data: { approvalComment: comment },
      auditExtras: () => ({ hasComment: true }),
    });
  }

  /**
   * 签署：contract.sign + 动作级范围 → 状态机 sign（PENDING_SIGN→SIGNED）→ 写 signDate
   * （缺省服务端当前时间）+ esign 预留字段（CON-05）→ version 乐观锁 → 同事务事件 +
   * OperationLog（esign 字段审计仅落存在性布尔）。
   */
  async signContract(id: string, input: SignContractInput): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.sign');
    assertExactKeys(input, ['signDate', 'esignLinkId', 'esignSerialNo', 'esignStatus']);
    const signDate = input.signDate === undefined ? new Date() : parseIsoDate(input.signDate);
    const esignLinkId = normalizeOptionalText(input.esignLinkId, 100);
    const esignSerialNo = normalizeOptionalText(input.esignSerialNo, 100);
    const esignStatus = normalizeOptionalText(input.esignStatus, 50);
    return this.transitionContract(id, 'contract.sign', 'sign', 'CONTRACT_SIGN', {
      data: { signDate, esignLinkId, esignSerialNo, esignStatus },
      auditExtras: () => ({
        signDate: signDate.toISOString(),
        hasEsignLinkId: esignLinkId !== null,
        hasEsignSerialNo: esignSerialNo !== null,
        hasEsignStatus: esignStatus !== null,
      }),
    });
  }

  /**
   * 生效（Task 8，不复用骨架——事件类型不同+副作用矩阵+effectiveDate 入参；步骤序严格同构）：
   * contract.effect → 动作级范围 → EFFECTIVE 幂等首查（重放返回现状，零副作用零事件零审计）→
   * 状态机 effect（SIGNED→EFFECTIVE；RISK_NOTICE 政策门禁 409）→ version 乐观锁翻转（先翻转
   * 后副作用；count!==1 → VERSION_CONFLICT 409 整事务回滚）→ 矩阵副作用（FORMAL 风险告知
   * 门禁缺失 RISK_NOTICE_MISSING 409 → generatePlansForEffect 计划生成 → FIRST_SIGN 分析
   * 委托/FORMAL 案件最小建档）→ contract.effective v1（恰 6 键，不发 status_changed）→
   * OperationLog（标识符/计数，无自由文本）→ 重读投影。矩阵内任一步失败整事务回滚。
   */
  async effectContract(id: string, input: EffectContractInput): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.effect');
    assertExactKeys(input, ['effectiveDate', 'idempotencyKey']);
    const effectiveDate = input.effectiveDate === undefined ? new Date() : parseIsoDate(input.effectiveDate);
    // idempotencyKey 仅作接口位校验（自裁决 S8）：状态机天然幂等已覆盖重放语义。
    normalizeOptionalText(input.idempotencyKey, 100);
    const contractId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildScopeWhere('contract.effect');

    return this.prisma.$transaction(async tx => {
      const contract = await tx.contract.findFirst({
        where: { AND: [scopeWhere, { id: contractId, deletedAt: null }] },
      });
      if (!contract) {
        throw new ContractError(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, 404, 'contract not found');
      }
      // 幂等首查：已 EFFECTIVE 重放直接返回现状（不重复生成计划/案件/委托/事件/审计）。
      if (contract.status === 'EFFECTIVE') {
        return projectContract(contract);
      }
      const fromStatus = contract.status as ContractStatus;
      const toStatus = canTransitionContract(contract.contractType as ContractType, fromStatus, 'effect');
      if (!toStatus) {
        throw new ContractError(
          CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID,
          409,
          `cannot effect contract in status ${contract.status}`,
        );
      }

      // 先翻转后副作用：翻转失败（并发竞败）整事务回滚，败者零计划/零案件/零事件。
      const changed = await tx.contract.updateMany({
        where: { id: contract.id, version: contract.version },
        data: {
          status: toStatus,
          effectiveDate,
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

      // 生效事务矩阵（设计 §6.2）：FORMAL 风险告知门禁 → 计划生成（全类型）→ 类型建档。
      const contractType = contract.contractType as ContractType;
      let caseId: string | null = null;
      let engagementId: string | null = null;
      if (contractType === 'FORMAL') {
        const riskNotice = await tx.contract.findFirst({
          where: {
            customerId: contract.customerId,
            contractType: 'RISK_NOTICE',
            status: 'SIGNED',
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!riskNotice) {
          throw new ContractError(
            CONTRACT_ERROR_CODES.RISK_NOTICE_MISSING,
            409,
            'FORMAL contract effect requires a signed RISK_NOTICE for the same customer',
          );
        }
      }
      const plans = await generatePlansForEffect(tx, contract, effectiveDate, this.actor.actorUserId);
      if (contractType === 'FIRST_SIGN') {
        // contractId @unique 为幂等挡板（非碰撞重试点——协调者裁决 :65⑪）。
        const engagement = await tx.analysisEngagement.create({
          data: {
            engagementNo: nextEngagementNo(),
            customerId: contract.customerId,
            contractId: contract.id,
            createdBy: this.actor.actorUserId,
          },
        });
        engagementId = engagement.id;
      }
      if (contractType === 'FORMAL') {
        const customer = await tx.customer.findUniqueOrThrow({
          where: { id: contract.customerId },
          select: { name: true },
        });
        const createdCase = await tx.case.create({
          data: {
            caseNo: nextCaseNo(),
            createdBy: this.actor.actorUserId, updatedBy: this.actor.actorUserId, branchId: contract.branchId,
            title: `${customer.name}-${contract.title}`,
            customerId: contract.customerId,
            contractId: contract.id,
            caseType: 'GENERAL',
            fee: contract.amount,
          },
        });
        caseId = createdCase.id;
      }

      // effect 只发 contract.effective（恰 6 键；caseId/engagementId 不适用时 null）。
      const payload: ContractEffectiveV1 = {
        contractId: contract.id,
        contractType,
        customerId: contract.customerId,
        planCount: plans.length,
        caseId,
        engagementId,
      };
      await this.outbox.append(tx, this.envelope(contract.id, payload, contract, CONTRACT_EFFECTIVE));
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CONTRACT_EFFECT',
          targetType: 'CONTRACT',
          targetId: contract.id,
          // 审计只落标识符/计数（裁决 9）：无 title/paymentTerms 自由文本。
          newValues: JSON.stringify({
            contractNo: contract.contractNo,
            fromStatus,
            toStatus,
            planCount: plans.length,
            caseId,
            engagementId,
          }),
          ip: this.actor.ip,
        },
      });
      const after = await tx.contract.findUniqueOrThrow({ where: { id: contract.id } });
      await notifyDeliveryChange(tx, this.actor.actorUserId, after.id);
      return projectContract(after);
    });
  }

  /**
   * 终止（Task 8 复用骨架 + SPEC-012 Task 4 扩展）：contract.terminate + 动作级范围 →
   * reason 必填（400）→ 状态机 terminate（仅 EFFECTIVE→TERMINATED）→ 在途校验前置钩子
   * （PENDING/APPROVED 退款或 PENDING 收款存在 → CONTRACT_TERMINATE_CONFLICT 409，整事务
   * 回滚零写入）→ 置 terminatedAt/terminateReason（理由落业务列不落审计值——裁决 9，审计
   * 仅 hasReason 布尔）→ version 乐观锁 → 同事务 contract.status_changed → 计划取消后置钩子
   * （cancelUnsettledPlans：PENDING/PARTIAL 转 CANCELLED，逐计划发 payment_plan.cancelled，
   * RECEIVED 不动；返回 canceledPlanCount 并入审计 newValues）→ OperationLog。
   */
  async terminateContract(id: string, input: TerminateContractInput): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.terminate');
    assertExactKeys(input, ['reason']);
    const reason = normalizeRequiredText(input.reason, 1, 500);
    // SPEC-014 F1 follow-up（terminate 侧硬化）：scope 预计算供 before 钩子锁后重读复用
    // （transitionContract 骨架的 scopeWhere 不传入钩子，此处重复计算一次，零行为差异）。
    const scopeWhere = await this.buildScopeWhere('contract.terminate');
    return this.transitionContract(id, 'contract.terminate', 'terminate', 'CONTRACT_TERMINATE', {
      data: { terminatedAt: new Date(), terminateReason: reason },
      auditExtras: () => ({ hasReason: true }),
      before: async (tx, contract) => {
        // SPEC-014 F1 follow-up（terminate 侧硬化）：首把锁 = Contract 行 FOR UPDATE（锁序恒
        // Contract→Payment/PaymentPlan，与 confirmPayment/voidPayment/createPayment 全写路径同序，
        // 无死锁——本事务此后不取其他 Contract 级锁）。锁后重读：READ COMMITTED 下取得锁即见
        // 最新已提交态——createPayment 在锁下 INSERT PENDING 提交后，此处重读必见该 PENDING →
        // 下方 in-flight 闸抛 CONTRACT_TERMINATE_CONFLICT 409 整事务回滚，反向竞速窗确定性关闭
        // （PENDING 不再滞留于 TERMINATED 合同）。
        await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contract.id} FOR UPDATE`;
        const locked = await tx.contract.findFirst({
          where: { AND: [scopeWhere, { id: contract.id, deletedAt: null }] },
        });
        if (!locked) {
          throw new ContractError(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, 404, 'contract not found');
        }
        const inFlightRefund = await tx.refundRequest.findFirst({
          where: { contractId: contract.id, status: { in: ['PENDING', 'APPROVED'] } },
        });
        if (inFlightRefund) {
          throw new ContractError(
            CONTRACT_ERROR_CODES.CONTRACT_TERMINATE_CONFLICT,
            409,
            'cannot terminate: in-flight refund/waiver request exists',
          );
        }
        const inFlightPayment = await tx.payment.findFirst({
          where: { contractId: contract.id, status: 'PENDING', deletedAt: null },
        });
        if (inFlightPayment) {
          throw new ContractError(
            CONTRACT_ERROR_CODES.CONTRACT_TERMINATE_CONFLICT,
            409,
            'cannot terminate: in-flight payment pending confirmation',
          );
        }
      },
      after: async (tx, contract) => {
        const { canceledCount } = await cancelUnsettledPlans(tx, contract, this.outbox, this.actor.actorUserId);
        return { canceledPlanCount: canceledCount };
      },
    });
  }

  /**
   * 作废（Task 8，复用骨架）：contract.void + 动作级范围 → reason 必填（400）→
   * 状态机 void（仅 DRAFT|PENDING_APPROVAL|PENDING_SIGN→VOID）→ 置 voidedAt/voidReason
   * （理由落业务列不落审计值）→ version 乐观锁 → 同事务 contract.status_changed + OperationLog。
   */
  async voidContract(id: string, input: VoidContractInput): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.void');
    assertExactKeys(input, ['reason']);
    const reason = normalizeRequiredText(input.reason, 1, 500);
    return this.transitionContract(id, 'contract.void', 'void', 'CONTRACT_VOID', {
      data: { voidedAt: new Date(), voidReason: reason },
      auditExtras: () => ({ hasReason: true }),
    });
  }

  /** 合同列表：contract.read + 范围 + status/contractType/customerId/keyword 过滤 + 分页（createdAt DESC, id ASC 决胜）。 */
  async listContracts(query: ContractListQuery): Promise<PagedResult<ContractView>> {
    this.authorization.requireAction(this.authorizationContext, 'contract.read');
    assertExactKeys(query, ['page', 'pageSize', 'status', 'contractType', 'customerId', 'keyword', 'caseNo', 'branchId']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildScopeWhere('contract.read');

    const filters: Prisma.ContractWhereInput[] = [scopeWhere, { deletedAt: null }];
    if (query.status !== undefined) {
      filters.push({ status: normalizeAllowedValue(query.status, CONTRACT_STATUSES) });
    }
    if (query.contractType !== undefined) {
      filters.push({ contractType: normalizeAllowedValue(query.contractType, CONTRACT_TYPES) });
    }
    const customerId = normalizeOptionalText(query.customerId, 100);
    if (customerId) filters.push({ customerId });
    if (query.branchId !== undefined) filters.push({ branchId: normalizeRequiredText(query.branchId, 1, 100) });
    const keyword = normalizeOptionalText(query.keyword, 100);
    if (keyword) {
      filters.push({
        OR: [
          { contractNo: { contains: keyword, mode: 'insensitive' } },
          { title: { contains: keyword, mode: 'insensitive' } },
        ],
      });
    }

    const caseNo = normalizeOptionalText(query.caseNo, 100);
    if (caseNo) filters.push({ case: { caseNo } });
    const where: Prisma.ContractWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.contract.count({ where }),
      this.prisma.contract.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map(projectContract),
      page,
      pageSize,
      total,
    };
  }

  /** 合同详情：contract.read + 范围；不存在/越权统一 404 不泄露存在性。 */
  async getContract(id: string): Promise<ContractView> {
    this.authorization.requireAction(this.authorizationContext, 'contract.read');
    const contractId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildScopeWhere('contract.read');
    const contract = await this.prisma.contract.findFirst({
      where: { AND: [scopeWhere, { id: contractId, deletedAt: null }] },
    });
    if (!contract) {
      throw new ContractError(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, 404, 'contract not found');
    }
    return projectContract(contract);
  }

  /**
   * 流转动作共享骨架（submit/approve/reject/sign/terminate/void；effect 因事件类型与
   * 副作用矩阵不同另写 effectContract，步骤序同构）：动作级范围 → 状态机判定（非法
   * CONTRACT_STATE_TRANSITION_INVALID 409）→ version 乐观锁（VERSION_CONFLICT 409）→
   * 同事务 contract.status_changed v1 + OperationLog。动作差异由 changes 参数注入。
   */
  private async transitionContract(
    id: string,
    permissionCode: PermissionCode,
    action: TransitionAction,
    auditAction: string,
    changes: {
      data: Prisma.ContractUncheckedUpdateManyInput;
      auditExtras: () => Record<string, unknown>;
      before?: (tx: Prisma.TransactionClient, contract: Contract) => Promise<void>;
      after?: (tx: Prisma.TransactionClient, contract: Contract) => Promise<Record<string, unknown>>;
    },
  ): Promise<ContractView> {
    const contractId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildScopeWhere(permissionCode);

    return this.prisma.$transaction(async tx => {
      const contract = await tx.contract.findFirst({
        where: { AND: [scopeWhere, { id: contractId, deletedAt: null }] },
      });
      if (!contract) {
        throw new ContractError(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, 404, 'contract not found');
      }
      const fromStatus = contract.status as ContractStatus;
      const toStatus = canTransitionContract(contract.contractType as ContractType, fromStatus, action);
      if (!toStatus) {
        throw new ContractError(
          CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID,
          409,
          `cannot ${action} contract in status ${contract.status}`,
        );
      }
      // SPEC-012 挂钩：状态机校验通过后、翻转前的 fail-fast 前置钩子（抛错整事务回滚零写入）。
      if (changes.before) await changes.before(tx, contract);

      const changed = await tx.contract.updateMany({
        where: { id: contract.id, version: contract.version },
        data: {
          ...changes.data,
          status: toStatus,
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

      const payload: ContractStatusChangedV1 = { contractId: contract.id, fromStatus, toStatus };
      await this.outbox.append(tx, this.envelope(contract.id, payload, contract, CONTRACT_STATUS_CHANGED));
      // SPEC-012 挂钩：翻转 + status_changed 出账后、operationLog 前的后置钩子（审计附加值合并进 newValues）。
      const afterResult = changes.after ? await changes.after(tx, contract) : {};
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: auditAction,
          targetType: 'CONTRACT',
          targetId: contract.id,
          // approvalComment 为业务字段不落审计值（裁决 9）；流转审计只落编号+from/to+布尔存在性。
          newValues: JSON.stringify({
            contractNo: contract.contractNo,
            fromStatus,
            toStatus,
            ...changes.auditExtras(),
            ...afterResult,
          }),
          ip: this.actor.ip,
        },
      });
      const after = await tx.contract.findUniqueOrThrow({ where: { id: contract.id } });
      await notifyDeliveryChange(tx, this.actor.actorUserId, after.id);
      return projectContract(after);
    });
  }

  private async createWithBusinessNoRetry(
    data: Omit<Prisma.ContractUncheckedCreateInput, 'contractNo'>,
    numberInput: { contractType: ContractType; branchCode: string | null; teamCode: string | null },
  ): Promise<Contract> {
    for (let attempt = 0; attempt < BUSINESS_NO_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(async tx => {
          if (data.negotiationId) {
            this.authorization.requireAction(this.authorizationContext, 'negotiation.read');
            await tx.$queryRaw`SELECT id FROM negotiation WHERE id = ${data.negotiationId} FOR UPDATE`;
            const upstream = await tx.negotiation.findFirst({ where: { AND: [
              await buildNegotiationScopeWhere(this.prisma, this.authorization, this.authorizationContext, 'negotiation.read'),
              { id: data.negotiationId, deletedAt: null },
            ] } });
            if (!upstream || upstream.customerId !== data.customerId) throw new MasterDataError('LIFECYCLE_NEGOTIATION_UNAVAILABLE', 404);
            if (upstream.status !== 'SIGNED') throw new MasterDataError('LIFECYCLE_NEGOTIATION_NOT_SIGNED', 409);
          }
          const contract = await tx.contract.create({
            data: {
              ...data,
              contractNo: await nextContractNo(tx, {
                contractType: numberInput.contractType,
                branchCode: numberInput.branchCode,
                teamCode: numberInput.teamCode,
              }),
            },
          });
          const payload: ContractCreatedV1 = {
            contractId: contract.id,
            contractNo: contract.contractNo,
            contractType: contract.contractType as ContractType,
            customerId: contract.customerId,
            sourceType: contract.sourceType as ContractCreatedV1['sourceType'],
          };
          await this.outbox.append(tx, this.envelope(contract.id, payload, contract, CONTRACT_CREATED));
          await tx.operationLog.create({
            data: {
              userId: this.actor.actorUserId,
              action: 'CONTRACT_CREATE',
              targetType: 'CONTRACT',
              targetId: contract.id,
              // 审计只落标识/编码/金额：禁止 title/paymentTerms/terms 自由文本（裁决 9）。
              newValues: JSON.stringify({
                contractNo: contract.contractNo,
                contractType: contract.contractType,
                customerId: contract.customerId,
                sourceType: contract.sourceType,
                status: contract.status,
                amount: contract.amount.toFixed(2),
                branchId: contract.branchId,
                professionalTeamId: contract.professionalTeamId,
                templateCode: contract.templateCode,
                negotiationId: contract.negotiationId,
                parentContractId: contract.parentContractId,
              }),
              ip: this.actor.ip,
            },
          });
          return contract;
        });
      } catch (error) {
        if (attempt + 1 < BUSINESS_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'contractNo')) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /** 合同数据范围：语义见 contract-scope 共享助手，本方法仅做委托。 */
  private async buildScopeWhere(permissionCode: PermissionCode): Promise<Prisma.ContractWhereInput> {
    return buildContractScopeWhere(this.prisma, this.authorization, this.authorizationContext, permissionCode);
  }

  /** 事件信封：organizationId 恒 null（同 negotiation-service），branchId/teamId 锚定合同自身组织列。 */
  private envelope(
    objectId: string,
    payload: ContractCreatedV1 | ContractStatusChangedV1 | ContractEffectiveV1,
    contract: Pick<Contract, 'branchId' | 'professionalTeamId'>,
    eventType: string,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType: 'CONTRACT',
      objectId,
      operatorUserId: this.actor.actorUserId,
      organizationId: null,
      branchId: contract.branchId ?? null,
      teamId: contract.professionalTeamId ?? null,
      payload,
      traceId: this.actor.requestId ?? randomUUID(),
      occurredAt: new Date(),
    };
  }
}

/** amount 入参：string/number → Prisma.Decimal；非负、scale≤2、不超 Decimal(18,2) 精度；缺省不落字段（schema @default(0)）。 */
function normalizeContractAmount(value: unknown): Prisma.Decimal | undefined {
  if (value === undefined || value === null) return undefined;
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
  if (amount.greaterThan(MAX_CONTRACT_AMOUNT)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return amount;
}

/** 可选 ISO 日期：undefined/null → null；非法格式 VALIDATION_FAILED 400。 */
function normalizeOptionalDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  return parseIsoDate(value);
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
