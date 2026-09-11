// SPEC-033 Task 2: case-communication-service —— 案件沟通记录（create）。
// 同 case-service 形态（3 参构造 + requireAction + assertExactKeys + 审计）。

import { PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { CASE_ERROR_CODES, CaseError } from '../../domain/case/case-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import { CASE_COMMUNICATION_TYPES, CreateCommunicationInput, projectCommunication } from './case-types';

export class CaseCommunicationService {
  private readonly authorization: AuthorizationService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
  }

  /** 记录沟通：case.communication.create → 案件存在且非终态 → type 枚举 + content 必填 + isKey + 审计。 */
  async createCommunication(caseId: string, input: CreateCommunicationInput) {
    this.authorization.requireAction(this.authorizationContext, 'case.communication.create');
    const id = normalizeRequiredText(caseId, 1, 100);
    assertExactKeys(input, ['type', 'content', 'isKey']);
    const type = normalizeAllowedValue(input.type, CASE_COMMUNICATION_TYPES);
    const content = normalizeRequiredText(input.content, 1, 2000);
    const isKey = input.isKey ?? false;

    const existing = await this.prisma.case.findFirst({ where: { id } });
    if (!existing) throw new CaseError(CASE_ERROR_CODES.CASE_NOT_FOUND, 404, 'case not found');
    if (existing.status === 'CLOSED' || existing.status === 'ARCHIVED') {
      throw new CaseError(CASE_ERROR_CODES.CASE_STATE_INVALID, 409, 'case is already closed');
    }

    return this.prisma.$transaction(async tx => {
      const communication = await tx.communication.create({
        data: { caseId: id, type, content, isKey, createdBy: this.actor.actorUserId },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CASE_COMMUNICATION_CREATE',
          targetType: 'CASE_COMMUNICATION',
          targetId: communication.id,
          newValues: JSON.stringify({ caseId: id, communicationId: communication.id, type, isKey }),
          ip: this.actor.ip,
        },
      });
      return projectCommunication(communication);
    });
  }
}
