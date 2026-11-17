import { Context, Controller } from 'egg';
import {
  createAuthenticationService,
  createAuthenticationServices,
} from '../application/auth/authentication-factory';
import { AuthenticatedResult, LoginResult } from '../application/auth/authentication-service';
import {
  StepUpTargetValidationError,
  validateStepUpPurposeAndTarget,
} from '../domain/security/step-up-target';
import { authorizationInputError } from '../domain/authorization/authorization-errors';
import {
  EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE,
  projectEmployeeWithPrimaryAssignment,
} from '../application/master-data/employee-projection';

export default class AuthController extends Controller {
  public async login() {
    const { ctx } = this;
    const body = ctx.request.body as { username?: string; password?: string };
    const data = await createAuthenticationService(ctx).login(
      body?.username as string,
      body?.password as string,
      requestMetadata(ctx),
    );
    respondAuthentication(ctx, data);
  }

  public async beginMfaEnrollment() {
    const body = this.ctx.request.body as { challengeToken?: string };
    const data = await createAuthenticationService(this.ctx).beginMfaEnrollment(body?.challengeToken as string);
    this.ctx.body = { code: 200, message: 'success', data };
  }

  public async startMfaEnrollment() {
    const data = await createAuthenticationServices(this.ctx).mfa.startOptionalEnrollment(
      this.ctx.state.user,
    );
    this.ctx.body = { code: 200, message: 'success', data };
  }

  public async confirmMfaEnrollment() {
    const body = this.ctx.request.body as { challengeToken?: string; code?: string };
    const data = await createAuthenticationService(this.ctx).confirmMfaEnrollment(
      body?.challengeToken as string,
      body?.code as string,
      requestMetadata(this.ctx),
    );
    respondAuthentication(this.ctx, data);
  }

  public async verifyMfa() {
    const body = this.ctx.request.body as {
      challengeToken?: string;
      credential?: { kind?: 'TOTP' | 'RECOVERY_CODE'; code?: string };
    };
    const credential = body?.credential?.kind === 'RECOVERY_CODE'
      ? { kind: 'RECOVERY_CODE' as const, code: body.credential.code as string }
      : { kind: 'TOTP' as const, code: body?.credential?.code as string };
    const data = await createAuthenticationService(this.ctx).verifyMfa(
      body?.challengeToken as string,
      credential,
      requestMetadata(this.ctx),
    );
    respondAuthentication(this.ctx, data);
  }

  public async refresh() {
    const rawRefreshToken = this.ctx.cookies.get('chengye_refresh', { signed: false }) ?? '';
    const data = await createAuthenticationService(this.ctx).refresh(
      rawRefreshToken,
      requestMetadata(this.ctx),
    );
    setAuthenticationCookies(this.ctx, data.refreshToken, data.csrfToken);
    this.ctx.body = { code: 200, message: 'success', data: stripRefreshToken(data) };
  }

  public async forcePasswordChange() {
    const { ctx } = this;
    const body = ctx.request.body as { challengeToken?: string; password?: string; confirmation?: string };
    const authorization = ctx.get('authorization');
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const data = await createAuthenticationService(ctx).forcePasswordChange(
      (body?.challengeToken || bearer) as string,
      body?.password as string,
      body?.confirmation as string,
      requestMetadata(ctx),
    );
    respondAuthentication(ctx, data);
  }

  public async changePassword() {
    const body = this.ctx.request.body as { currentPassword: string; password: string; confirmation: string };
    const data = await createAuthenticationService(this.ctx).changePassword(
      this.ctx.state.user, body?.currentPassword, body?.password, body?.confirmation, requestMetadata(this.ctx),
    );
    setAuthenticationCookies(this.ctx, data.refreshToken, data.csrfToken);
    this.ctx.body = { code: 200, message: 'success', data: stripRefreshToken(data) };
  }

  public async me() {
    const { ctx } = this;
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.state.user.userId },
      include: {
        employee: { include: EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE },
        userRoles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user) ctx.throw(404, 'USER_NOT_FOUND');
    const roles = user.userRoles.map(userRole => userRole.role.name);
    const permissions = Array.from(new Set(user.userRoles.flatMap(
      userRole => userRole.role.permissions.map(rolePermission => rolePermission.permission.code),
    )));
    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        id: user.id,
        username: user.username,
        status: user.status,
        name: user.username,
        employee: user.employee ? projectEmployeeWithPrimaryAssignment(user.employee) : null,
        roles,
        permissions,
      },
    };
  }

  public async logout() {
    const authorization = this.ctx.get('authorization');
    const token = /^Bearer ([^ ]+)$/.exec(authorization)?.[1] || '';
    if (authorization && !token) this.ctx.throw(401, 'TOKEN_INVALID');
    await createAuthenticationServices(this.ctx).sessions.logoutPresented(token,
      this.ctx.cookies.get('chengye_refresh', { signed: false }) || '');
    clearAuthenticationCookies(this.ctx);
    this.ctx.body = { code: 200, message: 'success', data: null };
  }

  public async sessions() {
    const data = await createAuthenticationServices(this.ctx).sessions.list(
      this.ctx.state.user.userId,
      this.ctx.state.user.sessionId,
    );
    this.ctx.body = { code: 200, message: 'success', data };
  }

  public async revokeSession() {
    const revoked = await createAuthenticationServices(this.ctx).sessions.revokeOwned(
      this.ctx.state.user.userId,
      this.ctx.params.id,
      'USER_SESSION_REVOKE',
    );
    if (!revoked) this.ctx.throw(404, 'SESSION_NOT_FOUND');
    this.ctx.body = { code: 200, message: 'success', data: null };
  }

  public async logoutAll() {
    const body = this.ctx.request.body as { preserveCurrent?: boolean };
    const preserveCurrent = body?.preserveCurrent === true;
    const revokedCount = await createAuthenticationServices(this.ctx).sessions.revokeAll(
      this.ctx.state.user.userId, 'USER_LOGOUT_ALL',
      preserveCurrent ? this.ctx.state.user.sessionId : undefined,
    );
    if (!preserveCurrent) clearAuthenticationCookies(this.ctx);
    this.ctx.body = { code: 200, message: 'success', data: { revokedCount } };
  }

  public async stepUp() {
    const body = this.ctx.request.body as { purpose?: unknown; target?: unknown; code?: string };
    let purpose;
    try {
      purpose = validateStepUpPurposeAndTarget(body?.purpose, body?.target);
    } catch (error) {
      if (error instanceof StepUpTargetValidationError) authorizationInputError();
      throw error;
    }
    const data = await createAuthenticationServices(this.ctx).stepUp.issue(this.ctx.state.user, {
      purpose,
      target: body?.target,
      code: body?.code as string,
    });
    this.ctx.body = { code: 200, message: 'success', data };
  }

  public async mfaStatus() {
    const data = await createAuthenticationServices(this.ctx).mfa.status(this.ctx.state.user.userId);
    this.ctx.body = { code: 200, message: 'success', data: { ...data, canManageHighRisk: Boolean(this.ctx.state.authorization?.isSystemAdmin || this.ctx.state.authorization?.isSystemSuperAdmin) } };
  }

  public async disableMfa() {
    await createAuthenticationServices(this.ctx).mfa.disableSelf(
      this.ctx.state.user,
    );
    clearAuthenticationCookies(this.ctx);
    this.ctx.body = { code: 200, message: 'success', data: null };
  }

  public async regenerateRecoveryCodes() {
    const data = await createAuthenticationServices(this.ctx).mfa.regenerateRecoveryCodes(
      this.ctx.state.user,
    );
    this.ctx.body = { code: 200, message: 'success', data };
  }
}

function respondAuthentication(
  ctx: Context,
  data: LoginResult,
): void {
  if (data.mode !== 'AUTHENTICATED') {
    ctx.body = { code: 200, message: 'success', data };
    return;
  }
  const authenticated = data as AuthenticatedResult;
  setAuthenticationCookies(ctx, authenticated.refreshToken, authenticated.csrfToken);
  ctx.body = { code: 200, message: 'success', data: stripRefreshToken(authenticated) };
}

function stripRefreshToken<T extends { refreshToken: unknown }>(data: T): Omit<T, 'refreshToken'> {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => key !== 'refreshToken'),
  ) as Omit<T, 'refreshToken'>;
}

function requestMetadata(ctx: Context) {
  return { ip: ctx.ip, userAgent: ctx.get('user-agent') || undefined };
}

function setAuthenticationCookies(ctx: Context, refreshToken: string, csrfToken: string): void {
  const config = ctx.app.config as typeof ctx.app.config & { identitySecurity: { production: boolean } };
  const common = {
    secure: config.identitySecurity.production,
    sameSite: 'strict' as const,
    overwrite: true,
    path: '/api/v1/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    signed: false,
  };
  ctx.cookies.set('chengye_refresh', refreshToken, { ...common, httpOnly: true });
  // The SPA reads the CSRF token from every page before refreshing its session.
  // Keep the HttpOnly refresh credential restricted to the authentication path.
  // Synchronize the legacy path too: existing browsers may still send it first.
  ctx.cookies.set('chengye_csrf', csrfToken, { ...common, httpOnly: false });
  ctx.cookies.set('chengye_csrf', csrfToken, { ...common, path: '/', overwrite: false, httpOnly: false });
}

function clearAuthenticationCookies(ctx: Context): void {
  const config = ctx.app.config as typeof ctx.app.config & { identitySecurity: { production: boolean } };
  const common = {
    secure: config.identitySecurity.production,
    sameSite: 'strict' as const,
    overwrite: true,
    path: '/api/v1/auth',
    signed: false,
  };
  ctx.cookies.set('chengye_refresh', null, { ...common, httpOnly: true });
  ctx.cookies.set('chengye_csrf', null, { ...common, httpOnly: false });
  ctx.cookies.set('chengye_csrf', null, { ...common, path: '/', overwrite: false, httpOnly: false });
}
