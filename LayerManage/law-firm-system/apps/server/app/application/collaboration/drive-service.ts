import { DriveNode, Prisma } from '@prisma/client';
import { Access, CollaborationService } from './collaboration-service';
import { choice, exact, fail, integer, json, text } from './collaboration-policy';
import { accessInput, resourcePolicy, restrictResourceAccess } from './resource-access';

type Tx = Prisma.TransactionClient;
function optionalParent(value: unknown): string | null {
  return value === undefined || value === null || value === '' ? null : text(value);
}
type CatalogRow = DriveNode & {
  baseName: string | null;
  baseVersion: number | null;
  basePolicy: Prisma.JsonValue;
  activityAt: Date | null;
  ownerName: string;
};
type Location = { id: string; name: string; kind: string; level: number; selfOnly: boolean };
type Resolved = { row: CatalogRow; access: Access; path: Location[] };

export class DriveService extends CollaborationService {
  private async catalog(workspaceId: string, tx: Tx = this.db) {
    const root = await this.access(workspaceId, tx);
    const principals = await this.principals(tx);
    const workspace = await tx.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const rows = await tx.$queryRaw<CatalogRow[]>(Prisma.sql`
      SELECT n.*, b.name AS "baseName", b.version AS "baseVersion", b."accessPolicy" AS "basePolicy",
        COALESCE(e.name, u.username) AS "ownerName",
        (SELECT ce."createdAt" FROM collab_event ce WHERE ce."baseId" = b.id ORDER BY ce.id DESC LIMIT 1) AS "activityAt"
      FROM drive_node n LEFT JOIN collab_base b ON b.id = n."baseId"
      JOIN "user" u ON u.id = n."ownerId" LEFT JOIN employee e ON e.id = u."employeeId"
      WHERE n."workspaceId" = ${workspaceId}
    `);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const memo = new Map<string, Resolved | null>(); // This request only; never retained on the service.
    const resolve = (id: string, trail: string[] = []): Resolved | null => {
      if (memo.has(id)) return memo.get(id)!;
      const row = byId.get(id);
      if (!row || trail.includes(id) || trail.length > 8) return null;
      const parent = row.parentId ? resolve(row.parentId, [...trail, id]) : null;
      if (row.parentId && (!parent || parent.row.kind !== 'FOLDER')) return null;
      if (!['BASE', 'FOLDER'].includes(row.kind) || (row.kind === 'BASE' && !row.baseName)) return null;
      try {
        const access = restrictResourceAccess(
          parent?.access ?? root,
          row.kind === 'BASE' ? row.basePolicy : row.accessPolicy,
          principals,
        );
        const path = [
          ...(parent?.path ?? []),
          {
            id: row.id,
            name: (row.kind === 'BASE' ? row.baseName : row.folderName)!,
            kind: row.kind,
            level: access.level,
            selfOnly: access.selfOnly,
          },
        ];
        if (path.filter((part) => part.kind === 'FOLDER').length > 8) return null;
        const value = { row, access, path };
        memo.set(id, value);
        return value;
      } catch (error) {
        if ((error as { code?: string }).code !== 'COLLAB_FORBIDDEN') throw error;
        memo.set(id, null);
        return null;
      }
    };
    return { root, workspace, rows, resolve };
  }

  private item(value: Resolved) {
    const { row, access, path } = value;
    return {
      id: row.id,
      kind: row.kind,
      name: path.at(-1)!.name,
      workspaceId: row.workspaceId,
      parentId: row.parentId,
      baseId: row.baseId,
      ownerId: row.ownerId,
      ownerName: row.ownerName,
      createdAt: row.createdAt,
      updatedAt: new Date(Math.max(row.updatedAt.getTime(), row.activityAt?.getTime() ?? 0)),
      version: row.kind === 'BASE' ? row.baseVersion! : row.version,
      path,
      canRename: access.level >= 3,
      canShare: access.canManageAccess,
      access: {
        level: access.level,
        selfOnly: access.selfOnly,
        canCreate: access.canCreate,
        hiddenFieldCount: access.hidden.length,
        readonlyFieldCount: access.readonly.length,
      },
    };
  }

  private parent(
    snapshot: Awaited<ReturnType<DriveService['catalog']>>,
    parentId: string | null,
    manage = false,
  ) {
    const value = parentId ? snapshot.resolve(parentId) : null;
    if (parentId && (!value || value.row.kind !== 'FOLDER')) fail('COLLAB_FORBIDDEN', 403);
    const access = value?.access ?? snapshot.root;
    if (manage && access.level < 3) fail('COLLAB_FORBIDDEN', 403);
    return { value, access, path: value?.path ?? [] };
  }

  async list(workspaceId: string, raw: unknown) {
    const input = exact(raw, ['parentId', 'scope', 'q', 'sort', 'direction', 'page', 'pageSize']);
    const parentId = optionalParent(input.parentId);
    const scope = choice(input.scope ?? 'all', ['all', 'mine', 'shared']);
    if (parentId && scope !== 'all') fail('COLLAB_INVALID_FILTER');
    const search = input.q ? text(input.q).toLocaleLowerCase() : '';
    const sort = choice(input.sort ?? 'updatedAt', ['name', 'updatedAt']);
    const direction = choice(input.direction ?? (sort === 'name' ? 'asc' : 'desc'), ['asc', 'desc']);
    const page = integer(Number(input.page ?? 1), 1, 100000);
    const pageSize = integer(Number(input.pageSize ?? 50), 1, 100);
    const snapshot = await this.catalog(workspaceId);
    const parent = this.parent(snapshot, parentId);
    const items = snapshot.rows.flatMap((row) => {
      const visible = snapshot.resolve(row.id);
      if (!visible) return [];
      if (scope === 'mine' && row.ownerId !== this.actor.userId) return [];
      if (scope === 'shared' && row.ownerId === this.actor.userId) return [];
      if (scope === 'all' && !search && row.parentId !== parentId) return [];
      const item = this.item(visible);
      if (search && !item.name.toLocaleLowerCase().includes(search)) return [];
      return [item];
    });
    items.sort((a, b) => {
      const value =
        sort === 'name'
          ? a.name.localeCompare(b.name, 'zh-CN')
          : a.updatedAt.getTime() - b.updatedAt.getTime();
      return (direction === 'asc' ? value : -value) || a.id.localeCompare(b.id);
    });
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      pageSize,
      workspace: { id: workspaceId, name: snapshot.workspace.name },
      path: parent.path,
      userId: this.actor.userId,
      canManageAccess: snapshot.root.canManageAccess,
      workspaceLevel: snapshot.root.level,
      canCreateFolder: parent.access.level >= 3 && parent.path.length < 8,
      canCreateBase: parent.access.level >= 3,
    };
  }

  async folders(workspaceId: string) {
    const snapshot = await this.catalog(workspaceId);
    return {
      userId: this.actor.userId,
      folders: snapshot.rows.flatMap((row) => {
        if (row.kind !== 'FOLDER') return [];
        const value = snapshot.resolve(row.id);
        return value ? [this.item(value)] : [];
      }),
    };
  }

  async node(nodeId: string, tx: Tx = this.db) {
    const row = await tx.driveNode.findUnique({ where: { id: nodeId }, select: { workspaceId: true } });
    if (!row) fail('COLLAB_NOT_FOUND', 404);
    const snapshot = await this.catalog(row.workspaceId, tx);
    const value = snapshot.resolve(nodeId);
    if (!value) fail('COLLAB_FORBIDDEN', 403);
    return {
      ...this.item(value),
      sources: [
        {
          id: snapshot.workspace.id,
          name: snapshot.workspace.name,
          kind: 'WORKSPACE',
          level: snapshot.root.level,
          selfOnly: snapshot.root.selfOnly,
        },
        ...value.path,
      ],
    };
  }

  private privatePolicy(ownerId: string, ownerLevel: number) {
    return json({
      restricted: true,
      grants:
        ownerLevel === 4
          ? []
          : [
              {
                principalType: 'USER',
                principalId: ownerId,
                role: 'MANAGER',
                rowScope: 'ALL',
                canCreate: true,
                hiddenFields: [],
                readonlyFields: [],
              },
            ],
    });
  }

  async createFolder(workspaceId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['name', 'parentId']);
    const name = text(input.name),
      parentId = optionalParent(input.parentId);
    this.parent(await this.catalog(workspaceId), parentId, true);
    return this.write(key, ['drive.folder.create', workspaceId, name, parentId], async (tx) => {
      await this.lock(tx, workspaceId);
      const parent = this.parent(await this.catalog(workspaceId, tx), parentId, true);
      if (parent.path.length >= 8) fail('DRIVE_DEPTH_LIMIT');
      const node = await tx.driveNode.create({
        data: {
          workspaceId,
          parentId,
          kind: 'FOLDER',
          folderName: name,
          ownerId: this.actor.userId,
          createdAt: new Date(),
          accessPolicy: parentId ? Prisma.DbNull : this.privatePolicy(this.actor.userId, parent.access.level),
        },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'drive.folder.created',
          targetType: 'DRIVE_NODE',
          targetId: node.id,
        },
      });
      return { id: node.id, version: node.version };
    });
  }

  async createDriveBase(workspaceId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['name', 'parentId']);
    const name = text(input.name),
      parentId = optionalParent(input.parentId);
    this.parent(await this.catalog(workspaceId), parentId, true);
    return this.write(key, ['drive.base.create', workspaceId, name, parentId], async (tx) => {
      await this.lock(tx, workspaceId);
      const parent = this.parent(await this.catalog(workspaceId, tx), parentId, true);
      const base = await tx.collabBase.create({
        data: {
          workspaceId,
          name,
          accessPolicy: parentId ? Prisma.DbNull : this.privatePolicy(this.actor.userId, parent.access.level),
        },
      });
      await tx.driveNode.create({
        data: {
          id: base.id,
          baseId: base.id,
          workspaceId,
          parentId,
          kind: 'BASE',
          ownerId: this.actor.userId,
          createdAt: new Date(),
        },
      });
      const table = await tx.collabTable.create({
        data: { baseId: base.id, name: '数据表', createdBy: this.actor.userId },
      });
      await tx.collabField.create({
        data: { tableId: table.id, name: '标题', type: 'TEXT', required: true },
      });
      const view = await tx.collabView.create({
        data: { tableId: table.id, name: '总表', ownerId: this.actor.userId, shared: true, isDefault: true },
      });
      await this.event(tx, base.id, 'base.created', base.id);
      return { id: base.id, baseId: base.id, tableId: table.id, viewId: view.id };
    });
  }

  async rename(nodeId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['name', 'version']);
    const name = text(input.name),
      version = integer(input.version);
    const initial = await this.node(nodeId);
    if (!initial.canRename) fail('COLLAB_FORBIDDEN', 403);
    return this.write(key, ['drive.rename', nodeId, name, version], async (tx) => {
      await this.lock(tx, initial.workspaceId);
      const current = await this.node(nodeId, tx);
      if (!current.canRename) fail('COLLAB_FORBIDDEN', 403);
      if (current.version !== version) fail('DRIVE_VERSION_CONFLICT', 409);
      if (current.kind === 'BASE') {
        await tx.collabBase.update({ where: { id: nodeId }, data: { name, version: { increment: 1 } } });
        await tx.driveNode.update({ where: { id: nodeId }, data: { updatedAt: new Date() } });
        await this.event(tx, nodeId, 'base.updated', nodeId);
      } else {
        await tx.driveNode.update({
          where: { id: nodeId },
          data: { folderName: name, version: { increment: 1 } },
        });
        await tx.operationLog.create({
          data: {
            userId: this.actor.userId,
            action: 'drive.folder.renamed',
            targetType: 'DRIVE_NODE',
            targetId: nodeId,
          },
        });
      }
      return { id: nodeId, version: version + 1 };
    });
  }

  private async managedFolder(folderId: string, tx: Tx = this.db) {
    const folder = await tx.driveNode.findUnique({ where: { id: folderId } });
    if (!folder || folder.kind !== 'FOLDER') fail('COLLAB_NOT_FOUND', 404);
    await this.requireAccessAdmin(folder.workspaceId, tx);
    return folder;
  }

  async folderAccess(folderId: string) {
    const folder = await this.managedFolder(folderId);
    return {
      version: folder.version,
      policy: resourcePolicy(folder.accessPolicy),
      members: await this.resourceMembers(folder.workspaceId, [folder.ownerId]),
    };
  }

  async saveFolderAccess(folderId: string, raw: unknown, key: unknown) {
    const input = accessInput(raw);
    if (input.policy.grants.some((grant) => grant.hiddenFields.length || grant.readonlyFields.length))
      fail('COLLAB_INVALID_ACCESS');
    const initial = await this.managedFolder(folderId);
    return this.write(key, ['drive.folder.access', folderId, input], async (tx) => {
      await this.lock(tx, initial.workspaceId);
      const folder = await this.managedFolder(folderId, tx);
      if (folder.version !== input.version) fail('COLLAB_ACCESS_CONFLICT', 409);
      const members = await this.resourceMembers(folder.workspaceId, [folder.ownerId], tx);
      if (
        input.policy.grants.some(
          (g) =>
            !members.some(
              (m) =>
                m.principalType === g.principalType && m.principalId === g.principalId && m.role !== 'OWNER',
            ),
        )
      )
        fail('COLLAB_MEMBER_UNAVAILABLE');
      await tx.driveNode.update({
        where: { id: folderId },
        data: {
          version: { increment: 1 },
          accessPolicy:
            input.policy.restricted || input.policy.grants.length ? json(input.policy) : Prisma.DbNull,
        },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'drive.folder.access',
          targetType: 'DRIVE_NODE',
          targetId: folderId,
        },
      });
      return { id: folderId, version: input.version + 1 };
    });
  }
}
