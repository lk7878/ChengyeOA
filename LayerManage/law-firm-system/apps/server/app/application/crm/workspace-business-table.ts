import { CASE_FIELD_ORDER } from '../case/intake-contract';
import { caseGridChoices } from '../collaboration/case-grid-fields';
import { domainSources, isDomainSource, WorkspaceDomainSource } from './workspace-domain-source';
import { CollabField, CollabTable, CollabRecord, Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { FieldProjectionService } from '../authorization/field-projection-service';
import { buildLeadScopeWhere } from './lead-scope';
import { maskLeadPhone, maskLeadWechat } from './lead-projection';
import { auditRawL3Access } from './lead-audit';
import type { Access } from '../collaboration/collaboration-service';
import {
  fail,
  fieldOf,
  object,
  ViewConfig,
  filterSql,
  fieldExpression,
  groupExpression,
} from '../collaboration/collaboration-policy';

const columns = {
  LEADS: [
    ['leadNo', '线索编号', 'TEXT'],
    ['name', '线索名称', 'TEXT'],
    ['phone', '联系电话', 'PHONE'],
    ['wechat', '微信', 'TEXT'],
    ['status', '业务状态', 'TEXT'],
    ['poolStatus', '线索池状态', 'TEXT'],
    ['assignedTo', '负责人', 'USER'],
    ['branchId', '所属组织', 'ORGANIZATION'],
    ['intentionLevel', '意向等级', 'NUMBER'],
    ['createdAt', '创建时间', 'CREATED_AT'],
    ['updatedAt', '更新时间', 'UPDATED_AT'],
  ],
  FOLLOWS: [
    ['leadId', '线索 ID', 'TEXT'],
    ['type', '跟进方式', 'TEXT'],
    ['content', '跟进内容', 'LONG_TEXT'],
    ['nextPlan', '下次计划', 'LONG_TEXT'],
    ['nextTime', '下次联系', 'DATETIME'],
    ['createdBy', '跟进人', 'CREATED_BY'],
    ['createdAt', '创建时间', 'CREATED_AT'],
  ],
};
export function businessFields(source: string) {
  if (!isDomainSource(source) && source !== 'LEADS' && source !== 'FOLLOWS') fail('COLLAB_INVALID_SOURCE');
  const definitions = [...(isDomainSource(source) ? domainSources[source].columns : columns[source])];
  if (source === 'CASES') definitions.sort((a, b) => (CASE_FIELD_ORDER.indexOf(a[0]) < 0 ? 1000 : CASE_FIELD_ORDER.indexOf(a[0])) - (CASE_FIELD_ORDER.indexOf(b[0]) < 0 ? 1000 : CASE_FIELD_ORDER.indexOf(b[0])));
  return definitions.map(
    ([key, name, type], position) => ({
      name,
      type,
      position,
      options: { businessKey: key, businessSource: source, ...(source === 'CASES' && caseGridChoices(key) ? { choices: caseGridChoices(key) } : {}) },
    }),
  );
}

/** A read adapter over CRM truth. It shares domain scope and sensitive-field projection;
 * resource grants can only narrow them. No core rows are copied into collab_record. */
export class WorkspaceBusinessTable {
  private readonly authorization: AuthorizationService;
  private readonly projection = new FieldProjectionService();
  constructor(
    private readonly db: PrismaClient,
    private readonly actor: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(db));
  }
  authorize(source = 'LEADS') {
    if (isDomainSource(source)) {
      new WorkspaceDomainSource(this.db, this.actor).authorize(source);
      return;
    }
    try {
      this.authorization.requireAction(this.actor, 'lead.read');
    } catch {
      fail('COLLAB_FORBIDDEN', 403);
    }
  }
  private permissions() {
    return {
      phone: this.projection.fieldCapability(this.actor, 'lead', 'lead.phone', 'lead.read').readLevel,
      wechat: this.projection.fieldCapability(this.actor, 'lead', 'lead.wechat', 'lead.read').readLevel,
    };
  }
  visibleFields(source: string, fields: CollabField[]) {
    if (isDomainSource(source))
      return new WorkspaceDomainSource(this.db, this.actor).visibleFields(source, fields);
    this.authorize(source);
    const permissions = this.permissions();
    return fields.filter(
      (f) =>
        source !== 'LEADS' ||
        !['phone', 'wechat'].some(
          (key) => object(f.options).businessKey === key && permissions[key as 'phone' | 'wechat'] === 'NONE',
        ),
    );
  }
  private key(source: string, field: CollabField, query = false): string {
    const key = object(field.options).businessKey;
    if (!businessFields(source).some((f) => f.options.businessKey === key)) fail('COLLAB_INVALID_FIELD');
    // Never infer sensitive raw values through filtering, grouping, or ordering a masked column.
    if (query && ['phone', 'wechat'].includes(String(key))) fail('COLLAB_SENSITIVE_QUERY_UNSUPPORTED');
    return String(key);
  }
  private filter(source: string, fields: CollabField[], raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    const input = object(raw);
    if (input.join)
      return {
        [input.join === 'and' ? 'AND' : 'OR']: (input.children as unknown[]).map((c) =>
          this.filter(source, fields, c),
        ),
      };
    const f = fieldOf(fields, input.fieldId);
    const key = this.key(source, f, true);
    if (input.operator === 'empty' || input.operator === 'notEmpty') {
      // Required CRM columns cannot be null; optional fields also treat empty strings as empty.
      const nullable = [
        'assignedTo',
        'branchId',
        'nextPlan',
        'nextTime',
        'sourceLeadId',
        'quotedAmount',
        'wechat',
      ].includes(key);
      const empty: Record<string, unknown> = nullable ? { [key]: null } : { id: { in: [] as string[] } };
      const where = ['TEXT', 'LONG_TEXT', 'PHONE'].includes(f.type) ? { OR: [empty, { [key]: '' }] } : empty;
      return input.operator === 'empty' ? where : { NOT: where };
    }
    let value =
      input.value === '$currentUser'
        ? f.type === 'USER'
          ? this.actor.employeeId
          : this.actor.userId
        : input.value;
    if (input.value === '$currentUser' && f.type === 'USER' && !this.actor.employeeId)
      return { id: { in: [] as string[] } };
    if (f.type === 'NUMBER') {
      value = Number(value);
      if (!Number.isFinite(value) || (!isDomainSource(source) && !Number.isSafeInteger(value)))
        fail('COLLAB_INVALID_FILTER');
    }
    if (['DATE', 'DATETIME', 'CREATED_AT', 'UPDATED_AT'].includes(f.type)) {
      if (input.operator === 'contains' || !Number.isFinite(Date.parse(String(value))))
        fail('COLLAB_INVALID_FILTER');
      value = new Date(String(value));
    }
    if (input.operator === 'contains') {
      if (!['TEXT', 'LONG_TEXT', 'PHONE', 'USER', 'ORGANIZATION', 'CREATED_BY'].includes(f.type))
        fail('COLLAB_INVALID_FILTER');
      return { [key]: { contains: String(value), mode: 'insensitive' } };
    }
    const op = input.operator === 'eq' ? 'equals' : input.operator === 'ne' ? 'not' : String(input.operator);
    if (
      op === 'not' &&
      ['assignedTo', 'branchId', 'nextPlan', 'nextTime', 'sourceLeadId', 'quotedAmount', 'wechat'].includes(
        key,
      )
    )
      return { OR: [{ [key]: null }, { [key]: { not: value } }] };
    return { [key]: { [op]: value } };
  }
  validateConfig(source: string, fields: CollabField[], config: ViewConfig) {
    const visit = (raw: unknown) => {
      if (!raw) return;
      const f = object(raw);
      if (f.join) {
        for (const child of f.children as unknown[]) visit(child);
      } else if (object(fieldOf(fields, f.fieldId).options).businessKey) this.filter(source, fields, f);
    };
    filterSql(config.filter, fields, this.actor.userId, this.actor.employeeId);
    visit(config.filter);
    for (const id of [...(config.sorts ?? []).map((s) => s.fieldId), ...(config.groupBy ?? [])]) {
      const f = fieldOf(fields, id);
      if (object(f.options).businessKey) this.key(source, f, true);
    }
  }
  async scope(access: Access): Promise<Prisma.LeadWhereInput> {
    this.authorize();
    const root = await this.db.organization.findUnique({ where: { id: access.organizationId } });
    if (!root || root.status !== 'ENABLED') fail('COLLAB_FORBIDDEN', 403);
    const organizations = await this.db.organization.findMany({
      where: {
        status: 'ENABLED',
        OR: [{ id: root.id }, { path: { startsWith: root.path.replace(/\/$/, '') + '/' } }],
      },
      select: { id: true },
    });
    return {
      AND: [
        await buildLeadScopeWhere(this.db, this.authorization, this.actor, 'lead.read'),
        { deletedAt: null, branchId: { in: organizations.map((o) => o.id) } },
      ],
    };
  }
  /** Compile only the predicates produced by the existing domain scope resolver.
   * New resolver shapes fail closed until explicitly supported here. */
  private scopeSql(raw: Prisma.LeadWhereInput, alias: 'b' | 'l'): Prisma.Sql {
    const parts = Object.entries(raw).map(([key, value]) => {
      if (key === 'AND' || key === 'OR') {
        const children = Array.isArray(value) ? value : [value];
        if (!children.length) return key === 'AND' ? Prisma.sql`TRUE` : Prisma.sql`FALSE`;
        return Prisma.sql`(${Prisma.join(
          children.map((c) => this.scopeSql(object(c) as Prisma.LeadWhereInput, alias)),
          key === 'AND' ? ' AND ' : ' OR ',
        )})`;
      }
      if (!['id', 'assignedTo', 'professionalTeamId', 'branchId', 'deletedAt'].includes(key))
        fail('COLLAB_UNSUPPORTED_SCOPE', 403);
      const column = Prisma.raw(alias + '."' + key + '"');
      if (value === null) return Prisma.sql`${column} IS NULL`;
      if (typeof value === 'string') return Prisma.sql`${column} = ${value}`;
      const predicate = object(value);
      if (
        Object.keys(predicate).length !== 1 ||
        !Array.isArray(predicate.in) ||
        predicate.in.some((v) => typeof v !== 'string')
      )
        fail('COLLAB_UNSUPPORTED_SCOPE', 403);
      return predicate.in.length
        ? Prisma.sql`${column} IN (${Prisma.join(predicate.in as string[])})`
        : Prisma.sql`FALSE`;
    });
    return parts.length ? Prisma.sql`(${Prisma.join(parts, ' AND ')})` : Prisma.sql`TRUE`;
  }
  async sourceSql(table: CollabTable, access: Access, fields: CollabField[]) {
    if (isDomainSource(table.source))
      return new WorkspaceDomainSource(this.db, this.actor).sourceSql(table, access, fields);
    const leads = table.source === 'LEADS';
    const domain = this.scopeSql(await this.scope(access), leads ? 'b' : 'l');
    const core = leads ? Prisma.sql`lead b` : Prisma.sql`lead_follow b JOIN lead l ON l.id = b."leadId"`;
    const pairs = fields.flatMap((f) => {
      const column = object(f.options).businessKey
        ? Prisma.raw('b."' + this.key(table.source, f) + '"')
        : null;
      const value = column
        ? ['DATETIME', 'CREATED_AT', 'UPDATED_AT'].includes(f.type)
          ? Prisma.sql`to_jsonb(${column} AT TIME ZONE 'UTC')`
          : Prisma.sql`to_jsonb(${column})`
        : Prisma.sql`e."values" -> ${f.id}`;
      return [Prisma.sql`${f.id}::text`, value];
    });
    // PostgreSQL allows at most 100 function arguments; a table may expose 100 fields.
    const chunks: Prisma.Sql[] = [];
    for (let i = 0; i < pairs.length; i += 100)
      chunks.push(Prisma.sql`jsonb_build_object(${Prisma.join(pairs.slice(i, i + 100))})`);
    const values = chunks.length ? Prisma.sql`(${Prisma.join(chunks, ' || ')})` : Prisma.sql`'{}'::jsonb`;
    return Prisma.sql`SELECT b.id, ${table.id}::text AS "tableId", ${values} AS "values",
      b.version + COALESCE(e.version, 0) AS version,
      b."createdBy", b."createdBy" AS "ownerId", b."createdAt", false AS archived,
      COALESCE(e."updatedBy", b."createdBy") AS "updatedBy",
      ${leads ? Prisma.sql`b."updatedAt"` : Prisma.sql`b."createdAt"`} AS "updatedAt"
      FROM ${core} LEFT JOIN collab_extension e ON e."tableId" = ${table.id} AND e."recordId" = b.id
      WHERE b."deletedAt" IS NULL AND ${domain} AND ${access.selfOnly ? Prisma.sql`b."createdBy" = ${this.actor.userId}` : Prisma.sql`TRUE`}`;
  }
  async query(
    table: CollabTable,
    access: Access,
    fields: CollabField[],
    config: ViewConfig,
    page: number,
    pageSize: number,
    recordId?: string,
  ) {
    this.validateConfig(table.source, fields, config);
    const source = await this.sourceSql(table, access, fields);
    const where = Prisma.sql`${recordId ? Prisma.sql`r.id = ${recordId}` : Prisma.sql`TRUE`} AND ${filterSql(config.filter, fields, this.actor.userId, this.actor.employeeId)}`;
    const order = (config.sorts ?? []).map(
      (s) =>
        Prisma.sql`${fieldExpression(fieldOf(fields, s.fieldId))} ${s.direction === 'desc' ? Prisma.sql`DESC NULLS LAST` : Prisma.sql`ASC NULLS LAST`}`,
    );
    order.push(Prisma.sql`r."createdAt" DESC`, Prisma.sql`r.id ASC`);
    const group = (config.groupBy ?? []).map((id) => groupExpression(fieldOf(fields, id)));
    const result = await this.db.$transaction(
      async (tx) => {
        const records = await tx.$queryRaw<CollabRecord[]>(
          Prisma.sql`WITH r AS (${source}) SELECT * FROM r WHERE ${where} ORDER BY ${Prisma.join(order)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        );
        const counts = await tx.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`WITH r AS (${source}) SELECT count(*) FROM r WHERE ${where}`,
        );
        const groups = group.length
          ? await tx.$queryRaw<Array<{ keys: unknown[]; count: bigint }>>(
              Prisma.sql`WITH r AS (${source}) SELECT jsonb_build_array(${Prisma.join(group)}) AS keys, count(*) FROM r WHERE ${where} GROUP BY 1 ORDER BY 1 LIMIT 201`,
            )
          : [];
        return {
          records,
          total: Number(counts[0].count),
          groups: groups.map((g) => ({ keys: g.keys, count: Number(g.count) })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    if (isDomainSource(table.source))
      return {
        ...result,
        records: await new WorkspaceDomainSource(this.db, this.actor).project(
          table.source,
          access,
          fields,
          result.records,
          recordId,
        ),
        groups: result.groups.slice(0, 200),
        groupsTruncated: result.groups.length > 200,
        page,
        pageSize,
        schemaVersion: table.schemaVersion,
      };
    if (table.source === 'LEADS') {
      const permissions = this.permissions();
      for (const key of ['phone', 'wechat'] as const) {
        const field = fields.find((f) => object(f.options).businessKey === key);
        if (!field) {
          permissions[key] = 'NONE';
          continue;
        }
        for (const row of result.records) {
          const values = object(row.values);
          if (values[field.id] != null && permissions[key] !== 'READ')
            values[field.id] =
              permissions[key] === 'NONE'
                ? null
                : key === 'phone'
                  ? maskLeadPhone(String(values[field.id]))
                  : maskLeadWechat();
        }
      }
      await auditRawL3Access(
        this.db,
        { actorUserId: this.actor.userId },
        'LEAD',
        recordId ?? 'LIST',
        'lead',
        permissions,
        result.records.length,
        'workspace.leads',
      );
    }
    // Reference labels are projected only for the already-authorized result and visible link field.
    const leadField =
      table.source === 'FOLLOWS' ? fields.find((f) => object(f.options).businessKey === 'leadId') : undefined;
    const labels = new Map<string, string>();
    if (leadField && result.records.length) {
      const follows = await this.db.leadFollow.findMany({
        where: { id: { in: result.records.map((r) => r.id) }, lead: await this.scope(access) },
        select: { id: true, lead: { select: { leadNo: true, name: true } } },
      });
      for (const follow of follows) labels.set(follow.id, follow.lead.leadNo + ' · ' + follow.lead.name);
    }
    let editable = new Set<string>();
    if (access.level >= 2 && this.actor.permissionCodes.includes('lead.update') && result.records.length) {
      const actionScope = await buildLeadScopeWhere(this.db, this.authorization, this.actor, 'lead.update');
      const ids = result.records.map((r) => r.id);
      const rows =
        table.source === 'LEADS'
          ? await this.db.lead.findMany({
              where: { AND: [actionScope, { id: { in: ids } }] },
              select: { id: true },
            })
          : await this.db.leadFollow.findMany({
              where: { id: { in: ids }, lead: actionScope },
              select: { id: true },
            });
      editable = new Set(rows.map((r) => r.id));
    }
    return {
      ...result,
      records: result.records.map((r) => ({
        ...r,
        writable: editable.has(r.id),
        ...(leadField && labels.has(r.id) ? { displayValues: { [leadField.id]: labels.get(r.id)! } } : {}),
      })),
      groups: result.groups.slice(0, 200),
      groupsTruncated: result.groups.length > 200,
      page,
      pageSize,
      schemaVersion: table.schemaVersion,
    };
  }
}
