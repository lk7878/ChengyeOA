import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { AuditActor } from '../master-data/master-data-types';
import {
  normalizeRequiredText,
  normalizeVersion,
  assertExactKeys,
} from '../../domain/master-data/master-data-validation';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { attachmentSelect } from '../approval/approval-attachment-service';
import { fileError } from '../../domain/approval/approval-file-validation';

export interface SavePayrollInput {
  title: string;
  period: string;
  attachmentId: string;
  version?: number;
}
export const payrollInclude = {
  attachment: { select: attachmentSelect },
  workflow: { select: { id: true, status: true } },
  instance: { select: { id: true, status: true } },
} as const;
export class PayrollService {
  private auth = new AuthorizationService();
  constructor(
    private prisma: PrismaClient,
    private actor: AuditActor,
    private context: AuthorizationContext,
  ) {}
  async list(page = 1) {
    this.auth.requireAction(this.context, 'performance.read');
    if (!Number.isSafeInteger(page) || page < 1) throw new MasterDataError('VALIDATION_FAILED', 400);
    const where = { ownerUserId: this.actor.actorUserId };
    const [total, list] = await this.prisma.$transaction([
      this.prisma.payrollBatch.count({ where }),
      this.prisma.payrollBatch.findMany({
        where,
        include: payrollInclude,
        take: 20,
        skip: (page - 1) * 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    ]);
    return { list: list.map((row) => ({ ...row, instance: row.workflow ?? row.instance })), total, page };
  }
  async get(id: string) {
    this.auth.requireAction(this.context, 'performance.read');
    const row = await this.prisma.payrollBatch.findFirst({
      where: { id, ownerUserId: this.context.userId },
      include: payrollInclude,
    });
    if (!row) fileError('APPROVAL_FILE_NOT_FOUND', 404);
    return { ...row, instance: row.workflow ?? row.instance };
  }
  async save(input: SavePayrollInput, id?: string) {
    this.auth.requireAction(this.context, id ? 'performance.update' : 'performance.create');
    this.auth.requireAction(this.context, 'approval.apply');
    assertExactKeys(input, ['title', 'period', 'attachmentId', 'version']);
    const title = normalizeRequiredText(input.title, 1, 200),
      period = normalizeRequiredText(input.period, 7, 7),
      attachmentId = normalizeRequiredText(input.attachmentId, 1, 100);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new MasterDataError('VALIDATION_FAILED', 400);
    return this.prisma.$transaction(async (tx) => {
      if (id) {
        await tx.$queryRaw`SELECT id FROM payroll_batch WHERE id = ${id} FOR UPDATE`;
        const current = await tx.payrollBatch.findFirst({
          where: { id, ownerUserId: this.actor.actorUserId },
        });
        if (!current) fileError('APPROVAL_FILE_NOT_FOUND', 404);
        if (current.instanceId || current.workflowInstanceId) fileError('APPROVAL_FILE_FROZEN', 409);
        if (current.version !== normalizeVersion(input.version))
          throw new MasterDataError('VERSION_CONFLICT', 409);
      }
      await tx.$queryRaw`SELECT id FROM approval_attachment WHERE id = ${attachmentId} FOR UPDATE`;
      const file = await tx.approvalAttachment.findFirst({
        where: { id: attachmentId, ownerUserId: this.actor.actorUserId, instanceId: null },
      });
      if (!file || !file.fileName.toLowerCase().endsWith('.xlsx')) fileError('APPROVAL_FILE_INVALID', 400);
      const used = await tx.payrollBatch.findFirst({
        where: { attachmentId, ...(id ? { id: { not: id } } : {}) },
      });
      if (used) fileError('APPROVAL_FILE_FROZEN', 409);
      const row = id
        ? await tx.payrollBatch.update({
            where: { id },
            data: { title, period, attachmentId, version: { increment: 1 } },
            include: payrollInclude,
          })
        : await tx.payrollBatch.create({
            data: { ownerUserId: this.actor.actorUserId, title, period, attachmentId },
            include: payrollInclude,
          });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'PAYROLL_SAVE',
          targetType: 'PAYROLL_BATCH',
          targetId: row.id,
          newValues: JSON.stringify({ attachmentId, version: row.version }),
          ip: this.actor.ip,
        },
      });
      return row;
    });
  }
}

export async function bindPayroll(
  tx: Prisma.TransactionClient,
  id: string,
  version: number,
  instanceId: string,
  attachmentIds: string[],
  actor: AuditActor,
  period: unknown,
) {
  await tx.$queryRaw`SELECT id FROM payroll_batch WHERE id = ${id} FOR UPDATE`;
  const batch = await tx.payrollBatch.findFirst({ where: { id, ownerUserId: actor.actorUserId } });
  if (!batch) fileError('APPROVAL_FILE_NOT_FOUND', 404);
  if (
    batch.period !== period ||
    batch.instanceId ||
    batch.version !== version ||
    attachmentIds.length !== 1 ||
    attachmentIds[0] !== batch.attachmentId
  )
    fileError('APPROVAL_FILE_FROZEN', 409);
  await tx.payrollBatch.update({ where: { id }, data: { instanceId, version: { increment: 1 } } });
}
