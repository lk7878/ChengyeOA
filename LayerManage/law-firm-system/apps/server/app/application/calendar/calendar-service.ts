import { Prisma, PrismaClient, CalendarEvent } from '@prisma/client';
import { CollaborationService } from '../collaboration/collaboration-service';
import { boolean, choice, exact, fail, integer, strings, text } from '../collaboration/collaboration-policy';

export const calendarLock = (tx: Prisma.TransactionClient) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('calendar-reminders', 0))`;
function date(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
    fail('CALENDAR_INVALID_TIME');
  return new Date(value);
}
const eventInclude = { invitations: true, reminders: { orderBy: { minutesBefore: 'desc' as const } } };

export class CalendarService extends CollaborationService {
  private visible(): Prisma.CalendarEventWhereInput {
    return { OR: [{ ownerId: this.actor.userId }, { visibility: 'PUBLIC' },
      { visibility: 'INVITEES', invitations: { some: { userId: this.actor.userId } } }] };
  }
  async people(keyword = '') {
    const users = await this.db.user.findMany({ where: { status: 'ENABLED', OR: [
      { username: { contains: keyword.slice(0, 80), mode: 'insensitive' } },
      { employee: { name: { contains: keyword.slice(0, 80) } } },
    ] }, select: { id: true, username: true, employee: { select: { name: true } } }, orderBy: { username: 'asc' }, take: 50 });
    return users.map(u => ({ id: u.id, name: u.employee?.name || u.username, username: u.username }));
  }
  async events(raw: unknown) {
    const input = exact(raw, ['from', 'to']);
    const from = date(input.from), to = date(input.to);
    if (to <= from || to.getTime() - from.getTime() > 93 * 86400000) fail('CALENDAR_INVALID_TIME');
    const rows = await this.db.calendarEvent.findMany({ where: { ...this.visible(), cancelledAt: null,
      startAt: { lt: to }, endAt: { gt: from } }, include: eventInclude, orderBy: [{ startAt: 'asc' }, { id: 'asc' }], take: 501 });
    return { rows: rows.slice(0, 500).map(e => ({ ...e, mine: e.ownerId === this.actor.userId,
      myResponse: e.invitations.find(i => i.userId === this.actor.userId)?.status })), truncated: rows.length > 500 };
  }
  async eventDetail(id: string) {
    const event = await this.db.calendarEvent.findFirst({ where: { id, ...this.visible() }, include: eventInclude });
    if (!event) fail('CALENDAR_NOT_FOUND', 404);
    const people = await this.db.user.findMany({ where: { id: { in: [event.ownerId, ...event.invitations.map(i => i.userId)] } },
      select: { id: true, username: true, employee: { select: { name: true } } } });
    let recordUrl: string | null = null;
    if (event.tableId && event.recordId) {
      try { recordUrl = await this.recordLink(event.tableId, event.recordId); }
      catch (error) { if (![403, 404].includes(Number((error as {status?:number}).status))) throw error; }
    }
    return { ...event, mine: event.ownerId === this.actor.userId,
      myResponse: event.invitations.find(i => i.userId === this.actor.userId)?.status,
      people: people.map(u => ({ id: u.id, name: u.employee?.name || u.username, username: u.username })), recordUrl };
  }
  async recordLink(tableId: string, recordId: string) {
    await this.record(tableId, recordId);
    const table = await this.db.collabTable.findUniqueOrThrow({ where: { id: tableId } });
    return '/workspaces?' + new URLSearchParams({ base: table.baseId, table: tableId, record: recordId });
  }
  async saveEvent(id: string | undefined, raw: unknown, key: string) {
    const input = exact(raw, ['title', 'description', 'location', 'startAt', 'endAt', 'important', 'visibility',
      'invitees', 'reminders', 'tableId', 'recordId', 'version']);
    const startAt = date(input.startAt), endAt = date(input.endAt);
    if (endAt <= startAt) fail('CALENDAR_INVALID_TIME');
    const visibility = choice(input.visibility ?? 'PRIVATE', ['PRIVATE', 'INVITEES', 'PUBLIC']);
    const invitees = strings(input.invitees ?? [], 100).filter(u => u !== this.actor.userId);
    if (visibility === 'PRIVATE' && invitees.length) fail('CALENDAR_PRIVATE_INVITE');
    if (!Array.isArray(input.reminders) || input.reminders.length > 10) fail('CALENDAR_INVALID_REMINDERS');
    const reminders = [...new Set(input.reminders.map(v => integer(v, 0, 40320)))];
    const tableId = input.tableId ? text(input.tableId) : null, recordId = input.recordId ? text(input.recordId) : null;
    if (!!tableId !== !!recordId) fail('CALENDAR_INVALID_LINK');
    if (tableId && recordId) await this.recordLink(tableId, recordId);
    const data = { title: text(input.title, 200), description: input.description ? text(input.description, 5000) : '',
      location: input.location ? text(input.location, 300) : '', startAt, endAt,
      important: boolean(input.important ?? false), visibility, tableId, recordId };
    return this.write(key, ['calendar.save', id, input], async tx => {
      await calendarLock(tx);
      const old = id ? await tx.calendarEvent.findUnique({ where: { id }, include: eventInclude }) : null;
      if (id && (!old || old.cancelledAt)) fail('CALENDAR_NOT_FOUND', 404);
      if (old && old.ownerId !== this.actor.userId) fail('COLLAB_FORBIDDEN', 403);
      if (old && old.version !== integer(input.version)) fail('CALENDAR_VERSION_CONFLICT', 409);
      if (await tx.user.count({ where: { id: { in: invitees }, status: 'ENABLED' } }) !== invitees.length)
        fail('CALENDAR_INVALID_INVITEE');
      const event = old ? await tx.calendarEvent.update({ where: { id: old.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.calendarEvent.create({ data: { ...data, ownerId: this.actor.userId } });
      const moved = old && (old.startAt.getTime() !== startAt.getTime() || old.endAt.getTime() !== endAt.getTime());
      await tx.calendarInvitation.deleteMany({ where: { eventId: event.id, userId: { notIn: invitees } } });
      for (const userId of invitees) await tx.calendarInvitation.upsert({ where: { eventId_userId: { eventId: event.id, userId } },
        create: { eventId: event.id, userId }, update: moved ? { status: 'PENDING', respondedAt: null } : {} });
      await tx.calendarReminder.deleteMany({ where: { eventId: event.id } });
      await tx.calendarReminder.createMany({ data: reminders.map(minutesBefore => ({ eventId: event.id, minutesBefore,
        dueAt: new Date(startAt.getTime() - minutesBefore * 60000),
        // Preserve delivered nodes on a description-only edit; changing the time schedules new nodes.
        processedAt: !moved ? old?.reminders.find(r => r.minutesBefore === minutesBefore)?.processedAt : null,
      })) });
      const recipients = [...new Set([...invitees, ...(old?.invitations.map(i => i.userId) ?? [])])];
      for (const userId of recipients) await calendarNotice(tx, event, userId,
        invitees.includes(userId) ? old ? '日程已更新，请查看安排' : '你收到一项日程邀请' : '日程邀请已撤回', `change:${event.version}`);
      await auditCalendar(tx, this.actor.userId, old ? 'CALENDAR_UPDATE' : 'CALENDAR_CREATE', event.id, old, event);
      return event;
    });
  }
  async respond(id: string, raw: unknown, key: string) {
    const input = exact(raw, ['status', 'version']);
    const status = choice(input.status, ['ACCEPTED', 'DECLINED', 'TENTATIVE']);
    return this.write(key, ['calendar.rsvp', id, input], async tx => {
      await calendarLock(tx);
      const event = await tx.calendarEvent.findUnique({ where: { id } });
      if (!event || event.cancelledAt) fail('CALENDAR_NOT_FOUND', 404);
      if (event.version !== integer(input.version)) fail('CALENDAR_VERSION_CONFLICT', 409);
      const old = await tx.calendarInvitation.findUnique({ where: { eventId_userId: { eventId: id, userId: this.actor.userId } } });
      if (!old) fail('COLLAB_FORBIDDEN', 403);
      if (old.status === status) return old;
      const result = await tx.calendarInvitation.update({ where: { id: old.id }, data: { status, respondedAt: new Date() } });
      await calendarNotice(tx, event, event.ownerId, '受邀成员更新了日程回复', `rsvp:${result.id}:${result.respondedAt!.getTime()}`);
      await auditCalendar(tx, this.actor.userId, 'CALENDAR_RSVP', id, old, result);
      return result;
    });
  }
  async cancel(id: string, raw: unknown, key: string) {
    const input = exact(raw, ['version']);
    return this.write(key, ['calendar.cancel', id, input], async tx => {
      await calendarLock(tx);
      const event = await tx.calendarEvent.findUnique({ where: { id }, include: eventInclude });
      if (!event || event.cancelledAt) fail('CALENDAR_NOT_FOUND', 404);
      if (event.ownerId !== this.actor.userId) fail('COLLAB_FORBIDDEN', 403);
      if (event.version !== integer(input.version)) fail('CALENDAR_VERSION_CONFLICT', 409);
      const result = await tx.calendarEvent.update({ where: { id }, data: { cancelledAt: new Date(), version: { increment: 1 } } });
      for (const invite of event.invitations) await calendarNotice(tx, event, invite.userId, '日程已取消', `cancel:${result.version}`);
      await auditCalendar(tx, this.actor.userId, 'CALENDAR_CANCEL', id, event, result);
      return result;
    });
  }
}
async function auditCalendar(tx: Prisma.TransactionClient, userId: string, action: string, targetId: string, before: unknown, after: unknown) {
  await tx.operationLog.create({ data: { userId, action, targetType: 'CALENDAR_EVENT', targetId,
    oldValues: JSON.stringify(before), newValues: JSON.stringify(after) } });
}
async function calendarNotice(tx: Prisma.TransactionClient, event: CalendarEvent, userId: string, title: string, key: string) {
  await tx.notification.upsert({ where: { deduplicationKey: `calendar:${event.id}:${key}:${userId}` }, update: {},
    create: { userId, type: 'CALENDAR', title, content: '点击打开日程，查看安排及参与状态。',
      relatedType: 'CALENDAR_EVENT', relatedId: event.id, routeUrl: '/calendar?event=' + event.id,
      deduplicationKey: `calendar:${event.id}:${key}:${userId}` } });
}

/** Persisted due jobs catch up after downtime. Job completion and recipient notifications commit together. */
export async function deliverCalendarReminders(db: PrismaClient, now = new Date()) {
  return db.$transaction(async tx => {
    await calendarLock(tx);
    const due = await tx.calendarReminder.findMany({ where: { processedAt: null, dueAt: { lte: now },
      event: { cancelledAt: null } }, orderBy: { dueAt: 'asc' }, take: 100, include: {
        event: { include: { invitations: { where: { status: 'ACCEPTED' } } } },
      } });
    let sent = 0;
    for (const job of due) {
      const recipients = await tx.user.findMany({ where: { status: 'ENABLED', id: { in: [job.event.ownerId,
        ...job.event.invitations.map(i => i.userId)] } }, select: { id: true } });
      for (const recipient of recipients) {
        await calendarNotice(tx, job.event, recipient.id,
          now.getTime() - job.dueAt.getTime() > 60000 ? '日程提醒（离线期间到期，现已补发）' : '日程即将开始',
          `reminder:${job.id}`);
        sent++;
      }
      await tx.calendarReminder.update({ where: { id: job.id }, data: { processedAt: now } });
    }
    return { jobs: due.length, sent };
  }, { timeout: 30000 });
}
