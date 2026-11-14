import { PrismaClient, Prisma } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { AuditActor } from '../master-data/master-data-types';
import {
  assertExactKeys,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { sopFail } from '../../domain/sop/template-content';
import { requireSopInstance, sopInstanceScope } from './execution-scope';
import { requireSopSource, lockSopSource, sourceKind } from './source-context';
import { qualityActor } from '../quality/quality-scope';
import { createOnce } from '../finance/domain-mutation';
import { SopExecutionService } from './execution-service';

type DB = PrismaClient | Prisma.TransactionClient;
export class SopContinuationService {
  constructor(
    private db: PrismaClient,
    private actor: AuditActor,
    private ctx: AuthorizationContext,
  ) {}
  private async validate(
    db: DB,
    ctx: AuthorizationContext,
    sourceId: string,
    targetId: string,
    manage = false,
  ) {
    const source = await requireSopInstance(
        db,
        ctx,
        sourceId,
        manage ? 'sop.instance.manage' : 'sop.instance.read',
      ),
      target = await requireSopInstance(
        db,
        ctx,
        targetId,
        manage ? 'sop.instance.manage' : 'sop.instance.read',
      );
    const from = await requireSopSource(db, ctx, source, manage),
      to = await requireSopSource(db, ctx, target, manage);
    if (
      !(
        (from.kind === 'LEAD' && ['ANALYSIS_ENGAGEMENT', 'CASE'].includes(to.kind)) ||
        (from.kind === 'ANALYSIS_ENGAGEMENT' && to.kind === 'CASE')
      )
    )
      sopFail('SOP_CONTINUATION_INVALID', 409);
    if (
      !from.customerId ||
      from.customerId !== to.customerId ||
      from.organizationId !== to.organizationId ||
      source.templateVersion.template.professionalTeamId !==
        target.templateVersion.template.professionalTeamId
    )
      sopFail('SOP_CONTINUATION_INVALID', 409);
    if (from.kind === 'ANALYSIS_ENGAGEMENT') {
      const engagement = await db.analysisEngagement.findUniqueOrThrow({
          where: { id: source.analysisEngagementId! },
        }),
        caseRow = await db.case.findUniqueOrThrow({
          where: { id: target.caseId! },
          include: { contract: true },
        }),
        contract = caseRow.contract;
      if (
        !contract ||
        contract.contractType !== 'FORMAL' ||
        contract.customerId !== engagement.customerId ||
        !(
          contract.parentContractId === engagement.contractId ||
          (contract.sourceType === 'ANALYSIS' && contract.sourceId === engagement.id)
        )
      )
        sopFail('SOP_CONTINUATION_INVALID', 409);
    }
    return { source, target, from, to };
  }
  async options(id: string) {
    const source = await requireSopInstance(this.db, this.ctx, id, 'sop.instance.manage');
    const origin = await requireSopSource(this.db, this.ctx, source, true);
    if (!origin.customerId || origin.kind === 'CASE') return [];
    const rows = await this.db.sopInstance.findMany({
        where: {
          AND: [
            await sopInstanceScope(this.db, this.ctx, 'sop.instance.manage'),
            { id: { not: id }, status: { in: ['ACTIVE', 'COMPLETED'] } },
            { templateVersion: { template: { professionalTeamId: source.templateVersion.template.professionalTeamId, organizationId: source.templateVersion.template.organizationId } } },
            { OR: [
              { case: { customerId: origin.customerId } },
              ...(origin.kind === 'LEAD' ? [{ analysisEngagement: { customerId: origin.customerId } }] : []),
            ] },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 100,
      }),
      list = [];
    for (const row of rows)
      try {
        const valid = await this.validate(this.db, this.ctx, id, row.id, true);
        list.push({
          id: row.id,
          version: row.version,
          title: valid.to.title,
          kind: valid.to.kind,
          batchKey: row.batchKey,
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (![401, 403, 404, 409].includes(status ?? 0)) throw error;
      }
    return list;
  }
  async list(id: string) {
    await requireSopInstance(this.db, this.ctx, id, 'sop.instance.read');
    const rows = await this.db.sopContinuation.findMany({
        where: { OR: [{ sourceInstanceId: id }, { targetInstanceId: id }] },
        orderBy: { createdAt: 'asc' },
      }),
      list = [];
    for (const row of rows)
      try {
        const valid = await this.validate(this.db, this.ctx, row.sourceInstanceId, row.targetInstanceId);
        list.push({
          id: row.id,
          sourceInstanceId: row.sourceInstanceId,
          targetInstanceId: row.targetInstanceId,
          sourceTitle: valid.from.title,
          targetTitle: valid.to.title,
          reason: row.reason,
          createdAt: row.createdAt,
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (![401, 403, 404, 409].includes(status ?? 0)) throw error;
      }
    return list;
  }
  async create(id: string, raw: unknown) {
    assertExactKeys(raw, ['targetInstanceId', 'expectedVersion', 'targetVersion', 'reason', 'requestKey']);
    const targetId = normalizeRequiredText(raw.targetInstanceId, 1, 100),
      version = normalizeVersion(raw.expectedVersion),
      targetVersion = normalizeVersion(raw.targetVersion),
      reason = normalizeRequiredText(raw.reason, 1, 2000),
      key = normalizeRequiredText(raw.requestKey, 8, 128);
    await this.validate(this.db, this.ctx, id, targetId, true);
    return createOnce(
      this.db,
      {
        actorId: this.ctx.userId,
        key,
        operation: 'SOP_CONTINUATION',
        normalized: { id, targetId, version, targetVersion, reason },
      },
      async (tx) => {
        const ctx = await qualityActor(tx, this.ctx.userId),
          initial = await this.validate(tx, ctx, id, targetId, true);
        const refs = [initial.source, initial.target].sort((a, b) =>
          (sourceKind(a) + a.id).localeCompare(sourceKind(b) + b.id),
        );
        for (const ref of refs) await lockSopSource(tx, ref);
        for (const target of [id, targetId].sort())
          await tx.$queryRaw`SELECT id FROM sop_instance WHERE id=${target} FOR UPDATE`;
        const current = await this.validate(tx, ctx, id, targetId, true),
          prior = await tx.sopContinuation.findUnique({
            where: {
              sourceInstanceId_targetInstanceId: { sourceInstanceId: id, targetInstanceId: targetId },
            },
          });
        if (prior) return { id: prior.id };
        if (current.source.version !== version || current.target.version !== targetVersion)
          sopFail('SOP_VERSION_CONFLICT', 409);
        if ([current.source, current.target].some((r) => !['ACTIVE', 'COMPLETED'].includes(r.status)))
          sopFail('SOP_STATE_INVALID', 409);
        const row = await tx.sopContinuation.create({
          data: {
            sourceInstanceId: id,
            targetInstanceId: targetId,
            sourceVersion: version,
            targetVersion,
            reason,
            createdBy: ctx.userId,
          },
        });
        const service = new SopExecutionService(tx as PrismaClient, this.actor, ctx);
        for (const instance of [current.source, current.target]) {
          const next = await tx.sopInstance.update({
            where: { id: instance.id },
            data: { version: { increment: 1 } },
          });
          await service.recordChange(
            tx,
            'SOP_INSTANCE',
            next,
            'CONTINUE',
            instance.templateVersion.template.organizationId,
            { continuationId: row.id, sourceInstanceId: id, targetInstanceId: targetId, reason },
          );
        }
        return { id: row.id };
      },
      async (tx, recordId) => {
        await this.validate(tx, await qualityActor(tx, this.ctx.userId), id, targetId, true);
        return { id: recordId };
      },
    );
  }
}
