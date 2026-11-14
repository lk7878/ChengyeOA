import { Context } from 'egg';
import { AuthorizationContext } from '../authorization/authorization-service';
import { EmployeeAccountBindingService } from './employee-account-binding-service';
import { EmployeeAssignmentService } from './employee-assignment-service';
import { EmployeeService } from './employee-service';
import { EmployeeReportingLineService } from './employee-reporting-line-service';
import { AuditActor } from './master-data-types';
import { ProfessionalTeamService } from './professional-team-service';
import { OrganizationService } from './organization-service';
import { PositionService } from './position-service';

export function auditActor(ctx: Context): AuditActor {
  return { actorUserId: ctx.state.user.userId, ip: ctx.ip };
}

export function employeeService(ctx: Context): EmployeeService {
  return new EmployeeService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function employeeAssignmentService(ctx: Context): EmployeeAssignmentService {
  return new EmployeeAssignmentService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function employeeReportingLineService(ctx: Context): EmployeeReportingLineService {
  return new EmployeeReportingLineService(
    ctx.prisma,
    auditActor(ctx),
    ctx.state.authorization as AuthorizationContext,
  );
}

export function employeeAccountBindingService(ctx: Context): EmployeeAccountBindingService {
  return new EmployeeAccountBindingService(
    ctx.prisma,
    auditActor(ctx),
    ctx.state.authorization as AuthorizationContext,
  );
}

export function professionalTeamService(ctx: Context): ProfessionalTeamService {
  return new ProfessionalTeamService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function organizationService(ctx: Context): OrganizationService {
  return new OrganizationService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}

export function positionService(ctx: Context): PositionService {
  return new PositionService(ctx.prisma, auditActor(ctx), ctx.state.authorization as AuthorizationContext);
}
