export type MasterDataStatus = 'ENABLED' | 'DISABLED';
export type OrganizationType = 'FIRM' | 'HQ_CENTER' | 'DEPARTMENT' | 'BRANCH' | 'GROUP';
export type AssignmentType = 'PRIMARY' | 'SECONDARY' | 'ACTING';
export type TeamMemberRole = 'LEAD' | 'EXPERT' | 'LAWYER' | 'ASSISTANT' | 'OPERATIONS' | 'OTHER';
export type EmployeeStatus = 'PROBATION' | 'FORMAL' | 'LEAVED';

export interface AuditActor {
  actorUserId: string;
  ip?: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  list: T[];
  pagination: Pagination;
}

export interface OrganizationView {
  id: string;
  code: string;
  name: string;
  type: OrganizationType;
  parentId: string | null;
  path: string;
  level: number;
  sort: number;
  status: MasterDataStatus;
  version: number;
}

export interface OrganizationNode extends OrganizationView {
  children: OrganizationNode[];
}

export interface OrganizationDetail extends OrganizationView {
  parent: OrganizationView | null;
  children: OrganizationView[];
  counts: { positions: number; activeAssignments: number };
}

export interface PositionView {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  categoryCode: string;
  level: number;
  responsibilities: string | null;
  status: MasterDataStatus;
  version: number;
  activeAssignmentCount: number;
}

export interface EmployeeAssignmentView {
  id: string;
  employeeId: string;
  organizationId: string;
  positionId: string;
  assignmentType: AssignmentType;
  startedAt: Date;
  endedAt: Date | null;
  version: number;
}

export interface EmployeeListItem {
  id: string;
  employeeNo: string;
  name: string;
  employeeType: string;
  status: EmployeeStatus;
  entryDate: Date;
  activeProfessionalTeamIds: string[];
  version: number;
  primaryAssignment: EmployeeAssignmentView | null;
}

export interface EmployeeDetail extends EmployeeListItem {
  phone: string;
  email: string | null;
  idCard: string | null;
  licenseNo: string | null;
  professionalDirections: string[];
  formalDate: Date | null;
  leaveDate: Date | null;
  assignments: EmployeeAssignmentView[];
  professionalTeams: ProfessionalTeamMemberView[];
  account: { id: string; username: string; status: string } | null;
}

export interface ProfessionalTeamMemberView {
  id: string;
  professionalTeamId: string;
  employeeId: string;
  memberRole: TeamMemberRole;
  startedAt: Date;
  endedAt: Date | null;
  version: number;
}

export interface ProfessionalTeamListItem {
  id: string;
  code: string;
  name: string;
  categoryCode: string;
  homeOrganizationId: string;
  status: MasterDataStatus;
  version: number;
  activeMemberCount: number;
}

export interface ProfessionalTeamDetail extends ProfessionalTeamListItem {
  description: string | null;
  members: ProfessionalTeamMemberView[];
}
