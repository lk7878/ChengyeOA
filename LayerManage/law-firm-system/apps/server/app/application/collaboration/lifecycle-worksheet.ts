import { INTAKE_OPTIONS } from '../case/intake-contract';
import { nextRefundNo } from '../contract/contract-number-service';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { randomUUID } from 'node:crypto';
import { appendCollaborationChange } from './collaboration-change';
import { notifyDeliveryChange } from './delivery-change';
import { auditRawL3Access } from '../crm/lead-audit';
import { AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildContractScopeWhere } from '../contract/contract-scope';
import { CollabField, CollabRecord, CollabTable, Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext } from '../authorization/authorization-service';
import { WorkspaceDomainSource } from '../crm/workspace-domain-source';
import { Access } from './collaboration-service';
import { fail, object, text } from './collaboration-policy';

type Tx = Prisma.TransactionClient;
export const lifecycleKinds = ['AFTER_SALES', 'CASE_REFUNDS'] as const;
export type LifecycleKind = (typeof lifecycleKinds)[number];
export const lifecycleKey = (f: CollabField) => String(object(f.options).lifecycleKey ?? '');
export const syncedLifecycleKeys = [
  'contractNo',
  'caseNo',
  'caseTitle',
  'customerName',
  'contractAmount',
  'signedDate',
  'caseCategory',
  'agencyProcedure',
  'customerPhone',
  'handlingLawyer',
  'caseCause',
  'terminated',
  'feeTotalLookup',
  'refundReceiptLookup',
  'actualRefundAmount', 'refundPaidAt', 'refundStatus', 'refundRequestNo',
];
export function lifecycleFields(kind: LifecycleKind) {
  const specs: Array<[string, string, string, boolean, unknown?]> = [
    ['signedDate', '签约日期', 'DATETIME', false],
    ['customerName', '客户姓名', 'TEXT', false],
    ['caseCategory', '案件类型', 'TEXT', false],
    ['agencyProcedure', '代理程序', 'MULTI_SELECT', false],
    ['upstreamId', '合同编号', 'TEXT', true],
    ['customerPhone', '客户电话', 'TEXT', false],
    ['handlingLawyer', '承办律师', 'TEXT', false],
    ['caseCause', '案由', 'TEXT', false],
  ];
  if (kind === 'AFTER_SALES')
    specs.push(
      ['feeTotal', '收费总金额', 'TEXT', false],
      ['terminated', '是否解除合同', 'SINGLE_SELECT', false],
      ['refundAmount', '退费金额', 'CURRENCY', false],
      ['refundReceipt', '退款凭证', 'FILE', false],
      ['refundReason', '退费原因', 'TEXT', false],
      ['closed', '是否结案', 'SINGLE_SELECT', false],
      ['reportMonth', '汇报月份', 'DATETIME', false],
      ['afterSalesSource', '售后来源', 'SINGLE_SELECT', false],
      ['review', '复盘情况', 'TEXT', false],
      ['content', '当事人诉求', 'TEXT', true],
      ['problemCause', '问题缘由', 'SINGLE_SELECT', false],
      ...Array.from({ length: 6 }, (_, i): [string, string, string, boolean] => [
        'handling' + (i + 1),
        '处理情况' + (i + 1),
        'TEXT',
        false,
      ]),
      ['createdAt', '创建时间', 'CREATED_AT', false],
      ['updatedAt', '最新更新时间', 'UPDATED_AT', false],
    );
  else
    specs.push(
      ['terminated', '是否解除合同', 'SINGLE_SELECT', false],
      ['feeTotalLookup', '收费总金额', 'TEXT', false],
      ['amount', '申请退款金额', 'CURRENCY', true],
      ['recipientName', '退款人姓名', 'TEXT', false],
      ['recipientBank', '退款人开户行', 'TEXT', false],
      ['recipientAccount', '退款人银行账号', 'TEXT', false],
      ['bankCardFiles', '银行卡附件', 'FILE', false],
      ['lawyerWork', '律师工作内容', 'TEXT', false],
      ['lawyerWorkFiles', '律师工作文书材料', 'FILE', false],
      ['interview', '面谈记录', 'TEXT', false],
      ['interviewFiles', '面谈记录材料', 'FILE', false],
      ['content', '退案事由', 'TEXT', true],
      ['terminationFiles', '解除委托代理协议', 'FILE', false],
      ['interviewer', '面谈人', 'TEXT', false],
      ['departmentInterview', '部门负责人面谈结果', 'TEXT', false],
      ['refundReceiptLookup', '退款凭证', 'FILE', false],
      ['actualRefundAmount', '实际退费金额', 'CURRENCY', false],
      ['refundPaidAt', '退费时间', 'DATETIME', false],
      ['refundStatus', '退款状态', 'TEXT', false],
      ['refundRequestNo', '退费单号', 'TEXT', false],
      ['createdAt', '记录创建时间', 'CREATED_AT', false],
      ['updatedAt', '最近更新记录', 'UPDATED_AT', false],
      ['remark', '备注', 'TEXT', false],
    );
  const visibleCount = specs.length;
  // Keep workflow and historical keys available in detail/settings, outside the requested grid layout.
  specs.push(
    ['status', kind === 'AFTER_SALES' ? '协商状态' : '退费办理状态', 'SINGLE_SELECT', true, 'OPEN'],
    ['contractNo', '合同编号（同步）', 'TEXT', false],
    ['caseNo', '案件编号（同步）', 'TEXT', false],
    ['caseTitle', '案件名称（同步）', 'TEXT', false],
    ['contractAmount', '合同金额（同步）', 'CURRENCY', false],
  );
  if (kind === 'AFTER_SALES') specs.push(['remark', '办理备注', 'TEXT', false]);
  const options: Record<string, string[]> = {
    terminated: ['是', '否'],
    closed: ['是', '否'],
    afterSalesSource: ['当事人', '司法局'],
    problemCause: ['当事人', '律师助理', '律师', '证据不足', '制度原因'],
    agencyProcedure: [...INTAKE_OPTIONS.agencyProcedure],
  };
  return specs.map(([key, name, type, required, defaultValue], position) => ({
    name,
    type,
    required,
    position,
    ...(defaultValue === undefined ? {} : { defaultValue: defaultValue as Prisma.InputJsonValue }),
    options: {
      lifecycleKey: key,
      defaultVisible: position < visibleCount,
      ...(options[key] ? { choices: options[key].map((name) => ({ id: name, name })) } : {}),
      ...(key === 'status'
        ? {
            choices: (kind === 'AFTER_SALES'
              ? [
                  ['OPEN', '协商中'],
                  ['RESOLVED', '已解决'],
                  ['REFUND_REQUIRED', '协商未果 / 需退款'],
                ]
              : [
                  ['OPEN', '待办理'],
                  ['CANCELLED', '已取消'],
                ]
            ).map(([id, name]) => ({ id, name })),
          }
        : {}),
    },
  }));
}

/** Application links keep stable IDs; display fields are queried from their authorized source on every read. */
export class LifecycleWorksheet {
  constructor(
    private db: PrismaClient,
    private actor: AuthorizationContext,
    private parentAccess: (tableId: string, tx?: Tx) => Promise<{ access: Access; fields: CollabField[] }>,
  ) {}
  async auditPhone(fields: CollabField[], count: number) {
    if (!count || !fields.some((f) => !object(f.options).worksheetMasked && lifecycleKey(f) === 'customerPhone')) return;
    const permissions = new WorkspaceDomainSource(this.db, this.actor).permissions();
    await auditRawL3Access(
      this.db,
      { actorUserId: this.actor.userId },
      'CUSTOMER',
      'LIST',
      'customer',
      {
        phone: this.actor.permissionCodes.includes('customer.read') ? permissions.phone : 'NONE',
        wechat: 'NONE',
      },
      count,
      'workspace.lifecycle.customer-phone',
    );
  }
  authorize(kind: string, deleting = false) {
    if (
      !this.actor.permissionCodes.includes(
        kind === 'CASE_REFUNDS' ? 'refund.create' : deleting ? 'case.delete' : 'case.update',
      )
    )
      fail('COLLAB_FORBIDDEN', 403);
  }
  async parentPredicate(workspaceId: string, tx: Tx = this.db) {
    const tables = await tx.collabTable.findMany({
      where: { lifecycleKind: 'AFTER_SALES', archived: false },
      select: { id: true },
    });
    const clauses: Prisma.Sql[] = [];
    for (const table of tables) {
      try {
        const { access, fields } = await this.parentAccess(table.id, tx);
        if (
          access.workspaceId !== workspaceId ||
          !fields.some((f) => !access.masked?.includes(f.id) && !access.conditional?.includes(f.id) && lifecycleKey(f) === 'upstreamId') ||
          !fields.some((f) => !access.masked?.includes(f.id) && !access.conditional?.includes(f.id) && lifecycleKey(f) === 'status')
        )
          continue;
        clauses.push(
          Prisma.sql`p."tableId" = ${table.id} AND ${access.rowIds ? Prisma.sql`p.id=ANY(${access.rowIds}::text[])` : Prisma.sql`TRUE`} AND ${access.selfOnly ? Prisma.sql`p."createdBy" = ${this.actor.userId}` : Prisma.sql`TRUE`}`,
        );
      } catch (e) {
        if (![403, 404].includes(Number((e as { status?: number }).status))) throw e;
      }
    }
    return clauses.length
      ? Prisma.sql`(${Prisma.join(
          clauses.map((c) => Prisma.sql`(${c})`),
          ' OR ',
        )})`
      : Prisma.sql`FALSE`;
  }
  private async expressions(table: CollabTable, access: Access, contractAlias: 'c' | 'ct') {
    const domain = new WorkspaceDomainSource(this.db, this.actor);
    const contract = (key: string) => Prisma.raw(contractAlias + '."' + key + '"');
    const phoneLevel = domain.permissions().phone;
    const expressions: Record<string, Prisma.Sql> = {
      contractNo: Prisma.sql`CASE WHEN b."contractId" IS NOT NULL THEN ${contract('contractNo')} ELSE b."intakeData"->>'contractNumber' END`,
      caseNo: Prisma.sql`b."caseNo"`,
      caseTitle: Prisma.sql`b.title`,
      customerName: Prisma.sql`cu.name`,
      contractAmount: Prisma.sql`${contract('amount')}::text`,
      signedDate: Prisma.sql`b."intakeData"->>'signedDate'`,
      caseCategory: Prisma.sql`b."intakeData"->>'caseCategory'`,
      agencyProcedure: Prisma.sql`CASE WHEN b."intakeData"->>'agencyProcedure' LIKE '[%' THEN (b."intakeData"->>'agencyProcedure')::jsonb WHEN b."intakeData"->>'agencyProcedure' IS NULL THEN NULL ELSE jsonb_build_array(b."intakeData"->>'agencyProcedure') END`,
      customerPhone:
        phoneLevel === 'READ'
          ? Prisma.sql`cu.phone`
          : phoneLevel === 'NONE'
            ? Prisma.sql`NULL::text`
            : Prisma.sql`CASE WHEN cu.phone IS NULL THEN NULL WHEN length(cu.phone)>=7 THEN left(cu.phone,3)||'****'||right(cu.phone,4) ELSE '****' END`,
      handlingLawyer: Prisma.sql`COALESCE((SELECT e.name FROM employee e WHERE e.id=b."intakeData"->>'handlingLawyer'), b."intakeData"->>'handlingLawyer')`,
      caseCause: Prisma.sql`b."caseType"`,
      // The user will supply the rule later. Keep both worksheets read-only and blank.
      terminated: Prisma.sql`NULL::text`,
      feeTotalLookup: Prisma.sql`NULL::text`,
      refundReceiptLookup: Prisma.sql`NULL::jsonb`,
      actualRefundAmount: Prisma.sql`NULL::text`,
      refundPaidAt: Prisma.sql`NULL::text`,
      refundStatus: Prisma.sql`NULL::text`,
      refundRequestNo: Prisma.sql`NULL::text`,
    };
    if (table.lifecycleKind === 'CASE_REFUNDS') {
      const tables = await this.db.collabTable.findMany({
        where: { lifecycleKind: 'AFTER_SALES', archived: false },
        select: { id: true },
      });
      const permitted: Array<{ id: string; fields: CollabField[] }> = [];
      for (const t of tables)
        try {
          const a = await this.parentAccess(t.id);
          if (a.access.workspaceId === access.workspaceId) permitted.push({ id: t.id, fields: a.fields.filter(f=>!a.access.masked?.includes(f.id) && !a.access.conditional?.includes(f.id)) });
        } catch (e) {
          if (![403, 404].includes(Number((e as { status?: number }).status))) throw e;
        }
      for (const key of Object.keys(expressions)) {
        if(['refundReceiptLookup','actualRefundAmount','refundPaidAt','refundStatus','refundRequestNo'].includes(key)) continue;
        const upstreamKey =
          key === 'feeTotalLookup' ? 'feeTotal' : key === 'refundReceiptLookup' ? 'refundReceipt' : key;
        const columns = permitted.flatMap((t) => {
          const f = t.fields.find((f) => lifecycleKey(f) === upstreamKey);
          return f ? [{ table: t.id, field: f.id }] : [];
        });
        const clauses = columns.map(
          (c) =>
            Prisma.sql`WHEN p."tableId"=${c.table} THEN ${key === 'feeTotalLookup' ? Prisma.sql`p.values->>${c.field}` : key === 'refundReceiptLookup' ? Prisma.sql`p.values->${c.field}` : expressions[key]}`,
        );
        expressions[key] = clauses.length
          ? Prisma.sql`CASE ${Prisma.join(clauses, ' ')} ELSE NULL END`
          : key === 'refundReceiptLookup' || key === 'agencyProcedure'
            ? Prisma.sql`NULL::jsonb`
            : Prisma.sql`NULL::text`;
      }
    }
    return expressions;
  }
  async sourceSql(table: CollabTable, access: Access, fields: CollabField[]) {
    const domain = new WorkspaceDomainSource(this.db, this.actor);
    const parent =
      table.lifecycleKind === 'CASE_REFUNDS'
        ? await this.parentPredicate(access.workspaceId)
        : Prisma.sql`TRUE`;
    const customerScope = this.actor.permissionCodes.includes('customer.read')
      ? await domain.scope('CUSTOMERS', access)
      : Prisma.sql`FALSE`;
    const contractScope = this.actor.permissionCodes.includes('contract.read')
      ? await domain.scope('CONTRACTS', access)
      : Prisma.sql`FALSE`;
    const expressions = await this.expressions(table, access, 'ct');
    if (table.lifecycleKind === 'CASE_REFUNDS') {
      // Execution fields come exclusively from the uniquely linked financial application.
      expressions.actualRefundAmount=Prisma.sql`(SELECT f."actualAmount"::text FROM refund_request f WHERE f."sourceRecordId"=r.id AND f.status='EXECUTED')`;
      expressions.refundPaidAt=Prisma.sql`(SELECT f."paidAt"::text FROM refund_request f WHERE f."sourceRecordId"=r.id AND f.status='EXECUTED')`;
      expressions.refundReceiptLookup=Prisma.sql`(SELECT f."voucherFiles" FROM refund_request f WHERE f."sourceRecordId"=r.id AND f.status='EXECUTED')`;
      expressions.refundRequestNo=Prisma.sql`(SELECT f."requestNo" FROM refund_request f WHERE f."sourceRecordId"=r.id)`;
      expressions.refundStatus=Prisma.sql`CASE WHEN x.status='AUTO_PENDING' THEN '待补充退款信息' ELSE (SELECT CASE f.status WHEN 'EXECUTED' THEN '已退款' WHEN 'REJECTED' THEN '已驳回' WHEN 'APPROVED' THEN '待退款（已审批）' ELSE '待退款（待审批）' END FROM refund_request f WHERE f."sourceRecordId"=r.id) END`;
    }
    const visibleKeys = fields.map(lifecycleKey);
    const label = Prisma.sql`concat_ws(' · ', ${visibleKeys.includes('contractNo') || visibleKeys.includes('upstreamId') ? expressions.contractNo : Prisma.sql`NULL`}, ${visibleKeys.includes('caseNo') ? expressions.caseNo : Prisma.sql`NULL`}, ${visibleKeys.includes('caseTitle') ? expressions.caseTitle : Prisma.sql`NULL`})`;
    const writeScope =
      this.actor.permissionCodes.includes('case.update') &&
      (table.lifecycleKind !== 'CASE_REFUNDS' || this.actor.permissionCodes.includes('refund.create'))
        ? await domain.scope('CASES', access, 'update')
        : Prisma.sql`FALSE`;
    const pairs = fields
      .filter((f) => syncedLifecycleKeys.includes(lifecycleKey(f)))
      .flatMap((f) => [Prisma.sql`${f.id}::text`, Prisma.sql`to_jsonb(${expressions[lifecycleKey(f)]})`]);
    return Prisma.sql`SELECT r.id, r."tableId", r."createdBy", r."updatedBy", r."ownerId", r.version, r.archived, r."createdAt", r."updatedAt",
      r.values || jsonb_build_object('_lifecycleCaseId', b.id, '_lifecycleCaseNo', ${visibleKeys.includes('caseNo') ? expressions.caseNo : Prisma.sql`NULL`}, '_lifecycleContractId', ${visibleKeys.includes('contractNo') || visibleKeys.includes('upstreamId') ? Prisma.sql`ct.id` : Prisma.sql`NULL`}, '_lifecycleWritable', (${writeScope}), '_lifecycleLabel', ${label}) || ${pairs.length ? Prisma.sql`jsonb_build_object(${Prisma.join(pairs)})` : Prisma.sql`'{}'::jsonb`} AS values
      FROM collab_record r JOIN collab_lifecycle_link x ON x."recordId" = r.id
      JOIN "case" b ON b.id = x."caseId"
      LEFT JOIN collab_record p ON p.id = x."parentRecordId"
      LEFT JOIN (SELECT b.id, b."contractNo", b.amount, b.status FROM contract b WHERE ${contractScope}) ct ON ct.id = b."contractId"
      LEFT JOIN (SELECT b.id, b.name, b.phone FROM customer b LEFT JOIN lead l ON l.id = b."sourceLeadId" WHERE ${customerScope}) cu ON cu.id = b."customerId"
      WHERE r."tableId" = ${table.id} AND ${await domain.scope('CASES', access)} AND ${parent}
      AND ${table.lifecycleKind === 'CASE_REFUNDS' ? Prisma.sql`p.archived = false` : Prisma.sql`TRUE`}`;
  }
  async choices(table: CollabTable, access: Access, fields: CollabField[], keyword: string, page: number) {
    const domain = new WorkspaceDomainSource(this.db, this.actor);
    const contractScope = this.actor.permissionCodes.includes('contract.read')
      ? await domain.scope('CONTRACTS', access)
      : Prisma.sql`FALSE`;
    const customerScope = this.actor.permissionCodes.includes('customer.read')
      ? await domain.scope('CUSTOMERS', access)
      : Prisma.sql`FALSE`;
    const expressions = await this.expressions(table, access, 'c');
    const keys = fields.map(lifecycleKey).filter((k) => syncedLifecycleKeys.includes(k));
    const preview = keys.length
      ? Prisma.sql`jsonb_build_object(${Prisma.join(keys.flatMap((k) => [Prisma.sql`${k}::text`, expressions[k]]))})`
      : Prisma.sql`'{}'::jsonb`;
    const label = Prisma.sql`concat_ws(' · ', ${keys.includes('contractNo') || fields.some((f) => lifecycleKey(f) === 'upstreamId') ? expressions.contractNo : Prisma.sql`NULL`}, ${keys.includes('caseNo') ? expressions.caseNo : Prisma.sql`NULL`}, ${keys.includes('caseTitle') ? expressions.caseTitle : Prisma.sql`NULL`})`;
    const customerJoin = Prisma.sql`LEFT JOIN (SELECT b.id,b.name,b.phone FROM customer b LEFT JOIN lead l ON l.id=b."sourceLeadId" WHERE ${customerScope}) cu ON cu.id=b."customerId"`;
    if (table.lifecycleKind === 'CASE_REFUNDS') {
      const parent = await this.parentPredicate(access.workspaceId);
      const rows = await this.db.$queryRaw<Array<{ id: string; label: string; preview: Record<string, unknown>; afterSalesStatus: string; disabled: boolean }>>(Prisma.sql`
        SELECT p.id, ${label} AS label, ${preview} AS preview,
          x.status AS "afterSalesStatus", x.status <> 'REFUND_REQUIRED' AS disabled
        FROM collab_record p JOIN collab_lifecycle_link x ON x."recordId" = p.id JOIN "case" b ON b.id = x."caseId"
        LEFT JOIN (SELECT b.id, b."contractNo", b.amount, b.status FROM contract b WHERE ${contractScope}) c ON c.id = b."contractId" ${customerJoin}
        WHERE x.kind = 'AFTER_SALES' AND p.archived = false AND ${parent}
        AND ${await domain.scope('CASES', access)} AND ${label} ILIKE ${'%' + keyword + '%'}
        ORDER BY (x.status = 'REFUND_REQUIRED') DESC, p.id LIMIT 20 OFFSET ${(page - 1) * 20}`);
      await this.auditPhone(fields, rows.length);
      return {
        sourceKind: 'AFTER_SALES' as const,
        rows: rows.map(row => ({
          ...row,
          disabledReason: row.afterSalesStatus === 'REFUND_REQUIRED' ? undefined
            : row.afterSalesStatus === 'OPEN' ? '协商中：请先在售后管理表将协商状态改为“协商未果 / 需退款”。'
              : row.afterSalesStatus === 'RESOLVED' ? '已解决：当前无需办理退费。'
                : '当前售后状态不能登记退费，请核对协商状态。',
        })),
        hasMore: rows.length === 20,
      };
    }
    const rows = await this.db.$queryRaw<Array<{ id: string; label: string }>>(Prisma.sql`
      SELECT b.id, ${label} AS label, ${preview} AS preview
      FROM "case" b LEFT JOIN (SELECT b.id, b."contractNo", b.amount, b.status FROM contract b WHERE ${contractScope}) c ON c.id = b."contractId" ${customerJoin}
      WHERE ${await domain.scope('CASES', access)} AND ${label} ILIKE ${'%' + keyword + '%'}
      ORDER BY b.id LIMIT 20 OFFSET ${(page - 1) * 20}`);
    await this.auditPhone(fields, rows.length);
    return { rows, hasMore: rows.length === 20 };
  }
  async validate(
    tx: Tx,
    table: CollabTable,
    fields: CollabField[],
    access: Access,
    values: Record<string, unknown>,
    previous: CollabRecord | null,
    deleting: boolean,
  ) {
    this.authorize(table.lifecycleKind!, deleting);
    const domain = new WorkspaceDomainSource(this.db, this.actor);
    const get = (key: string) => values[fields.find((f) => lifecycleKey(f) === key)?.id ?? ''];
    if (previous) {
      const oldVisible = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT r.id FROM (${await this.sourceSql(table, access, fields)}) r WHERE r.id = ${previous.id}`,
      );
      if (!oldVisible.length) fail('LIFECYCLE_CASE_UNAVAILABLE', 404);
    }
    const upstreamId = text(get('upstreamId'));
    let caseId = upstreamId,
      parentRecordId: string | null = null;
    if (table.lifecycleKind === 'CASE_REFUNDS') {
      parentRecordId = upstreamId;
      await tx.$queryRaw`SELECT id FROM collab_record WHERE id = ${upstreamId} FOR UPDATE`;
      const parent = await tx.collabLifecycleLink.findUnique({
        where: { recordId: upstreamId },
        include: { record: true },
      });
      if (!parent || parent.kind !== 'AFTER_SALES' || parent.record.archived)
        fail('LIFECYCLE_PARENT_UNAVAILABLE', 409);
      const a = await this.parentAccess(parent.tableId, tx);
      if (
        a.access.workspaceId !== access.workspaceId ||
        (a.access.rowIds && !a.access.rowIds.includes(parent.record.id)) ||
        (a.access.selfOnly && parent.record.createdBy !== this.actor.userId) ||
        !a.fields.some((f) => !a.access.masked?.includes(f.id) && lifecycleKey(f) === 'upstreamId') ||
        !a.fields.some((f) => !a.access.masked?.includes(f.id) && lifecycleKey(f) === 'status')
      )
        fail('COLLAB_FORBIDDEN', 403);
      if (parent.status !== 'REFUND_REQUIRED') fail('LIFECYCLE_REFUND_STATE', 409);
      caseId = parent.caseId;
    }
    await tx.$queryRaw`SELECT id FROM "case" WHERE id = ${caseId} FOR UPDATE`;
    const rows = await tx.$queryRaw<Array<{ id: string; contractId: string | null }>>(
      Prisma.sql`SELECT b.id, b."contractId" FROM "case" b WHERE b.id = ${caseId} AND ${await domain.scope('CASES', access)} AND ${await domain.scope('CASES', access, deleting && table.lifecycleKind === 'AFTER_SALES' ? 'delete' : 'update')}`,
    );
    if (!rows.length) fail('LIFECYCLE_CASE_UNAVAILABLE', 404);
    if (previous) {
      const old = await tx.collabLifecycleLink.findUnique({ where: { recordId: previous.id } });
      if (
        (deleting || old?.caseId !== caseId) &&
        (await tx.collabLifecycleLink.count({ where: { parentRecordId: previous.id } }))
      )
        fail('LIFECYCLE_HAS_CHILDREN', 409);
    }
    const duplicate = await tx.collabLifecycleLink.findFirst({
      where: { tableId: table.id, caseId, ...(previous ? { recordId: { not: previous.id } } : {}) },
    });
    if (duplicate) fail('LIFECYCLE_DUPLICATE_CASE', 409);
    let pending = false;
    if (table.lifecycleKind === 'CASE_REFUNDS') {
      const link = previous ? await tx.collabLifecycleLink.findUnique({ where: { recordId: previous.id } }) : null;
      pending = link?.status === 'AUTO_PENDING' && (get('amount') === undefined || get('amount') === null || get('amount') === '');
      if (previous) {
        const financial = await tx.refundRequest.findUnique({where:{sourceRecordId:previous.id}});
        if (financial && (!['PENDING','REJECTED'].includes(financial.status) || financial.contractId !== rows[0].contractId)) fail('LIFECYCLE_FINANCE_LOCKED',409);
      }
      const contractScope = await buildContractScopeWhere(
        this.db,
        new AuthorizationService(new DataScopeService(this.db)),
        this.actor,
        'refund.create',
        'refund',
      );
      if (
        !rows[0].contractId ||
        !(await tx.contract.findFirst({
          where: { AND: [contractScope, { id: rows[0].contractId, deletedAt: null }] },
        }))
      )
        fail('LIFECYCLE_REFUND_CONTRACT_UNAVAILABLE', 403);
      const amount = String(get('amount') ?? '');
      if (
        !pending && (!/^\d+(\.\d{1,2})?$/.test(amount) ||
        !new Prisma.Decimal(amount).greaterThan(0) ||
        new Prisma.Decimal(amount).greaterThan('9999999999999999.99'))
      )
        fail('LIFECYCLE_INVALID_AMOUNT', 422);
    }
    return {
      tableId: table.id,
      caseId,
      parentRecordId,
      kind: table.lifecycleKind!,
      status: pending ? 'AUTO_PENDING' : text(get('status')),
    };
  }
  /** System-created todos are intentionally incomplete, never a zero-value financial request. */
  async pendingFields(tx: Tx, recordId: string | undefined, fields: CollabField[]) {
    const link = recordId ? await tx.collabLifecycleLink.findUnique({ where: { recordId } }) : null;
    return link?.kind === 'CASE_REFUNDS' && link.status === 'AUTO_PENDING'
      ? fields.map(f => lifecycleKey(f) === 'amount' ? { ...f, required: false } : f)
      : fields;
  }

  /** Runs in the source save transaction (including inline edits, batches and undo). */
  async syncRefundTodo(tx: Tx, table: CollabTable, source: CollabRecord, caseId: string, status: string) {
    if (table.lifecycleKind !== 'AFTER_SALES') return;
    const children = await tx.collabLifecycleLink.findMany({
      where: { parentRecordId: source.id, kind: 'CASE_REFUNDS' },
      include: { record: { include: { table: true } } },
    });
    if (status !== 'REFUND_REQUIRED' || source.archived) {
      for (const child of children.filter(c => !c.record.archived)) {
        // Serialize against finance approval/execution, not just table edits.
        await tx.$queryRaw`SELECT id FROM refund_request WHERE "sourceRecordId"=${child.recordId} FOR UPDATE`;
        const financial = await tx.refundRequest.findUnique({ where: { sourceRecordId: child.recordId } });
        if (financial && !['PENDING', 'REJECTED'].includes(financial.status)) fail('LIFECYCLE_FINANCE_LOCKED', 409);
        if (financial) {
          await tx.refundRequest.update({ where: { id: financial.id }, data: {
            status: 'REJECTED', approvalComment: 'AFTER_SALES_WITHDRAWN', updatedBy: this.actor.userId, version: { increment: 1 },
          } });
          await notifyDeliveryChange(tx, this.actor.userId, financial.id);
        }
        const saved = await tx.collabRecord.update({ where: { id: child.recordId }, data: {
          archived: true, updatedBy: this.actor.userId, version: { increment: 1 },
        } });
        await tx.collabLifecycleLink.update({ where: { recordId: saved.id }, data: { status: 'AUTO_WITHDRAWN' } });
        await tx.collabRevision.create({ data: { recordId: saved.id, version: saved.version, actorId: this.actor.userId,
          changes: { archived: { before: false, after: true } } } });
        await appendCollaborationChange(tx, this.actor.userId, child.record.table.baseId, 'refund.todo.withdrawn', saved.id);
      }
      return;
    }
    if (children.length) {
      for (const child of children.filter(c => c.status === 'AUTO_WITHDRAWN' && c.record.archived && !c.record.table.archived)) {
        const saved = await tx.collabRecord.update({ where: { id: child.recordId }, data: {
          archived: false, updatedBy: this.actor.userId, version: { increment: 1 },
        } });
        // Restore the same todo, with all user-entered fields intact. Finance resumes only after a user saves it.
        await tx.collabLifecycleLink.update({ where: { recordId: saved.id }, data: { status: 'AUTO_PENDING' } });
        await tx.collabRevision.create({ data: { recordId: saved.id, version: saved.version, actorId: this.actor.userId,
          changes: { archived: { before: true, after: false } } } });
        await appendCollaborationChange(tx, this.actor.userId, child.record.table.baseId, 'refund.todo.restored', saved.id);
      }
      return;
    }
    const targets = await tx.collabTable.findMany({ where: {
      baseId: table.baseId, lifecycleKind: 'CASE_REFUNDS', source: 'CUSTOM', archived: false,
    }, include: { fields: { where: { archived: false } } } });
    if (targets.length !== 1) fail('LIFECYCLE_REFUND_TARGET_UNAVAILABLE', 409);
    const target = targets[0];
    if (await tx.collabLifecycleLink.findFirst({ where: { tableId: target.id, caseId } })) fail('LIFECYCLE_DUPLICATE_CASE', 409);
    const values: Prisma.JsonObject = {};
    for (const field of target.fields) {
      const fieldKey = lifecycleKey(field);
      if (fieldKey === 'upstreamId') values[field.id] = source.id;
      else if (fieldKey === 'status') values[field.id] = 'OPEN';
      else if (fieldKey === 'content') values[field.id] = '售后转退费，待补充退款信息';
      else if (fieldKey === 'createdAt' || fieldKey === 'updatedAt') values[field.id] = new Date().toISOString();
    }
    if (!target.fields.some(f => lifecycleKey(f) === 'upstreamId') || !target.fields.some(f => lifecycleKey(f) === 'amount')) fail('LIFECYCLE_REFUND_TARGET_UNAVAILABLE', 409);
    // Core case data stays a permission-filtered live projection, never a copied raw snapshot.
    const saved = await tx.collabRecord.create({ data: {
      tableId: target.id, values, createdBy: source.createdBy, ownerId: source.ownerId, updatedBy: this.actor.userId,
    } });
    await tx.collabLifecycleLink.create({ data: { recordId: saved.id, tableId: target.id, caseId,
      parentRecordId: source.id, kind: 'CASE_REFUNDS', status: 'AUTO_PENDING' } });
    await tx.collabRevision.create({ data: { recordId: saved.id, version: saved.version, actorId: this.actor.userId,
      changes: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { before: null as Prisma.JsonValue, after: value }])) } });
    await appendCollaborationChange(tx, this.actor.userId, target.baseId, 'refund.todo.created', saved.id);
  }
  async syncFinancialApplication(tx: Tx, table: CollabTable, record: CollabRecord, fields: CollabField[], caseId: string) {
    if (table.lifecycleKind !== 'CASE_REFUNDS') return;
    const link = await tx.collabLifecycleLink.findUnique({ where: { recordId: record.id } });
    if (link?.status === 'AUTO_PENDING') return;
    const values=object(record.values);
    const get=(key:string)=>values[fields.find(f=>lifecycleKey(f)===key)?.id??''];
    const linkedCase=await tx.case.findUniqueOrThrow({where:{id:caseId}});
    if(!linkedCase.contractId) fail('LIFECYCLE_REFUND_CONTRACT_UNAVAILABLE',409);
    await tx.$queryRaw`SELECT id FROM contract WHERE id=${linkedCase.contractId} FOR UPDATE`;
    const existing=await tx.refundRequest.findUnique({where:{sourceRecordId:record.id}});
    if(existing && !['PENDING','REJECTED'].includes(existing.status)) fail('LIFECYCLE_FINANCE_LOCKED',409);
    const data={amount:new Prisma.Decimal(String(get('amount'))),reason:String(get('content')),recipientName:String(get('recipientName')??''),recipientBank:String(get('recipientBank')??''),recipientAccount:String(get('recipientAccount')??''),status:record.archived?'REJECTED':'PENDING',approvalComment:record.archived?'SOURCE_ARCHIVED':null,updatedBy:this.actor.userId};
    const request=await tx.refundRequest.upsert({where:{sourceRecordId:record.id},create:{...data,sourceRecordId:record.id,requestNo:nextRefundNo(),contractId:linkedCase.contractId,customerId:linkedCase.customerId,type:'REFUND',createdBy:record.createdBy},update:{...data,approvedBy:null,approvedAt:null,actualAmount:null,paidAt:null,voucherFiles:[],version:{increment:1}}});
    if(!existing) {
      const contract=await tx.contract.findUniqueOrThrow({where:{id:linkedCase.contractId}});
      await new PrismaEventOutboxWriter().append(tx,{eventType:'refund.requested',eventVersion:1,objectType:'REFUND_REQUEST',objectId:request.id,operatorUserId:this.actor.userId,organizationId:null,branchId:contract.branchId,teamId:contract.professionalTeamId,traceId:randomUUID(),occurredAt:new Date(),payload:{refundRequestId:request.id,requestNo:request.requestNo,contractId:request.contractId,customerId:request.customerId,type:'REFUND',status:'PENDING'}});
    }
    await tx.operationLog.create({data:{userId:this.actor.userId,action:'REFUND_APPLICATION_SYNC',targetType:'REFUND_REQUEST',targetId:request.id,newValues:JSON.stringify({sourceRecordId:record.id,status:request.status})}});
    await notifyDeliveryChange(tx,this.actor.userId,request.id);
  }
}
