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
export const syncedLifecycleKeys = ['contractNo', 'caseNo', 'caseTitle', 'customerName', 'contractAmount'];
export function lifecycleFields(kind: LifecycleKind) {
  const specs: Array<[string, string, string, boolean, unknown?]> = [
    ['upstreamId', kind === 'AFTER_SALES' ? '关联案件（案件ID）' : '关联售后（售后记录ID）', 'TEXT', true],
    ['contractNo', '合同编号（同步）', 'TEXT', false],
    ['caseNo', '案件编号（同步）', 'TEXT', false],
    ['caseTitle', '案件名称（同步）', 'TEXT', false],
    ['customerName', '客户名称（同步）', 'TEXT', false],
    ['contractAmount', '合同金额（同步）', 'CURRENCY', false],
    ['content', kind === 'AFTER_SALES' ? '售后问题' : '退费原因', 'LONG_TEXT', true],
    ['status', kind === 'AFTER_SALES' ? '协商状态' : '退费办理状态', 'SINGLE_SELECT', true, 'OPEN'],
    ['remark', '办理备注', 'LONG_TEXT', false],
  ];
  if (kind === 'CASE_REFUNDS') specs.push(['amount', '申请退费金额', 'CURRENCY', true]);
  return specs.map(([key, name, type, required, defaultValue], position) => ({
    name,
    type,
    required,
    position,
    ...(defaultValue === undefined ? {} : { defaultValue: defaultValue as Prisma.InputJsonValue }),
    options: {
      lifecycleKey: key,
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
          !fields.some((f) => lifecycleKey(f) === 'upstreamId') ||
          !fields.some((f) => lifecycleKey(f) === 'status')
        )
          continue;
        clauses.push(
          Prisma.sql`p."tableId" = ${table.id} AND ${access.selfOnly ? Prisma.sql`p."createdBy" = ${this.actor.userId}` : Prisma.sql`TRUE`}`,
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
    const expressions: Record<string, Prisma.Sql> = {
      contractNo: Prisma.sql`ct."contractNo"`,
      caseNo: Prisma.sql`b."caseNo"`,
      caseTitle: Prisma.sql`b.title`,
      customerName: Prisma.sql`cu.name`,
      contractAmount: Prisma.sql`ct.amount::text`,
    };
    const visibleKeys = fields.map(lifecycleKey);
    const label = Prisma.sql`concat_ws(' · ', ${visibleKeys.includes('contractNo') ? expressions.contractNo : Prisma.sql`NULL`}, ${visibleKeys.includes('caseNo') ? expressions.caseNo : Prisma.sql`NULL`}, ${visibleKeys.includes('caseTitle') ? expressions.caseTitle : Prisma.sql`NULL`})`;
    const writeScope =
      this.actor.permissionCodes.includes('case.update') &&
      (table.lifecycleKind !== 'CASE_REFUNDS' || this.actor.permissionCodes.includes('refund.create'))
        ? await domain.scope('CASES', access, 'update')
        : Prisma.sql`FALSE`;
    const pairs = fields
      .filter((f) => syncedLifecycleKeys.includes(lifecycleKey(f)))
      .flatMap((f) => [Prisma.sql`${f.id}::text`, Prisma.sql`to_jsonb(${expressions[lifecycleKey(f)]})`]);
    return Prisma.sql`SELECT r.id, r."tableId", r."createdBy", r."updatedBy", r."ownerId", r.version, r.archived, r."createdAt", r."updatedAt",
      r.values || jsonb_build_object('_lifecycleCaseId', b.id, '_lifecycleCaseNo', ${visibleKeys.includes('caseNo') ? expressions.caseNo : Prisma.sql`NULL`}, '_lifecycleContractId', ${visibleKeys.includes('contractNo') ? Prisma.sql`ct.id` : Prisma.sql`NULL`}, '_lifecycleWritable', (${writeScope}), '_lifecycleLabel', ${label}) || ${pairs.length ? Prisma.sql`jsonb_build_object(${Prisma.join(pairs)})` : Prisma.sql`'{}'::jsonb`} AS values
      FROM collab_record r JOIN collab_lifecycle_link x ON x."recordId" = r.id
      JOIN "case" b ON b.id = x."caseId"
      LEFT JOIN collab_record p ON p.id = x."parentRecordId"
      LEFT JOIN (SELECT b.id, b."contractNo", b.amount FROM contract b WHERE ${contractScope}) ct ON ct.id = b."contractId"
      LEFT JOIN (SELECT b.id, b.name FROM customer b LEFT JOIN lead l ON l.id = b."sourceLeadId" WHERE ${customerScope}) cu ON cu.id = b."customerId"
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
    const expressions: Record<string, Prisma.Sql> = {
      contractNo: Prisma.sql`c."contractNo"`,
      caseNo: Prisma.sql`b."caseNo"`,
      caseTitle: Prisma.sql`b.title`,
      customerName: Prisma.sql`cu.name`,
      contractAmount: Prisma.sql`c.amount::text`,
    };
    const keys = fields.map(lifecycleKey).filter((k) => syncedLifecycleKeys.includes(k));
    const preview = keys.length
      ? Prisma.sql`jsonb_build_object(${Prisma.join(keys.flatMap((k) => [Prisma.sql`${k}::text`, expressions[k]]))})`
      : Prisma.sql`'{}'::jsonb`;
    const label = Prisma.sql`concat_ws(' · ', ${keys.includes('contractNo') ? expressions.contractNo : Prisma.sql`NULL`}, ${keys.includes('caseNo') ? expressions.caseNo : Prisma.sql`NULL`}, ${keys.includes('caseTitle') ? expressions.caseTitle : Prisma.sql`NULL`})`;
    const customerJoin = Prisma.sql`LEFT JOIN (SELECT b.id,b.name FROM customer b LEFT JOIN lead l ON l.id=b."sourceLeadId" WHERE ${customerScope}) cu ON cu.id=b."customerId"`;
    if (table.lifecycleKind === 'CASE_REFUNDS') {
      const parent = await this.parentPredicate(access.workspaceId);
      const rows = await this.db.$queryRaw<Array<{ id: string; label: string }>>(Prisma.sql`
        SELECT p.id, ${label} AS label, ${preview} AS preview
        FROM collab_record p JOIN collab_lifecycle_link x ON x."recordId" = p.id JOIN "case" b ON b.id = x."caseId"
        LEFT JOIN (SELECT b.id, b."contractNo", b.amount FROM contract b WHERE ${contractScope}) c ON c.id = b."contractId" ${customerJoin}
        WHERE x.kind = 'AFTER_SALES' AND x.status = 'REFUND_REQUIRED' AND p.archived = false AND ${parent}
        AND ${await domain.scope('CASES', access)} AND ${label} ILIKE ${'%' + keyword + '%'}
        ORDER BY p.id LIMIT 20 OFFSET ${(page - 1) * 20}`);
      return { rows, hasMore: rows.length === 20 };
    }
    const rows = await this.db.$queryRaw<Array<{ id: string; label: string }>>(Prisma.sql`
      SELECT b.id, ${label} AS label, ${preview} AS preview
      FROM "case" b LEFT JOIN (SELECT b.id, b."contractNo", b.amount FROM contract b WHERE ${contractScope}) c ON c.id = b."contractId" ${customerJoin}
      WHERE ${await domain.scope('CASES', access)} AND ${label} ILIKE ${'%' + keyword + '%'}
      ORDER BY b.id LIMIT 20 OFFSET ${(page - 1) * 20}`);
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
        (a.access.selfOnly && parent.record.createdBy !== this.actor.userId) ||
        !a.fields.some((f) => lifecycleKey(f) === 'upstreamId') ||
        !a.fields.some((f) => lifecycleKey(f) === 'status')
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
        (deleting ||
          old?.caseId !== caseId ||
          (old?.status === 'REFUND_REQUIRED' && get('status') !== 'REFUND_REQUIRED')) &&
        (await tx.collabLifecycleLink.count({ where: { parentRecordId: previous.id } }))
      )
        fail('LIFECYCLE_HAS_CHILDREN', 409);
    }
    const duplicate = await tx.collabLifecycleLink.findFirst({
      where: { tableId: table.id, caseId, ...(previous ? { recordId: { not: previous.id } } : {}) },
    });
    if (duplicate) fail('LIFECYCLE_DUPLICATE_CASE', 409);
    if (table.lifecycleKind === 'CASE_REFUNDS') {
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
        !/^\d+(\.\d{1,2})?$/.test(amount) ||
        !new Prisma.Decimal(amount).greaterThan(0) ||
        new Prisma.Decimal(amount).greaterThan('9999999999999999.99')
      )
        fail('LIFECYCLE_INVALID_AMOUNT', 422);
    }
    return {
      tableId: table.id,
      caseId,
      parentRecordId,
      kind: table.lifecycleKind!,
      status: text(get('status')),
    };
  }
}
