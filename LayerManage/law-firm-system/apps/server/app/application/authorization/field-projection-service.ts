import { AuthorizationError, AUTHORIZATION_CODES } from '../../domain/authorization/authorization-errors';
import {
  fieldPolicy,
  FieldCapabilityRule,
  maskField,
  resolveFieldCapability,
} from '../../domain/authorization/field-security-policy';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { AuthorizationContext } from './authorization-service';

export interface FieldAccessAuditSummary {
  actorUserId: string;
  resource: string;
  permissionCode: PermissionCode;
  fieldCodes: string[];
  resultCount: number;
  purpose: string;
}

export interface ProjectRecordsInput {
  context: AuthorizationContext;
  resource: string;
  permissionCode: PermissionCode;
  records: ReadonlyArray<Record<string, unknown>>;
  purpose: string;
}

export type FieldAccessAuditor = (summary: FieldAccessAuditSummary) => Promise<void>;

export class FieldProjectionService {
  async projectRecords(
    input: ProjectRecordsInput,
    audit: FieldAccessAuditor,
  ): Promise<Array<Record<string, unknown>>> {
    const projected: Array<Record<string, unknown>> = [];
    const rawL3Fields = new Set<string>();

    for (const record of input.records) {
      const output: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(record)) {
        const policy = fieldPolicy(input.resource, field);
        if (policy.classification === 'FORBIDDEN' || policy.classification === 'L4') continue;
        const capability = this.fieldCapability(
          input.context,
          input.resource,
          policy.code,
          input.permissionCode,
        );
        if (capability.readLevel === 'NONE') continue;
        if (capability.readLevel === 'MASKED') {
          output[field] = maskField(policy.code, value);
        } else {
          output[field] = value;
          if (policy.classification === 'L3') rawL3Fields.add(policy.code);
        }
      }
      projected.push(output);
    }

    if (rawL3Fields.size > 0 && input.records.length > 0) {
      await audit({
        actorUserId: input.context.userId,
        resource: input.resource,
        permissionCode: input.permissionCode,
        fieldCodes: [...rawL3Fields].sort(),
        resultCount: input.records.length,
        purpose: input.purpose,
      });
    }
    return projected;
  }

  canWriteField(
    context: AuthorizationContext,
    resource: string,
    fieldCode: string,
    permissionCode: PermissionCode,
  ): boolean {
    return this.fieldCapability(context, resource, fieldCode, permissionCode).canWrite;
  }

  canExportField(
    context: AuthorizationContext,
    resource: string,
    fieldCode: string,
    permissionCode: PermissionCode,
  ): boolean {
    return this.fieldCapability(context, resource, fieldCode, permissionCode).canExport;
  }

  requireWritableField(
    context: AuthorizationContext,
    resource: string,
    fieldCode: string,
    permissionCode: PermissionCode,
  ): void {
    if (!this.canWriteField(context, resource, fieldCode, permissionCode)) {
      throw new AuthorizationError(AUTHORIZATION_CODES.field, 403);
    }
  }

  fieldCapability(
    context: AuthorizationContext,
    resource: string,
    fieldCode: string,
    permissionCode: PermissionCode,
  ): FieldCapabilityRule {
    const policy = fieldPolicy(resource, fieldCode.slice(resource.length + 1));
    if (policy.code !== fieldCode || policy.classification === 'FORBIDDEN') return deniedCapability();
    if (!context.permissionCodes.includes(permissionCode)) return deniedCapability();
    if (context.isSystemSuperAdmin) {
      if (policy.classification === 'L4') {
        return { readLevel: 'NONE', canWrite: true, canExport: false };
      }
      return { readLevel: 'READ', canWrite: true, canExport: true };
    }

    const contributingRoleIds = new Set(context.grants
      .filter(grant => grant.sourceType === 'ROLE'
        && grant.resource === resource
        && grant.permissionCode === permissionCode)
      .map(grant => grant.sourceRoleId)
      .filter((roleId): roleId is string => Boolean(roleId)));
    const rules = context.fieldRules.filter(rule => (
      contributingRoleIds.has(rule.sourceRoleId)
      && rule.resource === resource
      && rule.fieldCode === fieldCode
    ));
    return resolveFieldCapability(policy.classification, rules);
  }
}

function deniedCapability(): FieldCapabilityRule {
  return { readLevel: 'NONE', canWrite: false, canExport: false };
}
