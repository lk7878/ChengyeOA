import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { createOpaqueToken, hashOpaqueToken } from '../../domain/security/opaque-token';
import { SecurityError } from '../../domain/security/security-errors';
import { AssuranceLevel, JwtTokenService } from '../../domain/security/token-service';
import { AuditWriter, writeAuditLog } from '../system/audit-writer';
import type { RequestMetadata } from './authentication-service';
import type { StepUpService } from './step-up-service';

const ACCESS_EXPIRES_IN = 900 as const;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionCredentials {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: 900;
  sessionId: string;
}

export interface ActiveSessionClaims {
  userId: string;
  sessionId: string;
  credentialVersion: number;
  assuranceLevel: AssuranceLevel;
}

export interface SessionView {
  id: string;
  assuranceLevel: AssuranceLevel;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  current: boolean;
  ipPrefix: string | null;
}

export type SessionCompletion = (
  tx: Prisma.TransactionClient,
  session: { id: string; userId: string },
) => Promise<void>;

export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: JwtTokenService,
    private readonly auditWriter: AuditWriter = writeAuditLog,
    private readonly clock: () => Date = () => new Date(),
    private readonly stepUp?: Pick<StepUpService, 'consume'>,
  ) {}

  async create(
    userId: string,
    assuranceLevel: AssuranceLevel,
    metadata: RequestMetadata,
    completion?: SessionCompletion,
  ): Promise<SessionCredentials> {
    const now = this.clock();
    const refreshToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const session = await this.prisma.$transaction(async tx => {
      await lockUser(tx, userId);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          status: true,
          lockedUntil: true,
          credentialVersion: true,
          mustChangePassword: true,
        },
      });
      if (!isActiveUser(user, now)) throw authenticationFailed();
      const created = await tx.authSession.create({
        data: {
          userId,
          credentialVersion: user.credentialVersion,
          assuranceLevel,
          refreshTokenHash: hashOpaqueToken(refreshToken),
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
          userAgentHash: metadata.userAgent ? sha256(metadata.userAgent) : null,
          ipPrefix: ipPrefix(metadata.ip),
        },
      });
      await this.auditWriter(tx, {
        userId,
        action: 'AUTH_SESSION_CREATED',
        targetType: 'AUTH_SESSION',
        targetId: created.id,
        ip: metadata.ip,
      });
      if (completion) await completion(tx, { id: created.id, userId: created.userId });
      return created;
    });
    return this.credentials(session, refreshToken, csrfToken);
  }

  async authenticateAccess(token: string): Promise<ActiveSessionClaims> {
    const claims = this.tokens.verifySessionAccess(token);
    // Read the session and account security state together without loading token hashes.
    const [row] = await this.prisma.$queryRaw<Array<{
      id: string; userId: string; credentialVersion: number; assuranceLevel: string;
      revokedAt: Date | null; expiresAt: Date; status: string; lockedUntil: Date | null;
      mustChangePassword: boolean; userCredentialVersion: number;
    }>>`
      SELECT s.id, s."userId", s."credentialVersion", s."assuranceLevel", s."revokedAt", s."expiresAt",
        u.status, u."lockedUntil", u."mustChangePassword", u."credentialVersion" AS "userCredentialVersion"
      FROM auth_session s JOIN "user" u ON u.id = s."userId" WHERE s.id = ${claims.sessionId}
    `;
    const session = row && { ...row, user: {
      status: row.status, lockedUntil: row.lockedUntil, mustChangePassword: row.mustChangePassword,
      credentialVersion: row.userCredentialVersion,
    } };
    const now = this.clock();
    if (
      !session
      || session.userId !== claims.userId
      || session.credentialVersion !== claims.credentialVersion
      || session.assuranceLevel !== claims.assuranceLevel
      || session.revokedAt
      || session.expiresAt.getTime() <= now.getTime()
      || !isActiveUser(session.user, now)
      || session.user.credentialVersion !== session.credentialVersion
    ) {
      throw sessionRevoked();
    }
    return {
      userId: session.userId,
      sessionId: session.id,
      credentialVersion: session.credentialVersion,
      assuranceLevel: session.assuranceLevel as AssuranceLevel,
    };
  }

  async rotateRefresh(rawRefreshToken: string, metadata: RequestMetadata): Promise<SessionCredentials> {
    const tokenHash = hashOpaqueToken(typeof rawRefreshToken === 'string' ? rawRefreshToken : '');
    const candidate = await this.prisma.authSession.findFirst({
      where: { OR: [{ refreshTokenHash: tokenHash }, { previousRefreshTokenHash: tokenHash }] },
      select: { id: true },
    });
    if (!candidate) throw authenticationFailed();
    const now = this.clock();
    const nextRefreshToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const outcome = await this.prisma.$transaction(async tx => {
      await lockSession(tx, candidate.id);
      const session = await tx.authSession.findUnique({
        where: { id: candidate.id },
        include: {
          user: {
            select: {
              status: true,
              lockedUntil: true,
              credentialVersion: true,
              mustChangePassword: true,
            },
          },
        },
      });
      if (!session) return { kind: 'INVALID' } as const;
      if (session.previousRefreshTokenHash === tokenHash) {
        await tx.authSession.update({
          where: { id: session.id },
          data: { revokedAt: now, revokedReason: 'REFRESH_TOKEN_REUSED' },
        });
        await this.auditWriter(tx, {
          userId: session.userId,
          action: 'REFRESH_TOKEN_REUSED',
          targetType: 'AUTH_SESSION',
          targetId: session.id,
          ip: metadata.ip,
        });
        return { kind: 'REUSED' } as const;
      }
      if (
        session.refreshTokenHash !== tokenHash
        || session.revokedAt
        || session.expiresAt.getTime() <= now.getTime()
        || !isActiveUser(session.user, now)
        || session.user.credentialVersion !== session.credentialVersion
      ) {
        return { kind: 'REVOKED' } as const;
      }
      const updated = await tx.authSession.update({
        where: { id: session.id },
        data: {
          previousRefreshTokenHash: session.refreshTokenHash,
          previousRefreshRotatedAt: now,
          refreshTokenHash: hashOpaqueToken(nextRefreshToken),
          refreshGeneration: { increment: 1 },
          lastSeenAt: now,
          ...(metadata.userAgent ? { userAgentHash: sha256(metadata.userAgent) } : {}),
          ...(metadata.ip ? { ipPrefix: ipPrefix(metadata.ip) } : {}),
        },
      });
      return { kind: 'ROTATED', session: updated } as const;
    });
    if (outcome.kind === 'REUSED') throw new SecurityError('REFRESH_TOKEN_REUSED', 401);
    if (outcome.kind === 'REVOKED') throw sessionRevoked();
    if (outcome.kind === 'INVALID') throw authenticationFailed();
    return this.credentials(outcome.session, nextRefreshToken, csrfToken);
  }

  async revokeCurrent(sessionId: string, reason: string): Promise<void> {
    const now = this.clock();
    await this.prisma.$transaction(async tx => {
      await lockSession(tx, sessionId);
      const session = await tx.authSession.findUnique({ where: { id: sessionId } });
      if (!session || session.revokedAt) return;
      await tx.authSession.update({
        where: { id: sessionId },
        data: { revokedAt: now, revokedReason: reason },
      });
      await this.auditWriter(tx, {
        userId: session.userId,
        action: 'AUTH_SESSION_REVOKED',
        targetType: 'AUTH_SESSION',
        targetId: sessionId,
      });
    });
  }

  async revokeOwned(userId: string, sessionId: string, reason: string): Promise<boolean> {
    const now = this.clock();
    return this.prisma.$transaction(async tx => {
      await lockSession(tx, sessionId);
      const session = await tx.authSession.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== userId || session.revokedAt) return false;
      await tx.authSession.update({
        where: { id: sessionId },
        data: { revokedAt: now, revokedReason: reason },
      });
      await this.auditWriter(tx, {
        userId,
        action: 'AUTH_SESSION_REVOKED',
        targetType: 'AUTH_SESSION',
        targetId: sessionId,
      });
      return true;
    });
  }

  async revokeAll(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const now = this.clock();
    return this.prisma.$transaction(async tx => {
      const result = await tx.authSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
        },
        data: { revokedAt: now, revokedReason: reason },
      });
      await this.auditWriter(tx, {
        userId,
        action: 'AUTH_SESSIONS_REVOKED',
        targetType: 'USER',
        targetId: userId,
        newValues: JSON.stringify({ count: result.count, reason }),
      });
      return result.count;
    });
  }

  async revokeOwnedWithStepUp(
    claims: ActiveSessionClaims,
    sessionId: string,
    stepUpToken: string,
  ): Promise<boolean> {
    if (!this.stepUp) throw new SecurityError('STEP_UP_REQUIRED', 403);
    const now = this.clock();
    return this.prisma.$transaction(async tx => {
      await lockSession(tx, sessionId);
      const session = await tx.authSession.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== claims.userId || session.revokedAt) return false;
      await this.stepUp!.consume(
        tx, claims, 'SESSION_REVOKE', { sessionId }, stepUpToken,
      );
      await tx.authSession.update({
        where: { id: sessionId },
        data: { revokedAt: now, revokedReason: 'USER_SESSION_REVOKE' },
      });
      await this.auditWriter(tx, {
        userId: claims.userId,
        action: 'AUTH_SESSION_REVOKED',
        targetType: 'AUTH_SESSION',
        targetId: sessionId,
      });
      return true;
    });
  }

  async revokeAllWithStepUp(
    claims: ActiveSessionClaims,
    stepUpToken: string,
    preserveCurrent = false,
  ): Promise<number> {
    if (!this.stepUp) throw new SecurityError('STEP_UP_REQUIRED', 403);
    const now = this.clock();
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "auth_session"
        WHERE "userId" = ${claims.userId} AND "revokedAt" IS NULL
        ORDER BY "id" FOR UPDATE
      `);
      await this.stepUp!.consume(
        tx, claims, 'SESSION_REVOKE_ALL', { userId: claims.userId }, stepUpToken,
      );
      const result = await tx.authSession.updateMany({
        where: {
          userId: claims.userId,
          revokedAt: null,
          ...(preserveCurrent ? { id: { not: claims.sessionId } } : {}),
        },
        data: { revokedAt: now, revokedReason: 'USER_LOGOUT_ALL' },
      });
      await this.auditWriter(tx, {
        userId: claims.userId,
        action: 'AUTH_SESSIONS_REVOKED',
        targetType: 'USER',
        targetId: claims.userId,
        newValues: JSON.stringify({ count: result.count, preserveCurrent }),
      });
      return result.count;
    });
  }

  async list(userId: string, currentSessionId: string): Promise<SessionView[]> {
    const sessions = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: this.clock() } },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map(session => ({
      id: session.id,
      assuranceLevel: session.assuranceLevel as AssuranceLevel,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      current: session.id === currentSessionId,
      ipPrefix: session.ipPrefix,
    }));
  }

  private credentials(
    session: { id: string; userId: string; credentialVersion: number; assuranceLevel: string },
    refreshToken: string,
    csrfToken: string,
  ): SessionCredentials {
    return {
      accessToken: this.tokens.signSessionAccess(
        session.userId,
        session.id,
        session.credentialVersion,
        session.assuranceLevel as AssuranceLevel,
      ),
      refreshToken,
      csrfToken,
      expiresIn: ACCESS_EXPIRES_IN,
      sessionId: session.id,
    };
  }
}

async function lockSession(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "auth_session" WHERE "id" = ${sessionId} FOR UPDATE`);
}

async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${userId} FOR UPDATE`);
}

function isActiveUser(user: {
  status: string;
  lockedUntil: Date | null;
  mustChangePassword: boolean;
} | null, now: Date): user is NonNullable<typeof user> & { credentialVersion: number } {
  return Boolean(
    user
    && user.status === 'ENABLED'
    && (!user.lockedUntil || user.lockedUntil.getTime() <= now.getTime())
    && !user.mustChangePassword,
  );
}

function ipPrefix(ip?: string): string | null {
  if (!ip) return null;
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;
  if (ip.includes(':')) {
    const segments = ip.split(':').filter(Boolean).slice(0, 4);
    return `${segments.join(':')}::/64`;
  }
  return null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function authenticationFailed(): SecurityError {
  return new SecurityError('AUTHENTICATION_FAILED', 401);
}

function sessionRevoked(): SecurityError {
  return new SecurityError('SESSION_REVOKED', 401);
}
