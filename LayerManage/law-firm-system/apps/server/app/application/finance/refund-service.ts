import { createOnce } from './domain-mutation';
import { buildFinancialRecordScopeWhere, FinancialRecordScope } from './financial-record-scope';
import { assertFinancialCaseLink, financialCaseFilter, projectFinancialCases } from './financial-case-projection';
// SPEC-011 Task 6: refund-service —— 退款/减免申请全生命周期（FIN-03 回补核心，本 SPEC
// 风险最高点）。形态逐段镜像 finance/invoice-service.ts（Task 5 同族母版）：3 参构造
// (prisma, actor, authorizationContext) + 可选 outbox；requireAction 每公开方法第一行；
// assertExactKeys 入参白名单；同事务 EventLog + OperationLog；buildScopeWhere 委托
// buildContractScopeWhere（resource 传 'refund'——与 permission-catalog refund.* 码的
// resource 逐字一致，错传则 ('contract','refund.*') 恒空集 fail-closed 全 404，S15 教训）；
// envelope objectType 'REFUND_REQUEST'、organizationId 恒 null、branchId/teamId 锚合同
// 自身组织列（registry 定 sourceModule 'FINANCE'）。
// 规则（设计 §5.2/§6.2 + 协调者裁决）：
//   状态机：approve PENDING→APPROVED；reject PENDING→REJECTED；execute APPROVED→EXECUTED
//     （REJECTED/EXECUTED 终态——canTransitionRefundRequest 终态先行做翻转前置校验）。
//   类型分流（REFUND 锚 paymentId、WAIVER 锚 planId；交叉锚点禁填 400——成本锚点矩阵
//     同型纪律，保证 refund.executed 恰 5 键 paymentId/planId 一实一空）：
//     REFUND：payment 存在且属该合同（否则 VALIDATION_FAILED 400）→ status CONFIRMED
//       （否则 PAYMENT_STATE_INVALID 409）→ amount === payment.amount（否则
//       REFUND_AMOUNT_MISMATCH 400）→ 同 payment 无在途 REFUND 申请（PENDING/APPROVED
//       存在 → REFUND_STATE_INVALID 409）。
//     WAIVER：plan 存在且属该合同（否则 VALIDATION_FAILED 400）→ status ∈ PENDING/
//       PARTIAL（否则 WAIVER_PLAN_STATE_INVALID 409）→ 0 < amount ≤ plan.amount −
//       plan.receivedAmount（否则 WAIVER_AMOUNT_EXCEEDED 400）。WAIVER 无在途排他。
//   approve 无额度重验（裁决 1，与 invoice 不同）；approve/reject 骨架全同 Task 5；
//   reject 挂 refund.approve 权限码（catalog 无 refund.reject 码，设计裁决 12 同型，
//   invoice 先例已验收）。refund.approve 为 SPECIAL/CRITICAL 预存码（本 SPEC 首个消费方）。
//   幂等：翻转 updateMany {id, version, status:源态} → count=0 → 重读：已在目标态 → 返回
//     现状投影（幂等重放，零事件零审计零回补）；其他态 → REFUND_STATE_INVALID 409。
//   execute（设计 §6.2 步骤钉死）：Contract 行 FOR UPDATE 首锁（锁序恒 Contract→
//     RefundRequest→Payment|PaymentPlan，与 confirmPayment/invoice 全写路径同序，无交叉
//     持锁路径）→ 请求级闸翻转 APPROVED→EXECUTED（count=0 → 已 EXECUTED 幂等返回现状，
//     零事件零审计零回补；否则 REFUND_STATE_INVALID 409）→ REFUND：payment 翻转
//     {status:'CONFIRMED'}→REFUNDED（count=0 → PAYMENT_STATE_INVALID 409 全回滚，含并发
//     void/refund 败者）→ sweepBackReceived 资金回补；WAIVER：plan 行重读重验
//     amount ≤ plan.amount − plan.receivedAmount（失败 → WAIVER_AMOUNT_EXCEEDED 409
//     全回滚）→ plan.amount −= amount 状态重推导（receivedAmount ≥ 新 amount → RECEIVED，
//     含全额豁免 PENDING 计划 amount=0 的零元 RECEIVED；>0 → PARTIAL；=0 → PENDING）。
//   审计：action 字面量 REFUND_CREATE/REFUND_APPROVE/REFUND_REJECT/REFUND_EXECUTE，
//     targetType 'REFUND_REQUEST'；newValues 只落标识符（requestNo/type/contractId/
//     amount toFixed(2)/fromStatus/toStatus/execute 含 paymentId 或 planId；create/execute
//     含 hasReason:true）——reason/comment 自由文本落行不落审计。
//   RefundRequest 模型无 deletedAt 列：探查/列表不加 deletedAt 过滤。

import { randomUUID } from 'node:crypto';

import { Contract, Prisma, PrismaClient, RefundRequest } from '@prisma/client';

import {
  consumeGovernanceStepUp,
  GovernanceStepUpAuthorization,
  GovernanceStepUpConsumer,
} from '../admin-governance/governance-step-up';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { sweepBackReceived } from '../contract/receivable-service';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import {
  CONTRACT_ERROR_CODES,
  ContractError,
} from '../../domain/contract/contract-errors';
import {
  EventEnvelopeInput,
  REFUND_APPROVED,
  REFUND_EXECUTED,
  REFUND_REJECTED,
  REFUND_REQUESTED,
  RefundApprovedV1,
  RefundExecutedV1,
  RefundRejectedV1,
  RefundRequestedV1,
} from '../../domain/events/event-types';
import { FINANCE_ERROR_CODES, FinanceError } from '../../domain/finance/finance-errors';
import { canTransitionRefundRequest } from '../../domain/finance/finance-policy';
import {
  REFUND_REQUEST_STATUSES,
  REFUND_REQUEST_TYPES,
  RefundRequestStatus,
  RefundRequestType,
} from '../../domain/finance/finance-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { nextRefundNo } from '../contract/contract-number-service';
import { buildContractScopeWhere } from '../contract/contract-scope';
import {
  CreateRefundRequestInput,
  ListRefundRequestsQuery,
  PagedResult,
  RefundActionInput,
} from './finance-types';
import { RefundRequestView, projectRefundRequest } from './finance-projection';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
// requestNo 随机码碰撞重试上限（同 lead-service/receivable-service BUSINESS_NO_RETRY_LIMIT 纪律）。
const REFUND_NO_RETRY_LIMIT = 2;
// schema amount 为 Decimal(18,2)：16 位整数 + 2 位小数上限（D3 先例）。
const MAX_REFUND_AMOUNT = '9999999999999999.99';
/** 在途排他词位：同 payment 的 REFUND 申请在 PENDING/APPROVED 时阻塞新申请（WAIVER 无此约束）。 */
const IN_FLIGHT_STATUSES: RefundRequestStatus[] = ['PENDING', 'APPROVED'];

export class RefundService {
  private readonly authorization: AuthorizationService;
  private readonly outbox: EventOutboxWriter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
    outbox?: EventOutboxWriter,
    private readonly stepUp?: GovernanceStepUpConsumer,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
    this.outbox = outbox ?? new PrismaEventOutboxWriter();
  }

  /**
   * 退款/减免申请：refund.create → 规范化（type 白名单、reason 必填 1-500、金额>0
   * scale≤2、交叉锚点禁填——REFUND 锚 paymentId、WAIVER 锚 planId）→ 合同探查
   * （refund.create 动作级范围+未删，不可见/不存在 CONTRACT_NOT_FOUND 404 不泄露）→
   * 事务内 Contract 行 FOR UPDATE（首把锁，在途排他/余额校验与 confirmPayment、
   * execute 在同合同上整体串行——create 期校验为 pre-flight UX 闸，execute 期重验为
   * 完整性兜底）→ 类型分流校验（REFUND：payment 存在且属该合同+CONFIRMED+金额逐分相等
   * +无在途 REFUND 申请；WAIVER：plan 存在且属该合同+PENDING/PARTIAL+不超过余额）→
   * 建档（requestNo=nextRefundNo() P2002 碰撞重试上限 2，customerId 抄自合同冗余双锚，
   * status PENDING）→ 同事务 refund.requested v1（恰 6 键，无 amount——amount
   * toFixed(2) 落审计）+ OperationLog REFUND_CREATE（requestNo/type/contractId/amount/
   * hasReason:true——reason 自由文本落行不落审计）。
   */
  async createRefundRequest(input: CreateRefundRequestInput): Promise<RefundRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'refund.create');
    assertExactKeys(input, ['type', 'contractId', 'caseNo', 'paymentId', 'planId', 'amount', 'reason', 'idempotencyKey']);
    const type = normalizeAllowedValue(input.type, REFUND_REQUEST_TYPES);
    const contractId = normalizeRequiredText(input.contractId, 1, 100);
    const reason = normalizeRequiredText(input.reason, 1, 500);
    const amount = normalizeRefundAmount(input.amount);
    const idempotencyKey = normalizeOptionalText(input.idempotencyKey, 100);
    // 交叉锚点禁填（成本锚点矩阵同型纪律）：保证锚点一实一空，refund.executed 恰 5 键因此恒良构。
    const paymentId = type === 'REFUND'
      ? normalizeRequiredText(input.paymentId, 1, 100)
      : forbidCrossAnchor(input.paymentId);
    const planId = type === 'WAIVER'
      ? normalizeRequiredText(input.planId, 1, 100)
      : forbidCrossAnchor(input.planId);

    const scopeWhere = await this.buildScopeWhere('refund.create');
    const contract = await this.prisma.contract.findFirst({
      where: { AND: [scopeWhere, { id: contractId, deletedAt: null }] },
    });
    if (!contract) {
      throw new ContractError(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, 404, 'contract not found');
    }
    const caseNo = normalizeOptionalText(input.caseNo, 100);
    await assertFinancialCaseLink(this.prisma, this.authorizationContext, contractId, caseNo);

    const created = await this.createWithRequestNoRetry({
      type,
      contractId,
      customerId: contract.customerId,
      paymentId,
      planId,
      amount,
      reason,
      status: 'PENDING',
      createdBy: this.actor.actorUserId,
    }, idempotencyKey, caseNo);
    return projectRefundRequest(created);
  }

  /**
   * 退款/减免审批：refund.approve（SPECIAL/CRITICAL 预存码，本 SPEC 首个消费方）→ 探查
   * （范围经 { contract: … } 包裹，REFUND_NOT_FOUND 404）→ **Step-Up 证明校验**
   * （Task 7：refund.approve 真实 MFA 重验——沿 governance-step-up.ts 形态，仅当构造时
   * 注入 stepUp consumer 时强制；purpose=REFUND_APPROVE、target={refundRequestId,
   * expectedVersion}。expectedVersion 为客户端所见版本（前端列表行 version），缺失/非法
   * → 400 VALIDATION_FAILED（目标无法绑定）；与服务重读版本不符 → 409 REFUND_STATE_INVALID
   * （陈旧客户端）；无证/claims 不匹配/digest 不匹配 → consumeGovernanceStepUp 403）→
   * Contract 行 FOR UPDATE（事务内首把锁，锁序统一）→ 翻转前置校验（canTransitionRefundRequest
   * 终态先行）→ 幂等翻转 {id, version, status:'PENDING'}→APPROVED（approvedBy/At、
   * approvalComment、version+1；count=0 → 重读：已 APPROVED → 返回现状零事件零审计，其他
   * → REFUND_STATE_INVALID 409）→ refund.approved v1（恰 3 键）+ OperationLog
   * REFUND_APPROVE（requestNo/contractId/fromStatus/toStatus）→ 重读投影。
   * 无额度重验（协调者裁决 1，与 invoice 不同）。既有 approve 语义不改（仅前置 Step-Up 校验）。
   */
  async approveRefundRequest(
    id: string,
    input: RefundActionInput,
    stepUpAuthorization?: GovernanceStepUpAuthorization,
  ): Promise<RefundRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'refund.approve');
    assertExactKeys(input, ['comment', 'expectedVersion', 'idempotencyKey']);
    const comment = normalizeOptionalText(input.comment, 500);
    // idempotencyKey 仅作接口位校验（S8 先例）：APPROVED 重放由翻转谓词覆盖。
    normalizeOptionalText(input.idempotencyKey, 100);
    const expectedVersion = normalizeOptionalVersion(input.expectedVersion);
    const refundId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('refund.approve');

    return this.prisma.$transaction(async tx => {
      const refund = await this.probeRefundRequest(tx, refundId, scopeWhere);

      if (this.stepUp) {
        await this.assertRefundApproveStepUp(refund, expectedVersion, stepUpAuthorization, tx);
      }

      const contract = await this.lockContract(tx, refund.contractId);

      this.assertTransitionOrReplay(refund, 'approve', 'APPROVED');
      const flipped = await tx.refundRequest.updateMany({
        where: { id: refund.id, version: expectedVersion ?? refund.version, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          approvedBy: this.actor.actorUserId,
          approvedAt: new Date(),
          approvalComment: comment,
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (flipped.count === 0) {
        return this.replayOrStateInvalid(tx, refund.id, 'APPROVED', 'approve');
      }

      const payload: RefundApprovedV1 = {
        refundRequestId: refund.id,
        contractId: contract.id,
        status: 'APPROVED',
      };
      await this.outbox.append(tx, this.envelope(refund.id, payload, contract, REFUND_APPROVED));
      await this.appendAudit(tx, refund, 'REFUND_APPROVE', {
        requestNo: refund.requestNo,
        contractId: contract.id,
        fromStatus: 'PENDING',
        toStatus: 'APPROVED',
      });
      const after = await tx.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
      return projectRefundRequest(after);
    });
  }

  /**
   * 退款/减免驳回：同 approve 骨架（含挂 refund.approve 权限码——catalog 无
   * refund.reject 码，设计裁决 12 同型，invoice 先例已验收），目标 REJECTED；驳回决定
   * 元数据落 approvedBy/approvedAt/approvalComment（与 Approval 词位对齐）；事件
   * refund.rejected（恰 3 键）+ OperationLog REFUND_REJECT。
   */
  async rejectRefundRequest(id: string, input: RefundActionInput): Promise<RefundRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'refund.approve');
    assertExactKeys(input, ['comment', 'idempotencyKey']);
    const comment = normalizeOptionalText(input.comment, 500);
    normalizeOptionalText(input.idempotencyKey, 100);
    const refundId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('refund.approve');

    return this.prisma.$transaction(async tx => {
      const refund = await this.probeRefundRequest(tx, refundId, scopeWhere);
      const contract = await this.lockContract(tx, refund.contractId);

      this.assertTransitionOrReplay(refund, 'reject', 'REJECTED');
      const flipped = await tx.refundRequest.updateMany({
        where: { id: refund.id, version: refund.version, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          approvedBy: this.actor.actorUserId,
          approvedAt: new Date(),
          approvalComment: comment,
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (flipped.count === 0) {
        return this.replayOrStateInvalid(tx, refund.id, 'REJECTED', 'reject');
      }

      const payload: RefundRejectedV1 = {
        refundRequestId: refund.id,
        contractId: contract.id,
        status: 'REJECTED',
      };
      await this.outbox.append(tx, this.envelope(refund.id, payload, contract, REFUND_REJECTED));
      await this.appendAudit(tx, refund, 'REFUND_REJECT', {
        requestNo: refund.requestNo,
        contractId: contract.id,
        fromStatus: 'PENDING',
        toStatus: 'REJECTED',
      });
      const after = await tx.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
      return projectRefundRequest(after);
    });
  }

  /**
   * 退款/减免执行（设计 §6.2 步骤钉死，FIN-03 回补核心）：refund.execute → 探查（范围
   * 包裹，REFUND_NOT_FOUND 404）→ 事务：
   *   1. Contract 行 FOR UPDATE（首把锁；锁序恒 Contract→RefundRequest→Payment|
   *      PaymentPlan，与 confirmPayment/invoice 全写路径同序，无交叉持锁路径）；
   *   2. 请求级闸：updateMany {id, version, status:'APPROVED'}→EXECUTED（executedBy/At、
   *      version+1）；count=0 → 重读：已 EXECUTED → 幂等返回现状（零事件零审计零回补），
   *      否则 REFUND_STATE_INVALID 409；
   *   3. 类型分流：
   *      REFUND——重读 payment → updateMany {id, status:'CONFIRMED'}→REFUNDED
   *        （version+1）；count=0 → PAYMENT_STATE_INVALID 409 全回滚（含并发 void/
   *        refund 败者）→ sweepBackReceived(tx, contractId, amount, actor) 资金回补；
   *      WAIVER——plan 行重读（tx 内 findUniqueOrThrow）→ 重验 amount ≤ plan.amount −
   *        plan.receivedAmount（否则 WAIVER_AMOUNT_EXCEEDED 409 全回滚——create 期 400
   *        默认码，execute 期显式 409）→ plan.amount −= amount、状态重推导
   *        （receivedAmount ≥ 新 amount → RECEIVED，含全额豁免 PENDING 计划 amount=0
   *        的零元 RECEIVED；>0 且 < 新 amount → PARTIAL；=0 → PENDING）、version+1；
   *   4. refund.executed v1（恰 5 键，paymentId/planId 一实一空——服务层业务规则负责
   *      正确填充）+ OperationLog REFUND_EXECUTE（requestNo/type/contractId/paymentId
   *      或 planId/fromStatus/toStatus/hasReason:true）→ 重读投影。
   * comment 仅作接口位校验（RefundRequest 无 executeComment 列，不落行不落审计）。
   */
  async executeRefundRequest(id: string, input: RefundActionInput): Promise<RefundRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'refund.execute');
    assertExactKeys(input, ['comment', 'idempotencyKey']);
    normalizeOptionalText(input.comment, 500);
    // idempotencyKey 仅作接口位校验（S8 先例）：EXECUTED 重放由翻转谓词覆盖。
    normalizeOptionalText(input.idempotencyKey, 100);
    const refundId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('refund.execute');

    return this.prisma.$transaction(async tx => {
      const refund = await this.probeRefundRequest(tx, refundId, scopeWhere);
      const contract = await this.lockContract(tx, refund.contractId);

      this.assertTransitionOrReplay(refund, 'execute', 'EXECUTED');
      const flipped = await tx.refundRequest.updateMany({
        where: { id: refund.id, version: refund.version, status: 'APPROVED' },
        data: {
          status: 'EXECUTED',
          executedBy: this.actor.actorUserId,
          executedAt: new Date(),
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (flipped.count === 0) {
        return this.replayOrStateInvalid(tx, refund.id, 'EXECUTED', 'execute');
      }

      if (refund.type === 'REFUND') {
        // create 期锚点校验保证 REFUND 必持 paymentId（交叉锚点禁填）；防御性守卫兜底。
        if (refund.paymentId === null) {
          throw new FinanceError(
            FINANCE_ERROR_CODES.REFUND_STATE_INVALID,
            409,
            'REFUND request is missing its payment anchor',
          );
        }
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
        const paymentFlipped = await tx.payment.updateMany({
          where: { id: payment.id, status: 'CONFIRMED' },
          data: {
            status: 'REFUNDED',
            updatedBy: this.actor.actorUserId,
            version: { increment: 1 },
          },
        });
        if (paymentFlipped.count === 0) {
          throw new ContractError(
            CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID,
            409,
            'payment is no longer CONFIRMED at refund execution',
          );
        }
        // 资金回补（退款/冲销共享唯一实现）：调用方已持 Contract 行 FOR UPDATE 锁。
        await sweepBackReceived(tx, refund.contractId, refund.amount, this.actor.actorUserId);
      } else {
        // create 期锚点校验保证 WAIVER 必持 planId（交叉锚点禁填）；防御性守卫兜底。
        if (refund.planId === null) {
          throw new FinanceError(
            FINANCE_ERROR_CODES.REFUND_STATE_INVALID,
            409,
            'WAIVER request is missing its plan anchor',
          );
        }
        const plan = await tx.paymentPlan.findUniqueOrThrow({ where: { id: refund.planId } });
        // 执行时重验（裁决 3）：审批间隙 receivedAmount 可能被并发 confirm 推高——
        // 失败 → WAIVER_AMOUNT_EXCEEDED 409 全回滚（create 期默认 400，此处显式 409）。
        if (refund.amount.greaterThan(plan.amount.minus(plan.receivedAmount))) {
          throw new FinanceError(
            FINANCE_ERROR_CODES.WAIVER_AMOUNT_EXCEEDED,
            409,
            'waiver amount exceeds the plan remainder at execution',
          );
        }
        const nextAmount = plan.amount.minus(refund.amount);
        // 重验已保证 receivedAmount ≤ 新 amount：RECEIVED 分支即 receivedAmount = 新 amount
        // （含全额豁免 PENDING 计划 amount=0 的零元 RECEIVED）；重推导永不写 OVERDUE。
        const nextStatus = plan.receivedAmount.greaterThanOrEqualTo(nextAmount)
          ? 'RECEIVED'
          : (plan.receivedAmount.isZero() ? 'PENDING' : 'PARTIAL');
        // Contract 锁串行保护下 plain update 读到即最新（confirmPayment 互斥依据同原则）；
        // version 随写递增仅作观察性计数。
        await tx.paymentPlan.update({
          where: { id: plan.id },
          data: { amount: nextAmount, status: nextStatus, version: { increment: 1 } },
        });
      }

      const payload: RefundExecutedV1 = {
        refundRequestId: refund.id,
        contractId: refund.contractId,
        paymentId: refund.paymentId,
        planId: refund.planId,
        status: 'EXECUTED',
      };
      await this.outbox.append(tx, this.envelope(refund.id, payload, contract, REFUND_EXECUTED));
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'REFUND_EXECUTE',
          targetType: 'REFUND_REQUEST',
          targetId: refund.id,
          // 审计只落标识符+前后状态+hasReason：paymentId/planId 按类型取其实者。
          newValues: JSON.stringify({
            requestNo: refund.requestNo,
            type: refund.type,
            contractId: refund.contractId,
            ...(refund.type === 'REFUND' ? { paymentId: refund.paymentId } : { planId: refund.planId }),
            fromStatus: 'APPROVED',
            toStatus: 'EXECUTED',
            hasReason: true,
          }),
          ip: this.actor.ip,
        },
      });
      const after = await tx.refundRequest.findUniqueOrThrow({ where: { id: refund.id } });
      return projectRefundRequest(after);
    });
  }

  /**
   * 退款/减免申请列表：refund.read + 范围经 { contract: … } 包裹 + status/type/
   * contractId/customerId 直过滤 + 分页（形态镜像 listInvoices——page 默认 1、pageSize
   * 默认 20 上限 100、createdAt DESC id ASC 决胜）。RefundRequest 无 deletedAt 列，
   * 不加删除过滤。
   */
  async listRefundRequests(query: ListRefundRequestsQuery): Promise<PagedResult<RefundRequestView>> {
    this.authorization.requireAction(this.authorizationContext, 'refund.read');
    assertExactKeys(query, ['page', 'pageSize', 'status', 'type', 'contractId', 'customerId', 'caseNo']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildRecordScopeWhere('refund.read');

    const filters: Prisma.RefundRequestWhereInput[] = [{ AND: [scopeWhere, { contract: { deletedAt: null } }] }];
    if (query.status !== undefined) {
      filters.push({ status: normalizeAllowedValue(query.status, REFUND_REQUEST_STATUSES) });
    }
    if (query.type !== undefined) {
      filters.push({ type: normalizeAllowedValue(query.type, REFUND_REQUEST_TYPES) });
    }
    const contractId = normalizeOptionalText(query.contractId, 100);
    if (contractId) filters.push({ contractId });
    const customerId = normalizeOptionalText(query.customerId, 100);
    if (customerId) filters.push({ customerId });

    const caseNo = normalizeOptionalText(query.caseNo, 100);
    if (caseNo) filters.push({ contract: { case: await financialCaseFilter(this.prisma, this.authorizationContext, caseNo) } });
    const where: Prisma.RefundRequestWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.refundRequest.count({ where }),
      this.prisma.refundRequest.findMany({
        where,
        include: { contract: { select: { case: { select: { id: true, caseNo: true, title: true } } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: (await projectFinancialCases(this.prisma, this.authorizationContext, rows)).map(projectRefundRequest),
      page,
      pageSize,
      total,
    };
  }

  /**
   * 退款/减免申请详情：refund.read + 范围经 { contract: … } 包裹；不存在/越权统一
   * REFUND_NOT_FOUND 404 不泄露存在性。
   */
  async getRefundRequest(id: string): Promise<RefundRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'refund.read');
    const refundId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('refund.read');
    const refund = await this.prisma.refundRequest.findFirst({
      where: { id: refundId, AND: [scopeWhere, { contract: { deletedAt: null } }] },
    });
    if (!refund) {
      throw new FinanceError(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, 404, 'refund request not found');
    }
    return projectRefundRequest(refund);
  }

  /** 范围包裹探查：不存在/越权统一 REFUND_NOT_FOUND 404（RefundRequest 无 deletedAt 列）。 */
  private async probeRefundRequest(
    tx: Prisma.TransactionClient,
    refundId: string,
    scopeWhere: FinancialRecordScope,
  ): Promise<RefundRequest> {
    const refund = await tx.refundRequest.findFirst({
      where: { id: refundId, AND: [scopeWhere, { contract: { deletedAt: null } }] },
    });
    if (!refund) {
      throw new FinanceError(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, 404, 'refund request not found');
    }
    return refund;
  }

  /**
   * Step-Up 证明校验（Task 7 接线，仅注入 consumer 时调用——refund.approve 真实 MFA 重验）：
   * 目标 = {refundRequestId, expectedVersion}（客户端所见版本）。expectedVersion 缺失/非法
   * → 400 VALIDATION_FAILED（目标无法绑定）；与服务重读版本不符 → 409 REFUND_STATE_INVALID
   * （陈旧客户端，version 变化后原 grant 亦不可复用）；随后 consumeGovernanceStepUp 同事务
   * 消费一次性 grant——无证 403 STEP_UP_REQUIRED、claims.userId≠actor 403 STEP_UP_INVALID、
   * purpose/target digest 不匹配 403 STEP_UP_TARGET_MISMATCH（沿 governance-step-up 形态）。
   */
  private async assertRefundApproveStepUp(
    refund: RefundRequest,
    expectedVersion: number | undefined,
    stepUpAuthorization: GovernanceStepUpAuthorization | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (expectedVersion === undefined) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    if (refund.version !== expectedVersion) {
      throw new FinanceError(
        FINANCE_ERROR_CODES.REFUND_STATE_INVALID,
        409,
        'refund request version changed since the step-up target was bound',
      );
    }
    await consumeGovernanceStepUp(
      tx,
      this.stepUp as GovernanceStepUpConsumer,
      this.actor.actorUserId,
      stepUpAuthorization,
      'REFUND_APPROVE',
      { refundRequestId: refund.id, expectedVersion },
    );
  }

  /**
   * 事务内首把锁 = Contract 行 FOR UPDATE（锁序恒 Contract→RefundRequest→Payment|
   * PaymentPlan，与 confirmPayment/invoice 全写路径同序——互斥依据声明见文件头）；
   * 持锁后重读合同（READ COMMITTED 下取得锁即见最新已提交态）。
   */
  private async lockContract(
    tx: Prisma.TransactionClient,
    contractId: string,
  ): Promise<Contract> {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contractId} FOR UPDATE`;
    return tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  }

  /**
   * REFUND 目标收款校验（create 事务内、Contract 锁下调用）：payment 存在且属该合同
   * （否则 VALIDATION_FAILED 400）→ status CONFIRMED（否则 PAYMENT_STATE_INVALID 409）
   * → amount 逐分相等（否则 REFUND_AMOUNT_MISMATCH 400）→ 同 payment 无在途 REFUND
   * 申请（PENDING/APPROVED 存在 → REFUND_STATE_INVALID 409；REJECTED/EXECUTED 不阻塞）。
   */
  private async assertRefundablePayment(
    tx: Prisma.TransactionClient,
    data: { contractId: string; paymentId: string; amount: Prisma.Decimal },
  ): Promise<void> {
    const payment = await tx.payment.findFirst({
      where: { id: data.paymentId, deletedAt: null },
    });
    if (!payment || payment.contractId !== data.contractId) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    if (payment.status !== 'CONFIRMED') {
      throw new ContractError(
        CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID,
        409,
        `cannot refund a payment in status ${payment.status}`,
      );
    }
    if (!data.amount.equals(payment.amount)) {
      throw new FinanceError(
        FINANCE_ERROR_CODES.REFUND_AMOUNT_MISMATCH,
        400,
        'refund amount must equal the payment amount',
      );
    }
    const inFlight = await tx.refundRequest.findFirst({
      where: { paymentId: payment.id, type: 'REFUND', status: { in: IN_FLIGHT_STATUSES } },
      select: { id: true },
    });
    if (inFlight) {
      throw new FinanceError(
        FINANCE_ERROR_CODES.REFUND_STATE_INVALID,
        409,
        'an in-flight refund request already exists for this payment',
      );
    }
  }

  /**
   * WAIVER 目标计划校验（create 事务内、Contract 锁下调用）：plan 存在且属该合同
   * （否则 VALIDATION_FAILED 400）→ status ∈ PENDING/PARTIAL（否则
   * WAIVER_PLAN_STATE_INVALID 409）→ amount ≤ plan.amount − plan.receivedAmount
   * （否则 WAIVER_AMOUNT_EXCEEDED 400——create 期 400，execute 期重验失败 409）。
   */
  private async assertWaivablePlan(
    tx: Prisma.TransactionClient,
    data: { contractId: string; planId: string; amount: Prisma.Decimal },
  ): Promise<void> {
    const plan = await tx.paymentPlan.findFirst({ where: { id: data.planId } });
    if (!plan || plan.contractId !== data.contractId) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    if (plan.status !== 'PENDING' && plan.status !== 'PARTIAL') {
      throw new FinanceError(
        FINANCE_ERROR_CODES.WAIVER_PLAN_STATE_INVALID,
        409,
        `cannot waive a plan in status ${plan.status}`,
      );
    }
    if (data.amount.greaterThan(plan.amount.minus(plan.receivedAmount))) {
      throw new FinanceError(
        FINANCE_ERROR_CODES.WAIVER_AMOUNT_EXCEEDED,
        400,
        'waiver amount exceeds the plan remainder',
      );
    }
  }

  /**
   * 翻转前置校验（canTransitionRefundRequest 终态先行）：probe 态已在目标态 → 放行（幂等
   * 重放由翻转 count=0 分支统一处理——竞速败者 probe 读到的是旧态，必须走到翻转后重读
   * 定夺）；非法流转 → REFUND_STATE_INVALID 409 快速失败（不进翻转）。
   */
  private assertTransitionOrReplay(
    refund: RefundRequest,
    action: 'approve' | 'reject' | 'execute',
    target: RefundRequestStatus,
  ): void {
    if (refund.status === target) return;
    if (canTransitionRefundRequest(refund.status as RefundRequestStatus, action) === null) {
      throw new FinanceError(
        FINANCE_ERROR_CODES.REFUND_STATE_INVALID,
        409,
        `cannot ${action} refund request in status ${refund.status}`,
      );
    }
  }

  /**
   * 翻转败者定夺：重读最新已提交态——已在目标态 → 返回现状投影（幂等重放，零事件零审计
   * 零回补）；其他态 → REFUND_STATE_INVALID 409（竞速中源态已被其他动作移走）。
   */
  private async replayOrStateInvalid(
    tx: Prisma.TransactionClient,
    refundId: string,
    target: RefundRequestStatus,
    action: 'approve' | 'reject' | 'execute',
  ): Promise<RefundRequestView> {
    const current = await tx.refundRequest.findUniqueOrThrow({ where: { id: refundId } });
    if (current.status === target) {
      return projectRefundRequest(current);
    }
    throw new FinanceError(
      FINANCE_ERROR_CODES.REFUND_STATE_INVALID,
      409,
      `cannot ${action} refund request in status ${current.status}`,
    );
  }

  /** 审计落行：标识符 only（逐形镜像 invoice-service appendAudit）。 */
  private async appendAudit(
    tx: Prisma.TransactionClient,
    refund: RefundRequest,
    action: 'REFUND_APPROVE' | 'REFUND_REJECT',
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await tx.operationLog.create({
      data: {
        userId: this.actor.actorUserId,
        action,
        targetType: 'REFUND_REQUEST',
        targetId: refund.id,
        newValues: JSON.stringify(newValues),
        ip: this.actor.ip,
      },
    });
  }

  private async createWithRequestNoRetry(data: {
    type: RefundRequestType;
    contractId: string;
    customerId: string;
    paymentId: string | null;
    planId: string | null;
    amount: Prisma.Decimal;
    reason: string;
    status: 'PENDING';
    createdBy: string;
  }, idempotencyKey: string | null, caseNo: string | null): Promise<RefundRequest> {
    const replayScope = await this.buildRecordScopeWhere('refund.create');
    for (let attempt = 0; attempt < REFUND_NO_RETRY_LIMIT; attempt += 1) {
      try {
        return await createOnce(this.prisma, { actorId: this.actor.actorUserId, key: idempotencyKey, operation: 'refund.create', normalized: { ...data, amount: new Prisma.Decimal(String(data.amount)).toFixed(2), caseNo } }, async tx => {
          // 事务内首把锁 = Contract 行 FOR UPDATE（锁序统一）；类型分流校验在锁下进行，
          // 在途排他/余额判定因此只见已提交一致态（create 期为 pre-flight 闸，execute 期
          // 重验为完整性兜底——裁决 4/6）。
          const contract = await this.lockContract(tx, data.contractId);
          if (data.type === 'REFUND') {
            await this.assertRefundablePayment(tx, {
              contractId: data.contractId,
              paymentId: data.paymentId as string,
              amount: data.amount,
            });
          } else {
            await this.assertWaivablePlan(tx, {
              contractId: data.contractId,
              planId: data.planId as string,
              amount: data.amount,
            });
          }
          const refund = await tx.refundRequest.create({
            data: { ...data, requestNo: nextRefundNo() },
          });
          const payload: RefundRequestedV1 = {
            refundRequestId: refund.id,
            requestNo: refund.requestNo,
            type: refund.type as RefundRequestType,
            contractId: refund.contractId,
            customerId: refund.customerId,
            status: 'PENDING',
          };
          await this.outbox.append(tx, this.envelope(refund.id, payload, contract, REFUND_REQUESTED));
          await tx.operationLog.create({
            data: {
              userId: this.actor.actorUserId,
              action: 'REFUND_CREATE',
              targetType: 'REFUND_REQUEST',
              targetId: refund.id,
              // 审计只落标识符+金额+hasReason：reason 自由文本落行不落审计。
              newValues: JSON.stringify({
                requestNo: refund.requestNo,
                type: refund.type,
                contractId: refund.contractId,
                amount: refund.amount.toFixed(2),
                hasReason: true,
              }),
              ip: this.actor.ip,
            },
          });
          return refund;
        }, async (tx, targetId) => {
          const existing = await tx.refundRequest.findFirst({ where: { id: targetId, AND: [replayScope, { contract: { deletedAt: null } }] } });
          if (!existing) throw new FinanceError(FINANCE_ERROR_CODES.REFUND_NOT_FOUND, 404, 'record not found');
          return existing;
        });
      } catch (error) {
        if (attempt + 1 < REFUND_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'requestNo')) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /**
   * 退款动作级合同范围：以 resource='refund' 解析范围目标（catalog refund.* 码的
   * resource 为 'refund'，授权上下文按 (resource, permissionCode) 双键过滤，缺省
   * 'contract' 恒空集 fail-closed——S15 教训），锚定合同列；本方法仅做委托。
   */
  private async buildRecordScopeWhere(permissionCode: PermissionCode): Promise<FinancialRecordScope> {
    return buildFinancialRecordScopeWhere(this.prisma, this.authorization, this.authorizationContext, permissionCode, 'refund');
  }

  private async buildScopeWhere(permissionCode: PermissionCode): Promise<Prisma.ContractWhereInput> {
    return buildContractScopeWhere(
      this.prisma,
      this.authorization,
      this.authorizationContext,
      permissionCode,
      'refund',
    );
  }

  /** 事件信封：organizationId 恒 null（同 receivable-service），branchId/teamId 锚定合同自身组织列。 */
  private envelope(
    objectId: string,
    payload: RefundRequestedV1 | RefundApprovedV1 | RefundRejectedV1 | RefundExecutedV1,
    contract: Pick<Contract, 'branchId' | 'professionalTeamId'>,
    eventType: string,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType: 'REFUND_REQUEST',
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

/**
 * 退款/减免金额入参：必填、>0、scale≤2、不超 Decimal(18,2) 精度（本地镜像
 * invoice-service normalizeInvoiceAmount 纪律——本项目惯例每服务各持一份，不 import 别件）。
 */
function normalizeRefundAmount(value: unknown): Prisma.Decimal {
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
  if (amount.greaterThan(MAX_REFUND_AMOUNT)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return amount;
}

/**
 * 可选版本号（Task 7 Step-Up approve 前置校验）：缺失/空返回 undefined（step-up 未强制
 * 时忽略——既有 approve 语义不变）；提供但非安全正整数 → normalizeVersion 抛
 * VALIDATION_FAILED 400（目标无法绑定）。
 */
function normalizeOptionalVersion(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeVersion(value);
}

/** 交叉锚点禁填（成本锚点矩阵同型）：REFUND 禁 planId、WAIVER 禁 paymentId，填了即 400。 */
function forbidCrossAnchor(value: unknown): null {
  if (value !== undefined && value !== null) {
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
