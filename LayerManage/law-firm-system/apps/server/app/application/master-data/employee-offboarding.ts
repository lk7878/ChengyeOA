import { Prisma } from '@prisma/client';

export async function employeeHandoverBlockers(tx: Prisma.TransactionClient, employeeId: string) {
  const [cases, leads, subordinates, organizations, teams] = await Promise.all([
    tx.case.findMany({ where: { deletedAt: null, lawyerId: employeeId, status: { notIn: ['CLOSED', 'ARCHIVED'] } }, select: { id: true, caseNo: true, title: true, status: true }, orderBy: { caseNo: 'asc' } }),
    tx.lead.findMany({ where: { assignedTo: employeeId, deletedAt: null, status: { notIn: ['SIGNED', 'CONVERTED', 'LOST'] } }, select: { id: true, leadNo: true, name: true, status: true }, orderBy: { leadNo: 'asc' } }),
    tx.employeeReportingLine.findMany({ where: { managerEmployeeId: employeeId, endedAt: null }, select: { id: true, employee: { select: { id: true, name: true, employeeNo: true } } } }),
    tx.organization.findMany({ where: { managerEmployeeId: employeeId }, select: { id: true, name: true, code: true } }),
    tx.professionalTeamMember.findMany({ where: { employeeId, memberRole: 'LEAD', endedAt: null, professionalTeam: { deletedAt: null } }, select: { id: true, professionalTeam: { select: { id: true, name: true, code: true } } } }),
  ]);
  return { cases, leads, subordinates, organizations, teams };
}

export function blockerCounts(blockers: Awaited<ReturnType<typeof employeeHandoverBlockers>>) {
  return Object.fromEntries(Object.entries(blockers).map(([key, items]) => [key, items.length]));
}

export async function employeeOffboardingOverview(tx: Prisma.TransactionClient, employeeId: string) {
  const blockers = await employeeHandoverBlockers(tx, employeeId);
  const account = await tx.user.findUnique({ where: { employeeId }, select: { id: true, username: true, status: true } });
  const assignment = await tx.employeeAssignment.findFirst({ where: { employeeId, assignmentType: 'PRIMARY' }, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }], include: { organization: { include: { manager: { include: { user: { select: { id: true, username: true, status: true } } } } } } } });
  const manager = assignment?.organization.manager;
  const suggestedRecipient = manager && manager.id !== employeeId && !manager.deletedAt && manager.status !== 'LEAVED' && manager.user?.status === 'ENABLED'
    ? { userId: manager.user.id, employeeId: manager.id, name: manager.name, username: manager.user.username, organizationName: assignment!.organization.name } : null;
  const resources = account ? await Promise.all([
    tx.driveNode.count({ where: { ownerId: account.id } }), tx.collabWorkspace.count({ where: { ownerId: account.id } }),
    tx.collabView.count({ where: { ownerId: account.id } }), tx.collabRecord.count({ where: { ownerId: account.id } }),
    tx.collabAttachment.count({ where: { ownerId: account.id } }), tx.collabRule.count({ where: { ownerId: account.id } }),
    tx.approvalAttachment.count({ where: { ownerUserId: account.id } }), tx.payrollBatch.count({ where: { ownerUserId: account.id } }),
  ]) : Array<number>(8).fill(0);
  return { blockers, counts: blockerCounts(blockers), account, suggestedRecipient,
    recipientHint: suggestedRecipient ? '已默认选择主职部门负责人，请确认接收人。' : '主职部门未配置可接收材料的负责人账号，请指定接收人或先完善部门负责人。',
    resources: Object.fromEntries(['documents', 'workspaces', 'views', 'records', 'attachments', 'rules', 'approvalAttachments', 'payrollBatches'].map((key, index) => [key, resources[index]])),
  };
}
