import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { encodeBase32 } from '../../domain/security/base32';
import { EncryptedMfaSecret, MfaSecretCrypto } from '../../domain/security/mfa-factor-crypto';
import { PasswordHasher } from '../../domain/security/password-hasher';
import { SecurityError } from '../../domain/security/security-errors';
import { TotpService } from '../../domain/security/totp-service';
import { AuditWriter, writeAuditLog } from '../system/audit-writer';
import { AuthChallengeService } from './auth-challenge-service';
import { ActiveSessionClaims } from './session-service';
import { StepUpService } from './step-up-service';

const PENDING_FACTOR_TTL_MS = 15 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

export type MfaCredential =
  | { kind: 'TOTP'; code: string }
  | { kind: 'RECOVERY_CODE'; code: string };

export interface VerifiedMfaIdentity {
  userId: string;
  assuranceLevel: 'MFA';
  recoveryCodes?: string[];
}

export interface MfaStatusView {
  enabled: boolean;
  verifiedAt: Date | null;
  recoveryCodesRemaining: number;
}

export class MfaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly challenges: AuthChallengeService,
    private readonly totp: TotpService,
    private readonly secretCrypto: MfaSecretCrypto,
    private readonly hasher: PasswordHasher,
    _stepUp: StepUpService,
    private readonly auditWriter: AuditWriter = writeAuditLog,
    private readonly clock: () => Date = () => new Date(),
    _legacyLocalPasswordLogin = false,
  ) {
    // Retained only for constructor compatibility; never bypass operation checks.
    void _legacyLocalPasswordLogin;
    void _stepUp; // Constructor compatibility; self-service maintenance no longer consumes a grant.
  }

  async beginEnrollment(challengeToken: string): Promise<{
    secret: string;
    manualKey: string;
    otpauthUri: string;
  }> {
    try {
      const userId = await this.challenges.getActiveUserId(challengeToken, 'MFA_ENROLLMENT');
      const now = this.clock();
      const factorAndUsername = await this.prisma.$transaction(async tx => {
        await lockActiveFactor(tx, userId);
        const [factor, user] = await Promise.all([
          tx.mfaFactor.findFirst({ where: { userId, disabledAt: null } }),
          tx.user.findUnique({ where: { id: userId }, select: { username: true } }),
        ]);
        if (!user) throw invalidMfa();
        if (factor?.verifiedAt) throw invalidMfa();
        if (factor && now.getTime() - factor.createdAt.getTime() < PENDING_FACTOR_TTL_MS) {
          return { factor, username: user.username };
        }
        if (factor) {
          await tx.mfaFactor.update({ where: { id: factor.id }, data: { disabledAt: now } });
        }
        const secret = this.totp.generateSecret();
        const encrypted = this.secretCrypto.encrypt(secret);
        const created = await tx.mfaFactor.create({
          data: {
            userId,
            type: 'TOTP',
            encryptedSecret: encrypted.ciphertext,
            secretIv: encrypted.iv,
            secretAuthTag: encrypted.authTag,
            keyVersion: encrypted.keyVersion,
            createdAt: now,
          },
        });
        return { factor: created, username: user.username };
      });
      const secret = this.secretCrypto.decrypt(encryptedValue(factorAndUsername.factor));
      return {
        secret,
        manualKey: secret,
        otpauthUri: this.totp.buildUri({
          issuer: 'Chengye OA', accountName: factorAndUsername.username, secret,
        }),
      };
    } catch (error) {
      await this.auditRejection(
        challengeToken, 'MFA_ENROLLMENT', 'MFA_ENROLLMENT_REJECTED', error,
      );
      throw error;
    }
  }

  async startOptionalEnrollment(claims: ActiveSessionClaims): Promise<{
    challengeToken: string;
    expiresIn: 600;
  }> {
    const now = this.clock();
    const user = await this.prisma.user.findUnique({
      where: { id: claims.userId },
      include: {
        authSessions: { where: { id: claims.sessionId } },
        mfaFactors: { where: { disabledAt: null, verifiedAt: { not: null } }, select: { id: true } },
        userRoles: { include: { role: true } },
      },
    });
    const session = user?.authSessions[0];
    const isAdministrator = user?.userRoles.some(userRole => (
      !userRole.revokedAt
      && userRole.validFrom.getTime() <= now.getTime()
      && (!userRole.validUntil || userRole.validUntil.getTime() > now.getTime())
      && userRole.role.status === 'ENABLED'
      && ['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN'].includes(userRole.role.code)
    ));
    if (
      !user
      || user.status !== 'ENABLED'
      || user.mustChangePassword
      || (user.lockedUntil && user.lockedUntil.getTime() > now.getTime())
      || user.credentialVersion !== claims.credentialVersion
      || !session
      || session.userId !== user.id
      || session.credentialVersion !== claims.credentialVersion
      || session.revokedAt
      || session.expiresAt.getTime() <= now.getTime()
      || user.mfaFactors.length > 0
      || !isAdministrator
    ) {
      throw new SecurityError('MFA_INVALID', 403);
    }

    const challenge = await this.challenges.issue(user.id, 'MFA_ENROLLMENT');
    await this.prisma.$transaction(tx => this.auditWriter(tx, {
      userId: user.id,
      action: 'MFA_ENROLLMENT_STARTED',
      targetType: 'USER',
      targetId: user.id,
    }));
    return { challengeToken: challenge.token, expiresIn: 600 };
  }

  async confirmEnrollment(challengeToken: string, code: string): Promise<VerifiedMfaIdentity> {
    try {
      return await this.challenges.consume(challengeToken, 'MFA_ENROLLMENT', async (tx, userId) => {
        const factor = await activeFactorForUpdate(tx, userId);
        if (!factor || factor.verifiedAt) throw invalidMfa();
        const now = this.clock();
        if (now.getTime() - factor.createdAt.getTime() >= PENDING_FACTOR_TTL_MS) throw invalidMfa();
        const match = this.totp.verify(this.secretCrypto.decrypt(encryptedValue(factor)), code, now);
        if (!match) throw invalidMfa();

        const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode);
        const codeHashes = await Promise.all(recoveryCodes.map(value => this.hasher.hash(value)));
        await tx.mfaFactor.update({
          where: { id: factor.id },
          data: { verifiedAt: now, lastAcceptedCounter: match.counter },
        });
        await tx.mfaRecoveryCode.createMany({
          data: codeHashes.map(codeHash => ({ factorId: factor.id, codeHash, createdAt: now })),
        });
        await tx.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'MFA_ENROLLED' },
        });
        await this.auditWriter(tx, {
          userId,
          action: 'MFA_ENROLLED',
          targetType: 'USER',
          targetId: userId,
        });
        return { userId, assuranceLevel: 'MFA', recoveryCodes };
      });
    } catch (error) {
      if (isInvalidMfa(error)) {
        try {
          return await this.challenges.fail(challengeToken, 'MFA_ENROLLMENT');
        } catch (finalError) {
          await this.auditRejection(
            challengeToken, 'MFA_ENROLLMENT', 'MFA_ENROLLMENT_REJECTED', finalError,
          );
          throw finalError;
        }
      }
      await this.auditRejection(
        challengeToken, 'MFA_ENROLLMENT', 'MFA_ENROLLMENT_REJECTED', error,
      );
      throw error;
    }
  }

  async verifyLogin(challengeToken: string, credential: MfaCredential): Promise<VerifiedMfaIdentity> {
    try {
      return await this.challenges.consume(challengeToken, 'MFA_VERIFY', async (tx, userId) => {
        const factor = await activeFactorForUpdate(tx, userId);
        if (!factor?.verifiedAt) throw invalidMfa();
        const now = this.clock();
        if (credential.kind === 'TOTP') {
          const match = this.totp.verify(
            this.secretCrypto.decrypt(encryptedValue(factor)),
            credential.code,
            now,
            factor.lastAcceptedCounter,
          );
          if (!match) throw invalidMfa();
          await tx.mfaFactor.update({
            where: { id: factor.id },
            data: { lastAcceptedCounter: match.counter },
          });
          await this.auditWriter(tx, {
            userId,
            action: 'MFA_VERIFIED',
            targetType: 'USER',
            targetId: userId,
          });
        } else {
          const normalizedCode = credential.code.trim().toUpperCase();
          const recoveryCodes = await tx.mfaRecoveryCode.findMany({
            where: { factorId: factor.id, usedAt: null },
          });
          let matchedId: string | null = null;
          for (const recoveryCode of recoveryCodes) {
            if (await this.hasher.compare(normalizedCode, recoveryCode.codeHash)) {
              matchedId = recoveryCode.id;
              break;
            }
          }
          if (!matchedId) throw invalidMfa();
          await tx.mfaRecoveryCode.update({ where: { id: matchedId }, data: { usedAt: now } });
          await this.auditWriter(tx, {
            userId,
            action: 'MFA_RECOVERY_CODE_USED',
            targetType: 'USER',
            targetId: userId,
          });
        }
        return { userId, assuranceLevel: 'MFA' };
      });
    } catch (error) {
      if (isInvalidMfa(error)) {
        try {
          return await this.challenges.fail(challengeToken, 'MFA_VERIFY');
        } catch (finalError) {
          await this.auditRejection(
            challengeToken,
            'MFA_VERIFY',
            'MFA_VERIFICATION_REJECTED',
            finalError,
            credential.kind,
          );
          throw finalError;
        }
      }
      await this.auditRejection(
        challengeToken,
        'MFA_VERIFY',
        'MFA_VERIFICATION_REJECTED',
        error,
        credential.kind,
      );
      throw error;
    }
  }

  private async auditRejection(
    challengeToken: string,
    challengeType: 'MFA_ENROLLMENT' | 'MFA_VERIFY',
    action: 'MFA_ENROLLMENT_REJECTED' | 'MFA_VERIFICATION_REJECTED',
    error: unknown,
    credentialKind?: MfaCredential['kind'],
  ): Promise<void> {
    if (!(error instanceof SecurityError)) return;
    const userId = await this.challenges.userIdForAudit(challengeToken, challengeType);
    if (!userId) return;
    await this.prisma.$transaction(tx => this.auditWriter(tx, {
      userId,
      action,
      targetType: 'USER',
      targetId: userId,
      newValues: JSON.stringify({
        reasonCode: error.code,
        ...(credentialKind ? { credentialKind } : {}),
      }),
    }));
  }

  async status(userId: string): Promise<MfaStatusView> {
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { userId, disabledAt: null, verifiedAt: { not: null } },
      include: { recoveryCodes: { where: { usedAt: null }, select: { id: true } } },
    });
    return factor
      ? { enabled: true, verifiedAt: factor.verifiedAt, recoveryCodesRemaining: factor.recoveryCodes.length }
      : { enabled: false, verifiedAt: null, recoveryCodesRemaining: 0 };
  }

  async disableSelf(claims: ActiveSessionClaims, _legacyStepUpToken = ''): Promise<void> {
    void _legacyStepUpToken;
    const now = this.clock();
    await this.prisma.$transaction(async tx => {
      const factor = await activeFactorForUpdate(tx, claims.userId);
      if (!factor?.verifiedAt) throw invalidMfa();
      const administratorGrant = await tx.userRole.findFirst({ where: {
        userId: claims.userId,
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        role: { code: { in: ['SYSTEM_ADMIN', 'SYSTEM_SUPER_ADMIN'] }, status: 'ENABLED' },
      } });
      if (administratorGrant) throw new SecurityError('MFA_REQUIRED', 403);

      await tx.mfaFactor.update({ where: { id: factor.id }, data: { disabledAt: now } });
      await tx.mfaRecoveryCode.updateMany({
        where: { factorId: factor.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.user.update({
        where: { id: claims.userId },
        data: { credentialVersion: { increment: 1 } },
      });
      await tx.authSession.updateMany({
        where: { userId: claims.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'MFA_DISABLED' },
      });
      await this.auditWriter(tx, {
        userId: claims.userId,
        action: 'MFA_DISABLED',
        targetType: 'USER',
        targetId: claims.userId,
      });
    });
  }

  async regenerateRecoveryCodes(
    claims: ActiveSessionClaims,
    _legacyStepUpToken = '',
  ): Promise<{ recoveryCodes: string[] }> {
    void _legacyStepUpToken;
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode);
    const codeHashes = await Promise.all(recoveryCodes.map(code => this.hasher.hash(code)));
    const now = this.clock();
    await this.prisma.$transaction(async tx => {
      const factor = await activeFactorForUpdate(tx, claims.userId);
      if (!factor?.verifiedAt) throw invalidMfa();
      await tx.mfaRecoveryCode.updateMany({
        where: { factorId: factor.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.mfaRecoveryCode.createMany({
        data: codeHashes.map(codeHash => ({ factorId: factor.id, codeHash, createdAt: now })),
      });
      await this.auditWriter(tx, {
        userId: claims.userId,
        action: 'MFA_RECOVERY_CODES_REGENERATED',
        targetType: 'USER',
        targetId: claims.userId,
      });
    });
    return { recoveryCodes };
  }
}

function createRecoveryCode(): string {
  const encoded = encodeBase32(randomBytes(20));
  return encoded.match(/.{8}/g)!.join('-');
}

function encryptedValue(value: {
  encryptedSecret: string;
  secretIv: string;
  secretAuthTag: string;
  keyVersion: number;
}): EncryptedMfaSecret {
  return {
    ciphertext: value.encryptedSecret,
    iv: value.secretIv,
    authTag: value.secretAuthTag,
    keyVersion: value.keyVersion,
  };
}

async function lockActiveFactor(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "mfa_factor"
    WHERE "userId" = ${userId} AND "disabledAt" IS NULL
    FOR UPDATE
  `);
}

async function activeFactorForUpdate(tx: Prisma.TransactionClient, userId: string) {
  await lockActiveFactor(tx, userId);
  return tx.mfaFactor.findFirst({ where: { userId, disabledAt: null } });
}

function invalidMfa(): SecurityError {
  return new SecurityError('MFA_INVALID', 401);
}

function isInvalidMfa(error: unknown): boolean {
  return error instanceof SecurityError && error.code === 'MFA_INVALID';
}
