import { boolean, choice, exact, fail, integer, strings, text } from './collaboration-policy';
import type { Access } from './collaboration-service';

export type Principal = { principalType: string; principalId: string };
export const resourceLevels: Record<string, number> = { READER: 1, EDITOR: 2, MANAGER: 3, OWNER: 4 };

// Shared by directory discovery and every content access path. Request-local inputs only.
export function restrictResourceAccess(parent: Access, raw: unknown, principals: Principal[]): Access {
  if (parent.level === 4) return parent;
  const policy = resourcePolicy(raw);
  const grants = policy.grants.filter((g) =>
    principals.some((p) => p.principalType === g.principalType && p.principalId === g.principalId),
  );
  if (grants.some((g) => g.role === 'DENY') || (policy.restricted && !grants.length))
    fail('COLLAB_FORBIDDEN', 403);
  if (parent.createOnly && !grants.length) fail('COLLAB_FORBIDDEN',403);
  if (!grants.length) return parent;
  return {
    ...parent,
    createOnly:false,
    level: Math.min(parent.createOnly ? 3 : parent.level, Math.max(...grants.map((g) => resourceLevels[g.role] ?? 0))),
    canCreate:
      parent.canCreate &&
      grants.some((g) => resourceLevels[g.role] >= 3 || (resourceLevels[g.role] >= 2 && g.canCreate)),
    selfOnly: parent.selfOnly || grants.every((g) => g.rowScope === 'SELF'),
    hidden: [...new Set([...parent.hidden, ...grants.flatMap((g) => g.hiddenFields)])],
    readonly: [...new Set([...parent.readonly, ...grants.flatMap((g) => g.readonlyFields)])],
  };
}

export interface ResourceGrant {
  principalType: string;
  principalId: string;
  role: string;
  rowScope: string;
  canCreate: boolean;
  hiddenFields: string[];
  readonlyFields: string[];
}
export interface ResourcePolicy {
  restricted: boolean;
  grants: ResourceGrant[];
}

export function resourcePolicy(raw: unknown): ResourcePolicy {
  const input = exact(raw ?? { restricted: false, grants: [] }, ['restricted', 'grants']);
  if (!Array.isArray(input.grants) || input.grants.length > 200) fail('COLLAB_INVALID_ACCESS');
  const keys = new Set<string>();
  const grants = input.grants.map((item) => {
    const g = exact(item, [
      'principalType',
      'principalId',
      'role',
      'rowScope',
      'canCreate',
      'hiddenFields',
      'readonlyFields',
    ]);
    const principalType = choice(g.principalType, ['USER', 'ORG', 'TEAM', 'POSITION', 'ROLE']);
    const principalId = text(g.principalId);
    const key = principalType + ':' + principalId;
    if (keys.has(key)) fail('COLLAB_DUPLICATE_PRINCIPAL');
    keys.add(key);
    return {
      principalType,
      principalId,
      role: choice(g.role, ['DENY', 'READER', 'EDITOR', 'MANAGER']),
      rowScope: choice(g.rowScope ?? (g.role === 'MANAGER' ? 'ALL' : 'SELF'), ['ALL', 'SELF']),
      canCreate: boolean(g.canCreate ?? false),
      hiddenFields: strings(g.hiddenFields ?? []),
      readonlyFields: strings(g.readonlyFields ?? []),
    };
  });
  return { restricted: boolean(input.restricted), grants };
}

export function accessInput(raw: unknown) {
  const input = exact(raw, ['version', 'policy']);
  return { version: integer(input.version, 1), policy: resourcePolicy(input.policy) };
}
