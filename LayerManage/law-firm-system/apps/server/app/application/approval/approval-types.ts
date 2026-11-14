// SPEC-013 Task 5: approval 应用层 DTO + 输出视图投影。
// 形态镜像 finance-types/finance-projection：DTO 入参白名单、视图全字段投影、
// PagedResult 复用 crm/lead-types 同构形态。content/formSchema/approverRule 为 Json
// 列——视图保持原始 Json 结构（消费方解析）；审计只落标识符（instanceId/
// definitionCode/businessType/fromStatus/toStatus/hasReason 布尔），content/remark
// 自由文本不落审计（协调者裁决 #7）。
// SPEC-025 Task 1: +ImportDefinitionsInput（批量导入快照，version/status 可选）+ ImportResult。

import { ApprovalDefinition, ApprovalInstance, ApprovalTask, Prisma } from '@prisma/client';

import type {
  ApprovalBusinessType,
  ApprovalInstanceStatus,
  ApprovalTaskStatus,
} from '../../domain/approval/approval-types';

export type { PagedResult } from '../crm/lead-types';

export interface ApplyApprovalInput {
  payrollBatchId?: string;
  payrollVersion?: number;
  attachmentIds?: string[];
  definitionCode: string;
  title: string;
  content: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ProcessTaskInput {
  action: 'APPROVE' | 'REJECT';
  remark?: string;
  idempotencyKey?: string;
}

/** SPEC-019 审批转交入参：forwardToUserId 必填目标审批人（1-100）；remark 可选自由文本（不落审计）。 */
export interface ForwardTaskInput {
  forwardToUserId: string;
  remark?: string;
}

/** SPEC-020 审批加签入参：addSignerUserIds 必填非空数组（1-10 人，服务层去重）；remark 可选自由文本（不落审计）。 */
export interface AddSignersInput {
  addSignerUserIds: string[];
  remark?: string;
}

export interface WithdrawInput {
  reason?: string;
}

/** 列表四 role 过滤：APPLIED=我申请的；TODO=待我审批；DONE=我处理过的（含被取消）；ALL=全组织视图（approval.manage 门控，无 actor 过滤）。 */
export const APPROVAL_ROLE_FILTERS = ['APPLIED', 'TODO', 'DONE', 'ALL'] as const;
export type ApprovalRoleFilter = (typeof APPROVAL_ROLE_FILTERS)[number];

export interface ListApprovalsQuery {
  page?: number;
  pageSize?: number;
  role: ApprovalRoleFilter;
  /** SPEC-028 全组织视图筛选/搜索：仅 role='ALL' 生效（其余 role 传 → 400 VALIDATION_FAILED）。 */
  businessType?: ApprovalBusinessType;
  status?: ApprovalInstanceStatus;
  applicantId?: string;
  keyword?: string;
}

/** SPEC-028 导出全组织实例 CSV 的查询（approval.manage 门控，无 actor 过滤——role='ALL' 语义）。 */
export interface ExportInstancesQuery {
  businessType?: ApprovalBusinessType;
  status?: ApprovalInstanceStatus;
  applicantId?: string;
  keyword?: string;
  maxRows?: number;
}

/** SPEC-030 全组织审批统计查询：复用 SPEC-028 筛选（businessType/status/applicantId/keyword）。 */
export interface ApprovalStatsQuery {
  businessType?: ApprovalBusinessType;
  status?: ApprovalInstanceStatus;
  applicantId?: string;
  keyword?: string;
}

/** SPEC-030 统计视图：total/pending/decided/按类型/按状态/平均决策时效（小时，无已决 → null）。 */
export interface ApprovalStatsView {
  total: number;
  pendingCount: number;
  decidedCount: number;
  byBusinessType: Array<{ businessType: ApprovalBusinessType; count: number }>;
  byStatus: Array<{ status: ApprovalInstanceStatus; count: number }>;
  avgDecisionHours: number | null;
}

/**
 * SPEC-024 同体 PATCH 组合入参：update 字段 + status 至少一项（组合方法单事务乐观锁）。
 * 供 controller PATCH 同体改调 updateDefinitionWithStatus（真原子，单事务两段 updateMany）。
 * version 为可选乐观锁前置条件（客户端持有的已知版本）：提供且与当前版本不符 →
 * 409 APPROVAL_STATE_INVALID（并发竞争，评审 M3 确定性构造；缺省沿用锁前读版本）。
 */
export interface UpdateDefinitionWithStatusInput {
  name?: string;
  formSchema?: Prisma.InputJsonValue;
  approverRule?: Prisma.InputJsonValue;
  nodeSchema?: Prisma.InputJsonValue | null;
  status?: 'ACTIVE' | 'DISABLED';
  version?: number;
}

/**
 * SPEC-025 批量导入入参：定义快照数组（按 code upsert，幂等）。
 * version 为可选乐观锁前置条件——仅对已存在定义生效（提供且 !== existing.version → 409
 * APPROVAL_STATE_INVALID）；缺省沿用当前版本并正常 version+1。status 可选——缺省 create→ACTIVE /
 * update→沿用当前。code/name/businessType/formSchema/approverRule 为必填快照字段。
 */
export interface ImportDefinitionsInput {
  /** SPEC-029 格式版本：可选；undefined/1 兼容（旧导出），!==1 → 400（未来格式）。 */
  schemaVersion?: number;
  definitions: Array<{
    code: string;
    name: string;
    businessType: ApprovalBusinessType;
    formSchema: Prisma.InputJsonValue;
    approverRule: Prisma.InputJsonValue;
    nodeSchema?: Prisma.InputJsonValue | null;
    version?: number;
    status?: 'ACTIVE' | 'DISABLED';
  }>;
}

/** SPEC-025 批量导入结果：imported=新建条数；updated=已存在更新条数。 */
export interface ImportResult {
  imported: number;
  updated: number;
}

/** SPEC-029 定义导出 schema 版本（当前 1；>1 未来格式导入拒绝）。 */
export const DEFINITION_EXPORT_SCHEMA_VERSION = 1;

/** SPEC-029 增量导出查询：codes（code 列表 ≤100）/ businessType（枚举）可选，缺省全量（向后兼容）。 */
export interface ExportDefinitionsQuery {
  codes?: string[];
  businessType?: ApprovalBusinessType;
}

/** SPEC-029 导出 payload：schemaVersion + definitions 包络（round-trip 前端适配）。 */
export interface DefinitionExportPayload {
  schemaVersion: number;
  definitions: ApprovalDefinitionView[];
}

/** ApprovalDefinition 输出视图：formSchema/approverRule/nodeSchema 保持原始 Json（前端表单渲染解析）。 */
export interface ApprovalDefinitionView {
  id: string;
  code: string;
  name: string;
  businessType: ApprovalBusinessType;
  formSchema: Prisma.JsonValue;
  approverRule: Prisma.JsonValue;
  nodeSchema: Prisma.JsonValue | null;
  version: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** ApprovalTask 输出视图：全字段投影。 */
export interface ApprovalTaskView {
  id: string;
  instanceId: string;
  nodeName: string;
  assigneeId: string;
  status: ApprovalTaskStatus;
  remark: string | null;
  processedBy: string | null;
  processedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** ApprovalInstance 输出视图：全字段投影 + currentNode + 定义 nodeSchema 透传 + 关联 tasks（列表/详情均携带，前端无需二次聚合）。 */
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
  currentNode: number;
  decidedBy: string | null;
  decidedAt: Date | null;
  version: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  /** 定义链投影透传（沿 ApprovalDefinitionView.nodeSchema 形态；SPEC-018 前端会签 Tag 数据源）。 */
  nodeSchema: Prisma.JsonValue | null;
  tasks: ApprovalTaskView[];
}

export function projectApprovalDefinition(def: ApprovalDefinition): ApprovalDefinitionView {
  return {
    id: def.id,
    code: def.code,
    name: def.name,
    businessType: def.businessType as ApprovalBusinessType,
    formSchema: def.formSchema,
    approverRule: def.approverRule,
    nodeSchema: def.nodeSchema,
    version: def.version,
    status: def.status,
    createdAt: def.createdAt,
    updatedAt: def.updatedAt,
  };
}

export function projectApprovalTask(task: ApprovalTask): ApprovalTaskView {
  return {
    id: task.id,
    instanceId: task.instanceId,
    nodeName: task.nodeName,
    assigneeId: task.assigneeId,
    status: task.status as ApprovalTaskStatus,
    remark: task.remark,
    processedBy: task.processedBy,
    processedAt: task.processedAt,
    version: task.version,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function projectApprovalInstance(
  instance: ApprovalInstance & {
    syncRecord?: ApprovalInstanceView['businessSync'];
    tasks?: ApprovalTask[];
    definition?: { nodeSchema: Prisma.JsonValue | null } | null;
  },
): ApprovalInstanceView {
  const tasks = instance.tasks ?? [];
  return {
    id: instance.id,
    businessSync: instance.syncRecord,
    formSnapshot: instance.formSnapshot as ApprovalInstanceView['formSnapshot'],
    definitionId: instance.definitionId,
    definitionVersion: instance.definitionVersion,
    businessType: instance.businessType as ApprovalBusinessType,
    title: instance.title,
    content: instance.content as unknown as Record<string, unknown>,
    applicantId: instance.applicantId,
    status: instance.status as ApprovalInstanceStatus,
    currentNode: instance.currentNode,
    decidedBy: instance.decidedBy,
    decidedAt: instance.decidedAt,
    version: instance.version,
    createdBy: instance.createdBy,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    nodeSchema: instance.definition?.nodeSchema ?? null,
    tasks: tasks.map(projectApprovalTask),
  };
}
