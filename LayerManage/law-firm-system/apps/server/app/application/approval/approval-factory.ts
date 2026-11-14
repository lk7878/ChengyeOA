// SPEC-013 Task 6: approval 应用服务装配（逐字仿 contract-factory / finance-factory 模式）。
// 每次请求按 ctx 构造：actor 取自 ctx.state.user + ctx.ip（auditActor 与 master-data 同一来源），
// 授权上下文取 ctx.state.authorization（authorizationContext 中间件载入）。
// 两服务构造形态同 Task 5 冻结边界：(prisma, actor, authorizationContext) + 可选
// outbox（默认 PrismaEventOutboxWriter，此处不注入）；本文件只做装配，不含任何业务逻辑。

import { Context } from 'egg';

import { AuthorizationContext } from '../authorization/authorization-service';
import { auditActor } from '../master-data/master-data-factory';
import { ApprovalDefinitionService } from './approval-definition-service';
import { ApprovalInstanceService } from './approval-instance-service';

export function approvalDefinitionService(ctx: Context): ApprovalDefinitionService {
  return new ApprovalDefinitionService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function approvalInstanceService(ctx: Context): ApprovalInstanceService {
  return new ApprovalInstanceService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}
