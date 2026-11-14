import { sopSourceActive } from './source-context';
import { Prisma, PrismaClient } from '@prisma/client';
import { EventHandler, EventHandlerContext } from '../events/event-delivery-store';
import { parseEventPayload } from '../../domain/events/event-registry';
import { qualityActor, qualityCaseScope } from '../quality/quality-scope';
import { requireSopTask } from './execution-scope';
import { sopReminderRecipient } from './sop-reminder';
export class SopChangeNotification implements EventHandler {
  async handle(tx: Prisma.TransactionClient, context: EventHandlerContext) {
    const event = parseEventPayload<{ id: string; version: number; action: string }>(
      'sop.task.changed',
      1,
      context.payload,
    ).payload;
    if (!['ASSIGN', 'SUBMIT', 'REVIEW'].includes(event.action)) return;
    const row = await tx.caseTask.findUnique({
      where: { id: event.id },
      include: { sopInstance: true, activeSubmission: true, case: true },
    });
    if (!row || (row.sopInstance && !(await sopSourceActive(tx,row.sopInstance))) || row.version !== event.version || row.sopInstance?.status !== 'ACTIVE') return;
    let userId: string | null;
    if (event.action === 'REVIEW' && row.status === 'CHANGES_REQUESTED' && row.activeSubmission) {
      userId = row.activeSubmission.submittedBy;
      try {
        const ctx = await qualityActor(tx, userId);
        await requireSopTask(tx, ctx, row.id, 'sop.task.read');
        await requireSopTask(tx, ctx, row.id, 'sop.report.submit');
      } catch (error) {
        if (isAccessFailure(error)) return;
        throw error;
      }
    } else userId = (await sopReminderRecipient(tx, row.id))?.userId ?? null;
    if (!userId) return;
    await tx.notification.createMany({
      data: [
        {
          userId,
          type: 'SYSTEM',
          title:
            event.action === 'ASSIGN'
              ? 'SOP任务已分派'
              : event.action === 'SUBMIT'
                ? 'SOP成果待审核'
                : 'SOP成果待修订',
          content: '您有一项仍获权的SOP待办，请进入记录办理。',
          relatedId: row.id,
          relatedType: 'SOP_TASK',
          routeUrl: '/sop/tasks/' + row.id,
          deduplicationKey: 'sop-change:' + row.id + ':' + event.version + ':' + userId,
        },
      ],
      skipDuplicates: true,
    });
  }
}
export class QualityChangeNotification implements EventHandler {
  async handle(tx: Prisma.TransactionClient, context: EventHandlerContext) {
    const event = parseEventPayload<{ id: string; version: number; action: string; type: string }>(
      'quality.changed',
      1,
      context.payload,
    ).payload;
    if (event.type !== 'QUALITY_ISSUE' || !['ASSIGN', 'SUBMIT', 'RETURN'].includes(event.action)) return;
    const row = await tx.qualityIssue.findUnique({ where: { id: event.id }, include: { inspection: true } });
    if (
      !row ||
      row.version !== event.version ||
      ['CLOSED', 'CANCELLED'].includes(row.status)
    )
      return;
    const userId = event.action === 'SUBMIT' ? row.inspection.inspectorUserId : row.assigneeUserId;
    if (!userId) return;
    try {
      const ctx = await qualityActor(tx, userId);
      for (const p of [
        'quality.issue.read',
        event.action === 'SUBMIT' ? 'quality.issue.verify' : 'quality.issue.resolve',
      ] as const) {
        if (
          !(await tx.case.count({
            where: { AND: [{ id: row.caseId }, await qualityCaseScope(tx as PrismaClient, ctx, p)] },
          }))
        )
          return;
      }
    } catch (error) {
      if (isAccessFailure(error)) return;
      throw error;
    }
    await tx.notification.createMany({
      data: [
        {
          userId,
          type: 'SYSTEM',
          title: event.action === 'SUBMIT' ? '整改待复核' : '质检问题待整改',
          content: '您有一项仍获权的质量待办，请进入记录办理。',
          relatedId: row.id,
          relatedType: 'QUALITY_ISSUE',
          routeUrl: '/quality/issues/' + row.id,
          deduplicationKey: 'quality-change:' + row.id + ':' + event.version + ':' + userId,
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
