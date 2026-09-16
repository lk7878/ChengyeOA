import { sopTaskScope } from '../sop/execution-scope';
import { channelScope } from '../channel/channel-scope';
import { inventoryScope } from '../inventory/inventory-scope';
import { performanceScope } from '../performance/performance-scope';
import { creatorIdsInOrganizations } from '../authorization/creator-organization';
import { buildFinancialRecordScopeWhere } from '../finance/financial-record-scope';
import { buildCostScopeWhere, costCreatorIds } from '../finance/cost-scope';
import { INTAKE_FIELDS } from '../case/intake-contract';
import { buildCaseScopeWhere } from '../case/case-scope';
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
  SOP_TASKS: {resource:'sop_task',edit:'sop.task.manage',table:'case_task',columns:[
    ['name','节点任务','TEXT'],['status','执行状态','TEXT'],['assigneeUserId','负责人','CREATED_BY'],['dueDate','到期时间','DATETIME'],['remark','办理备注','LONG_TEXT'],['createdBy','创建人','CREATED_BY'],['createdAt','创建时间','CREATED_AT'],['updatedAt','更新时间','UPDATED_AT'],
  ]},
  CHANNELS: {
    resource: 'channel',
    edit: 'channel.update',
    table: 'channel',
    columns: [
      ['code', '渠道编号', 'TEXT'],
      ['name', '渠道名称', 'TEXT'],
      ['type', '渠道类型', 'TEXT'],
      ['accountInfo', '渠道说明', 'LONG_TEXT'],
      ['cost', '渠道成本', 'CURRENCY'],
      ['status', '渠道状态', 'TEXT'],
      ['branchId', '所属组织', 'ORGANIZATION'],
      ['createdBy', '登记人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
  INVENTORY_ITEMS: {
    resource: 'inventory',
    edit: 'inventory.manage',
    table: 'inventory_item',
    columns: [
      ['code', '物品编号', 'TEXT'],
      ['name', '物品名称', 'TEXT'],
      ['kind', '物品类型', 'TEXT'],
      ['category', '物品分类', 'TEXT'],
      ['unit', '计量单位', 'TEXT'],
      ['specification', '规格型号', 'TEXT'],
      ['location', '存放位置', 'TEXT'],
      ['stock', '当前库存', 'NUMBER'],
      ['minimumStock', '预警下限', 'NUMBER'],
      ['status', '物品状态', 'TEXT'],
      ['createdBy', '登记人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
  INVENTORY_MOVEMENTS: {
    resource: 'inventory',
    edit: 'inventory.manage',
    table: 'inventory_movement',
    columns: [
      ['documentNo', '出入库编号', 'TEXT'],
      ['itemId', '关联物品', 'TEXT'],
      ['itemName', '物品名称', 'TEXT'],
      ['itemKind', '物品类型', 'TEXT'],
      ['unit', '计量单位', 'TEXT'],
      ['action', '业务类型', 'TEXT'],
      ['quantity', '变动数量', 'NUMBER'],
      ['beforeStock', '变动前库存', 'NUMBER'],
      ['afterStock', '变动后库存', 'NUMBER'],
      ['employeeName', '领用人快照', 'TEXT'],
      ['organizationPath', '领用组织快照', 'TEXT'],
      ['source', '来源供应商', 'TEXT'],
      ['reason', '用途原因', 'LONG_TEXT'],
      ['occurredAt', '业务日期', 'DATETIME'],
      ['createdBy', '登记人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
    ],
  },
  INVENTORY_STOCKTAKES: {
    resource: 'inventory',
    edit: 'inventory.manage',
    table: 'inventory_stocktake',
    columns: [
      ['documentNo', '盘点编号', 'TEXT'],
      ['itemId', '关联物品', 'TEXT'],
      ['itemName', '物品名称', 'TEXT'],
      ['unit', '计量单位', 'TEXT'],
      ['bookStock', '账面库存', 'NUMBER'],
      ['actualStock', '实际库存', 'NUMBER'],
      ['difference', '盘点差异', 'NUMBER'],
      ['reason', '差异原因', 'LONG_TEXT'],
      ['occurredAt', '业务日期', 'DATETIME'],
      ['createdBy', '登记人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
    ],
  },
  PERFORMANCES: {
    resource: 'performance',
    edit: 'performance.update',
    table: 'performance',
    columns: [
      ['employeeId', '被考核人', 'USER'],
      ['period', '考核周期', 'TEXT'],
      ['type', '考核类型', 'TEXT'],
      ['status', '考核状态', 'TEXT'],
      ['goal', '考核目标', 'LONG_TEXT'],
      ['score', '绩效分数', 'CURRENCY'],
      ['bonus', '奖金', 'CURRENCY'],
      ['selfScore', '自评分数', 'NUMBER'],
      ['selfComment', '自评说明', 'LONG_TEXT'],
      ['managerScore', '主管评分', 'NUMBER'],
      ['managerComment', '主管评议', 'LONG_TEXT'],
      ['remark', '备注', 'LONG_TEXT'],
      ['createdBy', '登记人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },

  PAYMENTS: {
    resource: 'payment',
    edit: 'payment.create',
    table: 'payment',
    columns: [
      ['paymentNo', '收款编号', 'TEXT'],
      ['contractId', '关联合同', 'TEXT'],
      ['customerId', '关联客户', 'TEXT'],
      ['amount', '收款金额', 'CURRENCY'],
      ['method', '收款方式', 'TEXT'],
      ['account', '收款账户', 'TEXT'],
      ['paidAt', '收款日期', 'DATETIME'],
      ['status', '收款状态', 'TEXT'],
      ['confirmedBy', '确认人', 'TEXT'],
      ['confirmedAt', '确认时间', 'DATETIME'],
      ['remark', '备注', 'LONG_TEXT'],
      ['createdBy', '创建人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
  INVOICES: {
    resource: 'invoice',
    edit: 'invoice.create',
    table: 'invoice_request',
    columns: [
      ['requestNo', '开票申请编号', 'TEXT'],
      ['contractId', '关联合同', 'TEXT'],
      ['customerId', '关联客户', 'TEXT'],
      ['amount', '开票金额', 'CURRENCY'],
      ['status', '开票状态', 'TEXT'],
      ['invoiceNo', '发票号码', 'TEXT'],
      ['reason', '申请说明', 'LONG_TEXT'],
      ['approvedBy', '审批人', 'TEXT'],
      ['completedAt', '开具时间', 'DATETIME'],
      ['createdBy', '创建人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
  REFUNDS: {
    resource: 'refund',
    edit: 'refund.create',
    table: 'refund_request',
    columns: [
      ['requestNo', '申请编号', 'TEXT'],
      ['type', '业务类型', 'TEXT'],
      ['contractId', '关联合同', 'TEXT'],
      ['customerId', '关联客户', 'TEXT'],
      ['paymentId', '关联收款', 'TEXT'],
      ['planId', '关联计划', 'TEXT'],
      ['amount', '申请金额', 'CURRENCY'],
      ['status', '退款减免状态', 'TEXT'],
      ['reason', '申请理由', 'LONG_TEXT'],
      ['executedAt', '执行时间', 'DATETIME'],
      ['createdBy', '创建人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
  COSTS: {
    resource: 'cost',
    edit: 'cost.update',
    table: 'cost_entry',
    columns: [
      ['category', '成本类别', 'TEXT'],
      ['amount', '成本金额', 'CURRENCY'],
      ['occurredAt', '发生日期', 'DATETIME'],
      ['caseId', '关联案件', 'TEXT'],
      ['channelId', '关联渠道', 'TEXT'],
      ['sourceApprovalId', '来源审批', 'TEXT'],
      ['note', '说明', 'LONG_TEXT'],
      ['createdBy', '创建人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
  CASES: {
    resource: 'case',
    edit: 'case.update',
    table: '"case"',
    columns: [
      ['caseNo', '案件编号', 'TEXT'],
      ['title', '案件名称', 'TEXT'],
      ['caseType', '案由', 'TEXT'],
      ['status', '案件状态', 'TEXT'],
      ['priority', '优先级', 'TEXT'],
      ['customerId', '关联客户', 'TEXT'],
      ['contractId', '关联合同', 'TEXT'],
      ['lawyerId', '主办律师', 'USER'],
      ['fee', '案件费用', 'CURRENCY'],
      ...INTAKE_FIELDS.map(
        ([key, label, kind]) =>
          [
            'intake.' + key,
            label,
            kind === 'money'
              ? 'CURRENCY'
              : kind === 'date'
                ? 'DATE'
                : kind === 'department'
                  ? 'ORGANIZATION'
                  : 'TEXT',
          ] as const,
      ),
      ['branchId', '所属组织', 'ORGANIZATION'],
      ['createdBy', '创建人', 'CREATED_BY'],
      ['createdAt', '创建时间', 'CREATED_AT'],
      ['updatedAt', '更新时间', 'UPDATED_AT'],
    ],
  },
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
        : (source === 'SOP_TASKS' ? 'sop.task.read' : `${domainSources[source].resource}.${action}` as PermissionCode);
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
  private compile(raw: unknown, alias: 'b' | 'l' | 'c' | 'k' | 'i' = 'b'): Prisma.Sql {
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
      if (key === 'contract' && alias === 'b') return this.compile(value, 'c');
      if (key === 'case' && alias === 'b') return this.compile(value, 'k');
      if (key === 'item' && alias === 'b') return this.compile(value, 'i');
      if (
        ![
          'id',
          'caseId',
          'employeeId',
          'createdBy',
          'branchId',
          'professionalTeamId',
          'negotiatorEmployeeId',
          'deletedAt',
        ].includes(key)
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
    if(source==='SOP_TASKS') {
      const root=await this.db.organization.findUnique({where:{id:access.organizationId}});if(!root||root.status!=='ENABLED')fail('COLLAB_FORBIDDEN',403);
      const now=new Date();
      const where:Prisma.CaseTaskWhereInput={AND:[await sopTaskScope(this.db,this.actor,permission),{sopInstance:{templateVersion:{template:{organization:{status:'ENABLED',OR:[{id:root.id},{path:{startsWith:root.path.replace(/\/$/,'')+'/'}}]}}}}},...(access.selfOnly?[{OR:[{createdBy:this.actor.userId},{sopAccesses:{some:{principalUserId:this.actor.userId,revokedAt:null,validFrom:{lte:now},OR:[{validUntil:null},{validUntil:{gt:now}}]}}}]}]:[])]};
      const rows=await this.db.caseTask.findMany({where,select:{id:true}});
      return rows.length?Prisma.sql`b.id IN (${Prisma.join(rows.map(row=>row.id))})`:Prisma.sql`FALSE`;
    }
    const financial = source === 'PAYMENTS' || source === 'INVOICES' || source === 'REFUNDS';
    const inventory = source.startsWith('INVENTORY_');
    const immutable = source === 'INVENTORY_MOVEMENTS' || source === 'INVENTORY_STOCKTAKES';
    const domain =
      source === 'CHANNELS'
        ? await channelScope(this.db, this.actor, permission)
        : inventory
          ? await inventoryScope(
              this.db,
              this.actor,
              permission,
              source === 'INVENTORY_ITEMS'
                ? 'items'
                : source === 'INVENTORY_MOVEMENTS'
                  ? 'movements'
                  : 'stocktakes',
            )
          : source === 'PERFORMANCES'
            ? await performanceScope(this.db, this.actor, permission)
            : financial
              ? await buildFinancialRecordScopeWhere(
                  this.db,
                  this.authorization,
                  this.actor,
                  permission,
                  domainSources[source].resource,
                )
              : source === 'COSTS'
                ? await buildCostScopeWhere(this.db, this.actor, permission)
                : source === 'CASES'
                  ? await buildCaseScopeWhere(this.db, this.actor, permission)
                  : source === 'CUSTOMERS'
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
    let organization = Prisma.sql`${Prisma.raw(financial ? 'c."branchId"' : 'b."branchId"')} IN (${Prisma.join(ids)})`;
    if (inventory) {
      const creators = await creatorIdsInOrganizations(this.db, ids);
      const column = Prisma.raw((immutable ? 'i' : 'b') + '."createdBy"');
      organization = creators.length
        ? Prisma.sql`${column} IN (${Prisma.join(creators)})`
        : Prisma.sql`FALSE`;
    }
    if (source === 'PERFORMANCES') {
      const now = new Date();
      const people = await this.db.employee.findMany({
        where: {
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
        select: { id: true },
      });
      organization = people.length
        ? Prisma.sql`b."employeeId" IN (${Prisma.join(people.map((p) => p.id))})`
        : Prisma.sql`FALSE`;
    }
    if (source === 'COSTS') {
      const creators = await costCreatorIds(this.db, ids);
      organization = Prisma.sql`(k."branchId" IN (${Prisma.join(ids)}) OR (b."caseId" IS NULL AND ${creators.length ? Prisma.sql`b."createdBy" IN (${Prisma.join(creators)})` : Prisma.sql`FALSE`}))`;
    }
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
    return Prisma.sql`${this.compile(domain)} AND ${['CHANNELS', 'CASES', 'INVOICES', 'REFUNDS', 'PERFORMANCES', 'INVENTORY_ITEMS', 'INVENTORY_MOVEMENTS', 'INVENTORY_STOCKTAKES'].includes(source) ? Prisma.sql`TRUE` : Prisma.sql`b."deletedAt" IS NULL`} AND ${financial ? Prisma.sql`c."deletedAt" IS NULL` : Prisma.sql`TRUE`} AND ${organization}
      AND ${access.selfOnly ? Prisma.sql`b."createdBy" = ${this.actor.userId}` : Prisma.sql`TRUE`}`;
  }
  from(source: DomainSource) {
    if (source === 'INVENTORY_MOVEMENTS' || source === 'INVENTORY_STOCKTAKES')
      return Prisma.sql`${Prisma.raw(domainSources[source].table)} b JOIN inventory_item i ON i.id = b."itemId"`;
    if (source === 'PAYMENTS' || source === 'INVOICES' || source === 'REFUNDS')
      return Prisma.sql`${Prisma.raw(domainSources[source].table)} b JOIN contract c ON c.id = b."contractId"`;
    if (source === 'COSTS') return Prisma.sql`cost_entry b LEFT JOIN "case" k ON k.id = b."caseId"`;
    return source === 'CUSTOMERS'
      ? Prisma.sql`customer b LEFT JOIN lead l ON l.id = b."sourceLeadId"`
      : Prisma.sql`${Prisma.raw(domainSources[source].table)} b`;
  }
  async sourceSql(table: CollabTable, access: Access, fields: CollabField[]) {
    if (!isDomainSource(table.source)) fail('COLLAB_INVALID_SOURCE');
    const definition = domainSources[table.source];
    const immutable = table.source === 'INVENTORY_MOVEMENTS' || table.source === 'INVENTORY_STOCKTAKES';
    const inventory = table.source.startsWith('INVENTORY_');
    const pairs = fields.flatMap((f) => {
      const key = object(f.options).businessKey;
      if (key && !definition.columns.some((c) => c[0] === key)) fail('COLLAB_INVALID_FIELD');
      const column =
        typeof key === 'string' && table.source === 'CASES' && key.startsWith('intake.')
          ? Prisma.sql`b."intakeData" ->> ${key.slice(7)}`
          : key
            ? Prisma.raw('b."' + key + '"')
            : null;
      const value = column
        ? ['DATETIME', 'CREATED_AT', 'UPDATED_AT'].includes(f.type)
          ? Prisma.sql`to_jsonb(${column} AT TIME ZONE 'UTC')`
          : f.type === 'CURRENCY' || (inventory && f.type === 'NUMBER')
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
      ${immutable ? Prisma.sql`1` : Prisma.sql`b.version`} + COALESCE(e.version, 0) AS version, b."createdBy", b."createdBy" AS "ownerId",
      b."createdAt", ${immutable ? Prisma.sql`b."createdAt"` : Prisma.sql`b."updatedAt"`} AS "updatedAt", COALESCE(e."updatedBy", ${inventory ? Prisma.sql`b."createdBy"` : Prisma.sql`b."updatedBy"`}, b."createdBy") AS "updatedBy", false AS archived
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
    >(Prisma.sql`SELECT ${source === 'INVENTORY_MOVEMENTS' || source === 'INVENTORY_STOCKTAKES' ? Prisma.sql`1` : Prisma.sql`b.version`} AS version FROM ${this.from(source)}
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
    const relatedLabels: Record<string, Map<string, string>> = {};
    for (const [key, permission] of [
      ['contractId', 'contract.read'],
      ['caseId', 'case.read'],
      ['paymentId', 'payment.read'],
    ] as const) {
      const field = fields.find((f) => object(f.options).businessKey === key);
      if (!field || !rows.length || !this.actor.permissionCodes.includes(permission)) continue;
      const targetIds = rows
        .map((row) => object(row.values)[field.id])
        .filter((id): id is string => typeof id === 'string');
      if (!targetIds.length) continue;
      const labels = new Map<string, string>();
      if (key === 'contractId') {
        const targets = await this.db.contract.findMany({
          where: {
            AND: [
              { id: { in: targetIds }, deletedAt: null },
              await buildContractScopeWhere(this.db, this.authorization, this.actor, 'contract.read'),
            ],
          },
          select: { id: true, contractNo: true, title: true },
        });
        targets.forEach((target) => labels.set(target.id, target.contractNo + ' · ' + target.title));
      } else if (key === 'caseId') {
        const targets = await this.db.case.findMany({
          where: {
            AND: [{ id: { in: targetIds } }, await buildCaseScopeWhere(this.db, this.actor, 'case.read')],
          },
          select: { id: true, caseNo: true, title: true },
        });
        targets.forEach((target) => labels.set(target.id, target.caseNo + ' · ' + target.title));
      } else {
        const targets = await this.db.payment.findMany({
          where: {
            AND: [
              { id: { in: targetIds }, deletedAt: null, contract: { deletedAt: null } },
              await buildFinancialRecordScopeWhere(
                this.db,
                this.authorization,
                this.actor,
                'payment.read',
                'payment',
              ),
            ],
          },
          select: { id: true, paymentNo: true },
        });
        targets.forEach((target) => labels.set(target.id, target.paymentNo));
      }
      relatedLabels[field.id] = labels;
    }
    const itemField = fields.find((f) => object(f.options).businessKey === 'itemId');
    if (itemField && rows.length && source.startsWith('INVENTORY_')) {
      const targetIds = rows.map((row) => String(object(row.values)[itemField.id]));
      const items = await this.db.inventoryItem.findMany({
        where: {
          AND: [
            { id: { in: targetIds } },
            await inventoryScope(this.db, this.actor, 'inventory.read', 'items'),
          ],
        },
        select: { id: true, code: true, name: true },
      });
      relatedLabels[itemField.id] = new Map(items.map((item) => [item.id, item.code + ' · ' + item.name]));
    }
    return rows.map((row) => {
      const label = customerField && labels.get(String(object(row.values)[customerField.id]));
      const displayValues = {
        ...(customerField && label ? { [customerField.id]: label } : {}),
        ...Object.fromEntries(
          Object.entries(relatedLabels).flatMap(([fieldId, labels]) => {
            const text = labels.get(String(object(row.values)[fieldId]));
            return text ? [[fieldId, text]] : [];
          }),
        ),
      };
      return {
        ...row,
        writable: ids.has(row.id),
        ...(Object.keys(displayValues).length ? { displayValues } : {}),
      };
    });
  }
}
