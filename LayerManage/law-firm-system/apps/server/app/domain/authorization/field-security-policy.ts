import { DataClassification, FieldReadLevel } from './authorization-types';

export interface FieldPolicy {
  readonly code: string;
  readonly resource: string;
  readonly field: string;
  readonly classification: DataClassification;
  readonly defaultReadLevel: FieldReadLevel;
}

export interface FieldCapabilityRule {
  readonly readLevel: FieldReadLevel;
  readonly canWrite: boolean;
  readonly canExport: boolean;
}

const definitions: ReadonlyArray<readonly [string, string, DataClassification]> = [
  ['organization', 'id', 'L2'],
  ['organization', 'code', 'L2'],
  ['organization', 'name', 'L2'],
  ['organization', 'type', 'L2'],
  ['organization', 'status', 'L2'],
  ['organization', 'path', 'L2'],
  ['position', 'id', 'L2'],
  ['position', 'code', 'L2'],
  ['position', 'name', 'L2'],
  ['position', 'categoryCode', 'L2'],
  ['position', 'status', 'L2'],
  ['employee', 'id', 'L2'],
  ['employee', 'employeeNo', 'L2'],
  ['employee', 'name', 'L2'],
  ['employee', 'type', 'L2'],
  ['employee', 'status', 'L2'],
  ['employee', 'entryDate', 'L2'],
  ['employee', 'formalDate', 'L2'],
  ['employee', 'leaveDate', 'L2'],
  ['employee', 'phone', 'L3'],
  ['employee', 'email', 'L3'],
  ['employee', 'licenseNo', 'L3'],
  ['employee', 'professionalDirections', 'L3'],
  ['employee', 'idCard', 'L4'],
  ['user', 'id', 'L2'],
  ['user', 'username', 'L2'],
  ['user', 'status', 'L2'],
  ['user', 'employeeId', 'L2'],
  ['user', 'lastLoginAt', 'L2'],
  ['user', 'password', 'FORBIDDEN'],
  ['user', 'credentialVersion', 'FORBIDDEN'],
  ['user', 'mustChangePassword', 'FORBIDDEN'],
  ['user', 'passwordChangedAt', 'FORBIDDEN'],
  ['user', 'failedLoginCount', 'FORBIDDEN'],
  ['user', 'lockedUntil', 'FORBIDDEN'],
  ['professional_team', 'id', 'L2'],
  ['professional_team', 'code', 'L2'],
  ['professional_team', 'name', 'L2'],
  ['professional_team', 'categoryCode', 'L2'],
  ['professional_team', 'status', 'L2'],
  ['lead', 'phone', 'L3'],
  ['lead', 'wechat', 'L3'],
  ['customer', 'phone', 'L3'],
  ['customer', 'wechat', 'L3'],
];

export const FIELD_CATALOG = Object.freeze(definitions.map(([resource, field, classification]) => Object.freeze({
  code: `${resource}.${field}`,
  resource,
  field,
  classification,
  defaultReadLevel: defaultReadLevel(classification),
})));

const FIELD_BY_CODE: ReadonlyMap<string, FieldPolicy> = new Map(
  FIELD_CATALOG.map(item => [item.code, item]),
);
const FORBIDDEN_USER_FIELD = /(password|hash|token|secret|credential|failedLogin|lockedUntil|mustChangePassword)/i;

export function fieldPolicy(resource: string, field: string): FieldPolicy {
  const code = `${resource}.${field}`;
  const registered = FIELD_BY_CODE.get(code);
  if (registered) return registered;
  if (resource === 'user' && FORBIDDEN_USER_FIELD.test(field)) {
    return { code, resource, field, classification: 'FORBIDDEN', defaultReadLevel: 'NONE' };
  }
  return { code, resource, field, classification: 'L3', defaultReadLevel: 'MASKED' };
}

export function maskField(fieldCode: string, value: unknown): unknown {
  const policy = FIELD_BY_CODE.get(fieldCode);
  if (policy?.classification === 'L4' || policy?.classification === 'FORBIDDEN') return null;
  if (value === null || value === undefined) return value;

  if (fieldCode === 'employee.phone' && typeof value === 'string') {
    return value.length === 11 ? `${value.slice(0, 3)}****${value.slice(-4)}` : '***';
  }
  if (fieldCode === 'employee.email' && typeof value === 'string') {
    const separator = value.indexOf('@');
    return separator > 0 ? `${value[0]}***${value.slice(separator)}` : '***';
  }
  if (fieldCode === 'employee.licenseNo' && typeof value === 'string') {
    return value.length >= 7 ? `${value.slice(0, 3)}***${value.slice(-4)}` : '***';
  }
  if (Array.isArray(value)) return value.map(() => '***');
  return '***';
}

export function resolveFieldCapability(
  classification: DataClassification,
  rules: readonly FieldCapabilityRule[],
): FieldCapabilityRule {
  if (classification === 'FORBIDDEN' || rules.some(rule => rule.readLevel === 'NONE')) {
    return { readLevel: 'NONE', canWrite: false, canExport: false };
  }

  const baseline = defaultReadLevel(classification);
  const readLevel = rules.some(rule => rule.readLevel === 'READ')
    ? 'READ'
    : rules.some(rule => rule.readLevel === 'MASKED')
      ? 'MASKED'
      : baseline;
  return {
    readLevel,
    canWrite: rules.some(rule => rule.canWrite),
    canExport: rules.some(rule => rule.canExport),
  };
}

function defaultReadLevel(classification: DataClassification): FieldReadLevel {
  if (classification === 'L1' || classification === 'L2') return 'READ';
  if (classification === 'L3') return 'MASKED';
  return 'NONE';
}
