// SPEC-010 Task 10: contract 应用服务装配（仿 crm-factory / master-data-factory 模式）。
// 每次请求按 ctx 构造：actor 取自 ctx.state.user + ctx.ip（auditActor 与 master-data 同一来源），
// 授权上下文取 ctx.state.authorization（authorizationContext 中间件载入）。
// 三服务构造形态同模板（Task 6-9 冻结边界）：(prisma, actor, authorizationContext) + 可选
// outbox（默认 PrismaEventOutboxWriter，此处不注入）；本文件只做装配，不含任何业务逻辑。

import { Context } from 'egg';

import { AuthorizationContext } from '../authorization/authorization-service';
import { auditActor } from '../master-data/master-data-factory';
import { ContractService } from './contract-service';
import { NegotiationService } from './negotiation-service';
import { ReceivableService } from './receivable-service';

export function negotiationService(ctx: Context): NegotiationService {
  return new NegotiationService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function contractService(ctx: Context): ContractService {
  return new ContractService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function receivableService(ctx: Context): ReceivableService {
  return new ReceivableService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}
