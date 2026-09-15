import { createOnce } from './domain-mutation';
import { buildFinancialRecordScopeWhere, FinancialRecordScope } from './financial-record-scope';
import { assertFinancialCaseLink, financialCaseFilter, projectFinancialCases } from './financial-case-projection';
// SPEC-011 Task 5: invoice-service —— 开票申请全生命周期（FIN-02），finance 模块首个服务层件。
// 形态逐段镜像 contract/receivable-service.ts 收款段（Task 9 先例）：3 参构造
// (prisma, actor, authorizationContext) + 可选 outbox；requireAction 每公开方法第一行；
// assertExactKeys 入参白名单；同事务 EventLog + OperationLog；buildScopeWhere 委托
// buildContractScopeWhere（resource 传 'invoice'——与 permission-catalog invoice.* 码的
// resource 逐字一致，错传则 ('contract','invoice.*') 恒空集 fail-closed 全 404，S15 教训）；
// envelope objectType 'INVOICE_REQUEST'、organizationId 恒 null、branchId/teamId 锚合同
// 自身组织列（registry 定 sourceModule 'FINANCE'）。
// 规则（设计 §5.1/§6.1 + 协调者裁决）：
//   状态机：approve PENDING→APPROVED；reject PENDING→REJECTED；complete APPROVED→COMPLETED
//     （REJECTED/COMPLETED 终态——canTransitionInvoice 终态先行做翻转前置校验）。
//   额度不变量：占用 = 同合同 status ∈ PENDING/APPROVED/COMPLETED 的 Σamount（在途占额度，
//     REJECTED 释放）。create：事务内 Contract 行 FOR UPDATE + 占用+新额 ≤ contract.amount，
//     否则 INVOICE_AMOUNT_EXCEEDED 400；approve 重验：聚合口径同 create 且已含本单（本单
//     翻转后即 APPROVED），判定 = 聚合值 ≤ contract.amount、不再加任何新额，超标 →
//     INVOICE_AMOUNT_EXCEEDED 409 整事务回滚（状态保持 PENDING，零事件零审计）。
//   幂等：翻转 updateMany {id, version, status:源态} → count=0 → 重读：已在目标态 → 返回
//     现状投影（幂等重放，零事件零审计）；其他态 → INVOICE_STATE_INVALID 409。
//   reject 挂 invoice.approve 权限码（设计复核裁决 12：reject 路由挂 approve 码，router.ts:183
//     先例——catalog 无 invoice.reject 码）；驳回决定元数据落 approvedBy/approvedAt/
//     approvalComment 三列（与 Approval 词位对齐，设计 §12）。
//   审计：action 字面量 INVOICE_CREATE/INVOICE_APPROVE/INVOICE_REJECT/INVOICE_COMPLETE，
//     targetType 'INVOICE_REQUEST'；newValues 只落标识符（requestNo/contractId/fromStatus/
//     toStatus/amount toFixed(2)；complete 含 hasInvoiceNo 布尔，invoiceNo 文本不落）——
//     reason/comment 自由文本落行不落审计。
//   互斥依据声明（沿 confirmPayment 先例）：本服务全部写事务首把锁同为 Contract 行
//     FOR UPDATE——create 的额度校验与 approve 的额度重验在同合同上整体串行，并发超开
//     防线因此只见已提交一致占用；锁序恒 Contract→InvoiceRequest，无交叉持锁路径。
//   InvoiceRequest 模型无 deletedAt 列：探查/列表不加 deletedAt 过滤。

import { randomUUID } from 'node:crypto';

import { Contract, InvoiceRequest, Prisma, PrismaClient } from '@prisma/client';

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
  INVOICE_APPROVED,
  INVOICE_COMPLETED,
  INVOICE_REJECTED,
  INVOICE_REQUESTED,
  InvoiceApprovedV1,
  InvoiceCompletedV1,
  InvoiceRejectedV1,
  InvoiceRequestedV1,
} from '../../domain/events/event-types';
import { FINANCE_ERROR_CODES, FinanceError } from '../../domain/finance/finance-errors';
import { canTransitionInvoice } from '../../domain/finance/finance-policy';
import { INVOICE_STATUSES, InvoiceStatus } from '../../domain/finance/finance-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import { nextInvoiceNo } from '../contract/contract-number-service';
import { buildContractScopeWhere } from '../contract/contract-scope';
import {
  CompleteInvoiceInput,
  CreateInvoiceInput,
  InvoiceActionInput,
  ListInvoicesQuery,
  PagedResult,
} from './finance-types';
import { InvoiceRequestView, projectInvoiceRequest } from './finance-projection';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
// requestNo 随机码碰撞重试上限（同 lead-service/receivable-service BUSINESS_NO_RETRY_LIMIT 纪律）。
const INVOICE_NO_RETRY_LIMIT = 2;
// schema amount 为 Decimal(18,2)：16 位整数 + 2 位小数上限（D3 先例）。
const MAX_INVOICE_AMOUNT = '9999999999999999.99';
/** 额度占用词位：在途（PENDING/APPROVED/COMPLETED）占合同可开额度，REJECTED 释放。 */
const OCCUPYING_STATUSES: InvoiceStatus[] = ['PENDING', 'APPROVED', 'COMPLETED'];

export class InvoiceService {
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
   * 开票申请：invoice.create → 规范化（金额>0、scale≤2、≤Decimal(18,2) 上限）→ 合同探查
   * （invoice.create 动作级范围+未删，不可见/不存在 CONTRACT_NOT_FOUND 404 不泄露）→
   * 事务内 Contract 行 FOR UPDATE + 额度不变量（占用+新额 ≤ contract.amount，否则
   * INVOICE_AMOUNT_EXCEEDED 400）→ 建档（requestNo=nextInvoiceNo() P2002 碰撞重试上限 2，
   * customerId 抄自合同冗余双锚，status PENDING）→ 同事务 invoice.requested v1（恰 5 键）
   * + OperationLog INVOICE_CREATE（requestNo/contractId/amount toFixed(2)——reason 自由
   * 文本落行不落审计）。
   */
  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'invoice.create');
    assertExactKeys(input, ['contractId', 'caseNo', 'amount', 'reason', 'idempotencyKey']);
    const contractId = normalizeRequiredText(input.contractId, 1, 100);
    const amount = normalizeInvoiceAmount(input.amount);
    const reason = normalizeOptionalText(input.reason, 500);
    const idempotencyKey = normalizeOptionalText(input.idempotencyKey, 100);

    const scopeWhere = await this.buildScopeWhere('invoice.create');
    const contract = await this.prisma.contract.findFirst({
      where: { AND: [scopeWhere, { id: contractId, deletedAt: null }] },
    });
    if (!contract) {
      throw new ContractError(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, 404, 'contract not found');
    }
    const caseNo = normalizeOptionalText(input.caseNo, 100);
    await assertFinancialCaseLink(this.prisma, this.authorizationContext, contractId, caseNo);

    const created = await this.createWithRequestNoRetry({
      contractId,
      customerId: contract.customerId,
      amount,
      reason,
      status: 'PENDING',
      createdBy: this.actor.actorUserId,
    }, idempotencyKey, caseNo);
    return projectInvoiceRequest(created);
  }

  /**
   * 开票审批：invoice.approve → 探查（范围经 { contract: … } 包裹，INVOICE_NOT_FOUND 404）
   * → Contract 行 FOR UPDATE（事务内首把锁，额度重验串行化）→ 翻转前置校验
   * （canTransitionInvoice 终态先行，非法且非幂等重放 → INVOICE_STATE_INVALID 409）→
   * 幂等翻转 {id, version, status:'PENDING'}→APPROVED（approvedBy/At、approvalComment、
   * version+1；count=0 → 重读：已 APPROVED → 返回现状零事件零审计，其他 → 409）→
   * 审批时额度重验（聚合口径同 create、占用含本单，聚合值 > contract.amount →
   * INVOICE_AMOUNT_EXCEEDED 409 整事务回滚，状态保持 PENDING）→ invoice.approved v1
   * （恰 3 键）+ OperationLog INVOICE_APPROVE（requestNo/contractId/fromStatus/toStatus）
   * → 重读投影。
   */
  async approveInvoice(id: string, input: InvoiceActionInput): Promise<InvoiceRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'invoice.approve');
    assertExactKeys(input, ['comment', 'idempotencyKey']);
    const comment = normalizeOptionalText(input.comment, 500);
    // idempotencyKey 仅作接口位校验（S8 先例）：APPROVED 重放由翻转谓词覆盖。
    normalizeOptionalText(input.idempotencyKey, 100);
    const invoiceId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('invoice.approve');

    return this.prisma.$transaction(async tx => {
      const invoice = await this.probeInvoice(tx, invoiceId, scopeWhere);
      const contract = await this.lockContract(tx, invoice.contractId);

      this.assertTransitionOrReplay(invoice, 'approve', 'APPROVED');
      const flipped = await tx.invoiceRequest.updateMany({
        where: { id: invoice.id, version: invoice.version, status: 'PENDING' },
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
        return this.replayOrStateInvalid(tx, invoice.id, 'APPROVED', 'approve');
      }

      // 审批时额度重验（协调者裁决）：聚合口径同 create、占用已含本单（本单刚翻转
      // APPROVED），判定 = 聚合值 ≤ contract.amount、不再加任何新额；超标 → 409 全回滚。
      const occupied = await this.sumOccupyingAmount(tx, contract.id);
      if (occupied.greaterThan(contract.amount)) {
        throw new FinanceError(
          FINANCE_ERROR_CODES.INVOICE_AMOUNT_EXCEEDED,
          409,
          'invoice amount exceeds the contract invoicable amount at approval',
        );
      }

      const payload: InvoiceApprovedV1 = {
        invoiceRequestId: invoice.id,
        contractId: contract.id,
        status: 'APPROVED',
      };
      await this.outbox.append(tx, this.envelope(invoice.id, payload, contract, INVOICE_APPROVED));
      await this.appendAudit(tx, invoice, 'INVOICE_APPROVE', {
        requestNo: invoice.requestNo,
        contractId: contract.id,
        fromStatus: 'PENDING',
        toStatus: 'APPROVED',
      });
      const after = await tx.invoiceRequest.findUniqueOrThrow({ where: { id: invoice.id } });
      return projectInvoiceRequest(after);
    });
  }

  /**
   * 开票驳回：同 approve 骨架（含挂 invoice.approve 权限码——catalog 无 invoice.reject 码，
   * 设计复核裁决 12），目标 REJECTED；驳回决定元数据落 approvedBy/approvedAt/
   * approvalComment（与 Approval 词位对齐）；无额度重验（REJECTED 释放占用，只降不升）；
   * 幂等重放 = 已 REJECTED；事件 invoice.rejected（恰 3 键）+ OperationLog INVOICE_REJECT。
   */
  async rejectInvoice(id: string, input: InvoiceActionInput): Promise<InvoiceRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'invoice.approve');
    assertExactKeys(input, ['comment', 'idempotencyKey']);
    const comment = normalizeOptionalText(input.comment, 500);
    normalizeOptionalText(input.idempotencyKey, 100);
    const invoiceId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('invoice.approve');

    return this.prisma.$transaction(async tx => {
      const invoice = await this.probeInvoice(tx, invoiceId, scopeWhere);
      const contract = await this.lockContract(tx, invoice.contractId);

      this.assertTransitionOrReplay(invoice, 'reject', 'REJECTED');
      const flipped = await tx.invoiceRequest.updateMany({
        where: { id: invoice.id, version: invoice.version, status: 'PENDING' },
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
        return this.replayOrStateInvalid(tx, invoice.id, 'REJECTED', 'reject');
      }

      const payload: InvoiceRejectedV1 = {
        invoiceRequestId: invoice.id,
        contractId: contract.id,
        status: 'REJECTED',
      };
      await this.outbox.append(tx, this.envelope(invoice.id, payload, contract, INVOICE_REJECTED));
      await this.appendAudit(tx, invoice, 'INVOICE_REJECT', {
        requestNo: invoice.requestNo,
        contractId: contract.id,
        fromStatus: 'PENDING',
        toStatus: 'REJECTED',
      });
      const after = await tx.invoiceRequest.findUniqueOrThrow({ where: { id: invoice.id } });
      return projectInvoiceRequest(after);
    });
  }

  /**
   * 开票完成：invoice.complete → 探查（范围包裹，INVOICE_NOT_FOUND 404）→ Contract 行
   * FOR UPDATE（锁序统一）→ 翻转 {id, version, status:'APPROVED'}→COMPLETED（invoiceNo=
   * 规范化可空 ≤100、completedBy/At、version+1；count=0 → 重读：已 COMPLETED → 幂等重放
   * 零事件零审计，其他 → INVOICE_STATE_INVALID 409）→ invoice.completed v1（恰 3 键）
   * + OperationLog INVOICE_COMPLETE（requestNo/contractId/fromStatus/toStatus/
   * hasInvoiceNo 布尔——invoiceNo 文本不落审计）。无额度重验（COMPLETED 仍在占用词位内，
   * 占用不变）。
   */
  async completeInvoice(id: string, input: CompleteInvoiceInput): Promise<InvoiceRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'invoice.complete');
    assertExactKeys(input, ['invoiceNo', 'idempotencyKey']);
    const invoiceNo = normalizeOptionalText(input.invoiceNo, 100);
    normalizeOptionalText(input.idempotencyKey, 100);
    const invoiceId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('invoice.complete');

    return this.prisma.$transaction(async tx => {
      const invoice = await this.probeInvoice(tx, invoiceId, scopeWhere);
      const contract = await this.lockContract(tx, invoice.contractId);

      this.assertTransitionOrReplay(invoice, 'complete', 'COMPLETED');
      const flipped = await tx.invoiceRequest.updateMany({
        where: { id: invoice.id, version: invoice.version, status: 'APPROVED' },
        data: {
          status: 'COMPLETED',
          invoiceNo,
          completedBy: this.actor.actorUserId,
          completedAt: new Date(),
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (flipped.count === 0) {
        return this.replayOrStateInvalid(tx, invoice.id, 'COMPLETED', 'complete');
      }

      const payload: InvoiceCompletedV1 = {
        invoiceRequestId: invoice.id,
        contractId: contract.id,
        status: 'COMPLETED',
      };
      await this.outbox.append(tx, this.envelope(invoice.id, payload, contract, INVOICE_COMPLETED));
      await this.appendAudit(tx, invoice, 'INVOICE_COMPLETE', {
        requestNo: invoice.requestNo,
        contractId: contract.id,
        fromStatus: 'APPROVED',
        toStatus: 'COMPLETED',
        hasInvoiceNo: invoiceNo !== null,
      });
      const after = await tx.invoiceRequest.findUniqueOrThrow({ where: { id: invoice.id } });
      return projectInvoiceRequest(after);
    });
  }

  /**
   * 开票申请列表：invoice.read + 范围经 { contract: … } 包裹 + status/contractId/customerId
   * 直过滤 + 分页（形态镜像 listPayments——page 默认 1、pageSize 默认 20 上限 100、
   * createdAt DESC id ASC 决胜）。InvoiceRequest 无 deletedAt 列，不加删除过滤。
   */
  async listInvoices(query: ListInvoicesQuery): Promise<PagedResult<InvoiceRequestView>> {
    this.authorization.requireAction(this.authorizationContext, 'invoice.read');
    assertExactKeys(query, ['page', 'pageSize', 'status', 'contractId', 'customerId', 'caseNo']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildRecordScopeWhere('invoice.read');

    const filters: Prisma.InvoiceRequestWhereInput[] = [{ AND: [scopeWhere, { contract: { deletedAt: null } }] }];
    if (query.status !== undefined) {
      filters.push({ status: normalizeAllowedValue(query.status, INVOICE_STATUSES) });
    }
    const contractId = normalizeOptionalText(query.contractId, 100);
    if (contractId) filters.push({ contractId });
    const customerId = normalizeOptionalText(query.customerId, 100);
    if (customerId) filters.push({ customerId });

    const caseNo = normalizeOptionalText(query.caseNo, 100);
    if (caseNo) filters.push({ contract: { case: await financialCaseFilter(this.prisma, this.authorizationContext, caseNo) } });

    const where: Prisma.InvoiceRequestWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invoiceRequest.count({ where }),
      this.prisma.invoiceRequest.findMany({
        where,
        include: { contract: { select: { case: { select: { id: true, caseNo: true, title: true } } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: (await projectFinancialCases(this.prisma, this.authorizationContext, rows)).map(projectInvoiceRequest),
      page,
      pageSize,
      total,
    };
  }

  /**
   * 开票申请详情：invoice.read + 范围经 { contract: … } 包裹；不存在/越权统一
   * INVOICE_NOT_FOUND 404 不泄露存在性。
   */
  async getInvoice(id: string): Promise<InvoiceRequestView> {
    this.authorization.requireAction(this.authorizationContext, 'invoice.read');
    const invoiceId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('invoice.read');
    const invoice = await this.prisma.invoiceRequest.findFirst({
      where: { id: invoiceId, AND: [scopeWhere, { contract: { deletedAt: null } }] },
    });
    if (!invoice) {
      throw new FinanceError(FINANCE_ERROR_CODES.INVOICE_NOT_FOUND, 404, 'invoice request not found');
    }
    return projectInvoiceRequest(invoice);
  }

  /** 范围包裹探查：不存在/越权统一 INVOICE_NOT_FOUND 404（InvoiceRequest 无 deletedAt 列）。 */
  private async probeInvoice(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    scopeWhere: FinancialRecordScope,
  ): Promise<InvoiceRequest> {
    const invoice = await tx.invoiceRequest.findFirst({
      where: { id: invoiceId, AND: [scopeWhere, { contract: { deletedAt: null } }] },
    });
    if (!invoice) {
      throw new FinanceError(FINANCE_ERROR_CODES.INVOICE_NOT_FOUND, 404, 'invoice request not found');
    }
    return invoice;
  }

  /**
   * 事务内首把锁 = Contract 行 FOR UPDATE（互斥依据声明见文件头）；持锁后重读合同
   * （READ COMMITTED 下取得锁即见最新已提交 amount——额度判定的输入必须新鲜）。
   */
  private async lockContract(
    tx: Prisma.TransactionClient,
    contractId: string,
  ): Promise<Contract> {
    await tx.$queryRaw`SELECT id FROM contract WHERE id = ${contractId} FOR UPDATE`;
    return tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  }

  /**
   * 翻转前置校验（canTransitionInvoice 终态先行）：probe 态已在目标态 → 放行（幂等重放由
   * 翻转 count=0 分支统一处理——竞速败者 probe 读到的是旧态，必须走到翻转后重读定夺）；
   * 非法流转 → INVOICE_STATE_INVALID 409 快速失败（不进翻转）。
   */
  private assertTransitionOrReplay(
    invoice: InvoiceRequest,
    action: 'approve' | 'reject' | 'complete',
    target: InvoiceStatus,
  ): void {
    if (invoice.status === target) return;
    if (canTransitionInvoice(invoice.status as InvoiceStatus, action) === null) {
      throw new FinanceError(
        FINANCE_ERROR_CODES.INVOICE_STATE_INVALID,
        409,
        `cannot ${action} invoice in status ${invoice.status}`,
      );
    }
  }

  /**
   * 翻转败者定夺：重读最新已提交态——已在目标态 → 返回现状投影（幂等重放，零事件零审计）；
   * 其他态 → INVOICE_STATE_INVALID 409（竞速中源态已被其他动作移走）。
   */
  private async replayOrStateInvalid(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    target: InvoiceStatus,
    action: 'approve' | 'reject' | 'complete',
  ): Promise<InvoiceRequestView> {
    const current = await tx.invoiceRequest.findUniqueOrThrow({ where: { id: invoiceId } });
    if (current.status === target) {
      return projectInvoiceRequest(current);
    }
    throw new FinanceError(
      FINANCE_ERROR_CODES.INVOICE_STATE_INVALID,
      409,
      `cannot ${action} invoice in status ${current.status}`,
    );
  }

  /** 额度占用聚合：同合同 status ∈ PENDING/APPROVED/COMPLETED 的 Σamount（REJECTED 释放）。 */
  private async sumOccupyingAmount(
    tx: Prisma.TransactionClient,
    contractId: string,
  ): Promise<Prisma.Decimal> {
    const aggregate = await tx.invoiceRequest.aggregate({
      where: { contractId, status: { in: OCCUPYING_STATUSES } },
      _sum: { amount: true },
    });
    return aggregate._sum.amount ?? new Prisma.Decimal(0);
  }

  private async createWithRequestNoRetry(data: {
    contractId: string;
    customerId: string;
    amount: Prisma.Decimal;
    reason: string | null;
    status: 'PENDING';
    createdBy: string;
  }, idempotencyKey: string | null, caseNo: string | null): Promise<InvoiceRequest> {
    const replayScope = await this.buildRecordScopeWhere('invoice.create');
    for (let attempt = 0; attempt < INVOICE_NO_RETRY_LIMIT; attempt += 1) {
      try {
        return await createOnce(this.prisma, { actorId: this.actor.actorUserId, key: idempotencyKey, operation: 'invoice.create', normalized: { ...data, amount: new Prisma.Decimal(String(data.amount)).toFixed(2), caseNo } }, async tx => {
          // 额度不变量：合同行 FOR UPDATE 内校验（并发超开防线）；持锁后重读合同取新鲜 amount。
          const contract = await this.lockContract(tx, data.contractId);
          const occupied = await this.sumOccupyingAmount(tx, contract.id);
          if (occupied.plus(data.amount).greaterThan(contract.amount)) {
            throw new FinanceError(
              FINANCE_ERROR_CODES.INVOICE_AMOUNT_EXCEEDED,
              400,
              'invoice amount exceeds the contract remaining invoicable amount',
            );
          }
          const invoice = await tx.invoiceRequest.create({
            data: { ...data, requestNo: nextInvoiceNo() },
          });
          const payload: InvoiceRequestedV1 = {
            invoiceRequestId: invoice.id,
            requestNo: invoice.requestNo,
            contractId: invoice.contractId,
            customerId: invoice.customerId,
            status: 'PENDING',
          };
          await this.outbox.append(tx, this.envelope(invoice.id, payload, contract, INVOICE_REQUESTED));
          await tx.operationLog.create({
            data: {
              userId: this.actor.actorUserId,
              action: 'INVOICE_CREATE',
              targetType: 'INVOICE_REQUEST',
              targetId: invoice.id,
              // 审计只落标识符+金额：reason 自由文本落行不落审计。
              newValues: JSON.stringify({
                requestNo: invoice.requestNo,
                contractId: invoice.contractId,
                amount: invoice.amount.toFixed(2),
              }),
              ip: this.actor.ip,
            },
          });
          return invoice;
        }, async (tx, targetId) => {
          const existing = await tx.invoiceRequest.findFirst({ where: { id: targetId, AND: [replayScope, { contract: { deletedAt: null } }] } });
          if (!existing) throw new FinanceError(FINANCE_ERROR_CODES.INVOICE_NOT_FOUND, 404, 'record not found');
          return existing;
        });
      } catch (error) {
        if (attempt + 1 < INVOICE_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'requestNo')) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /** 审计落行：标识符 only（逐形镜像 receivable-service :461-476）。 */
  private async appendAudit(
    tx: Prisma.TransactionClient,
    invoice: InvoiceRequest,
    action: 'INVOICE_APPROVE' | 'INVOICE_REJECT' | 'INVOICE_COMPLETE',
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await tx.operationLog.create({
      data: {
        userId: this.actor.actorUserId,
        action,
        targetType: 'INVOICE_REQUEST',
        targetId: invoice.id,
        newValues: JSON.stringify(newValues),
        ip: this.actor.ip,
      },
    });
  }

  /**
   * 开票动作级合同范围：以 resource='invoice' 解析范围目标（catalog invoice.* 码的
   * resource 为 'invoice'，授权上下文按 (resource, permissionCode) 双键过滤，缺省
   * 'contract' 恒空集 fail-closed——S15 教训），锚定合同列；本方法仅做委托。
   */
  private async buildRecordScopeWhere(permissionCode: PermissionCode): Promise<FinancialRecordScope> {
    return buildFinancialRecordScopeWhere(this.prisma, this.authorization, this.authorizationContext, permissionCode, 'invoice');
  }

  private async buildScopeWhere(permissionCode: PermissionCode): Promise<Prisma.ContractWhereInput> {
    return buildContractScopeWhere(
      this.prisma,
      this.authorization,
      this.authorizationContext,
      permissionCode,
      'invoice',
    );
  }

  /** 事件信封：organizationId 恒 null（同 receivable-service），branchId/teamId 锚定合同自身组织列。 */
  private envelope(
    objectId: string,
    payload: InvoiceRequestedV1 | InvoiceApprovedV1 | InvoiceRejectedV1 | InvoiceCompletedV1,
    contract: Pick<Contract, 'branchId' | 'professionalTeamId'>,
    eventType: string,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType: 'INVOICE_REQUEST',
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
 * 开票金额入参：必填、>0、scale≤2、不超 Decimal(18,2) 精度（本地镜像
 * receivable-service normalizePaymentAmount 纪律——本项目惯例每服务各持一份，
 * 不 import 别件）。
 */
function normalizeInvoiceAmount(value: unknown): Prisma.Decimal {
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
  if (amount.greaterThan(MAX_INVOICE_AMOUNT)) {
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

function isUniqueConflictOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes(field);
}
