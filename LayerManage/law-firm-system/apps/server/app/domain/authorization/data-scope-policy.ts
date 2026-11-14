import { authorizationInputError } from './authorization-errors';
import { ScopeType } from './authorization-types';

const SCOPE_TYPES = new Set<ScopeType>([
  'ALL',
  'HQ_SCOPE',
  'ORG',
  'BRANCH',
  'TEAM',
  'SELF_AND_SUBORDINATES',
  'SELF',
  'CUSTOM',
]);

export interface ScopeTargetInput {
  organizationId?: string;
  professionalTeamId?: string;
  employeeId?: string;
}

export interface NormalizedScopeShape {
  scopeType: ScopeType;
  includeDescendants: boolean;
  organizationId: string | null;
  professionalTeamId: string | null;
  targets: ScopeTargetInput[];
}

export function validateScopeShape(input: unknown): NormalizedScopeShape {
  assertExactKeys(input, [
    'scopeType',
    'includeDescendants',
    'organizationId',
    'professionalTeamId',
    'targets',
  ]);
  if (typeof input.scopeType !== 'string' || !SCOPE_TYPES.has(input.scopeType as ScopeType)) {
    authorizationInputError();
  }
  if (input.includeDescendants !== undefined && typeof input.includeDescendants !== 'boolean') {
    authorizationInputError();
  }

  const scopeType = input.scopeType as ScopeType;
  const organizationId = optionalIdentifier(input.organizationId);
  const professionalTeamId = optionalIdentifier(input.professionalTeamId);
  const rawTargets = input.targets === undefined ? [] : input.targets;
  if (!Array.isArray(rawTargets) || rawTargets.length > 1000) authorizationInputError();
  const targets = rawTargets.map(normalizeTarget);

  if (scopeType === 'ORG' || scopeType === 'BRANCH') {
    if (!organizationId || professionalTeamId || targets.length > 0) authorizationInputError();
  } else if (scopeType === 'TEAM') {
    if (!professionalTeamId || organizationId || targets.length > 0) authorizationInputError();
  } else if (scopeType === 'CUSTOM') {
    if (organizationId || professionalTeamId || targets.length === 0) authorizationInputError();
    const targetKeys = targets.map(targetKey);
    if (new Set(targetKeys).size !== targetKeys.length) authorizationInputError();
  } else if (organizationId || professionalTeamId || targets.length > 0) {
    authorizationInputError();
  }

  const requestedDescendants = input.includeDescendants === true;
  if (requestedDescendants && scopeType !== 'ORG' && scopeType !== 'BRANCH') authorizationInputError();

  return {
    scopeType,
    includeDescendants: scopeType === 'BRANCH' ? true : requestedDescendants,
    organizationId,
    professionalTeamId,
    targets,
  };
}

export function combineGrantRecordSets<T extends string>(sets: readonly (readonly T[])[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const records of sets) {
    for (const record of records) {
      if (seen.has(record)) continue;
      seen.add(record);
      result.push(record);
    }
  }
  return result;
}

function normalizeTarget(value: unknown): ScopeTargetInput {
  assertExactKeys(value, ['organizationId', 'professionalTeamId', 'employeeId']);
  const entries = [
    ['organizationId', optionalIdentifier(value.organizationId)],
    ['professionalTeamId', optionalIdentifier(value.professionalTeamId)],
    ['employeeId', optionalIdentifier(value.employeeId)],
  ] as const;
  const populated = entries.filter(([, identifier]) => identifier !== null);
  if (populated.length !== 1) authorizationInputError();
  const [key, identifier] = populated[0];
  return { [key]: identifier };
}

function targetKey(target: ScopeTargetInput): string {
  if (target.organizationId) return `organization:${target.organizationId}`;
  if (target.professionalTeamId) return `team:${target.professionalTeamId}`;
  return `employee:${target.employeeId}`;
}

function optionalIdentifier(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') authorizationInputError();
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) authorizationInputError();
  return normalized;
}

function assertExactKeys(input: unknown, allowedKeys: readonly string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) authorizationInputError();
  const allowed = new Set(allowedKeys);
  if (Object.keys(input).some(key => !allowed.has(key))) authorizationInputError();
}
