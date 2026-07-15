import { PrismaClient } from '@prisma/client';
import { PasswordHasher } from '../../domain/security/password-hasher';
import { normalizeUsername, validatePassword } from '../../domain/security/password-policy';
import { SecurityError } from '../../domain/security/security-errors';
import { AuthTokenClaims, JwtTokenService, TokenType } from '../../domain/security/token-service';
import { AuditWriter, writeAuditLog } from '../system/audit-writer';

const DUMMY_PASSWORD_HASH = 'chengye$bcrypt-sha256$v1$$2a$12$qOeCc6HkVowb3pPphggWdeP1K0WB6I8VddCxCKgOspC5YUTOXmvR.';
const LOCK_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  roles: string[];
  permissions: string[];
}

export type LoginResult =
  | { mode: 'PASSWORD_CHANGE_REQUIRED'; passwordChangeToken: string; expiresIn: 300 }
  | {
    mode: 'AUTHENTICATED';
    token: string;
    refreshToken: string;
    expiresIn: 604800;
    user: AuthenticatedUser;
  };

export interface RequestMetadata {
  ip?: string;
  userAgent?: string;
}

export class AuthenticationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly hasher: PasswordHasher,
    private readonly tokens: JwtTokenService,
    private readonly auditWriter: AuditWriter = writeAuditLog,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async login(username: string, password: string, metadata: RequestMetadata): Promise<LoginResult> {
    const usernameSnapshot = typeof username === 'string' ? normalizeUsername(username) : '';
    const passwordValue = typeof password === 'string' ? password : '';
    const user = usernameSnapshot
      ? await this.prisma.user.findUnique({
        where: { username: usernameSnapshot },
        include: {
          userRoles: {
            include: {
              role: {
                include: { permissions: { include: { permission: true } } },
              },
            },
          },
        },
      })
      : null;

    if (!user) {
      await this.hasher.compare(passwordValue, DUMMY_PASSWORD_HASH);
      await this.prisma.loginLog.create({
        data: {
          usernameSnapshot,
          outcome: 'FAILURE',
          reasonCode: 'UNKNOWN_USER',
          ip: metadata.ip,
          userAgent: metadata.userAgent,
        },
      });
      throw authenticationFailed();
    }

    const passwordMatches = await this.hasher.compare(passwordValue, user.password);
    if (!passwordMatches) {
      await this.recordWrongPassword(user.id, usernameSnapshot, metadata);
      throw authenticationFailed();
    }

    const loginState = await this.prisma.$transaction(async tx => {
      const [current] = await tx.$queryRaw<Array<{
        id: string;
        password: string;
        status: string;
        lockedUntil: Date | null;
        credentialVersion: number;
        mustChangePassword: boolean;
      }>>`
        SELECT "id", "password", "status", "lockedUntil", "credentialVersion", "mustChangePassword"
        FROM "user"
        WHERE "id" = ${user.id}
        FOR UPDATE
      `;
      if (!current) {
        await tx.loginLog.create({
          data: {
            usernameSnapshot,
            outcome: 'FAILURE',
            reasonCode: 'UNKNOWN_USER',
            ip: metadata.ip,
            userAgent: metadata.userAgent,
          },
        });
        return null;
      }
      const decisionTime = this.clock();
      const locked = isLocked(current.lockedUntil, decisionTime);
      const credentialChanged = current.credentialVersion !== user.credentialVersion || current.password !== user.password;
      if (current.status !== 'ENABLED' || locked || credentialChanged) {
        await tx.loginLog.create({
          data: {
            user: { connect: { id: current.id } },
            usernameSnapshot,
            outcome: locked ? 'LOCKED' : 'FAILURE',
            reasonCode: locked
              ? 'ACCOUNT_LOCKED'
              : current.status !== 'ENABLED'
                ? 'USER_DISABLED'
                : 'CREDENTIAL_CHANGED',
            ip: metadata.ip,
            userAgent: metadata.userAgent,
          },
        });
        return null;
      }
      await tx.user.update({
        where: { id: current.id },
        data: { lastLoginAt: decisionTime, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.loginLog.create({
        data: {
          user: { connect: { id: current.id } },
          usernameSnapshot,
          outcome: 'SUCCESS',
          reasonCode: null,
          ip: metadata.ip,
          userAgent: metadata.userAgent,
        },
      });
      return {
        credentialVersion: current.credentialVersion,
        mustChangePassword: current.mustChangePassword,
      };
    });
    if (!loginState) {
      throw authenticationFailed();
    }

    if (loginState.mustChangePassword) {
      return {
        mode: 'PASSWORD_CHANGE_REQUIRED',
        passwordChangeToken: this.tokens.signPasswordChange(user.id, loginState.credentialVersion),
        expiresIn: 300,
      };
    }

    return {
      mode: 'AUTHENTICATED',
      token: this.tokens.signAccess(user.id, loginState.credentialVersion),
      refreshToken: this.tokens.signRefresh(user.id, loginState.credentialVersion),
      expiresIn: 604800,
      user: authenticatedUser(user),
    };
  }

  async refresh(refreshToken: string): Promise<{ token: string; expiresIn: 604800 }> {
    const claims = await this.authenticate(refreshToken, ['refresh']);
    return { token: this.tokens.signAccess(claims.userId, claims.credentialVersion), expiresIn: 604800 };
  }

  async authenticate(token: string, allowedTypes: readonly TokenType[]): Promise<AuthTokenClaims> {
    const claims = this.tokens.verify(typeof token === 'string' ? token : '', allowedTypes);
    const user = await this.prisma.user.findUnique({
      where: { id: claims.userId },
      select: { status: true, lockedUntil: true, credentialVersion: true, mustChangePassword: true },
    });
    if (
      !user
      || user.status !== 'ENABLED'
      || isLocked(user.lockedUntil, this.clock())
      || user.credentialVersion !== claims.credentialVersion
      || (user.mustChangePassword && claims.tokenType !== 'password_change')
    ) {
      throw authenticationFailed();
    }
    return claims;
  }

  async forcePasswordChange(token: string, password: string, confirmation: string): Promise<void> {
    const claims = await this.authenticate(token, ['password_change']);
    if (typeof password !== 'string' || typeof confirmation !== 'string' || password !== confirmation) {
      throw new SecurityError('PASSWORD_INVALID');
    }

    const user = await this.prisma.user.findUnique({ where: { id: claims.userId } });
    if (!user || !user.mustChangePassword) {
      throw authenticationFailed();
    }
    validatePassword(password, user.username);
    if (await this.hasher.compare(password, user.password)) {
      throw new SecurityError('PASSWORD_REUSED');
    }
    const passwordHash = await this.hasher.hash(password);

    await this.prisma.$transaction(async tx => {
      const [current] = await tx.$queryRaw<Array<{
        id: string;
        status: string;
        lockedUntil: Date | null;
        credentialVersion: number;
        mustChangePassword: boolean;
      }>>`
        SELECT "id", "status", "lockedUntil", "credentialVersion", "mustChangePassword"
        FROM "user"
        WHERE "id" = ${claims.userId}
        FOR UPDATE
      `;
      const changedAt = this.clock();
      if (
        !current
        || current.status !== 'ENABLED'
        || isLocked(current.lockedUntil, changedAt)
        || current.credentialVersion !== claims.credentialVersion
        || !current.mustChangePassword
      ) {
        throw authenticationFailed();
      }
      await tx.user.update({
        where: { id: current.id },
        data: {
          password: passwordHash,
          credentialVersion: { increment: 1 },
          passwordChangedAt: changedAt,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await this.auditWriter(tx, {
        userId: current.id,
        action: 'FORCED_PASSWORD_CHANGE',
        targetType: 'USER',
        targetId: current.id,
      });
    });
  }

  private async recordWrongPassword(
    userId: string,
    usernameSnapshot: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const [current] = await tx.$queryRaw<Array<{
        status: string;
        failedLoginCount: number;
        lockedUntil: Date | null;
      }>>`
        SELECT "status", "failedLoginCount", "lockedUntil"
        FROM "user"
        WHERE "id" = ${userId}
        FOR UPDATE
      `;
      if (!current) {
        await tx.loginLog.create({
          data: {
            usernameSnapshot,
            outcome: 'FAILURE',
            reasonCode: 'UNKNOWN_USER',
            ip: metadata.ip,
            userAgent: metadata.userAgent,
          },
        });
        return;
      }
      const decisionTime = this.clock();
      const lockedAtDecision = isLocked(current.lockedUntil, decisionTime);
      if (current.status !== 'ENABLED' || lockedAtDecision) {
        await tx.loginLog.create({
          data: {
            user: { connect: { id: userId } },
            usernameSnapshot,
            outcome: lockedAtDecision ? 'LOCKED' : 'FAILURE',
            reasonCode: lockedAtDecision ? 'ACCOUNT_LOCKED' : 'USER_DISABLED',
            ip: metadata.ip,
            userAgent: metadata.userAgent,
          },
        });
        return;
      }

      const failedLoginCount = current.failedLoginCount + 1;
      const locked = failedLoginCount >= LOCK_THRESHOLD;
      await tx.user.update({
        where: { id: userId },
        data: {
          failedLoginCount,
          lockedUntil: locked
            ? new Date(decisionTime.getTime() + LOCK_DURATION_MS)
            : current.lockedUntil,
        },
      });
      await tx.loginLog.create({
        data: {
          user: { connect: { id: userId } },
          usernameSnapshot,
          outcome: locked ? 'LOCKED' : 'FAILURE',
          reasonCode: 'INVALID_PASSWORD',
          ip: metadata.ip,
          userAgent: metadata.userAgent,
        },
      });
    });
  }
}

function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

function authenticationFailed(): SecurityError {
  return new SecurityError('AUTHENTICATION_FAILED', 401);
}

function authenticatedUser(user: {
  id: string;
  username: string;
  userRoles: Array<{
    role: { name: string; permissions: Array<{ permission: { code: string } }> };
  }>;
}): AuthenticatedUser {
  const roles = user.userRoles.map(userRole => userRole.role.name);
  const permissions = Array.from(new Set(user.userRoles.flatMap(
    userRole => userRole.role.permissions.map(rolePermission => rolePermission.permission.code),
  )));
  return { id: user.id, username: user.username, name: user.username, roles, permissions };
}
