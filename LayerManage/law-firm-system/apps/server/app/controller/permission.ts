import { Controller } from 'egg';

export default class PermissionController extends Controller {
  /**
   * 权限列表
   */
  async index() {
    const { ctx } = this;
    const { type, status } = ctx.query;

    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const list = await ctx.prisma.permission.findMany({
      where,
      orderBy: { sort: 'asc' },
    });

    ctx.body = {
      code: 200,
      message: 'success',
      data: list,
    };
  }

  /**
   * 权限树
   */
  async tree() {
    const { ctx } = this;

    const permissions = await ctx.prisma.permission.findMany({
      where: { status: 'ENABLED' },
      orderBy: { sort: 'asc' },
    });

    // 构建树形结构
    const buildTree = (items: any[], parentId: string | null = null): any[] => {
      return items
        .filter(item => item.parentId === parentId)
        .map(item => ({
          ...item,
          children: buildTree(items, item.id),
        }));
    };

    const tree = buildTree(permissions);

    ctx.body = {
      code: 200,
      message: 'success',
      data: tree,
    };
  }
}
