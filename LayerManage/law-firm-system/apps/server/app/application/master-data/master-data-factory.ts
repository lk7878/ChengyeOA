import { Context } from 'egg';
import { EmployeeAccountBindingService } from './employee-account-binding-service';
import { EmployeeAssignmentService } from './employee-assignment-service';
import { EmployeeService } from './employee-service';
import { AuditActor } from './master-data-types';
import { ProfessionalTeamService } from './professional-team-service';

export function auditActor(ctx: Context): AuditActor {
  return { actorUserId: ctx.state.user.userId, ip: ctx.ip };
}

export function employeeService(ctx: Context): EmployeeService {
  return new EmployeeService(ctx.prisma, auditActor(ctx));
}

export function employeeAssignmentService(ctx: Context): EmployeeAssignmentService {
  return new EmployeeAssignmentService(ctx.prisma, auditActor(ctx));
}

export function employeeAccountBindingService(ctx: Context): EmployeeAccountBindingService {
  return new EmployeeAccountBindingService(ctx.prisma, auditActor(ctx));
}

export function professionalTeamService(ctx: Context): ProfessionalTeamService {
  return new ProfessionalTeamService(ctx.prisma, auditActor(ctx));
}
