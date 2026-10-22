import { createOnce } from '../finance/domain-mutation';
import { notifyDeliveryChange } from '../collaboration/delivery-change';
import { buildFinancialRecordScopeWhere, FinancialRecordScope } from '../finance/financial-record-scope';
import { assertFinancialCaseLink, financialCaseFilter, projectFinancialCases } from '../finance/financial-case-projection';
// SPEC-010 Task 8: receivable-service —— 应收计划生成段（CON-07）。
// 计划生成与正式收款共用原合同事务；U6-A 增加创建重放及单据创建人范围。
// module function 风格（同 contract-number-service.ts，非 class）：generatePlansForEffect
// 由 contract-service.effectContract 在生效事务内调用——与状态乐观锁翻转/风险告知门禁/
// 案件与分析委托最小建档同生共死：本函数抛出即整事务回滚，零计划残留。
// 规则（设计 §6.2 + 协调者裁决）：
//   contract.paymentTerms（String? JSON 文本）形态：`{ "plans": [{ "period": 1,
//     "dueDate": "2026-09-01", "amount": "5000.00" }] }`；null/空串 → 默认一期
//     { period: 1, dueDate: effectiveDate+30天, amount: contract.amount }。
//   JSON 畸形/结构不符（含未知键）/期次非 1..N 连续/单期金额非法（非负、scale≤2）/
//   合计≠合同金额（Decimal 精确比较）→ 一律 ContractError(RECEIVABLE_PLAN_MISMATCH, 400)
//   （单码覆盖计划校验全类，协调者裁决）。
//   planNo=nextPlanNo()（PP 前缀薄封装）；receivedAmount/status 走 schema 默认 0/PENDING——
//   永不写 OVERDUE 存储态（逾期=查询时推导，协调者 Task 9 预备裁决）。
//   createdBy 必填（schema:922 无默认）= effect 操作者（协调者 2026-07-31 补充裁决，
//   签名扩四参 (tx, contract, effectiveDate, createdBy)）。
// 终审修复轮（2026-07-31 全分支终审 NEEDS FIXES 裁决）：
//   F-1 stuck-SIGNED 根除——导出 assertPaymentTermsStructurallyValid 纯结构预校验
//     （复用同一解析器 parseExplicitPlanSpecs，只验不建：默认一期生成逻辑恒良构不入）；
//     contract-service.createContract 在 paymentTerms≠null 时调用，畸形 create 即 400
//     零写入（无 update API，create 预验一次即永真）；effect 路径校验不变构成双闸。
//   F-2 dueDate ISO 形态校验——parsePlanEntry 由裸 new Date() 改 ISO 正则+真实日历日
//     校验（等效 master-data-validation parseIsoDate 语义；本地复刻正则而非调用的理由：
//     parseIsoDate 抛 VALIDATION_FAILED，本路径单码纪律 RECEIVABLE_PLAN_MISMATCH），
//     非 ISO 串（'09/01/2026'、'2026-09-01 10:00' 空格形等）一律 MISMATCH 400。
//
// SPEC-010 Task 9: 收款段（FIN-01）——exported ReceivableService class 追加于下，
// generatePlansForEffect 保持 module function 不动。构造/范围/信封/审计形态逐段镜像
// contract-service.ts（3 参构造 (prisma, actor, authorizationContext) + 可选 outbox；
// requireAction 每公开方法第一行；同事务 EventLog + OperationLog；事件信封 organizationId
// 恒 null、branchId/teamId 锚合同自身组织列——EventLog 该两列 Restrict FK，合同锚为真实
// 组织 id 安全）。
// 范围（自裁决 S15，沿 Task 7 S2 先例）：payment.* 动作级范围经 buildContractScopeWhere
//   以 resource='payment' 解析、锚定合同列（Payment 查询经 { contract: … } 关系包裹）；
//   不可见统一 404 不泄露存在性（CONTRACT_NOT_FOUND / PAYMENT_NOT_FOUND）。
// 登记 createPayment：合同探查（范围包裹+deletedAt null）→ 状态门禁（裁决：仅
//   SIGNED/EFFECTIVE 放行，其余 CONTRACT_STATE_TRANSITION_INVALID 409——草稿禁收款）→
//   paymentPlanId 4a 探针（plan 存在且 plan.contractId===contractId，否则
//   VALIDATION_FAILED 400）→ 金额>0 且 scale≤2 → paymentNo=nextPaymentNo() P2002 碰撞
//   重试上限 2（lead 先例 BUSINESS_NO_RETRY_LIMIT；Payment 无唯一 FK 幂等挡板，与 Task 8
//   裁决⑪ 区隔）→ customerId 抄自合同（冗余双锚）→ status PENDING → 同事务
//   payment.created（恰 5 键）+ OperationLog PAYMENT_CREATE（标识符+金额 only；
//   remark/method/account 自由文本落行不落审计）。
// 确认 confirmPayment（三方同事务联动）：
//   1. payment 探查（{ contract: scope } 包裹+deletedAt null，404）；
//   2. 事务内首把锁 = Contract 行 FOR UPDATE（同合同确认互斥——不同收款单的并发确认在
//      此串行，冲抵读写因此只见已提交一致态；互斥依据详见 confirmPayment 注释）；
//   3. 幂等翻转 updateMany {id, version, status:'PENDING'} → confirmedBy/At+version+1；
//      count=0 → 重读：已 CONFIRMED → 返回现状投影零重冲（幂等重放，零事件零审计），
//      其他 → VERSION_CONFLICT 409。PAYMENT_ALREADY_CONFIRMED 保留词位不抛（协调者
//      裁决⑤：幂等重放语义优先）；
//   4. 冲抵（仅胜者）：指定 paymentPlanId → 该期单期冲抵；未指定 → status∈{PENDING,
//      PARTIAL} 计划按 dueDate,period 升序贪心扫；每期 applied=min(剩余, plan.amount−
//      plan.receivedAmount)（取 min 后期内永不溢出——裁决口径：溢出判定=扫完仍有剩余）；
//      期状态派生 received=0→PENDING、0<received<amount→PARTIAL、received≥amount→
//      RECEIVED（永不写 OVERDUE）；无计划行（SIGNED 未生效）冲抵 vacuous，合同级累计
//      为唯一约束（裁决④：签约即收款；期次 received 相对合同 receivedAmount 低报为已知
//      语义，记 closeout）；扫完剩余或合同级 receivedAmount+amount>amount →
//      PAYMENT_AMOUNT_EXCEEDED 409 整事务回滚零残留；
//   5. Contract.receivedAmount += amount（互斥保护下 plain update 合法——互斥依据同上）；
//   6. payment.confirmed（恰 3 键）+ OperationLog PAYMENT_CONFIRM（{paymentNo,
//      contractId, fromStatus:'PENDING', toStatus:'CONFIRMED'}）→ 重读投影。
// 列表 listPayments：payment.read 范围经 { contract: … } 包裹 + 直过滤（status/
//   contractId/customerId）+ deletedAt null + 分页（形态镜像 listContracts：page 默认 1、
//   pageSize 默认 20 上限 100、createdAt DESC id ASC 决胜）。
// listPlans(contractId)：先合同可见性（payment.read 范围，不可见 CONTRACT_NOT_FOUND
//   404）再 plans ORDER BY period ASC。
// 无 deletePayment（FTN-001 §3.6：收款记录不得业务删除，删除仅超级管理员数据干预通道）。
//
// SPEC-011 Task 7: 冲销段（voidPayment，FIN-03 冲销侧）——方法追加于 ReceivableService
// 类内，规则镜像 confirmPayment 全形态：requireAction('payment.void') → reason 必填
// （normalizeRequiredText 1-500）→ payment 探查（payment.void 动作级范围经 { contract: … }
// 包裹+deletedAt null，PAYMENT_NOT_FOUND 404 不泄露）→ 事务内首把锁 = Contract 行
// FOR UPDATE（与 confirmPayment/executeRefundRequest 同序——冲销/确认/退款在同合同上整体
// 串行，无交叉持锁路径）→ 幂等翻转 updateMany {id, version, status:'CONFIRMED'}→VOIDED
// （voidedBy/voidedAt/voidReason、updatedBy、version+1；谓词仅此三项——协调者裁决①：
// 软删写入路径不存在，与 confirmPayment 翻转谓词同形）；count=0 → 重读：已 VOIDED →
// 返回现状投影（幂等重放，零事件零审计零回补——计划/合同 version 不增），其他态 →
// PAYMENT_STATE_INVALID 409 → sweepBackReceived（退款/冲销共享唯一实现，Task 6 交付；
// 前置=调用方已持 Contract 行锁，天然满足）→ payment.voided v1（恰 3 键——registry
// sourceModule CONTRACT、objectType PAYMENT，与 payment.created/confirmed 同族同形态）
// + OperationLog PAYMENT_VOID（{paymentNo, contractId, fromStatus:'CONFIRMED',
// toStatus:'VOIDED', hasReason:true}——reason 自由文本落 voidReason 业务列不落审计）。

import { randomUUID } from 'node:crypto';

import { Contract, Payment, PaymentPlan, Prisma, PrismaClient } from '@prisma/client';

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
  PAYMENT_CREATED,
  PAYMENT_CONFIRMED,
  PAYMENT_PLAN_CANCELLED,
  PAYMENT_STATUS,
  PAYMENT_VOIDED,
  PaymentCreatedV1,
  PaymentConfirmedV1,
  PaymentPlanCancelledV1,
  PaymentVoidedV1,
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
import { nextPaymentNo, nextPlanNo } from './contract-number-service';
import { buildContractScopeWhere } from './contract-scope';
import {
  ConfirmPaymentInput,
  CreatePaymentInput,
  ListPaymentsQuery,
  PagedResult,
  VoidPaymentInput,
} from './contract-types';
import {
  PaymentPlanView,
  PaymentView,
  projectPayment,
  projectPaymentPlan,
} from './payment-projection';

/** 默认一期计划的账期天数（paymentTerms 缺省时 dueDate = effectiveDate + 30 天）。 */
const DEFAULT_PLAN_PERIOD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// F-2：dueDate ISO 形态（等效 master-data-validation ISO_DATE/ISO_DATE_TIME——本地复刻
// 而非调用 parseIsoDate 的理由：parseIsoDate 抛 VALIDATION_FAILED，本路径单码纪律
// RECEIVABLE_PLAN_MISMATCH）。
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

interface PlanSpec {
  period: number;
  dueDate: Date;
  amount: Prisma.Decimal;
}

/**
 * 生效事务内生成应收计划（CON-07）。解析并校验 contract.paymentTerms 后逐条建档；
 * 任一校验失败抛 RECEIVABLE_PLAN_MISMATCH 400，由调用方事务整体回滚。
 * createdBy = effect 操作者（协调者补充裁决）。
 */
export async function generatePlansForEffect(
  tx: Prisma.TransactionClient,
  contract: Contract,
  effectiveDate: Date,
  createdBy: string,
): Promise<PaymentPlan[]> {
  const specs = parsePlanSpecs(contract, effectiveDate);
  const plans: PaymentPlan[] = [];
  for (const spec of specs) {
    plans.push(await tx.paymentPlan.create({
      data: {
        planNo: nextPlanNo(),
        contractId: contract.id,
        period: spec.period,
        dueDate: spec.dueDate,
        amount: spec.amount,
        createdBy,
      },
    }));
  }
  return plans;
}

/** paymentTerms → 计划规格序列：null/空串回落默认一期；显式文本委托共享解析器。 */
function parsePlanSpecs(contract: Contract, effectiveDate: Date): PlanSpec[] {
  const text = contract.paymentTerms;
  if (text === null || text.trim().length === 0) {
    return [{
      period: 1,
      dueDate: new Date(effectiveDate.getTime() + DEFAULT_PLAN_PERIOD_DAYS * MS_PER_DAY),
      amount: contract.amount,
    }];
  }
  return parseExplicitPlanSpecs(text, contract.amount);
}

/** 显式 paymentTerms 文本 → 计划规格序列：解析+全类校验（失败一律 MISMATCH 400）。 */
function parseExplicitPlanSpecs(text: string, amount: Prisma.Decimal): PlanSpec[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw planMismatch('paymentTerms is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw planMismatch('paymentTerms must be a JSON object with a plans array');
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'plans' || !Array.isArray(record.plans)) {
    throw planMismatch('paymentTerms must have exactly one key "plans" holding an array');
  }
  const rawPlans = record.plans as unknown[];
  if (rawPlans.length === 0) {
    throw planMismatch('paymentTerms plans must contain at least one period');
  }

  const specs = rawPlans.map((entry, index) => parsePlanEntry(entry, index + 1));
  const total = specs.reduce(
    (sum, spec) => sum.plus(spec.amount),
    new Prisma.Decimal(0),
  );
  if (!total.equals(amount)) {
    throw planMismatch(
      `plan sum ${total.toFixed(2)} does not equal contract amount ${amount.toFixed(2)}`,
    );
  }
  return specs;
}

/**
 * create 侧结构预校验（终审修复轮 F-1，stuck-SIGNED 根除）：paymentTerms 显式提供时
 * 复用生效路径同一解析器做纯结构校验——只验不建（null/空白 vacuous 通过：默认一期
 * 恒良构，默认期生成逻辑剥离在外）。失败抛 ContractError(RECEIVABLE_PLAN_MISMATCH, 400)。
 * 无 update API，create 预验一次即永真；effect 路径校验不变构成双闸。
 */
export function assertPaymentTermsStructurallyValid(
  paymentTerms: string | null,
  amount: Prisma.Decimal,
): void {
  if (paymentTerms === null || paymentTerms.trim().length === 0) return;
  parseExplicitPlanSpecs(paymentTerms, amount);
}

/** 单期条目校验：恰三键 {period, dueDate, amount}；period 必须等于位次（1..N 连续且有序）。 */
function parsePlanEntry(entry: unknown, expectedPeriod: number): PlanSpec {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw planMismatch(`plan entry ${expectedPeriod} must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 3 || keys[0] !== 'amount' || keys[1] !== 'dueDate' || keys[2] !== 'period') {
    throw planMismatch(`plan entry ${expectedPeriod} must have exactly the keys period, dueDate, amount`);
  }

  const period = record.period;
  if (typeof period !== 'number' || !Number.isInteger(period) || period !== expectedPeriod) {
    throw planMismatch(`plan periods must be consecutive 1..N in order (entry ${expectedPeriod} has period ${String(period)})`);
  }

  const dueDateRaw = record.dueDate;
  // F-2：ISO 形态校验先于解析（裸 new Date() 接受 '09/01/2026' 等非 ISO 串，时区漂移源）。
  if (typeof dueDateRaw !== 'string' || (!ISO_DATE.test(dueDateRaw) && !ISO_DATE_TIME.test(dueDateRaw))) {
    throw planMismatch(`plan entry ${expectedPeriod} dueDate must be an ISO date string`);
  }
  const dueDate = new Date(dueDateRaw);
  if (Number.isNaN(dueDate.getTime())) {
    throw planMismatch(`plan entry ${expectedPeriod} dueDate is not a valid date`);
  }
  // 真实日历日校验（等效 parseIsoDate：'2026-02-30' 之类的 rollover 拒绝）。
  if (ISO_DATE.test(dueDateRaw) && dueDate.toISOString().slice(0, 10) !== dueDateRaw) {
    throw planMismatch(`plan entry ${expectedPeriod} dueDate is not a real calendar date`);
  }

  const amountRaw = record.amount;
  if (typeof amountRaw !== 'string' && typeof amountRaw !== 'number') {
    throw planMismatch(`plan entry ${expectedPeriod} amount must be a decimal string or number`);
  }
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(amountRaw);
  } catch {
    throw planMismatch(`plan entry ${expectedPeriod} amount is not a valid decimal`);
  }
  if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 2) {
    throw planMismatch(`plan entry ${expectedPeriod} amount must be non-negative with scale <= 2`);
  }

  return { period, dueDate, amount };
}

function planMismatch(message: string): ContractError {
  return new ContractError(CONTRACT_ERROR_CODES.RECEIVABLE_PLAN_MISMATCH, 400, message);
}

// ==================== Task 9: 收款段（FIN-01） ====================

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
// paymentNo 随机码碰撞重试上限（同 lead-service/contract-service BUSINESS_NO_RETRY_LIMIT 纪律）。
const PAYMENT_NO_RETRY_LIMIT = 2;
// schema amount 为 Decimal(18,2)：16 位整数 + 2 位小数上限（D3 先例）。
const MAX_PAYMENT_AMOUNT = '9999999999999999.99';

/** 确认冲抵/终止联动时写入的期次状态词汇（OVERDUE 永不落库——逾期由查询时推导）。 */
type WritablePlanStatus = 'PENDING' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

export class ReceivableService {
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
   * 收款登记：payment.create → 规范化 → 合同探查（payment.create 动作级范围+未删，
   * 不可见/不存在 CONTRACT_NOT_FOUND 404 不泄露）→ 状态门禁（仅 SIGNED/EFFECTIVE，
   * 其余 CONTRACT_STATE_TRANSITION_INVALID 409——裁决：草稿合同禁收款）→ paymentPlanId
   * 4a 探针（属该合同否则 VALIDATION_FAILED 400）→ 同事务建档（paymentNo 碰撞重试
   * 上限 2）+ payment.created v1（恰 5 键）+ OperationLog（标识符+金额 only——
   * 自由文本落行不落审计）。customerId 抄自合同（冗余双锚，schema 必填列）。
   */
  async createPayment(input: CreatePaymentInput): Promise<PaymentView> {
    this.authorization.requireAction(this.authorizationContext, 'payment.create');
    assertExactKeys(input, [
      'contractId', 'caseNo', 'paymentPlanId', 'amount', 'method', 'account', 'paidAt', 'remark', 'idempotencyKey',
    ]);
    const contractId = normalizeRequiredText(input.contractId, 1, 100);
    const paymentPlanId = normalizeOptionalText(input.paymentPlanId, 100);
    const amount = normalizePaymentAmount(input.amount);
    const method = normalizeOptionalText(input.method, 100);
    const account = normalizeOptionalText(input.account, 100);
    const paidAt = parseIsoDate(input.paidAt);
    const remark = normalizeOptionalText(input.remark, 500);
    const idempotencyKey = normalizeOptionalText(input.idempotencyKey, 100);

    const scopeWhere = await this.buildScopeWhere('payment.create');
    const contract = await this.prisma.contract.findFirst({
      where: { AND: [scopeWhere, { id: contractId, deletedAt: null }] },
    });
    if (!contract) {
      throw new ContractError(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, 404, 'contract not found');
    }
    const caseNo = normalizeOptionalText(input.caseNo, 100);
    await assertFinancialCaseLink(this.prisma, this.authorizationContext, contractId, caseNo);


    // 期次探针（4a 模式）：存在且属该合同，否则 VALIDATION_FAILED 400。
    if (paymentPlanId !== null) {
      const plan = await this.prisma.paymentPlan.findFirst({
        where: { id: paymentPlanId },
        select: { id: true, contractId: true },
      });
      if (!plan || plan.contractId !== contractId) {
        throw new MasterDataError('VALIDATION_FAILED', 400);
      }
    }

    const created = await this.createWithPaymentNoRetry({
      contractId,
      paymentPlanId,
      customerId: contract.customerId,
      amount,
      method,
      account,
      paidAt,
      remark,
      status: 'PENDING',
      createdBy: this.actor.actorUserId,
    }, contract, idempotencyKey, caseNo);
    return projectPayment(created);
  }

  /**
   * 收款确认（FIN-01 三方同事务联动）：payment.confirm → payment 探查（范围经
   * { contract: … } 包裹+未删，PAYMENT_NOT_FOUND 404）→ Contract 行 FOR UPDATE
   * （事务内首把锁，同合同确认互斥）→ 幂等翻转（先决胜负后副作用——与
   * effectContract 先翻转后副作用同原则；败者重读已 CONFIRMED 返回现状零重冲）
   * → 冲抵（指定期次单期 / dueDate,period 升序贪心扫；applied 取 min；扫完剩余
   * 或合同级溢出 → PAYMENT_AMOUNT_EXCEEDED 409 整事务回滚零残留）→
   * Contract.receivedAmount 累加 → payment.confirmed v1（恰 3 键）+ OperationLog
   * PAYMENT_CONFIRM → 重读投影。
   * 互斥依据声明：所有确认事务首把锁同为 Contract 行（FOR UPDATE），同合同确认因此
   * 整体串行；串行保护下计划/合同行的上一写者必已提交，plain update（无 version 谓词）
   * 读到即最新、写即正确——乐观锁谓词在冲抵段为冗余。本事务内实际取锁序为
   * Contract→Payment（翻转）→PaymentPlan（冲抵），与设计 §9 表述（Contract→
   * PaymentPlan→Payment）的差异无死锁风险：死锁需两事务交叉持锁，而全部确认事务
   * 先取 Contract 锁（其他写者：effect 仅 INSERT 新计划行+翻转合同行，收款段之外
   * 无 Payment/PaymentPlan 既有行写者），不存在交叉持锁路径。
   */
  async confirmPayment(id: string, input: ConfirmPaymentInput): Promise<PaymentView> {
    this.authorization.requireAction(this.authorizationContext, 'payment.confirm');
    assertExactKeys(input, ['idempotencyKey']);
    // idempotencyKey 仅作接口位校验（S8 先例）：CONFIRMED 重放由翻转谓词覆盖。
    normalizeOptionalText(input.idempotencyKey, 100);
    const paymentId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('payment.confirm');

    return this.prisma.$transaction(async tx => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, deletedAt: null, AND: [scopeWhere, { contract: { deletedAt: null } }] },
      });
      if (!payment) {
        throw new ContractError(CONTRACT_ERROR_CODES.PAYMENT_NOT_FOUND, 404, 'payment not found');
      }

      // 同合同确认互斥：事务内首把锁（协调者裁决③）。持锁后重读合同（READ COMMITTED
      // 下取得锁即见最新已提交 receivedAmount——合同级溢出判定的输入必须新鲜）。
      await tx.$queryRaw`SELECT id FROM contract WHERE id = ${payment.contractId} FOR UPDATE`;
      const contract = await tx.contract.findUniqueOrThrow({ where: { id: payment.contractId } });

      // SPEC-012 Task 5：终止后不可再确认（竞速闭环——terminate 阻止 PENDING，但 confirm
      // 与 terminate 竞速时若 terminate 先胜，锁后确认到已终止合同由本门禁兜住）。
      if (contract.status === 'TERMINATED') {
        throw new ContractError(CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID, 409, 'cannot confirm payment for terminated contract');
      }

      // 幂等翻转：where 含 status:'PENDING'（+version 钉住探查读）。败者 count=0 → 重读：
      // 已 CONFIRMED → 返回现状投影零重冲（零事件零审计）；其他 → VERSION_CONFLICT 409。
      const flipped = await tx.payment.updateMany({
        where: { id: payment.id, version: payment.version, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          confirmedBy: this.actor.actorUserId,
          confirmedAt: new Date(),
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (flipped.count === 0) {
        const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        if (current.status === 'CONFIRMED') {
          return projectPayment(current);
        }
        throw new MasterDataError('VERSION_CONFLICT', 409);
      }

      // 冲抵（仅胜者）：指定 paymentPlanId → 该期单期；未指定 → PENDING/PARTIAL 计划
      // 按 dueDate,period 升序贪心扫。applied 取 min 后期内永不溢出（裁决口径：
      // 溢出判定 = 扫完仍有剩余）。
      let remaining = payment.amount;
      if (payment.paymentPlanId !== null) {
        remaining = await this.applyToPlan(tx, payment.paymentPlanId, remaining);
        if (!remaining.isZero()) {
          throw amountExceeded('payment exceeds the designated plan remainder');
        }
      } else {
        const plans = await tx.paymentPlan.findMany({
          where: { contractId: payment.contractId, status: { in: ['PENDING', 'PARTIAL'] } },
          orderBy: [{ dueDate: 'asc' }, { period: 'asc' }],
        });
        for (const plan of plans) {
          if (remaining.isZero()) break;
          remaining = await this.applyToPlan(tx, plan.id, remaining);
        }
        // 无计划行（SIGNED 未生效）冲抵 vacuous——合同级累计为唯一约束（裁决④）。
        if (plans.length > 0 && !remaining.isZero()) {
          throw amountExceeded('payment exceeds the remaining plan amount');
        }
      }
      if (contract.receivedAmount.plus(payment.amount).greaterThan(contract.amount)) {
        throw amountExceeded('payment exceeds the contract remaining amount');
      }

      // 互斥保护下 plain update（无 version 谓词，依据见方法注释——互斥依据声明）。
      await tx.contract.update({
        where: { id: contract.id },
        data: {
          receivedAmount: { increment: payment.amount },
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });

      const payload: PaymentConfirmedV1 = {
        paymentId: payment.id,
        contractId: contract.id,
        status: 'CONFIRMED',
      };
      await this.outbox.append(tx, this.envelope(payment.id, payload, contract, PAYMENT_CONFIRMED));
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'PAYMENT_CONFIRM',
          targetType: 'PAYMENT',
          targetId: payment.id,
          // 审计只落标识符+前后状态（无金额/自由文本——金额以合同/收款行为准）。
          newValues: JSON.stringify({
            paymentNo: payment.paymentNo,
            contractId: contract.id,
            fromStatus: 'PENDING',
            toStatus: 'CONFIRMED',
          }),
          ip: this.actor.ip,
        },
      });
      await notifyDeliveryChange(tx,this.actor.actorUserId,payment.id);
      const after = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return projectPayment(after);
    });
  }

  /**
   * 收款冲销（SPEC-011 Task 7，FIN-03 冲销侧）：payment.void → reason 必填（1-500）→
   * payment 探查（payment.void 动作级范围经 { contract: … } 包裹+未删，PAYMENT_NOT_FOUND
   * 404 不泄露）→ Contract 行 FOR UPDATE（事务内首把锁，与 confirmPayment/
   * executeRefundRequest 同序——冲销/确认/退款在同合同上整体串行；互斥依据声明同
   * confirmPayment 方法注释）→ 幂等翻转 updateMany {id, version, status:'CONFIRMED'}→
   * VOIDED（voidedBy/voidedAt/voidReason、updatedBy、version+1；先决胜负后副作用）；
   * count=0 → 重读：已 VOIDED → 返回现状投影零事件零审计零回补（幂等重放），其他态 →
   * PAYMENT_STATE_INVALID 409 → sweepBackReceived 资金回补（退款/冲销共享唯一实现；
   * 调用方已持 Contract 行锁，前置天然满足）→ payment.voided v1（恰 3 键）+
   * OperationLog PAYMENT_VOID（标识符+前后状态+hasReason:true——reason 自由文本落
   * voidReason 业务列不落审计）→ 重读投影。
   */
  async voidPayment(id: string, input: VoidPaymentInput): Promise<PaymentView> {
    this.authorization.requireAction(this.authorizationContext, 'payment.void');
    assertExactKeys(input, ['reason', 'idempotencyKey']);
    const reason = normalizeRequiredText(input.reason, 1, 500);
    // idempotencyKey 仅作接口位校验（S8 先例）：VOIDED 重放由翻转谓词覆盖。
    normalizeOptionalText(input.idempotencyKey, 100);
    const paymentId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('payment.void');

    return this.prisma.$transaction(async tx => {
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, deletedAt: null, AND: [scopeWhere, { contract: { deletedAt: null } }] },
      });
      if (!payment) {
        throw new ContractError(CONTRACT_ERROR_CODES.PAYMENT_NOT_FOUND, 404, 'payment not found');
      }

      // 事务内首把锁 = Contract 行 FOR UPDATE（锁序恒 Contract→Payment→PaymentPlan，
      // 与 confirmPayment/executeRefundRequest 全写路径同序，无交叉持锁路径）。
      await tx.$queryRaw`SELECT id FROM contract WHERE id = ${payment.contractId} FOR UPDATE`;
      const contract = await tx.contract.findUniqueOrThrow({ where: { id: payment.contractId } });

      // 幂等翻转：where 仅 {id, version, status:'CONFIRMED'}（协调者裁决①——软删写入
      // 路径不存在，与 confirmPayment 翻转谓词同形）。败者 count=0 → 重读：已 VOIDED →
      // 返回现状投影零重冲（零事件零审计零回补）；其他 → PAYMENT_STATE_INVALID 409。
      if(await tx.refundAllocation.count({where:{paymentId:payment.id}})) throw new MasterDataError('FINANCE_RECEIPT_HAS_REFUND',409);
      const flipped = await tx.payment.updateMany({
        where: { id: payment.id, version: payment.version, status: 'CONFIRMED' },
        data: {
          status: 'VOIDED',
          voidedBy: this.actor.actorUserId,
          voidedAt: new Date(),
          voidReason: reason,
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (flipped.count === 0) {
        const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        if (current.status === 'VOIDED') {
          return projectPayment(current);
        }
        throw new ContractError(
          CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID,
          409,
          `cannot void a payment in status ${current.status}`,
        );
      }

      // 资金回补（仅胜者；退款/冲销共享唯一实现）——调用方已持 Contract 行 FOR UPDATE 锁。
      await sweepBackReceived(tx, payment.contractId, payment.amount, this.actor.actorUserId);

      const payload: PaymentVoidedV1 = {
        paymentId: payment.id,
        contractId: contract.id,
        status: 'VOIDED',
      };
      await this.outbox.append(tx, this.envelope(payment.id, payload, contract, PAYMENT_VOIDED));
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'PAYMENT_VOID',
          targetType: 'PAYMENT',
          targetId: payment.id,
          // 审计只落标识符+前后状态+hasReason：reason 自由文本落 voidReason 业务列不落审计。
          newValues: JSON.stringify({
            paymentNo: payment.paymentNo,
            contractId: contract.id,
            fromStatus: 'CONFIRMED',
            toStatus: 'VOIDED',
            hasReason: true,
          }),
          ip: this.actor.ip,
        },
      });
      await notifyDeliveryChange(tx,this.actor.actorUserId,payment.id);
      const after = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return projectPayment(after);
    });
  }

  /**
   * 收款列表：payment.read + 范围经 { contract: … } 包裹 + status/contractId/customerId
   * 直过滤 + deletedAt null + 分页（形态镜像 listContracts）。
   */
  async listPayments(query: ListPaymentsQuery): Promise<PagedResult<PaymentView>> {
    this.authorization.requireAction(this.authorizationContext, 'payment.read');
    assertExactKeys(query, ['page', 'pageSize', 'status', 'contractId', 'customerId', 'caseNo']);
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const scopeWhere = await this.buildRecordScopeWhere('payment.read');

    const filters: Prisma.PaymentWhereInput[] = [{ AND: [scopeWhere, { contract: { deletedAt: null } }] }, { deletedAt: null }];
    if (query.status !== undefined) {
      filters.push({ status: normalizeAllowedValue(query.status, PAYMENT_STATUS) });
    }
    const contractId = normalizeOptionalText(query.contractId, 100);
    if (contractId) filters.push({ contractId });
    const customerId = normalizeOptionalText(query.customerId, 100);
    if (customerId) filters.push({ customerId });

    const caseNo = normalizeOptionalText(query.caseNo, 100);
    if (caseNo) filters.push({ contract: { case: await financialCaseFilter(this.prisma, this.authorizationContext, caseNo) } });

    const where: Prisma.PaymentWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        include: { contract: { select: { case: { select: { id: true, caseNo: true, title: true } } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: (await projectFinancialCases(this.prisma, this.authorizationContext, rows)).map(projectPayment),
      page,
      pageSize,
      total,
    };
  }

  /**
   * 收款详情（Task 10 自裁决 S16 追加——Task 10 路由表权威含 GET /api/v1/payments/:id，
   * 而 Task 9 产出仅 create/confirm/list/listPlans，详情方法缺位；本方法为纯读路径，
   * 逐字镜像 getContract 与 confirmPayment 探查段形态，零业务规则增量）：
   * payment.read + 范围经 { contract: … } 包裹 + deletedAt null；不存在/越权统一
   * PAYMENT_NOT_FOUND 404 不泄露存在性。
   */
  async getPayment(id: string): Promise<PaymentView> {
    this.authorization.requireAction(this.authorizationContext, 'payment.read');
    const paymentId = normalizeRequiredText(id, 1, 100);
    const scopeWhere = await this.buildRecordScopeWhere('payment.read');
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null, AND: [scopeWhere, { contract: { deletedAt: null } }] },
    });
    if (!payment) {
      throw new ContractError(CONTRACT_ERROR_CODES.PAYMENT_NOT_FOUND, 404, 'payment not found');
    }
    return projectPayment(payment);
  }

  /** 应收计划列表：payment.read + 先合同可见性（不可见/不存在 CONTRACT_NOT_FOUND 404）再 period 升序。 */
  async listPlans(contractId: string): Promise<PaymentPlanView[]> {
    this.authorization.requireAction(this.authorizationContext, 'payment.read');
    const id = normalizeRequiredText(contractId, 1, 100);
    const scopeWhere = await this.buildScopeWhere('payment.read');
    const contract = await this.prisma.contract.findFirst({
      where: { AND: [scopeWhere, { id, deletedAt: null }] },
      select: { id: true },
    });
    if (!contract) {
      throw new ContractError(CONTRACT_ERROR_CODES.CONTRACT_NOT_FOUND, 404, 'contract not found');
    }
    const plans = await this.prisma.paymentPlan.findMany({
      where: { contractId: id },
      orderBy: { period: 'asc' },
    });
    return plans.map(projectPaymentPlan);
  }

  /**
   * 单期冲抵：applied = min(剩余, 期余额)（取 min 后期内永不溢出）；期状态由累计
   * received 派生（0→PENDING、<amount→PARTIAL、≥amount→RECEIVED；永不写 OVERDUE）。
   * 返回冲抵后剩余。互斥保护下 plain update（无 version 谓词——同 confirmPayment
   * 互斥依据声明）；version 随写递增仅作观察性计数。
   */
  private async applyToPlan(
    tx: Prisma.TransactionClient,
    planId: string,
    amount: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    const plan = await tx.paymentPlan.findUniqueOrThrow({ where: { id: planId } });
    if (plan.status === 'CANCELLED') return amount; // SPEC-012 Task 5：CANCELLED 计划不再分摊
    const applied = Prisma.Decimal.min(amount, plan.amount.minus(plan.receivedAmount));
    if (applied.isZero()) return amount;
    const received = plan.receivedAmount.plus(applied);
    const status: WritablePlanStatus = received.isZero()
      ? 'PENDING'
      : (received.lessThan(plan.amount) ? 'PARTIAL' : 'RECEIVED');
    await tx.paymentPlan.update({
      where: { id: plan.id },
      data: { receivedAmount: received, status, version: { increment: 1 } },
    });
    return amount.minus(applied);
  }

  private async createWithPaymentNoRetry(
    data: Omit<Prisma.PaymentUncheckedCreateInput, 'paymentNo'>,
    contract: Pick<Contract, 'branchId' | 'professionalTeamId'>,
    idempotencyKey: string | null,
    caseNo: string | null,
  ): Promise<Payment> {
    const replayScope = await this.buildRecordScopeWhere('payment.create');
    for (let attempt = 0; attempt < PAYMENT_NO_RETRY_LIMIT; attempt += 1) {
      try {
        return await createOnce(this.prisma, { actorId: this.actor.actorUserId, key: idempotencyKey, operation: 'payment.create', normalized: { ...data, amount: new Prisma.Decimal(String(data.amount)).toFixed(2), caseNo } }, async tx => {
          // SPEC-014 Task 2：首把锁 = Contract 行 FOR UPDATE（仿 confirmPayment :413-414），
          // 持锁后重验状态——关闭 createPayment 与 terminate 竞速（createPayment 事务外预读
          // 通过后 terminate 先胜 → 锁后重验 TERMINATED → 409，杜绝 PENDING 固化到已终止
          // 合同）。锁序 Contract→Payment 与 confirmPayment/void/refund 同序，无交叉持锁路径。
          await tx.$queryRaw`SELECT id FROM contract WHERE id = ${data.contractId} FOR UPDATE`;
          const freshContract = await tx.contract.findUniqueOrThrow({ where: { id: data.contractId } });
          if (freshContract.status !== 'SIGNED' && freshContract.status !== 'EFFECTIVE') {
            throw new ContractError(
              CONTRACT_ERROR_CODES.CONTRACT_STATE_TRANSITION_INVALID,
              409,
              `cannot register payment for contract in status ${freshContract.status}`,
            );
          }
          const payment = await tx.payment.create({
            data: { ...data, paymentNo: nextPaymentNo() },
          });
          const payload: PaymentCreatedV1 = {
            paymentId: payment.id,
            paymentNo: payment.paymentNo,
            contractId: payment.contractId,
            customerId: payment.customerId,
            status: 'PENDING',
          };
          await this.outbox.append(tx, this.envelope(payment.id, payload, contract, PAYMENT_CREATED));
          await tx.operationLog.create({
            data: {
              userId: this.actor.actorUserId,
              action: 'PAYMENT_CREATE',
              targetType: 'PAYMENT',
              targetId: payment.id,
              // 审计只落标识符+金额：method/account/remark 自由文本落行不落审计（裁决⑥）。
              newValues: JSON.stringify({
                paymentNo: payment.paymentNo,
                contractId: payment.contractId,
                amount: payment.amount.toFixed(2),
              }),
              ip: this.actor.ip,
            },
          });
          return payment;
        }, async (tx, targetId) => {
          const existing = await tx.payment.findFirst({ where: { id: targetId, AND: [replayScope, { contract: { deletedAt: null } }], deletedAt: null } });
          if (!existing) throw new ContractError(CONTRACT_ERROR_CODES.PAYMENT_NOT_FOUND, 404, 'record not found');
          return existing;
        });
      } catch (error) {
        if (attempt + 1 < PAYMENT_NO_RETRY_LIMIT && isUniqueConflictOn(error, 'paymentNo')) continue;
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /**
   * 收款动作级合同范围：以 resource='payment' 解析范围目标（自裁决 S15——catalog
   * resource 为 'payment'，授权上下文按 (resource, permissionCode) 双键过滤，缺省
   * 'contract' 恒空集 fail-closed，Task 7 S2 同陷阱），锚定合同列；本方法仅做委托。
   */
  private async buildRecordScopeWhere(permissionCode: PermissionCode): Promise<FinancialRecordScope> {
    return buildFinancialRecordScopeWhere(this.prisma, this.authorization, this.authorizationContext, permissionCode, 'payment');
  }

  private async buildScopeWhere(permissionCode: PermissionCode): Promise<Prisma.ContractWhereInput> {
    return buildContractScopeWhere(
      this.prisma,
      this.authorization,
      this.authorizationContext,
      permissionCode,
      'payment',
    );
  }

  /** 事件信封：organizationId 恒 null（同 contract-service），branchId/teamId 锚定合同自身组织列。 */
  private envelope(
    objectId: string,
    payload: PaymentCreatedV1 | PaymentConfirmedV1 | PaymentVoidedV1,
    contract: Pick<Contract, 'branchId' | 'professionalTeamId'>,
    eventType: string,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType: 'PAYMENT',
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
 * 收款金额入参：必填、>0、scale≤2、不超 Decimal(18,2) 精度（本地镜像
 * contract-service normalizeContractAmount 纪律并收紧为正数——收款口径 amount>0；
 * 镜像而非 export 复用的理由：避免 receivable-service ↔ contract-service ESM 循环
 * 引用——contract-service 已 import 本模块的 generatePlansForEffect）。
 */
function normalizePaymentAmount(value: unknown): Prisma.Decimal {
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
  if (amount.greaterThan(MAX_PAYMENT_AMOUNT)) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return amount;
}

function amountExceeded(message: string): ContractError {
  return new ContractError(CONTRACT_ERROR_CODES.PAYMENT_AMOUNT_EXCEEDED, 409, message);
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

// ==================== SPEC-011 Task 6: 资金回补（退款/冲销共享唯一实现） ====================

/**
 * 资金回补（退款/冲销共享，SPEC-011 Task 6）：调用方须已持 Contract 行 FOR UPDATE 锁
 * （confirmPayment 互斥依据声明同原则——串行保护下 plain update 读到即最新）。
 * 步骤：合同 receivedAmount 下溢守卫 → 有 receivedAmount 的计划按 dueDate DESC, period DESC
 * 逐期冲减（deduct=min(剩余, plan.receivedAmount)）→ 每期重推导状态
 * （=0→PENDING、<amount→PARTIAL、=amount→RECEIVED；永不写 OVERDUE）→ 合同 receivedAmount −= amount。
 * 无计划行（SIGNED 未生效收款）计划冲减 vacuous，仅合同级冲减。
 */
export async function sweepBackReceived(
  tx: Prisma.TransactionClient,
  contractId: string,
  amount: Prisma.Decimal,
  actorUserId: string,
): Promise<void> {
  const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  const next = contract.receivedAmount.minus(amount);
  if (next.isNegative()) {
    throw new ContractError(CONTRACT_ERROR_CODES.PAYMENT_STATE_INVALID, 409, 'sweep-back exceeds contract receivedAmount');
  }
  let remaining = amount;
  const plans = await tx.paymentPlan.findMany({
    where: { contractId, receivedAmount: { gt: 0 } },
    orderBy: [{ dueDate: 'desc' }, { period: 'desc' }],
  });
  for (const plan of plans) {
    if (remaining.isZero()) break;
    const deduct = Prisma.Decimal.min(remaining, plan.receivedAmount);
    const received = plan.receivedAmount.minus(deduct);
    // SPEC-012 Task 5：CANCELLED 为终态恒终态——回补仅冲减 receivedAmount，状态不回 PENDING。
    const status = plan.status === 'CANCELLED'
      ? 'CANCELLED'
      : (received.isZero() ? 'PENDING' : (received.lessThan(plan.amount) ? 'PARTIAL' : 'RECEIVED'));
    await tx.paymentPlan.update({
      where: { id: plan.id },
      data: { receivedAmount: received, status, version: { increment: 1 } },
    });
    remaining = remaining.minus(deduct);
  }
  await tx.contract.update({
    where: { id: contractId },
    data: { receivedAmount: next, updatedBy: actorUserId, version: { increment: 1 } },
  });
}

// ==================== SPEC-012 Task 3: 计划取消（终止联动） ====================

/**
 * 计划期望取消（SPEC-012 Task 3）：调用方须已持 Contract 行 FOR UPDATE 锁。
 * 未清计划（PENDING/PARTIAL）逐计划转 CANCELLED（amount 保原始期望额、receivedAmount
 * 保实际已收），同事务 outbox 逐计划发 payment_plan.cancelled；RECEIVED 不动；返回 count。
 * 偏离 brief 的 record：brief 函数体含 `updatedBy: actorUserId`，但 schema PaymentPlan
 * 无 updatedBy 列（payment_plan 迁移仅有 createdBy/updatedAt），逐字保留即 tsc 必红——
 * 故 plan update 仅 {status, version}，actorUserId 仍用于事件信封 operatorUserId。
 */
export async function cancelUnsettledPlans(
  tx: Prisma.TransactionClient,
  contract: Pick<Contract, 'id' | 'branchId' | 'professionalTeamId'>,
  outbox: EventOutboxWriter,
  actorUserId: string,
): Promise<{ canceledCount: number }> {
  const plans = await tx.paymentPlan.findMany({
    where: { contractId: contract.id, status: { in: ['PENDING', 'PARTIAL'] } },
    orderBy: [{ dueDate: 'asc' }, { period: 'asc' }],
  });
  for (const plan of plans) {
    await tx.paymentPlan.update({
      where: { id: plan.id },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    const payload: PaymentPlanCancelledV1 = { planId: plan.id, contractId: contract.id, status: 'CANCELLED' };
    await outbox.append(tx, {
      eventType: PAYMENT_PLAN_CANCELLED,
      eventVersion: 1,
      objectType: 'PAYMENT_PLAN',
      objectId: plan.id,
      operatorUserId: actorUserId,
      organizationId: null,
      branchId: contract.branchId ?? null,
      teamId: contract.professionalTeamId ?? null,
      payload,
      traceId: randomUUID(),
      occurredAt: new Date(),
    });
  }
  return { canceledCount: plans.length };
}
