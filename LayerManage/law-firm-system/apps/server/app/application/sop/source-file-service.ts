import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { qualityActor } from '../quality/quality-scope';
import { AuditActor } from '../master-data/master-data-types';
import { assertExactKeys, normalizeRequiredText } from '../../domain/master-data/master-data-validation';
import { sopFail } from '../../domain/sop/template-content';
import { requireSopTask } from './execution-scope';
import { requireSopSource, lockSopSource, sopSourceActive } from './source-context';
import { createOnce } from '../finance/domain-mutation';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';

type DB = PrismaClient | Prisma.TransactionClient;
export function sourceMaterialBytes(file: { filePath: string; fileSize: number; sha256: string }) {
  const root = path.resolve(process.cwd(), 'var/storage/sop-source-files'),
    target = path.resolve(root, file.filePath);
  if (path.dirname(target) !== root) sopFail('SOP_MATERIAL_CHANGED', 409);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(target);
  } catch {
    return sopFail('SOP_MATERIAL_CHANGED', 409);
  }
  if (bytes.length !== file.fileSize || createHash('sha256').update(bytes).digest('hex') !== file.sha256)
    sopFail('SOP_MATERIAL_CHANGED', 409);
  return bytes;
}
export async function requireSourceMaterials(
  db: DB,
  ctx: AuthorizationContext,
  taskId: string,
  manage = false,
) {
  await requireSopTask(db, ctx, taskId, 'sop.task.read');
  const task = await requireSopTask(db, ctx, taskId, manage ? 'sop.material.manage' : 'sop.material.read');
  if (task.caseId) sopFail('SOP_SOURCE_INVALID', 409);
  await requireSopSource(db, ctx, task.sopInstance!);
  return task;
}
export class SopSourceFileService {
  constructor(
    private db: PrismaClient,
    private actor: AuditActor,
    private ctx: AuthorizationContext,
  ) {}
  async list(taskId: string, raw: unknown = {}) {
    assertExactKeys(raw, ['page', 'pageSize']);
    const page = Number(raw.page ?? 1),
      pageSize = Number(raw.pageSize ?? 100);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize)
    )
      sopFail('VALIDATION_FAILED');
    const task = await requireSourceMaterials(this.db, this.ctx, taskId),
      where = { instanceId: task.sopInstanceId! };
    const [list, total] = await this.db.$transaction([
      this.db.sopSourceFile.findMany({
        where,
        select: { id: true, fileName: true, fileType: true, fileSize: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.sopSourceFile.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }
  async download(taskId: string, fileId: string) {
    const task = await requireSourceMaterials(this.db, this.ctx, taskId),
      file = await this.db.sopSourceFile.findFirst({
        where: { id: fileId, instanceId: task.sopInstanceId! },
      });
    if (!file) sopFail('SOP_MATERIAL_NOT_FOUND', 404);
    return {
      fileName: file!.fileName,
      fileType: file!.fileType,
      fileSize: file!.fileSize,
      base64: sourceMaterialBytes(file!).toString('base64'),
    };
  }
  async upload(taskId: string, raw: unknown) {
    assertExactKeys(raw, ['fileName', 'fileType', 'base64', 'requestKey']);
    const fileName = normalizeRequiredText(raw.fileName, 1, 255),
      fileType = normalizeRequiredText(raw.fileType, 1, 100),
      key = normalizeRequiredText(raw.requestKey, 8, 128);
    if (typeof raw.base64 !== 'string' || raw.base64.length > 14 * 1024 * 1024) sopFail('VALIDATION_FAILED');
    const bytes = Buffer.from(raw.base64 as string, 'base64');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.toString('base64') !== raw.base64)
      sopFail('VALIDATION_FAILED');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await requireSourceMaterials(this.db, this.ctx, taskId, true);
    const created: string[] = [];
    return createOnce(
      this.db,
      {
        actorId: this.ctx.userId,
        key,
        operation: 'SOP_SOURCE_UPLOAD',
        normalized: { taskId, fileName, fileType, sha256 },
      },
      async (tx) => {
        const ctx = await qualityActor(tx, this.ctx.userId),
          initial = await requireSourceMaterials(tx, ctx, taskId, true);
        await lockSopSource(tx, initial.sopInstance!);
        await tx.$queryRaw`SELECT id FROM sop_instance WHERE id=${initial.sopInstanceId} FOR UPDATE`;
        const task = await requireSourceMaterials(tx, ctx, taskId, true);
        if (task.sopInstance!.status !== 'ACTIVE' || !(await sopSourceActive(tx, task.sopInstance!)))
          sopFail('SOP_STATE_INVALID', 409);
        const root = path.resolve(process.cwd(), 'var/storage/sop-source-files');
        fs.mkdirSync(root, { recursive: true });
        const filePath = randomUUID(),
          stored = path.join(root, filePath);
        fs.writeFileSync(stored, bytes, { flag: 'wx' });
        created.push(stored);
        const row = await tx.sopSourceFile.create({
          data: {
            instanceId: task.sopInstanceId!,
            fileName,
            fileType,
            filePath,
            fileSize: bytes.length,
            sha256,
            createdBy: ctx.userId,
          },
        });
        await tx.operationLog.create({
          data: {
            userId: ctx.userId,
            action: 'SOP_SOURCE_FILE_UPLOADED',
            targetType: 'SOP_SOURCE_FILE',
            targetId: row.id,
            newValues: JSON.stringify({ taskId, instanceId: row.instanceId, sha256 }),
            ip: this.actor.ip,
          },
        });
        await new PrismaEventOutboxWriter().append(tx, {
          eventType: 'sop.task.changed',
          eventVersion: 1,
          objectType: 'SOP_TASK',
          objectId: taskId,
          operatorUserId: ctx.userId,
          organizationId: task.sopInstance!.templateVersion.template.organizationId,
          branchId: task.sopInstance!.templateVersion.template.organizationId,
          teamId: null,
          payload: { id: taskId, version: task.version, action: 'MATERIAL' },
          traceId: this.actor.requestId ?? row.id,
          occurredAt: new Date(),
        });
        return { id: row.id };
      },
      async (tx, id) => {
        await requireSourceMaterials(tx, await qualityActor(tx, this.ctx.userId), taskId, true);
        return { id };
      },
    ).catch(async (error) => {
      try {
        const rows = await this.db.sopSourceFile.findMany({
            where: { filePath: { in: created.map((f) => path.basename(f)) } },
            select: { filePath: true },
          }),
          kept = new Set(rows.map((r) => r.filePath));
        for (const stored of created)
          if (!kept.has(path.basename(stored)))
            try {
              fs.unlinkSync(stored);
            } catch {
              /* preserve original failure */
            }
      } catch {
        /* uncertain commit retains bytes */
      }
      throw error;
    });
  }
}
