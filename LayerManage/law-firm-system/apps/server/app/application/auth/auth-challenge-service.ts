import { Prisma, PrismaClient } from '@prisma/client';
import { createOpaqueToken, hashOpaqueToken } from '../../domain/security/opaque-token';
import { SecurityError, SecurityErrorCode } from '../../domain/security/security-errors';

export type AuthChallengeType = 'PASSWORD_CHANGE' | 'MFA_ENROLLMENT' | 'MFA_VERIFY';

export interface IssuedChallenge {
  token: string;
  expiresIn: 300 | 600;
}

const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 15 * 60 * 1000;

export class AuthChallengeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async issue(userId: string, type: AuthChallengeType): Promise<IssuedChallenge> {
    const now = this.clock();
    const blocked = await this.prisma.authChallenge.findFirst({
      where: {
        userId,
        type,
        failedAttempts: { gte: MAX_ATTEMPTS },
        consumedAt: { gt: new Date(now.getTime() - COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (blocked) throw securityError('MFA_RATE_LIMITED', 429);

    const token = createOpaqueToken();
    const expiresIn = type === 'MFA_ENROLLMENT' ? 600 as const : 300 as const;
    await this.prisma.$transaction(async tx => {
      await tx.authChallenge.updateMany({
        where: { userId, type, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.authChallenge.create({
        data: {
          userId,
          type,
          tokenHash: hashOpaqueToken(token),
          maxAttempts: MAX_ATTEMPTS,
          expiresAt: new Date(now.getTime() + expiresIn * 1000),
        },
      });
    });
    return { token, expiresIn };
  }

  async consume<T>(
    token: string,
    type: AuthChallengeType,
    work: (tx: Prisma.TransactionClient, userId: string) => Promise<T>,
  ): Promise<T> {
    const tokenHash = hashOpaqueToken(typeof token === 'string' ? token : '');
    return this.prisma.$transaction(async tx => {
      await lockByTokenHash(tx, tokenHash);
      const challenge = await tx.authChallenge.findUnique({ where: { tokenHash } });
      if (!challenge || challenge.type !== type || challenge.consumedAt) {
        throw securityError('MFA_INVALID', 401);
      }
      if (challenge.failedAttempts >= challenge.maxAttempts) {
        throw securityError('MFA_RATE_LIMITED', 429);
      }
      if (challenge.expiresAt.getTime() <= this.clock().getTime()) {
        throw securityError('MFA_CHALLENGE_EXPIRED', 401);
      }
      const result = await work(tx, challenge.userId);
      await tx.authChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: this.clock() },
      });
      return result;
    });
  }

  async getActiveUserId(token: string, type: AuthChallengeType): Promise<string> {
    const tokenHash = hashOpaqueToken(typeof token === 'string' ? token : '');
    const challenge = await this.prisma.authChallenge.findUnique({ where: { tokenHash } });
    if (!challenge || challenge.type !== type || challenge.consumedAt) {
      throw securityError('MFA_INVALID', 401);
    }
    if (challenge.failedAttempts >= challenge.maxAttempts) {
      throw securityError('MFA_RATE_LIMITED', 429);
    }
    if (challenge.expiresAt.getTime() <= this.clock().getTime()) {
      throw securityError('MFA_CHALLENGE_EXPIRED', 401);
    }
    return challenge.userId;
  }

  async userIdForAudit(token: string, type: AuthChallengeType): Promise<string | null> {
    const tokenHash = hashOpaqueToken(typeof token === 'string' ? token : '');
    const challenge = await this.prisma.authChallenge.findUnique({
      where: { tokenHash },
      select: { userId: true, type: true },
    });
    return challenge?.type === type ? challenge.userId : null;
  }

  async fail(token: string, type: AuthChallengeType): Promise<never> {
    const tokenHash = hashOpaqueToken(typeof token === 'string' ? token : '');
    const result = await this.prisma.$transaction(async tx => {
      await lockByTokenHash(tx, tokenHash);
      const challenge = await tx.authChallenge.findUnique({ where: { tokenHash } });
      if (!challenge || challenge.type !== type) return failure('MFA_INVALID', 401);
      if (challenge.failedAttempts >= challenge.maxAttempts) return failure('MFA_RATE_LIMITED', 429);
      if (challenge.consumedAt) return failure('MFA_INVALID', 401);
      const now = this.clock();
      if (challenge.expiresAt.getTime() <= now.getTime()) {
        return failure('MFA_CHALLENGE_EXPIRED', 401);
      }
      const failedAttempts = challenge.failedAttempts + 1;
      const limited = failedAttempts >= challenge.maxAttempts;
      await tx.authChallenge.update({
        where: { id: challenge.id },
        data: { failedAttempts, ...(limited ? { consumedAt: now } : {}) },
      });
      return limited ? failure('MFA_RATE_LIMITED', 429) : failure('MFA_INVALID', 401);
    });
    throw securityError(result.code, result.httpStatus);
  }
}

async function lockByTokenHash(tx: Prisma.TransactionClient, tokenHash: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "auth_challenge" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
  `);
}

function failure(code: SecurityErrorCode, httpStatus: number) {
  return { code, httpStatus };
}

function securityError(code: SecurityErrorCode, httpStatus: number): SecurityError {
  return new SecurityError(code, httpStatus);
}
