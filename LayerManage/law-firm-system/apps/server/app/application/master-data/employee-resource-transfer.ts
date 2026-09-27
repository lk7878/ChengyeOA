import { Prisma } from '@prisma/client';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import { resourcePolicy } from '../collaboration/resource-access';

// Same transaction as removal; private and trashed documents are included.
export async function transferEmployeeResources(tx: Prisma.TransactionClient, employeeId: string, recipientUserId?: string) {
  const source = await tx.user.findUnique({ where: { employeeId }, select: { id: true } });
  if (!source) return { nodes: 0, workspaces: 0 };
  const ownerId = source.id;
  const [nodes, workspaces, views, records, attachments, rules, approvalAttachments, payrollBatches] = await Promise.all([
    tx.driveNode.findMany({ where: { ownerId } }), tx.collabWorkspace.findMany({ where: { ownerId } }),
    tx.collabView.count({ where: { ownerId } }), tx.collabRecord.count({ where: { ownerId } }),
    tx.collabAttachment.count({ where: { ownerId } }), tx.collabRule.count({ where: { ownerId } }),
    tx.approvalAttachment.count({ where: { ownerUserId: ownerId } }), tx.payrollBatch.count({ where: { ownerUserId: ownerId } }),
  ]);
  if (!recipientUserId) {
    if (nodes.length || workspaces.length || views || records || attachments || rules || approvalAttachments || payrollBatches) throw new MasterDataError('EMPLOYEE_TRANSFER_REQUIRED', 409);
    return { nodes: 0, workspaces: 0 };
  }
  if (recipientUserId === ownerId) throw new MasterDataError('EMPLOYEE_TRANSFER_INVALID', 400);
  await tx.$queryRaw`SELECT "id" FROM "user" WHERE "id" = ${recipientUserId} FOR UPDATE`;
  const recipient = await tx.user.findFirst({ where: { id: recipientUserId, status: 'ENABLED', employee: { deletedAt: null, status: { not: 'LEAVED' } } } });
  if (!recipient) throw new MasterDataError('EMPLOYEE_TRANSFER_INVALID', 400);
  const policyForRecipient = (raw: Prisma.JsonValue): Prisma.InputJsonValue => {
    const policy = resourcePolicy(raw);
    return { restricted: policy.restricted, grants: [
      ...policy.grants.filter(g => g.principalType !== 'USER' || ![ownerId, recipientUserId].includes(g.principalId)).map(g => ({ ...g })),
      { principalType: 'USER', principalId: recipientUserId, role: 'MANAGER', rowScope: 'ALL', canCreate: true, hiddenFields: [], readonlyFields: [] },
    ] };
  };
  const workspaceIds = new Set([...nodes.map(n => n.workspaceId), ...workspaces.map(w => w.id)]);
  const ownedIds = new Set(nodes.map(n => n.id));
  for (const workspaceId of workspaceIds) {
    const ownsWorkspace = workspaces.some(w => w.id === workspaceId);
    const key = { workspaceId, principalType: 'USER', principalId: recipientUserId };
    const existing = await tx.collabMember.findUnique({ where: { workspaceId_principalType_principalId: key } });
    const role = ownsWorkspace || existing?.role === 'OWNER' ? 'OWNER' : 'MANAGER';
    await tx.collabMember.upsert({
      where: { workspaceId_principalType_principalId: key },
      create: { ...key, role, rowScope: 'ALL', canCreate: true, canManageAccess: true },
      update: { role, rowScope: 'ALL', canCreate: true, canManageAccess: true, hiddenFields: [], readonlyFields: [], version: { increment: 1 } },
    });
  }
  for (const node of nodes) {
    await tx.driveNode.update({ where: { id: node.id }, data: { ownerId: recipientUserId, parentId: node.parentId && ownedIds.has(node.parentId) ? node.parentId : null, accessPolicy: node.kind === 'FOLDER' ? policyForRecipient(node.accessPolicy) : Prisma.DbNull, version: { increment: 1 } } });
    if (node.baseId) {
      const base = await tx.collabBase.findUniqueOrThrow({ where: { id: node.baseId } });
      await tx.collabBase.update({ where: { id: base.id }, data: { accessPolicy: policyForRecipient(base.accessPolicy), accessVersion: { increment: 1 } } });
      const tables = await tx.collabTable.findMany({ where: { baseId: base.id } });
      for (const table of tables) await tx.collabTable.update({ where: { id: table.id }, data: { accessPolicy: policyForRecipient(table.accessPolicy), accessVersion: { increment: 1 } } });
    }
  }
  await tx.collabWorkspace.updateMany({ where: { ownerId }, data: { ownerId: recipientUserId, version: { increment: 1 } } });
  await tx.collabView.updateMany({ where: { ownerId }, data: { ownerId: recipientUserId, version: { increment: 1 } } });
  await tx.collabRecord.updateMany({ where: { ownerId }, data: { ownerId: recipientUserId, version: { increment: 1 } } });
  await tx.collabAttachment.updateMany({ where: { ownerId }, data: { ownerId: recipientUserId } });
  await tx.collabRule.updateMany({ where: { ownerId }, data: { ownerId: recipientUserId } });
  await tx.driveShortcut.updateMany({ where: { ownerId }, data: { ownerId: recipientUserId } });
  await tx.approvalAttachment.updateMany({ where: { ownerUserId: ownerId }, data: { ownerUserId: recipientUserId } });
  await tx.payrollBatch.updateMany({ where: { ownerUserId: ownerId }, data: { ownerUserId: recipientUserId, version: { increment: 1 } } });
  return { nodes: nodes.length, workspaces: workspaces.length, views, records, attachments, rules, approvalAttachments, payrollBatches, recipientUserId };
}
