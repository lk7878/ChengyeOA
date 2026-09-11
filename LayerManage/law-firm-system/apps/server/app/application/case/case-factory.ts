// SPEC-033 Task 3: case 应用服务装配（仿 approval-factory 模式）。
// 每次请求按 ctx 构造：actor 取自 ctx.state.user + ctx.ip，授权上下文取 ctx.state.authorization。
// 三服务构造形态：(prisma, actor, authorizationContext)。本文件只做装配，不含任何业务逻辑。

import { Context } from 'egg';

import { AuthorizationContext } from '../authorization/authorization-service';
import { auditActor } from '../master-data/master-data-factory';
import { CaseCommunicationService } from './case-communication-service';
import { CaseFileService } from './case-file-service';
import { CaseService } from './case-service';
import { CaseTaskService } from './case-task-service';

export function caseService(ctx: Context): CaseService {
  return new CaseService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function caseTaskService(ctx: Context): CaseTaskService {
  return new CaseTaskService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function caseCommunicationService(ctx: Context): CaseCommunicationService {
  return new CaseCommunicationService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function caseFileService(ctx: Context): CaseFileService {
  return new CaseFileService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}
