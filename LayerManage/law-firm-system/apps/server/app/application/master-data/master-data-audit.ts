import { Prisma } from '@prisma/client';
import { AuditActor } from './master-data-types';

const SAFE_KEYS = new Set([
  'code',
  'sort',
  'sourceOrganizationId',
  'copiedOrganizationCount',
  'copiedPositionCount',
  'status',
  'version',
  'type',
  'categoryCode',
  'organizationId',
  'positionId',
  'employeeId',
  'managerEmployeeId',
  'professionalTeamId',
  'assignmentType',
  'memberRole',
  'startedAt',
  'endedAt',
  'formalDate',
  'leaveDate',
  'deletedAt',
  'accountStatus',
  'accountId',
  'transferred',
  'deleteAccount',
]);

export interface MasterDataAuditInput extends AuditActor {
  action: string;
  targetType: 'ORGANIZATION' | 'POSITION' | 'EMPLOYEE' | 'EMPLOYEE_ASSIGNMENT' | 'EMPLOYEE_REPORTING_LINE' | 'PROFESSIONAL_TEAM' | 'PROFESSIONAL_TEAM_MEMBER' | 'USER';
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export function sanitizeChange(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => SAFE_KEYS.has(key)));
}

export async function writeMasterDataAudit(
  tx: Prisma.TransactionClient,
  input: MasterDataAuditInput,
): Promise<void> {
  await tx.operationLog.create({
    data: {
      userId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      oldValues: input.before ? JSON.stringify(sanitizeChange(input.before)) : undefined,
      newValues: input.after ? JSON.stringify(sanitizeChange(input.after)) : undefined,
      ip: input.ip,
    },
  });
}
