import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { GovernedOperationType, GovernanceDecision, GovernanceStatus } from '../../../domain/admin-governance/governance-types';
import { PermanentEventError } from '../../../domain/events/event-errors';
import { parseEventPayload } from '../../../domain/events/event-registry';
import { AdminOperationReviewedV1 } from '../../../domain/events/event-types';
import { EventHandler, EventHandlerContext } from '../event-delivery-store';

export const ADMIN_OPERATION_REVIEWED_NOTIFICATION_HANDLER_CODE = 'ADMIN_OPERATION_REVIEWED_NOTIFICATION';
const EVENT_TYPE = 'admin.operation.reviewed';
const EVENT_VERSION = 1;

const OPERATION_LABELS: Readonly<Record<GovernedOperationType, string>> = Object.freeze({
  SOP_TEMPLATE_PUBLISH: 'SOP模板发布', SOP_TEMPLATE_DISABLE: 'SOP模板停用',
  SYSTEM_ADMIN_GRANT: '系统管理员授权',
  SYSTEM_ADMIN_REVOKE: '系统管理员撤销',
  SYSTEM_ADMIN_ACCOUNT_DISABLE: '系统管理员账号停用',
  SUPER_ADMIN_GRANT: '超级管理员授权',
  SUPER_ADMIN_REVOKE: '超级管理员撤销',
  SUPER_ADMIN_ACCOUNT_DISABLE: '超级管理员账号停用',
  ADMIN_MFA_RESET: '管理员多因素认证重置',
  MASTER_DATA_STATUS_CORRECTION: '主数据状态更正',
  MASTER_DATA_METADATA_CORRECTION: '主数据元数据更正',
});

const DECISION_LABELS: Readonly<Record<GovernanceDecision, string>> = Object.freeze({
  APPROVE: '审核通过',
  REJECT: '审核驳回',
  CONFIRM: '复核确认',
  FLAG: '复核标记',
});

const STATUS_LABELS: Readonly<Partial<Record<GovernanceStatus, string>>> = Object.freeze({
  APPROVED: '已批准',
  REJECTED: '已拒绝',
  CONFIRMED: '已确认',
  FLAGGED: '已标记',
});

const DECISION_STATUSES: Readonly<Record<GovernanceDecision, GovernanceStatus>> = Object.freeze({
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  CONFIRM: 'CONFIRMED',
  FLAG: 'FLAGGED',
});

export class AdminOperationReviewedNotificationHandler implements EventHandler {
  async handle(tx: Prisma.TransactionClient, context: EventHandlerContext): Promise<void> {
    const payload = parsePayload(context);
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "admin_operation" WHERE "id" = ${payload.operationId} FOR SHARE
    `;
    const source = await tx.adminOperation.findUnique({
      where: { id: payload.operationId },
      select: {
        id: true,
        requesterUserId: true,
        operationType: true,
        riskLevel: true,
        requester: { select: { id: true } },
      },
    });
    if (!source
      || source.requester.id !== payload.requesterUserId
      || source.requesterUserId !== payload.requesterUserId
      || source.operationType !== payload.operationType
      || source.riskLevel !== payload.riskLevel) {
      sourceInvalid();
    }

    const decisionLabel = DECISION_LABELS[payload.decision];
    const statusLabel = STATUS_LABELS[payload.status];
    if (!decisionLabel || !statusLabel || DECISION_STATUSES[payload.decision] !== payload.status) {
      sourceInvalid();
    }
    const operationLabel = OPERATION_LABELS[payload.operationType];
    const title = `治理操作审核结果：${decisionLabel}`;
    const content = `您的${operationLabel}申请${statusLabel}。`;
    if (title.length > 120 || content.length > 1000) sourceInvalid();

    const deduplicationKey = createHash('sha256')
      .update(`${context.eventId}${context.handlerCode}${payload.requesterUserId}`, 'utf8')
      .digest('hex');
    const inserted = await tx.notification.createMany({
      data: [{
        userId: payload.requesterUserId,
        type: 'SYSTEM',
        title,
        content,
        relatedType: 'ADMIN_OPERATION',
        relatedId: payload.operationId,
        deduplicationKey,
        routeUrl: payload.routeUrl,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return;

    const existing = await tx.notification.findUnique({ where: { deduplicationKey } });
    if (!existing
      || existing.userId !== payload.requesterUserId
      || existing.type !== 'SYSTEM'
      || existing.routeUrl !== payload.routeUrl) {
      throw new PermanentEventError('NOTIFICATION_DEDUPLICATION_CONFLICT');
    }
  }
}

function parsePayload(context: EventHandlerContext): AdminOperationReviewedV1 {
  try {
    const parsed = parseEventPayload<AdminOperationReviewedV1>(context.eventType, context.eventVersion, context.payload);
    if (context.handlerCode !== ADMIN_OPERATION_REVIEWED_NOTIFICATION_HANDLER_CODE
      || context.eventType !== EVENT_TYPE
      || context.eventVersion !== EVENT_VERSION
      || context.orderingKey !== parsed.orderingKey) {
      sourceInvalid();
    }
    return parsed.payload;
  } catch (error) {
    if (error instanceof PermanentEventError) throw error;
    sourceInvalid();
  }
}

function sourceInvalid(): never {
  throw new PermanentEventError('GOVERNANCE_SOURCE_INVALID');
}
