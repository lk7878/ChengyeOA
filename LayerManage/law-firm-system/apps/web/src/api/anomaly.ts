// SPEC-011 Task 11: 财务异常台账 API 客户端，逐条对齐 Task 10 冻结路由表（FIN-05）。
// 纪律：仅经 src/api/request 封装（SPEC-006 鉴权/CSRF 拦截器），禁止裸 fetch；纯只读四端点；
// 包络 { code, message, data }；金额以 toFixed(2) 字符串投影，前端原样渲染不转 number。
// received-uninvoiced 口径 total = 候选池 count（Task 9/10 已文档化——页级过滤无法在常数页
// 上推导全量过滤后总数），分页条渲染按此语义（页内条数可 < pageSize）。
import request from './request';
import type { ApiResponse } from '@/types';
import type { PagedResult } from './types';
import type { ContractStatus, ContractType } from './contract';

/** 镜像 apps/server app/application/finance/anomaly-service.ts AnomalyContractView（日期传输层为 ISO 串）。 */
export interface AnomalyContractView {
  contractId: string;
  contractNo: string;
  contractType: ContractType;
  customerId: string;
  amount: string;
  receivedAmount: string;
  status: ContractStatus;
  signDate: string | null;
  effectiveDate: string | null;
  /** 缺口额：仅 received-uninvoiced 口径非空，其余恒 null。 */
  gapAmount: string | null;
}

/** 镜像 finance-types.ts AnomalyListQuery。 */
export interface ListAnomaliesQuery {
  page?: number;
  pageSize?: number;
}

/** FIN-05 四口径字面量路由（字面量先于任何 /:id 冲突，前缀不同无遮蔽）。 */
export const ANOMALY_ENDPOINTS = {
  signedUnpaid: '/v1/finance/anomalies/signed-unpaid',
  receivedUninvoiced: '/v1/finance/anomalies/received-uninvoiced',
  firstSignNoFormal: '/v1/finance/anomalies/first-sign-no-formal',
  paidNoCase: '/v1/finance/anomalies/paid-no-case',
} as const;

export const anomalyApi = {
  /** GET /api/v1/finance/anomalies/signed-unpaid：已签未收（SIGNED/EFFECTIVE 且分文未收），gapAmount 恒 null。 */
  listSignedUnpaid: (params?: ListAnomaliesQuery) =>
    request.get<ApiResponse<PagedResult<AnomalyContractView>>>(ANOMALY_ENDPOINTS.signedUnpaid, { params }),
  /** GET /api/v1/finance/anomalies/received-uninvoiced：已收未开票（receivedAmount > COMPLETED 发票累计），gapAmount 非空。 */
  listReceivedUninvoiced: (params?: ListAnomaliesQuery) =>
    request.get<ApiResponse<PagedResult<AnomalyContractView>>>(ANOMALY_ENDPOINTS.receivedUninvoiced, { params }),
  /** GET /api/v1/finance/anomalies/first-sign-no-formal：首签未二签（同客户无正式委托）。 */
  listFirstSignNoFormal: (params?: ListAnomaliesQuery) =>
    request.get<ApiResponse<PagedResult<AnomalyContractView>>>(ANOMALY_ENDPOINTS.firstSignNoFormal, { params }),
  /** GET /api/v1/finance/anomalies/paid-no-case：收款未建案（已收 FORMAL 且未关联案件）。 */
  listPaidNoCase: (params?: ListAnomaliesQuery) =>
    request.get<ApiResponse<PagedResult<AnomalyContractView>>>(ANOMALY_ENDPOINTS.paidNoCase, { params }),
};
