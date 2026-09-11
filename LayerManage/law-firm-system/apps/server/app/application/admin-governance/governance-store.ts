import { randomUUID } from 'node:crypto';
import {
  AdminOperation,
  AdminOperationExecution,
  AdminOperationReview,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { GOVERNANCE_CODES, GovernanceError } from '../../domain/admin-governance/governance-errors';
import { assertGovernanceTransition } from '../../domain/admin-governance/governance-state-machine';
import {
  GovernedOperationType,
  GovernanceDecision,
  GovernanceReviewMode,
  GovernanceRisk,
  GovernanceStatus,
} from '../../domain/admin-governance/governance-types';

export type GovernanceDb = PrismaClient | Prisma.TransactionClient;

export interface CreateStoredOperation {
  operationType: GovernedOperationType;
  riskLevel: GovernanceRisk;
  reviewMode: GovernanceReviewMode;
  status: GovernanceStatus;
  requesterUserId: string;
  targetType: string;
  targetId: string;
  reason: string;
  payloadSnapshot: Prisma.InputJsonValue;
  payloadHash: string;
  expectedTargetVersion: number;
  idempotencyKey: string;
  secondConfirmationAt?: Date | null;
  relatedOperationId?: string | null;
}

export interface AppendReviewInput {
  operationId: string;
  reviewerUserId: string;
  decision: GovernanceDecision;
  comment?: string | null;
  operationVersion: number;
  createdAt?: Date;
}

export interface AppendExecutionInput {
  operationId: string;
  attemptNo: number;
  executorType: 'SYSTEM' | 'CLI';
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  beforeSnapshot?: Prisma.InputJsonValue | null;
  afterSnapshot?: Prisma.InputJsonValue | null;
  resultCode?: string | null;
  errorMessage?: string | null;
  startedAt?: Date;
  finishedAt?: Date | null;
}

export type AdminOperationWithTimeline = Prisma.AdminOperationGetPayload<{
  include: { reviews: true; executions: true };
}>;

export class GovernanceStore {
  constructor(private readonly db: GovernanceDb) {}

  async create(input: CreateStoredOperation): Promise<AdminOperation> {
    try {
      return await this.db.adminOperation.create({
        data: {
          operationNo: `GOV-${randomUUID().toUpperCase()}`,
          operationType: input.operationType,
          riskLevel: input.riskLevel,
          reviewMode: input.reviewMode,
          status: input.status,
          requesterUserId: input.requesterUserId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
          payloadSnapshot: input.payloadSnapshot,
          payloadHash: input.payloadHash,
          expectedTargetVersion: input.expectedTargetVersion,
          idempotencyKey: input.idempotencyKey,
          secondConfirmationAt: input.secondConfirmationAt ?? null,
          relatedOperationId: input.relatedOperationId ?? null,
        },
      });
    } catch (error) {
      if (isIdempotencyConflict(error)) {
        throw new GovernanceError(GOVERNANCE_CODES.idempotency, 409);
      }
      throw error;
    }
  }

  findByRequesterIdempotency(
    requesterUserId: string,
    idempotencyKey: string,
  ): Promise<AdminOperation | null> {
    return this.db.adminOperation.findUnique({
      where: { requesterUserId_idempotencyKey: { requesterUserId, idempotencyKey } },
    });
  }

  getDetail(id: string): Promise<AdminOperationWithTimeline | null> {
    return this.db.adminOperation.findUnique({
      where: { id },
      include: {
        reviews: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        executions: { orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] },
      },
    });
  }

  appendReview(input: AppendReviewInput): Promise<AdminOperationReview> {
    return this.db.adminOperationReview.create({
      data: {
        operationId: input.operationId,
        reviewerUserId: input.reviewerUserId,
        decision: input.decision,
        comment: input.comment ?? null,
        operationVersion: input.operationVersion,
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      },
    });
  }

  appendExecution(input: AppendExecutionInput): Promise<AdminOperationExecution> {
    return this.db.adminOperationExecution.create({
      data: {
        operationId: input.operationId,
        attemptNo: input.attemptNo,
        executorType: input.executorType,
        status: input.status,
        beforeSnapshot: input.beforeSnapshot == null ? Prisma.DbNull : input.beforeSnapshot,
        afterSnapshot: input.afterSnapshot == null ? Prisma.DbNull : input.afterSnapshot,
        resultCode: input.resultCode ?? null,
        errorMessage: input.errorMessage ?? null,
        ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
        finishedAt: input.finishedAt ?? null,
      },
    });
  }

  async transition(
    id: string,
    expectedStatus: GovernanceStatus,
    expectedVersion: number,
    nextStatus: GovernanceStatus,
  ): Promise<AdminOperation> {
    assertGovernanceTransition(expectedStatus, nextStatus);
    const result = await this.db.adminOperation.updateMany({
      where: { id, status: expectedStatus, version: expectedVersion },
      data: { status: nextStatus, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      throw new GovernanceError(GOVERNANCE_CODES.processed, 409);
    }
    const operation = await this.db.adminOperation.findUnique({ where: { id } });
    if (!operation) {
      throw new GovernanceError(GOVERNANCE_CODES.hidden, 404);
    }
    return operation;
  }
}

function isIdempotencyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes('requesterUserId') && text.includes('idempotencyKey');
}
