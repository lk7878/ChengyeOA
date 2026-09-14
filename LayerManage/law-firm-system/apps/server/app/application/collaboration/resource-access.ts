import { boolean, choice, exact, fail, integer, strings, text } from './collaboration-policy';

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
    const principalType = choice(g.principalType, ['USER', 'ORG', 'TEAM', 'POSITION']);
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
