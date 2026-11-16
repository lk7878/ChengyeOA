import { AdminOperation, Prisma, PrismaClient } from '@prisma/client';
import { GOVERNANCE_CODES, GovernanceError } from '../../domain/admin-governance/governance-errors';
import { decisionTarget } from '../../domain/admin-governance/governance-state-machine';
import { GovernedOperationType, GovernanceRisk, GovernanceStatus } from '../../domain/admin-governance/governance-types';
import {
  parseRetryGovernanceInput,
  parseReviewGovernanceInput,
  ReviewGovernanceInput,
} from '../../domain/admin-governance/governance-validation';
import { AuthorizationContext } from '../authorization/authorization-service';
import { EventOutboxWriter } from '../events/event-outbox-writer';
import { writeAuditLog } from '../system/audit-writer';
import { GovernanceEventSink } from './governance-event-sink';
import { GovernanceExecutionRunner } from './governance-execution-runner';
import { GovernanceStore } from './governance-store';
import { AdminOperationDetailView, toAdminOperationDetailView } from './governance-views';
import {
  consumeGovernanceStepUp,
  GovernanceStepUpAuthorization,
  GovernanceStepUpConsumer,
  requiresGovernanceStepUp,
} from './governance-step-up';

const ADMINISTRATOR_ACCOUNT_TYPES = new Set<GovernedOperationType>([
  'SYSTEM_ADMIN_GRANT', 'SYSTEM_ADMIN_REVOKE', 'SYSTEM_ADMIN_ACCOUNT_DISABLE',
  'SUPER_ADMIN_GRANT', 'SUPER_ADMIN_REVOKE', 'SUPER_ADMIN_ACCOUNT_DISABLE',
  'ADMIN_MFA_RESET',
]);

type ReviewTransactionOutcome =
  | { kind: 'REVIEWED'; operation: AdminOperation }
  | {
    kind: 'REJECTED';
    error: GovernanceError;
    operation: AdminOperation | null;
    observerEventType?: 'SELF_REVIEW_REJECTED' | 'TARGET_REVIEW_REJECTED';
  };

export class GovernanceReviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly runner: GovernanceExecutionRunner,
    private readonly eventSink: GovernanceEventSink,
    private readonly stepUp: GovernanceStepUpConsumer,
    private readonly outboxWriter: EventOutboxWriter,
    private readonly clock: () => Date,
  ) {}

  async review(
    context: AuthorizationContext,
    id: string,
    raw: unknown,
    requestId = id,
    stepUpAuthorization?: GovernanceStepUpAuthorization,
  ): Promise<AdminOperationDetailView> {
    requireSuperAdminPermission(context, 'governance.review');
    const normalizedRequestId = normalizeRequestId(requestId, id);
    const outcome: ReviewTransactionOutcome = await this.prisma.$transaction(async tx => {
      await lockOperation(tx, id);
      let input: ReviewGovernanceInput;
      try {
        input = parseReviewGovernanceInput(raw);
      } catch (error) {
        if (!(error instanceof GovernanceError)) throw error;
        return rejectReview(tx, context.userId, id, error, normalizedRequestId, null);
      }
      const operation = await tx.adminOperation.findUnique({ where: { id } });
      if (!operation) {
        return rejectReview(
          tx,
          context.userId,
          id,
          new GovernanceError(GOVERNANCE_CODES.hidden, 404),
          normalizedRequestId,
          null,
        );
      }
      if (operation.requesterUserId === context.userId) {
        return rejectReview(
          tx,
          context.userId,
          id,
          new GovernanceError(GOVERNANCE_CODES.selfReview, 403),
          normalizedRequestId,
          operation,
          'SELF_REVIEW_REJECTED',
        );
      }
      if (ADMINISTRATOR_ACCOUNT_TYPES.has(operation.operationType as GovernedOperationType)
        && operation.targetId === context.userId) {
        return rejectReview(
          tx,
          context.userId,
          id,
          new GovernanceError(GOVERNANCE_CODES.reviewTarget, 403),
          normalizedRequestId,
          operation,
          'TARGET_REVIEW_REJECTED',
        );
      }
      if (operation.version !== input.expectedOperationVersion) {
        return rejectReview(
          tx,
          context.userId,
          id,
          new GovernanceError(GOVERNANCE_CODES.processed, 409),
          normalizedRequestId,
          operation,
        );
      }
      let nextStatus: GovernanceStatus;
      try {
        nextStatus = decisionTarget(operation.status as GovernanceStatus, input.decision);
      } catch (error) {
        if (!(error instanceof GovernanceError)) throw error;
        return rejectReview(tx, context.userId, id, error, normalizedRequestId, operation);
      }
      if (input.decision === 'APPROVE' && requiresGovernanceStepUp(operation.riskLevel, operation.operationType)) {
        await consumeGovernanceStepUp(
          tx,
          this.stepUp,
          context.userId,
          stepUpAuthorization,
          'ADMIN_GOVERNANCE_APPROVE',
          { operationId: id, expectedOperationVersion: input.expectedOperationVersion, decision: 'APPROVE' },
        );
      }
      await new GovernanceStore(tx).appendReview({
        operationId: id,
        reviewerUserId: context.userId,
        decision: input.decision,
        comment: input.comment,
        operationVersion: operation.version,
      });
      const next = await new GovernanceStore(tx).transition(
        id,
        operation.status as GovernanceStatus,
        operation.version,
        nextStatus,
      );
      await writeAuditLog(tx, {
        userId: context.userId,
        action: `ADMIN_GOVERNANCE_${input.decision}`,
        targetType: 'ADMIN_GOVERNANCE',
        targetId: id,
        newValues: JSON.stringify({ decision: input.decision, status: nextStatus }),
      });
      await this.outboxWriter.append(tx, {
        eventType: 'admin.operation.reviewed',
        eventVersion: 1,
        objectType: 'ADMIN_OPERATION',
        objectId: operation.id,
        operatorUserId: context.userId,
        organizationId: null,
        branchId: null,
        teamId: null,
        payload: {
          operationId: operation.id,
          operationType: operation.operationType as GovernedOperationType,
          riskLevel: operation.riskLevel as GovernanceRisk,
          decision: input.decision,
          status: nextStatus,
          requesterUserId: operation.requesterUserId,
          routeUrl: `/security/admin-governance?operationId=${operation.id}`,
        },
        traceId: normalizedRequestId,
        occurredAt: this.clock(),
      });
      return { kind: 'REVIEWED', operation: next };
    });

    if (outcome.kind === 'REJECTED') {
      if (outcome.operation && outcome.observerEventType) {
        await this.eventSink.emit(eventFor(
          outcome.operation,
          outcome.observerEventType,
          outcome.operation.status as GovernanceStatus,
          outcome.error.code,
          normalizedRequestId,
        ));
      }
      throw outcome.error;
    }
    const reviewed = outcome.operation;

    const eventType = reviewed.status === 'FLAGGED'
      ? 'POST_REVIEW_FLAGGED'
      : reviewed.status === 'CONFIRMED'
        ? 'POST_REVIEW_CONFIRMED'
        : reviewed.status === 'REJECTED'
          ? 'REVIEW_REJECTED'
          : 'REVIEW_APPROVED';
    await this.eventSink.emit(eventFor(
      reviewed,
      eventType,
      reviewed.status as GovernanceStatus,
      reviewed.status,
      normalizedRequestId,
    ));
    if (reviewed.status === 'APPROVED') {
      return this.runner.execute(reviewed.id, reviewed.version, normalizedRequestId);
    }
    return this.detail(id);
  }

  async resume(
    context: AuthorizationContext,
    id: string,
    raw: unknown,
    requestId = id,
    stepUpAuthorization?: GovernanceStepUpAuthorization,
  ): Promise<AdminOperationDetailView> {
    requireSuperAdminPermission(context, 'governance.retry');
    const input = parseRetryGovernanceInput(raw);
    return this.runner.execute(id, input.expectedOperationVersion, requestId, false, {
      actorUserId: context.userId,
      authorization: stepUpAuthorization,
    });
  }

  private async detail(id: string): Promise<AdminOperationDetailView> {
    const operation = await new GovernanceStore(this.prisma).getDetail(id);
    if (!operation) hidden();
    return toAdminOperationDetailView(operation);
  }
}

function requireSuperAdminPermission(
  context: AuthorizationContext,
  permission: 'governance.review' | 'governance.retry',
): void {
  if (!context.isSystemSuperAdmin || !context.permissionCodes.includes(permission)) {
    throw new GovernanceError(GOVERNANCE_CODES.notAllowed, 403);
  }
}

async function lockOperation(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "admin_operation" WHERE "id" = ${id} FOR UPDATE`);
}

async function rejectReview(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  operationId: string,
  error: GovernanceError,
  requestId: string,
  operation: AdminOperation | null,
  observerEventType?: 'SELF_REVIEW_REJECTED' | 'TARGET_REVIEW_REJECTED',
): Promise<ReviewTransactionOutcome> {
  await writeAuditLog(tx, {
    userId: actorUserId,
    action: 'ADMIN_GOVERNANCE_REVIEW_REJECTED',
    targetType: 'ADMIN_GOVERNANCE',
    targetId: operationId,
    newValues: JSON.stringify({ refusalCode: error.code, requestId }),
  });
  return { kind: 'REJECTED', error, operation, ...(observerEventType ? { observerEventType } : {}) };
}

function normalizeRequestId(requestId: string, fallback: string): string {
  const normalized = typeof requestId === 'string' ? requestId.trim() : '';
  return (normalized || fallback).slice(0, 200);
}

function eventFor(operation: AdminOperation, eventType: string, status: GovernanceStatus, resultCode: string, requestId: string) {
  return {
    eventType,
    operationId: operation.id,
    operationType: operation.operationType as GovernedOperationType,
    riskLevel: operation.riskLevel as GovernanceRisk,
    status,
    resultCode,
    requestId,
  };
}

function hidden(): never { throw new GovernanceError(GOVERNANCE_CODES.hidden, 404); }
