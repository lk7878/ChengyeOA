// SPEC-009 Task 10: CRM 应用服务装配（仿 master-data-factory 模式）。
// 每次请求按 ctx 构造：actor 取自 ctx.state.user + ctx.ip（auditActor 与 master-data 同一来源），
// 授权上下文取 ctx.state.authorization（authorizationContext 中间件载入）。
// 本文件只做装配，不含任何业务逻辑；服务实现（lead/assignment/follow/appointment/customer）
// 为 Task 5-9 冻结边界，此处仅实例化。
// 注意：LeadAssignmentService.recycleOverdueLeads 是系统任务入口（无权限/范围校验），
// 刻意不从 controller 触达——lead-recycle-scanner 经 Task 9 事件 Worker 以系统 actor 调用。

import { Context } from 'egg';

import { AuthorizationContext } from '../authorization/authorization-service';
import { auditActor } from '../master-data/master-data-factory';
import { AppointmentService } from './appointment-service';
import { CustomerService } from './customer-service';
import { LeadAssignmentService } from './lead-assignment-service';
import { LeadFollowService } from './lead-follow-service';
import { LeadService } from './lead-service';

export function leadService(ctx: Context): LeadService {
  return new LeadService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function leadAssignmentService(ctx: Context): LeadAssignmentService {
  return new LeadAssignmentService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function leadFollowService(ctx: Context): LeadFollowService {
  return new LeadFollowService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function appointmentService(ctx: Context): AppointmentService {
  return new AppointmentService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function customerService(ctx: Context): CustomerService {
  return new CustomerService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}
