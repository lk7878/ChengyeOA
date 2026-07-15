import { Controller } from 'egg';
import { createAuthenticationService } from '../application/auth/authentication-factory';

export default class AuthController extends Controller {
  public async login() {
    const { ctx } = this;
    const body = ctx.request.body as { username?: string; password?: string };
    const data = await createAuthenticationService(ctx).login(
      body?.username as string,
      body?.password as string,
      { ip: ctx.ip, userAgent: ctx.get('user-agent') || undefined },
    );
    ctx.body = { code: 200, message: 'success', data };
  }

  public async refresh() {
    const { ctx } = this;
    const body = ctx.request.body as { refreshToken?: string };
    const data = await createAuthenticationService(ctx).refresh(body?.refreshToken as string);
    ctx.body = { code: 200, message: 'success', data };
  }

  public async forcePasswordChange() {
    const { ctx } = this;
    const body = ctx.request.body as { password?: string; confirmation?: string };
    const authorization = ctx.get('authorization');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    await createAuthenticationService(ctx).forcePasswordChange(
      token,
      body?.password as string,
      body?.confirmation as string,
    );
    ctx.body = { code: 200, message: 'success', data: null };
  }

  public async me() {
    const { ctx } = this;
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.state.user.userId },
      include: {
        employee: { include: { organization: true, position: true } },
        userRoles: {
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    if (!user) {
      ctx.throw(404, 'USER_NOT_FOUND');
    }
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
        employee: user.employee,
        roles,
        permissions,
      },
    };
  }

  public async logout() {
    this.ctx.body = { code: 200, message: 'success', data: null };
  }
}
