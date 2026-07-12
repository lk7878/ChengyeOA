import { Controller } from 'egg';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

export default class AuthController extends Controller {
  /**
   * 用户登录
   */
  public async login() {
    const { ctx, app } = this;
    const { username, password } = ctx.request.body;

    // 参数校验
    if (!username || !password) {
      ctx.throw(400, '用户名和密码不能为空');
    }

    // 查找用户
    const user = await ctx.prisma.user.findUnique({
      where: { username },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      ctx.throw(401, '用户名或密码错误');
    }

    // 校验密码
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      ctx.throw(401, '用户名或密码错误');
    }

    // 检查用户状态
    if (user.status === 'DISABLED') {
      ctx.throw(403, '账号已被禁用');
    }

    // 生成 JWT Token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      app.config.jwt.secret,
      { expiresIn: '7d' }
    );

    // 生成 Refresh Token
    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      app.config.jwt.secret,
      { expiresIn: '30d' }
    );

    // 提取权限列表
    const permissions: string[] = [];
    const roles: string[] = [];
    user.userRoles.forEach((ur: any) => {
      roles.push(ur.role.name);
      ur.role.permissions.forEach((rp: any) => {
        if (!permissions.includes(rp.permission.code)) {
          permissions.push(rp.permission.code);
        }
      });
    });

    // 更新最后登录时间
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 记录登录日志
    await ctx.prisma.loginLog.create({
      data: {
        userId: user.id,
        ip: ctx.ip,
        userAgent: ctx.get('user-agent'),
      },
    });

    ctx.body = {
      code: 200,
      message: '登录成功',
      data: {
        token,
        refreshToken,
        expiresIn: 604800, // 7天
        user: {
          id: user.id,
          username: user.username,
          name: user.username,
          roles,
          permissions,
        },
      },
    };
  }

  /**
   * 刷新 Token
   */
  public async refresh() {
    const { ctx, app } = this;
    const { refreshToken } = ctx.request.body;

    if (!refreshToken) {
      ctx.throw(400, '刷新令牌不能为空');
    }

    try {
      const decoded = jwt.verify(refreshToken, app.config.jwt.secret) as any;
      
      if (decoded.type !== 'refresh') {
        ctx.throw(401, '无效的刷新令牌');
      }

      // 生成新的 Access Token
      const token = jwt.sign(
        { userId: decoded.userId },
        app.config.jwt.secret,
        { expiresIn: (app.config.jwt as any).expiresIn }
      );

      ctx.body = {
        code: 200,
        message: '刷新成功',
        data: { token, expiresIn: 604800 },
      };
    } catch (err) {
      ctx.throw(401, '刷新令牌已过期');
    }
  }

  /**
   * 获取当前用户信息
   */
  public async me() {
    const { ctx } = this;
    const userId = ctx.state.user.userId;

    const user = await ctx.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          include: {
            organization: true,
            position: true,
          },
        },
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      ctx.throw(404, '用户不存在');
    }

    const permissions: string[] = [];
    const roles: string[] = [];
    user.userRoles.forEach((ur: any) => {
      roles.push(ur.role.name);
      ur.role.permissions.forEach((rp: any) => {
        if (!permissions.includes(rp.permission.code)) {
          permissions.push(rp.permission.code);
        }
      });
    });

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

  /**
   * 用户登出
   */
  public async logout() {
    const { ctx } = this;
    // 客户端清除 Token 即可
    // 服务端可以加入黑名单机制（如果需要）
    ctx.body = {
      code: 200,
      message: '登出成功',
      data: null,
    };
  }
}
