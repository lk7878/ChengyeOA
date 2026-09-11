// SPEC-009 Task 6: L3 明文读取审计共享助手。
// 自 lead-service 私有方法 auditRawL3Access 原样提取（行为不变），供 lead-service 与
// lead-assignment-service 共用：仅当 phone/wechat 以 READ 级明文输出时落 READ_L3_FIELDS；
// MASKED/NONE 输出不审计。审计内容经 sanitizeAuthorizationChanges 清洗，不含任何明文值。

import type { PrismaClient } from '@prisma/client';

import { writeAuthorizationAudit } from '../authorization/authorization-audit';
import type { AuditActor } from '../master-data/master-data-types';
import type { LeadFieldPermissions } from './lead-projection';

export async function auditRawL3Access(
  prisma: PrismaClient,
  actor: AuditActor,
  targetType: 'LEAD' | 'CUSTOMER',
  targetId: string,
  resource: 'lead' | 'customer',
  fieldPermissions: LeadFieldPermissions,
  resultCount: number,
  purpose: string,
): Promise<void> {
  if (resultCount === 0) return;
  const fieldCodes = [
    fieldPermissions.phone === 'READ' ? `${resource}.phone` : null,
    fieldPermissions.wechat === 'READ' ? `${resource}.wechat` : null,
  ].filter((code): code is string => code !== null).sort();
  if (fieldCodes.length === 0) return;
  await prisma.$transaction(tx => writeAuthorizationAudit(tx, {
    actorUserId: actor.actorUserId,
    action: 'READ_L3_FIELDS',
    targetType,
    targetId,
    changes: { fieldCodes, resultCount, purpose },
    ip: actor.ip,
  }));
}
