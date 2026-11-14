import { createHash } from 'node:crypto';
import { DriveShortcut, Prisma } from '@prisma/client';
import { DriveService, optionalParent } from './drive-service';
import { choice, exact, fail, integer, text } from './collaboration-policy';

type Tx = Prisma.TransactionClient;
type Snapshot = Awaited<ReturnType<DriveNavigationService['catalog']>>;

// Navigation metadata never participates in canonical content authorization or the record/SSE hot path.
export class DriveNavigationService extends DriveService {
  private shortcutValue(link: DriveShortcut, snapshot: Snapshot) {
    if (link.deletedAt || link.workspaceId !== snapshot.workspace.id) return null;
    if (!link.parentId && link.ownerId !== this.actor.userId) return null;
    const parent = link.parentId ? snapshot.resolve(link.parentId) : null;
    if (link.parentId && (!parent || parent.row.kind !== 'FOLDER')) return null;
    const target = snapshot.resolve(link.targetId);
    if (!target) return null;
    if (
      [...(parent?.path ?? []), ...target.path].some(
        (part) => snapshot.rows.find((row) => row.id === part.id)?.deletedAt,
      )
    )
      return null;
    return {
      link,
      target,
      canRemove: parent ? parent.access.level >= 3 : link.ownerId === this.actor.userId,
    };
  }

  async shortcut(shortcutId: string, tx: Tx = this.db) {
    const link = await tx.driveShortcut.findUnique({ where: { id: shortcutId } });
    if (!link) fail('COLLAB_NOT_FOUND', 404);
    const value = this.shortcutValue(link, await this.catalog(link.workspaceId, tx));
    if (!value) fail('COLLAB_FORBIDDEN', 403);
    return { shortcutId, target: this.item(value.target) };
  }

  override async list(workspaceId: string, raw: unknown) {
    const input = exact(raw, ['parentId', 'scope', 'q', 'sort', 'direction', 'page', 'pageSize']);
    const scope = choice(input.scope ?? 'all', ['all', 'mine', 'shared', 'trash', 'shortcuts', 'recent']);
    if (scope === 'trash') return super.list(workspaceId, raw);
    const parentId = optionalParent(input.parentId);
    if (parentId && scope !== 'all') fail('COLLAB_INVALID_FILTER');
    const q = input.q ? text(input.q).toLocaleLowerCase() : '';
    const sort = choice(
      input.sort ?? (scope === 'recent' ? 'visitedAt' : 'updatedAt'),
      scope === 'recent' ? ['visitedAt', 'name'] : ['updatedAt', 'name'],
    );
    const direction = choice(input.direction ?? (sort === 'name' ? 'asc' : 'desc'), ['asc', 'desc']);
    const page = integer(Number(input.page ?? 1), 1, 100000),
      pageSize = integer(Number(input.pageSize ?? 50), 1, 100);
    const snapshot = await this.catalog(workspaceId);
    const parent = this.parent(snapshot, parentId);
    const [links, visits] = await Promise.all([
      scope === 'recent'
        ? []
        : this.db.driveShortcut.findMany({
            where: { workspaceId, deletedAt: null },
            include: { owner: { select: { username: true, employee: { select: { name: true } } } } },
          }),
      scope === 'recent'
        ? this.db.driveVisit.findMany({ where: { userId: this.actor.userId, workspaceId } })
        : [],
    ]);
    const visited = new Map(visits.map((visit) => [visit.nodeId, visit.visitedAt]));
    type Entry = ReturnType<DriveService['item']> & {
      targetId?: string;
      targetKind?: string;
      canRemove?: boolean;
      visitedAt?: Date;
    };
    const items: Entry[] =
      scope === 'shortcuts'
        ? []
        : snapshot.rows.flatMap((row) => {
            const value = snapshot.resolve(row.id);
            if (!value || (scope === 'recent' && !visited.has(row.id))) return [];
            if (scope === 'mine' && row.ownerId !== this.actor.userId) return [];
            if (scope === 'shared' && row.ownerId === this.actor.userId) return [];
            if (scope === 'all' && !q && row.parentId !== parentId) return [];
            return [
              { ...this.item(value), ...(scope === 'recent' ? { visitedAt: visited.get(row.id)! } : {}) },
            ];
          });
    for (const link of links) {
      const value = this.shortcutValue(link, snapshot);
      if (!value) continue;
      if (scope === 'all' && !q && link.parentId !== parentId) continue;
      if (scope === 'mine' && link.ownerId !== this.actor.userId) continue;
      if (scope === 'shared' && link.ownerId === this.actor.userId) continue;
      items.push({
        ...this.item(value.target),
        id: link.id,
        kind: 'SHORTCUT',
        targetId: link.targetId,
        targetKind: value.target.row.kind,
        parentId: link.parentId,
        ownerId: link.ownerId,
        ownerName: link.owner.employee?.name || link.owner.username,
        createdAt: link.createdAt,
        canMove: false,
        canTrash: false,
        canRestore: false,
        canShare: false,
        canRename: false,
        canRemove: value.canRemove,
      });
    }
    const filtered = items.filter((item) => !q || item.name.toLocaleLowerCase().includes(q));
    filtered.sort((a, b) => {
      const value =
        sort === 'name'
          ? a.name.localeCompare(b.name, 'zh-CN')
          : sort === 'visitedAt'
            ? a.visitedAt!.getTime() - b.visitedAt!.getTime()
            : a.updatedAt.getTime() - b.updatedAt.getTime();
      return (direction === 'asc' ? value : -value) || a.id.localeCompare(b.id);
    });
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
      workspace: { id: workspaceId, name: snapshot.workspace.name },
      path: parent.path,
      userId: this.actor.userId,
      canManageAccess: snapshot.root.canManageAccess,
      workspaceLevel: snapshot.root.level,
      canCreateFolder:
        scope !== 'recent' && scope !== 'shortcuts' && parent.access.level >= 3 && parent.path.length < 8,
      canCreateBase: scope !== 'recent' && scope !== 'shortcuts' && parent.access.level >= 3,
    };
  }

  private async shortcutDestination(
    workspaceId: string,
    targetId: string,
    parentId: string | null,
    tx: Tx = this.db,
  ) {
    const snapshot = await this.catalog(workspaceId, tx);
    if (!snapshot.resolve(targetId)) fail('COLLAB_FORBIDDEN', 403);
    if (parentId) this.parent(snapshot, parentId, true);
  }
  async createShortcut(workspaceId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['targetId', 'parentId']);
    const targetId = text(input.targetId),
      parentId = optionalParent(input.parentId);
    await this.shortcutDestination(workspaceId, targetId, parentId);
    return this.write(key, ['drive.shortcut.create', workspaceId, targetId, parentId], async (tx) => {
      await this.lock(tx, workspaceId);
      await this.shortcutDestination(workspaceId, targetId, parentId, tx);
      if (
        await tx.driveShortcut.findFirst({
          where: {
            targetId,
            parentId,
            deletedAt: null,
            ...(!parentId ? { ownerId: this.actor.userId } : {}),
          },
        })
      )
        fail('DRIVE_SHORTCUT_EXISTS', 409);
      const link = await tx.driveShortcut.create({
        data: { workspaceId, parentId, targetId, ownerId: this.actor.userId },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'drive.shortcut.created',
          targetType: 'DRIVE_SHORTCUT',
          targetId: link.id,
        },
      });
      return { id: link.id };
    });
  }
  private async removableShortcut(workspaceId: string, shortcutId: string, tx: Tx = this.db) {
    const snapshot = await this.catalog(workspaceId, tx);
    const link = await tx.driveShortcut.findFirst({ where: { id: shortcutId, workspaceId } });
    if (!link) fail('COLLAB_NOT_FOUND', 404);
    if (link.parentId) this.parent(snapshot, link.parentId, true);
    else if (link.ownerId !== this.actor.userId) fail('COLLAB_FORBIDDEN', 403);
    return link;
  }
  async removeShortcut(workspaceId: string, shortcutId: string, raw: unknown, key: unknown) {
    exact(raw, []);
    await this.removableShortcut(workspaceId, shortcutId);
    return this.write(key, ['drive.shortcut.remove', workspaceId, shortcutId], async (tx) => {
      await this.lock(tx, workspaceId);
      const link = await this.removableShortcut(workspaceId, shortcutId, tx);
      if (!link.deletedAt) {
        await tx.driveShortcut.update({ where: { id: shortcutId }, data: { deletedAt: new Date() } });
        await tx.operationLog.create({
          data: {
            userId: this.actor.userId,
            action: 'drive.shortcut.removed',
            targetType: 'DRIVE_SHORTCUT',
            targetId: shortcutId,
          },
        });
      }
      return { id: shortcutId };
    });
  }

  private async visitLock(tx: Tx, workspaceId: string) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ':drive.recent:' + workspaceId}, 0))`,
    );
  }
  async visit(nodeId: string, raw: unknown, key: unknown) {
    exact(raw, []);
    const initial = await this.node(nodeId);
    return this.write(key, ['drive.visit', nodeId], async (tx) => {
      await this.lock(tx, initial.workspaceId, true);
      await this.node(nodeId, tx);
      await this.visitLock(tx, initial.workspaceId);
      const visitedAt = new Date();
      await tx.driveVisit.upsert({
        where: { userId_nodeId: { userId: this.actor.userId, nodeId } },
        create: { userId: this.actor.userId, nodeId, workspaceId: initial.workspaceId, visitedAt },
        update: { visitedAt },
      });
      const expired = await tx.driveVisit.findMany({
        where: { userId: this.actor.userId, workspaceId: initial.workspaceId },
        orderBy: [{ visitedAt: 'desc' }, { nodeId: 'asc' }],
        skip: 100,
        select: { nodeId: true },
      });
      if (expired.length)
        await tx.driveVisit.deleteMany({
          where: { userId: this.actor.userId, nodeId: { in: expired.map((row) => row.nodeId) } },
        });
      return { id: nodeId };
    });
  }
  async clearRecent(workspaceId: string, raw: unknown, key: unknown) {
    exact(raw, []);
    await this.access(workspaceId);
    return this.write(key, ['drive.recent.clear', workspaceId], async (tx) => {
      await this.lock(tx, workspaceId, true);
      await this.access(workspaceId, tx);
      await this.visitLock(tx, workspaceId);
      await tx.driveVisit.deleteMany({ where: { userId: this.actor.userId, workspaceId } });
      return { cleared: true };
    });
  }

  protected override async lifecyclePlan(
    nodeId: string,
    input: ReturnType<DriveNavigationService['lifecycleInput']>,
    tx: Tx,
  ) {
    const plan = await super.lifecyclePlan(nodeId, input, tx);
    const links = await tx.driveShortcut.findMany({
      where: {
        workspaceId: plan.source.row.workspaceId,
        parentId: { in: plan.rows.map((row) => row.id) },
        deletedAt: null,
      },
      orderBy: { id: 'asc' },
    });
    if (plan.rows.length + links.length > 500) fail('DRIVE_SUBTREE_LIMIT');
    plan.public.previewToken = createHash('sha256')
      .update(JSON.stringify([plan.public.previewToken, links]))
      .digest('hex');
    // Targets retain their own identity and content; count only visible references, never linked content twice.
    return {
      ...plan,
      public: {
        ...plan.public,
        affected: {
          ...plan.public.affected,
          shortcuts: links.filter((link) => this.shortcutValue(link, plan.snapshot)).length,
        },
      },
    };
  }
}
