// SPEC-037 Task 2: performance 应用服务装配（仿 case-factory 模式）。
// 每次请求按 ctx 构造：actor 取自 ctx.state.user + ctx.ip，授权上下文取 ctx.state.authorization。
// 构造形态：(prisma, actor, authorizationContext)。本文件只做装配，不含任何业务逻辑。

import { Context } from 'egg';

import { AuthorizationContext } from '../authorization/authorization-service';
import { auditActor } from '../master-data/master-data-factory';
import { PerformanceService } from './performance-service';

export function performanceService(ctx: Context): PerformanceService {
  return new PerformanceService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}
