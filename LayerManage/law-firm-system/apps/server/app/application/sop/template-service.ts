import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import {
  assertExactKeys,
  normalizeRequiredText,
  normalizeStableCode,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { parseSopContent, SopContent, sopFail } from '../../domain/sop/template-content';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
import { createOnce } from '../finance/domain-mutation';
import { SopDatabase, sopTemplateScope } from './sop-scope';
import { PermissionCode } from '../../domain/authorization/authorization-types';
const pendingStatuses = ['PENDING_REVIEW', 'APPROVED', 'EXECUTING'];
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function requireSopVersion(
  db: SopDatabase,
  context: AuthorizationContext,
  id: string,
  permission: PermissionCode,
) {
  const row = await db.sopTemplateVersion.findFirst({
    where: { id, template: await sopTemplateScope(db, context, permission) },
    include: { template: true },
  });
  if (!row) return sopFail('SOP_VERSION_NOT_FOUND', 404);
  return row;
}
export class SopTemplateService {
  private auth: AuthorizationService;
  constructor(
    private db: PrismaClient,
    private actor: AuditActor,
    private context: AuthorizationContext,
  ) {
    this.auth = new AuthorizationService(new DataScopeService(db));
  }
  async options() {
    this.auth.requireAction(this.context, 'sop.template.manage');
    this.auth.requireAction(this.context, 'organization.read');
    this.auth.requireAction(this.context, 'professional_team.read');
    const organizationWhere = await this.auth.buildScopeWhere(
      this.context,
      'organization',
      'organization.read',
    );
    const teamWhere = await this.auth.buildScopeWhere(
      this.context,
      'professional_team',
      'professional_team.read',
    );
    const [organizations, teams, roles] = await Promise.all([
      this.db.organization.findMany({
        where: { AND: [organizationWhere, { status: 'ENABLED' }] },
        select: { id: true, name: true },
        take: 500,
        orderBy: { id: 'asc' },
      }),
      this.db.professionalTeam.findMany({
        where: { AND: [teamWhere, { status: 'ENABLED' }] },
        select: { id: true, name: true, homeOrganizationId: true },
        take: 500,
        orderBy: { id: 'asc' },
      }),
      this.context.permissionCodes.includes('role.read')
        ? this.db.role.findMany({
            where: { type: 'BUSINESS', status: 'ENABLED' },
            select: { id: true, name: true },
            take: 500,
            orderBy: { id: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    return { organizations, teams, roles, limit: 500 };
  }
  async list(raw: unknown) {
    assertExactKeys(raw, ['page', 'pageSize', 'keyword', 'status']);
    const page = Number(raw.page ?? 1),
      pageSize = Number(raw.pageSize ?? 20);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize)
    )
      sopFail('VALIDATION_FAILED');
    const keyword = raw.keyword === undefined ? '' : normalizeRequiredText(raw.keyword, 1, 100);
    if (raw.status !== undefined && !['DRAFT', 'PUBLISHED', 'DISABLED'].includes(String(raw.status)))
      sopFail('VALIDATION_FAILED');
    const where: Prisma.SopTemplateWhereInput = {
      AND: [
        await sopTemplateScope(this.db, this.context, 'sop.template.read'),
        {
          ...(keyword ? { OR: [{ name: { contains: keyword } }, { code: { contains: keyword } }] } : {}),
          ...(raw.status ? { versions: { some: { status: String(raw.status) } } } : {}),
        },
      ],
    };
    const [total, list] = await this.db.$transaction([
      this.db.sopTemplate.count({ where }),
      this.db.sopTemplate.findMany({
        where,
        include: {
          versions: {
            orderBy: { number: 'desc' },
            select: { id: true, number: true, status: true, version: true, contentHash: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { list, pagination: { page, pageSize, total } };
  }
  async getByVersion(id: string) {
    const version = await requireSopVersion(this.db, this.context, id, 'sop.template.read');
    return this.get(version.templateId);
  }
  async get(id: string) {
    const row = await this.db.sopTemplate.findFirst({
      where: { AND: [{ id }, await sopTemplateScope(this.db, this.context, 'sop.template.read')] },
      include: { versions: { orderBy: { number: 'desc' } } },
    });
    if (!row) return sopFail('SOP_TEMPLATE_NOT_FOUND', 404);
    const operations = await this.db.adminOperation.findMany({
      where: {
        targetType: 'SOP_TEMPLATE_VERSION',
        targetId: { in: row.versions.map((v) => v.id) },
        operationType: { in: ['SOP_TEMPLATE_PUBLISH', 'SOP_TEMPLATE_DISABLE'] },
      },
      select: { id: true, targetId: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      distinct: ['targetId'],
    });
    return {
      ...row,
      versions: row.versions.map((v) => ({
        ...v,
        governance: operations.find((o) => o.targetId === v.id) ?? null,
        inReview: operations.some((o) => o.targetId === v.id && pendingStatuses.includes(o.status)),
      })),
    };
  }
  private async validateContent(content: SopContent) {
    const roles = [...new Set(content.nodes.flatMap((n) => (n.reviewerRoleId ? [n.reviewerRoleId] : [])))];
    if (roles.length) {
      this.auth.requireAction(this.context, 'role.read');
      if (
        (await this.db.role.count({ where: { id: { in: roles }, type: 'BUSINESS', status: 'ENABLED' } })) !==
        roles.length
      )
        sopFail('SOP_REVIEWER_ROLE_INVALID');
    }
  }
  async create(raw: unknown) {
    this.auth.requireAction(this.context, 'sop.template.manage');
    assertExactKeys(raw, [
      'code',
      'name',
      'organizationId',
      'professionalTeamId',
      'caseType',
      'content',
      'requestKey',
    ]);
    const code = normalizeStableCode(raw.code),
      name = normalizeRequiredText(raw.name, 1, 100),
      organizationId = normalizeRequiredText(raw.organizationId, 1, 100),
      professionalTeamId = normalizeRequiredText(raw.professionalTeamId, 1, 100),
      caseType = normalizeRequiredText(raw.caseType, 1, 100),
      content = parseSopContent(raw.content),
      key = normalizeRequiredText(raw.requestKey, 8, 128);
    await this.validateContent(content);
    this.auth.requireAction(this.context, 'organization.read');
    this.auth.requireAction(this.context, 'professional_team.read');
    const organizationWhere = await this.auth.buildScopeWhere(
        this.context,
        'organization',
        'organization.read',
      ),
      teamWhere = await this.auth.buildScopeWhere(
        this.context,
        'professional_team',
        'professional_team.read',
      );
    if (
      !(await this.db.organization.findFirst({
        where: { AND: [organizationWhere, { id: organizationId, status: 'ENABLED' }] },
      })) ||
      !(await this.db.professionalTeam.findFirst({
        where: {
          AND: [teamWhere, { id: professionalTeamId, homeOrganizationId: organizationId, status: 'ENABLED' }],
        },
      }))
    )
      sopFail('SOP_TARGET_NOT_AVAILABLE', 404);
    const normalized = { code, name, organizationId, professionalTeamId, caseType, content };
    return createOnce(
      this.db,
      { actorId: this.context.userId, key, operation: 'SOP_TEMPLATE_CREATE', normalized },
      async (tx) => {
        const row = await tx.sopTemplate.create({
          data: {
            code,
            name,
            organizationId,
            professionalTeamId,
            caseType,
            createdBy: this.context.userId,
            versions: {
              create: {
                number: 1,
                content: json(content),
                contentHash: hashPayload(json(content)),
                createdBy: this.context.userId,
              },
            },
          },
        });
        if (
          !(await tx.sopTemplate.findFirst({
            where: { AND: [{ id: row.id }, await sopTemplateScope(tx, this.context, 'sop.template.manage')] },
          }))
        )
          sopFail('PERMISSION_DENIED', 403);
        await this.audit(tx, 'SOP_TEMPLATE_CREATED', row.id, { code });
        return row;
      },
      async (tx, id) => {
        const row = await tx.sopTemplate.findFirst({
          where: { AND: [{ id }, await sopTemplateScope(tx, this.context, 'sop.template.manage')] },
        });
        if (!row) return sopFail('SOP_TEMPLATE_NOT_FOUND', 404);
        return row;
      },
    );
  }
  async updateVersion(id: string, raw: unknown) {
    assertExactKeys(raw, ['expectedVersion', 'content']);
    const version = normalizeVersion(raw.expectedVersion),
      content = parseSopContent(raw.content);
    await this.validateContent(content);
    await requireSopVersion(this.db, this.context, id, 'sop.template.manage');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sop_template_version WHERE id=${id} FOR UPDATE`;
      const row = await requireSopVersion(tx, this.context, id, 'sop.template.manage');
      if (row.version !== version || row.status !== 'DRAFT') sopFail('SOP_VERSION_CONFLICT', 409);
      if (
        await tx.adminOperation.count({
          where: { targetId: id, targetType: 'SOP_TEMPLATE_VERSION', status: { in: pendingStatuses } },
        })
      )
        sopFail('SOP_REVIEW_PENDING', 409);
      const next = await tx.sopTemplateVersion.update({
        where: { id },
        data: {
          content: json(content),
          contentHash: hashPayload(json(content)),
          version: { increment: 1 },
          updatedBy: this.context.userId,
        },
      });
      await this.audit(tx, 'SOP_TEMPLATE_DRAFT_UPDATED', id, {
        fromHash: row.contentHash,
        toHash: next.contentHash,
      });
      return next;
    });
  }
  async copyVersion(templateId: string, raw: unknown) {
    assertExactKeys(raw, ['sourceVersionId', 'requestKey']);
    const sourceId = normalizeRequiredText(raw.sourceVersionId, 1, 100),
      key = normalizeRequiredText(raw.requestKey, 8, 128);
    const source = await requireSopVersion(this.db, this.context, sourceId, 'sop.template.manage');
    if (source.templateId !== templateId) sopFail('SOP_VERSION_NOT_FOUND', 404);
    return createOnce(
      this.db,
      {
        actorId: this.context.userId,
        key,
        operation: 'SOP_TEMPLATE_COPY',
        normalized: { templateId, sourceId },
      },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM sop_template WHERE id=${templateId} FOR UPDATE`;
        const current = await requireSopVersion(tx, this.context, sourceId, 'sop.template.manage');
        const latest = await tx.sopTemplateVersion.aggregate({
          where: { templateId },
          _max: { number: true },
        });
        const row = await tx.sopTemplateVersion.create({
          data: {
            templateId,
            number: (latest._max.number ?? 0) + 1,
            content: json(current.content),
            contentHash: current.contentHash,
            createdBy: this.context.userId,
          },
        });
        await this.audit(tx, 'SOP_TEMPLATE_VERSION_COPIED', row.id, { sourceId, number: row.number });
        return row;
      },
      async (tx, id) => {
        const row = await requireSopVersion(tx, this.context, id, 'sop.template.manage');
        return row;
      },
    );
  }
  private async audit(tx: Prisma.TransactionClient, action: string, targetId: string, values: unknown) {
    await tx.operationLog.create({
      data: {
        userId: this.actor.actorUserId,
        action,
        targetType: 'SOP_TEMPLATE',
        targetId,
        newValues: JSON.stringify(values),
        ip: this.actor.ip,
      },
    });
  }
}
