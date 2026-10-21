/** Additive upgrade: no business records, permissions, or prior field values are removed. */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { businessFields } from '../../app/application/crm/workspace-business-table';
import {
  lifecycleFields,
  lifecycleKey,
  LifecycleWorksheet,
} from '../../app/application/collaboration/lifecycle-worksheet';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { object } from '../../app/application/collaboration/collaboration-policy';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { appendCollaborationChange } from '../../app/application/collaboration/collaboration-change';
import { randomUUID } from 'node:crypto';

export async function upgradeFinanceWorksheets(db: PrismaClient, apply = false) {
  const admin = await db.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const actor: AuthorizationContext = {
    userId: admin.id,
    employeeId: admin.employeeId,
    isSystemSuperAdmin: true,
    isSystemAdmin: false,
    evaluatedAt: new Date(),
    permissionCodes: PERMISSION_CATALOG.map((p) => p.code),
    grants: PERMISSION_CATALOG.map((p) => ({
      sourceType: 'ROLE',
      sourceId: 'maintenance',
      permissionCode: p.code,
      resource: p.resource,
      scopeIds: ['ALL'],
      validUntil: null as Date | null,
    })),
    fieldRules: [],
  };
  const svc = new CollaborationService(db, actor);
  const report: unknown[] = [];
  const invoiceBases = await db.collabTable.findMany({
    where: { source: 'INVOICES', archived: false },
    select: { baseId: true },
    distinct: ['baseId'],
  });
  for (const base of invoiceBases)
    if (
      !(await db.collabTable.count({ where: { baseId: base.baseId, source: 'PAYMENTS', archived: false } }))
    ) {
      report.push({ createReceiptTableIn: base.baseId });
      if (apply)
        await svc.createTable(base.baseId, { name: '财务收款明细表', source: 'PAYMENTS' }, randomUUID());
    }
  const tables = await db.collabTable.findMany({
    where: {
      archived: false,
      OR: [{ source: { in: ['CASES', 'PAYMENTS', 'REFUNDS'] } }, { lifecycleKind: 'CASE_REFUNDS' }],
    },
    include: { fields: true },
  });
  for (const table of tables) {
    const specs =
      table.lifecycleKind === 'CASE_REFUNDS' ? lifecycleFields('CASE_REFUNDS') : businessFields(table.source);
    const additions = specs.filter(
      (s) =>
        !table.fields.some((f) =>
          table.lifecycleKind
            ? lifecycleKey(f) === object(s.options).lifecycleKey
            : object(f.options).businessKey === object(s.options).businessKey,
        ),
    );
    report.push({ table: table.id, addFields: additions.map((f) => f.name) });
    if (!apply || !additions.length) continue;
    await db.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const spec of additions)
        ids.push(
          (
            await tx.collabField.create({
              data: { ...spec, position: table.fields.length + ids.length, tableId: table.id },
            })
          ).id,
        );
      for (const view of await tx.collabView.findMany({
        where: { tableId: table.id, shared: true, isDefault: true },
      })) {
        const config = object(view.config);
        if (Array.isArray(config.visibleFields))
          await tx.collabView.update({
            where: { id: view.id },
            data: {
              config: {
                ...config,
                visibleFields: [...config.visibleFields, ...ids],
              } as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
          });
      }
      await tx.collabTable.update({ where: { id: table.id }, data: { schemaVersion: { increment: 1 } } });
      await appendCollaborationChange(tx, admin.id, table.baseId, 'table.updated', table.id);
    });
  }
  // Old applications may have been manually submitted to finance. Link only a unique exact match.
  const links = await db.collabLifecycleLink.findMany({
    where: { kind: 'CASE_REFUNDS', record: { archived: false, financialRefund: null } },
    include: { case: true, record: { include: { table: { include: { fields: true } } } } },
  });
  for (const link of links) {
    const fields = link.record.table.fields;
    const values = object(link.record.values);
    const get = (k: string) => values[fields.find((f) => lifecycleKey(f) === k)?.id ?? ''];
    if (!link.case.contractId) {
      report.push({ record: link.recordId, skipped: 'missing contract' });
      continue;
    }
    const peers = await db.collabLifecycleLink.count({
      where: {
        kind: 'CASE_REFUNDS',
        case: { contractId: link.case.contractId },
        record: { archived: false },
      },
    });
    const candidates = await db.refundRequest.findMany({
      where: {
        contractId: link.case.contractId,
        type: 'REFUND',
        sourceRecordId: null,
        amount: new Prisma.Decimal(String(get('amount'))),
        status: { not: 'REJECTED' },
      },
    });
    if (peers !== 1 || candidates.length > 1) {
      report.push({ record: link.recordId, skipped: 'ambiguous financial application' });
      continue;
    }
    report.push({ record: link.recordId, financial: candidates[0]?.id ?? 'create application' });
    if (!apply) continue;
    await db.$transaction(async (tx) => {
      if (candidates.length) {
        const old = candidates[0];
        await tx.refundRequest.update({
          where: { id: old.id },
          data: {
            sourceRecordId: link.recordId,
            recipientName: String(get('recipientName') ?? ''),
            recipientBank: String(get('recipientBank') ?? ''),
            recipientAccount: String(get('recipientAccount') ?? ''),
            ...(old.status === 'EXECUTED' ? { actualAmount: old.amount, paidAt: old.executedAt } : {}),
          },
        });
        await tx.operationLog.create({
          data: {
            userId: admin.id,
            action: 'REFUND_APPLICATION_LINK',
            targetType: 'REFUND_REQUEST',
            targetId: old.id,
            newValues: JSON.stringify({ sourceRecordId: link.recordId }),
          },
        });
      } else
        await new LifecycleWorksheet(db, actor, async () => {
          throw Error('not used');
        }).syncFinancialApplication(tx, link.record.table, link.record, fields, link.caseId);
    });
  }
  return report;
}
if (require.main === module) {
  const db = new PrismaClient();
  upgradeFinanceWorksheets(db, process.argv.includes('--apply'))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
