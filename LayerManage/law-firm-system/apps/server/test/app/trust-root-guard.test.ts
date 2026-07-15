import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { SystemBootstrapService } from '../../app/application/system/system-bootstrap-service';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
const jwtSecret = '01234567890123456789012345678901';
const hasher = new BcryptPasswordHasher(4);
let prisma: PrismaClient;
let bearer: string;
let rootOrganizationId: string;
let superAdminUserId: string;
let superAdminRoleId: string;

async function createLinkedEmployee(userId?: string): Promise<{ employeeId: string; userId: string }> {
  const position = await prisma.position.create({
    data: {
      name: `Test position ${randomUUID()}`,
      orgId: rootOrganizationId,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      employeeNo: `EMP-${randomUUID()}`,
      name: 'Linked employee',
      phone: '13800000000',
      type: 'ADMIN',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
      orgId: rootOrganizationId,
      positionId: position.id,
    },
  });
  const linkedUser = userId
    ? await prisma.user.update({ where: { id: userId }, data: { employeeId: employee.id } })
    : await prisma.user.create({
      data: {
        username: `employee.${randomUUID()}`,
        password: 'sensitive-test-hash',
        status: 'ENABLED',
        employeeId: employee.id,
      },
    });
  return { employeeId: employee.id, userId: linkedUser.id };
}

async function installInsertDelayTrigger(table: 'user' | 'role'): Promise<void> {
  const functionName = `delay_${table}_insert_for_test`;
  const triggerName = `${functionName}_trigger`;
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_sleep(0.25);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${triggerName}
    BEFORE INSERT ON "${table}"
    FOR EACH ROW EXECUTE FUNCTION ${functionName}()
  `);
}

async function dropInsertDelayTrigger(table: 'user' | 'role'): Promise<void> {
  const functionName = `delay_${table}_insert_for_test`;
  const triggerName = `${functionName}_trigger`;
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "${table}"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
}

async function bootstrapAuthenticatedTrustRoot(): Promise<void> {
  await new SystemBootstrapService(
    prisma,
    hasher,
    { databaseName: 'chengye_oa_test', hostname: 'localhost' },
  ).execute({
    organizationName: 'Chengye Test Firm',
    username: 'root.admin',
    password: 'Correct-Horse-92',
  });

  const initialization = await prisma.systemInitialization.findUniqueOrThrow({ where: { id: 'PRIMARY' } });
  const user = await prisma.user.update({
    where: { id: initialization.superAdminUserId },
    data: { mustChangePassword: false },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SYSTEM_SUPER_ADMIN' } });
  rootOrganizationId = initialization.rootOrganizationId;
  superAdminUserId = initialization.superAdminUserId;
  superAdminRoleId = role.id;
  bearer = `Bearer ${new JwtTokenService(jwtSecret).signAccess(user.id, user.credentialVersion)}`;
}

function assertTrustRootProtected(response: { body: Record<string, unknown> }): void {
  assert.equal(response.body.code, 409);
  assert.equal(response.body.message, 'TRUST_ROOT_PROTECTED');
}

function assertNoPasswordProperty(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.prototype.hasOwnProperty.call(value, 'password'), false);
  for (const nested of Object.values(value)) {
    assertNoPasswordProperty(nested);
  }
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await dropInsertDelayTrigger('user');
  await dropInsertDelayTrigger('role');
  await clearTestApplicationData(prisma);
  await bootstrapAuthenticatedTrustRoot();
});

test.after(async () => {
  await dropInsertDelayTrigger('user');
  await dropInsertDelayTrigger('role');
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('cannot disable the current first super-admin', async () => {
  const response = await app.httpRequest()
    .put(`/api/v1/users/${superAdminUserId}`)
    .set('Authorization', bearer)
    .send({ status: 'DISABLED' })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: superAdminUserId } })).status, 'ENABLED');
});

test('cannot update other mutable state on the current first super-admin', async () => {
  const response = await app.httpRequest()
    .put(`/api/v1/users/${superAdminUserId}`)
    .set('Authorization', bearer)
    .send({ employeeId: null })
    .expect(409);

  assertTrustRootProtected(response);
});

test('cannot delete the current first super-admin', async () => {
  const response = await app.httpRequest()
    .delete(`/api/v1/users/${superAdminUserId}`)
    .set('Authorization', bearer)
    .expect(409);

  assertTrustRootProtected(response);
  assert.ok(await prisma.user.findUnique({ where: { id: superAdminUserId } }));
});

test('cannot replace roles of the current first super-admin', async () => {
  const response = await app.httpRequest()
    .post(`/api/v1/users/${superAdminUserId}/roles`)
    .set('Authorization', bearer)
    .send({ roleIds: [] })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal(await prisma.userRole.count({ where: { userId: superAdminUserId, roleId: superAdminRoleId } }), 1);
});

for (const mutation of [
  { name: 'rename', body: { name: 'Changed system role' } },
  { name: 'disable', body: { status: 'DISABLED' } },
  { name: 'update', body: { description: 'Changed description' } },
]) {
  test(`cannot ${mutation.name} the SYSTEM_SUPER_ADMIN role`, async () => {
    const before = await prisma.role.findUniqueOrThrow({ where: { id: superAdminRoleId } });
    const response = await app.httpRequest()
      .put(`/api/v1/roles/${superAdminRoleId}`)
      .set('Authorization', bearer)
      .send(mutation.body)
      .expect(409);

    assertTrustRootProtected(response);
    assert.deepEqual(await prisma.role.findUniqueOrThrow({ where: { id: superAdminRoleId } }), before);
  });
}

test('cannot delete the SYSTEM_SUPER_ADMIN role', async () => {
  const response = await app.httpRequest()
    .delete(`/api/v1/roles/${superAdminRoleId}`)
    .set('Authorization', bearer)
    .expect(409);

  assertTrustRootProtected(response);
  assert.ok(await prisma.role.findUnique({ where: { id: superAdminRoleId } }));
});

test('cannot replace permissions of the SYSTEM_SUPER_ADMIN role', async () => {
  const permission = await prisma.permission.create({
    data: { code: 'SYSTEM_TEST', name: 'System test', type: 'API' },
  });
  const response = await app.httpRequest()
    .post(`/api/v1/roles/${superAdminRoleId}/permissions`)
    .set('Authorization', bearer)
    .send({ permissionIds: [permission.id] })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal(await prisma.rolePermission.count({ where: { roleId: superAdminRoleId } }), 0);
});

test('cannot recreate the protected role through role creation', async () => {
  const response = await app.httpRequest()
    .post('/api/v1/roles')
    .set('Authorization', bearer)
    .send({ name: 'Another system super admin', code: ' system_super_admin ', type: 'BUSINESS' })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal(await prisma.role.count({ where: { code: 'SYSTEM_SUPER_ADMIN' } }), 1);
});

test('cannot assign SYSTEM_SUPER_ADMIN through the mutable user-role endpoint', async () => {
  const user = await prisma.user.create({
    data: { username: 'business.user', password: 'not-used-by-this-test', mustChangePassword: true },
  });
  const response = await app.httpRequest()
    .post(`/api/v1/users/${user.id}/roles`)
    .set('Authorization', bearer)
    .send({ roleIds: [superAdminRoleId] })
    .expect(409);

  assertTrustRootProtected(response);
  assert.equal(await prisma.userRole.count({ where: { userId: user.id } }), 0);
});

test('cannot delete the current root organization but can update its name', async () => {
  const deleteResponse = await app.httpRequest()
    .delete(`/api/v1/organizations/${rootOrganizationId}`)
    .set('Authorization', bearer)
    .expect(409);
  assertTrustRootProtected(deleteResponse);

  const updateResponse = await app.httpRequest()
    .put(`/api/v1/organizations/${rootOrganizationId}`)
    .set('Authorization', bearer)
    .send({ name: 'Renamed Test Firm' })
    .expect(200);
  assert.equal(updateResponse.body.data.name, 'Renamed Test Firm');
});

test('user endpoints use safe projections and creation applies shared credential policy', async () => {
  const role = await prisma.role.create({
    data: { name: 'Business lawyer', code: 'BUSINESS_LAWYER', type: 'BUSINESS' },
  });
  const created = await app.httpRequest()
    .post('/api/v1/users')
    .set('Authorization', bearer)
    .send({ username: '  Business.Admin  ', password: 'Business-Horse-94!', status: 'ENABLED' })
    .expect(200);

  assert.equal(created.body.data.username, 'business.admin');
  assert.equal(created.body.data.mustChangePassword, true);
  const userId = created.body.data.id as string;
  const responses = [
    created,
    await app.httpRequest().get('/api/v1/users').set('Authorization', bearer).expect(200),
    await app.httpRequest().get(`/api/v1/users/${userId}`).set('Authorization', bearer).expect(200),
    await app.httpRequest().put(`/api/v1/users/${userId}`).set('Authorization', bearer).send({ status: 'DISABLED' }).expect(200),
    await app.httpRequest().post(`/api/v1/users/${userId}/roles`).set('Authorization', bearer).send({ roleIds: [role.id] }).expect(200),
    await app.httpRequest().get(`/api/v1/roles/${role.id}`).set('Authorization', bearer).expect(200),
  ];
  for (const response of responses) {
    assertNoPasswordProperty(response.body);
  }

  const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.match(stored.password, /^chengye\$bcrypt-sha256\$v1\$\$2[aby]\$12\$/);
  assert.equal(await new BcryptPasswordHasher().compare('Business-Horse-94!', stored.password), true);
  assert.equal(stored.mustChangePassword, true);
});

test('user creation rejects invalid usernames and weak passwords through shared validation', async () => {
  const invalidUsername = await app.httpRequest()
    .post('/api/v1/users')
    .set('Authorization', bearer)
    .send({ username: 'NO SPACES', password: 'Business-Horse-94!' })
    .expect(400);
  assert.equal(invalidUsername.body.message, 'USERNAME_INVALID');

  const weakPassword = await app.httpRequest()
    .post('/api/v1/users')
    .set('Authorization', bearer)
    .send({ username: 'business.admin', password: 'password123' })
    .expect(400);
  assert.equal(weakPassword.body.message, 'PASSWORD_INVALID');
  assert.equal(await prisma.user.count({ where: { username: 'business.admin' } }), 0);
});

test('business roles require normalized immutable codes and remain mutable otherwise', async () => {
  const created = await app.httpRequest()
    .post('/api/v1/roles')
    .set('Authorization', bearer)
    .send({ name: 'Business lawyer', code: ' business_lawyer ', type: 'SYSTEM' })
    .expect(200);
  assert.equal(created.body.data.code, 'BUSINESS_LAWYER');
  assert.equal(created.body.data.type, 'BUSINESS');

  const roleId = created.body.data.id as string;
  const updated = await app.httpRequest()
    .put(`/api/v1/roles/${roleId}`)
    .set('Authorization', bearer)
    .send({ name: 'Senior business lawyer', code: 'CHANGED_CODE', status: 'DISABLED' })
    .expect(200);
  assert.equal(updated.body.data.name, 'Senior business lawyer');
  assert.equal(updated.body.data.status, 'DISABLED');
  assert.equal(updated.body.data.code, 'BUSINESS_LAWYER');

  const invalid = await app.httpRequest()
    .post('/api/v1/roles')
    .set('Authorization', bearer)
    .send({ name: 'Invalid role', code: 'bad-code' })
    .expect(400);
  assert.equal(invalid.body.message, 'ROLE_CODE_INVALID');
});

test('employee list and detail safely project a linked user without losing useful fields', async () => {
  const linked = await createLinkedEmployee();
  const role = await prisma.role.create({
    data: { name: 'Employee role', code: 'EMPLOYEE_ROLE', type: 'BUSINESS' },
  });
  await prisma.userRole.create({ data: { userId: linked.userId, roleId: role.id } });

  const list = await app.httpRequest()
    .get('/api/v1/employees')
    .set('Authorization', bearer)
    .expect(200);
  const detail = await app.httpRequest()
    .get(`/api/v1/employees/${linked.employeeId}`)
    .set('Authorization', bearer)
    .expect(200);

  assertNoPasswordProperty(list.body);
  assertNoPasswordProperty(detail.body);
  const listedEmployee = list.body.data.list.find((item: { id: string }) => item.id === linked.employeeId);
  assert.equal(listedEmployee.user.id, linked.userId);
  assert.match(listedEmployee.user.username, /^employee\./);
  assert.equal(listedEmployee.user.status, 'ENABLED');
  assert.equal(detail.body.data.user.id, linked.userId);
  assert.equal(detail.body.data.user.userRoles[0].role.code, 'EMPLOYEE_ROLE');
});

test('employee leave cannot disable the protected first super-admin or mutate its employee', async () => {
  const linked = await createLinkedEmployee(superAdminUserId);
  const beforeEmployee = await prisma.employee.findUniqueOrThrow({ where: { id: linked.employeeId } });

  const response = await app.httpRequest()
    .post(`/api/v1/employees/${linked.employeeId}/leave`)
    .set('Authorization', bearer)
    .send({ leaveDate: '2026-07-15' })
    .expect(409);

  assertTrustRootProtected(response);
  assert.deepEqual(await prisma.employee.findUniqueOrThrow({ where: { id: linked.employeeId } }), beforeEmployee);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: superAdminUserId } })).status, 'ENABLED');
});

test('normal employee leave updates the employee and linked user together', async () => {
  const linked = await createLinkedEmployee();
  const response = await app.httpRequest()
    .post(`/api/v1/employees/${linked.employeeId}/leave`)
    .set('Authorization', bearer)
    .send({ leaveDate: '2026-07-15' })
    .expect(200);

  assert.equal(response.body.data.status, 'LEAVED');
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: linked.employeeId } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: linked.userId } });
  assert.equal(employee.status, 'LEAVED');
  assert.equal(employee.leaveDate?.toISOString(), '2026-07-15T00:00:00.000Z');
  assert.equal(user.status, 'DISABLED');
});

test('employee leave rolls back the employee update when linked user disable fails', async () => {
  const linked = await createLinkedEmployee();
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION reject_user_disable_for_test() RETURNS trigger AS $$
    BEGIN
      IF NEW.status = 'DISABLED' THEN
        RAISE EXCEPTION 'injected user disable failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER reject_user_disable_for_test_trigger
    BEFORE UPDATE ON "user"
    FOR EACH ROW EXECUTE FUNCTION reject_user_disable_for_test()
  `);

  try {
    await app.httpRequest()
      .post(`/api/v1/employees/${linked.employeeId}/leave`)
      .set('Authorization', bearer)
      .send({ leaveDate: '2026-07-15' })
      .expect(500);
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: linked.employeeId } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: linked.userId } });
    assert.equal(employee.status, 'PROBATION');
    assert.equal(employee.leaveDate, null);
    assert.equal(user.status, 'ENABLED');
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS reject_user_disable_for_test_trigger ON "user"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_user_disable_for_test()');
  }
});

test('sequential duplicate user creation returns the stable username conflict', async () => {
  const body = { username: 'duplicate.user', password: 'Duplicate-Horse-94!' };
  await app.httpRequest().post('/api/v1/users').set('Authorization', bearer).send(body).expect(200);
  const conflict = await app.httpRequest()
    .post('/api/v1/users')
    .set('Authorization', bearer)
    .send({ ...body, username: '  DUPLICATE.USER  ' })
    .expect(409);

  assert.equal(conflict.body.message, '用户名已存在');
  assertNoPasswordProperty(conflict.body);
  assert.equal(await prisma.user.count({ where: { username: 'duplicate.user' } }), 1);
});

test('concurrent duplicate user creation maps the write-time unique race to stable 409', async () => {
  await installInsertDelayTrigger('user');
  try {
    const requests = [1, 2].map(() => app.httpRequest()
      .post('/api/v1/users')
      .set('Authorization', bearer)
      .send({ username: 'concurrent.user', password: 'Concurrent-Horse-94!' }));
    const responses = await Promise.all(requests);

    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const conflict = responses.find(response => response.status === 409);
    assert.ok(conflict);
    assert.equal(conflict.body.message, '用户名已存在');
    assertNoPasswordProperty(conflict.body);
    assert.equal(JSON.stringify(conflict.body).includes('Prisma'), false);
    assert.equal(await prisma.user.count({ where: { username: 'concurrent.user' } }), 1);
  } finally {
    await dropInsertDelayTrigger('user');
  }
});

test('sequential duplicate role creation identifies both name and code conflicts', async () => {
  await app.httpRequest()
    .post('/api/v1/roles')
    .set('Authorization', bearer)
    .send({ name: 'Duplicate role', code: 'DUPLICATE_ROLE' })
    .expect(200);
  for (const body of [
    { name: 'Duplicate role', code: 'OTHER_ROLE_CODE' },
    { name: 'Other role name', code: 'duplicate_role' },
  ]) {
    const conflict = await app.httpRequest()
      .post('/api/v1/roles')
      .set('Authorization', bearer)
      .send(body)
      .expect(409);
    assert.equal(conflict.body.message, '角色名称或代码已存在');
  }
});

for (const duplicateField of ['name', 'code'] as const) {
  test(`concurrent duplicate role ${duplicateField} maps the write-time unique race to stable 409`, async () => {
    await installInsertDelayTrigger('role');
    const bodies = duplicateField === 'name'
      ? [
        { name: 'Concurrent role', code: 'CONCURRENT_ROLE_A' },
        { name: 'Concurrent role', code: 'CONCURRENT_ROLE_B' },
      ]
      : [
        { name: 'Concurrent role A', code: 'CONCURRENT_ROLE' },
        { name: 'Concurrent role B', code: 'concurrent_role' },
      ];
    try {
      const responses = await Promise.all(bodies.map(body => app.httpRequest()
        .post('/api/v1/roles')
        .set('Authorization', bearer)
        .send(body)));

      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      const conflict = responses.find(response => response.status === 409);
      assert.ok(conflict);
      assert.equal(conflict.body.message, '角色名称或代码已存在');
      assert.equal(JSON.stringify(conflict.body).includes('Prisma'), false);
      assert.equal(await prisma.role.count({
        where: duplicateField === 'name'
          ? { name: 'Concurrent role' }
          : { code: 'CONCURRENT_ROLE' },
      }), 1);
    } finally {
      await dropInsertDelayTrigger('role');
    }
  });
}
