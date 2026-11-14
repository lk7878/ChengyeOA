import { PrismaClient, Prisma } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { FieldProjectionService } from '../authorization/field-projection-service';
import { buildContractScopeWhere, buildCustomerVisibilityWhere } from '../contract/contract-scope';
import { maskLeadPhone } from '../crm/lead-projection';
import { auditRawL3Access } from '../crm/lead-audit';
import type { CaseView } from './case-types';

export const CONTRACT_INTAKE_KEYS = ['contractNumber', 'signedDate', 'region', 'customerPhone'] as const;
/** Resolve linked fields from authorized upstream records; never expose a stale raw phone copy. */
export async function projectLinkedIntake(
  db: PrismaClient,
  actor: AuthorizationContext,
  rows: CaseView[],
  reader: Prisma.TransactionClient = db,
) {
  if (!rows.length) return rows;
  const authorization = new AuthorizationService(new DataScopeService(db));
  const customers = actor.permissionCodes.includes('customer.read')
    ? await reader.customer.findMany({
        where: {
          AND: [
            { id: { in: rows.filter((r) => r.contractId).map((r) => r.customerId) }, deletedAt: null },
            await buildCustomerVisibilityWhere(db, authorization, actor, 'customer.read'),
          ],
        },
        select: { id: true, address: true, phone: true },
      })
    : [];
  const contracts = actor.permissionCodes.includes('contract.read')
    ? await reader.contract.findMany({
        where: {
          AND: [
            { id: { in: rows.flatMap((r) => (r.contractId ? [r.contractId] : [])) }, deletedAt: null },
            await buildContractScopeWhere(db, authorization, actor, 'contract.read'),
          ],
        },
        select: { id: true, contractNo: true, signDate: true },
      })
    : [];
  const phoneLevel = actor.permissionCodes.includes('customer.read')
    ? new FieldProjectionService().fieldCapability(actor, 'customer', 'customer.phone', 'customer.read')
        .readLevel
    : 'NONE';
  const result = rows.map((row) => {
    const intakeData = { ...row.intakeData };
    if (row.contractId) {
      const customer = customers.find((c) => c.id === row.customerId);
      const contract = contracts.find((c) => c.id === row.contractId);
      for (const key of CONTRACT_INTAKE_KEYS) delete intakeData[key];
      if (customer?.address) intakeData.region = customer.address;
      if (customer?.phone) intakeData.customerPhone = customer.phone;
      if (contract) intakeData.contractNumber = contract.contractNo;
      if (contract?.signDate) intakeData.signedDate = contract.signDate.toISOString();
    }
    if (phoneLevel === 'NONE') delete intakeData.customerPhone;
    else if (phoneLevel !== 'READ' && intakeData.customerPhone)
      intakeData.customerPhone = maskLeadPhone(intakeData.customerPhone);
    return { ...row, intakeData };
  });
  if (result.some((r) => r.intakeData.customerPhone))
    await auditRawL3Access(
      db,
      { actorUserId: actor.userId },
      'CUSTOMER',
      'LIST',
      'customer',
      { phone: phoneLevel, wechat: 'NONE' },
      rows.length,
      'cases.intake',
      reader,
    );
  return result;
}
