import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildFinancialRecordScopeWhere } from './financial-record-scope';
import { sweepBackReceived } from '../contract/receivable-service';
import { notifyDeliveryChange } from '../collaboration/delivery-change';
import { fail } from '../collaboration/collaboration-policy';

export const paymentWorksheetKeys = [
  'amount',
  'paidAt',
  'method',
  'account',
  'remark',
  'voucherFiles',
];
export const refundExecutionKeys = ['actualAmount', 'paidAt', 'voucherFiles'];
export function financeMoney(raw: unknown) {
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(String(raw))) fail('COLLAB_INVALID_VALUE', 422);
  const value = new Prisma.Decimal(String(raw));
  if (!value.greaterThan(0) || value.greaterThan('9999999999999999.99')) fail('COLLAB_INVALID_VALUE', 422);
  return value;
}

/** Canonical finance writes; table permissions are checked by the caller, domain scopes here. */
export class WorksheetFinance {
  constructor(
    private db: PrismaClient,
    private actor: AuthorizationContext,
  ) {}
  async payment(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    patch: Record<string, unknown>,
    mode: 'edit' | 'delete' | 'restore',
  ) {
    const permission = mode === 'edit' ? 'payment.confirm' : 'payment.void';
    if (!this.actor.permissionCodes.includes(permission)) fail('COLLAB_FORBIDDEN', 403);
    const scope = await buildFinancialRecordScopeWhere(
      this.db,
      new AuthorizationService(new DataScopeService(this.db)),
      this.actor,
      permission,
      'payment',
    );
    const probe = await tx.payment.findFirst({
      where: { id, AND: [scope, { contract: { deletedAt: null } }] },
    });
    if (!probe) fail('COLLAB_NOT_FOUND', 404);
    await tx.$queryRaw`SELECT id FROM contract WHERE id=${probe.contractId} FOR UPDATE`;
    const row = await tx.payment.findUniqueOrThrow({ where: { id } });
    if (row.version !== version || Boolean(row.deletedAt) !== (mode === 'restore'))
      fail('COLLAB_RECORD_CONFLICT', 409);
    if (!['PENDING', 'CONFIRMED'].includes(row.status)) fail('COLLAB_USE_BUSINESS_ACTION', 409);
    // Never erase or change money already referenced by a refund, even a pending approval.
    if (
      await tx.refundRequest.count({
        where: {
          OR: [{ paymentId: id }, { allocations: { some: { paymentId: id } } }],
          status: { not: 'REJECTED' },
        },
      })
    )
      fail('FINANCE_RECEIPT_HAS_REFUND', 409);
    const data: Prisma.PaymentUpdateInput = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!paymentWorksheetKeys.includes(key)) fail('COLLAB_READONLY_FIELD', 403);
      if (key === 'amount') data.amount = financeMoney(value);
      else if (key === 'paidAt') {
        const date = new Date(String(value));
        if (!value || !Number.isFinite(date.getTime())) fail('COLLAB_INVALID_VALUE', 422);
        data.paidAt = date;
      } else if (key === 'voucherFiles') data.voucherFiles = value as Prisma.InputJsonValue;
      else (data as Record<string, unknown>)[key] = value == null ? null : String(value).slice(0, 1000);
    }
    const nextAmount = patch.amount === undefined ? row.amount : financeMoney(patch.amount);
    if (row.status === 'CONFIRMED') {
      const delta =
        mode === 'delete'
          ? row.amount.negated()
          : mode === 'restore'
            ? row.amount
            : nextAmount.minus(row.amount);
      if (delta.isNegative()) await sweepBackReceived(tx, row.contractId, delta.abs(), this.actor.userId);
      if (delta.greaterThan(0))
        await addReceived(tx, row.contractId, row.paymentPlanId, delta, this.actor.userId);
    }
    const saved = await tx.payment.update({
      where: { id },
      data: {
        ...data,
        deletedAt: mode === 'delete' ? new Date() : null,
        updatedBy: this.actor.userId,
        version: { increment: 1 },
      },
    });
    await tx.operationLog.create({
      data: {
        userId: this.actor.userId,
        action: 'PAYMENT_WORKSHEET_' + mode.toUpperCase(),
        targetType: 'PAYMENT',
        targetId: id,
        oldValues: JSON.stringify({ amount: row.amount.toFixed(2), deleted: !!row.deletedAt }),
        newValues: JSON.stringify({
          amount: saved.amount.toFixed(2),
          deleted: !!saved.deletedAt,
          fields: Object.keys(patch),
        }),
      },
    });
    await notifyDeliveryChange(tx, this.actor.userId, id);
    return saved;
  }
  async refund(tx: Prisma.TransactionClient, id: string, version: number, patch: Record<string, unknown>) {
    if (!this.actor.permissionCodes.includes('refund.execute')) fail('COLLAB_FORBIDDEN', 403);
    const scope = await buildFinancialRecordScopeWhere(
      this.db,
      new AuthorizationService(new DataScopeService(this.db)),
      this.actor,
      'refund.execute',
      'refund',
    );
    const row = await tx.refundRequest.findFirst({
      where: { id, AND: [scope, { contract: { deletedAt: null } }] },
    });
    if (!row) fail('COLLAB_NOT_FOUND', 404);
    if (row.type !== 'REFUND') fail('COLLAB_USE_BUSINESS_ACTION',409);
    await tx.$queryRaw`SELECT id FROM contract WHERE id=${row.contractId} FOR UPDATE`;
    const data: Prisma.RefundRequestUpdateManyMutationInput = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!refundExecutionKeys.includes(key)) fail('COLLAB_READONLY_FIELD', 403);
      if (key === 'actualAmount') {
        if(value===null) { data.actualAmount=null; continue; }
        const amount = financeMoney(value);
        if (amount.greaterThan(row.amount)) fail('REFUND_AMOUNT_EXCEEDED', 422);
        data.actualAmount = amount;
      } else if (key === 'paidAt') {
        if(value===null) { data.paidAt=null; continue; }
        const date = new Date(String(value));
        if (!value || !Number.isFinite(date.getTime())) fail('COLLAB_INVALID_VALUE', 422);
        data.paidAt = date;
      } else data.voucherFiles = value as Prisma.InputJsonValue;
    }
    const changed = await tx.refundRequest.updateMany({
      where: { id, version, status: 'APPROVED' },
      data: { ...data, updatedBy: this.actor.userId, version: { increment: 1 } },
    });
    if (!changed.count) fail('REFUND_STATE_INVALID', 409);
    await tx.operationLog.create({
      data: {
        userId: this.actor.userId,
        action: 'REFUND_EXECUTION_DETAILS',
        targetType: 'REFUND_REQUEST',
        targetId: id,
        newValues: JSON.stringify({ fields: Object.keys(patch) }),
      },
    });
    await notifyDeliveryChange(tx, this.actor.userId, id);
    return { id, version: version + 1 };
  }
}

/** Caller holds the contract lock, same allocation order as normal payment confirmation. */
async function addReceived(
  tx: Prisma.TransactionClient,
  contractId: string,
  planId: string | null,
  amount: Prisma.Decimal,
  actor: string,
) {
  const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  if (
    !['SIGNED', 'EFFECTIVE'].includes(contract.status) ||
    contract.receivedAmount.plus(amount).greaterThan(contract.amount)
  )
    fail('PAYMENT_AMOUNT_EXCEEDED', 409);
  const plans = await tx.paymentPlan.findMany({
    where: { contractId, ...(planId ? { id: planId } : { status: { in: ['PENDING', 'PARTIAL'] } }) },
    orderBy: [{ dueDate: 'asc' }, { period: 'asc' }],
  });
  let remaining = amount;
  for (const plan of plans) {
    if (plan.status === 'CANCELLED') continue;
    const applied = Prisma.Decimal.min(remaining, plan.amount.minus(plan.receivedAmount));
    if (!applied.greaterThan(0)) continue;
    const received = plan.receivedAmount.plus(applied);
    await tx.paymentPlan.update({
      where: { id: plan.id },
      data: {
        receivedAmount: received,
        status: received.equals(plan.amount) ? 'RECEIVED' : 'PARTIAL',
        version: { increment: 1 },
      },
    });
    remaining = remaining.minus(applied);
  }
  if ((plans.length || planId) && remaining.greaterThan(0)) fail('PAYMENT_AMOUNT_EXCEEDED', 409);
  await tx.contract.update({
    where: { id: contractId },
    data: { receivedAmount: { increment: amount }, version: { increment: 1 }, updatedBy: actor },
  });
}
