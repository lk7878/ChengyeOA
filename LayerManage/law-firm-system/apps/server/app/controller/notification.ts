import { Prisma } from '@prisma/client';
import { Controller } from 'egg';

const NOTIFICATION_SAFE_SELECT = {
  id: true,
  type: true,
  title: true,
  content: true,
  isRead: true,
  relatedId: true,
  relatedType: true,
  routeUrl: true,
  createdAt: true,
} as const;

export default class NotificationController extends Controller {
  async index() {
    const { ctx } = this;
    const { page = 1, pageSize = 10, isRead } = ctx.query;
    const userId = ctx.state.user.userId;

    const where: Prisma.NotificationWhereInput = { userId };
    if (isRead !== undefined) {
      where.isRead = isRead === 'true';
    }

    const total = await ctx.prisma.notification.count({ where });
    const list = await ctx.prisma.notification.findMany({
      where,
      select: NOTIFICATION_SAFE_SELECT,
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

    const updated = await ctx.prisma.$transaction(async tx => {
      const result = await tx.notification.updateMany({
        where: { id, userId },
        data: { isRead: true },
      });
      if (result.count !== 1) return null;
      return tx.notification.findUnique({
        where: { id },
        select: NOTIFICATION_SAFE_SELECT,
      });
    });
    if (!updated) ctx.throw(404, '通知不存在');

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
