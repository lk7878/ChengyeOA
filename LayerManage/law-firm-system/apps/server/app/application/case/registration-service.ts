import { sealReviewers } from './seal-service';
import { numberingOptions, numberPrefix } from './registration-number';
import { PrismaClient, Prisma } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { AuthorizationContextLoader } from '../authorization/authorization-context-loader';
import { CollaborationService } from '../collaboration/collaboration-service';
import { worksheetContext } from '../collaboration/worksheet-business-grants';
import { WorkflowService } from '../workflow/workflow-service';
import { check } from '../../domain/workflow/schema';
import { requireCaseAccess } from './case-scope';
import { isCaseRegistrar } from './registration-policy';
import { notifyDeliveryChange } from '../collaboration/delivery-change';

export class CaseRegistrationService {
  constructor(readonly db: PrismaClient, readonly actor: AuthorizationContext) {}
  private async access(tableId: string, caseId: string, write = false, tx: Prisma.TransactionClient = this.db) {
    const actor = await worksheetContext(tx, await new AuthorizationContextLoader(tx).load(this.actor.userId), tableId);
    const table = await new CollaborationService(this.db, actor).tableAccess(tableId, tx, write ? 2 : 1);
    check(table.table.source === 'CASES', '请选择案件管理表', 400);
    const row = await requireCaseAccess(this.db, actor, caseId, write ? 'case.update' : 'case.read', tx, { includeWorksheetLead: true });
    // Table-level and record-level authorization both apply.
    const record = await new CollaborationService(this.db, actor).record(tableId, caseId);
    if (write) {
      check(record.record.writable !== false, '没有此案件的登记编辑权限', 403);
      check(actor.permissionCodes.includes('approval.apply') && actor.permissionCodes.includes('approval.read'), '没有提交审批权限', 403);
    }
    return { actor, row, record, fields: table.fields };
  }
  private async reviewers(submitter: string, tableId: string, caseId: string) {
    const now = new Date();
    const users = await this.db.user.findMany({ where: {
      id: { not: submitter }, status: 'ENABLED',
      userRoles: { some: { revokedAt: null, validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }], role: { code: 'MANAGER', status: 'ENABLED' } } },
    }, select: { id: true, username: true, employee: { select: { name: true } } }, orderBy: { username: 'asc' } });
    const result: { id: string; label: string }[] = [];
    for (const u of users) {
      const actor = await new AuthorizationContextLoader(this.db).load(u.id).catch((): null => null);
      if (actor && actor.permissionCodes.includes('approval.read') && await isCaseRegistrar(this.db, actor)) {
        try {
          const scoped = await worksheetContext(this.db, actor, tableId);
          await requireCaseAccess(this.db, scoped, caseId, 'case.read', this.db, { includeWorksheetLead: true });
          await new CollaborationService(this.db, scoped).record(tableId, caseId);
          result.push({ id: u.id, label: `${u.employee?.name || u.username}（${u.username}）` });
        } catch (error) {
          if (![403, 404].includes((error as { status?: number }).status ?? 0)) throw error;
        }
      }
    }
    return result;
  }
  async detail(tableId: string, caseId: string) {
    const { actor, row, record } = await this.access(tableId, caseId);
    const history = await this.db.caseRegistration.findMany({ where: { caseId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
    const pending = history.some(r => r.status === 'PENDING');
    return { caseId, caseNo: row.caseNo, title: row.title, version: record.record.version,
      canSubmit: row.status === 'PENDING' && !pending && record.record.writable !== false && actor.permissionCodes.includes('case.update') && actor.permissionCodes.includes('approval.apply'),
      history: history.map(r => ({ id: r.id, status: r.status, createdAt: r.createdAt, workflowInstanceId: r.workflowInstanceId })),
      reviewers: await this.reviewers(actor.userId, tableId, caseId),
      needsNumber: !row.contractId, numberingOptions, sealReviewers: await sealReviewers(this.db),
    };
  }
  async submit(tableId: string, caseId: string, input: { version: number; reviewerId: string; numberCode?: string; sealReviewerId?: string }) {
    check(input && Object.keys(input).every(k => ['version', 'reviewerId', 'numberCode', 'sealReviewerId'].includes(k)) && Number.isInteger(input.version), '登记提交参数无效');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "case" WHERE id=${caseId} FOR UPDATE`;
      const { actor, row, record, fields } = await this.access(tableId, caseId, true, tx);
      check(record.record.version === input.version, '案件已被修改，请刷新后核对再提交', 409);
      check(row.status === 'PENDING', '仅待受理案件可提交登记审批', 409);
      check(!await tx.caseRegistration.count({ where: { caseId, status: 'PENDING' } }), '该案件已有登记申请待审批，请勿重复提交', 409);
      check((await this.reviewers(actor.userId, tableId, caseId)).some(u => u.id === input.reviewerId), '请选择有效的案件管理员', 403);
      check((await sealReviewers(tx)).some(u => u.id === input.sealReviewerId), '请选择有效的印章管理员', 403);
      if (!row.contractId) numberPrefix(input.numberCode || '', new Date().getFullYear());
      const values = record.record.values as Record<string, unknown>;
      const registration = fields.filter(f => f.id in values).map(f => `${f.name}：${typeof values[f.id] === 'object' ? JSON.stringify(values[f.id]) : String((record.record as { displayValues?: Record<string, unknown> }).displayValues?.[f.id] ?? values[f.id] ?? '')}`).join('\n');
      for (const field of fields.filter(f => f.required && f.id in values)) {
        const value = values[field.id];
        check(value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0), `请先填写${field.name}`);
      }
      await tx.case.update({ where: { id: caseId }, data: { registrationRequired: true } });
      const request = await tx.caseRegistration.create({ data: { caseId, tableId, caseVersion: row.version, recordVersion: record.record.version, submittedBy: actor.userId, reviewerId: input.reviewerId, numberCode: row.contractId ? null : input.numberCode, sealReviewerId: input.sealReviewerId } });
      const workflowInstanceId = await new WorkflowService(this.db, actor).startManaged(tx, {
        businessType: 'CASE_REGISTRATION', sourceId: request.id,
        title: `案件登记审批 · ${row.caseNo}`, reviewerId: input.reviewerId,
        content: { caseNo: row.caseNo, title: row.title, registration: registration + '\n合同编号类别：' + (row.contractId ? '沿用关联合同' : input.numberCode) },
        fields: [{ key: 'caseNo', label: '案件编号', type: 'text' }, { key: 'title', label: '案件名称', type: 'text' }, { key: 'registration', label: '提交的案件登记信息', type: 'textarea', maxLength: 20000 }],
      });
      await notifyDeliveryChange(tx, actor.userId, caseId);
      return { workflowInstanceId };
    }, { timeout: 30000 });
  }
}
