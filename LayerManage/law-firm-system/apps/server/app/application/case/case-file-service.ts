import { requireCaseAccess } from './case-scope';
// SPEC-042 Task 2: case-file-service —— 案件文件/证据台账（upload/list/download/remove）。
// 形态镜像 case-service：3 参构造 (prisma, actor, authorizationContext)；requireAction 每公开
// 方法第一行；assertExactKeys 入参白名单；同事务 OperationLog 审计。
// 存储：base64 上传 → 解码落盘 var/storage/case-files/<uuid>（UUID 文件名防路径穿越，
// fileName 仅存元数据）；下载读盘返回 base64 信封。大小上限 10MB。

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { CASE_ERROR_CODES, CaseError } from '../../domain/case/case-errors';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import { CaseFileDownloadView, CaseFileView, UploadCaseFileInput, projectCaseFile, projectCaseFileDownload } from './case-types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
// 大小上限 10MB（解码后字节数；base64 长度 ≈ 字节 ×4/3）。
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function storageRoot(): string {
  const root = path.join(process.cwd(), 'var', 'storage', 'case-files');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export class CaseFileService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  /** 上传文件：case.file.manage → 案件存在且非终态 → base64 解码落盘（UUID 文件名）→ DB 记录 + 审计。 */
  async upload(caseId: string, input: UploadCaseFileInput): Promise<CaseFileView> {
    this.authorization.requireAction(this.authorizationContext, 'case.file.manage');
    const id = normalizeRequiredText(caseId, 1, 100);
    assertExactKeys(input, ['fileName', 'fileType', 'base64']);
    const fileName = normalizeRequiredText(input.fileName, 1, 255);
    const fileType = normalizeRequiredText(input.fileType, 1, 100);
    const buffer = decodeBase64(input.base64);

    const existing = await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.file.manage');
    if (!existing) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');
    if (existing.status === 'CLOSED' || existing.status === 'ARCHIVED') {
      throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
    }

    const storedFileName = `${randomUUID()}`;
    const storedPath = path.join(storageRoot(), storedFileName);
    fs.writeFileSync(storedPath, buffer);

    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${id} FOR UPDATE`;
        const parent = await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.file.manage', tx);
        if (['CLOSED', 'ARCHIVED'].includes(parent.status)) throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
        const created = await tx.caseFile.create({ data: {
          caseId: id, fileName, fileType, filePath: storedFileName, fileSize: buffer.length,
          uploadedBy: this.actor.actorUserId,
        } });
        await tx.case.update({ where: { id }, data: { version: { increment: 1 }, updatedBy: this.actor.actorUserId } });
        await tx.operationLog.create({ data: {
          userId: this.actor.actorUserId, action: 'CASE_FILE_UPLOAD', targetType: 'CASE_FILE', targetId: created.id,
          newValues: JSON.stringify({ caseId: id, fileId: created.id, fileName, fileSize: buffer.length }), ip: this.actor.ip,
        } });
        return projectCaseFile(created);
      });
    } catch (error) {
      try { fs.unlinkSync(storedPath); } catch { /* Preserve the original transaction error. */ }
      throw error;
    }
  }

  /** 文件列表：case.file.read → 案件存在（404）→ 分页 createdAt DESC。 */
  async list(caseId: string, query: { page?: number; pageSize?: number }): Promise<{ list: CaseFileView[]; page: number; pageSize: number; total: number }> {
    this.authorization.requireAction(this.authorizationContext, 'case.file.read');
    const id = normalizeRequiredText(caseId, 1, 100);
    const rawPage = query.page;
    const rawPageSize = query.pageSize;
    assertExactKeys(query, ['page', 'pageSize']);
    const page = rawPage === undefined ? 1 : rawPage;
    const pageSize = rawPageSize === undefined ? DEFAULT_PAGE_SIZE : rawPageSize;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    const existing = await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.file.read');
    if (!existing) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');

    const where = { caseId: id };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.caseFile.count({ where }),
      this.prisma.caseFile.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { list: rows.map(row => projectCaseFile(row)), page, pageSize, total };
  }

  /** 文件下载：case.file.read → 记录 + 案件存在（404）→ 读盘返回 base64 信封。 */
  async download(fileId: string): Promise<CaseFileDownloadView> {
    this.authorization.requireAction(this.authorizationContext, 'case.file.read');
    const id = normalizeRequiredText(fileId, 1, 100);
    const record = await this.prisma.caseFile.findUnique({ where: { id } });
    if (!record) throw new CaseError(CASE_ERROR_CODES.CASE_FILE_NOT_FOUND, 404, 'case file not found');

    await requireCaseAccess(this.prisma, this.authorizationContext, record.caseId, 'case.file.read');
    const storedPath = path.join(storageRoot(), record.filePath);
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(storedPath);
    } catch {
      throw new CaseError(CASE_ERROR_CODES.CASE_FILE_NOT_FOUND, 404, 'case file not found');
    }
    return projectCaseFileDownload(record, buffer.toString('base64'));
  }

  /** 删除文件：case.file.manage → 记录存在（404）→ 删盘 + DB 记录 + 审计。 */
  async remove(fileId: string): Promise<CaseFileView> {
    this.authorization.requireAction(this.authorizationContext, 'case.file.manage');
    const id = normalizeRequiredText(fileId, 1, 100);
    const target = await this.prisma.caseFile.findUnique({ where: { id } });
    if (!target) throw new CaseError(CASE_ERROR_CODES.CASE_FILE_NOT_FOUND, 404, 'case file not found');
    const record = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${target.caseId} FOR UPDATE`;
      const parent = await requireCaseAccess(this.prisma, this.authorizationContext, target.caseId, 'case.file.manage', tx);
      if (['CLOSED', 'ARCHIVED'].includes(parent.status)) throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
      const current = await tx.caseFile.findUnique({ where: { id } });
      if (!current) throw new CaseError(CASE_ERROR_CODES.CASE_FILE_NOT_FOUND, 404, 'case file not found');
      if (await tx.issueAttachment.count({where:{fileId:id}}) || await tx.submissionAttachment.count({where:{fileId:id}})) throw new MasterDataError('SOP_MATERIAL_REFERENCED',409);
      await tx.caseFile.delete({ where: { id } });
      await tx.case.update({ where: { id: parent.id }, data: { version: { increment: 1 }, updatedBy: this.actor.actorUserId } });
      await tx.operationLog.create({ data: {
        userId: this.actor.actorUserId, action: 'CASE_FILE_DELETE', targetType: 'CASE_FILE', targetId: id,
        newValues: JSON.stringify({ caseId: current.caseId, fileId: id, fileName: current.fileName }), ip: this.actor.ip,
      } });
      return current;
    });
    try { fs.unlinkSync(path.join(storageRoot(), record.filePath)); } catch { /* A missing disk file does not restore an already committed row. */ }
    return projectCaseFile(record);
  }

}

/** base64 解码校验：非法 base64 / 超限（>10MB）→ 400 CASE_FILE_INVALID。 */
function decodeBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CaseError(CASE_ERROR_CODES.CASE_FILE_INVALID, 400, 'base64 payload is required');
  }
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length === 0) {
    throw new CaseError(CASE_ERROR_CODES.CASE_FILE_INVALID, 400, 'base64 payload is empty');
  }
  // 拒绝明显非 base64 的载荷（解码回退——Buffer.from 宽容，用正则预检）。
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value)) {
    throw new CaseError(CASE_ERROR_CODES.CASE_FILE_INVALID, 400, 'base64 payload is malformed');
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw new CaseError(CASE_ERROR_CODES.CASE_FILE_INVALID, 400, 'file exceeds 10MB limit');
  }
  return buffer;
}
