import { PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuthorizationError, AUTHORIZATION_CODES } from '../../domain/authorization/authorization-errors';
import { CustomerService } from '../crm/customer-service';
import { AuditActor } from '../master-data/master-data-types';
import { assertExactKeys, normalizeName } from '../../domain/master-data/master-data-validation';
import { hashPhone, normalizePhone } from '../../domain/crm/lead-policy';
import { buildCustomerVisibilityWhere } from '../contract/contract-scope';

/** Request-local entitlement: never adds CRM navigation, update or other customers' access. */
export function caseCustomerContext(actor: AuthorizationContext): AuthorizationContext {
  if (!actor.permissionCodes.includes('case.create')) return actor;
  if (!actor.employeeId && !actor.isSystemSuperAdmin) return actor;
  return { ...actor,
    permissionCodes: [...new Set([...actor.permissionCodes, 'customer.read' as const])],
    grants: [...actor.grants, { sourceType: 'SPECIAL_GRANT', sourceId: 'case-intake:self',
      permissionCode: 'customer.read', resource: 'customer', scopeIds: ['worksheet:self'], validUntil: null }],
  };
}

export class CaseIntakeCustomerService {
  private readonly context: AuthorizationContext;
  private readonly auth: AuthorizationService;
  constructor(private readonly db: PrismaClient, private readonly actor: AuditActor, context: AuthorizationContext) {
    this.auth = new AuthorizationService(new DataScopeService(db));
    this.auth.requireAction(context, 'case.create');
    if (!context.employeeId && !context.isSystemSuperAdmin)
      throw new AuthorizationError(AUTHORIZATION_CODES.permission, 403);
    this.context = caseCustomerContext(context);
  }
  private reader() { return new CustomerService(this.db, this.actor, this.context); }
  async search(input: { worksheetId?: string; keyword?: string }) {
    assertExactKeys(input, ['worksheetId', 'keyword']);
    return this.reader().listCustomers({ page: 1, pageSize: 100, keyword: input.keyword });
  }
  async create(input: { worksheetId?: string; name: string; phone: string; address?: string; customerType?: 'INDIVIDUAL' | 'ENTERPRISE' }) {
    assertExactKeys(input, ['worksheetId', 'name', 'phone', 'address', 'customerType']);
    const name = normalizeName(input.name), phone = normalizePhone(input.phone), phoneHash = hashPhone(phone);
    const scope = await buildCustomerVisibilityWhere(this.db, this.auth, this.context, 'customer.read');
    const result = await this.db.$transaction(async tx => {
      // Serialize double-clicks/retries, without probing or exposing customers outside the read scope.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name + ':' + phoneHash}, 0))`;
      const existing = await tx.customer.findFirst({ where: { AND: [scope, { name, phoneHash, deletedAt: null }] }, orderBy: { createdAt: 'asc' } });
      if (existing) return { id: existing.id, reused: true };
      const writer = new CustomerService(this.db, this.actor, { ...this.context,
        permissionCodes: [...this.context.permissionCodes, 'customer.create'] });
      const customer = await writer.createCustomer({ name, phone, address: input.address,
        customerType: input.customerType, tags: JSON.stringify(['律师案件登记']) }, tx);
      const assignments = this.context.employeeId ? await tx.employeeAssignment.findMany({ where: {
        employeeId: this.context.employeeId, startedAt: { lte: this.context.evaluatedAt },
        OR: [{ endedAt: null }, { endedAt: { gt: this.context.evaluatedAt } }], organization: { status: 'ENABLED' },
      }, select: { organizationId: true } }) : [];
      await tx.operationLog.create({ data: { userId: this.actor.actorUserId, action: 'CASE_INTAKE_CUSTOMER_CREATE',
        targetType: 'CUSTOMER', targetId: customer.id, ip: this.actor.ip,
        newValues: JSON.stringify({ source: '律师案件登记', employeeId: this.context.employeeId,
          organizationIds: assignments.map(a => a.organizationId), worksheetId: input.worksheetId ?? null }) } });
      return { id: customer.id, reused: false };
    });
    return { customer: await this.reader().getCustomer(result.id), reused: result.reused };
  }
}
