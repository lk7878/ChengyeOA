// SPEC-013 Task 4: 审批中心域词汇常量（纯领域层，零依赖）。
// 四组词汇：五类 businessTypes / 三型 approverRule / 四态 instance / 四态 task。
// SPEC-041：approverRule +SUPERVISOR（按申请人报告线解析直属上级；levels 缺省 1，可多级上溯）。

export const APPROVAL_BUSINESS_TYPES = ['EXPENSE', 'CONTRACT_CHANGE', 'SEAL', 'LEAVE', 'TRANSFER', 'CUSTOM', 'PAYROLL', 'SOP_REVIEW', 'QUALITY_ANALYSIS'] as const;
export type ApprovalBusinessType = typeof APPROVAL_BUSINESS_TYPES[number];

export const APPROVER_RULE_TYPES = ['USER', 'ROLE', 'SUPERVISOR'] as const;
export type ApproverRule =
  | { type: 'USER'; userIds: string[] }
  | { type: 'ROLE'; roleCodes: string[] }
  | { type: 'SUPERVISOR'; levels?: number };

export const INSTANCE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type ApprovalInstanceStatus = typeof INSTANCE_STATUSES[number];

export const TASK_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalTaskStatus = typeof TASK_STATUSES[number];
