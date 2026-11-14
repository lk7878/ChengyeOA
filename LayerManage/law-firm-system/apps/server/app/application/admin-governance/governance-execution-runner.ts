import { AdminOperation, Prisma, PrismaClient } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
import { GOVERNANCE_CODES, GovernanceError } from '../../domain/admin-governance/governance-errors';
import { mayResumeExecution } from '../../domain/admin-governance/governance-state-machine';
import { GOVERNED_OPERATION_CATALOG } from '../../domain/admin-governance/operation-catalog';
import {
  GovernedOperationType,
  GovernanceRisk,
  GovernanceStatus,
} from '../../domain/admin-governance/governance-types';
import { writeAuditLog } from '../system/audit-writer';
import { GovernedOperationAdapter } from './adapters/governance-adapter';
import { GovernanceEventSink } from './governance-event-sink';
import { GovernanceStore } from './governance-store';
import { AdminOperationDetailView, toAdminOperationDetailView } from './governance-views';
import {
  consumeGovernanceStepUp,
  GovernanceStepUpAuthorization,
  GovernanceStepUpConsumer,
  requiresGovernanceStepUp,
} from './governance-step-up';

interface ClaimedOperation {
  operation: AdminOperation;
  attemptNo: number;
}

interface RetryStepUpRequest {
  actorUserId: string;
  authorization?: GovernanceStepUpAuthorization;
}

export class GovernanceExecutionRunner {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly adapters: readonly GovernedOperationAdapter[],
    private readonly eventSink: GovernanceEventSink,
    private readonly stepUp: GovernanceStepUpConsumer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    operationId: string,
    expectedOperationVersion?: number,
    requestId = operationId,
    allowInitialPostExecution = false,
    retryStepUp?: RetryStepUpRequest,
  ): Promise<AdminOperationDetailView> {
    let claimed: ClaimedOperation;
    try {
      claimed = await this.claim(operationId, expectedOperationVersion, allowInitialPostExecution, retryStepUp);
    } catch (error) {
      await this.emitFailureForStoredOperation(operationId, requestId, stableErrorCode(error));
      throw error;
    }

    try {
      const completed = await this.prisma.$transaction(async tx => {
        await lockOperation(tx, operationId);
        const operation = await tx.adminOperation.findUnique({ where: { id: operationId } });
        if (!operation) hidden();
        if (operation.status !== 'EXECUTING' || operation.version !== claimed.operation.version) processed();
        assertPayloadHash(operation);
        const adapter = this.adapterFor(operation);
        const latestApproval = await tx.adminOperationReview.findFirst({
          where: { operationId, decision: 'APPROVE' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { reviewerUserId: true },
        });
        const outcome = await adapter.execute(tx, {
          operationId,
          operationType: operation.operationType as GovernedOperationType,
          targetType: operation.targetType,
          targetId: operation.targetId,
          expectedTargetVersion: operation.expectedTargetVersion,
          payload: operation.payloadSnapshot,
          requesterUserId: operation.requesterUserId,
          reviewerUserId: latestApproval?.reviewerUserId ?? null,
        });
        const now = this.clock();
        await new GovernanceStore(tx).appendExecution({
          operationId,
          attemptNo: claimed.attemptNo,
          executorType: 'SYSTEM',
          status: 'SUCCEEDED',
          beforeSnapshot: outcome.beforeSnapshot,
          afterSnapshot: outcome.afterSnapshot,
          resultCode: outcome.resultCode,
          startedAt: now,
          finishedAt: now,
        });
        const nextStatus: GovernanceStatus = operation.reviewMode === 'POST'
          ? 'PENDING_POST_REVIEW'
          : 'SUCCEEDED';
        await new GovernanceStore(tx).transition(
          operation.id,
          'EXECUTING',
          operation.version,
          nextStatus,
        );
        await writeAuditLog(tx, {
          userId: latestApproval?.reviewerUserId ?? operation.requesterUserId,
          action: 'ADMIN_GOVERNANCE_EXECUTION_SUCCEEDED',
          targetType: 'ADMIN_GOVERNANCE',
          targetId: operation.id,
          newValues: JSON.stringify({ resultCode: outcome.resultCode, status: nextStatus }),
        });
        return { operation, nextStatus, resultCode: outcome.resultCode };
      });
      await this.eventSink.emit(eventFor(
        completed.operation,
        'EXECUTION_SUCCEEDED',
        completed.nextStatus,
        completed.resultCode,
        requestId,
      ));
      return this.detail(operationId);
    } catch (error) {
      const resultCode = stableErrorCode(error);
      await this.persistFailure(claimed, resultCode);
      await this.eventSink.emit(eventFor(
        claimed.operation,
        'EXECUTION_FAILED',
        'FAILED',
        resultCode,
        requestId,
      ));
      throw error;
    }
  }

  private async claim(
    operationId: string,
    expectedOperationVersion?: number,
    allowInitialPostExecution = false,
    retryStepUp?: RetryStepUpRequest,
  ): Promise<ClaimedOperation> {
    return this.prisma.$transaction(async tx => {
      await lockOperation(tx, operationId);
      let operation = await tx.adminOperation.findUnique({ where: { id: operationId } });
      if (!operation) hidden();
      if (expectedOperationVersion !== undefined && operation.version !== expectedOperationVersion) processed();
      assertPayloadHash(operation);
      const catalog = catalogFor(operation);
      const executions = await tx.adminOperationExecution.findMany({
        where: { operationId }, select: { attemptNo: true, status: true }, orderBy: { attemptNo: 'desc' },
      });
      const successfulAttempts = executions.filter(item => item.status === 'SUCCEEDED').length;
      const isInitialPostExecution = allowInitialPostExecution
        && operation.reviewMode === 'POST'
        && operation.status === 'EXECUTING'
        && executions.length === 0;
      if (!isInitialPostExecution) {
        if (operation.status === 'FAILED' && !catalog.retryable) notRetryable();
        if (!mayResumeExecution(operation.status as GovernanceStatus, successfulAttempts, catalog.retryable)) {
          processed();
        }
        if (retryStepUp && requiresGovernanceStepUp(operation.riskLevel)) {
          await consumeGovernanceStepUp(
            tx,
            this.stepUp,
            retryStepUp.actorUserId,
            retryStepUp.authorization,
            'ADMIN_GOVERNANCE_RETRY',
            { operationId, expectedOperationVersion },
          );
        }
        operation = await new GovernanceStore(tx).transition(
          operation.id,
          operation.status as GovernanceStatus,
          operation.version,
          'EXECUTING',
        );
      }
      return { operation, attemptNo: (executions[0]?.attemptNo ?? 0) + 1 };
    });
  }

  private async persistFailure(claimed: ClaimedOperation, resultCode: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await lockOperation(tx, claimed.operation.id);
      const operation = await tx.adminOperation.findUnique({ where: { id: claimed.operation.id } });
      if (!operation || operation.status !== 'EXECUTING' || operation.version !== claimed.operation.version) return;
      const now = this.clock();
      await new GovernanceStore(tx).appendExecution({
        operationId: operation.id,
        attemptNo: claimed.attemptNo,
        executorType: 'SYSTEM',
        status: 'FAILED',
        resultCode,
        errorMessage: resultCode,
        startedAt: now,
        finishedAt: now,
      });
      await new GovernanceStore(tx).transition(operation.id, 'EXECUTING', operation.version, 'FAILED');
      await writeAuditLog(tx, {
        userId: operation.requesterUserId,
        action: 'ADMIN_GOVERNANCE_EXECUTION_FAILED',
        targetType: 'ADMIN_GOVERNANCE',
        targetId: operation.id,
        newValues: JSON.stringify({ resultCode, status: 'FAILED' }),
      });
    });
  }

  private adapterFor(operation: AdminOperation): GovernedOperationAdapter {
    const catalog = catalogFor(operation);
    const adapter = this.adapters.find(item => item.key === catalog.adapterKey && item.supports(
      operation.operationType as GovernedOperationType,
    ));
    if (!adapter) notAllowed();
    return adapter;
  }

  private async detail(id: string): Promise<AdminOperationDetailView> {
    const operation = await new GovernanceStore(this.prisma).getDetail(id);
    if (!operation) hidden();
    return toAdminOperationDetailView(operation);
  }

  private async emitFailureForStoredOperation(id: string, requestId: string, resultCode: string): Promise<void> {
    const operation = await this.prisma.adminOperation.findUnique({ where: { id } });
    if (!operation) return;
    await this.eventSink.emit(eventFor(
      operation,
      'EXECUTION_REJECTED',
      operation.status as GovernanceStatus,
      resultCode,
      requestId,
    ));
  }
}

async function lockOperation(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "admin_operation" WHERE "id" = ${id} FOR UPDATE`);
}

function assertPayloadHash(operation: AdminOperation): void {
  if (hashPayload(operation.payloadSnapshot) !== operation.payloadHash) {
    throw new GovernanceError(GOVERNANCE_CODES.payloadHash, 409);
  }
}

function catalogFor(operation: AdminOperation) {
  const catalog = GOVERNED_OPERATION_CATALOG[operation.operationType as GovernedOperationType];
  if (!catalog) notAllowed();
  return catalog;
}

function stableErrorCode(error: unknown): string {
  if (error instanceof GovernanceError || error instanceof MasterDataError) return error.code;
  return 'EXECUTION_FAILED';
}

function eventFor(
  operation: AdminOperation,
  eventType: string,
  status: GovernanceStatus,
  resultCode: string,
  requestId: string,
) {
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

function processed(): never { throw new GovernanceError(GOVERNANCE_CODES.processed, 409); }
function hidden(): never { throw new GovernanceError(GOVERNANCE_CODES.hidden, 404); }
function notAllowed(): never { throw new GovernanceError(GOVERNANCE_CODES.notAllowed, 403); }
function notRetryable(): never { throw new GovernanceError(GOVERNANCE_CODES.notRetryable, 409); }
