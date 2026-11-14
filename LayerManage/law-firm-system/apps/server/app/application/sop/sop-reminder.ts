import { sopSourceActive, lockSopSource } from './source-context';
import { Prisma, PrismaClient } from '@prisma/client';
import { qualityActor } from '../quality/quality-scope';
import { requireSopTask } from './execution-scope';
import { checkReviewer } from './review-policy';
import { SopNode } from '../../domain/sop/template-content';
import { EventHandler, EventHandlerContext } from '../events/event-delivery-store';
import { parseEventPayload } from '../../domain/events/event-registry';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';
type DB = PrismaClient | Prisma.TransactionClient;
export async function sopReminderRecipient(db: DB, taskId: string) {
  const task = await db.caseTask.findUnique({
    where: { id: taskId },
    include: { case: true, sopInstance: true, activeSubmission: { include: { review: true } } },
  });
  if (
    !task?.sopInstance ||
    task.sopInstance.status !== 'ACTIVE' ||
    !(await sopSourceActive(db,task.sopInstance)) ||
    ['COMPLETED', 'SKIPPED'].includes(task.status)
  )
    return null;
  const sub = task.activeSubmission,
    review = sub?.review;
  const userId = task.status === 'IN_REVIEW' ? review?.reviewerUserId : task.assigneeUserId;
  if (!userId) return null;
  try {
    const ctx = await qualityActor(db, userId);
    await requireSopTask(db, ctx, task.id, 'sop.task.read');
    if (task.status === 'IN_REVIEW') {
      if (!sub || review?.status !== 'PENDING') return null;
      await checkReviewer(db, userId, task.id, sub.submittedBy, sub.executorUserId);
    } else await requireSopTask(db, ctx, task.id, 'sop.task.execute');
    return { task, userId };
  } catch (error) {
    if (isAccessFailure(error)) return null;
    throw error;
  }
}
export class SopReminderScanner {
  private cursor: string | null = null;
  constructor(private db: PrismaClient) {}
  async scanOnce(now: Date) {
    const rows = await this.db.caseTask.findMany({
      where: {
        sopInstance: { status: 'ACTIVE' },
        dueDate: { not: null },
        status: { notIn: ['COMPLETED', 'SKIPPED'] },
        ...(this.cursor ? { id: { gt: this.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 100,
    });
    this.cursor = rows.length === 100 ? rows[rows.length - 1].id : null;
    for (const candidate of rows) {
      const days = (candidate.nodeSnapshot as unknown as SopNode).reminderDays;
      if (!days || !candidate.dueDate || now.getTime() < candidate.dueDate.getTime() - days * 86400000)
        continue;
      const kind = now >= candidate.dueDate ? 'DUE' : 'BEFORE';
      await this.db.$transaction(async (tx) => {
        await lockSopSource(tx,await tx.sopInstance.findUniqueOrThrow({where:{id:candidate.sopInstanceId!}}));
        await tx.$queryRaw`SELECT id FROM sop_instance WHERE id=${candidate.sopInstanceId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM case_task WHERE id=${candidate.id} FOR UPDATE`;
        const target = await sopReminderRecipient(tx, candidate.id);
        if (
          !target ||
          target.task.version !== candidate.version ||
          target.task.dueDate?.getTime() !== candidate.dueDate!.getTime()
        )
          return;
        const prior = await tx.sopReminderEmission.findUnique({
          where: {
            taskId_taskVersion_kind_recipientId: {
              taskId: candidate.id,
              taskVersion: candidate.version,
              kind,
              recipientId: target.userId,
            },
          },
        });
        if (prior) return;
        const row = await tx.sopReminderEmission.create({
          data: {
            taskId: candidate.id,
            taskVersion: candidate.version,
            kind,
            recipientId: target.userId,
            dueAt: candidate.dueDate!,
          },
        });
        await new PrismaEventOutboxWriter().append(tx, {
          eventType: 'sop.reminder.due',
          eventVersion: 1,
          objectType: 'SOP_REMINDER',
          objectId: row.id,
          operatorUserId: target.userId,
          organizationId: (await tx.sopTemplateVersion.findUniqueOrThrow({where:{id:target.task.sopInstance!.templateVersionId},include:{template:true}})).template.organizationId,
          branchId: (await tx.sopTemplateVersion.findUniqueOrThrow({where:{id:target.task.sopInstance!.templateVersionId},include:{template:true}})).template.organizationId,
          teamId: null,
          payload: { id: row.id },
          traceId: row.id,
          occurredAt: now,
        });
      });
    }
  }
}
export class SopReminderHandler implements EventHandler {
  async handle(tx: Prisma.TransactionClient, context: EventHandlerContext) {
    const { id } = parseEventPayload<{ id: string }>('sop.reminder.due', 1, context.payload).payload;
    const emission = await tx.sopReminderEmission.findUnique({ where: { id } });
    if (!emission) return;
    const target = await sopReminderRecipient(tx, emission.taskId);
    if (
      !target ||
      target.userId !== emission.recipientId ||
      target.task.version !== emission.taskVersion ||
      target.task.dueDate?.getTime() !== emission.dueAt.getTime()
    )
      return;
    await tx.notification.createMany({
      data: [
        {
          userId: target.userId,
          type: 'SYSTEM',
          title: emission.kind === 'DUE' ? 'SOP任务已到期' : 'SOP任务临近到期',
          content: '您有一项仍获权的SOP待办，请进入任务查看。',
          relatedId: target.task.id,
          relatedType: 'SOP_TASK',
          routeUrl: '/sop/tasks/' + target.task.id,
          deduplicationKey: 'sop-reminder:' + id,
        },
      ],
      skipDuplicates: true,
    });
  }
}

function isAccessFailure(error: unknown) {
  const status = (error as { status?: number })?.status;
  return status === 401 || status === 403 || status === 404 || status === 409;
}
