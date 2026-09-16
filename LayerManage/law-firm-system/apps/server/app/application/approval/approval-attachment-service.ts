import { guardSopApproval } from '../sop/review-policy';
import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { fileError, validateApprovalFile } from '../../domain/approval/approval-file-validation';

export const attachmentSelect = { id: true, ownerUserId: true, instanceId: true, fileName: true, mimeType: true, fileSize: true, sha256: true, sourceId: true, createdAt: true } as const;
type Db = Prisma.TransactionClient;

export class ApprovalAttachmentService {
  private authorization: AuthorizationService;
  constructor(private prisma: PrismaClient, private actor: AuditActor, private context: AuthorizationContext) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }
  private requireApply() { this.authorization.requireAction(this.context, 'approval.apply'); }
  private canManage(): boolean {
    try { this.authorization.requireAction(this.context, 'approval.manage'); return true; } catch { return false; }
  }
  private async readableInstance(db: Db, instanceId: string) {
    const manage = this.canManage();
    if (!manage) this.authorization.requireAction(this.context, 'approval.read');
    const instance = await db.approvalInstance.findFirst({ where: { id: instanceId, ...(manage ? {} : { OR: [{ applicantId: this.actor.actorUserId }, { tasks: { some: { assigneeId: this.actor.actorUserId } } }] }) } });
    if (!instance) fileError('APPROVAL_FILE_NOT_FOUND', 404);
    if (instance.businessType === 'SOP_REVIEW') await guardSopApproval(db,this.context,instance.id,'READ');
    return instance;
  }
  private async readable(db: Db, id: string) {
    const row = await db.approvalAttachment.findUnique({ where: { id }, select: attachmentSelect });
    if (!row) fileError('APPROVAL_FILE_NOT_FOUND', 404);
    if (row.instanceId) await this.readableInstance(db, row.instanceId);
    else { this.requireApply(); if (row.ownerUserId !== this.actor.actorUserId) fileError('APPROVAL_FILE_NOT_FOUND', 404); }
    return row;
  }
  private async audit(db: Db, action: string, id: string, data: Record<string, unknown> = {}) {
    await db.operationLog.create({ data: { userId: this.actor.actorUserId, action, targetType: 'APPROVAL_ATTACHMENT', targetId: id, newValues: JSON.stringify(data), ip: this.actor.ip } });
  }
  async upload(fileName: string, bytes: Buffer, sourceId?: string) {
    this.requireApply();
    const mimeType = validateApprovalFile(fileName, bytes);
    return this.prisma.$transaction(async tx => {
      if (sourceId) await this.readable(tx, sourceId);
      const row = await tx.approvalAttachment.create({ data: { ownerUserId: this.actor.actorUserId, fileName, bytes, mimeType, fileSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sourceId }, select: attachmentSelect });
      await this.audit(tx, sourceId ? 'APPROVAL_FILE_EDIT_COPY' : 'APPROVAL_FILE_UPLOAD', row.id, { sourceId, fileSize: row.fileSize, sha256: row.sha256 });
      return row;
    });
  }
  async list(instanceId: string) {
    return this.prisma.$transaction(async tx => {
      await this.readableInstance(tx, instanceId);
      return tx.approvalAttachment.findMany({ where: { instanceId }, select: attachmentSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    });
  }
  async download(id: string, purpose: 'PREVIEW' | 'DOWNLOAD' = 'DOWNLOAD') {
    return this.prisma.$transaction(async tx => {
      const row = await this.readable(tx, id);
      const data = await tx.approvalAttachment.findUniqueOrThrow({ where: { id }, select: { bytes: true } });
      await this.audit(tx, 'APPROVAL_FILE_' + purpose, id, { instanceId: row.instanceId });
      return { ...row, base64: data.bytes.toString('base64') };
    });
  }
  async clone(id: string) {
    this.requireApply();
    const file = await this.download(id);
    return this.upload(file.fileName, Buffer.from(file.base64, 'base64'), id);
  }
  async remove(id: string) {
    this.requireApply();
    try { return await this.prisma.$transaction(async tx => {
      const removed = await tx.approvalAttachment.deleteMany({ where: { id, ownerUserId: this.actor.actorUserId, instanceId: null } });
      if (!removed.count) fileError('APPROVAL_FILE_FROZEN', 409);
      await this.audit(tx, 'APPROVAL_FILE_REMOVE', id);
      return { id };
    }); } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') fileError('APPROVAL_FILE_FROZEN', 409);
      throw error;
    }
  }
  async exportRecord(instanceId: string) {
    return this.prisma.$transaction(async tx => {
      const instance = await this.readableInstance(tx, instanceId);
      const tasks = await tx.approvalTask.findMany({ where: { instanceId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const ids = [...new Set([instance.applicantId, ...tasks.map(task => task.assigneeId)])];
      const people = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, employee: { select: { name: true } } } });
      const attachments = await tx.approvalAttachment.findMany({ where: { instanceId }, select: attachmentSelect });
      await this.audit(tx, 'APPROVAL_MATERIAL_EXPORT', instanceId, { version: instance.version });
      return { instance, tasks, attachments, people: people.map(person => ({ id: person.id, name: person.employee?.name || person.username })) };
    });
  }
}

export function normalizeAttachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(value).size !== value.length) fileError();
  return value;
}

/** Binding is part of the apply transaction. No file can be attached twice or stolen from another owner. */
export async function bindApprovalAttachments(tx: Db, ids: string[], instanceId: string, actor: AuditActor) {
  if (!ids.length) return;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM approval_attachment WHERE id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`);
  const held = await tx.payrollBatch.count({ where: { attachmentId: { in: ids }, OR: [{ instanceId: null }, { instanceId: { not: instanceId } }] } });
  if (held) fileError('APPROVAL_FILE_BIND_INVALID', 409);
  const rows = await tx.approvalAttachment.findMany({ where: { id: { in: ids }, ownerUserId: actor.actorUserId, instanceId: null }, select: { id: true, fileSize: true } });
  if (rows.length !== ids.length || rows.reduce((sum, row) => sum + row.fileSize, 0) > 100 * 1024 * 1024) fileError('APPROVAL_FILE_BIND_INVALID', 409);
  const bound = await tx.approvalAttachment.updateMany({ where: { id: { in: ids }, ownerUserId: actor.actorUserId, instanceId: null }, data: { instanceId } });
  if (bound.count !== ids.length) fileError('APPROVAL_FILE_BIND_INVALID', 409);
  await tx.operationLog.create({ data: { userId: actor.actorUserId, action: 'APPROVAL_FILE_BIND', targetType: 'APPROVAL_INSTANCE', targetId: instanceId, newValues: JSON.stringify({ attachmentIds: ids }), ip: actor.ip } });
}
