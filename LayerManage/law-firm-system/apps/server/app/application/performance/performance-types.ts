// SPEC-037 Task 2: performance 应用层 DTO + 输出视图投影。
// 形态镜像 case-types：入参白名单、视图全字段投影、PagedResult 复用。

import { Performance } from '@prisma/client';
import { projectEmployeeWithPrimaryAssignment } from '../master-data/employee-projection';

export type { PagedResult } from '../crm/lead-types';

/** 绩效类型（对齐后端模型注释；前端 ANNUAL/PROJECT 漂移已去）。 */
export const PERFORMANCE_TYPES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type PerformanceType = (typeof PERFORMANCE_TYPES)[number];

/** 绩效状态机：PENDING（待考核）→ SELF_REVIEWED（已自评）→ MANAGER_REVIEWED（已主管评）→ CONFIRMED（已确认，终态）。 */
export const PERFORMANCE_STATUSES = ['PENDING', 'SELF_REVIEWED', 'MANAGER_REVIEWED', 'CONFIRMED'] as const;
export type PerformanceStatus = (typeof PERFORMANCE_STATUSES)[number];

export interface CreatePerformanceInput {
  idempotencyKey?: string;
  employeeId: string;
  period: string;
  type: PerformanceType;
  kpiData?: string;
  score?: string;
  bonus?: string;
  remark?: string;
}

// SPEC-043：考核流程入参——目标设定 / 自评 / 主管评。
export interface SetGoalInput {
  version?: number;
  goal: string;
}

export interface SelfReviewInput {
  version?: number;
  selfScore: number;
  selfComment?: string;
}

export interface ManagerReviewInput {
  version?: number;
  managerScore: number;
  managerComment?: string;
}

// SPEC-044：绩效业务指标（该员工考核周期案件办结数/回款额）——纯读聚合。
// SPEC-045：+autoScore 自动计分（办结数×10 + 回款额÷10000，clamp 0-100）。
export interface PerformanceBusinessMetrics {
  caseEarnings?: string | null;
  closedCases: number | null;
  confirmedRevenue: string | null;
  autoScore: number | null;
}

export interface PerformanceListQuery {
  page?: number;
  pageSize?: number;
  employeeId?: string;
  period?: string;
  type?: PerformanceType;
}

export interface PerformanceView {
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
  id: string;
  employeeId: string;
  period: string;
  type: string;
  kpiData: string;
  score: string | null;
  bonus: string | null;
  remark: string | null;
  status: PerformanceStatus;
  goal: string | null;
  selfScore: number | null;
  selfComment: string | null;
  managerScore: number | null;
  managerComment: string | null;
  reviewerId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  employee: ReturnType<typeof projectEmployeeWithPrimaryAssignment>;
}

export function projectPerformance(
  row: Performance & {
    employee: Parameters<typeof projectEmployeeWithPrimaryAssignment>[0];
  },
): PerformanceView {
  return {
    id: row.id,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    employeeId: row.employeeId,
    period: row.period,
    type: row.type,
    kpiData: row.kpiData,
    score: row.score?.toFixed(2) ?? null,
    bonus: row.bonus?.toFixed(2) ?? null,
    remark: row.remark,
    status: row.status as PerformanceStatus,
    goal: row.goal,
    selfScore: row.selfScore,
    selfComment: row.selfComment,
    managerScore: row.managerScore,
    managerComment: row.managerComment,
    reviewerId: row.reviewerId,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    employee: projectEmployeeWithPrimaryAssignment(row.employee),
  };
}
