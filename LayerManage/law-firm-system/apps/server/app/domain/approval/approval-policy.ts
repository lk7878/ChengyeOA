// SPEC-013 Task 4: approval-policy 领域纯函数。不依赖 Prisma、不依赖 Egg、不连数据库。
// resolveApproverRule：roleMemberByCode 由服务层（Task 5）从成员关系表解析后传入。
// canTransitionInstance：终态先行——仅 PENDING 允许流转，终态（APPROVED/REJECTED/WITHDRAWN）拒一切目标。
// assertNotSelfReview：申请人不允许作为审批人，命中抛 ApprovalError 409。

import { type ApproverRule, type ApprovalInstanceStatus } from './approval-types';
import { APPROVAL_ERROR_CODES, ApprovalError } from './approval-errors';

export function resolveApproverRule(
  rule: ApproverRule,
  roleMemberByCode: Record<string, string[]>,
): string[] {
  if (rule.type === 'USER') return [...rule.userIds];
  if (rule.type === 'ROLE') {
    const ids = rule.roleCodes.flatMap((code) => roleMemberByCode[code] ?? []);
    return [...new Set(ids)];
  }
  // SPEC-041：SUPERVISOR 需申请人报告线（DB 查询），纯函数不可解析——由服务层
  // resolveSupervisorApprovers 处理；此处返回空集（服务层不会对 SUPERVISOR 调本函数）。
  return [];
}

export function canTransitionInstance(
  from: ApprovalInstanceStatus,
  to: 'APPROVED' | 'REJECTED' | 'WITHDRAWN',
): boolean {
  if (from !== 'PENDING') return false;
  // to 为目标态，当前版本仅 PENDING 非终态，任意目标均放行；保留签名供后续状态机扩展使用。
  void to;
  return true;
}

export function assertNotSelfReview(applicantId: string, approverIds: string[]): void {
  if (approverIds.includes(applicantId)) {
    throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_SELF_REVIEW_FORBIDDEN, 409, 'applicant cannot be approver');
  }
}
