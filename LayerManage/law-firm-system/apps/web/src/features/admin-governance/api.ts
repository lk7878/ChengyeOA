import request from '@/api/request';
import type { ApiResponse } from '@/types';
import type {
  AdminOperationDetail, AdminOperationSummary, CreateGovernanceOperationInput,
  GovernanceCatalogEntry, GovernanceListQuery, GovernancePage, GovernanceUserTarget,
  ReviewGovernanceOperationInput, VersionedGovernanceAction,
} from './types';

export const governanceApi = {
  catalog: () => request.get<ApiResponse<GovernanceCatalogEntry[]>>('/v1/admin-governance/catalog'),
  userTargets: (keyword?: string) => request.get<ApiResponse<GovernanceUserTarget[]>>(
    '/v1/admin-governance/targets/users', { params: { keyword } },
  ),
  list: (params?: GovernanceListQuery) => request.get<ApiResponse<GovernancePage<AdminOperationSummary>>>(
    '/v1/admin-governance/operations', { params },
  ),
  detail: (id: string) => request.get<ApiResponse<AdminOperationDetail>>(`/v1/admin-governance/operations/${id}`),
  create: (data: CreateGovernanceOperationInput, stepUpToken?: string) => request.post<ApiResponse<AdminOperationDetail>>(
    '/v1/admin-governance/operations', data, stepUpConfig(stepUpToken),
  ),
  review: (id: string, data: ReviewGovernanceOperationInput, stepUpToken?: string) => request.post<ApiResponse<AdminOperationDetail>>(
    `/v1/admin-governance/operations/${id}/review`, data, stepUpConfig(stepUpToken),
  ),
  cancel: (id: string, data: VersionedGovernanceAction) => request.post<ApiResponse<AdminOperationDetail>>(`/v1/admin-governance/operations/${id}/cancel`, data),
  retry: (id: string, data: VersionedGovernanceAction, stepUpToken?: string) => request.post<ApiResponse<AdminOperationDetail>>(
    `/v1/admin-governance/operations/${id}/retry`, data, stepUpConfig(stepUpToken),
  ),
};

function stepUpConfig(token?: string) {
  return token ? { headers: { 'X-Step-Up-Token': token } } : undefined;
}

const LABELS: Readonly<Record<string, string>> = Object.freeze({
  GOVERNANCE_OPERATION_NOT_ALLOWED: '当前账号不能发起或处理该治理操作',
  GOVERNANCE_SELF_REVIEW_FORBIDDEN: '申请人不能审核自己的治理申请',
  GOVERNANCE_REVIEW_TARGET_CONFLICT: '审核人不能审核以本人为目标的管理员操作',
  OPERATION_ALREADY_PROCESSED: '治理申请已被处理，请刷新后查看最新状态',
  IDEMPOTENCY_KEY_REUSED: '该请求标识已用于另一组参数',
  STALE_TARGET_VERSION: '目标已发生变化，请刷新后重新申请',
  PAYLOAD_HASH_MISMATCH: '治理参数完整性校验失败',
  LAST_SUPER_ADMIN_PROTECTED: '不能移除或停用最后一名有效超级管理员',
  RECOVERY_WINDOW_NOT_AVAILABLE: '当前不满足第二名超级管理员恢复条件',
  OPERATION_NOT_RETRYABLE: '该失败操作不允许重试',
  TARGET_NOT_ELIGIBLE: '目标或请求参数不符合治理条件',
  RESOURCE_NOT_FOUND_OR_FORBIDDEN: '记录不存在或当前账号无权查看',
});

export function governanceErrorMessage(code: string): string {
  return LABELS[code] ?? `治理请求失败（${code}）`;
}
