// SPEC-033 Task 2: case 应用层 DTO + 输出视图投影。
// 形态镜像 finance-types / crm lead-types：入参白名单、视图全字段投影、PagedResult 复用。

import type { CaseIntake, IntakeAttachment } from './intake-contract';
import { Case, CaseFile, CaseTask, Communication } from '@prisma/client';

export type { PagedResult } from '../crm/lead-types';

/** 案件状态机：PENDING（待受理）→ ACCEPTED（已受理）→ PROCESSING（办理中）→ CLOSED（已结案）→ ARCHIVED（归档）。 */
export const CASE_STATUSES = ['PENDING', 'ACCEPTED', 'PROCESSING', 'CLOSED', 'ARCHIVED'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** 案件优先级。 */
export const CASE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

/** CaseTask 状态机：PENDING → IN_PROGRESS → COMPLETED（OVERDUE 查询时推导，不落库）。 */
export const CASE_TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'] as const;
export type CaseTaskStatus = (typeof CASE_TASK_STATUSES)[number];

/** CaseTask nodeType 枚举（案件阶段）。 */
export const CASE_TASK_NODE_TYPES = [
  '立案准备', '材料收集', '立案提交', '开庭', '文书提交', '裁判反馈', '执行', '结案',
] as const;
export type CaseTaskNodeType = (typeof CASE_TASK_NODE_TYPES)[number];

/** Communication type 枚举。 */
export const CASE_COMMUNICATION_TYPES = ['PHONE', 'MEETING', 'WECHAT', 'EMAIL', 'OTHER'] as const;
export type CaseCommunicationType = (typeof CASE_COMMUNICATION_TYPES)[number];

export interface CreateCaseInput {
  intakeData?: CaseIntake;
  attachments?: IntakeAttachment[];
  title: string;
  customerId: string;
  contractId?: string;
  lawyerId?: string;
  teamIds?: string[];
  caseType: string;
  priority?: CasePriority;
  fee?: string;
  description?: string;
}

export interface UpdateCaseInput {
  title?: string;
  lawyerId?: string | null;
  teamIds?: string[];
  caseType?: string;
  priority?: CasePriority;
  description?: string | null;
  result?: string | null;
  satisfaction?: number | null;
  isReferrable?: boolean;
  version: number; // SPEC-035 乐观锁（必填，updateMany {id, version}）
}

export interface CloseCaseInput {
  result?: string;
  satisfaction?: number;
}

export interface CaseListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: CaseStatus;
  lawyerId?: string;
  priority?: CasePriority;
  customerId?: string;
}

export interface CreateCaseTaskInput {
  name: string;
  nodeType: CaseTaskNodeType;
  dueDate?: string;
  remark?: string;
}

export interface UpdateCaseTaskInput {
  status: CaseTaskStatus;
  remark?: string;
}

export interface CreateCommunicationInput {
  type: CaseCommunicationType;
  content: string;
  isKey?: boolean;
}

// SPEC-042：案件文件/证据——base64 上传入参（落盘用 UUID 文件名，fileName 仅存元数据）。
export interface UploadCaseFileInput {
  fileName: string;
  fileType: string;
  base64: string;
}

export interface CaseFileView {
  category: string | null;
  id: string;
  caseId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  createdAt: Date;
}

export interface CaseFileDownloadView extends CaseFileView {
  base64: string;
}

export function projectCaseFile(row: CaseFile): CaseFileView {
  return {
    id: row.id,
    caseId: row.caseId,
    category: row.category,
    fileName: row.fileName,
    fileType: row.fileType,
    fileSize: row.fileSize,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
  };
}

export function projectCaseFileDownload(row: CaseFile, base64: string): CaseFileDownloadView {
  return { ...projectCaseFile(row), base64 };
}

export interface CaseView {
  intakeData: CaseIntake;
  id: string;
  caseNo: string;
  title: string;
  customerId: string;
  contractId: string | null;
  lawyerId: string | null;
  teamIds: string[] | null;
  caseType: string;
  status: CaseStatus;
  priority: CasePriority;
  fee: string;
  description: string | null;
  result: string | null;
  satisfaction: number | null;
  isReferrable: boolean;
  closedAt: Date | null;
  version: number; // SPEC-035 乐观锁
  createdAt: Date;
  updatedAt: Date;
  tasks: CaseTaskView[];
  communications: CommunicationView[];
}

export interface CaseTaskView {
  id: string;
  caseId: string;
  name: string;
  nodeType: string;
  status: CaseTaskStatus;
  dueDate: Date | null;
  completedAt: Date | null;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunicationView {
  id: string;
  caseId: string;
  type: string;
  content: string;
  isKey: boolean;
  createdBy: string;
  createdAt: Date;
}

export function projectCase(
  caseRow: Case & {
    tasks?: CaseTask[];
    communications?: Communication[];
  },
): CaseView {
  return {
    intakeData: (caseRow.intakeData ?? {}) as CaseIntake,
    id: caseRow.id,
    caseNo: caseRow.caseNo,
    title: caseRow.title,
    customerId: caseRow.customerId,
    contractId: caseRow.contractId,
    lawyerId: caseRow.lawyerId,
    teamIds: caseRow.teamIds ? JSON.parse(caseRow.teamIds) as string[] : null,
    caseType: caseRow.caseType,
    status: caseRow.status as CaseStatus,
    priority: caseRow.priority as CasePriority,
    fee: caseRow.fee.toFixed(2),
    description: caseRow.description,
    result: caseRow.result,
    satisfaction: caseRow.satisfaction,
    isReferrable: caseRow.isReferrable,
    closedAt: caseRow.closedAt,
    version: caseRow.version,
    createdAt: caseRow.createdAt,
    updatedAt: caseRow.updatedAt,
    tasks: (caseRow.tasks ?? []).map(projectCaseTask),
    communications: (caseRow.communications ?? []).map(projectCommunication),
  };
}

export function projectCaseTask(task: CaseTask): CaseTaskView {
  return {
    id: task.id,
    caseId: task.caseId,
    name: task.name,
    nodeType: task.nodeType,
    status: task.status as CaseTaskStatus,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    remark: task.remark,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function projectCommunication(communication: Communication): CommunicationView {
  return {
    id: communication.id,
    caseId: communication.caseId,
    type: communication.type,
    content: communication.content,
    isKey: communication.isKey,
    createdBy: communication.createdBy,
    createdAt: communication.createdAt,
  };
}
