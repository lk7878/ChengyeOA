import { assertRegistrationEditable } from './registration-policy';
import { requireCaseAccess } from './case-scope';
// SPEC-033 Task 2: case-task-service —— 案件任务状态机（PENDING → IN_PROGRESS → COMPLETED）。
// 同 case-service 形态（3 参构造 + requireAction + assertExactKeys + 审计）。

import { Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { CASE_ERROR_CODES, CaseError } from '../../domain/case/case-errors';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import {
  CASE_TASK_NODE_TYPES,
  CASE_TASK_STATUSES,
  CreateCaseTaskInput,
  UpdateCaseTaskInput,
  projectCaseTask,
} from './case-types';

export class CaseTaskService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  /** 新建任务：case.task.manage → 案件存在且非终态 → PENDING + 审计。 */
  async createTask(caseId: string, input: CreateCaseTaskInput) {
    this.authorization.requireAction(this.authorizationContext, 'case.task.manage');
    const id = normalizeRequiredText(caseId, 1, 100);
    assertExactKeys(input, ['name', 'nodeType', 'dueDate', 'remark']);
    const name = normalizeRequiredText(input.name, 1, 100);
    const nodeType = normalizeAllowedValue(input.nodeType, CASE_TASK_NODE_TYPES);
    const dueDate = input.dueDate === undefined ? null : parseIsoDate(input.dueDate);
    const remark = normalizeOptionalText(input.remark, 500);

    const existing = await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.task.manage');
    if (!existing) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');
    if (existing.status === 'CLOSED' || existing.status === 'ARCHIVED') {
      throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
    }

    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${id} FOR UPDATE`;
      await assertRegistrationEditable(tx, id);
      const currentCase = await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.task.manage', tx);
      if (['CLOSED', 'ARCHIVED'].includes(currentCase.status)) throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
      await tx.case.update({ where: { id }, data: { version: { increment: 1 }, updatedBy: this.actor.actorUserId } });
      const task = await tx.caseTask.create({
        data: { caseId: id, name, nodeType, dueDate, remark, createdBy: this.actor.actorUserId },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CASE_TASK_CREATE',
          targetType: 'CASE_TASK',
          targetId: task.id,
          newValues: JSON.stringify({ caseId: id, taskId: task.id, name, nodeType }),
          ip: this.actor.ip,
        },
      });
      return projectCaseTask(task);
    });
  }

  /** 更新任务：case.task.manage → 状态翻转（PENDING→IN_PROGRESS→COMPLETED；非法翻转 409）+ 审计。 */
  async updateTask(caseId: string, taskId: string, input: UpdateCaseTaskInput) {
    this.authorization.requireAction(this.authorizationContext, 'case.task.manage');
    const id = normalizeRequiredText(caseId, 1, 100);
    const tid = normalizeRequiredText(taskId, 1, 100);
    assertExactKeys(input, ['status', 'remark']);
    const nextStatus = normalizeAllowedValue(input.status, CASE_TASK_STATUSES);
    const remark = normalizeOptionalText(input.remark, 500);

    await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.task.manage');
    const task = await this.prisma.caseTask.findFirst({ where: { id: tid, caseId: id } });
    if (!task) throw new CaseError(CASE_ERROR_CODES.CASE_TASK_NOT_FOUND, 404, 'case task not found');
    if (task.sopInstanceId) throw new MasterDataError('SOP_TASK_ACTION_REQUIRED', 409);
    assertTaskTransition(task.status, nextStatus);

    const data: Prisma.CaseTaskUpdateManyMutationInput = {
      status: nextStatus,
      updatedBy: this.actor.actorUserId,
      version: { increment: 1 },
      ...(remark !== null && remark !== undefined ? { remark } : {}),
      ...(nextStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
    };
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${id} FOR UPDATE`;
      await assertRegistrationEditable(tx, id);
      const currentCase = await requireCaseAccess(this.prisma, this.authorizationContext, id, 'case.task.manage', tx);
      if (['CLOSED', 'ARCHIVED'].includes(currentCase.status)) throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
      await tx.case.update({ where: { id }, data: { version: { increment: 1 }, updatedBy: this.actor.actorUserId } });
      const currentTask = await tx.caseTask.findFirst({ where: { id: tid, caseId: id } });
      if (!currentTask) throw new CaseError(CASE_ERROR_CODES.CASE_TASK_NOT_FOUND, 404, 'case task not found');
      if (currentTask.sopInstanceId) throw new MasterDataError('SOP_TASK_ACTION_REQUIRED', 409);
      assertTaskTransition(currentTask.status, nextStatus);
      await tx.caseTask.updateMany({ where: { id: tid, caseId: id }, data });
      const row = await tx.caseTask.findUniqueOrThrow({ where: { id: tid } });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CASE_TASK_UPDATE',
          targetType: 'CASE_TASK',
          targetId: row.id,
          newValues: JSON.stringify({ caseId: id, taskId: row.id, fromStatus: task.status, toStatus: nextStatus }),
          ip: this.actor.ip,
        },
      });
      return projectCaseTask(row);
    });
  }
}

/** 任务状态翻转校验：PENDING→IN_PROGRESS / IN_PROGRESS→COMPLETED；其余非法（终态不翻转）。 */
function assertTaskTransition(from: string, to: string): void {
  const valid = (from === 'PENDING' && to === 'IN_PROGRESS')
    || (from === 'IN_PROGRESS' && to === 'COMPLETED');
  if (!valid) {
    throw new CaseError(CASE_ERROR_CODES.CASE_TASK_STATE_INVALID, 409, 'invalid case task state transition');
  }
}

/** ISO 日期解析：非法 → 400。 */
function parseIsoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new MasterDataError('VALIDATION_FAILED', 400);
  return parsed;
}
