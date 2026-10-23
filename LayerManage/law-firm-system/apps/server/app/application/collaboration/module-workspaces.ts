import { Prisma } from '@prisma/client';
import { fail } from './collaboration-policy';

export const moduleGroups: Record<string, { name: string; sources: string[] }> = {
  CASES: { name: '案件管理', sources: ['CASES'] },
  CRM: { name: '客户经营', sources: ['LEADS', 'FOLLOWS', 'CUSTOMERS', 'CHANNELS'] },
  SIGNING: { name: '签约管理', sources: ['NEGOTIATIONS', 'CONTRACTS'] },
  FINANCE: { name: '财务运营', sources: ['PAYMENTS', 'INVOICES', 'REFUNDS', 'COSTS'] },
  INVENTORY: {
    name: '物品管理',
    sources: ['INVENTORY_ITEMS', 'INVENTORY_MOVEMENTS', 'INVENTORY_STOCKTAKES'],
  },
  QUALITY: { name: '质量管理', sources: ['QUALITY_ANALYSES', 'QUALITY_REVIEWS', 'QUALITY_ISSUES'] },
  DELIVERY: { name: '案件交付', sources: ['SOP_TASKS'] },
  PERFORMANCE: { name: '绩效管理', sources: ['PERFORMANCES'] },
};
export function moduleGroup(source: string) {
  const entry = Object.entries(moduleGroups).find(([, group]) => group.sources.includes(source));
  if (!entry) fail('COLLAB_INVALID_SOURCE');
  return entry[0];
}
export async function ensureModuleWorkspace(
  tx: Prisma.TransactionClient,
  parentId: string,
  group: string,
  actorId: string,
) {
  const parent = await tx.collabWorkspace.findUniqueOrThrow({
    where: { id: parentId },
    include: { members: true },
  });
  if (parent.moduleGroup) {
    if (parent.moduleGroup !== group) fail('COLLAB_MODULE_WORKSPACE_MISMATCH');
    return parent;
  }
  await tx.$queryRaw`SELECT id FROM collab_workspace WHERE id=${parentId} FOR UPDATE`;
  const existing = await tx.collabWorkspace.findUnique({
    where: { moduleParentId_moduleGroup: { moduleParentId: parentId, moduleGroup: group } },
  });
  if (existing) return existing;
  const workspace = await tx.collabWorkspace.create({
    data: {
      name: moduleGroups[group].name,
      organizationId: parent.organizationId,
      ownerId: parent.ownerId,
      moduleGroup: group,
      moduleParentId: parentId,
      members: {
        create: parent.members.map(
          ({
            principalType,
            principalId,
            role,
            canCreate,
            rowScope,
            canManageAccess,
            hiddenFields,
            readonlyFields,
          }) => ({
            principalType,
            principalId,
            role,
            canCreate,
            rowScope,
            canManageAccess,
            hiddenFields,
            readonlyFields,
          }),
        ),
      },
    },
  });
  await tx.operationLog.create({
    data: {
      userId: actorId,
      action: 'workspace.module.created',
      targetType: 'COLLAB',
      targetId: workspace.id,
      newValues: JSON.stringify({ parentId, group }),
    },
  });
  return workspace;
}
