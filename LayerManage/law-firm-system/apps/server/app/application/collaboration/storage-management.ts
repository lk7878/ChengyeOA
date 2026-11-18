import type { PrismaClient } from '@prisma/client';
import { lstat, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';
import type { AuthorizationContext } from '../authorization/authorization-service';
import { CollaborationService } from './collaboration-service';
import { choice, exact, fail, integer, text } from './collaboration-policy';

export type StorageRow = {
  id: string; fileId: string; version: number; name: string; kind: 'PERSONAL' | 'ATTACHMENT';
  ownerId: string; ownerName: string; department: string; workspaceId: string | null; workspaceName: string;
  location: string; size: number; current: boolean; trash: boolean; sha256: string; updatedAt: string;
  source: string; referenceCount: number; candidates: string[]; versionCount: number;
};
type BlobRow = StorageRow & { storageKey: string; root: string };
const personalRoot = () => path.resolve(process.env.PERSONAL_FILES_STORAGE_ROOT || 'var/storage/personal-files');
const attachmentRoot = () => path.resolve('var/storage/collaboration');
const sum = (rows: StorageRow[]) => rows.reduce((n, r) => n + r.size, 0);

// Content equality is not physical deduplication: distinct storage keys still consume disk space.
export function duplicateGroups(rows: StorageRow[]) {
  const groups = new Map<string, StorageRow[]>();
  for (const row of rows) if (/^[a-f0-9]{64}$/i.test(row.sha256)) {
    const key = `${row.sha256.toLowerCase()}:${row.size}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.values()].filter(group => group.length > 1).map(group => ({
    sha256: group[0].sha256, size: group[0].size, copies: group.length,
    // This is a logical upper bound, never a promise that deleting a referenced blob is safe.
    potentialLogicalBytes: (group.length - 1) * group[0].size, ids: group.map(r => r.id),
  }));
}
export function storageBreakdown(rows: StorageRow[], key: 'ownerName' | 'department' | 'workspaceName') {
  const groups = new Map<string, { name: string; versions: number; bytes: number }>();
  for (const row of rows) {
    const name = row[key];
    const id = key === 'ownerName' ? row.ownerId : key === 'workspaceName' ? row.workspaceId || name : name;
    const g = groups.get(id) || { name, versions: 0, bytes: 0 };
    g.versions++; g.bytes += row.size; groups.set(id, g);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
}

export async function measureBlobs(rows: Pick<BlobRow, 'root' | 'storageKey'>[]) {
  let bytes = 0, allocatedBytes = 0, unavailable = 0;
  const keys = new Set<string>(), inodes = new Set<string>();
  for (const row of rows) {
    if (!row.storageKey) { unavailable++; continue; }
    const root = path.resolve(row.root), file = path.resolve(root, row.storageKey);
    if (keys.has(file)) continue;
    keys.add(file);
    if (!file.startsWith(root + path.sep)) { unavailable++; continue; }
    try {
      const [canonicalRoot, canonicalFile, stat] = await Promise.all([realpath(root), realpath(file), lstat(file)]);
      if (!canonicalFile.startsWith(canonicalRoot + path.sep) || stat.isSymbolicLink() || !stat.isFile()) { unavailable++; continue; }
      const inode = `${stat.dev}:${stat.ino}`;
      if (inodes.has(inode)) continue;
      inodes.add(inode); bytes += stat.size; allocatedBytes += stat.blocks * 512;
    } catch { unavailable++; }
  }
  return { bytes, allocatedBytes, unavailable, objects: inodes.size };
}

export class StorageManagement {
  constructor(private db: PrismaClient, private actor: AuthorizationContext) {}
  async report(raw: unknown) {
    const input = exact(raw, ['audience', 'workspace', 'q', 'ownerId', 'department', 'candidate', 'sort', 'page', 'pageSize']);
    const audience = choice(input.audience ?? 'mine', ['mine', 'organization']);
    if (audience === 'organization' && (!this.actor.isSystemSuperAdmin || this.actor.previewRoleId)) fail('COLLAB_FORBIDDEN', 403);
    const workspace = input.workspace ? text(input.workspace) : '__all__';
    const q = input.q ? text(input.q, 150).toLocaleLowerCase() : '';
    const ownerId = input.ownerId ? text(input.ownerId) : '';
    const department = input.department ? text(input.department) : '';
    const candidate = choice(input.candidate ?? 'all', ['all', 'duplicate', 'history', 'trash', 'large', 'old']);
    const sort = choice(input.sort ?? 'size', ['size', 'name', 'updatedAt']);
    const page = integer(Number(input.page ?? 1), 1, 100000), pageSize = integer(Number(input.pageSize ?? 25), 1, 100);
    const all = audience === 'organization';
    const workspaces = all ? await this.db.collabWorkspace.findMany({ select: { id: true, name: true } }) :
      (await new CollaborationService(this.db, this.actor).listWorkspaces()).workspaces.map(w => ({ id: w.id, name: w.name }));
    if (!['__all__', '__unassigned__'].includes(workspace) && !workspaces.some(w => w.id === workspace)) fail('COLLAB_FORBIDDEN', 403);
    if (all) await this.db.operationLog.create({ data: { userId: this.actor.userId, action: 'STORAGE_AUDIT', targetType: 'STORAGE', targetId: workspace } });
    const files = await this.db.personalFile.findMany({ where: { ...(all ? {} : { ownerId: this.actor.userId }) } });
    const versions = files.length ? await this.db.personalFileVersion.findMany({ where: { fileId: { in: files.map(f => f.id) } } }) : [];
    const attachments = await this.db.collabAttachment.findMany({ where: all ? {} : { ownerId: this.actor.userId } });
    const tables = attachments.length ? await this.db.collabTable.findMany({ where: { id: { in: attachments.map(a => a.tableId) } }, select: { id: true, name: true, base: { select: { name: true, workspaceId: true } } } }) : [];
    const users = await this.db.user.findMany({ where: { id: { in: [...new Set([...files, ...attachments].map(f => f.ownerId))] } }, select: { id: true, username: true, employee: { select: { name: true, assignments: { where: { endedAt: null, startedAt: { lte: new Date() } }, select: { organization: { select: { name: true } } } } } } } });
    const archives = files.length ? await this.db.smartCaseArchive.findMany({ where: { fileId: { in: files.map(f => f.id) } }, select: { fileId: true, fileVersion: true } }) : [];
    const owner = new Map(users.map(u => [u.id, { ownerName: u.employee?.name ? `${u.employee.name}（${u.username}）` : u.username, department: [...new Set(u.employee?.assignments.map(a => a.organization.name) || [])].join(' / ') || '未绑定部门' }]));
    const workspaceNames = new Map(workspaces.map(w => [w.id, w.name]));
    const tableById = new Map(tables.map(t => [t.id, t]));
    const fileById = new Map(files.map(f => [f.id, f]));
    const rows: BlobRow[] = [];
    for (const file of files.filter(f => f.kind === 'FILE')) {
      let history = versions.filter(v => v.fileId === file.id);
      if (!history.some(v => v.version === file.contentVersion)) history = [...history, { id: file.id, fileId: file.id, version: file.contentVersion, name: file.name, storageKey: file.storageKey || '', size: file.size, sha256: '', source: 'legacy', lineage: [], parseStatus: 'PENDING', createdAt: file.updatedAt }];
      const segments = [file.name], seen = new Set([file.id]);
      let parent = file.parentId ? fileById.get(file.parentId) : undefined;
      while (parent && !seen.has(parent.id)) { seen.add(parent.id); segments.unshift(parent.name); parent = parent.parentId ? fileById.get(parent.parentId) : undefined; }
      for (const version of history) rows.push({ id: `personal:${file.id}:${version.version}`, fileId: file.id, version: version.version,
        name: version.name, kind: 'PERSONAL', ownerId: file.ownerId, ...(owner.get(file.ownerId) || { ownerName: file.ownerId, department: '未绑定部门' }),
        workspaceId: null, workspaceName: '未归属工作区（个人文件）', location: segments.join(' / '), size: version.size,
        current: version.version === file.contentVersion, trash: Boolean(file.deletedAt), sha256: version.sha256,
        updatedAt: version.createdAt.toISOString(), source: version.source, versionCount: history.length,
        referenceCount: archives.filter(a => a.fileId === file.id && a.fileVersion === version.version).length,
        candidates: [], storageKey: version.storageKey, root: personalRoot() });
    }
    for (const attachment of attachments) {
      const table = tableById.get(attachment.tableId), wid = table?.base.workspaceId || null;
      // An ordinary user only sees their own uploads in workspaces they can still access.
      if (!all && (!wid || !workspaceNames.has(wid))) continue;
      rows.push({ id: `attachment:${attachment.id}`, fileId: attachment.id, version: 1, name: attachment.name, kind: 'ATTACHMENT',
        ownerId: attachment.ownerId, ...(owner.get(attachment.ownerId) || { ownerName: attachment.ownerId, department: '未绑定部门' }),
        workspaceId: wid, workspaceName: wid ? workspaceNames.get(wid) || '已移除工作区' : '未归属工作区（历史附件）',
        location: table ? `${table.base.name} / ${table.name}` : '历史附件', size: attachment.size,
        current: true, trash: false, sha256: '', updatedAt: attachment.createdAt.toISOString(), source: 'attachment',
        versionCount: 1, referenceCount: 0, candidates: [], storageKey: attachment.storageKey, root: attachmentRoot() });
    }
    const scoped = rows.filter(r => workspace === '__all__' || (workspace === '__unassigned__' ? !r.workspaceId : r.workspaceId === workspace));
    const duplicates = duplicateGroups(scoped), duplicateIds = new Set(duplicates.flatMap(g => g.ids));
    for (const row of scoped) {
      row.candidates = [duplicateIds.has(row.id) && 'duplicate', !row.current && 'history', row.trash && 'trash',
        row.size >= 100 * 1024 * 1024 && 'large', Date.now() - new Date(row.updatedAt).getTime() > 180 * 86400000 && 'old'].filter(Boolean) as string[];
    }
    const filtered = scoped.filter(r => (!q || `${r.name} ${r.location}`.toLocaleLowerCase().includes(q)) && (!ownerId || r.ownerId === ownerId) && (!department || r.department === department) && (candidate === 'all' || r.candidates.includes(candidate)));
    filtered.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : sort === 'size' ? b.size - a.size : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
    const measured = await measureBlobs(scoped);
    let disk: { total: number; used: number; available: number } | null = null;
    if (all) try { const fs = await statfs(personalRoot()); disk = { total: fs.blocks * fs.bsize, used: (fs.blocks - fs.bfree) * fs.bsize, available: fs.bavail * fs.bsize }; } catch { /* Display unavailable instead of zero. */ }
    return { audience, workspace, workspaces, disk, measured, computedAt: new Date().toISOString(),
      totals: { files: new Set(scoped.map(r => `${r.kind}:${r.fileId}`)).size, versions: scoped.length, logicalBytes: sum(scoped),
        currentBytes: sum(scoped.filter(r => r.current && !r.trash)), historyBytes: sum(scoped.filter(r => !r.current && !r.trash)),
        trashBytes: sum(scoped.filter(r => r.trash)), aiBytes: sum(scoped.filter(r => /harness|smart|ai/i.test(r.source))),
        duplicateGroups: duplicates.length, potentialDuplicateBytes: duplicates.reduce((n, g) => n + g.potentialLogicalBytes, 0) },
      breakdown: { members: storageBreakdown(scoped, 'ownerName'), departments: storageBreakdown(scoped, 'department'), workspaces: storageBreakdown(scoped, 'workspaceName') },
      owners: [...new Map(scoped.map(r => [r.ownerId, { id: r.ownerId, name: r.ownerName }])).values()],
      departments: [...new Set(scoped.map(r => r.department))], total: filtered.length, page, pageSize,
      items: filtered.slice((page - 1) * pageSize, page * pageSize).map(({ storageKey, root, ...row }) => { void storageKey; void root; return row; }),
      coverage: '统计个人文件（含历史版本和回收站）及多维表格附件。快捷方式不重复计入。知识库独立副本、未同步 AI 工作目录、其他业务附件、数据库、备份和未完成上传未纳入文件明细；其占用可能体现在磁盘已用容量中。',
      referenceNotice: '已识别的引用仅包含正式归档记录，不代表完整引用检查。重复和长期未更新不等于无用；清理请进入原文件管理，先核对任务、知识库和业务引用。此入口不会自动删除文件。' };
  }
}
