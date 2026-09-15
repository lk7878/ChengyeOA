import { createHash } from 'node:crypto';
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
  baseAccessVersion: number | null;
  basePolicy: Prisma.JsonValue;
  activityAt: Date | null;
  ownerName: string;
};
type Location = { id: string; name: string; kind: string; level: number; selfOnly: boolean };
type Resolved = { row: CatalogRow; access: Access; path: Location[] };

export class DriveService extends CollaborationService {
  private async catalog(workspaceId: string, tx: Tx = this.db, includeDeleted = false) {
    const root = await this.access(workspaceId, tx);
    const principals = await this.principals(tx);
    const workspace = await tx.collabWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const rows = await tx.$queryRaw<CatalogRow[]>(Prisma.sql`
      SELECT n.*, b.name AS "baseName", b.version AS "baseVersion", b."accessVersion" AS "baseAccessVersion", b."accessPolicy" AS "basePolicy",
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
      if (row?.deletedAt && !includeDeleted) return null;
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
    return { root, workspace, rows, resolve, principals };
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
      deletedAt: row.deletedAt,
      canMove: !row.deletedAt && access.level >= 3 && access.canManageAccess,
      canTrash: !row.deletedAt && access.level >= 3 && access.canManageAccess,
      canRestore: !!row.deletedAt && access.level >= 3 && access.canManageAccess,
      canRename: !row.deletedAt && access.level >= 3,
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
    const scope = choice(input.scope ?? 'all', ['all', 'mine', 'shared', 'trash']);
    if (parentId && scope !== 'all') fail('COLLAB_INVALID_FILTER');
    const search = input.q ? text(input.q).toLocaleLowerCase() : '';
    const sort = choice(input.sort ?? 'updatedAt', ['name', 'updatedAt']);
    const direction = choice(input.direction ?? (sort === 'name' ? 'asc' : 'desc'), ['asc', 'desc']);
    const page = integer(Number(input.page ?? 1), 1, 100000);
    const pageSize = integer(Number(input.pageSize ?? 50), 1, 100);
    const snapshot = await this.catalog(workspaceId, this.db, scope === 'trash');
    if (scope === 'trash' && !snapshot.root.canManageAccess) fail('COLLAB_FORBIDDEN', 403);
    const parent = this.parent(snapshot, parentId);
    const items = snapshot.rows.flatMap((row) => {
      const visible = snapshot.resolve(row.id);
      if (!visible) return [];
      if (
        scope === 'trash' &&
        (!row.deletedAt ||
          visible.access.level < 3 ||
          visible.path.slice(0, -1).some((p) => snapshot.rows.find((n) => n.id === p.id)?.deletedAt))
      )
        return [];
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
      canCreateFolder: scope !== 'trash' && parent.access.level >= 3 && parent.path.length < 8,
      canCreateBase: scope !== 'trash' && parent.access.level >= 3,
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

  private lifecycleInput(raw: unknown, commit = false) {
    const input = exact(raw, ['action', 'parentId', 'name', ...(commit ? ['previewToken'] : [])]);
    const action = choice(input.action, ['MOVE', 'TRASH', 'RESTORE']);
    if (commit && (typeof input.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewToken)))
      fail('DRIVE_PREVIEW_STALE', 409);
    if (action === 'MOVE' && input.parentId === undefined) fail('DRIVE_TARGET_REQUIRED');
    if (action !== 'MOVE' && input.parentId !== undefined) fail('COLLAB_INVALID_FILTER');
    if (action !== 'RESTORE' && input.name !== undefined) fail('COLLAB_INVALID_FILTER');
    return {
      action,
      ...(action === 'MOVE' ? { parentId: optionalParent(input.parentId) } : {}),
      ...(input.name !== undefined ? { name: text(input.name) } : {}),
      ...(commit ? { previewToken: text(input.previewToken) } : {}),
    };
  }

  private async lifecycleSource(nodeId: string, tx: Tx = this.db) {
    const node = await tx.driveNode.findUnique({ where: { id: nodeId }, select: { workspaceId: true } });
    if (!node) fail('COLLAB_NOT_FOUND', 404);
    const snapshot = await this.catalog(node.workspaceId, tx, true);
    const source = snapshot.resolve(nodeId);
    if (!snapshot.root.canManageAccess || !source || source.access.level < 3) fail('COLLAB_FORBIDDEN', 403);
    return { snapshot, source };
  }

  private async lifecyclePlan(nodeId: string, input: ReturnType<DriveService['lifecycleInput']>, tx: Tx) {
    const { snapshot, source } = await this.lifecycleSource(nodeId, tx);
    const { action } = input;
    if ((action === 'RESTORE') !== !!source.row.deletedAt) fail('DRIVE_STATE_CONFLICT', 409);
    const byId = new Map(snapshot.rows.map((row) => [row.id, row]));
    if (source.path.slice(0, -1).some((part) => byId.get(part.id)?.deletedAt))
      fail('DRIVE_PARENT_UNAVAILABLE', 409);
    const subtree = new Set([nodeId]);
    let size = 0;
    while (size !== subtree.size) {
      size = subtree.size;
      for (const row of snapshot.rows) if (row.parentId && subtree.has(row.parentId)) subtree.add(row.id);
      if (subtree.size > 500) fail('DRIVE_SUBTREE_LIMIT');
    }
    const rows = snapshot.rows.filter((row) => subtree.has(row.id));
    if (rows.some((row) => (snapshot.resolve(row.id)?.access.level ?? 0) < 3)) fail('COLLAB_FORBIDDEN', 403);
    const parentId = action === 'MOVE' ? input.parentId! : source.row.parentId;
    if (action === 'MOVE' && parentId === source.row.parentId) fail('DRIVE_SAME_PARENT');
    if (parentId && subtree.has(parentId)) fail('DRIVE_CYCLE');
    const parent = this.parent(snapshot, parentId, true);
    if (parent.path.some((part) => byId.get(part.id)?.deletedAt)) fail('DRIVE_PARENT_UNAVAILABLE', 409);
    for (const row of rows) {
      const path = snapshot.resolve(row.id)!.path;
      const depth =
        parent.path.length + path.filter((part) => part.kind === 'FOLDER').length - (source.path.length - 1);
      if (depth > 8) fail('DRIVE_DEPTH_LIMIT');
    }
    const name = input.name ?? source.path.at(-1)!.name;
    if (
      action !== 'TRASH' &&
      snapshot.rows.some(
        (row) =>
          row.id !== nodeId &&
          (source.row.kind === 'FOLDER'
            ? row.kind === 'FOLDER' && !row.deletedAt && row.parentId === parentId && row.folderName === name
            : row.kind === 'BASE' && row.baseName === name),
      )
    )
      fail('COLLAB_NAME_OR_ID_CONFLICT', 409);
    const sourcePolicy = source.row.kind === 'BASE' ? source.row.basePolicy : source.row.accessPolicy;
    const after =
      action === 'TRASH' ? null : restrictResourceAccess(parent.access, sourcePolicy, snapshot.principals);
    const tables = await tx.collabTable.findMany({
      where: { base: { workspaceId: source.row.workspaceId } },
      select: { id: true, baseId: true, accessVersion: true, accessPolicy: true, archived: true },
      orderBy: { id: 'asc' },
    });
    // Metadata/ACL fingerprint only: record edits do not invalidate a reviewed directory operation.
    const previewToken = createHash('sha256')
      .update(
        JSON.stringify({
          actor: this.actor.userId,
          nodeId,
          action,
          parentId,
          name,
          principals: snapshot.principals.map((p) => p.principalType + ':' + p.principalId).sort(),
          workspaceVersion: snapshot.workspace.version,
          rows: [...snapshot.rows]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((row) => [
              row.id,
              row.parentId,
              row.kind,
              row.ownerId,
              row.version,
              row.deletedAt,
              row.folderName,
              row.accessPolicy,
              row.baseName,
              row.baseVersion,
              row.baseAccessVersion,
              row.basePolicy,
            ]),
          tables,
        }),
      )
      .digest('hex');
    const describe = (path: Location[]) =>
      path.map((part) => {
        const row = byId.get(part.id)!;
        return {
          id: part.id,
          name: part.name,
          kind: part.kind,
          policy: resourcePolicy(row.kind === 'BASE' ? row.basePolicy : row.accessPolicy),
        };
      });
    const summarize = (access: Access | null) =>
      access
        ? {
            level: access.level,
            selfOnly: access.selfOnly,
            canCreate: access.canCreate,
            hiddenFieldCount: access.hidden.length,
            readonlyFieldCount: access.readonly.length,
          }
        : null;
    return {
      snapshot,
      source,
      rows,
      parentId,
      name,
      public: {
        action,
        previewToken,
        name,
        fromPath: source.path,
        toPath: action === 'TRASH' ? [] : [...parent.path, { ...source.path.at(-1)!, name }],
        beforeRules: describe(source.path),
        afterRules:
          action === 'TRASH'
            ? []
            : [
                ...describe(parent.path),
                { id: nodeId, name, kind: source.row.kind, policy: resourcePolicy(sourcePolicy) },
              ],
        beforeAccess: summarize(action === 'RESTORE' ? null : source.access),
        afterAccess: summarize(after),
        affected: {
          folders: rows.filter((row) => row.kind === 'FOLDER').length,
          bases: rows.filter((row) => row.kind === 'BASE').length,
          independentlyTrashed: rows.filter((row) => row.id !== nodeId && row.deletedAt).length,
        },
        workspace: { id: snapshot.workspace.id, name: snapshot.workspace.name },
      },
    };
  }

  async previewLifecycle(nodeId: string, raw: unknown) {
    const input = this.lifecycleInput(raw);
    const initial = await this.lifecycleSource(nodeId);
    return this.db.$transaction(
      async (tx) => {
        await this.lock(tx, initial.source.row.workspaceId, true);
        return (await this.lifecyclePlan(nodeId, input, tx)).public;
      },
      { timeout: 15000 },
    );
  }

  async applyLifecycle(nodeId: string, raw: unknown, key: unknown) {
    const input = this.lifecycleInput(raw, true);
    const initial = await this.lifecycleSource(nodeId);
    return this.write(key, ['drive.lifecycle', nodeId, input], async (tx) => {
      await this.lock(tx, initial.source.row.workspaceId);
      const plan = await this.lifecyclePlan(nodeId, input, tx);
      if (plan.public.previewToken !== input.previewToken) fail('DRIVE_PREVIEW_STALE', 409);
      const { action } = input;
      await tx.driveNode.update({
        where: { id: nodeId },
        data: {
          parentId: plan.parentId,
          version: { increment: 1 },
          ...(action === 'TRASH' ? { deletedAt: new Date(), deletedBy: this.actor.userId } : {}),
          ...(action === 'RESTORE'
            ? {
                deletedAt: null,
                deletedBy: null,
                ...(plan.source.row.kind === 'FOLDER' ? { folderName: plan.name } : {}),
              }
            : {}),
        },
      });
      if (plan.source.row.kind === 'BASE')
        await tx.collabBase.update({
          where: { id: nodeId },
          data: {
            version: { increment: 1 },
            ...(action === 'RESTORE' ? { name: plan.name } : {}),
          },
        });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'drive.' + action.toLowerCase(),
          targetType: 'DRIVE_NODE',
          targetId: nodeId,
        },
      });
      for (const row of plan.rows)
        if (row.kind === 'BASE') await this.event(tx, row.id, 'access.updated', row.id);
      return { id: nodeId, action };
    });
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
    await this.assertActiveNode(folderId, tx);
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
