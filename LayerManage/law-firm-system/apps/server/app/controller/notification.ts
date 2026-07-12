import { Controller } from 'egg';

export default class NotificationController extends Controller {
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, isRead } = ctx.query;
    const userId = ctx.state.user.userId;

    const where: any = { userId };
    if (isRead !== undefined) {
      where.isRead = isRead === 'true';
    }

    const total = await ctx.prisma.notification.count({ where });
    const list = await ctx.prisma.notification.findMany({
      where,
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize),
      orderBy: { createdAt: 'desc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: {
        list,
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / Number(pageSize)),
        },
      },
    };
  }

  async read() {
    const { ctx } = this;
    const { id } = ctx.params;
    const userId = ctx.state.user.userId;

    const notification = await ctx.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification) {
      ctx.throw(404, '通知不存在');
    }

    const updated = await ctx.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    ctx.body = {
      code: 200,
      message: '已标记为已读',
      data: updated,
    };
  }

  async readAll() {
    const { ctx } = this;
    const userId = ctx.state.user.userId;

    await ctx.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    ctx.body = {
      code: 200,
      message: '全部标记为已读',
      data: null,
    };
  }

  async unreadCount() {
    const { ctx } = this;
    const userId = ctx.state.user.userId;

    const count = await ctx.prisma.notification.count({
      where: { userId, isRead: false },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: { count },
    };
  }
}
