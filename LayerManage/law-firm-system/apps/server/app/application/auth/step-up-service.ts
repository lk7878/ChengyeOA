import { Prisma, PrismaClient } from '@prisma/client';
import { MfaSecretCrypto } from '../../domain/security/mfa-factor-crypto';
import { createOpaqueToken, hashOpaqueToken } from '../../domain/security/opaque-token';
import { SecurityError, SecurityErrorCode } from '../../domain/security/security-errors';
import { digestStepUpTarget, StepUpPurpose } from '../../domain/security/step-up-target';
import { TotpService } from '../../domain/security/totp-service';
import { AuditWriter, writeAuditLog } from '../system/audit-writer';
import { ActiveSessionClaims } from './session-service';

const GRANT_TTL_MS = 5 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const COOLDOWN_MS = 15 * 60 * 1000;

export interface IssueStepUpInput {
  purpose: StepUpPurpose;
  target: unknown;
  code: string;
}

export class StepUpService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly totp: TotpService,
    private readonly secretCrypto: MfaSecretCrypto,
    private readonly auditWriter: AuditWriter = writeAuditLog,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async issue(
    claims: ActiveSessionClaims,
    input: IssueStepUpInput,
  ): Promise<{ stepUpToken: string; expiresIn: 300 }> {
    const targetDigest = digestStepUpTarget(input.purpose, input.target);
    const rawToken = createOpaqueToken();
    const now = this.clock();

    const outcome = await this.prisma.$transaction(async tx => {
      await lockSession(tx, claims.sessionId);
      const session = await tx.authSession.findUnique({ where: { id: claims.sessionId } });
      if (
        !session
        || session.userId !== claims.userId
        || session.credentialVersion !== claims.credentialVersion
        || session.revokedAt
        || session.expiresAt.getTime() <= now.getTime()
      ) {
        return this.rejectIssue(
          tx, claims, input.purpose, targetDigest, 'SESSION_INVALID', 'STEP_UP_REQUIRED', 403,
        );
      }
      if (session.stepUpBlockedUntil && session.stepUpBlockedUntil.getTime() > now.getTime()) {
        return this.rejectIssue(
          tx, claims, input.purpose, targetDigest, 'RATE_LIMITED', 'MFA_RATE_LIMITED', 429,
        );
      }

      await this.assertActor(tx, claims, input.purpose, now);
      const factor = await activeFactorForUpdate(tx, claims.userId);
      if (!factor?.verifiedAt) {
        return this.rejectIssue(
          tx, claims, input.purpose, targetDigest, 'FACTOR_REQUIRED', 'MFA_ENROLLMENT_REQUIRED', 403,
        );
      }
      const match = this.totp.verify(
        this.secretCrypto.decrypt({
          ciphertext: factor.encryptedSecret,
          iv: factor.secretIv,
          authTag: factor.secretAuthTag,
          keyVersion: factor.keyVersion,
        }),
        input.code,
        now,
        factor.lastAcceptedCounter,
      );
      if (!match) {
        const failedAttempts = Math.min(session.stepUpFailedAttempts + 1, MAX_FAILED_ATTEMPTS);
        const limited = failedAttempts >= MAX_FAILED_ATTEMPTS;
        await tx.authSession.update({
          where: { id: session.id },
          data: {
            stepUpFailedAttempts: failedAttempts,
            stepUpBlockedUntil: limited ? new Date(now.getTime() + COOLDOWN_MS) : null,
          },
        });
        return this.rejectIssue(
          tx,
          claims,
          input.purpose,
          targetDigest,
          limited ? 'RATE_LIMITED' : 'INVALID_TOTP',
          limited ? 'MFA_RATE_LIMITED' : 'STEP_UP_INVALID',
          limited ? 429 : 403,
        );
      }

      await tx.mfaFactor.update({
        where: { id: factor.id },
        data: { lastAcceptedCounter: match.counter },
      });
      await tx.authSession.update({
        where: { id: session.id },
        data: { stepUpFailedAttempts: 0, stepUpBlockedUntil: null },
      });
      const grant = await tx.stepUpGrant.create({
        data: {
          sessionId: claims.sessionId,
          userId: claims.userId,
          purpose: input.purpose,
          targetDigest,
          tokenHash: hashOpaqueToken(rawToken),
          createdAt: now,
          expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
        },
      });
      await this.auditWriter(tx, {
        userId: claims.userId,
        action: 'STEP_UP_GRANTED',
        targetType: 'STEP_UP_GRANT',
        targetId: grant.id,
          newValues: JSON.stringify({ purpose: input.purpose, targetDigest }),
      });
      return { kind: 'GRANTED' as const };
    });

    if (outcome.kind === 'REJECTED') {
      throw new SecurityError(outcome.code, outcome.httpStatus);
    }

    return { stepUpToken: rawToken, expiresIn: 300 };
  }

  async consume(
    tx: Prisma.TransactionClient,
    claims: ActiveSessionClaims,
    purpose: StepUpPurpose,
    target: unknown,
    rawToken: string,
  ): Promise<void> {
    const targetDigest = digestStepUpTarget(purpose, target);
    await this.assertActor(tx, claims, purpose, this.clock());
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      return this.rejectConsume(
        claims, purpose, targetDigest, 'TOKEN_REQUIRED', 'STEP_UP_REQUIRED', 403,
      );
    }
    const tokenHash = hashOpaqueToken(rawToken);
    await lockGrant(tx, tokenHash);
    const grant = await tx.stepUpGrant.findUnique({ where: { tokenHash } });
    if (
      !grant
      || grant.consumedAt
      || grant.sessionId !== claims.sessionId
      || grant.userId !== claims.userId
    ) {
      return this.rejectConsume(
        claims, purpose, targetDigest, 'GRANT_INVALID', 'STEP_UP_INVALID', 403, grant?.id,
      );
    }
    if (grant.purpose !== purpose) {
      return this.rejectConsume(
        claims, purpose, targetDigest, 'PURPOSE_MISMATCH', 'STEP_UP_PURPOSE_MISMATCH', 403, grant.id,
      );
    }
    if (grant.targetDigest !== targetDigest) {
      return this.rejectConsume(
        claims, purpose, targetDigest, 'TARGET_MISMATCH', 'STEP_UP_TARGET_MISMATCH', 403, grant.id,
      );
    }
    const now = this.clock();
    if (grant.expiresAt.getTime() <= now.getTime()) {
      return this.rejectConsume(
        claims, purpose, targetDigest, 'EXPIRED', 'STEP_UP_EXPIRED', 403, grant.id,
      );
    }

    await tx.stepUpGrant.update({ where: { id: grant.id }, data: { consumedAt: now } });
    await this.auditWriter(tx, {
      userId: claims.userId,
      action: 'STEP_UP_CONSUMED',
      targetType: 'STEP_UP_GRANT',
      targetId: grant.id,
      newValues: JSON.stringify({ purpose, targetDigest: grant.targetDigest }),
    });
  }

  private async assertActor(tx: Prisma.TransactionClient, claims: ActiveSessionClaims, purpose: StepUpPurpose, now: Date) {
    const session = await tx.authSession.findUnique({ where: { id: claims.sessionId }, include: { user: true } });
    if (!session || session.userId !== claims.userId || session.revokedAt || session.expiresAt <= now
      || session.credentialVersion !== claims.credentialVersion || session.user.credentialVersion !== claims.credentialVersion
      || session.user.status !== 'ENABLED' || session.user.mustChangePassword
      || (session.user.lockedUntil && session.user.lockedUntil > now)) throw new SecurityError('SESSION_REVOKED', 401);
    if (['SESSION_REVOKE', 'SESSION_REVOKE_ALL', 'REFUND_APPROVE'].includes(purpose)) throw new SecurityError('STEP_UP_INVALID', 403);
    // Legacy personal factors may still be maintained, but never gate ordinary work or login.
    if (['MFA_DISABLE_SELF', 'MFA_RECOVERY_CODES_REGENERATE'].includes(purpose)) return;
    const admin = await tx.userRole.findFirst({ where: {
      userId: claims.userId, revokedAt: null, validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      role: { code: { in: ['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN'] }, status: 'ENABLED' },
    } });
    if (!admin) throw new SecurityError('ADMIN_HIGH_RISK_ONLY', 403);
  }

  private async rejectIssue(
    tx: Prisma.TransactionClient,
    claims: ActiveSessionClaims,
    purpose: StepUpPurpose,
    targetDigest: string,
    reasonCode: string,
    code: SecurityErrorCode,
    httpStatus: number,
  ) {
    await this.auditWriter(tx, rejectionAudit(claims, purpose, targetDigest, reasonCode));
    return { kind: 'REJECTED' as const, code, httpStatus };
  }

  private async rejectConsume(
    claims: ActiveSessionClaims,
    purpose: StepUpPurpose,
    targetDigest: string,
    reasonCode: string,
    code: SecurityErrorCode,
    httpStatus: number,
    grantId?: string,
  ): Promise<never> {
    await this.writeIndependentRejection(claims, purpose, targetDigest, reasonCode, grantId);
    throw new SecurityError(code, httpStatus);
  }

  private async writeIndependentRejection(
    claims: ActiveSessionClaims,
    purpose: StepUpPurpose,
    targetDigest: string,
    reasonCode: string,
    grantId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(tx => this.auditWriter(
      tx,
      rejectionAudit(claims, purpose, targetDigest, reasonCode, grantId),
    ));
  }
}

function rejectionAudit(
  claims: ActiveSessionClaims,
  purpose: StepUpPurpose,
  targetDigest: string,
  reasonCode: string,
  grantId?: string,
): Prisma.OperationLogCreateInput {
  return {
    userId: claims.userId,
    action: 'STEP_UP_REJECTED',
    targetType: grantId ? 'STEP_UP_GRANT' : 'AUTH_SESSION',
    targetId: grantId ?? claims.sessionId,
    newValues: JSON.stringify({ purpose, targetDigest, reasonCode }),
  };
}

async function lockSession(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "auth_session" WHERE "id" = ${sessionId} FOR UPDATE`);
}

async function activeFactorForUpdate(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "mfa_factor"
    WHERE "userId" = ${userId} AND "disabledAt" IS NULL
    FOR UPDATE
  `);
  return tx.mfaFactor.findFirst({ where: { userId, disabledAt: null } });
}

async function lockGrant(tx: Prisma.TransactionClient, tokenHash: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "step_up_grant" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
  `);
}
