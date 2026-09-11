import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applicationDataModelNames,
  applicationTableCounts,
  assertEmptyApplicationTables,
} from '../../scripts/db/assert-empty-application-tables';

test('treats migration-owned provisioning catalogs (permission/subscription/template/approval-definition) as system metadata', () => {
  assert.equal(applicationDataModelNames.includes('Permission'), false);
  assert.equal(applicationDataModelNames.includes('EventSubscription'), false);
  assert.equal(applicationDataModelNames.includes('ContractTemplate'), false);
  assert.equal(applicationDataModelNames.includes('ApprovalDefinition'), false);
  assert.equal(applicationDataModelNames.includes('Role'), true);
  assert.equal(applicationDataModelNames.includes('RolePermission'), true);
  assert.equal(applicationDataModelNames.includes('DataScope'), true);
});

test('counts every supplied Prisma model delegate', async () => {
  const client = {
    organization: { async count() { return 0; } },
    userRole: { async count() { return 0; } },
  };
  assert.deepEqual(await applicationTableCounts(client, ['Organization', 'UserRole']), [
    { model: 'Organization', count: 0 },
    { model: 'UserRole', count: 0 },
  ]);
});

test('rejects any application row and names the non-empty models', async () => {
  const client = {
    organization: { async count() { return 1; } },
    user: { async count() { return 2; } },
  };
  await assert.rejects(
    () => assertEmptyApplicationTables(client, ['Organization', 'User']),
    /Organization=1, User=2/,
  );
});
