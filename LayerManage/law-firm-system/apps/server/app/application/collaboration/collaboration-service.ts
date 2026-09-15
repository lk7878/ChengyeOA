import { LeadService } from '../crm/lead-service';
import { LeadFollowService, LEAD_FOLLOW_TYPES } from '../crm/lead-follow-service';
import { LeadAssignmentService } from '../crm/lead-assignment-service';
import { buildLeadScopeWhere } from '../crm/lead-scope';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuthorizationService } from '../authorization/authorization-service';
import { LEAD_STATUS, canTransition, LeadStatus, REACTIVATE_ENABLED } from '../../domain/crm/lead-policy';
import { businessFields, WorkspaceBusinessTable } from '../crm/workspace-business-table';
import { createHash, randomUUID } from 'node:crypto';
import { CollabField, CollabRecord, Prisma, PrismaClient } from '@prisma/client';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuthorizationContext } from '../authorization/authorization-service';
import {
  boolean,
  choice,
  exact,
  fail,
  FIELD_TYPES,
  fieldExpression,
  fieldOf,
  filterSql,
  integer,
  isSystemField,
  json,
  object,
  ObjectValue,
  strings,
  text,
  validateOptions,
  validateValue,
  validateView,
  VIEW_TYPES,
  ViewConfig,
} from './collaboration-policy';

import { accessInput, resourcePolicy } from './resource-access';

type Tx = Prisma.TransactionClient;
const levels: Record<string, number> = { READER: 1, EDITOR: 2, MANAGER: 3, OWNER: 4 };
export interface Access {
  level: number;
  canCreate: boolean;
  canManageAccess: boolean;
  selfOnly: boolean;
  hidden: string[];
  readonly: string[];
  workspaceId: string;
  organizationId: string;
}

export class CollaborationService {
  constructor(
    readonly db: PrismaClient,
    readonly actor: AuthorizationContext,
  ) {}
  private async principals(tx: Tx): Promise<Array<{ principalType: string; principalId: string }>> {
    const result = [{ principalType: 'USER', principalId: this.actor.userId }];
    if (!this.actor.employeeId) return result;
    const employee = await tx.employee.findFirst({
      where: { id: this.actor.employeeId, deletedAt: null, status: { not: 'LEAVED' } },
    });
    if (!employee) return [];
    const now = new Date();
    const [assignments, teams] = await Promise.all([
      tx.employeeAssignment.findMany({
        where: {
          employeeId: this.actor.employeeId,
          startedAt: { lte: now },
          OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        },
        include: { organization: true, position: true },
      }),
      tx.professionalTeamMember.findMany({
        where: { employeeId: this.actor.employeeId, endedAt: null, professionalTeam: { status: 'ENABLED' } },
      }),
    ]);
    for (const assignment of assignments) {
      if (assignment.organization.status !== 'ENABLED' || assignment.position.status !== 'ENABLED') continue;
      result.push({ principalType: 'POSITION', principalId: assignment.positionId });
      const ancestors = await tx.organization.findMany({
        where: {
          status: 'ENABLED',
          OR: [
            { id: assignment.organizationId },
            { id: { in: assignment.organization.path.split('/').filter(Boolean) } },
          ],
        },
        select: { id: true },
      });
      result.push(...ancestors.map((o) => ({ principalType: 'ORG', principalId: o.id })));
      result.push({ principalType: 'ORG', principalId: assignment.organizationId });
    }
    result.push(...teams.map((t) => ({ principalType: 'TEAM', principalId: t.professionalTeamId })));
    return result;
  }
  async access(workspaceId: string, tx: Tx = this.db, level = 1): Promise<Access> {
    const w = await tx.collabWorkspace.findUnique({ where: { id: workspaceId } });
    if (!w) fail('COLLAB_NOT_FOUND', 404);
    const members = await tx.collabMember.findMany({ where: { workspaceId, OR: await this.principals(tx) } });
    // A resource owner is explicit, never inferred from a system administrator flag.
    const effective = Math.max(0, ...members.map((m) => levels[m.role] ?? 0));
    if (effective < level) fail('COLLAB_FORBIDDEN', 403);
    return {
      level: effective,
      canCreate: effective >= 3 || (effective >= 2 && members.some((m) => m.canCreate)),
      selfOnly: effective === 4 ? false : members.every((m) => m.rowScope === 'SELF'),
      canManageAccess:
        effective === 4 ||
        (effective >= 3 &&
          members.some((m) => m.canManageAccess && m.rowScope === 'ALL') &&
          members.every((m) => !m.hiddenFields.length && !m.readonlyFields.length)),
      hidden: [...new Set(members.flatMap((m) => m.hiddenFields))],
      readonly: [...new Set(members.flatMap((m) => m.readonlyFields))],
      workspaceId,
      organizationId: w.organizationId,
    };
  }
  private async restrict(parent: Access, raw: unknown, tx: Tx): Promise<Access> {
    if (parent.level === 4) return parent;
    const policy = resourcePolicy(raw);
    const principals = await this.principals(tx);
    const grants = policy.grants.filter((g) =>
      principals.some((p) => p.principalType === g.principalType && p.principalId === g.principalId),
    );
    if (grants.some((g) => g.role === 'DENY') || (policy.restricted && !grants.length))
      fail('COLLAB_FORBIDDEN', 403);
    if (!grants.length) return parent;
    return {
      ...parent,
      level: Math.min(parent.level, Math.max(...grants.map((g) => levels[g.role] ?? 0))),
      canCreate:
        parent.canCreate && grants.some((g) => levels[g.role] >= 3 || (levels[g.role] >= 2 && g.canCreate)),
      selfOnly: parent.selfOnly || grants.every((g) => g.rowScope === 'SELF'),
      hidden: [...new Set([...parent.hidden, ...grants.flatMap((g) => g.hiddenFields)])],
      readonly: [...new Set([...parent.readonly, ...grants.flatMap((g) => g.readonlyFields)])],
    };
  }
  async baseAccess(baseId: string, tx: Tx = this.db, level = 1) {
    const base = await tx.collabBase.findUnique({ where: { id: baseId } });
    if (!base) fail('COLLAB_NOT_FOUND', 404);
    const access = await this.restrict(await this.access(base.workspaceId, tx), base.accessPolicy, tx);
    if (access.level < level) fail('COLLAB_FORBIDDEN', 403);
    return { base, access };
  }
  async tableAccess(tableId: string, tx: Tx = this.db, level = 1, allowArchived = false) {
    const table = await tx.collabTable.findUnique({
      where: { id: tableId },
      include: { fields: { orderBy: { position: 'asc' } } },
    });
    if (!table || (table.archived && !allowArchived)) fail('COLLAB_NOT_FOUND', 404);
    const parent = await this.baseAccess(table.baseId, tx);
    // Creator management is an inherited capability, never an override of a child ACL.
    if (
      !table.accessPolicy &&
      !parent.base.accessPolicy &&
      table.createdBy === this.actor.userId &&
      parent.access.level >= 2 &&
      parent.access.canCreate
    )
      parent.access.level = Math.max(parent.access.level, 3);
    const access = await this.restrict(parent.access, table.accessPolicy, tx);
    if (access.level < level) fail('COLLAB_FORBIDDEN', 403);
    const visible = table.fields.filter((f) => !f.archived && !access.hidden.includes(f.id));
    return {
      table,
      access,
      fields:
        table.source === 'CUSTOM'
          ? visible
          : new WorkspaceBusinessTable(this.db, this.actor).visibleFields(table.source, visible),
    };
  }
  private async requireAccessAdmin(workspaceId: string, tx: Tx = this.db) {
    const access = await this.access(workspaceId, tx);
    if (!access.canManageAccess) fail('COLLAB_FORBIDDEN', 403);
    return access;
  }
  private async resource(kind: 'BASE' | 'TABLE', id: string, tx: Tx) {
    const table = kind === 'TABLE' ? await tx.collabTable.findUnique({ where: { id } }) : null;
    const base = await tx.collabBase.findUnique({
      where: { id: kind === 'BASE' ? id : (table?.baseId ?? '') },
    });
    if (!base || (kind === 'TABLE' && !table)) fail('COLLAB_NOT_FOUND', 404);
    await this.requireAccessAdmin(base.workspaceId, tx);
    return { target: table ?? base, base };
  }
  async resourceAccess(kind: 'BASE' | 'TABLE', id: string) {
    const { target, base } = await this.resource(kind, id, this.db);
    return {
      version: target.accessVersion,
      policy: resourcePolicy(target.accessPolicy),
      members: await this.db.collabMember.findMany({ where: { workspaceId: base.workspaceId } }),
    };
  }
  async saveResourceAccess(kind: 'BASE' | 'TABLE', id: string, raw: unknown, key: unknown) {
    const input = accessInput(raw);
    const initial = await this.resource(kind, id, this.db);
    return this.write(key, ['resource.access', kind, id, input], async (tx) => {
      await this.lock(tx, initial.base.workspaceId);
      const { target, base } = await this.resource(kind, id, tx);
      if (target.accessVersion !== input.version) fail('COLLAB_ACCESS_CONFLICT', 409);
      const members = await tx.collabMember.findMany({ where: { workspaceId: base.workspaceId } });
      for (const grant of input.policy.grants) {
        if (
          !members.some(
            (m) =>
              m.principalType === grant.principalType &&
              m.principalId === grant.principalId &&
              m.role !== 'OWNER',
          )
        )
          fail('COLLAB_MEMBER_UNAVAILABLE');
        const ids = [...new Set([...grant.hiddenFields, ...grant.readonlyFields])];
        const count = await tx.collabField.count({
          where: { id: { in: ids }, ...(kind === 'TABLE' ? { tableId: id } : { table: { baseId: id } }) },
        });
        if (count !== ids.length) fail('COLLAB_INVALID_ACCESS');
      }
      const data = {
        accessPolicy:
          !input.policy.restricted && input.policy.grants.length === 0 ? Prisma.DbNull : json(input.policy),
        accessVersion: { increment: 1 },
      };
      if (kind === 'BASE') await tx.collabBase.update({ where: { id }, data });
      else await tx.collabTable.update({ where: { id }, data });
      await this.event(tx, base.id, 'access.updated', id);
      return { id, version: target.accessVersion + 1 };
    });
  }
  private async lock(tx: Tx, workspaceId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM collab_workspace WHERE id = ${workspaceId} FOR UPDATE`);
  }
  private async write<T>(key: unknown, payload: unknown, callback: (tx: Tx) => Promise<T>): Promise<T> {
    const mutationKey = text(key, 120);
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${this.actor.userId + ':' + mutationKey}, 0))`,
          );
          const existing = await tx.collabMutation.findUnique({
            where: { actorId_key: { actorId: this.actor.userId, key: mutationKey } },
          });
          if (existing) {
            if (existing.fingerprint !== fingerprint) fail('COLLAB_IDEMPOTENCY_CONFLICT', 409);
            return existing.result as T;
          }
          const result = await callback(tx);
          await tx.collabMutation.create({
            data: { actorId: this.actor.userId, key: mutationKey, fingerprint, result: json(result) },
          });
          return result;
        },
        { timeout: 15000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        fail('COLLAB_NAME_OR_ID_CONFLICT', 409);
      throw error;
    }
  }
  private async event(tx: Tx, baseId: string, kind: string, targetId: string) {
    await tx.collabEvent.create({ data: { baseId, kind } });
    await new PrismaEventOutboxWriter().append(tx, {
      eventType: 'collaboration.changed',
      eventVersion: 1,
      objectType: 'COLLAB_BASE',
      objectId: baseId,
      operatorUserId: this.actor.userId,
      organizationId: null,
      branchId: null,
      teamId: null,
      payload: { baseId },
      traceId: randomUUID(),
      occurredAt: new Date(),
    });
    await tx.operationLog.create({
      data: { userId: this.actor.userId, action: kind, targetType: 'COLLAB', targetId },
    });
  }
  async listWorkspaces() {
    const members = await this.db.collabMember.findMany({
      where: { OR: await this.principals(this.db) },
      select: { workspaceId: true },
    });
    const workspaces = await this.db.collabWorkspace.findMany({
      where: { id: { in: members.map((m) => m.workspaceId) } },
      include: { bases: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    for (const workspace of workspaces) {
      const permitted = [] as typeof workspace.bases;
      for (const base of workspace.bases) {
        try {
          await this.baseAccess(base.id);
          permitted.push({ ...base, accessPolicy: null as null });
        } catch (error) {
          if ((error as { code?: string }).code !== 'COLLAB_FORBIDDEN') throw error;
        }
      }
      workspace.bases = permitted;
    }
    return {
      workspaces,
      canCreate:
        this.actor.isSystemSuperAdmin ||
        this.actor.permissionCodes.some((p) => String(p) === 'workspace.create'),
    };
  }
  async createWorkspace(raw: unknown, key: unknown) {
    const input = exact(raw, ['name', 'organizationId']);
    if (
      !this.actor.isSystemSuperAdmin &&
      !this.actor.permissionCodes.some((p) => String(p) === 'workspace.create')
    )
      fail('COLLAB_FORBIDDEN', 403);
    const organizationId = text(input.organizationId);
    const name = text(input.name);
    return this.write(key, ['workspace.create', input], async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      if (!org || org.status !== 'ENABLED') fail('COLLAB_ORGANIZATION_UNAVAILABLE');
      if (
        !this.actor.isSystemSuperAdmin &&
        !(await this.principals(tx)).some(
          (p) => p.principalType === 'ORG' && p.principalId === organizationId,
        )
      )
        fail('COLLAB_FORBIDDEN', 403);
      const w = await tx.collabWorkspace.create({
        data: { organizationId, name, ownerId: this.actor.userId },
      });
      await tx.collabMember.create({
        data: {
          workspaceId: w.id,
          principalId: this.actor.userId,
          role: 'OWNER',
          canCreate: true,
          rowScope: 'ALL',
        },
      });
      await tx.operationLog.create({
        data: {
          userId: this.actor.userId,
          action: 'workspace.created',
          targetType: 'COLLAB',
          targetId: w.id,
        },
      });
      return { id: w.id };
    });
  }
  async createBase(workspaceId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['name']);
    await this.access(workspaceId, this.db, 3);
    return this.write(key, ['base.create', workspaceId, input], async (tx) => {
      await this.lock(tx, workspaceId);
      await this.access(workspaceId, tx, 3);
      const base = await tx.collabBase.create({ data: { workspaceId, name: text(input.name) } });
      await this.event(tx, base.id, 'base.created', base.id);
      return { id: base.id };
    });
  }
  async listTables(baseId: string) {
    const { base, access } = await this.baseAccess(baseId);
    const tables = await this.db.collabTable.findMany({
      where: { baseId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, source: true, position: true, schemaVersion: true, archived: true },
    });
    const visible = [] as typeof tables;
    for (const table of tables) {
      try {
        const result = await this.tableAccess(table.id, this.db, 1, true);
        if (!table.archived || result.access.level >= 3) visible.push(table);
      } catch (error) {
        if (!['COLLAB_FORBIDDEN', 'COLLAB_NOT_FOUND'].includes((error as { code?: string }).code ?? ''))
          throw error;
      }
    }
    return { base: { ...base, accessPolicy: null as null }, access, tables: visible };
  }
  async createTable(baseId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['name', 'template', 'source']);
    const source = choice(input.source ?? 'CUSTOM', ['CUSTOM', 'LEADS', 'FOLLOWS']);
    if (source !== 'CUSTOM') new WorkspaceBusinessTable(this.db, this.actor).authorize();
    const initial = await this.baseAccess(baseId);
    if (!initial.access.canCreate || (source !== 'CUSTOM' && initial.access.level < 4))
      fail('COLLAB_FORBIDDEN', 403);
    return this.write(key, ['table.create', baseId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { access } = await this.baseAccess(baseId, tx);
      if (!access.canCreate || (source !== 'CUSTOM' && access.level < 4)) fail('COLLAB_FORBIDDEN', 403);
      const table = await tx.collabTable.create({
        data: {
          baseId,
          source,
          name: text(input.name),
          createdBy: this.actor.userId,
          position: await tx.collabTable.count({ where: { baseId } }),
        },
      });
      if (source !== 'CUSTOM') {
        await tx.collabField.createMany({
          data: businessFields(source).map((f) => ({ ...f, tableId: table.id })),
        });
      } else {
        const template = choice(input.template ?? 'BLANK', ['BLANK', 'TASKS', 'CONTACTS']);
        await tx.collabField.create({
          data: { tableId: table.id, name: '标题', type: 'TEXT', required: true },
        });
        if (template !== 'BLANK') {
          await tx.collabField.create({
            data: { tableId: table.id, name: '负责人', type: 'USER', position: 1 },
          });
          await tx.collabField.create({
            data: {
              tableId: table.id,
              name: template === 'TASKS' ? '截止日期' : '下次联系',
              type: 'DATE',
              position: 2,
            },
          });
          await tx.collabField.create({
            data: {
              tableId: table.id,
              name: '状态',
              type: 'SINGLE_SELECT',
              position: 3,
              options: {
                choices: [
                  { id: 'todo', name: '待处理' },
                  { id: 'doing', name: '进行中' },
                  { id: 'done', name: '已完成' },
                ],
              },
            },
          });
        }
      }
      const view = await tx.collabView.create({
        data: { tableId: table.id, name: '总表', ownerId: this.actor.userId, shared: true, isDefault: true },
      });
      await this.event(tx, baseId, 'table.created', table.id);
      return { id: table.id, viewId: view.id };
    });
  }
  async describe(tableId: string) {
    const { table, access, fields } = await this.tableAccess(tableId);
    const views = await this.db.collabView.findMany({
      where: { tableId, OR: [{ shared: true }, { ownerId: this.actor.userId }] },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const preference = await this.db.collabPreference.findUnique({
      where: { userId_tableId: { userId: this.actor.userId, tableId } },
    });
    return {
      table: { ...table, accessPolicy: null as null, fields: [] as CollabField[] },
      access,
      fields: fields.map((f) => ({
        ...f,
        queryable:
          table.source === 'CUSTOM' || !['phone', 'wechat'].includes(String(object(f.options).businessKey)),
        writable:
          (table.source === 'CUSTOM' ||
            (!object(f.options).businessKey && this.actor.permissionCodes.includes('lead.update'))) &&
          access.level >= 2 &&
          !access.readonly.includes(f.id) &&
          !isSystemField(f),
      })),
      views: views.map((v) => ({ ...v, config: this.sanitizeConfig(v.config, fields) })),
      preferredViewId: preference?.viewId,
      userId: this.actor.userId,
      employeeId: this.actor.employeeId,
    };
  }
  private sanitizeConfig(raw: unknown, fields: CollabField[]): ViewConfig {
    const c = object(raw) as ViewConfig;
    const ids = new Set(fields.map((f) => f.id));
    // A shared filter mentioning a forbidden field cannot be exposed or silently removed.
    if (c.filter) {
      try {
        filterSql(c.filter, fields, this.actor.userId, this.actor.employeeId);
      } catch {
        return { visibleFields: [], filter: { fieldId: '__restricted__', operator: 'eq', value: '' } };
      }
    }
    return {
      ...c,
      dateFieldId: ids.has(c.dateFieldId) ? c.dateFieldId : undefined,
      endDateFieldId: ids.has(c.endDateFieldId) ? c.endDateFieldId : undefined,
      colorFieldId: ids.has(c.colorFieldId) ? c.colorFieldId : undefined,
      visibleFields: c.visibleFields?.filter((id) => ids.has(id)),
      groupBy: c.groupBy?.filter((id) => ids.has(id)),
      sorts: c.sorts?.filter((s) => ids.has(s.fieldId)),
      widths: c.widths
        ? Object.fromEntries(Object.entries(c.widths).filter(([id]) => ids.has(id)))
        : undefined,
    };
  }
  async mutateTable(tableId: string, raw: unknown, key: unknown) {
    const input = exact(raw, ['name', 'position', 'archived', 'duplicate', 'version']);
    const initial = await this.tableAccess(tableId, this.db, 3, true);
    return this.write(key, ['table.update', tableId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { table } = await this.tableAccess(tableId, tx, 3, true);
      if (table.schemaVersion !== integer(input.version)) fail('COLLAB_SCHEMA_CONFLICT', 409);
      if (input.duplicate) {
        if (table.source !== 'CUSTOM') fail('COLLAB_USE_BUSINESS_ACTION', 409);
        const visible = await this.tableAccess(tableId, tx);
        if (visible.access.hidden.length) fail('COLLAB_FORBIDDEN', 403);
        const copy = await tx.collabTable.create({
          data: {
            baseId: table.baseId,
            name: text(input.name),
            createdBy: this.actor.userId,
            position: table.position + 1,
          },
        });
        const mapping = new Map<string, string>();
        for (const f of table.fields.filter((f) => !f.archived)) {
          const id = randomUUID();
          mapping.set(f.id, id);
          await tx.collabField.create({
            data: {
              ...f,
              id,
              tableId: copy.id,
              defaultValue: f.defaultValue === null ? Prisma.DbNull : json(f.defaultValue),
            },
          });
        }
        const views = await tx.collabView.findMany({ where: { tableId, shared: true } });
        for (const v of views) {
          let config = JSON.stringify(v.config);
          for (const [oldId, id] of mapping) config = config.replaceAll(oldId, id);
          await tx.collabView.create({
            data: {
              ...v,
              id: randomUUID(),
              tableId: copy.id,
              ownerId: this.actor.userId,
              config: JSON.parse(config),
              version: 1,
            },
          });
        }
        await this.event(tx, table.baseId, 'table.created', copy.id);
        return { id: copy.id };
      }
      if (input.archived === true) {
        const references = await tx.collabField.count({
          where: {
            archived: false,
            type: 'RELATION',
            options: { path: ['targetTableId'], equals: tableId },
            tableId: { not: tableId },
          },
        });
        if (references) fail('COLLAB_REFERENCED_TABLE', 409, { references });
        if (await tx.collabRule.count({ where: { tableId, enabled: true } })) fail('COLLAB_ACTIVE_RULE', 409);
      }
      await tx.collabTable.update({
        where: { id: tableId },
        data: {
          name: input.name === undefined ? undefined : text(input.name),
          position: input.position === undefined ? undefined : integer(input.position, 0),
          archived: input.archived === undefined ? undefined : boolean(input.archived),
          schemaVersion: { increment: 1 },
        },
      });
      await this.event(tx, table.baseId, 'table.updated', tableId);
      return { id: tableId, version: table.schemaVersion + 1 };
    });
  }
  async saveField(tableId: string, fieldId: string | undefined, raw: unknown, key: unknown) {
    const input = exact(raw, [
      'name',
      'type',
      'required',
      'options',
      'defaultValue',
      'position',
      'archived',
      'version',
    ]);
    const initial = await this.tableAccess(tableId, this.db, 3);
    return this.write(key, ['field.save', tableId, fieldId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { table, fields } = await this.tableAccess(tableId, tx, 3);
      if (table.schemaVersion !== integer(input.version)) fail('COLLAB_SCHEMA_CONFLICT', 409);
      const previous = fieldId ? table.fields.find((f) => f.id === fieldId) : undefined;
      if (fieldId && !previous) fail('COLLAB_NOT_FOUND', 404);
      if (fieldId && !fields.some((f) => f.id === fieldId)) fail('COLLAB_FORBIDDEN', 403);
      if (previous && object(previous.options).businessKey) fail('COLLAB_USE_BUSINESS_ACTION', 409);
      const type = choice(input.type ?? previous?.type, FIELD_TYPES);
      if (table.source !== 'CUSTOM' && isSystemField({ type })) fail('COLLAB_USE_BUSINESS_ACTION', 409);
      const countValues = (values: Prisma.JsonFilter) =>
        table.source === 'CUSTOM'
          ? tx.collabRecord.count({ where: { tableId, values } })
          : tx.collabExtension.count({ where: { tableId, values } });
      if (
        previous &&
        previous.type !== type &&
        (await countValues({ path: [previous.id], not: Prisma.DbNull }))
      )
        fail('COLLAB_FIELD_MIGRATION_REQUIRED', 409);
      const required = input.required === undefined ? (previous?.required ?? false) : boolean(input.required);
      if (table.source === 'CUSTOM' && required && !previous?.required) {
        const missing = await tx.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT count(*) FROM collab_record WHERE "tableId" = ${tableId} AND archived = false AND ("values" ->> ${fieldId ?? ''} IS NULL OR "values" ->> ${fieldId ?? ''} IN ('', '[]'))`,
        );
        if (Number(missing[0].count)) fail('COLLAB_REQUIRED_BACKFILL_REQUIRED', 409);
      }
      const options = validateOptions(type, input.options ?? previous?.options ?? {});
      if (previous && ['SINGLE_SELECT', 'MULTI_SELECT'].includes(type)) {
        const nextIds = new Set((options.choices as Array<{ id: string }>).map((o) => o.id));
        const removed = ((object(previous.options).choices ?? []) as Array<{ id: string }>).filter(
          (o) => !nextIds.has(o.id),
        );
        for (const option of removed)
          if (
            await countValues(
              type === 'SINGLE_SELECT'
                ? { path: [previous.id], equals: option.id }
                : { path: [previous.id], array_contains: [option.id] },
            )
          )
            fail('COLLAB_OPTION_IN_USE', 409);
      }
      if (
        previous?.type === 'RELATION' &&
        options.targetTableId !== object(previous.options).targetTableId &&
        (await countValues({ path: [previous.id], not: Prisma.DbNull }))
      )
        fail('COLLAB_FIELD_MIGRATION_REQUIRED', 409);
      if (type === 'RELATION') {
        const target = await this.tableAccess(text(options.targetTableId), tx);
        if (target.table.source !== 'CUSTOM') fail('COLLAB_CORE_RELATION_UNSUPPORTED');
        if (target.access.workspaceId !== initial.access.workspaceId) fail('COLLAB_CROSS_WORKSPACE_RELATION');
      }
      if (input.archived === true && previous) {
        if (previous.position === 0) fail('COLLAB_TITLE_FIELD_REQUIRED', 409);
        const views = await tx.collabView.findMany({ where: { tableId } });
        if (
          views.some(
            (v) =>
              JSON.stringify(object(v.config).filter ?? {}).includes(previous.id) ||
              JSON.stringify(object(v.config).sorts ?? []).includes(previous.id) ||
              JSON.stringify(object(v.config).groupBy ?? []).includes(previous.id),
          )
        )
          fail('COLLAB_REFERENCED_FIELD', 409);
      }
      if (!fieldId && table.fields.filter((f) => !f.archived).length >= 100) fail('COLLAB_FIELD_LIMIT');
      const data = {
        name: text(input.name ?? previous?.name),
        type,
        required,
        options: json(options),
        position:
          input.position === undefined
            ? (previous?.position ?? table.fields.length)
            : integer(input.position, 0),
        archived: input.archived === undefined ? (previous?.archived ?? false) : boolean(input.archived),
      };
      const fake = { ...previous, ...data, id: fieldId ?? 'new' } as CollabField;
      const defaultValue = input.defaultValue === undefined ? previous?.defaultValue : input.defaultValue;
      const validatedDefault =
        defaultValue === null || defaultValue === undefined
          ? Prisma.DbNull
          : json(validateValue(fake, defaultValue));
      const field = fieldId
        ? await tx.collabField.update({
            where: { id: fieldId },
            data: { ...data, defaultValue: validatedDefault },
          })
        : await tx.collabField.create({ data: { ...data, tableId, defaultValue: validatedDefault } });
      await tx.collabTable.update({ where: { id: tableId }, data: { schemaVersion: { increment: 1 } } });
      await this.event(tx, table.baseId, 'schema.updated', tableId);
      return { id: field.id, version: table.schemaVersion + 1 };
    });
  }
  async saveView(tableId: string, viewId: string | undefined, raw: unknown, key: unknown) {
    const input = exact(raw, [
      'name',
      'type',
      'shared',
      'config',
      'position',
      'version',
      'remove',
      'default',
    ]);
    const initial = await this.tableAccess(tableId);
    return this.write(key, ['view.save', tableId, viewId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { table, access, fields } = await this.tableAccess(tableId, tx);
      const previous = viewId
        ? await tx.collabView.findFirst({
            where: { id: viewId, tableId, OR: [{ shared: true }, { ownerId: this.actor.userId }] },
          })
        : null;
      if (viewId && !previous) fail('COLLAB_NOT_FOUND', 404);
      if (input.default && previous) {
        await tx.collabPreference.upsert({
          where: { userId_tableId: { userId: this.actor.userId, tableId } },
          create: { userId: this.actor.userId, tableId, viewId },
          update: { viewId },
        });
        return { id: viewId };
      }
      const shared = input.shared === undefined ? (previous?.shared ?? false) : boolean(input.shared);
      if ((shared || previous?.shared) && access.level < 3) fail('COLLAB_FORBIDDEN', 403);
      if (previous && !previous.shared && previous.ownerId !== this.actor.userId)
        fail('COLLAB_FORBIDDEN', 403);
      if (previous && previous.version !== integer(input.version)) fail('COLLAB_VIEW_CONFLICT', 409);
      if (previous?.isDefault && (input.remove || !shared)) fail('COLLAB_DEFAULT_VIEW_REQUIRED', 409);
      if (input.remove && previous) {
        await tx.collabView.delete({ where: { id: viewId } });
        await this.event(tx, table.baseId, 'view.updated', tableId);
        return { id: viewId };
      }
      const config = validateView(input.config ?? previous?.config ?? {}, fields);
      if (table.source !== 'CUSTOM')
        new WorkspaceBusinessTable(this.db, this.actor).validateConfig(table.source, fields, config);
      const data = {
        name: text(input.name ?? previous?.name),
        type: choice(input.type ?? previous?.type ?? 'GRID', VIEW_TYPES),
        shared,
        config: json(config),
        position: input.position === undefined ? (previous?.position ?? 0) : integer(input.position, 0),
      };
      const view = previous
        ? await tx.collabView.update({ where: { id: viewId }, data: { ...data, version: { increment: 1 } } })
        : await tx.collabView.create({ data: { ...data, tableId, ownerId: this.actor.userId } });
      await this.event(tx, table.baseId, 'view.updated', tableId);
      return { id: view.id, version: view.version };
    });
  }
  private rowWhere(tableId: string, access: Access): Prisma.CollabRecordWhereInput {
    return { tableId, archived: false, ...(access.selfOnly ? { createdBy: this.actor.userId } : {}) };
  }
  async attachment(tableId: string, fileId: string, tx: Tx = this.db) {
    const { access, fields, table } = await this.tableAccess(tableId, tx);
    const file = await tx.collabAttachment.findFirst({ where: { id: fileId, tableId } });
    if (!file) fail('COLLAB_NOT_FOUND', 404);
    if (table.source !== 'CUSTOM') {
      const source = await new WorkspaceBusinessTable(this.db, this.actor).sourceSql(table, access, fields);
      const visible = fields
        .filter((f) => f.type === 'FILE')
        .map((f) => Prisma.sql`r."values" -> ${f.id} @> ${JSON.stringify([fileId])}::jsonb`);
      const permitted = visible.length
        ? await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`WITH r AS (${source}) SELECT id FROM r WHERE ${Prisma.join(visible, ' OR ')} LIMIT 1`,
          )
        : [];
      if (!permitted.length) {
        const referenced = await tx.collabExtension.count({
          where: {
            tableId,
            OR: table.fields
              .filter((f) => f.type === 'FILE')
              .map((f) => ({ values: { path: [f.id], array_contains: [fileId] } })),
          },
        });
        if (referenced || file.ownerId !== this.actor.userId) fail('COLLAB_FORBIDDEN', 403);
      }
      return file;
    }
    const references = (items: CollabField[]) =>
      items
        .filter((f) => f.type === 'FILE')
        .map((f) => ({ values: { path: [f.id], array_contains: [fileId] } }));
    const visible = await tx.collabRecord.findFirst({
      where: { ...this.rowWhere(tableId, access), OR: references(fields) },
      select: { id: true },
    });
    if (!visible) {
      const referenced = await tx.collabRecord.count({ where: { tableId, OR: references(table.fields) } });
      if (referenced || file.ownerId !== this.actor.userId) fail('COLLAB_FORBIDDEN', 403);
    }
    return file;
  }
  private project(record: CollabRecord, fields: CollabField[]) {
    const values: ObjectValue = {};
    const original = object(record.values);
    for (const f of fields) {
      const system: ObjectValue = {
        CREATED_BY: record.createdBy,
        UPDATED_BY: record.updatedBy,
        CREATED_AT: record.createdAt.toISOString(),
        UPDATED_AT: record.updatedAt.toISOString(),
      };
      values[f.id] = isSystemField(f) ? system[f.type] : (original[f.id] ?? null);
    }
    return { ...record, values };
  }
  private async projectReferences(records: CollabRecord[], fields: CollabField[]) {
    const projected = records.map((record) => this.project(record, fields));
    for (const field of fields.filter((f) => f.type === 'RELATION')) {
      const targetId = text(object(field.options).targetTableId);
      const ids = [
        ...new Set(
          projected.flatMap((r) =>
            Array.isArray(r.values[field.id]) ? (r.values[field.id] as string[]) : [],
          ),
        ),
      ];
      let permitted = new Set<string>();
      try {
        const { access } = await this.tableAccess(targetId);
        permitted = new Set(
          (
            await this.db.collabRecord.findMany({
              where: { ...this.rowWhere(targetId, access), id: { in: ids } },
              select: { id: true },
            })
          ).map((r) => r.id),
        );
      } catch (e) {
        if (!['COLLAB_FORBIDDEN', 'COLLAB_NOT_FOUND'].includes((e as Error).message)) throw e;
      }
      for (const record of projected)
        record.values[field.id] = (
          Array.isArray(record.values[field.id]) ? (record.values[field.id] as string[]) : []
        ).filter((id) => permitted.has(id));
    }
    return projected;
  }
  async query(tableId: string, raw: unknown) {
    const input = exact(raw, ['viewId', 'config', 'page', 'pageSize']);
    const { table, access, fields } = await this.tableAccess(tableId);
    const view = input.viewId
      ? await this.db.collabView.findFirst({
          where: { id: text(input.viewId), tableId, OR: [{ shared: true }, { ownerId: this.actor.userId }] },
        })
      : null;
    if (input.viewId && !view) fail('COLLAB_NOT_FOUND', 404);
    const config = validateView(input.config ?? view?.config ?? {}, fields);
    const page = integer(input.page ?? 1, 1, 100000);
    const pageSize = integer(input.pageSize ?? 50, 1, 200);
    if (table.source !== 'CUSTOM') {
      const result = await new WorkspaceBusinessTable(this.db, this.actor).query(
        table,
        access,
        fields,
        config,
        page,
        pageSize,
      );
      return { ...result, records: await this.projectReferences(result.records, fields) };
    }
    const where = Prisma.sql`r."tableId" = ${tableId} AND r.archived = false AND ${access.selfOnly ? Prisma.sql`r."createdBy" = ${this.actor.userId}` : Prisma.sql`TRUE`} AND ${filterSql(config.filter, fields, this.actor.userId, this.actor.employeeId)}`;
    const ordering = (config.sorts ?? []).map(
      (s) =>
        Prisma.sql`${fieldExpression(fieldOf(fields, s.fieldId))} ${s.direction === 'desc' ? Prisma.sql`DESC NULLS LAST` : Prisma.sql`ASC NULLS LAST`}`,
    );
    ordering.push(Prisma.sql`r."createdAt" ASC`, Prisma.sql`r.id ASC`);
    const [records, count] = await this.db.$transaction(
      [
        this.db.$queryRaw<CollabRecord[]>(
          Prisma.sql`SELECT r.* FROM collab_record r WHERE ${where} ORDER BY ${Prisma.join(ordering)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        ),
        this.db.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT count(*) FROM collab_record r WHERE ${where}`,
        ),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    let groups: Array<{ keys: unknown[]; count: number }> = [];
    if (config.groupBy?.length) {
      const expr = config.groupBy.map((id) => fieldExpression(fieldOf(fields, id)));
      const rows = await this.db.$queryRaw<Array<{ keys: unknown[]; count: bigint }>>(
        Prisma.sql`SELECT jsonb_build_array(${Prisma.join(expr)}) as keys, count(*) FROM collab_record r WHERE ${where} GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 201`,
      );
      groups = rows.map((r) => ({ keys: r.keys, count: Number(r.count) }));
    }
    return {
      records: await this.projectReferences(records, fields),
      total: Number(count[0].count),
      page,
      pageSize,
      groups: groups.slice(0, 200),
      groupsTruncated: groups.length > 200,
      schemaVersion: table.schemaVersion,
    };
  }
  async record(tableId: string, recordId: string) {
    const { table, access, fields } = await this.tableAccess(tableId);
    if (table.source !== 'CUSTOM') {
      const result = await new WorkspaceBusinessTable(this.db, this.actor).query(
        table,
        access,
        fields,
        {},
        1,
        1,
        recordId,
      );
      if (!result.records.length) fail('COLLAB_NOT_FOUND', 404);
      const revisions = await this.db.collabExtensionRevision.findMany({
        where: { tableId, recordId },
        orderBy: { version: 'desc' },
        take: 50,
      });
      return {
        record: (await this.projectReferences(result.records, fields))[0],
        revisions: revisions.map((r) => ({
          ...r,
          changes: Object.fromEntries(
            Object.entries(object(r.changes)).filter(([id]) =>
              fields.some((f) => f.id === id && !['FILE', 'RELATION'].includes(f.type)),
            ),
          ),
        })),
        comments: [] as never[],
      };
    }
    const record = await this.db.collabRecord.findFirst({
      where: { ...this.rowWhere(tableId, access), id: recordId },
    });
    if (!record) fail('COLLAB_NOT_FOUND', 404);
    const revisions = await this.db.collabRevision.findMany({
      where: { recordId },
      orderBy: { version: 'desc' },
      take: 50,
    });
    const comments = await this.db.collabComment.findMany({
      where: { recordId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return {
      record: (await this.projectReferences([record], fields))[0],
      revisions: revisions.map((r) => ({
        ...r,
        changes: Object.fromEntries(
          Object.entries(object(r.changes)).filter(([id]) =>
            fields.some((f) => f.id === id && !['FILE', 'RELATION'].includes(f.type)),
          ),
        ),
      })),
      comments,
    };
  }
  private async businessLead(tableId: string, recordId: string, tx: Tx = this.db, level = 1) {
    const result = await this.tableAccess(tableId, tx, level);
    if (result.table.source !== 'LEADS') fail('COLLAB_INVALID_SOURCE');
    const lead = await tx.lead.findFirst({
      where: {
        AND: [
          await new WorkspaceBusinessTable(this.db, this.actor).scope(result.access),
          { id: recordId },
          ...(result.access.selfOnly ? [{ createdBy: this.actor.userId }] : []),
        ],
      },
    });
    if (!lead) fail('COLLAB_NOT_FOUND', 404);
    return { ...result, lead };
  }
  private async businessCapabilities(tableId: string, recordId: string, tx: Tx = this.db) {
    const result = await this.businessLead(tableId, recordId, tx);
    const { lead, access, fields } = result;
    const permitted = async (code: 'lead.update' | 'lead.assign') =>
      access.level >= 2 &&
      this.actor.permissionCodes.includes(code) &&
      !!(await tx.lead.findFirst({
        where: {
          AND: [
            { id: lead.id },
            await buildLeadScopeWhere(
              this.db,
              new AuthorizationService(new DataScopeService(this.db)),
              this.actor,
              code,
            ),
          ],
        },
        select: { id: true },
      }));
    const writable = (key: string) =>
      fields.some((f) => object(f.options).businessKey === key && !access.readonly.includes(f.id));
    const update = await permitted('lead.update');
    const assign = await permitted('lead.assign');
    const stateWritable = writable('status');
    return {
      ...result,
      capabilities: {
        follow: update && (lead.status !== 'ASSIGNED' || stateWritable),
        status: update && stateWritable,
        assign:
          assign &&
          writable('assignedTo') &&
          writable('poolStatus') &&
          (lead.status !== 'NEW' || stateWritable),
      },
    };
  }
  async businessDetail(tableId: string, recordId: string, raw: unknown = {}) {
    const input = exact(raw, ['page']);
    const page = integer(input.page ?? 1, 1, 100000);
    const { lead, access, capabilities } = await this.businessCapabilities(tableId, recordId);
    const followWhere = { leadId: lead.id, ...(access.selfOnly ? { createdBy: this.actor.userId } : {}) };
    const logWhere = {
      targetType: 'LEAD',
      targetId: lead.id,
      action: {
        in: [
          'LEAD_FOLLOW_CREATE',
          'LEAD_STATUS_TRANSITION',
          'LEAD_ASSIGN',
          'LEAD_REASSIGN',
          'LEAD_POOL_CLAIM',
          'LEAD_POOL_RECYCLE',
        ],
      },
      ...(access.selfOnly ? { userId: this.actor.userId } : {}),
    };
    const [follows, followsTotal, history, historyTotal] = await this.db.$transaction(
      [
        this.db.leadFollow.findMany({
          where: followWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * 20,
          take: 20,
        }),
        this.db.leadFollow.count({ where: followWhere }),
        this.db.operationLog.findMany({
          where: logWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * 20,
          take: 20,
          select: { id: true, userId: true, action: true, createdAt: true },
        }),
        this.db.operationLog.count({ where: logWhere }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    const statuses = LEAD_STATUS.filter(
      (status) =>
        status !== 'CONVERTED' &&
        status !== 'ASSIGNED' &&
        (REACTIVATE_ENABLED || (status !== 'NURTURE' && lead.status !== 'NURTURE')) &&
        canTransition(lead.status as LeadStatus, status),
    );
    const directory = capabilities.assign ? await this.options(access.workspaceId) : null;
    return {
      version: lead.version,
      capabilities,
      statuses: capabilities.status ? statuses : [],
      assignees: directory?.employees ?? [],
      follows,
      followsTotal,
      history,
      historyTotal,
      page,
    };
  }
  async businessAction(tableId: string, recordId: string, raw: unknown, key: unknown) {
    const input = exact(raw, [
      'action',
      'version',
      'type',
      'content',
      'nextPlan',
      'nextTime',
      'status',
      'employeeId',
      'reason',
    ]);
    const action = choice(input.action, ['FOLLOW', 'STATUS', 'ASSIGN']);
    // Reject unrelated fields so a retry fingerprint always describes exactly one command.
    exact(
      input,
      action === 'FOLLOW'
        ? ['action', 'version', 'type', 'content', 'nextPlan', 'nextTime']
        : action === 'STATUS'
          ? ['action', 'version', 'status', 'reason']
          : ['action', 'version', 'employeeId', 'reason'],
    );
    const initial = await this.businessCapabilities(tableId, recordId);
    const capability = action === 'FOLLOW' ? 'follow' : action === 'STATUS' ? 'status' : 'assign';
    if (!initial.capabilities[capability]) fail('COLLAB_FORBIDDEN', 403);
    return this.write(key, ['business.action', tableId, recordId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM lead WHERE id = ${recordId} FOR UPDATE`);
      const current = await this.businessCapabilities(tableId, recordId, tx);
      if (!current.capabilities[capability]) fail('COLLAB_FORBIDDEN', 403);
      if (current.lead.version !== integer(input.version)) fail('COLLAB_RECORD_CONFLICT', 409);
      const actor = { actorUserId: this.actor.userId };
      if (action === 'FOLLOW') {
        const nextTime = input.nextTime ? new Date(text(input.nextTime)) : undefined;
        if (nextTime && !Number.isFinite(nextTime.getTime())) fail('COLLAB_INVALID_DATE');
        await new LeadFollowService(this.db, actor, this.actor).recordFollow(
          recordId,
          {
            type: choice(input.type, LEAD_FOLLOW_TYPES),
            content: text(input.content, 2000),
            nextPlan: input.nextPlan ? text(input.nextPlan, 500) : undefined,
            nextTime,
          },
          tx,
        );
      } else if (action === 'STATUS') {
        const status = choice(input.status, LEAD_STATUS);
        if (status === 'CONVERTED' || status === 'ASSIGNED') fail('COLLAB_USE_BUSINESS_ACTION', 409);
        await new LeadService(this.db, actor, this.actor).transitionStatus(
          recordId,
          status,
          text(input.reason, 500),
          tx,
        );
      } else {
        const employeeId = text(input.employeeId);
        const root = await tx.organization.findUniqueOrThrow({
          where: { id: current.access.organizationId },
        });
        const now = new Date();
        const target = await tx.employee.findFirst({
          where: {
            id: employeeId,
            status: { not: 'LEAVED' },
            deletedAt: null,
            assignments: {
              some: {
                startedAt: { lte: now },
                OR: [{ endedAt: null }, { endedAt: { gt: now } }],
                position: { status: 'ENABLED' },
                organization: {
                  status: 'ENABLED',
                  OR: [{ id: root.id }, { path: { startsWith: root.path.replace(/\/$/, '') + '/' } }],
                },
              },
            },
          },
          select: { id: true },
        });
        if (!target) fail('COLLAB_MEMBER_UNAVAILABLE');
        await new LeadAssignmentService(this.db, actor, this.actor).assign(
          recordId,
          target.id,
          text(input.reason, 500),
          tx,
        );
      }
      const bases = await tx.collabBase.findMany({ where: { workspaceId: current.access.workspaceId } });
      for (const base of bases) await this.event(tx, base.id, 'business.changed', recordId);
      return {
        id: recordId,
        version: (await tx.lead.findUniqueOrThrow({ where: { id: recordId } })).version,
      };
    });
  }
  private async values(
    tx: Tx,
    tableId: string,
    fields: CollabField[],
    access: Access,
    input: unknown,
    existing: ObjectValue = {},
    creating = false,
  ): Promise<ObjectValue> {
    const patch = object(input);
    const result = { ...existing };
    for (const [id, value] of Object.entries(patch)) {
      const field = fieldOf(fields, id);
      if (access.readonly.includes(id) || isSystemField(field))
        fail('COLLAB_READONLY_FIELD', 403, { fieldId: id });
      try {
        result[id] = validateValue(field, value);
      } catch (error) {
        if (error instanceof Error) fail(error.message, 422, { fieldId: id });
        throw error;
      }
    }
    for (const field of fields.filter((f) => !isSystemField(f))) {
      if (creating && result[field.id] === undefined && field.defaultValue !== null)
        result[field.id] = validateValue(field, field.defaultValue);
      if (field.required) validateValue(field, result[field.id]);
      const value = result[field.id];
      if (value === null || value === undefined) continue;
      if (field.type === 'USER') {
        const person = await tx.employee.findFirst({
          where: {
            id: String(value),
            deletedAt: null,
            status: { not: 'LEAVED' },
            assignments: {
              some: {
                endedAt: null,
                organization: {
                  OR: [{ id: access.organizationId }, { path: { contains: `/${access.organizationId}/` } }],
                },
              },
            },
          },
        });
        if (!person) fail('COLLAB_MEMBER_UNAVAILABLE', 422, { fieldId: field.id });
      }
      if (field.type === 'ORGANIZATION') {
        const org = await tx.organization.findFirst({
          where: {
            id: String(value),
            status: 'ENABLED',
            OR: [{ id: access.organizationId }, { path: { contains: `/${access.organizationId}/` } }],
          },
        });
        if (!org) fail('COLLAB_ORGANIZATION_UNAVAILABLE');
      }
      if (field.type === 'FILE' && Array.isArray(value)) {
        if (creating || Object.prototype.hasOwnProperty.call(patch, field.id))
          for (const id of value) await this.attachment(tableId, String(id), tx);
      }
      if (field.type === 'RELATION' && Array.isArray(value)) {
        const target = text(object(field.options).targetTableId);
        const a = await this.tableAccess(target, tx);
        const count = await tx.collabRecord.count({
          where: { ...this.rowWhere(target, a.access), id: { in: value as string[] } },
        });
        if (count !== value.length) fail('COLLAB_RELATION_UNAVAILABLE');
      }
    }
    return result;
  }
  private async extensionTarget(
    table: { id: string; source: string },
    access: Access,
    recordId: string,
    tx: Tx,
  ) {
    if (!this.actor.permissionCodes.includes('lead.update')) fail('COLLAB_FORBIDDEN', 403);
    const adapter = new WorkspaceBusinessTable(this.db, this.actor);
    const scope: Prisma.LeadWhereInput = {
      AND: [
        await adapter.scope(access),
        await buildLeadScopeWhere(
          this.db,
          new AuthorizationService(new DataScopeService(this.db)),
          this.actor,
          'lead.update',
        ),
      ],
    };
    const own = access.selfOnly ? { createdBy: this.actor.userId } : {};
    if (table.source === 'LEADS') {
      const row = await tx.lead.findFirst({ where: { AND: [scope, { id: recordId, ...own }] } });
      if (!row) fail('COLLAB_NOT_FOUND', 404);
      return { version: row.version };
    }
    const row = await tx.leadFollow.findFirst({ where: { id: recordId, ...own, lead: scope } });
    if (!row) fail('COLLAB_NOT_FOUND', 404);
    return { version: 1 };
  }
  private async saveExtension(
    tableId: string,
    recordId: string | undefined,
    input: ObjectValue,
    key: unknown,
  ) {
    if (!recordId || input.archived !== undefined || !Object.keys(object(input.values ?? {})).length)
      fail('COLLAB_USE_BUSINESS_ACTION', 409);
    const initial = await this.tableAccess(tableId, this.db, 2);
    await this.extensionTarget(initial.table, initial.access, recordId, this.db);
    return this.write(key, ['extension.save', tableId, recordId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
      if (table.schemaVersion !== integer(input.schemaVersion)) fail('COLLAB_SCHEMA_CONFLICT', 409);
      await tx.$queryRaw(
        table.source === 'LEADS'
          ? Prisma.sql`SELECT id FROM lead WHERE id = ${recordId} FOR UPDATE`
          : Prisma.sql`SELECT id FROM lead_follow WHERE id = ${recordId} FOR UPDATE`,
      );
      const core = await this.extensionTarget(table, access, recordId, tx);
      const previous = await tx.collabExtension.findUnique({
        where: { tableId_recordId: { tableId, recordId } },
      });
      const version = core.version + (previous?.version ?? 0);
      if (version !== integer(input.version)) fail('COLLAB_RECORD_CONFLICT', 409);
      if (
        Object.keys(object(input.values)).some((id) =>
          fields.some((f) => f.id === id && object(f.options).businessKey),
        )
      )
        fail('COLLAB_USE_BUSINESS_ACTION', 409);
      const extensions = fields.filter((f) => !object(f.options).businessKey);
      const next = await this.values(
        tx,
        tableId,
        extensions,
        access,
        input.values,
        previous ? object(previous.values) : {},
        !previous,
      );
      if (
        table.fields.some(
          (f) =>
            !f.archived &&
            !object(f.options).businessKey &&
            f.required &&
            !extensions.some((v) => v.id === f.id) &&
            (next[f.id] === undefined || next[f.id] === null || next[f.id] === ''),
        )
      )
        fail('COLLAB_REQUIRED_FIELD_FORBIDDEN', 403);
      const row = await tx.collabExtension.upsert({
        where: { tableId_recordId: { tableId, recordId } },
        create: { tableId, recordId, values: json(next), updatedBy: this.actor.userId },
        update: { values: json(next), updatedBy: this.actor.userId, version: { increment: 1 } },
      });
      const changes = Object.fromEntries(
        Object.keys(next)
          .filter(
            (id) =>
              JSON.stringify(previous ? object(previous.values)[id] : null) !== JSON.stringify(next[id]),
          )
          .map((id) => [
            id,
            { before: previous ? (object(previous.values)[id] ?? null) : null, after: next[id] },
          ]),
      );
      await tx.collabExtensionRevision.create({
        data: { tableId, recordId, version: row.version, actorId: this.actor.userId, changes: json(changes) },
      });
      await this.event(tx, table.baseId, 'record.updated', recordId);
      return { id: recordId, version: core.version + row.version };
    });
  }
  async saveRecord(tableId: string, recordId: string | undefined, raw: unknown, key: unknown) {
    const input = exact(raw, ['values', 'version', 'schemaVersion', 'archived']);
    const initial = await this.tableAccess(tableId, this.db, 2);
    if (initial.table.source !== 'CUSTOM') return this.saveExtension(tableId, recordId, input, key);
    return this.write(key, ['record.save', tableId, recordId, input], async (tx) => {
      await this.lock(tx, initial.access.workspaceId);
      const { table, access, fields } = await this.tableAccess(tableId, tx, 2);
      if (table.source !== 'CUSTOM') fail('COLLAB_USE_BUSINESS_ACTION', 409);
      if (table.schemaVersion !== integer(input.schemaVersion)) fail('COLLAB_SCHEMA_CONFLICT', 409);
      const previous = recordId
        ? await tx.collabRecord.findFirst({ where: { ...this.rowWhere(tableId, access), id: recordId } })
        : null;
      if (recordId && !previous) fail('COLLAB_NOT_FOUND', 404);
      if (previous && previous.version !== integer(input.version))
        fail('COLLAB_RECORD_CONFLICT', 409, { recordId, version: previous.version });
      const next = await this.values(
        tx,
        tableId,
        fields,
        access,
        input.values ?? {},
        previous ? object(previous.values) : {},
        !previous,
      );
      if (
        !previous &&
        table.fields.some((f) => !f.archived && f.required && !fields.some((visible) => visible.id === f.id))
      )
        fail('COLLAB_REQUIRED_FIELD_FORBIDDEN', 403);
      const data = {
        values: json(next),
        updatedBy: this.actor.userId,
        archived: input.archived === undefined ? false : boolean(input.archived),
      };
      const record = previous
        ? await tx.collabRecord.update({
            where: { id: recordId },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.collabRecord.create({
            data: { ...data, tableId, createdBy: this.actor.userId, ownerId: this.actor.userId },
          });
      const changes = Object.fromEntries(
        Object.keys(object(input.values ?? {})).map((id) => [
          id,
          { before: previous ? (object(previous.values)[id] ?? null) : null, after: next[id] },
        ]),
      );
      await tx.collabRevision.create({
        data: {
          recordId: record.id,
          version: record.version,
          actorId: this.actor.userId,
          changes: json(changes),
        },
      });
      for (const field of fields.filter((f) => f.type === 'RELATION')) {
        await tx.collabRelation.deleteMany({ where: { fieldId: field.id, sourceRecordId: record.id } });
        const targets = next[field.id];
        if (Array.isArray(targets) && targets.length)
          await tx.collabRelation.createMany({
            data: targets.map((target) => ({
              fieldId: field.id,
              sourceRecordId: record.id,
              targetRecordId: String(target),
            })),
          });
      }
      await this.event(tx, table.baseId, previous ? 'record.updated' : 'record.created', record.id);
      return { id: record.id, version: record.version };
    });
  }
  async options(workspaceId?: string) {
    const access = workspaceId ? await this.access(workspaceId) : null;
    if (
      !access &&
      !this.actor.isSystemSuperAdmin &&
      !this.actor.permissionCodes.some((p) => String(p) === 'workspace.create')
    )
      return { organizations: [], employees: [], teams: [], users: [], positions: [] };
    const organizations = await this.db.organization.findMany({
      where: {
        status: 'ENABLED',
        ...(access
          ? { OR: [{ id: access.organizationId }, { path: { contains: `/${access.organizationId}/` } }] }
          : this.actor.isSystemSuperAdmin
            ? {}
            : {
                id: {
                  in: (await this.principals(this.db))
                    .filter((p) => p.principalType === 'ORG')
                    .map((p) => p.principalId),
                },
              }),
      },
      select: { id: true, name: true },
      take: 500,
    });
    const employees = await this.db.employee.findMany({
      where: {
        deletedAt: null,
        status: { not: 'LEAVED' },
        assignments: {
          some: {
            startedAt: { lte: new Date() },
            OR: [{ endedAt: null }, { endedAt: { gt: new Date() } }],
            position: { status: 'ENABLED' },
            organizationId: { in: organizations.map((o) => o.id) },
          },
        },
      },
      select: { id: true, name: true, user: { select: { id: true, status: true } } },
      take: 1000,
    });
    const teams = await this.db.professionalTeam.findMany({
      where: { homeOrganizationId: { in: organizations.map((o) => o.id) }, status: 'ENABLED' },
      select: { id: true, name: true },
      take: 500,
    });
    const positions = await this.db.position.findMany({
      where: { organizationId: { in: organizations.map((o) => o.id) }, status: 'ENABLED' },
      select: { id: true, name: true, organization: { select: { name: true } } },
      take: 1000,
    });
    return {
      positions: positions.map((p) => ({ id: p.id, name: p.organization.name + ' / ' + p.name })),
      organizations,
      employees: employees.map((e) => ({ id: e.id, name: e.name })),
      users: employees
        .filter((e) => e.user?.status === 'ENABLED')
        .map((e) => ({ id: e.user.id, name: e.name })),
      teams,
    };
  }
  async members(workspaceId: string) {
    await this.requireAccessAdmin(workspaceId);
    return this.db.collabMember.findMany({ where: { workspaceId } });
  }
  async saveMember(workspaceId: string, raw: unknown, key: unknown) {
    const input = exact(raw, [
      'principalType',
      'principalId',
      'role',
      'canCreate',
      'canManageAccess',
      'rowScope',
      'hiddenFields',
      'readonlyFields',
      'version',
      'remove',
    ]);
    await this.requireAccessAdmin(workspaceId);
    return this.write(key, ['member.save', workspaceId, input], async (tx) => {
      await this.lock(tx, workspaceId);
      const administrator = await this.requireAccessAdmin(workspaceId, tx);
      const principalType = choice(input.principalType, ['USER', 'ORG', 'TEAM', 'POSITION']);
      const principalId = text(input.principalId);
      if (
        administrator.level < 4 &&
        ((await this.principals(tx)).some(
          (p) => p.principalType === principalType && p.principalId === principalId,
        ) ||
          input.canManageAccess)
      )
        fail('COLLAB_CANNOT_GRANT_ACCESS_ADMIN', 403);
      const workspace = await tx.collabWorkspace.findUnique({ where: { id: workspaceId } });
      if (principalType === 'USER' && principalId === workspace.ownerId) fail('COLLAB_OWNER_IMMUTABLE', 403);
      const options = await this.options(workspaceId);
      const candidates =
        principalType === 'USER'
          ? options.users
          : principalType === 'ORG'
            ? options.organizations
            : principalType === 'POSITION'
              ? options.positions
              : options.teams;
      if (!input.remove && !candidates.some((c) => c.id === principalId)) fail('COLLAB_MEMBER_UNAVAILABLE');
      const existing = await tx.collabMember.findUnique({
        where: { workspaceId_principalType_principalId: { workspaceId, principalType, principalId } },
      });
      if (existing && existing.version !== integer(input.version)) fail('COLLAB_MEMBER_CONFLICT', 409);
      if (input.remove) {
        if (existing) await tx.collabMember.delete({ where: { id: existing.id } });
      } else {
        const role = choice(input.role, ['READER', 'EDITOR', 'MANAGER']);
        const hiddenFields = strings(input.hiddenFields ?? []);
        const readonlyFields = strings(input.readonlyFields ?? []);
        const known = await tx.collabField.count({
          where: {
            id: { in: [...new Set([...hiddenFields, ...readonlyFields])] },
            table: { base: { workspaceId } },
          },
        });
        if (known !== new Set([...hiddenFields, ...readonlyFields]).size) fail('COLLAB_FIELD_UNAVAILABLE');
        const data = {
          role,
          canCreate: boolean(input.canCreate ?? false),
          rowScope: choice(input.rowScope ?? (role === 'MANAGER' ? 'ALL' : 'SELF'), ['ALL', 'SELF']),
          canManageAccess: boolean(input.canManageAccess ?? false),
          hiddenFields,
          readonlyFields,
        };
        if (
          data.canManageAccess &&
          (role !== 'MANAGER' || data.rowScope !== 'ALL' || hiddenFields.length || readonlyFields.length)
        )
          fail('COLLAB_INVALID_ACCESS_ADMIN');
        if (existing?.canManageAccess && administrator.level < 4)
          fail('COLLAB_CANNOT_GRANT_ACCESS_ADMIN', 403);
        if (existing)
          await tx.collabMember.update({
            where: { id: existing.id },
            data: { ...data, version: { increment: 1 } },
          });
        else await tx.collabMember.create({ data: { ...data, workspaceId, principalType, principalId } });
      }
      await tx.collabWorkspace.update({ where: { id: workspaceId }, data: { version: { increment: 1 } } });
      const bases = await tx.collabBase.findMany({ where: { workspaceId } });
      for (const b of bases) await this.event(tx, b.id, 'access.updated', workspaceId);
      return { id: existing?.id ?? principalId };
    });
  }
}
