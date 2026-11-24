import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma, PrismaClient, CaseRegistration } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { check } from '../../domain/workflow/schema';
import { assertExactKeys } from '../../domain/master-data/master-data-validation';
import { allocateRegistrationNumber, lockContractNumbers, validateRegistrationNumber } from './registration-number';
import { prepareAttachments, persistAttachments, cleanAttachments } from './case-intake';
import { notifyDeliveryChange } from '../collaboration/delivery-change';

type DB = PrismaClient | Prisma.TransactionClient;
export async function sealReviewers(db: DB) {
  const now = new Date();
  const users = await db.user.findMany({ where: { status: 'ENABLED', userRoles: { some: {
    revokedAt: null, validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    role: { status: 'ENABLED', OR: [{code:'SYSTEM_SUPER_ADMIN'}, {permissions: { some: { permission: { code: 'case.seal.manage', status: 'ENABLED' } } }}] },
  } } }, select: { id: true, username: true, employee: { select: { name: true } } }, orderBy: { username: 'asc' } });
  return users.map(u => ({ id: u.id, label: `${u.employee?.name || u.username}（${u.username}）` }));
}

export async function createSealRequest(tx: Prisma.TransactionClient, request: CaseRegistration, actorId: string) {
  const row = await tx.case.findUniqueOrThrow({ where: { id: request.caseId }, include: { files: true, contract: true } });
  // Historical pending approvals created before this workflow retain their previous behavior.
  if (!request.sealReviewerId) return;
  check((await sealReviewers(tx)).some(u => u.id === request.sealReviewerId), '印章管理员已停用或权限已撤销，请退回后重新选择', 409);
  const intake = (row.intakeData ?? {}) as Record<string, string>;
  let contract = row.contract;
  if (!contract) {
    const contractNo = await allocateRegistrationNumber(tx, row.id, request.numberCode || '');
    contract = await tx.contract.create({ data: { contractNo, contractType: 'FORMAL', title: row.title,
      customerId: row.customerId, sourceType: 'CASE', sourceId: row.id, branchId: row.branchId,
      amount: row.fee ?? new Prisma.Decimal(intake.fixedAgencyFee || intake.baseAgencyFee || '0'), status: 'PENDING_SIGN',
      createdBy: request.submittedBy, approvedBy: actorId, approvedAt: new Date(), submittedBy: request.submittedBy,
      submittedAt: request.createdAt, terms: JSON.stringify(intake),
      signDate: intake.signedDate ? new Date(intake.signedDate) : null,
    } });
    await tx.case.update({ where: { id: row.id }, data: { contractId: contract.id,
      intakeData: { ...intake, contractNumber: contractNo } } });
    // The applicant receives access only to the contract generated from this registration.
    await tx.contractReadGrant.create({ data: { userId: request.submittedBy, contractId: contract.id } });
  }
  const workflow = await tx.workflowInstance.findUniqueOrThrow({ where: { id: request.workflowInstanceId! } });
  const snapshot = { registration: workflow.content, intake, caseNo: row.caseNo, title: row.title,
    files: row.files.map(f => ({ id: f.id, fileName: f.fileName, fileSize: f.fileSize, category: f.category })) };
  const task = await tx.caseSealRequest.create({ data: { caseId: row.id, contractId: contract.id, registrationId: request.id,
    assigneeId: request.sealReviewerId, submittedBy: request.submittedBy, snapshot: snapshot as Prisma.InputJsonValue } });
  await tx.notification.create({ data: { userId: request.sealReviewerId, type: 'TASK', title: '案件合同待核对盖章',
    content: `${row.caseNo} · ${contract.contractNo}`, relatedId: task.id, relatedType: 'CASE_SEAL',
    routeUrl: `/case-seals?request=${task.id}`, deduplicationKey: `case-seal:${task.id}` } });
  await tx.operationLog.create({ data: { userId: actorId, action: 'CASE_CONTRACT_ISSUED', targetType: 'CASE', targetId: row.id,
    newValues: JSON.stringify({ contractId: contract.id, contractNo: contract.contractNo, sealRequestId: task.id }) } });
}

export class CaseSealService {
  constructor(readonly db: PrismaClient, readonly actor: AuthorizationContext) {}
  private async auth(db: DB = this.db) {
    const fresh = await new AuthorizationContextLoader(db).load(this.actor.userId);
    check(fresh.isSystemSuperAdmin || fresh.permissionCodes.includes('case.seal.manage'), '没有合同核对盖章权限', 403);
    return fresh;
  }
  private async access(id: string, db: DB = this.db) {
    const actor = await this.auth(db);
    const row = await db.caseSealRequest.findFirst({ where: { id, case: { deletedAt: null }, contract: { deletedAt: null },
      ...(actor.isSystemSuperAdmin ? {} : { assigneeId: actor.userId }) }, include: { case: true, contract: true } });
    check(row, '盖章待办不存在或无权访问', 404);
    return row;
  }
  async list(query: { page?: unknown; keyword?: unknown }) {
    const actor = await this.auth();
    const page = Number(query.page ?? 1);
    check(Number.isSafeInteger(page) && page > 0, '页码无效');
    const keyword = String(query.keyword || '').slice(0, 100);
    const where: Prisma.CaseSealRequestWhereInput = { case: { deletedAt: null }, contract: { deletedAt: null },
      ...(actor.isSystemSuperAdmin ? {} : { assigneeId: actor.userId }),
      ...(keyword ? { OR: [{ case: { caseNo: { contains: keyword } } }, { case: { title: { contains: keyword } } }, { contract: { contractNo: { contains: keyword } } }] } : {}) };
    const [total, items] = await Promise.all([this.db.caseSealRequest.count({ where }), this.db.caseSealRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 20,
      select: { id: true, status: true, createdAt: true, case: { select: { caseNo: true, title: true } }, contract: { select: { contractNo: true } } } })]);
    return { items, total };
  }
  async detail(id: string) {
    const row = await this.access(id);
    const changes = await this.db.operationLog.findMany({ where: { targetId: id, targetType: 'CASE_SEAL' }, orderBy: { createdAt: 'asc' }, select: { action: true, oldValues: true, newValues: true, createdAt: true } });
    return { id: row.id, version: row.version, status: row.status, contractNo: row.contract.contractNo, snapshot: row.snapshot,
      stampedAt: row.stampedAt, stampedFiles: await this.db.caseFile.findMany({ where: { caseId: row.caseId, id: { in: row.stampedFileIds as string[] } }, select: { id: true, fileName: true } }), changes };
  }
  async correctNumber(id: string, input: { version: number; number: string; reason: string }) {
    assertExactKeys(input, ['version', 'number', 'reason']);
    const number = validateRegistrationNumber(input.number);
    check(Number.isInteger(input.version) && typeof input.reason === 'string' && input.reason.trim().length > 0 && input.reason.length <= 500, '请填写编号更正原因');
    return this.db.$transaction(async tx => {
      const initial = await this.access(id, tx);
      await tx.$queryRaw`SELECT id FROM "case" WHERE id=${initial.caseId} FOR UPDATE`;
      const row = await this.access(id, tx);
      check(row.status === 'PENDING' && row.version === input.version, '待办已变化或已盖章，请刷新后核对', 409);
      check(number !== row.contract.contractNo, '编号未发生变化');
      await lockContractNumbers(tx);
      const used = await tx.contract.findUnique({ where: { contractNo: number } });
      const reserved = await tx.caseContractNumber.findUnique({ where: { number } });
      check(!used && (!reserved || reserved.caseId === row.caseId), '该合同编号已使用或已保留，不能重复使用', 409);
      // Preserve both old and corrected numbers so a correction cannot silently recycle a number.
      for (const value of [row.contract.contractNo, number]) await tx.caseContractNumber.upsert({ where: { number: value }, create: { number: value, caseId: row.caseId }, update: {} });
      await tx.contract.update({ where: { id: row.contractId }, data: { contractNo: number, version: { increment: 1 }, updatedBy: this.actor.userId } });
      await tx.case.update({ where: { id: row.caseId }, data: { intakeData: { ...(row.case.intakeData as Prisma.JsonObject), contractNumber: number }, version: { increment: 1 }, updatedBy: this.actor.userId } });
      await tx.caseSealRequest.update({ where: { id }, data: { version: { increment: 1 } } });
      await tx.operationLog.create({ data: { userId: this.actor.userId, targetType: 'CASE_SEAL', targetId: id, action: 'CASE_CONTRACT_NUMBER_CORRECT',
        oldValues: JSON.stringify({ number: row.contract.contractNo }), newValues: JSON.stringify({ number, reason: input.reason.trim() }) } });
      await notifyDeliveryChange(tx, row.submittedBy, row.caseId);
      return { saved: true };
    });
  }
  async stamp(id: string, input: { version: number; attachments: unknown }) {
    assertExactKeys(input, ['version', 'attachments']);
    await this.access(id);
    check(Number.isInteger(input.version), '版本无效');
    const files = prepareAttachments(input.attachments);
    check(files.length > 0 && files.every(f => f.category === '合同附件'), '确认已盖章前必须上传盖章合同');
    try {
      persistAttachments(files);
      return await this.db.$transaction(async tx => {
        const initial = await this.access(id, tx);
        await tx.$queryRaw`SELECT id FROM "case" WHERE id=${initial.caseId} FOR UPDATE`;
        const row = await this.access(id, tx);
        check(row.status === 'PENDING' && row.version === input.version, '待办已变化或已盖章，请刷新', 409);
        check(['ACCEPTED','PROCESSING'].includes(row.case.status), '当前案件状态不允许盖章', 409);
        const ids: string[] = [];
        for (const file of files) {
          const saved = await tx.caseFile.create({ data: { caseId: row.caseId, fileName: file.fileName, fileType: file.fileType,
            fileSize: file.buffer.length, filePath: file.filePath, category: '合同附件', uploadedBy: this.actor.userId } });
          ids.push(saved.id);
        }
        await tx.caseSealRequest.update({ where: { id }, data: { status: 'STAMPED', stampedBy: this.actor.userId, stampedAt: new Date(), stampedFileIds: ids, version: { increment: 1 } } });
        if (row.contract.status === 'PENDING_SIGN') await tx.contract.update({ where: { id: row.contractId }, data: { status: 'SIGNED', version: { increment: 1 }, updatedBy: this.actor.userId } });
        await tx.case.update({ where: { id: row.caseId }, data: { version: { increment: 1 }, updatedBy: this.actor.userId } });
        await tx.operationLog.create({ data: { userId: this.actor.userId, action: 'CASE_CONTRACT_STAMPED', targetType: 'CASE_SEAL', targetId: id, newValues: JSON.stringify({ contractNo: row.contract.contractNo, fileIds: ids }) } });
        await tx.notification.create({ data: { userId: row.submittedBy, type: 'TASK', title: '案件合同已盖章', content: row.contract.contractNo, relatedId: id, relatedType: 'CASE_SEAL', routeUrl: '/cases', deduplicationKey: `case-stamped:${id}` } });
        await notifyDeliveryChange(tx, row.submittedBy, row.caseId);
        return { saved: true };
      });
    } catch (e) { cleanAttachments(files); throw e; }
  }
  async file(id: string, fileId: string) {
    const row = await this.access(id);
    const snapshot = row.snapshot as { files?: { id: string }[] };
    check([...(snapshot.files || []).map(f => f.id), ...row.stampedFileIds as string[]].includes(fileId), '文件不属于此盖章待办', 404);
    const file = await this.db.caseFile.findFirst({ where: { id: fileId, caseId: row.caseId } });
    check(file && path.basename(file.filePath) === file.filePath, '文件不存在', 404);
    const buffer = await fs.readFile(path.join(process.cwd(), 'var/storage/case-files', file.filePath));
    return { fileName: file.fileName, fileType: file.fileType, base64: buffer.toString('base64') };
  }
}
