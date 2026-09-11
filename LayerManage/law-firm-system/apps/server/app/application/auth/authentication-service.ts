import { PrismaClient } from '@prisma/client';
import { PasswordHasher } from '../../domain/security/password-hasher';
import { normalizeUsername, validatePassword } from '../../domain/security/password-policy';
import { SecurityError } from '../../domain/security/security-errors';
import { AssuranceLevel } from '../../domain/security/token-service';
import { AuditWriter, writeAuditLog } from '../system/audit-writer';
import { AuthChallengeService } from './auth-challenge-service';
import { MfaCredential, MfaService } from './mfa-service';
import { ActiveSessionClaims, SessionService } from './session-service';

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

export interface AuthenticatedResult {
  mode: 'AUTHENTICATED';
  token: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: 900;
  user: AuthenticatedUser;
  recoveryCodes?: string[];
}

export type LoginResult =
  | { mode: 'PASSWORD_CHANGE_REQUIRED'; challengeToken: string; expiresIn: 300 }
  | { mode: 'MFA_ENROLLMENT_REQUIRED'; challengeToken: string; expiresIn: 600 }
  | { mode: 'MFA_CHALLENGE_REQUIRED'; challengeToken: string; expiresIn: 300 }
  | AuthenticatedResult;

export interface RequestMetadata {
  ip?: string;
  userAgent?: string;
}

type IdentityUser = Awaited<ReturnType<AuthenticationService['loadIdentityUser']>>;

export class AuthenticationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly hasher: PasswordHasher,
    private readonly challenges: AuthChallengeService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly auditWriter: AuditWriter = writeAuditLog,
    private readonly clock: () => Date = () => new Date(),
    private readonly localPasswordLogin = false,
  ) {}

  async login(username: string, password: string, metadata: RequestMetadata): Promise<LoginResult> {
    const usernameSnapshot = typeof username === 'string' ? normalizeUsername(username) : '';
    const passwordValue = typeof password === 'string' ? password : '';
    const user = usernameSnapshot ? await this.loadIdentityUserByUsername(usernameSnapshot) : null;

    if (!user) {
      await this.hasher.compare(passwordValue, DUMMY_PASSWORD_HASH);
      await this.prisma.loginLog.create({
        data: { usernameSnapshot, outcome: 'FAILURE', reasonCode: 'UNKNOWN_USER', ...metadata },
      });
      throw authenticationFailed();
    }

    if (!await this.hasher.compare(passwordValue, user.password)) {
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
        FROM "user" WHERE "id" = ${user.id} FOR UPDATE
      `;
      if (!current) {
        await tx.loginLog.create({
          data: { usernameSnapshot, outcome: 'FAILURE', reasonCode: 'UNKNOWN_USER', ...metadata },
        });
        return null;
      }
      const decisionTime = this.clock();
      const locked = isLocked(current.lockedUntil, decisionTime);
      const credentialChanged = current.credentialVersion !== user.credentialVersion
        || current.password !== user.password;
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
            ...metadata,
          },
        });
        return null;
      }
      await tx.user.update({
        where: { id: current.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      return { userId: current.id, mustChangePassword: current.mustChangePassword };
    });
    if (!loginState) throw authenticationFailed();

    if (loginState.mustChangePassword) {
      const challenge = await this.challenges.issue(loginState.userId, 'PASSWORD_CHANGE');
      return { mode: 'PASSWORD_CHANGE_REQUIRED', challengeToken: challenge.token, expiresIn: 300 };
    }
    return this.nextAuthenticationState(loginState.userId, metadata);
  }

  async beginMfaEnrollment(challengeToken: string) {
    return this.mfa.beginEnrollment(challengeToken);
  }

  async confirmMfaEnrollment(
    challengeToken: string,
    code: string,
    metadata: RequestMetadata,
  ): Promise<AuthenticatedResult> {
    const identity = await this.mfa.confirmEnrollment(challengeToken, code);
    return this.completeAuthentication(identity.userId, 'MFA', metadata, identity.recoveryCodes);
  }

  async verifyMfa(
    challengeToken: string,
    credential: MfaCredential,
    metadata: RequestMetadata,
  ): Promise<AuthenticatedResult> {
    const identity = await this.mfa.verifyLogin(challengeToken, credential);
    return this.completeAuthentication(identity.userId, 'MFA', metadata);
  }

  async refresh(refreshToken: string, metadata: RequestMetadata) {
    const credentials = await this.sessions.rotateRefresh(refreshToken, metadata);
    return {
      token: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      csrfToken: credentials.csrfToken,
      expiresIn: credentials.expiresIn,
    };
  }

  async authenticate(token: string): Promise<ActiveSessionClaims> {
    return this.sessions.authenticateAccess(token);
  }

  async forcePasswordChange(
    challengeToken: string,
    password: string,
    confirmation: string,
    metadata: RequestMetadata = {},
  ): Promise<LoginResult> {
    if (typeof password !== 'string' || typeof confirmation !== 'string' || password !== confirmation) {
      throw new SecurityError('PASSWORD_INVALID');
    }
    const userId = await this.challenges.getActiveUserId(challengeToken, 'PASSWORD_CHANGE');
    const snapshot = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!snapshot?.mustChangePassword) throw authenticationFailed();
    validatePassword(password, snapshot.username);
    if (await this.hasher.compare(password, snapshot.password)) throw new SecurityError('PASSWORD_REUSED');
    const passwordHash = await this.hasher.hash(password);

    await this.challenges.consume(challengeToken, 'PASSWORD_CHANGE', async (tx, lockedUserId) => {
      const [current] = await tx.$queryRaw<Array<{
        id: string;
        password: string;
        status: string;
        lockedUntil: Date | null;
        credentialVersion: number;
        mustChangePassword: boolean;
      }>>`
        SELECT "id", "password", "status", "lockedUntil", "credentialVersion", "mustChangePassword"
        FROM "user" WHERE "id" = ${lockedUserId} FOR UPDATE
      `;
      const changedAt = this.clock();
      if (
        !current
        || current.password !== snapshot.password
        || current.status !== 'ENABLED'
        || isLocked(current.lockedUntil, changedAt)
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
      await tx.authSession.updateMany({
        where: { userId: current.id, revokedAt: null },
        data: { revokedAt: changedAt, revokedReason: 'PASSWORD_CHANGED' },
      });
      await this.auditWriter(tx, {
        userId: current.id,
        action: 'FORCED_PASSWORD_CHANGE',
        targetType: 'USER',
        targetId: current.id,
      });
    });
    return this.nextAuthenticationState(userId, metadata);
  }

  private async nextAuthenticationState(
    userId: string,
    metadata: RequestMetadata,
  ): Promise<LoginResult> {
    const [user, factor] = await Promise.all([
      this.loadIdentityUser(userId),
      this.prisma.mfaFactor.findFirst({
        where: { userId, verifiedAt: { not: null }, disabledAt: null },
        select: { id: true },
      }),
    ]);
    if (!user) throw authenticationFailed();
    if (this.localPasswordLogin) return this.completeAuthentication(userId, 'PASSWORD', metadata);
    if (factor) {
      const challenge = await this.challenges.issue(userId, 'MFA_VERIFY');
      return { mode: 'MFA_CHALLENGE_REQUIRED', challengeToken: challenge.token, expiresIn: 300 };
    }
    if (isAdministrator(user, this.clock())) {
      const challenge = await this.challenges.issue(userId, 'MFA_ENROLLMENT');
      return { mode: 'MFA_ENROLLMENT_REQUIRED', challengeToken: challenge.token, expiresIn: 600 };
    }
    return this.completeAuthentication(userId, 'PASSWORD', metadata);
  }

  private async completeAuthentication(
    userId: string,
    assuranceLevel: AssuranceLevel,
    metadata: RequestMetadata,
    recoveryCodes?: string[],
  ): Promise<AuthenticatedResult> {
    const user = await this.loadIdentityUser(userId);
    if (!user) throw authenticationFailed();
    const completedAt = this.clock();
    const credentials = await this.sessions.create(
      userId,
      assuranceLevel,
      metadata,
      async tx => {
        await tx.user.update({ where: { id: userId }, data: { lastLoginAt: completedAt } });
        await tx.loginLog.create({
          data: {
            user: { connect: { id: userId } },
            usernameSnapshot: user.username,
            outcome: 'SUCCESS',
            reasonCode: null,
            ...metadata,
          },
        });
      },
    );
    return {
      mode: 'AUTHENTICATED',
      token: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      csrfToken: credentials.csrfToken,
      expiresIn: credentials.expiresIn,
      user: authenticatedUser(user, completedAt),
      ...(recoveryCodes ? { recoveryCodes } : {}),
    };
  }

  private async loadIdentityUserByUsername(username: string) {
    return this.prisma.user.findUnique({
      where: { username },
      include: identityInclude,
    });
  }

  private async loadIdentityUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: identityInclude,
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
        FROM "user" WHERE "id" = ${userId} FOR UPDATE
      `;
      if (!current) {
        await tx.loginLog.create({
          data: { usernameSnapshot, outcome: 'FAILURE', reasonCode: 'UNKNOWN_USER', ...metadata },
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
            ...metadata,
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
          lockedUntil: locked ? new Date(decisionTime.getTime() + LOCK_DURATION_MS) : current.lockedUntil,
        },
      });
      await tx.loginLog.create({
        data: {
          user: { connect: { id: userId } },
          usernameSnapshot,
          outcome: locked ? 'LOCKED' : 'FAILURE',
          reasonCode: 'INVALID_PASSWORD',
          ...metadata,
        },
      });
    });
  }
}

const identityInclude = {
  userRoles: {
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  },
} as const;

function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

function authenticationFailed(): SecurityError {
  return new SecurityError('AUTHENTICATION_FAILED', 401);
}

function activeRoleAssignments(user: NonNullable<IdentityUser>, now: Date) {
  return user.userRoles.filter(userRole => (
    userRole.role.status === 'ENABLED'
    && !userRole.revokedAt
    && userRole.validFrom.getTime() <= now.getTime()
    && (!userRole.validUntil || userRole.validUntil.getTime() > now.getTime())
  ));
}

function isAdministrator(user: NonNullable<IdentityUser>, now: Date): boolean {
  return activeRoleAssignments(user, now).some(
    userRole => userRole.role.code === 'SYSTEM_SUPER_ADMIN' || userRole.role.code === 'SYSTEM_ADMIN',
  );
}

function authenticatedUser(user: NonNullable<IdentityUser>, now: Date): AuthenticatedUser {
  const assignments = activeRoleAssignments(user, now);
  const roles = assignments.map(userRole => userRole.role.name);
  const permissions = Array.from(new Set(assignments.flatMap(
    userRole => userRole.role.permissions.map(rolePermission => rolePermission.permission.code),
  )));
  return { id: user.id, username: user.username, name: user.username, roles, permissions };
}
