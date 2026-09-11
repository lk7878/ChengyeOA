// SPEC-010 Task 6: contract 模块 DTO 与视图类型（本任务先服务 Negotiation；Task 7/9 扩展复用）。
// NegotiationView 为全字段投影：金额不脱敏（设计 §8 决策——金额非 L3，以数据范围+动作权限控制），
// quotedAmount 以 string 投影（Prisma.Decimal toFixed(2)，避免 JSON 浮点精度损失与尾零漂移）。
// PagedResult 复用 SPEC-009 lead-types 同构形态（list/page/pageSize/total），不重定义。
// Task 7 扩展：Contract 四类型创建/流转 DTO 与 ContractView 全字段投影（esignCallbackPayload
// 为 CON-05 预留原始回调载荷，不入视图）。
// Task 8 扩展：生效/终止/作废 DTO（原因必填落业务列，不落审计值——裁决 9）。
// Task 9 扩展：收款 DTO（FIN-01；PaymentView/PaymentPlanView 视图类型归 payment-projection.ts——
// 协调者裁决 7：投影与视图类型同文件，逐段镜像 contract-projection.ts）。

import type { ContractSourceType, NegotiationStatus, PaymentStatus } from '../../domain/events/event-types';
import type { ContractStatus, ContractType } from '../../domain/contract/contract-policy';

export type { PagedResult } from '../crm/lead-types';

export interface CreateNegotiationInput {
  customerId: string;
  leadId?: string;
  appointmentId?: string;
  negotiatorEmployeeId: string;
  quotedAmount?: string | number;
  customerConcerns?: string;
  competitorInfo?: string;
  remark?: string;
  /** 显式组织锚（协调者裁决：显式输入 > leadId 继承 > null 公海语义）。 */
  branchId?: string;
  professionalTeamId?: string;
}

export interface UpdateNegotiationInput {
  negotiatorEmployeeId?: string;
  quotedAmount?: string | number;
  customerConcerns?: string;
  competitorInfo?: string;
  remark?: string;
}

export interface CloseNegotiationInput {
  outcome: 'SIGNED' | 'UNSIGNED';
  unsignedReason?: string;
}

export interface NegotiationListQuery {
  page?: number;
  pageSize?: number;
  status?: NegotiationStatus;
  customerId?: string;
}

/** Negotiation 输出视图：全字段投影（无 L3 字段，金额不脱敏），不含 deletedAt。 */
export interface NegotiationView {
  id: string;
  negotiationNo: string;
  customerId: string;
  leadId: string | null;
  appointmentId: string | null;
  negotiatorEmployeeId: string;
  quotedAmount: string | null;
  customerConcerns: string | null;
  competitorInfo: string | null;
  status: NegotiationStatus;
  unsignedReason: string | null;
  signedAt: Date | null;
  remark: string | null;
  branchId: string | null;
  professionalTeamId: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== Task 7: 合同（服务 A：创建/提交/审批/驳回/签署） ====================

export interface CreateContractInput {
  contractType: ContractType;
  title: string;
  customerId: string;
  /** 缺省 CUSTOMER；NEGOTIATION 时 negotiationId 必填。 */
  sourceType?: ContractSourceType;
  sourceId?: string;
  negotiationId?: string;
  /** SUPPLEMENT 必填，其余类型禁填（提供则 400）。 */
  parentContractId?: string;
  /** 提供时须存在且 enabled，快照 templateCode+templateVersion。 */
  templateCode?: string;
  amount?: string | number;
  paymentTerms?: string;
  startDate?: string;
  endDate?: string;
  terms?: string;
  /** 显式组织锚（提供时 4a 存在性校验；code 供编号解析，缺省 HQ/ALL）。 */
  branchId?: string;
  professionalTeamId?: string;
}

export interface ApproveContractInput {
  comment?: string;
}

export interface RejectContractInput {
  /** 驳回原因必填（400）。 */
  comment: string;
}

export interface SignContractInput {
  /** ISO 日期/时间串；缺省取服务端当前时间。 */
  signDate?: string;
  esignLinkId?: string;
  esignSerialNo?: string;
  esignStatus?: string;
}

// ==================== Task 8: 生效/终止/作废 ====================

export interface EffectContractInput {
  /** ISO 日期/时间串；缺省取服务端当前时间。 */
  effectiveDate?: string;
  /**
   * 幂等键接口位（设计 §6.3）：生效由状态机天然幂等（EFFECTIVE 重放返回现状，
   * 不重复生成计划/案件/委托/事件/审计），键本身不持久化。
   */
  idempotencyKey?: string;
}

export interface TerminateContractInput {
  /** 终止原因必填（400）；落合同业务列 terminateReason，审计仅落 hasReason 布尔（裁决 9）。 */
  reason: string;
}

export interface VoidContractInput {
  /** 作废原因必填（400）；落合同业务列 voidReason，审计仅落 hasReason 布尔（裁决 9）。 */
  reason: string;
}

export interface ContractListQuery {
  caseNo?: string;
  page?: number;
  pageSize?: number;
  status?: ContractStatus;
  contractType?: ContractType;
  customerId?: string;
  /** 模糊匹配 contractNo/title（大小写不敏感）。 */
  keyword?: string;
}

/**
 * Contract 输出视图：全字段投影（无 L3 字段，金额不脱敏——设计 §8），
 * amount/receivedAmount 以 string 投影（toFixed(2)，D3 先例）；不含 deletedAt 与
 * esignCallbackPayload（CON-05 预留原始回调载荷，非视图材料）。
 */
export interface ContractView {
  id: string;
  contractNo: string;
  contractType: ContractType;
  title: string;
  customerId: string;
  sourceType: ContractSourceType;
  sourceId: string | null;
  negotiationId: string | null;
  parentContractId: string | null;
  templateCode: string | null;
  templateVersion: number | null;
  branchId: string | null;
  professionalTeamId: string | null;
  amount: string;
  receivedAmount: string;
  status: ContractStatus;
  submittedBy: string | null;
  submittedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  approvalComment: string | null;
  signDate: Date | null;
  esignLinkId: string | null;
  esignSerialNo: string | null;
  esignStatus: string | null;
  effectiveDate: Date | null;
  terminatedAt: Date | null;
  terminateReason: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  startDate: Date | null;
  endDate: Date | null;
  paymentTerms: string | null;
  terms: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== Task 9: 收款（登记/确认/列表，FIN-01） ====================

export interface CreatePaymentInput {
  caseNo?: string;
  contractId: string;
  /** 指定冲抵期次；提供时须属该合同（4a 探针，否则 VALIDATION_FAILED 400）。 */
  paymentPlanId?: string;
  /** 必填：>0、scale≤2、不超 Decimal(18,2) 精度界（同合同金额纪律，收款口径收紧为正数）。 */
  amount: string | number;
  method?: string;
  account?: string;
  /** ISO 日期/时间串（到账时间）。 */
  paidAt?: string;
  remark?: string;
  /**
   * 幂等键接口位（不持久化）：Payment 无唯一 FK 幂等挡板，重放保护由 paymentNo
   * P2002 碰撞重试（上限 2，lead 先例）承担——与 Task 8 裁决⑪（AE/CA 有 @unique
   * 挡板不重试）区隔。
   */
  idempotencyKey?: string;
}

export interface ConfirmPaymentInput {
  /**
   * 幂等键接口位（不持久化，S8 先例）：已 CONFIRMED 重放返回现状由翻转谓词
   * {id, version, status:'PENDING'} 覆盖，零重冲零重复事件。
   */
  idempotencyKey?: string;
}

export interface ListPaymentsQuery {
  caseNo?: string;
  page?: number;
  pageSize?: number;
  status?: PaymentStatus;
  contractId?: string;
  customerId?: string;
}

// ==================== SPEC-011 Task 7: 收款冲销（voidPayment，FIN-03 冲销侧） ====================

export interface VoidPaymentInput {
  /**
   * 冲销原因必填（缺/空/全空白/超 500 → VALIDATION_FAILED 400）；落 payment.voidReason
   * 业务列，审计仅落 hasReason:true（reason 自由文本不落审计——refund 同型纪律）。
   */
  reason: string;
  /**
   * 幂等键接口位（不持久化，S8 先例）：已 VOIDED 重放返回现状由翻转谓词
   * {id, version, status:'CONFIRMED'} 覆盖，零重冲零重复事件零重复审计。
   */
  idempotencyKey?: string;
}
