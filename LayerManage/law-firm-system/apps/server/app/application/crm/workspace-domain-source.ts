import { CollabField, CollabRecord, CollabTable, Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { FieldProjectionService } from '../authorization/field-projection-service';
import {
  buildContractScopeWhere,
  buildCustomerVisibilityWhere,
  buildNegotiationScopeWhere,
} from '../contract/contract-scope';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import type { Access } from '../collaboration/collaboration-service';
import { fail, object } from '../collaboration/collaboration-policy';
import { maskLeadPhone, maskLeadWechat } from './lead-projection';
import { auditRawL3Access } from './lead-audit';

export const domainSources = {
  CUSTOMERS: {
    resource: 'customer',
    edit: 'customer.update',
    table: 'customer',
    columns: [
      ['customerNo', '客户编号', 'TEXT'],
      ['name', '客户名称', 'TEXT'],
      ['phone', '联系电话', 'PHONE'],
      ['wechat', '微信', 'TEXT'],
      ['customerType', '客户类型', 'TEXT'],
      ['status', '客户状态', 'TEXT'],
      ['sourceLeadId', '来源线索', 'TEXT'],
      ['createdBy', '创建人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
  NEGOTIATIONS: {
    resource: 'negotiation',
    edit: 'negotiation.update',
    table: 'negotiation',
    columns: [
      ['negotiationNo', '谈案编号', 'TEXT'],
      ['customerId', '关联客户', 'TEXT'],
      ['negotiatorEmployeeId', '谈案人', 'USER'],
      ['quotedAmount', '报价金额', 'CURRENCY'],
      ['status', '谈案状态', 'TEXT'],
      ['branchId', '所属组织', 'ORGANIZATION'],
      ['createdBy', '创建人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
  CONTRACTS: {
    resource: 'contract',
    edit: 'contract.submit',
    table: 'contract',
    columns: [
      ['contractNo', '合同编号', 'TEXT'],
      ['title', '合同名称', 'TEXT'],
      ['contractType', '合同类型', 'TEXT'],
      ['customerId', '关联客户', 'TEXT'],
      ['amount', '合同金额', 'CURRENCY'],
      ['receivedAmount', '已收金额', 'CURRENCY'],
      ['status', '合同状态', 'TEXT'],
      ['branchId', '所属组织', 'ORGANIZATION'],
      ['createdBy', '创建人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
} as const;
export type DomainSource = keyof typeof domainSources;
export function isDomainSource(source: string): source is DomainSource {
  return Object.prototype.hasOwnProperty.call(domainSources, source);
}

/** The SQL identifiers and scope shapes below are exclusively server-owned. */
export class WorkspaceDomainSource {
  private readonly authorization: AuthorizationService;
  constructor(
    private readonly db: PrismaClient,
    private readonly actor: AuthorizationContext,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(db));
  }
  authorize(source: DomainSource, action = 'read') {
    const permission =
      action === 'update'
        ? domainSources[source].edit
        : (`${domainSources[source].resource}.${action}` as PermissionCode);
    if (!this.actor.permissionCodes.includes(permission)) fail('COLLAB_FORBIDDEN', 403);
    return permission;
  }
  permissions() {
    const projection = new FieldProjectionService();
    return {
      phone: projection.fieldCapability(this.actor, 'customer', 'customer.phone', 'customer.read').readLevel,
      wechat: projection.fieldCapability(this.actor, 'customer', 'customer.wechat', 'customer.read')
        .readLevel,
    };
  }
  visibleFields(source: DomainSource, fields: CollabField[]) {
    this.authorize(source);
    const permissions = this.permissions();
    return fields.filter(
      (f) =>
        source !== 'CUSTOMERS' ||
        !['phone', 'wechat'].some(
          (key) => object(f.options).businessKey === key && permissions[key as 'phone' | 'wechat'] === 'NONE',
        ),
    );
  }
  private compile(raw: unknown, alias: 'b' | 'l' = 'b'): Prisma.Sql {
    const clauses = Object.entries(object(raw)).map(([key, value]): Prisma.Sql => {
      if (key === 'AND' || key === 'OR') {
        const children = Array.isArray(value) ? value : [value];
        if (!children.length) return key === 'AND' ? Prisma.sql`TRUE` : Prisma.sql`FALSE`;
        return Prisma.sql`(${Prisma.join(
          children.map((child) => this.compile(child, alias)),
          key === 'AND' ? ' AND ' : ' OR ',
        )})`;
      }
      if (key === 'sourceLead' && alias === 'b') return this.compile(value, 'l');
      if (
        !['id', 'createdBy', 'branchId', 'professionalTeamId', 'negotiatorEmployeeId', 'deletedAt'].includes(
          key,
        )
      )
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
    return clauses.length ? Prisma.sql`(${Prisma.join(clauses, ' AND ')})` : Prisma.sql`TRUE`;
  }
  async scope(source: DomainSource, access: Access, action = 'read') {
    const permission = this.authorize(source, action);
    const domain =
      source === 'CUSTOMERS'
        ? await buildCustomerVisibilityWhere(this.db, this.authorization, this.actor, permission)
        : source === 'NEGOTIATIONS'
          ? await buildNegotiationScopeWhere(this.db, this.authorization, this.actor, permission)
          : await buildContractScopeWhere(this.db, this.authorization, this.actor, permission);
    const root = await this.db.organization.findUnique({ where: { id: access.organizationId } });
    if (!root || root.status !== 'ENABLED') fail('COLLAB_FORBIDDEN', 403);
    const organizations = await this.db.organization.findMany({
      where: {
        status: 'ENABLED',
        OR: [{ id: root.id }, { path: { startsWith: root.path.replace(/\/$/, '') + '/' } }],
      },
      select: { id: true },
    });
    const ids = organizations.map((o) => o.id);
    let organization = Prisma.sql`b."branchId" IN (${Prisma.join(ids)})`;
    if (source === 'CUSTOMERS') {
      const now = new Date();
      const creators = await this.db.user.findMany({
        where: {
          status: 'ENABLED',
          employee: {
            deletedAt: null,
            status: { not: 'LEAVED' },
            assignments: {
              some: {
                organizationId: { in: ids },
                position: { status: 'ENABLED' },
                startedAt: { lte: now },
                OR: [{ endedAt: null }, { endedAt: { gt: now } }],
              },
            },
          },
        },
        select: { id: true },
      });
      organization = Prisma.sql`(l."branchId" IN (${Prisma.join(ids)}) OR
        (b."sourceLeadId" IS NULL AND ${creators.length ? Prisma.sql`b."createdBy" IN (${Prisma.join(creators.map((u) => u.id))})` : Prisma.sql`FALSE`}))`;
    }
    return Prisma.sql`${this.compile(domain)} AND b."deletedAt" IS NULL AND ${organization}
      AND ${access.selfOnly ? Prisma.sql`b."createdBy" = ${this.actor.userId}` : Prisma.sql`TRUE`}`;
  }
  from(source: DomainSource) {
    return source === 'CUSTOMERS'
      ? Prisma.sql`customer b LEFT JOIN lead l ON l.id = b."sourceLeadId"`
      : Prisma.sql`${Prisma.raw(domainSources[source].table)} b`;
  }
  async sourceSql(table: CollabTable, access: Access, fields: CollabField[]) {
    if (!isDomainSource(table.source)) fail('COLLAB_INVALID_SOURCE');
    const definition = domainSources[table.source];
    const pairs = fields.flatMap((f) => {
      const key = object(f.options).businessKey;
      if (key && !definition.columns.some((c) => c[0] === key)) fail('COLLAB_INVALID_FIELD');
      const column = key ? Prisma.raw('b."' + key + '"') : null;
      const value = column
        ? ['DATETIME', 'CREATED_AT', 'UPDATED_AT'].includes(f.type)
          ? Prisma.sql`to_jsonb(${column} AT TIME ZONE 'UTC')`
          : f.type === 'CURRENCY'
            ? Prisma.sql`to_jsonb(${column}::text)`
            : Prisma.sql`to_jsonb(${column})`
        : Prisma.sql`e."values" -> ${f.id}`;
      return [Prisma.sql`${f.id}::text`, value];
    });
    const chunks: Prisma.Sql[] = [];
    for (let i = 0; i < pairs.length; i += 100)
      chunks.push(Prisma.sql`jsonb_build_object(${Prisma.join(pairs.slice(i, i + 100))})`);
    const values = chunks.length ? Prisma.sql`(${Prisma.join(chunks, ' || ')})` : Prisma.sql`'{}'::jsonb`;
    return Prisma.sql`SELECT b.id, ${table.id}::text AS "tableId", ${values} AS "values",
      b.version + COALESCE(e.version, 0) AS version, b."createdBy", b."createdBy" AS "ownerId",
      b."createdAt", b."updatedAt", COALESCE(e."updatedBy", b."updatedBy", b."createdBy") AS "updatedBy", false AS archived
      FROM ${this.from(table.source)} LEFT JOIN collab_extension e ON e."tableId" = ${table.id} AND e."recordId" = b.id
      WHERE ${await this.scope(table.source, access)}`;
  }
  async target(
    source: DomainSource,
    access: Access,
    recordId: string,
    tx: Prisma.TransactionClient,
    action = 'update',
  ) {
    const rows = await tx.$queryRaw<
      Array<{ version: number }>
    >(Prisma.sql`SELECT b.version FROM ${this.from(source)}
      WHERE b.id = ${recordId} AND ${await this.scope(source, access)} AND ${await this.scope(source, access, action)}`);
    if (!rows.length) fail('COLLAB_NOT_FOUND', 404);
    return rows[0];
  }
  async project(
    source: DomainSource,
    access: Access,
    fields: CollabField[],
    rows: CollabRecord[],
    recordId?: string,
  ) {
    if (source === 'CUSTOMERS') {
      const permissions = this.permissions();
      for (const key of ['phone', 'wechat'] as const) {
        const field = fields.find((f) => object(f.options).businessKey === key);
        if (!field) {
          permissions[key] = 'NONE';
          continue;
        }
        for (const row of rows) {
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
        'CUSTOMER',
        recordId ?? 'LIST',
        'customer',
        permissions,
        rows.length,
        'workspace.customers',
      );
    }
    let editable: Array<{ id: string }> = [];
    if (rows.length && access.level >= 2 && this.actor.permissionCodes.includes(domainSources[source].edit))
      editable = await this.db.$queryRaw(Prisma.sql`SELECT b.id FROM ${this.from(source)} WHERE
        b.id IN (${Prisma.join(rows.map((r) => r.id))}) AND ${await this.scope(source, access, 'update')}`);
    const ids = new Set(editable.map((r) => r.id));
    const customerField = fields.find((f) => object(f.options).businessKey === 'customerId');
    const labels = new Map<string, string>();
    if (customerField && rows.length && this.actor.permissionCodes.includes('customer.read')) {
      const customerIds = rows
        .map((row) => object(row.values)[customerField.id])
        .filter((id): id is string => typeof id === 'string');
      const customers = customerIds.length
        ? await this.db.$queryRaw<Array<{ id: string; customerNo: string; name: string }>>(
            Prisma.sql`SELECT b.id, b."customerNo", b.name FROM ${this.from('CUSTOMERS')}
          WHERE b.id IN (${Prisma.join(customerIds)}) AND ${await this.scope('CUSTOMERS', access)}`,
          )
        : [];
      for (const customer of customers) labels.set(customer.id, customer.customerNo + ' · ' + customer.name);
    }
    return rows.map((row) => {
      const label = customerField && labels.get(String(object(row.values)[customerField.id]));
      return {
        ...row,
        writable: ids.has(row.id),
        ...(customerField && label ? { displayValues: { [customerField.id]: label } } : {}),
      };
    });
  }
}
