// SPEC-011 Task 10: finance 应用服务装配（逐字仿 contract-factory / master-data-factory 模式）。
// 每次请求按 ctx 构造：actor 取自 ctx.state.user + ctx.ip（auditActor 与 master-data 同一来源），
// 授权上下文取 ctx.state.authorization（authorizationContext 中间件载入）。
// 四服务构造形态同 Task 5-9 冻结边界：(prisma, actor, authorizationContext) + 可选
// outbox（默认 PrismaEventOutboxWriter，此处不注入）；AnomalyService 纯读无 outbox；
// 本文件只做装配，不含任何业务逻辑。

import { Context } from 'egg';

import { createAuthenticationServices } from '../auth/authentication-factory';
import { AuthorizationContext } from '../authorization/authorization-service';
import { auditActor } from '../master-data/master-data-factory';
import { AnomalyService } from './anomaly-service';
import { CostService } from './cost-service';
import { InvoiceService } from './invoice-service';
import { RefundService } from './refund-service';

export function invoiceService(ctx: Context): InvoiceService {
  return new InvoiceService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function refundService(ctx: Context): RefundService {
  // Task 7 接线：注入 StepUpService 作为 refund.approve 的真实 MFA 重验 consumer
  // （可选第 5 参，仅 approve 在注入时强制消费 Step-Up 证明）。
  return new RefundService(
    ctx.prisma,
    auditActor(ctx),
    ctx.state.authorization as AuthorizationContext,
    undefined,
    createAuthenticationServices(ctx).stepUp,
  );
}

export function costService(ctx: Context): CostService {
  return new CostService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function anomalyService(ctx: Context): AnomalyService {
  return new AnomalyService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}
