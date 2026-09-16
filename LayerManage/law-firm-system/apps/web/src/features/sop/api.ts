import request from '@/api/request';
import type { ApiResponse } from '@/types';
export interface SopMaterial {
  code: string;
  name: string;
  required: boolean;
  instruction: string;
}
export interface SopNode {
  code: string;
  name: string;
  instruction: string;
  dependsOn: string[];
  materials: SopMaterial[];
  reviewRequired: boolean;
  reviewerRoleId: string | null;
  reminderDays: number | null;
  closeGate: boolean;
}
export interface SopContent {
  schemaVersion: 1;
  nodes: SopNode[];
}
export interface SopVersion {
  id: string;
  number: number;
  version: number;
  content: SopContent;
  contentHash: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DISABLED';
  inReview?: boolean;
  governance?: { id: string; status: string } | null;
}
export interface SopTemplate {
  id: string;
  code: string;
  name: string;
  organizationId: string;
  professionalTeamId: string;
  caseType: string;
  activeVersionId: string | null;
  versions: SopVersion[];
}
export interface SopOptions {
  organizations: { id: string; name: string }[];
  teams: { id: string; name: string; homeOrganizationId: string }[];
  roles: { id: string; name: string }[];
  limit: number;
}
export const sopApi = {
  forVersion: (id: string) => request.get<ApiResponse<SopTemplate>>('/v1/sop/template-versions/' + id),
  list: (page = 1) =>
    request.get<ApiResponse<{ list: SopTemplate[]; pagination: { total: number } }>>('/v1/sop/templates', {
      params: { page, pageSize: 20 },
    }),
  get: (id: string) => request.get<ApiResponse<SopTemplate>>('/v1/sop/templates/' + id),
  options: () => request.get<ApiResponse<SopOptions>>('/v1/sop/template-options'),
  presets: () =>
    request.get<ApiResponse<{ code: string; name: string; content: SopContent }[]>>(
      '/v1/sop/template-presets',
    ),
  create: (input: unknown) => request.post<ApiResponse<{ id: string }>>('/v1/sop/templates', input),
  update: (id: string, expectedVersion: number, content: SopContent) =>
    request.put('/v1/sop/template-versions/' + id, { expectedVersion, content }),
  copy: (id: string, sourceVersionId: string, requestKey: string) =>
    request.post('/v1/sop/templates/' + id + '/versions', { sourceVersionId, requestKey }),
};
export const newNode = (index: number): SopNode => ({
  code: 'NODE_' + String(index).padStart(2, '0'),
  name: '新节点',
  instruction: '',
  dependsOn: [],
  materials: [],
  reviewRequired: false,
  reviewerRoleId: null,
  reminderDays: null,
  closeGate: false,
});
