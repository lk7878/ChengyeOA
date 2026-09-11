// SPEC-013 Task 8: 审批中心 API 客户端，逐条对齐 Task 6 冻结路由表。
// 纪律：仅经 src/api/request 封装（SPEC-006 鉴权/CSRF 拦截器），禁止裸 fetch；
// 包络 { code, message, data }；列表 role 必填透传；process 的 :id 实为 taskId
// （Task 6 控制器将 ctx.params.id 直传 processTask(taskId, ...)——见 router.ts:237），
// withdraw 的 :id 为 instanceId。三权限码：approval.read（列表/详情）、
// approval.apply（definitions/申请/撤回）、approval.process（处理）。
import request from './request';
import type { ApiResponse } from '@/types';
import type { PagedResult } from './types';

// SPEC-023 Task 2：全组织视图——listInstances 增 role='ALL'（approval.manage 门控，无 actor 过滤）。
// 四 role 镜像后端 approval-types.ts APPROVAL_ROLE_FILTERS（APPLIED/TODO/DONE/ALL）。
export const APPROVAL_ROLES = ['APPLIED', 'TODO', 'DONE', 'ALL'] as const;
export type ApprovalRoleFilter = (typeof APPROVAL_ROLES)[number];

export const APPROVAL_BUSINESS_TYPES = ['EXPENSE', 'CONTRACT_CHANGE', 'SEAL', 'LEAVE', 'TRANSFER', 'CUSTOM', 'PAYROLL'] as const;
export type ApprovalBusinessType = (typeof APPROVAL_BUSINESS_TYPES)[number];

export const INSTANCE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type ApprovalInstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const TASK_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalTaskStatus = (typeof TASK_STATUSES)[number];

/** formSchema 字段规格：镜像种子 approval_definition（LEAVE/SEAL/EXPENSE/CONTRACT_CHANGE/TRANSFER）。 */
export interface ApprovalFormField {
  key: string;
  label: string;
  type: 'date' | 'text' | 'textarea' | 'number';
  required?: boolean;
}

export interface ApprovalFormSchema {
  fields: ApprovalFormField[];
}

/** 镜像 approval-types.ts ApprovalDefinitionView（formSchema/approverRule/nodeSchema 保持原始 Json）。 */
export interface ApprovalDefinitionView {
  id: string;
  code: string;
  name: string;
  businessType: ApprovalBusinessType;
  formSchema: ApprovalFormSchema | Record<string, unknown>;
  approverRule: Record<string, unknown>;
  /** SPEC-016 多级节点链；null = 顶层 approverRule 单节点。 */
  nodeSchema: Record<string, unknown> | null;
  version: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 approval-definition-service.ts CreateDefinitionInput（approval.manage；code 唯一，大写字母开头）。 */
export interface CreateDefinitionInput {
  code: string;
  name: string;
  businessType: ApprovalBusinessType;
  formSchema: ApprovalFormSchema;
  approverRule: Record<string, unknown>;
  /** 可选多级节点链；缺省/null = 顶层 approverRule 单节点。 */
  nodeSchema?: Record<string, unknown> | null;
}

/** 镜像 approval-definition-service.ts UpdateDefinitionInput + 控制器 PATCH status 双职责字段（approval.manage）。 */
export interface UpdateDefinitionInput {
  name?: string;
  formSchema?: ApprovalFormSchema;
  approverRule?: Record<string, unknown>;
  nodeSchema?: Record<string, unknown> | null;
  /** PATCH 双职责：仅含 status 时 = 启用/禁用切换；与 update 字段同体时先 update 后 status。 */
  status?: 'ACTIVE' | 'DISABLED';
}

/** SPEC-025 镜像 approval-types.ts ImportDefinitionsInput：批量导入定义快照（按 code upsert，幂等）。
 *  version 为可选乐观锁前置条件（已存在定义，不符 → 409）；status 可选——缺省 create→ACTIVE / update→沿用当前。
 *  I×1 round-trip：导出下载（{schemaVersion, definitions} 含视图字段 id/createdAt/updatedAt）经前端剥离
 *  视图字段后仅剩白名单 8 键；schemaVersion 保留透传（SPEC-029 格式版本校验）。 */
export interface ImportDefinitionsInput {
  /** SPEC-029 格式版本：可选；undefined/1 兼容，!==1 → 400。 */
  schemaVersion?: number;
  definitions: Array<{
    code: string;
    name: string;
    businessType: ApprovalBusinessType;
    formSchema: ApprovalFormSchema | Record<string, unknown>;
    approverRule: Record<string, unknown>;
    /** 可选多级节点链；缺省/null = 顶层 approverRule 单节点。 */
    nodeSchema?: Record<string, unknown> | null;
    /** 可选乐观锁前置条件；缺省沿用当前版本。 */
    version?: number;
    /** 可选；缺省 create→ACTIVE / update→沿用当前。 */
    status?: 'ACTIVE' | 'DISABLED';
  }>;
}

/** SPEC-025 镜像 approval-types.ts ImportResult：批量导入结果（imported=新建条数；updated=更新条数）。 */
export interface ImportResult {
  imported: number;
  updated: number;
}

/** SPEC-029 镜像 approval-types.ts DefinitionExportPayload：导出包络（schemaVersion + definitions）。 */
export interface DefinitionExportPayload {
  schemaVersion: number;
  definitions: ApprovalDefinitionView[];
}

/** 镜像 approval-types.ts ApprovalTaskView：全字段投影。 */
export interface ApprovalTaskView {
  id: string;
  instanceId: string;
  nodeName: string;
  assigneeId: string;
  status: ApprovalTaskStatus;
  remark: string | null;
  processedBy: string | null;
  processedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 镜像 approval-types.ts ApprovalInstanceView（content 原始 Json + currentNode + 关联 tasks 全量）。 */
export interface ApprovalInstanceView {
  businessSync?: { target: string; status: string; reason: string | null; targetId: string | null } | null;
  formSnapshot?: { name?: string; formSchema?: { fields?: Array<{ key: string; label: string }> } } | null;
  id: string;
  definitionId: string;
  definitionVersion: number;
  businessType: ApprovalBusinessType;
  title: string;
  content: Record<string, unknown>;
  applicantId: string;
  status: ApprovalInstanceStatus;
  /** 当前活动节点下标（0 基；多级链 currentNode 对应 tasks 分组中的当前分组）。 */
  currentNode: number;
  /** SPEC-018 会签：定义 nodeSchema 链透传（数组节点链原始 Json，元素含 mode?: 'ANY'|'ALL'）；null = 单节点。 */
  nodeSchema: Record<string, unknown> | null;
  decidedBy: string | null;
  decidedAt: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tasks: ApprovalTaskView[];
}

/** 镜像 approval-types.ts ApplyApprovalInput；content 按 Definition formSchema 字段组装。 */
export interface ApplyApprovalInput {
  payrollBatchId?: string;
  payrollVersion?: number;
  attachmentIds?: string[];
  definitionCode: string;
  title: string;
  content: Record<string, unknown>;
  idempotencyKey?: string;
}

/** 镜像 approval-types.ts ProcessTaskInput；:id 为 taskId。 */
export interface ProcessTaskInput {
  action: 'APPROVE' | 'REJECT';
  remark?: string;
  idempotencyKey?: string;
}

/** 镜像 approval-types.ts WithdrawInput；:id 为 instanceId。 */
export interface WithdrawInput {
  reason?: string;
}

/** 镜像 approval-types.ts ForwardTaskInput；:id 为 taskId（assigneeId→目标人，状态不变）。 */
export interface ForwardTaskInput {
  /** 必填目标审批人（normalizeRequiredText 1-100；转交给自己/申请人 → 后端拒绝）。 */
  forwardToUserId: string;
  remark?: string;
}

/** 镜像 approval-types.ts AddSignersInput；:id 为 taskId（同节点追加审批人，状态不变）。 */
export interface AddSignersInput {
  /** 必填目标审批人数组（1-10 人；后端校验目标≠自己/申请人并去重）。 */
  addSignerUserIds: string[];
  remark?: string;
}

/** GET /api/v1/approvals：role 必填（APPLIED/TODO/DONE + ALL 全组织视图——approval.manage 门控）+ 分页（page 默认 1/pageSize 默认 10）。 */
export interface ListApprovalsQuery {
  role: ApprovalRoleFilter;
  page?: number;
  pageSize?: number;
  /** SPEC-028 全组织视图筛选/搜索：仅 role='ALL' 生效（其余 role 传 → 400）。 */
  businessType?: ApprovalBusinessType;
  status?: ApprovalInstanceStatus;
  applicantId?: string;
  keyword?: string;
}

/** SPEC-028 导出全组织实例 CSV（GET /approvals/export，approval.manage，无 actor 过滤）。 */
export interface ExportInstancesQuery {
  businessType?: ApprovalBusinessType;
  status?: ApprovalInstanceStatus;
  applicantId?: string;
  keyword?: string;
  maxRows?: number;
}

/** SPEC-030 镜像 approval-types.ts ApprovalStatsView：全组织审批统计。 */
export interface ApprovalStatsView {
  total: number;
  pendingCount: number;
  decidedCount: number;
  byBusinessType: Array<{ businessType: ApprovalBusinessType; count: number }>;
  byStatus: Array<{ status: ApprovalInstanceStatus; count: number }>;
  avgDecisionHours: number | null;
}

export const approvalApi = {
  /** GET /api/v1/approvals：role 过滤 + 分页——APPLIED/TODO/DONE（approval.read）；ALL 全组织视图（approval.manage，SPEC-023）。 */
  list: (params: ListApprovalsQuery) =>
    request.get<ApiResponse<PagedResult<ApprovalInstanceView>>>('/v1/approvals', { params }),
  /** GET /api/v1/approvals/definitions（approval.apply）：ACTIVE 定义全量（表单渲染）。 */
  definitions: () =>
    request.get<ApiResponse<ApprovalDefinitionView[]>>('/v1/approvals/definitions'),
  /** GET /api/v1/approvals/:id（approval.read）：详情，非申请人/非审批人缺统一 404。 */
  detail: (id: string) =>
    request.get<ApiResponse<ApprovalInstanceView>>(`/v1/approvals/${id}`),
  /** POST /api/v1/approvals（approval.apply）：发起审批。 */
  apply: (data: ApplyApprovalInput) =>
    request.post<ApiResponse<ApprovalInstanceView>>('/v1/approvals', data),
  /** POST /api/v1/approvals/:id/withdraw（approval.apply）：申请人撤回，:id 为 instanceId。 */
  withdraw: (id: string, data: WithdrawInput) =>
    request.post<ApiResponse<ApprovalInstanceView>>(`/v1/approvals/${id}/withdraw`, data),
  /** POST /api/v1/approvals/:id/process（approval.process）：处理任务，:id 实为 taskId。 */
  process: (taskId: string, data: ProcessTaskInput) =>
    request.post<ApiResponse<ApprovalInstanceView>>(`/v1/approvals/${taskId}/process`, data),
  /** POST /api/v1/approvals/:id/forward（approval.process）：转交任务，:id 实为 taskId（assigneeId→目标人，状态不变）。 */
  forwardTask: (taskId: string, data: ForwardTaskInput) =>
    request.post<ApiResponse<ApprovalInstanceView>>(`/v1/approvals/${taskId}/forward`, data),
  /** POST /api/v1/approvals/:id/add-signers（approval.process）：加签任务，:id 实为 taskId（同节点追加审批人，状态不变）。 */
  addSigners: (taskId: string, data: AddSignersInput) =>
    request.post<ApiResponse<ApprovalInstanceView>>(`/v1/approvals/${taskId}/add-signers`, data),
  // ==== SPEC-017 Task 3：定义管理（approval.manage）====
  /** POST /api/v1/approvals/definitions（approval.manage）：新建定义（code 唯一冲突 → APPROVAL_DEFINITION_CODE_CONFLICT 400）。 */
  createDefinition: (data: CreateDefinitionInput) =>
    request.post<ApiResponse<ApprovalDefinitionView>>('/v1/approvals/definitions', data),
  /** GET /api/v1/approvals/definitions/manage（approval.manage）：全量定义含 DISABLED（管理页用），code 升序。 */
  listDefinitionsManage: () =>
    request.get<ApiResponse<ApprovalDefinitionView[]>>('/v1/approvals/definitions/manage'),
  /** PATCH /api/v1/approvals/definitions/:code（approval.manage）：更新字段（version+1）+ status 切换（启用/禁用）。 */
  updateDefinition: (code: string, data: UpdateDefinitionInput) =>
    request.patch<ApiResponse<ApprovalDefinitionView>>(`/v1/approvals/definitions/${code}`, data),
  // ==== SPEC-025 Task 3：定义导入导出（approval.manage，配置迁移）====
  /** GET /api/v1/approvals/definitions/export（approval.manage）：导出定义快照——{schemaVersion, definitions} 包络（含 DISABLED code 升序；SPEC-029 增量 codes/businessType 可选）。 */
  exportDefinitions: (params?: { codes?: string; businessType?: ApprovalBusinessType }) =>
    request.get<ApiResponse<DefinitionExportPayload>>('/v1/approvals/definitions/export', { params }),
  /** POST /api/v1/approvals/definitions/import（approval.manage）：批量导入定义（body {definitions}，按 code upsert、单事务全或无、上限 100）。 */
  importDefinitions: (data: ImportDefinitionsInput) =>
    request.post<ApiResponse<ImportResult>>('/v1/approvals/definitions/import', data),
  // ==== SPEC-028 Task 2：全组织视图筛选/导出（approval.manage）====
  /** GET /api/v1/approvals/export（approval.manage）：全组织实例 CSV 导出（筛选/搜索参数同 role='ALL' 语义，无 actor 过滤）。 */
  exportApprovalsCsv: (params: ExportInstancesQuery) =>
    request.get<ApiResponse<string>>('/v1/approvals/export', { params }),
  // ==== SPEC-030 Task 2：全组织审批统计（approval.manage）====
  /** GET /api/v1/approvals/stats（approval.manage）：全组织审批统计（总量/在途/已决/类型/状态/平均决策时效，筛选同 role='ALL' 语义）。 */
  approvalStats: (params: ExportInstancesQuery) =>
    request.get<ApiResponse<ApprovalStatsView>>('/v1/approvals/stats', { params }),
};
