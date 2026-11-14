import { Prisma } from '@prisma/client';
import { SecurityError } from '../../domain/security/security-errors';
import { StepUpPurpose } from '../../domain/security/step-up-target';
import { ActiveSessionClaims } from '../auth/session-service';

export interface GovernanceStepUpAuthorization {
  claims: ActiveSessionClaims;
  token: string;
}

export interface GovernanceStepUpConsumer {
  consume(
    tx: Prisma.TransactionClient,
    claims: ActiveSessionClaims,
    purpose: StepUpPurpose,
    target: unknown,
    rawToken: string,
  ): Promise<void>;
}

export async function consumeGovernanceStepUp(
  tx: Prisma.TransactionClient,
  consumer: GovernanceStepUpConsumer,
  actorUserId: string,
  authorization: GovernanceStepUpAuthorization | undefined,
  purpose: StepUpPurpose,
  target: unknown,
): Promise<void> {
  if (!authorization?.token) throw new SecurityError('STEP_UP_REQUIRED', 403);
  if (authorization.claims.userId !== actorUserId) throw new SecurityError('STEP_UP_INVALID', 403);
  await consumer.consume(tx, authorization.claims, purpose, target, authorization.token);
}

export function requiresGovernanceStepUp(riskLevel: string): boolean {
  return riskLevel === 'HIGH' || riskLevel === 'CRITICAL';
}
