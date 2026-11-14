// SPEC-010 Task 11: 合同 API 客户端，逐条对齐 Task 10 冻结路由表。
// 纪律：仅经 src/api/request 封装（SPEC-006 鉴权/CSRF 拦截器），禁止裸 fetch；
// 包络 { code, message, data }；合同无 update 端点（创建后仅经动作路由流转，设计如此）；
// 金额以 toFixed(2) 字符串投影，前端原样渲染不转 number。
import request from './request';
import type { ApiResponse } from '@/types';
import type { PagedResult } from './types';
import type { PaymentPlanView } from './payment';

export const CONTRACT_TYPES = ['FIRST_SIGN', 'FORMAL', 'SUPPLEMENT', 'RISK_NOTICE'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'PENDING_SIGN',
  'SIGNED',
  'EFFECTIVE',
  'TERMINATED',
  'VOID',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_ACTIONS = [
  'submit',
  'approve',
  'reject',
  'sign',
  'effect',
  'terminate',
  'void',
] as const;
export type ContractAction = (typeof CONTRACT_ACTIONS)[number];

export const CONTRACT_SOURCE_TYPES = ['CUSTOMER', 'NEGOTIATION', 'ANALYSIS', 'CASE'] as const;
export type ContractSourceType = (typeof CONTRACT_SOURCE_TYPES)[number];

/** 镜像 apps/server app/application/contract/contract-types.ts ContractView（日期传输层为 ISO 串）。 */
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
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalComment: string | null;
  signDate: string | null;
  esignLinkId: string | null;
  esignSerialNo: string | null;
  esignStatus: string | null;
  effectiveDate: string | null;
  terminatedAt: string | null;
  terminateReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  startDate: string | null;
  endDate: string | null;
  paymentTerms: string | null;
  terms: string | null;
  createdBy: string;
  updatedBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 contract-types.ts CreateContractInput。 */
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
  /** JSON 文本 { plans: [{ period, dueDate, amount }] }；null → 生效时默认一期 dueDate+30d。 */
  paymentTerms?: string | null;
  startDate?: string;
  endDate?: string;
  terms?: string;
  branchId?: string;
  professionalTeamId?: string;
}

/** 镜像 contract-types.ts ApproveContractInput（comment 可选）。 */
export interface ApproveContractInput {
  comment?: string;
}

/** 镜像 contract-types.ts RejectContractInput（comment 必填）。 */
export interface RejectContractInput {
  comment: string;
}

/** 镜像 contract-types.ts SignContractInput。 */
export interface SignContractInput {
  /** ISO 日期/时间串；缺省取服务端当前时间。 */
  signDate?: string;
  esignLinkId?: string;
  esignSerialNo?: string;
  esignStatus?: string;
}

/** 镜像 contract-types.ts EffectContractInput。 */
export interface EffectContractInput {
  conflictReview?: {fingerprint:string;reason:string};
  /** ISO 日期/时间串；缺省取服务端当前时间。 */
  effectiveDate?: string;
  idempotencyKey?: string;
}

/** 镜像 contract-types.ts TerminateContractInput（reason 必填）。 */
export interface TerminateContractInput {
  reason: string;
}

/** 镜像 contract-types.ts VoidContractInput（reason 必填）。 */
export interface VoidContractInput {
  reason: string;
}

/** 镜像 contract-types.ts ContractListQuery。 */
export interface ContractListQuery {
  branchId?: string;
  caseNo?: string;
  page?: number;
  pageSize?: number;
  status?: ContractStatus;
  contractType?: ContractType;
  customerId?: string;
  /** 模糊匹配 contractNo/title（大小写不敏感）。 */
  keyword?: string;
}

export const contractApi = {
  /** POST /api/v1/contracts（contract.create）：四来源创建，初始 DRAFT。 */
  create: (data: CreateContractInput) =>
    request.post<ApiResponse<ContractView>>('/v1/contracts', data),
  /** GET /api/v1/contracts */
  list: (params?: ContractListQuery) =>
    request.get<ApiResponse<PagedResult<ContractView>>>('/v1/contracts', { params }),
  /** GET /api/v1/contracts/:id */
  detail: (id: string) =>
    request.get<ApiResponse<ContractView>>(`/v1/contracts/${id}`),
  /** POST /api/v1/contracts/:id/submit（contract.submit）：DRAFT→政策分流。 */
  submit: (id: string) =>
    request.post<ApiResponse<ContractView>>(`/v1/contracts/${id}/submit`),
  /** POST /api/v1/contracts/:id/approve（contract.approve）：PENDING_APPROVAL→PENDING_SIGN。 */
  approve: (id: string, data: ApproveContractInput = {}) =>
    request.post<ApiResponse<ContractView>>(`/v1/contracts/${id}/approve`, data),
  /** POST /api/v1/contracts/:id/reject（contract.approve）：PENDING_APPROVAL→DRAFT，comment 必填。 */
  reject: (id: string, data: RejectContractInput) =>
    request.post<ApiResponse<ContractView>>(`/v1/contracts/${id}/reject`, data),
  /** POST /api/v1/contracts/:id/sign（contract.sign）：PENDING_SIGN→SIGNED。 */
  sign: (id: string, data: SignContractInput = {}) =>
    request.post<ApiResponse<ContractView>>(`/v1/contracts/${id}/sign`, data),
  /** POST /api/v1/contracts/:id/effect（contract.effect）：SIGNED→EFFECTIVE + 生效事务矩阵。 */
  effect: (id: string, data: EffectContractInput = {}) =>
    request.post<ApiResponse<ContractView>>(`/v1/contracts/${id}/effect`, data),
  /** POST /api/v1/contracts/:id/terminate（contract.terminate）：EFFECTIVE→TERMINATED，reason 必填。 */
  terminate: (id: string, data: TerminateContractInput) =>
    request.post<ApiResponse<ContractView>>(`/v1/contracts/${id}/terminate`, data),
  /** POST /api/v1/contracts/:id/void（contract.void）：DRAFT|PENDING_APPROVAL|PENDING_SIGN→VOID，reason 必填。 */
  void: (id: string, data: VoidContractInput) =>
    request.post<ApiResponse<ContractView>>(`/v1/contracts/${id}/void`, data),
  /** GET /api/v1/contracts/:id/plans（payment.read）：应收计划（挂合同路径下的子资源）。 */
  plans: (id: string) =>
    request.get<ApiResponse<PaymentPlanView[]>>(`/v1/contracts/${id}/plans`),
};
