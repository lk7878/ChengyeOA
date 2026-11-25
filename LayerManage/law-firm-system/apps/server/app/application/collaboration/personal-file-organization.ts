import { PersonalFile, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, statfs, unlink } from 'node:fs/promises';
import path from 'node:path';
import { PersonalFiles } from './personal-files';
import { personalFileResolver } from './personal-file-access';
import { resourcePolicy } from './resource-access';
import { exact, fail, integer, text } from './collaboration-policy';

const root = () => path.resolve(process.env.PERSONAL_FILES_STORAGE_ROOT || path.join(process.cwd(), 'var/storage/personal-files'));
const grant = (id: string) => ({ principalType: 'USER', principalId: id, role: 'MANAGER', rowScope: 'ALL', canCreate: true, hiddenFields: [] as string[], readonlyFields: [] as string[] });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function descendants(rows: PersonalFile[], ids: string[]) {
  const selected = new Set(ids);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (row.parentId && selected.has(row.parentId) && !selected.has(row.id)) { selected.add(row.id); changed = true; } }
  return rows.filter(row => selected.has(row.id));
}
function ancestors(rows: PersonalFile[], id: string | null) {
  const result: PersonalFile[] = [], seen = new Set<string>();
  while (id) {
    const row = rows.find(r => r.id === id);
    if (!row || seen.has(id) || result.length >= 12 || row.deletedAt) fail('PERSONAL_ORGANIZE_INVALID_TARGET');
    seen.add(id); result.push(row); id = row.parentId;
  }
  return result;
}

export class PersonalFileOrganization extends PersonalFiles {
  async organizationFolders() {
    const rows = await this.db.personalFile.findMany({ where: { deletedAt: null } });
    const resolve = personalFileResolver(rows, await this.principals(this.db));
    // Do not disclose other owners' folders, even to a shared manager or superadmin.
    return { items: rows.filter(r => r.kind === 'FOLDER' && r.ownerId === this.actor.userId && resolve(r.id))
      .filter(r => ancestors(rows, r.parentId).every(p => p.ownerId === this.actor.userId))
      .map(r => ({ id: r.id, parentId: r.parentId, name: r.name })) };
  }

  private async organizationPlan(tx: Prisma.TransactionClient, raw: unknown) {
    const v = exact(raw, ['operation', 'files', 'targetId', 'collision', 'token']);
    const operation = v.operation === 'move' ? 'move' : v.operation === 'copy' ? 'copy' : fail('COLLAB_INVALID_VALUE');
    const collision = v.collision === 'rename' ? 'rename' : v.collision === 'skip' ? 'skip' : fail('COLLAB_INVALID_VALUE');
    if (!Array.isArray(v.files) || !v.files.length || v.files.length > 1000) fail('COLLAB_INVALID_VALUE');
    const requested = v.files.map(f => { const i = exact(f, ['id', 'version']); return { id: text(i.id), version: integer(i.version) }; });
    const targetId = v.targetId ? text(v.targetId) : null;
    const rows = await tx.personalFile.findMany({ orderBy: { id: 'asc' } });
    const live = rows.filter(r => !r.deletedAt), resolve = personalFileResolver(live, await this.principals(tx));
    for (const item of requested) {
      const row = resolve(item.id)?.row;
      if (!row || row.ownerId !== this.actor.userId) fail('PERSONAL_ORGANIZE_OWNER_ONLY', 403);
      if (row.version !== item.version) fail('PERSONAL_ORGANIZE_CHANGED', 409);
    }
    const targets = ancestors(rows, targetId);
    if (targets.some(r => r.kind !== 'FOLDER' || r.ownerId !== this.actor.userId) || (targetId && !resolve(targetId))) fail('PERSONAL_ORGANIZE_OWNER_ONLY', 403);
    // Selecting a parent and child together processes the child exactly once.
    const ids = new Set(requested.map(r => r.id));
    const sources = live.filter(r => ids.has(r.id) && !ancestors(rows, r.parentId).some(p => ids.has(p.id)));
    if (targetId && descendants(rows, sources.map(r => r.id)).some(r => r.id === targetId)) fail('PERSONAL_ORGANIZE_INVALID_TARGET');
    const entries: { source: PersonalFile; name: string; skipped: boolean }[] = [];
    const names = new Set(live.filter(r => r.parentId === targetId).map(r => r.name));
    for (const source of sources) {
      let name = source.name, skipped = operation === 'move' && source.parentId === targetId;
      if (!skipped && names.has(name)) {
        if (collision === 'skip') skipped = true;
        else {
          const ext = source.kind === 'FILE' ? path.extname(name).slice(0, 30) : '', stem = ext ? name.slice(0, -ext.length) : name;
          let n = 1;
          do { const suffix = `（副本${n++}）`; name = stem.slice(0, 150 - ext.length - suffix.length) + suffix + ext; } while (names.has(name));
        }
      }
      if (!skipped) names.add(name);
      entries.push({ source, name, skipped });
    }
    const active = entries.filter(e => !e.skipped);
    const allAffected = descendants(rows, active.map(e => e.source.id));
    if (allAffected.some(r => r.ownerId !== this.actor.userId)) fail('PERSONAL_ORGANIZE_MIXED_OWNER', 403);
    const affected = allAffected.filter(r => !r.deletedAt && resolve(r.id));
    if (allAffected.filter(r => !r.deletedAt).length !== affected.length) fail('PERSONAL_ORGANIZE_INVALID_TARGET');
    const size = affected.reduce((sum, r) => sum + (r.kind === 'FILE' ? r.size : 0), 0);
    if (affected.length > 1000 || (operation === 'copy' && size > 2 * 1024 ** 3)) fail('PERSONAL_ORGANIZE_LIMIT');
    const sourceIds = new Set(active.map(e => e.source.id));
    const projected = affected.map(row => {
      const entry = active.find(e => e.source.id === row.id), policy = resourcePolicy(row.accessPolicy);
      if (operation === 'copy') return { ...row, id: 'copy:' + row.id, name: entry?.name ?? row.name,
        parentId: entry ? targetId : 'copy:' + row.parentId,
        accessPolicy: { restricted: entry ? !targetId : policy.restricted, grants: [grant(this.actor.userId)] } as unknown as Prisma.JsonValue };
      // Preserve denials from old ancestors: moving must not revive an exited share.
      const denies = entry ? ancestors(rows, row.parentId).flatMap(p => resourcePolicy(p.accessPolicy).grants.filter(g => g.role === 'DENY')) : [];
      const grants = [...new Map([...policy.grants, ...denies].map(g => [g.principalType + ':' + g.principalId, g])).values()];
      return { ...row, name: entry?.name ?? row.name, parentId: entry ? targetId : row.parentId,
        accessPolicy: { ...policy, restricted: entry && !targetId ? true : policy.restricted, grants } as unknown as Prisma.JsonValue };
    });
    const after = operation === 'copy' ? [...live, ...projected] : live.map(r => projected.find(p => p.id === r.id) ?? r);
    for (const row of projected) if (ancestors(after, row.id).length > 12) fail('PERSONAL_ORGANIZE_INVALID_TARGET');
    if (operation === 'move') {
      // Previously trashed descendants must still be restorable within the depth limit.
      const structural = new Map(rows.map(r => [r.id, projected.find(p => p.id === r.id) ?? r]));
      for (const row of allAffected) {
        let current: PersonalFile | undefined = structural.get(row.id), depth = 0;
        while (current) { if (++depth > 12) fail('PERSONAL_ORGANIZE_INVALID_TARGET'); current = current.parentId ? structural.get(current.parentId) : undefined; }
      }
    }
    const changes: { name: string; gained: number; lost: number; changed: number }[] = [];
    const users = await tx.user.findMany({ where: { status: 'ENABLED', id: { not: this.actor.userId } }, select: { id: true, username: true, employeeId: true, employee: { select: { name: true } } }, orderBy: { id: 'asc' } });
    for (const user of users) {
      const principal = await new PersonalFileOrganization(this.db, { ...this.actor, userId: user.id, employeeId: user.employeeId, previewRoleId: undefined }).principals(tx);
      const beforeAccess = personalFileResolver(live, principal), afterAccess = personalFileResolver(after, principal);
      let gained = 0, lost = 0, changed = 0;
      for (const item of affected) {
        const beforeLevel = operation === 'copy' ? 0 : beforeAccess(item.id)?.access.level ?? 0;
        const afterLevel = afterAccess(operation === 'copy' ? 'copy:' + item.id : item.id)?.access.level ?? 0;
        if (!beforeLevel && afterLevel) gained++; else if (beforeLevel && !afterLevel) lost++; else if (beforeLevel !== afterLevel) changed++;
      }
      if (gained || lost || changed) changes.push({ name: `${user.employee?.name || user.username}（${user.username}）`, gained, lost, changed });
    }
    const summary = { entries: entries.map(e => ({ id: e.source.id, from: e.source.name, to: e.name, skipped: e.skipped })), count: affected.length, size, changes };
    // Bind confirmation to content, sharing and directory state, not just top-level versions.
    const relevant = new Set([
      ...descendants(rows, sources.map(r => r.id)).map(r => r.id),
      ...sources.flatMap(r => ancestors(rows, r.parentId).map(p => p.id)),
      ...targets.map(r => r.id), ...live.filter(r => r.parentId === targetId).map(r => r.id),
    ]);
    const token = digest({ actor: this.actor.userId, operation, collision, targetId, requested, rows: rows.filter(r => relevant.has(r.id)), summary });
    return { operation, targetId, affected, projected, sourceIds, summary, token, suppliedToken: v.token };
  }

  async previewOrganization(raw: unknown) {
    return this.db.$transaction(async tx => { const plan = await this.organizationPlan(tx, raw); return { ...plan.summary, token: plan.token }; }, { timeout: 120000 });
  }

  async organize(raw: unknown) {
    const createdKeys: string[] = [];
    try {
      return await this.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('personal-files',0))`;
        const plan = await this.organizationPlan(tx, raw);
        if (plan.suppliedToken !== plan.token) fail('PERSONAL_ORGANIZE_CHANGED', 409);
        const results: string[] = [];
        if (plan.operation === 'move') {
          for (const row of plan.projected) if (plan.sourceIds.has(row.id)) {
            await tx.personalFile.update({ where: { id: row.id }, data: { parentId: row.parentId, name: row.name, accessPolicy: row.accessPolicy as Prisma.InputJsonValue, version: { increment: 1 } } });
            results.push(row.id);
          }
        } else {
          await mkdir(root(), { recursive: true });
          const space = await statfs(root());
          if (plan.summary.size > space.bavail * space.bsize) fail('PERSONAL_STORAGE_FULL', 507);
          const ids = new Map(plan.affected.map(r => [r.id, randomUUID()]));
          // Parents must be created before their children (foreign keys).
          const depth = (row: PersonalFile): number => row.parentId && ids.has(row.parentId) ? 1 + depth(plan.affected.find(p => p.id === row.parentId)!) : 0;
          const ordered = [...plan.affected].sort((a, b) => depth(a) - depth(b));
          for (const row of ordered) {
            const projected = plan.projected.find(p => p.id === 'copy:' + row.id)!;
            let storageKey: string | null = null;
            if (row.kind === 'FILE') {
              if (!row.storageKey || !/^[a-f0-9-]{36}$/i.test(row.storageKey)) fail('COLLAB_INVALID_FILE');
              storageKey = randomUUID(); createdKeys.push(storageKey);
              await copyFile(path.join(root(), row.storageKey), path.join(root(), storageKey), constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
              await this.snapshotVersion(row.id, tx);
            }
            const id = ids.get(row.id)!;
            await tx.personalFile.create({ data: { id, ownerId: this.actor.userId, name: projected.name, kind: row.kind,
              parentId: plan.sourceIds.has(row.id) ? plan.targetId : ids.get(row.parentId!)!, storageKey, size: row.size,
              accessPolicy: projected.accessPolicy as Prisma.InputJsonValue } });
            if (storageKey) {
              const version = await tx.personalFileVersion.findUniqueOrThrow({ where: { fileId_version: { fileId: row.id, version: row.contentVersion } } });
              await tx.personalFileVersion.create({ data: { fileId: id, version: 1, name: projected.name, storageKey, size: row.size, sha256: version.sha256, source: 'copy' } });
            }
            if (plan.sourceIds.has(row.id)) results.push(id);
          }
        }
        await tx.operationLog.create({ data: { userId: this.actor.userId, action: 'PERSONAL_FILE_' + plan.operation.toUpperCase(), targetType: 'PERSONAL_FILE', targetId: plan.targetId || this.actor.userId, newValues: JSON.stringify({ targetId: plan.targetId, entries: plan.summary.entries, results }) } });
        return { ids: results, count: plan.summary.count, skipped: plan.summary.entries.filter(e => e.skipped).length };
      }, { timeout: 120000 });
    } catch (error) { await Promise.all(createdKeys.map(key => unlink(path.join(root(), key)).catch(() => {}))); throw error; }
  }
}
