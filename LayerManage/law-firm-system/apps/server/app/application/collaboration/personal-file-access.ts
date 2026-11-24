import type { Access } from './collaboration-service';
import { resourcePolicy, restrictResourceAccess, type Principal } from './resource-access';

type FileNode = { id: string; parentId: string | null; name: string; kind: string; accessPolicy: unknown };
const rootAccess = (): Access => ({ level: 3, canCreate: true, canManageAccess: true, selfOnly: false, hidden: [], readonly: [], workspaceId: 'personal', organizationId: null });

// Personal shares may start at a child without granting access to its private ancestors.
// Explicit DENY (including leave-share) and missing/deleted ancestors remain barriers.
export function personalFileResolver<T extends FileNode>(rows: T[], principals: Principal[]) {
  const byId = new Map(rows.map(row => [row.id, row]));
  return (id: string) => {
    const chain: T[] = [], seen = new Set<string>();
    let current = byId.get(id);
    while (current) {
      if (seen.has(current.id) || chain.length >= 12) return null;
      seen.add(current.id); chain.unshift(current);
      if (!current.parentId) break;
      current = byId.get(current.parentId);
      if (!current || current.kind !== 'FOLDER') return null;
    }
    if (!chain.length) return null;
    let access: Access | null = null;
    let path: { id: string; name: string }[] = [];
    for (const row of chain) {
      const policy = resourcePolicy(row.accessPolicy);
      const grants = policy.grants.filter(g => principals.some(p => p.principalType === g.principalType && p.principalId === g.principalId));
      if (grants.some(g => g.role === 'DENY')) return null;
      if (!access && !grants.length) { path = []; continue; }
      try {
        access = restrictResourceAccess(access ?? rootAccess(), policy, principals);
        path.push({ id: row.id, name: row.name });
      } catch (error) {
        if ((error as { code?: string }).code !== 'COLLAB_FORBIDDEN') throw error;
        access = null; path = [];
      }
    }
    return access ? { row: chain[chain.length - 1], access, path, depth: chain.length } : null;
  };
}
