import { Prisma } from '@prisma/client';
import { EventHandler, EventHandlerContext } from '../events/event-delivery-store';
import { parseEventPayload } from '../../domain/events/event-registry';
import { PermanentEventError } from '../../domain/events/event-errors';
import { analysisChanged } from './analysis-change';
export class AssessmentHandler implements EventHandler {
  async handle(tx: Prisma.TransactionClient, context: EventHandlerContext) {
    const payload = parseEventPayload<{ id: string }>(
      'quality.assessment.recorded',
      1,
      context.payload,
    ).payload;
    const row = await tx.satisfactionAssessment.findUnique({ where: { id: payload.id } });
    if (!row) throw new PermanentEventError('QUALITY_ASSESSMENT_SOURCE_INVALID');
    if (row.scale !== 'HUNDRED_V1' || row.score === null || row.score >= 80) return;
    const inserted = await tx.specialAnalysis.createMany({
      data: [{ assessmentId: row.id, caseId: row.caseId, createdBy: row.createdBy }],
      skipDuplicates: true,
    });
    if (inserted.count) {
      const analysis = await tx.specialAnalysis.findUniqueOrThrow({ where: { assessmentId: row.id } });
      await analysisChanged(tx, analysis.id, row.createdBy, 'CREATE');
      await tx.operationLog.create({
        data: {
          userId: row.createdBy,
          action: 'QUALITY_ANALYSIS_TRIGGERED',
          targetType: 'SPECIAL_ANALYSIS',
          targetId: analysis.id,
          newValues: JSON.stringify({ assessmentId: row.id, eventId: context.eventId }),
          ip: 'system',
        },
      });
    }
  }
}
