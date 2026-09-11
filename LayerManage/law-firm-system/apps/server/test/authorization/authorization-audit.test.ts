import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import {
  sanitizeAuthorizationChanges,
  writeAuthorizationAudit,
} from '../../app/application/authorization/authorization-audit';

test('sanitizes authorization audit changes to an explicit metadata allowlist', () => {
  assert.deepEqual(sanitizeAuthorizationChanges({
    roleId: 'role-1',
    permissionCodes: ['organization.read'],
    status: 'ENABLED',
    version: 2,
    validUntil: new Date('2026-08-01T00:00:00.000Z'),
    scopeType: 'BRANCH',
    fieldCodes: ['employee.phone'],
    targetCount: 3,
    reason: '分所负责人临时授权原因',
    purpose: '核验员工执业身份信息',
    name: '不应记录的姓名',
    phone: '13800001234',
    idCard: '500000199001010000',
    password: 'secret',
    token: 'secret-token',
    businessValues: { confidential: true },
  }), {
    roleId: 'role-1',
    permissionCodes: ['organization.read'],
    status: 'ENABLED',
    version: 2,
    validUntil: '2026-08-01T00:00:00.000Z',
    scopeType: 'BRANCH',
    fieldCodes: ['employee.phone'],
    targetCount: 3,
    reason: '分所负责人临时授权原因',
    purpose: '核验员工执业身份信息',
  });
});

test('writes only sanitized authorization metadata through the transaction', async () => {
  const writes: unknown[] = [];
  const tx = {
    operationLog: {
      create: async (input: unknown) => {
        writes.push(input);
        return input;
      },
    },
  } as unknown as Prisma.TransactionClient;

  await writeAuthorizationAudit(tx, {
    actorUserId: 'user-1',
    action: 'ROLE_PERMISSION_REPLACED',
    targetType: 'ROLE',
    targetId: 'role-1',
    changes: { permissionCodes: ['organization.read'], phone: '13800001234' },
    ip: '127.0.0.1',
  });

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    data: {
      userId: 'user-1',
      action: 'ROLE_PERMISSION_REPLACED',
      targetType: 'ROLE',
      targetId: 'role-1',
      oldValues: null,
      newValues: JSON.stringify({ permissionCodes: ['organization.read'] }),
      ip: '127.0.0.1',
    },
  });
});
