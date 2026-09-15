import { Prisma } from '@prisma/client';
import type { Access } from './collaboration-service';
import { fail } from './collaboration-policy';
import { Principal, restrictResourceAccess } from './resource-access';

export interface FolderAncestor {
  id: string;
  workspaceId: string;
  parentId: string | null;
  kind: string;
  folderName: string;
  accessPolicy: Prisma.JsonValue;
}

// A scalar expression, so content authentication reads ancestors in its existing
// statement. Root/legacy Bases have an empty path, with no separate round trip.
export function folderChainSql(nodeId: Prisma.Sql) {
  return Prisma.sql`(WITH RECURSIVE chain AS (
    SELECT p.id, p."workspaceId", p."parentId", p.kind, p."folderName", p."accessPolicy", 1 AS depth, ARRAY[p.id] AS trail
    FROM drive_node d JOIN drive_node p ON p.id = d."parentId" WHERE d.id = ${nodeId}
    UNION ALL
    SELECT p.id, p."workspaceId", p."parentId", p.kind, p."folderName", p."accessPolicy", c.depth + 1, c.trail || p.id
    FROM drive_node p JOIN chain c ON p.id = c."parentId" WHERE c.depth < 9 AND NOT p.id = ANY(c.trail)
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'workspaceId', "workspaceId", 'parentId', "parentId", 'kind', kind,
    'folderName', "folderName", 'accessPolicy', "accessPolicy"
  ) ORDER BY depth DESC), '[]'::jsonb) FROM chain)`;
}

export function inheritFolders(access: Access, chain: FolderAncestor[], principals: Principal[]): Access {
  if (chain.length > 8 || (chain.length && chain[0].parentId !== null)) fail('COLLAB_FORBIDDEN', 403);
  for (const [index, folder] of chain.entries()) {
    if (
      folder.kind !== 'FOLDER' ||
      folder.workspaceId !== access.workspaceId ||
      (index > 0 && folder.parentId !== chain[index - 1].id)
    )
      fail('COLLAB_FORBIDDEN', 403);
    access = restrictResourceAccess(access, folder.accessPolicy, principals);
  }
  return access;
}
