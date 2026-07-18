import { Prisma } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  AssignmentType,
  EmployeeAssignmentView,
  EmployeeDetail,
  EmployeeStatus,
  ProfessionalTeamMemberView,
  TeamMemberRole,
} from './master-data-types';

export const EMPLOYEE_DETAIL_INCLUDE = Prisma.validator<Prisma.EmployeeInclude>()({
  assignments: { orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }] },
  professionalTeams: { orderBy: [{ endedAt: 'asc' }, { startedAt: 'desc' }] },
  user: { select: { id: true, username: true, status: true } },
});

export const EMPLOYEE_PRIMARY_ASSIGNMENT_INCLUDE = Prisma.validator<Prisma.EmployeeInclude>()({
  assignments: {
    where: { assignmentType: 'PRIMARY', endedAt: null },
    take: 1,
    include: { organization: true, position: true },
  },
});

interface PrimaryAssignmentRecord {
  id: string;
  employeeId: string;
  organizationId: string;
  positionId: string;
  assignmentType: string;
  startedAt: Date;
  endedAt: Date | null;
  version: number;
  organization: unknown;
  position: unknown;
}

interface EmployeeWithPrimaryAssignment {
  orgId?: unknown;
  positionId?: unknown;
  organization?: unknown;
  position?: unknown;
  assignments: PrimaryAssignmentRecord[];
}

export function projectEmployeeWithPrimaryAssignment<T extends EmployeeWithPrimaryAssignment>(
  employee: T,
): Omit<T, 'orgId' | 'positionId' | 'organization' | 'position' | 'assignments'> & {
  primaryAssignment: PrimaryAssignmentRecord | null;
} {
  const { assignments, ...projected } = employee;
  const [primaryAssignment = null] = assignments;
  delete projected.orgId;
  delete projected.positionId;
  delete projected.organization;
  delete projected.position;
  return { ...projected, primaryAssignment } as Omit<
    T,
    'orgId' | 'positionId' | 'organization' | 'position' | 'assignments'
  > & { primaryAssignment: PrimaryAssignmentRecord | null };
}

export type EmployeeDetailRecord = Prisma.EmployeeGetPayload<{ include: typeof EMPLOYEE_DETAIL_INCLUDE }>;

export function projectEmployeeDetail(employee: EmployeeDetailRecord): EmployeeDetail {
  const assignments = employee.assignments.map(projectAssignment);
  return {
    id: employee.id,
    employeeNo: employee.employeeNo,
    name: employee.name,
    employeeType: employee.type,
    status: employee.status as EmployeeStatus,
    entryDate: employee.entryDate,
    activeProfessionalTeamIds: employee.professionalTeams.filter(item => item.endedAt === null).map(item => item.professionalTeamId),
    version: employee.version,
    primaryAssignment: primaryAssignment(employee.status as EmployeeStatus, assignments),
    phone: employee.phone,
    email: employee.email,
    idCard: employee.idCard,
    licenseNo: employee.licenseNo,
    professionalDirections: employee.professionalDirections,
    formalDate: employee.formalDate,
    leaveDate: employee.leaveDate,
    assignments,
    professionalTeams: employee.professionalTeams.map(projectTeamMember),
    account: employee.user,
  };
}

export function primaryAssignment(
  status: EmployeeStatus,
  assignments: EmployeeAssignmentView[],
): EmployeeAssignmentView | null {
  const active = assignments.filter(item => item.assignmentType === 'PRIMARY' && item.endedAt === null);
  if (active.length === 1) return active[0];
  if (status === 'LEAVED' && active.length === 0) return null;
  throw new MasterDataError('PRIMARY_ASSIGNMENT_CONFLICT', 409);
}

function projectAssignment(item: EmployeeDetailRecord['assignments'][number]): EmployeeAssignmentView {
  return {
    id: item.id,
    employeeId: item.employeeId,
    organizationId: item.organizationId,
    positionId: item.positionId,
    assignmentType: item.assignmentType as AssignmentType,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    version: item.version,
  };
}

function projectTeamMember(item: EmployeeDetailRecord['professionalTeams'][number]): ProfessionalTeamMemberView {
  return {
    id: item.id,
    professionalTeamId: item.professionalTeamId,
    employeeId: item.employeeId,
    memberRole: item.memberRole as TeamMemberRole,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    version: item.version,
  };
}
