import { PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { CollaborationService } from './collaboration-service';
import { choice, exact, fail, integer, text } from './collaboration-policy';
import { WorksheetPermissions } from './worksheet-permissions';
import { worksheetContext } from './worksheet-business-grants';

type Subject = { id: string; target: 'MEMBER' | 'ROLE'; label: string };
export type PermissionOverviewRow = {
  tableId: string; tableName: string; subject: Subject; level: number;
  limitedRows: boolean; limitedFields: boolean; limitedViews: boolean;
};

/** Read-only discovery using the same effective access checks as table preview. */
export class PermissionOverview {
  constructor(private readonly db: PrismaClient, private readonly actor: AuthorizationContext) {}

  private requireAdmin() {
    if (!this.actor.isSystemSuperAdmin) fail('COLLAB_FORBIDDEN', 403);
  }

  async options() {
    this.requireAdmin();
    const [tables, users, roles] = await Promise.all([
      new WorksheetPermissions(this.db, this.actor).catalog(),
      this.db.user.findMany({ where: { status: 'ENABLED', OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }] },
        select: { id: true, username: true, employee: { select: { name: true } } }, orderBy: { id: 'asc' } }),
      this.db.role.findMany({ where: { status: 'ENABLED', type: 'BUSINESS' }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    ]);
    const subjects: Subject[] = [
      ...users.map(u => ({ id: u.id, target: 'MEMBER' as const, label: u.employee?.name ? `${u.employee.name}（${u.username}）` : u.username })),
      ...roles.map(r => ({ id: r.id, target: 'ROLE' as const, label: r.name })),
    ];
    return { tables, subjects };
  }

  async query(raw: unknown) {
    this.requireAdmin();
    const input = exact(raw, ['tableId', 'target', 'id', 'offset', 'limit']);
    const target = choice(input.target, ['MEMBER', 'ROLE', 'ALL', 'ALL_MEMBERS', 'ALL_ROLES']);
    const id = target === 'MEMBER' || target === 'ROLE' ? text(input.id) : undefined;
    const tableId = input.tableId === undefined ? undefined : text(input.tableId);
    const offset = integer(input.offset ?? 0, 0);
    const limit = integer(input.limit ?? 40, 1, 80);
    const options = await this.options();
    const tables = options.tables.filter(t => !tableId || t.id === tableId);
    if (tableId && !tables.length) fail('COLLAB_NOT_FOUND', 404);
    const subjects = options.subjects.filter(s => id ? s.id === id && s.target === target
      : target === 'ALL' || s.target === (target === 'ALL_MEMBERS' ? 'MEMBER' : 'ROLE'));
    if (id && !subjects.length) fail('COLLAB_NOT_FOUND', 404);
    // Bound each request; the client can cancel or continue without one giant matrix query.
    const total = tables.length * subjects.length;
    const end = Math.min(offset + limit, total);
    const loader = new AuthorizationContextLoader(this.db);
    const contexts = new Map<string, AuthorizationContext>();
    const rows: PermissionOverviewRow[] = [];
    for (let index = offset; index < end; index++) {
      const subject = subjects[index % subjects.length];
      const table = tables[Math.floor(index / subjects.length)];
      const key = subject.target + ':' + subject.id;
      try {
        let context = contexts.get(key);
        if (!context) {
          context = subject.target === 'MEMBER' ? await loader.load(subject.id) : await loader.previewRole(subject.id);
          contexts.set(key, context);
        }
        const effective = await worksheetContext(this.db, context, table.id);
        const svc = new CollaborationService(this.db, effective, subject.target === 'ROLE' ? { roleId: subject.id } : undefined);
        const { access } = await svc.tableAccess(table.id);
        if (access.viewIds?.length === 0) continue;
        rows.push({ tableId: table.id, tableName: table.name, subject, level: access.level,
          limitedRows: access.selfOnly || access.rowIds !== undefined || !!access.rules?.some(r => r.rows !== 'ALL' || !!r.business),
          limitedFields: !!(access.hidden.length || access.readonly.length || access.masked?.length || access.conditional?.length),
          limitedViews: access.viewIds !== undefined });
      } catch (error) {
        // A denied subject/table pair is not an authorized result. Operational errors stay visible.
        if (!['COLLAB_FORBIDDEN', 'COLLAB_NOT_FOUND', 'PERMISSION_DENIED', 'DATA_SCOPE_DENIED',
          'SPECIAL_PERMISSION_REQUIRED', 'AUTHENTICATION_REQUIRED'].includes((error as { code?: string }).code ?? '')) throw error;
      }
    }
    return { rows, checked: Math.min(end, total), totalCandidates: total, nextOffset: end < total ? end : null };
  }
}
