import request from '@/api/request';
import type { ApiResponse } from '@/types';
import type {
  AuthorizationSummary,
  FieldCapability,
  FieldReadLevel,
  RawAuthorizationSummary,
} from './types';

export function normalizeAuthorizationSummary(raw: RawAuthorizationSummary): AuthorizationSummary {
  const finiteExpiries = raw.grants
    .map(grant => grant.validUntil)
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return {
    userId: raw.userId,
    employeeId: raw.employeeId,
    isSystemSuperAdmin: raw.isSystemSuperAdmin,
    isSystemAdmin: raw.isSystemAdmin,
    permissions: [...new Set(raw.permissionCodes)],
    menus: [...new Set(raw.menuCodes)],
    fieldCapabilities: reduceFieldCapabilities(raw.fieldCapabilities),
    validUntil: finiteExpiries[0] ?? null,
    evaluatedAt: raw.evaluatedAt,
  };
}

export function isAuthorizationSummaryExpired(
  summary: AuthorizationSummary | null,
  now = Date.now(),
): boolean {
  return !summary || (summary.validUntil !== null && Date.parse(summary.validUntil) <= now);
}

export const authorizationApi = {
  async me(): Promise<AuthorizationSummary> {
    const response = await request.get<ApiResponse<RawAuthorizationSummary>>('/v1/authorization/me');
    return normalizeAuthorizationSummary(response.data);
  },
};

function reduceFieldCapabilities(
  rules: RawAuthorizationSummary['fieldCapabilities'],
): Record<string, FieldCapability> {
  const grouped = new Map<string, RawAuthorizationSummary['fieldCapabilities']>();
  for (const rule of rules) grouped.set(rule.fieldCode, [...(grouped.get(rule.fieldCode) ?? []), rule]);
  return Object.fromEntries([...grouped].map(([fieldCode, fieldRules]) => {
    const none = fieldRules.some(rule => rule.readLevel === 'NONE');
    const readLevel: FieldReadLevel = none
      ? 'NONE'
      : fieldRules.some(rule => rule.readLevel === 'READ') ? 'READ' : 'MASKED';
    return [fieldCode, {
      resource: fieldRules[0].resource,
      fieldCode,
      readLevel,
      canWrite: !none && fieldRules.some(rule => rule.canWrite),
      canExport: !none && fieldRules.some(rule => rule.canExport),
    }];
  }));
}
