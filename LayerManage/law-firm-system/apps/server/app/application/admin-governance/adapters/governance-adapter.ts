import { Prisma } from '@prisma/client';
import { GovernedOperationType } from '../../../domain/admin-governance/governance-types';

export interface GovernanceExecutionRequest {
  operationId: string;
  operationType: GovernedOperationType;
  targetType: string;
  targetId: string;
  expectedTargetVersion: number;
  payload: Prisma.JsonValue;
  requesterUserId: string;
  reviewerUserId: string | null;
}

export interface GovernanceExecutionOutcome {
  beforeSnapshot: Prisma.InputJsonValue;
  afterSnapshot: Prisma.InputJsonValue;
  resultCode: string;
}

export interface GovernedOperationAdapter {
  readonly key: string;
  supports(operationType: GovernedOperationType): boolean;
  validatePayload(operationType: GovernedOperationType, payload: unknown): Prisma.InputJsonValue;
  execute(
    tx: Prisma.TransactionClient,
    request: GovernanceExecutionRequest,
  ): Promise<GovernanceExecutionOutcome>;
}
