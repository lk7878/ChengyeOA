import { Prisma } from '@prisma/client';
import { GovernedOperationType } from '../../../domain/admin-governance/governance-types';
import { GovernedOperationAdapter, GovernanceExecutionRequest } from './governance-adapter';
import { assertExactKeys } from '../../../domain/master-data/master-data-validation';
import { parseSopContent, sopFail } from '../../../domain/sop/template-content';
import { hashPayload } from '../../../domain/admin-governance/canonical-json';
import { requireSopVersion } from '../../sop/template-service';
import { AuthorizationContextLoader } from '../../authorization/authorization-context-loader';
import { AuthorizationContext } from '../../authorization/authorization-service';
export const isSopOperation = (type: string) =>
  type === 'SOP_TEMPLATE_PUBLISH' || type === 'SOP_TEMPLATE_DISABLE';
export async function validateSopGovernance(
  tx: Prisma.TransactionClient,
  context: AuthorizationContext,
  input: {
    targetType: string;
    targetId: string;
    expectedTargetVersion: number;
    payload: unknown;
    operationType: string;
  },
) {
  if (input.targetType !== 'SOP_TEMPLATE_VERSION') sopFail('SOP_TARGET_INVALID');
  await tx.$queryRaw`SELECT id FROM sop_template_version WHERE id=${input.targetId} FOR UPDATE`;
  const row = await requireSopVersion(tx, context, input.targetId, 'sop.template.publish');
  const payload = input.payload as { contentHash: string };
  if (
    row.version !== input.expectedTargetVersion ||
    row.contentHash !== payload.contentHash ||
    row.status !== (input.operationType === 'SOP_TEMPLATE_PUBLISH' ? 'DRAFT' : 'PUBLISHED')
  )
    sopFail('SOP_VERSION_CONFLICT', 409);
  if (
    await tx.adminOperation.count({
      where: {
        targetType: 'SOP_TEMPLATE_VERSION',
        targetId: row.id,
        status: { in: ['PENDING_REVIEW', 'APPROVED', 'EXECUTING'] },
      },
    })
  )
    sopFail('SOP_REVIEW_PENDING', 409);
}
export class SopTemplateAdapter implements GovernedOperationAdapter {
  readonly key = 'sop-template';
  supports(type: GovernedOperationType) {
    return isSopOperation(type);
  }
  validatePayload(type: GovernedOperationType, raw: unknown): Prisma.InputJsonValue {
    if (!this.supports(type)) sopFail('SOP_OPERATION_INVALID');
    assertExactKeys(raw, ['contentHash']);
    if (typeof raw.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.contentHash))
      sopFail('SOP_HASH_INVALID');
    return { contentHash: raw.contentHash as string };
  }
  async execute(tx: Prisma.TransactionClient, request: GovernanceExecutionRequest) {
    const payload = this.validatePayload(request.operationType, request.payload) as { contentHash: string };
    if (
      request.targetType !== 'SOP_TEMPLATE_VERSION' ||
      !request.reviewerUserId ||
      request.reviewerUserId === request.requesterUserId
    )
      sopFail('SOP_REVIEWER_INVALID', 403);
    await tx.$queryRaw`SELECT id FROM sop_template_version WHERE id=${request.targetId} FOR UPDATE`;
    const context = await new AuthorizationContextLoader(tx).load(request.requesterUserId);
    const row = await requireSopVersion(tx, context, request.targetId, 'sop.template.publish');
    const reviewer = await new AuthorizationContextLoader(tx).load(request.reviewerUserId);
    if (
      !reviewer.isSystemSuperAdmin ||
      !reviewer.permissionCodes.includes('governance.review') ||
      row.createdBy === request.reviewerUserId
    )
      sopFail('SOP_REVIEWER_INVALID', 403);
    if (
      row.version !== request.expectedTargetVersion ||
      row.contentHash !== payload.contentHash ||
      hashPayload(row.content) !== payload.contentHash
    )
      sopFail('SOP_VERSION_CONFLICT', 409);
    const publishing = request.operationType === 'SOP_TEMPLATE_PUBLISH';
    if (row.status !== (publishing ? 'DRAFT' : 'PUBLISHED')) sopFail('SOP_STATE_INVALID', 409);
    const content = parseSopContent(row.content);
    const roleIds = [
      ...new Set(content.nodes.flatMap((node) => (node.reviewerRoleId ? [node.reviewerRoleId] : []))),
    ];
    if (
      publishing &&
      roleIds.length &&
      (await tx.role.count({ where: { id: { in: roleIds }, type: 'BUSINESS', status: 'ENABLED' } })) !==
        roleIds.length
    )
      sopFail('SOP_REVIEWER_ROLE_INVALID', 409);
    if (
      publishing &&
      (!(await tx.organization.findFirst({
        where: { id: row.template.organizationId, status: 'ENABLED' },
      })) ||
        !(await tx.professionalTeam.findFirst({
          where: {
            id: row.template.professionalTeamId,
            status: 'ENABLED',
            homeOrganizationId: row.template.organizationId,
          },
        })))
    )
      sopFail('SOP_TARGET_NOT_AVAILABLE', 409);
    await tx.$queryRaw`SELECT id FROM sop_template WHERE id=${row.templateId} FOR UPDATE`;
    const currentTemplate = await tx.sopTemplate.findUniqueOrThrow({ where: { id: row.templateId } });
    const next = await tx.sopTemplateVersion.update({
      where: { id: row.id },
      data: {
        status: publishing ? 'PUBLISHED' : 'DISABLED',
        version: { increment: 1 },
        updatedBy: request.requesterUserId,
        ...(publishing
          ? { publishedAt: new Date(), publishedOperationId: request.operationId }
          : { disabledOperationId: request.operationId }),
      },
    });
    await tx.sopTemplate.update({
      where: { id: row.templateId },
      data: {
        version: { increment: 1 },
        updatedBy: request.requesterUserId,
        ...(publishing
          ? { activeVersionId: row.id }
          : currentTemplate.activeVersionId === row.id
            ? { activeVersionId: null }
            : {}),
      },
    });
    const beforeSnapshot = {
      id: row.id,
      templateId: row.templateId,
      number: row.number,
      status: row.status,
      contentHash: row.contentHash,
      version: row.version,
    };
    return {
      beforeSnapshot,
      afterSnapshot: { ...beforeSnapshot, status: next.status, version: next.version },
      resultCode: publishing ? 'SOP_TEMPLATE_PUBLISHED' : 'SOP_TEMPLATE_DISABLED',
    };
  }
}
