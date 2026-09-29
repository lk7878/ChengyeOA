import request from '@/api/request';
import type { EmployeeOffboarding } from './types';
import type { ApiResponse } from '@/types';
import type { OrganizationManager, AssignmentType, CreateEmployeeInput, CreateOrganizationInput, CreatePositionInput, CreateProfessionalTeamInput, EmployeeDetail, EmployeeListQuery, EmployeePage, MasterDataStatus, OrganizationDetail, OrganizationNode, Position, ProfessionalTeamDetail, ProfessionalTeamListQuery, ProfessionalTeamPage, TeamMemberRole, UpdateEmployeeInput, UpdateOrganizationInput, UpdatePositionInput, UpdateProfessionalTeamInput, VersionedMutation } from './types';

export const masterDataApi = {
  organizations: {
    options: (status?: MasterDataStatus) => request.get<ApiResponse<OrganizationNode[]>>('/v1/organizations/options', { params: { status } }),
    managerOptions: (keyword?: string) => request.get<ApiResponse<OrganizationManager[]>>('/v1/organizations/manager-options', { params: { keyword } }),
    copy: (id: string, data: CreateOrganizationInput & { sourceVersion: number }) => request.post<ApiResponse<OrganizationNode>>(`/v1/organizations/${id}/copy`, data),
    remove: (id: string, data: VersionedMutation) => request.delete<ApiResponse<null>>(`/v1/organizations/${id}`, { data }),
    tree: (status?: MasterDataStatus) => request.get<ApiResponse<OrganizationNode[]>>('/v1/organizations/tree', { params: { status } }),
    detail: (id: string) => request.get<ApiResponse<OrganizationDetail>>(`/v1/organizations/${id}`),
    create: (data: CreateOrganizationInput) => request.post<ApiResponse<OrganizationDetail>>('/v1/organizations', data),
    update: (id: string, data: UpdateOrganizationInput) => request.patch<ApiResponse<OrganizationDetail>>(`/v1/organizations/${id}`, data),
    move: (id: string, data: { parentId: string; version: number }) => request.post<ApiResponse<OrganizationDetail>>(`/v1/organizations/${id}/move`, data),
    disable: (id: string, data: VersionedMutation) => request.post<ApiResponse<OrganizationDetail>>(`/v1/organizations/${id}/disable`, data),
    enable: (id: string, data: VersionedMutation) => request.post<ApiResponse<OrganizationDetail>>(`/v1/organizations/${id}/enable`, data),
  },
  positions: {
    remove: (id: string, data: VersionedMutation) => request.delete<ApiResponse<null>>(`/v1/positions/${id}`, { data }),
    list: (params?: { includeDescendants?: boolean; organizationId?: string; status?: MasterDataStatus; keyword?: string }) => request.get<ApiResponse<Position[]>>('/v1/positions', { params }),
    detail: (id: string) => request.get<ApiResponse<Position>>(`/v1/positions/${id}`),
    create: (data: CreatePositionInput) => request.post<ApiResponse<Position>>('/v1/positions', data),
    update: (id: string, data: UpdatePositionInput) => request.patch<ApiResponse<Position>>(`/v1/positions/${id}`, data),
    disable: (id: string, data: VersionedMutation) => request.post<ApiResponse<Position>>(`/v1/positions/${id}/disable`, data),
    enable: (id: string, data: VersionedMutation) => request.post<ApiResponse<Position>>(`/v1/positions/${id}/enable`, data),
  },
  employees: {
    offboarding: (id: string) => request.get<ApiResponse<EmployeeOffboarding>>(`/v1/employees/${id}/offboarding`),
    suspendAccount: (id: string, data: VersionedMutation & { confirmed: true }) => request.post<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}/suspend-account`, data),
    remove: (id: string, data: VersionedMutation & { confirmed: true; recipientUserId?: string; deleteAccount?: boolean }) => request.delete<ApiResponse<null>>(`/v1/employees/${id}`, { data }),
    list: (params?: EmployeeListQuery) => request.get<ApiResponse<EmployeePage>>('/v1/employees', { params }),
    detail: (id: string) => request.get<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}`),
    create: (data: CreateEmployeeInput) => request.post<ApiResponse<EmployeeDetail>>('/v1/employees', data),
    update: (id: string, data: UpdateEmployeeInput) => request.patch<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}`, data),
    formalize: (id: string, data: { formalDate: string; version: number }) => request.post<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}/formalize`, data),
    leave: (id: string, data: { leaveDate: string; handoverConfirmed: true; version: number }) => request.post<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}/leave`, data),
    transferPrimary: (id: string, data: { organizationId: string; positionId: string; employeeVersion: number }) => request.post<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}/assignments/transfer`, data),
    addAssignment: (id: string, data: { organizationId: string; positionId: string; assignmentType: Exclude<AssignmentType, 'PRIMARY'> }) => request.post<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}/assignments`, data),
    endAssignment: (id: string, assignmentId: string, data: VersionedMutation) => request.post<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}/assignments/${assignmentId}/end`, data),
    bindAccount: (id: string, data: { userId: string; employeeVersion: number }) => request.put<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}/account-binding`, data),
    unbindAccount: (id: string, data: { employeeVersion: number }) => request.delete<ApiResponse<EmployeeDetail>>(`/v1/employees/${id}/account-binding`, { data }),
    viewSensitive: (id: string, fieldCodes: string[], purpose: string) => request.post<ApiResponse<Record<string, string | null>>>('/v1/authorization/sensitive-view', { resource: 'employee', resourceId: id, fieldCodes, purpose }),
  },
  professionalTeams: {
    remove: (id: string, data: VersionedMutation) => request.delete<ApiResponse<null>>(`/v1/professional-teams/${id}`, { data }),
    list: (params?: ProfessionalTeamListQuery) => request.get<ApiResponse<ProfessionalTeamPage>>('/v1/professional-teams', { params }),
    detail: (id: string) => request.get<ApiResponse<ProfessionalTeamDetail>>(`/v1/professional-teams/${id}`),
    create: (data: CreateProfessionalTeamInput) => request.post<ApiResponse<ProfessionalTeamDetail>>('/v1/professional-teams', data),
    update: (id: string, data: UpdateProfessionalTeamInput) => request.patch<ApiResponse<ProfessionalTeamDetail>>(`/v1/professional-teams/${id}`, data),
    disable: (id: string, data: VersionedMutation) => request.post<ApiResponse<ProfessionalTeamDetail>>(`/v1/professional-teams/${id}/disable`, data),
    enable: (id: string, data: VersionedMutation) => request.post<ApiResponse<ProfessionalTeamDetail>>(`/v1/professional-teams/${id}/enable`, data),
    addMember: (id: string, data: { employeeId: string; memberRole: TeamMemberRole }) => request.post<ApiResponse<ProfessionalTeamDetail>>(`/v1/professional-teams/${id}/members`, data),
    endMember: (id: string, memberId: string, data: VersionedMutation) => request.post<ApiResponse<ProfessionalTeamDetail>>(`/v1/professional-teams/${id}/members/${memberId}/end`, data),
    replaceLead: (id: string, data: { employeeId: string; teamVersion: number }) => request.post<ApiResponse<ProfessionalTeamDetail>>(`/v1/professional-teams/${id}/lead`, data),
  },
};
