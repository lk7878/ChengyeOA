import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { sanitizeChange, writeMasterDataAudit } from '../../app/application/master-data/master-data-audit';

test('sanitizes audit changes to stable identifiers and state only', () => {
  assert.deepEqual(
    sanitizeChange({ name: 'Alice', phone: '13800000000', status: 'FORMAL', version: 2 }),
    { status: 'FORMAL', version: 2 },
  );
  assert.deepEqual(
    sanitizeChange({ employeeId: 'employee-1', organizationId: 'org-1', token: 'secret' }),
    { employeeId: 'employee-1', organizationId: 'org-1' },
  );
});

test('writes sanitized changes through the supplied transaction client', async () => {
  const writes: unknown[] = [];
  const tx = {
    operationLog: {
      create: async (input: unknown) => {
        writes.push(input);
        return input;
      },
    },
  } as unknown as Prisma.TransactionClient;

  await writeMasterDataAudit(tx, {
    actorUserId: 'user-1',
    ip: '127.0.0.1',
    action: 'UPDATE',
    targetType: 'EMPLOYEE',
    targetId: 'employee-1',
    before: { name: 'Old Name', status: 'PROBATION', phone: '13800000000', version: 1 },
    after: { name: 'New Name', status: 'FORMAL', idCard: 'secret', version: 2 },
  });

  assert.deepEqual(writes, [{
    data: {
      userId: 'user-1',
      action: 'UPDATE',
      targetType: 'EMPLOYEE',
      targetId: 'employee-1',
      oldValues: JSON.stringify({ status: 'PROBATION', version: 1 }),
      newValues: JSON.stringify({ status: 'FORMAL', version: 2 }),
      ip: '127.0.0.1',
    },
  }]);
});
