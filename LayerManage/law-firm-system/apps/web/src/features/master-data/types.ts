export type MasterDataStatus = 'ENABLED' | 'DISABLED';
export type OrganizationType = 'FIRM' | 'HQ_CENTER' | 'DEPARTMENT' | 'BRANCH' | 'GROUP';
export type EmployeeStatus = 'PROBATION' | 'FORMAL' | 'LEAVED';
export type AssignmentType = 'PRIMARY' | 'SECONDARY' | 'ACTING';
export type TeamMemberRole = 'LEAD' | 'EXPERT' | 'LAWYER' | 'ASSISTANT' | 'OPERATIONS' | 'OTHER';
export interface VersionedMutation { version: number }

export interface OrganizationManager { id: string; employeeNo: string; name: string; status: string }
export interface Organization { managerEmployeeId?: string | null; manager?: OrganizationManager | null; id: string; code: string; name: string; type: OrganizationType; parentId: string | null; path: string; level: number; sort: number; status: MasterDataStatus; version: number }
export interface OrganizationNode extends Organization { children: OrganizationNode[] }
export interface OrganizationDetail extends Organization { parent: Organization | null; children: Organization[]; counts: { positions: number; activeAssignments: number } }
export interface Position { id: string; organizationId: string; code: string; name: string; categoryCode: string; level: number; responsibilities: string | null; status: MasterDataStatus; version: number; activeAssignmentCount: number }
export interface EmployeeAssignment { id: string; employeeId: string; organizationId: string; positionId: string; assignmentType: AssignmentType; startedAt: string; endedAt: string | null; version: number }
export interface EmployeeListItem { id: string; employeeNo: string; name: string; employeeType: string; status: EmployeeStatus; entryDate: string; activeProfessionalTeamIds: string[]; version: number; primaryAssignment: EmployeeAssignment | null }
export interface ProfessionalTeamMember { id: string; professionalTeamId: string; employeeId: string; memberRole: TeamMemberRole; startedAt: string; endedAt: string | null; version: number }
export interface EmployeeDetail extends EmployeeListItem { phone?: string; email?: string | null; licenseNo?: string | null; professionalDirections?: string[]; formalDate: string | null; leaveDate: string | null; assignments: EmployeeAssignment[]; professionalTeams: ProfessionalTeamMember[]; account: { id: string; username: string; status: string } | null }
export interface ProfessionalTeam { id: string; code: string; name: string; categoryCode: string; homeOrganizationId: string; status: MasterDataStatus; version: number; activeMemberCount: number }
export interface ProfessionalTeamDetail extends ProfessionalTeam { description: string | null; members: ProfessionalTeamMember[] }

export interface EmployeeListQuery { page?: number; pageSize?: number; keyword?: string; status?: EmployeeStatus; organizationId?: string; teamId?: string }
export interface ProfessionalTeamListQuery { page?: number; pageSize?: number; keyword?: string; categoryCode?: string; homeOrganizationId?: string; status?: MasterDataStatus }
interface Page<T> { list: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }
export type EmployeePage = Page<EmployeeListItem>;
export type ProfessionalTeamPage = Page<ProfessionalTeam>;
export interface CreateOrganizationInput { managerEmployeeId?: string | null; code: string; name: string; type: Exclude<OrganizationType, 'FIRM'>; parentId: string; sort?: number }
export interface UpdateOrganizationInput extends VersionedMutation { managerEmployeeId?: string | null; name?: string; sort?: number }
export interface CreatePositionInput { organizationId: string; code: string; name: string; categoryCode: string; level: number; responsibilities?: string | null }
export interface UpdatePositionInput extends VersionedMutation { code?: string; name?: string; categoryCode?: string; level?: number; responsibilities?: string | null }
export interface CreateEmployeeInput { employeeNo: string; name: string; phone: string; email?: string | null; idCard?: string | null; licenseNo?: string | null; employeeType: string; professionalDirections?: string[]; entryDate: string; primaryOrganizationId: string; primaryPositionId: string }
export interface UpdateEmployeeInput extends VersionedMutation { name?: string; phone?: string; email?: string | null; idCard?: string | null; licenseNo?: string | null; employeeType?: string; professionalDirections?: string[] }
export interface CreateProfessionalTeamInput { code: string; name: string; categoryCode: string; homeOrganizationId: string; description?: string | null }
export interface UpdateProfessionalTeamInput extends VersionedMutation { name?: string; categoryCode?: string; homeOrganizationId?: string; description?: string | null }
