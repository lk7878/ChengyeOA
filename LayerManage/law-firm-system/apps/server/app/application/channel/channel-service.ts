import { buildOrganizationScopeWhere } from '../authorization/resource-scope-resolvers';
import { randomUUID } from 'node:crypto';
import { Channel, Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { createOnce } from '../finance/domain-mutation';
import { channelScope } from './channel-scope';
import { buildLeadScopeWhere } from '../crm/lead-scope';
const TYPES = [
  'SEARCH',
  'SHORT_VIDEO',
  'LIVE',
  'INFO_FLOW',
  'WECHAT',
  'REFERRAL',
  'NATURAL',
  'OFFLINE',
  'OTHER',
] as const;
const STATUS = ['ENABLED', 'DISABLED'] as const;
const fail = (code: string, status = 400): never => {
  throw new MasterDataError(code, status);
};
function money(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,16}(\.\d{1,2})?$/.test(value)) fail('VALIDATION_FAILED');
  return new Prisma.Decimal(value as string).toFixed(2);
}
function pageNumber(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') fail('VALIDATION_FAILED');
  if (!/^[1-9]\d*$/.test(String(value))) fail('VALIDATION_FAILED');
  return Number(value);
}
const project = (row: Channel) => ({ ...row, cost: row.cost?.toFixed(2) ?? null });
export class ChannelService {
  private readonly auth: AuthorizationService;
  constructor(
    private readonly db: PrismaClient,
    private readonly actor: AuditActor,
    private readonly context: AuthorizationContext,
  ) {
    this.auth = new AuthorizationService(new DataScopeService(db));
  }
  async list(input: unknown) {
    assertExactKeys(input, ['page', 'pageSize', 'type', 'status', 'keyword', 'branchId']);
    const page = pageNumber(input.page, 1),
      pageSize = pageNumber(input.pageSize, 20);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize)
    )
      fail('VALIDATION_FAILED');
    const keyword = normalizeOptionalText(input.keyword, 100),
      branchId = normalizeOptionalText(input.branchId, 100);
    const where: Prisma.ChannelWhereInput = {
      AND: [
        await channelScope(this.db, this.context, 'channel.read'),
        {
          ...(input.type ? { type: normalizeAllowedValue(input.type, TYPES) } : {}),
          ...(input.status ? { status: normalizeAllowedValue(input.status, STATUS) } : {}),
          ...(branchId ? { branchId } : {}),
          ...(keyword ? { OR: [{ name: { contains: keyword } }, { code: { contains: keyword } }] } : {}),
        },
      ],
    };
    const [total, rows] = await this.db.$transaction([
      this.db.channel.count({ where }),
      this.db.channel.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map(project),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }
  private async probe(db: Prisma.TransactionClient, id: string, scope: Prisma.ChannelWhereInput) {
    const row = await db.channel.findFirst({ where: { AND: [{ id }, scope] } });
    return row ?? fail('CHANNEL_NOT_FOUND', 404);
  }
  async get(id: string) {
    return project(
      await this.probe(
        this.db,
        normalizeRequiredText(id, 1, 100),
        await channelScope(this.db, this.context, 'channel.read'),
      ),
    );
  }
  private audit(db: Prisma.TransactionClient, action: string, id: string, version: number) {
    return db.operationLog.create({
      data: {
        userId: this.actor.actorUserId,
        action,
        targetType: 'CHANNEL',
        targetId: id,
        newValues: JSON.stringify({ version }),
        ip: this.actor.ip,
      },
    });
  }
  async create(input: unknown) {
    this.auth.requireAction(this.context, 'channel.create');
    assertExactKeys(input, ['name', 'type', 'code', 'accountInfo', 'cost', 'branchId', 'idempotencyKey']);
    const name = normalizeRequiredText(input.name, 1, 100),
      type = normalizeAllowedValue(input.type, TYPES);
    const accountInfo = normalizeOptionalText(input.accountInfo, 2000),
      cost = input.cost === undefined ? '0.00' : money(input.cost);
    const branchId = normalizeOptionalText(input.branchId, 100),
      code = normalizeOptionalText(input.code, 100),
      key = normalizeOptionalText(input.idempotencyKey, 100);
    if (
      branchId &&
      !(await this.db.organization.findFirst({
        where: { id: branchId, status: 'ENABLED' },
        select: { id: true },
      }))
    )
      fail('VALIDATION_FAILED');
    const scope = await channelScope(this.db, this.context, 'channel.create');
    return createOnce(
      this.db,
      {
        actorId: this.actor.actorUserId,
        key,
        operation: 'channel.create',
        normalized: { name, type, code, accountInfo, cost, branchId },
      },
      async (tx) => {
        const row = await tx.channel.create({
          data: {
            name,
            type,
            code: code ?? 'CH-' + randomUUID(),
            accountInfo,
            cost,
            branchId,
            createdBy: this.actor.actorUserId,
            updatedBy: this.actor.actorUserId,
          },
        });
        await this.probe(tx, row.id, scope);
        await this.audit(tx, 'CHANNEL_CREATE', row.id, row.version);
        return project(row);
      },
      async (tx, targetId) => project(await this.probe(tx, targetId, scope)),
    ).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        fail('CHANNEL_CODE_CONFLICT', 409);
      throw error;
    });
  }
  async update(id: string, input: unknown) {
    id = normalizeRequiredText(id, 1, 100);
    assertExactKeys(input, ['name', 'accountInfo', 'cost', 'status', 'version']);
    const scope = await channelScope(this.db, this.context, 'channel.update'),
      version = normalizeVersion(input.version);
    const data = {
      ...(input.name !== undefined ? { name: normalizeRequiredText(input.name, 1, 100) } : {}),
      ...(input.accountInfo !== undefined
        ? { accountInfo: normalizeOptionalText(input.accountInfo, 2000) }
        : {}),
      ...(input.cost !== undefined ? { cost: money(input.cost) } : {}),
      ...(input.status !== undefined ? { status: normalizeAllowedValue(input.status, STATUS) } : {}),
    };
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channel WHERE id = ${id} FOR UPDATE`;
      const old = await this.probe(tx, id, scope);
      if (old.version !== version) fail('VERSION_CONFLICT', 409);
      const row = await tx.channel.update({
        where: { id },
        data: { ...data, version: { increment: 1 }, updatedBy: this.actor.actorUserId },
      });
      await this.audit(tx, 'CHANNEL_UPDATE', id, row.version);
      return project(row);
    });
  }
  async remove(id: string, input: unknown): Promise<null> {
    id = normalizeRequiredText(id, 1, 100);
    assertExactKeys(input, ['version']);
    const scope = await channelScope(this.db, this.context, 'channel.delete'),
      version = normalizeVersion(input.version);
    return this.db.$transaction(async (tx): Promise<null> => {
      await tx.$queryRaw`SELECT id FROM channel WHERE id = ${id} FOR UPDATE`;
      const row = await this.probe(tx, id, scope);
      if (row.version !== version) fail('VERSION_CONFLICT', 409);
      if (
        (await tx.lead.count({ where: { channelId: id } })) ||
        (await tx.campaign.count({ where: { channelId: id } })) ||
        (await tx.costEntry.count({ where: { channelId: id } }))
      )
        fail('CHANNEL_IN_USE', 409);
      await tx.channel.delete({ where: { id } });
      await this.audit(tx, 'CHANNEL_DELETE', id, version);
      return null;
    });
  }
  async identityGaps(input: unknown) {
    assertExactKeys(input, ['page']);
    const page = pageNumber(input.page, 1);
    if (!Number.isSafeInteger(page) || page < 1) fail('VALIDATION_FAILED');
    const scope = await channelScope(this.db, this.context, 'channel.read');
    const where: Prisma.ChannelWhereInput = {
      AND: [scope, { OR: [{ createdBy: null }, { branchId: null }] }],
    };
    const canRepair =
      ['channel.update', 'user.read', 'organization.read'].every((code) =>
        (this.context.permissionCodes as string[]).includes(code),
      ) && (await this.auth.resolveScopeTargets(this.context, 'channel', 'channel.update')).all;
    const [rows, total] = await this.db.$transaction([
      this.db.channel.findMany({
        where,
        select: { id: true, code: true, name: true, createdBy: true, branchId: true, version: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.db.channel.count({ where }),
    ]);
    const organizations = canRepair
      ? await this.db.organization.findMany({
          where: {
            AND: [
              { status: 'ENABLED' },
              buildOrganizationScopeWhere(
                await this.auth.resolveScopeTargets(this.context, 'organization', 'organization.read'),
              ),
            ],
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 500,
        })
      : [];
    const users = canRepair
      ? await this.db.user.findMany({
          where: {
            AND: [{ status: 'ENABLED' }, await this.auth.buildScopeWhere(this.context, 'user', 'user.read')],
          },
          select: { id: true, username: true },
          orderBy: { username: 'asc' },
          take: 500,
        })
      : [];
    return {
      rows,
      total,
      page,
      pageSize: 20,
      canRepair,
      organizations,
      users: users.map((u) => ({ id: u.id, name: u.username })),
    };
  }
  async repairIdentity(id: string, input: unknown) {
    const scope = await channelScope(this.db, this.context, 'channel.update');
    this.auth.requireAction(this.context, 'user.read');
    this.auth.requireAction(this.context, 'organization.read');
    if (!(await this.auth.resolveScopeTargets(this.context, 'channel', 'channel.update')).all)
      fail('PERMISSION_DENIED', 403);
    assertExactKeys(input, ['createdBy', 'branchId', 'reason', 'version']);
    id = normalizeRequiredText(id, 1, 100);
    const version = normalizeVersion(input.version),
      reason = normalizeRequiredText(input.reason, 1, 1000);
    const createdBy =
      input.createdBy === undefined ? undefined : normalizeRequiredText(input.createdBy, 1, 100);
    const branchId = input.branchId === undefined ? undefined : normalizeRequiredText(input.branchId, 1, 100);
    if (!createdBy && !branchId) fail('VALIDATION_FAILED');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channel WHERE id = ${id} FOR UPDATE`;
      const row = await this.probe(tx, id, scope);
      if (row.version !== version) fail('VERSION_CONFLICT', 409);
      if ((createdBy && row.createdBy) || (branchId && row.branchId)) fail('VALIDATION_FAILED');
      if (
        createdBy &&
        !(await tx.user.findFirst({
          where: {
            AND: [
              { id: createdBy, status: 'ENABLED' },
              await this.auth.buildScopeWhere(this.context, 'user', 'user.read'),
            ],
          },
          select: { id: true },
        }))
      )
        fail('VALIDATION_FAILED');
      if (
        branchId &&
        !(await tx.organization.findFirst({
          where: {
            AND: [
              { id: branchId, status: 'ENABLED' },
              buildOrganizationScopeWhere(
                await this.auth.resolveScopeTargets(this.context, 'organization', 'organization.read'),
              ),
            ],
          },
          select: { id: true },
        }))
      )
        fail('VALIDATION_FAILED');
      const updated = await tx.channel.update({
        where: { id },
        data: { createdBy, branchId, updatedBy: this.actor.actorUserId, version: { increment: 1 } },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'CHANNEL_IDENTITY_REPAIR',
          targetType: 'CHANNEL',
          targetId: id,
          oldValues: JSON.stringify({ createdBy: row.createdBy, branchId: row.branchId }),
          newValues: JSON.stringify({ createdBy: updated.createdBy, branchId: updated.branchId, reason }),
          ip: this.actor.ip,
        },
      });
      return project(updated);
    });
  }
  async statistics(id: string) {
    const channel = await this.get(id);
    if (!this.context.permissionCodes.includes('lead.read'))
      return { channel, totalLeads: null, convertedLeads: null, conversionRate: null, byStatus: null };
    const scope = await buildLeadScopeWhere(this.db, this.auth, this.context, 'lead.read');
    const byStatus = await this.db.lead.groupBy({
      by: ['status'],
      where: { AND: [{ channelId: id, deletedAt: null }, scope] },
      _count: { id: true },
    });
    const totalLeads = byStatus.reduce((sum, row) => sum + row._count.id, 0),
      convertedLeads = byStatus.find((row) => row.status === 'CONVERTED')?._count.id ?? 0;
    return {
      channel,
      totalLeads,
      convertedLeads,
      conversionRate: totalLeads
        ? new Prisma.Decimal(convertedLeads).mul(100).div(totalLeads).toFixed(2) + '%'
        : '0%',
      byStatus,
    };
  }
}
