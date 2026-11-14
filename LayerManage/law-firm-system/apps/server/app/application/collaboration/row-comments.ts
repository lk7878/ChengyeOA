import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { CollaborationService } from './collaboration-service';
import { exact, fail, integer, strings, text } from './collaboration-policy';

export class RowComments extends CollaborationService {
  async list(tableId: string, recordId: string, before?: string) {
    await this.record(tableId, recordId);
    const rows = await this.db.collabComment.findMany({
      where: { tableId, recordId, deletedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50, ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    });
    const users = await this.db.user.findMany({ where: { id: { in: rows.flatMap(r => [r.actorId, ...r.mentions]) } },
      select: { id: true, username: true, employee: { select: { name: true } } } });
    return rows.map(r => ({ ...r, author: users.find(u => u.id === r.actorId)?.employee?.name ||
      users.find(u => u.id === r.actorId)?.username || '已离职成员', canEdit: r.actorId === this.actor.userId,
      mentionedUsers: users.filter(u => r.mentions.includes(u.id)).map(u => ({ id: u.id, username: u.username, name: u.employee?.name || u.username })) }));
  }
  async recipients(tableId: string, recordId: string, keyword: string) {
    await this.record(tableId, recordId);
    const users = await this.db.user.findMany({ where: { status: 'ENABLED', OR: [
      { username: { contains: keyword.slice(0, 80), mode: 'insensitive' } },
      { employee: { name: { contains: keyword.slice(0, 80) } } },
    ] }, select: { id: true, username: true, employee: { select: { name: true } } }, orderBy: { username: 'asc' }, take: 50 });
    const result: { id: string; name: string; username: string }[] = [];
    for (const u of users) {
      if (await this.recipientCanRead(u.id, tableId, recordId))
        result.push({ id: u.id, name: u.employee?.name || u.username, username: u.username });
      if (result.length === 20) break;
    }
    return result;
  }
  private async recipientCanRead(id: string, tableId: string, recordId: string) {
    try {
      const actor = await new AuthorizationContextLoader(this.db).load(id);
      await new CollaborationService(this.db, actor).record(tableId, recordId);
      return true;
    } catch (error) {
      const e = error as { status?: number; httpStatus?: number };
      if ([401, 403, 404].includes(Number(e.status ?? e.httpStatus))) return false;
      throw error;
    }
  }
  async save(tableId: string, recordId: string, id: string | undefined, raw: unknown, key: string) {
    const input = exact(raw, ['content', 'mentions', 'version', 'remove']);
    await this.record(tableId, recordId);
    const remove = input.remove === true;
    const content = remove ? '' : text(input.content, 5000);
    const mentions = remove ? [] : strings(input.mentions ?? [], 25);
    for (const userId of mentions)
      if (!await this.recipientCanRead(userId, tableId, recordId)) fail('COMMENT_MENTION_FORBIDDEN', 403);
    return this.write(key, ['row.comment', tableId, recordId, id, input], async tx => {
      const { table, access } = await this.tableAccess(tableId, tx);
      await this.lock(tx, access.workspaceId);
      await this.record(tableId, recordId);
      for (const userId of mentions)
        if (!await this.recipientCanRead(userId, tableId, recordId)) fail('COMMENT_MENTION_FORBIDDEN', 403);
      const old = id ? await tx.collabComment.findFirst({ where: { id, tableId, recordId, deletedAt: null } }) : null;
      if (id && !old) fail('COLLAB_NOT_FOUND', 404);
      if (old && old.actorId !== this.actor.userId) fail('COLLAB_FORBIDDEN', 403);
      if (old && old.version !== integer(input.version)) fail('COMMENT_VERSION_CONFLICT', 409);
      if (remove && !old) fail('COLLAB_NOT_FOUND', 404);
      const row = old ? await tx.collabComment.update({ where: { id: old.id }, data: remove
        ? { deletedAt: new Date(), version: { increment: 1 } }
        : { content, mentions, version: { increment: 1 } } })
        : await tx.collabComment.create({ data: { tableId, recordId, actorId: this.actor.userId, content, mentions } });
      await tx.operationLog.create({ data: { userId: this.actor.userId,
        action: remove ? 'COMMENT_DELETE' : old ? 'COMMENT_UPDATE' : 'COMMENT_CREATE', targetType: 'COLLAB_COMMENT', targetId: row.id,
        oldValues: old ? JSON.stringify(old) : undefined, newValues: JSON.stringify(row) } });
      for (const userId of mentions.filter(u => u !== this.actor.userId && !old?.mentions.includes(u))) {
        await tx.notification.create({ data: { userId, type: 'MENTION', title: '有人在表格评论中提及你',
          content: '点击查看评论及关联记录。', relatedType: 'COLLAB_RECORD', relatedId: recordId,
          routeUrl: '/workspaces?' + new URLSearchParams({ base: table.baseId, table: tableId, record: recordId, comments: '1' }),
          deduplicationKey: `comment:${row.id}:${row.version}:${userId}` } });
      }
      // Comments have their own polling stream: do not invalidate an in-progress cell editor.
      return row;
    });
  }
}
