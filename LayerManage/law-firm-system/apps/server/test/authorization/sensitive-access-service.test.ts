import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { SensitiveAccessService } from '../../app/application/authorization/sensitive-access-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

let prisma: PrismaClient;
let employeeId: string;
let service: SensitiveAccessService;

test.before(() => { prisma = createTestPrisma(); });
test.beforeEach(async () => {
  await dropAuditTrigger();
  await clearTestApplicationData(prisma);
  employeeId = randomUUID();
  await prisma.employee.create({ data: {
    id: employeeId,
    employeeNo: `EMP_${employeeId}`,
    name: 'Sensitive Employee',
    phone: '13800000000',
    idCard: '500000199001010000',
    type: 'LAWYER',
    status: 'FORMAL',
    entryDate: new Date('2025-01-01'),
  } });
  service = new SensitiveAccessService(prisma);
});
test.after(async () => {
  await dropAuditTrigger();
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
});

function accessContext(scopeId = 'ALL'): AuthorizationContext {
  return {
    userId: 'auditor-user',
    employeeId: null,
    isSystemAdmin: false,
    isSystemSuperAdmin: false,
    grants: [{
      sourceType: 'SPECIAL_GRANT',
      sourceId: 'special-grant',
      permissionCode: 'employee.high_sensitive.read',
      resource: 'employee',
      scopeIds: [scopeId],
      validUntil: new Date('2026-07-19T00:00:00.000Z'),
    }],
    fieldRules: [],
    permissionCodes: ['employee.high_sensitive.read'],
    evaluatedAt: new Date('2026-07-18T12:00:00.000Z'),
  };
}

test('rejects invalid purpose unauthorized fields actions and records', async () => {
  await assert.rejects(
    () => service.viewEmployeeFields({ context: accessContext(), employeeId, fieldCodes: ['employee.idCard'], purpose: 'short' }),
    hasCode('ACCESS_PURPOSE_REQUIRED'),
  );
  await assert.rejects(
    () => service.viewEmployeeFields({ context: accessContext(), employeeId, fieldCodes: ['employee.idCard'], purpose: 'x'.repeat(201) }),
    hasCode('ACCESS_PURPOSE_REQUIRED'),
  );
  await assert.rejects(
    () => service.viewEmployeeFields({
      context: accessContext(), employeeId, fieldCodes: ['employee.phone' as 'employee.idCard'], purpose: 'Verify employee identity',
    }),
    hasCode('FIELD_PERMISSION_DENIED'),
  );
  await assert.rejects(
    () => service.viewEmployeeFields({
      context: { ...accessContext(), grants: [], permissionCodes: [] },
      employeeId, fieldCodes: ['employee.idCard'], purpose: 'Verify employee identity',
    }),
    hasCode('SPECIAL_PERMISSION_REQUIRED'),
  );
  await assert.rejects(
    () => service.viewEmployeeFields({
      context: { ...accessContext(), grants: [{ ...accessContext().grants[0], scopeIds: [] }] },
      employeeId, fieldCodes: ['employee.idCard'], purpose: 'Verify employee identity',
    }),
    hasCode('RESOURCE_NOT_FOUND_OR_FORBIDDEN'),
  );
});

test('returns L4 values only after a sanitized audit succeeds', async () => {
  const values = await service.viewEmployeeFields({
    context: accessContext(),
    employeeId,
    fieldCodes: ['employee.idCard'],
    purpose: 'Verify employee identity for filing',
    ip: '127.0.0.1',
  });
  assert.deepEqual(values, { 'employee.idCard': '500000199001010000' });
  const audit = await prisma.operationLog.findFirstOrThrow({ where: { targetType: 'SENSITIVE_FIELD_ACCESS' } });
  assert.match(audit.newValues ?? '', /employee\.idCard/);
  assert.doesNotMatch(audit.newValues ?? '', /500000199001010000/);
  assert.equal(audit.ip, '127.0.0.1');
});

test('returns no L4 value when the audit transaction fails', async () => {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_sensitive_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_sensitive_audit_trigger BEFORE INSERT ON "operation_log" FOR EACH ROW EXECUTE FUNCTION fail_sensitive_audit()`);
  await assert.rejects(() => service.viewEmployeeFields({
    context: accessContext(),
    employeeId,
    fieldCodes: ['employee.idCard'],
    purpose: 'Verify employee identity for filing',
  }));
});

function hasCode(code: string) {
  return (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

async function dropAuditTrigger() {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_sensitive_audit_trigger ON "operation_log"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_sensitive_audit()');
}
