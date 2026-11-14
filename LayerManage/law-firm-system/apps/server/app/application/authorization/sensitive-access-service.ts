import { PrismaClient } from '@prisma/client';
import { AuthorizationError, AUTHORIZATION_CODES } from '../../domain/authorization/authorization-errors';
import { parseAccessPurpose } from '../../domain/authorization/authorization-validation';
import { writeAuthorizationAudit } from './authorization-audit';
import { AuthorizationContext, AuthorizationService } from './authorization-service';
import { DataScopeService } from './data-scope-service';

const EMPLOYEE_L4_FIELDS = new Set(['employee.idCard']);

export interface ViewEmployeeFieldsInput {
  context: AuthorizationContext;
  employeeId: string;
  fieldCodes: Array<'employee.idCard'>;
  purpose: string;
  ip?: string;
}

export class SensitiveAccessService {
  private readonly authorization = new AuthorizationService();
  private readonly dataScopes: DataScopeService;

  constructor(private readonly prisma: PrismaClient) {
    this.dataScopes = new DataScopeService(prisma);
  }

  async viewEmployeeFields(input: ViewEmployeeFieldsInput): Promise<Record<string, string | null>> {
    const purpose = parseAccessPurpose(input.purpose);
    const fieldCodes = [...new Set(input.fieldCodes)];
    if (fieldCodes.length === 0 || fieldCodes.some(code => !EMPLOYEE_L4_FIELDS.has(code))) {
      throw new AuthorizationError(AUTHORIZATION_CODES.field, 403);
    }
    this.authorization.requireAction(input.context, 'employee.high_sensitive.read');
    const scopeWhere = await this.dataScopes.buildScopeWhere(
      input.context,
      'employee',
      'employee.high_sensitive.read',
    );

    return this.prisma.$transaction(async tx => {
      const employee = await tx.employee.findFirst({
        where: { AND: [scopeWhere, { id: input.employeeId }] },
        select: { id: true, idCard: true },
      });
      if (!employee) throw new AuthorizationError(AUTHORIZATION_CODES.hidden, 404);
      await writeAuthorizationAudit(tx, {
        actorUserId: input.context.userId,
        action: 'VIEW_HIGH_SENSITIVE_FIELDS',
        targetType: 'SENSITIVE_FIELD_ACCESS',
        targetId: employee.id,
        changes: { fieldCodes, purpose, resultCount: fieldCodes.length },
        ip: input.ip,
      });
      return Object.fromEntries(fieldCodes.map(code => [code, employee.idCard]));
    });
  }
}
