import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { isMasterDataPath } from '../../app/middleware/masterDataAccess';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';

const app = mm.app();
const jwtSecret = '01234567890123456789012345678901';
let prisma: PrismaClient;

async function tokenForRole(input: { code: string; type: string; status: string }): Promise<string> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      username: `master.data.${suffix}`,
      password: 'not-used-by-this-test',
      status: 'ENABLED',
    },
  });
  const role = await prisma.role.create({
    data: {
      name: `Master data role ${suffix}`,
      code: input.code,
      type: input.type,
      status: input.status,
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return new JwtTokenService(jwtSecret).signAccess(user.id, user.credentialVersion);
}

test.before(async () => {
  prisma = createTestPrisma();
  await app.ready();
});

test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
});

test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('matches only complete master-data route prefixes', () => {
  assert.equal(isMasterDataPath('/api/v1/employees/1'), true);
  assert.equal(isMasterDataPath('/api/v1/professional-teams/1/members'), true);
  assert.equal(isMasterDataPath('/api/v1/employees-report'), false);
  assert.equal(isMasterDataPath('/api/v1/customers'), false);
});

test('requires authentication before checking master-data access', async () => {
  const response = await app.httpRequest().get('/api/v1/organizations').expect(401);
  assert.equal(response.body.message, 'TOKEN_INVALID');
});

test('rejects an enabled business role with the stable access error', async () => {
  const token = await tokenForRole({ code: 'BUSINESS_ADMIN', type: 'BUSINESS', status: 'ENABLED' });
  const response = await app.httpRequest()
    .get('/api/v1/organizations')
    .set('Authorization', `Bearer ${token}`)
    .expect(403);
  assert.equal(response.body.message, 'SYSTEM_SUPER_ADMIN_REQUIRED');
});

test('rejects a disabled system super-admin role', async () => {
  const token = await tokenForRole({ code: 'SYSTEM_SUPER_ADMIN', type: 'SYSTEM', status: 'DISABLED' });
  const response = await app.httpRequest()
    .get('/api/v1/organizations')
    .set('Authorization', `Bearer ${token}`)
    .expect(403);
  assert.equal(response.body.message, 'SYSTEM_SUPER_ADMIN_REQUIRED');
});

test('allows an enabled system super-admin to reach the controller', async () => {
  const token = await tokenForRole({ code: 'SYSTEM_SUPER_ADMIN', type: 'SYSTEM', status: 'ENABLED' });
  const response = await app.httpRequest()
    .get('/api/v1/organizations/tree')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.deepEqual(response.body.data, []);
});

test('position routes remove physical delete and expose versioned update and disable commands', async () => {
  const token = await tokenForRole({ code: 'SYSTEM_SUPER_ADMIN', type: 'SYSTEM', status: 'ENABLED' });
  const organizationId = randomUUID();
  await prisma.organization.create({
    data: {
      id: organizationId,
      code: 'POSITION_TEST_ORG',
      name: 'Position Test Organization',
      type: 'BRANCH',
      path: `/${organizationId}`,
    },
  });
  const position = await prisma.position.create({
    data: {
      organizationId,
      code: 'LAWYER',
      name: 'Lawyer',
      categoryCode: 'LEGAL',
    },
  });

  await app.httpRequest()
    .delete(`/api/v1/positions/${position.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(404);

  const updated = await app.httpRequest()
    .patch(`/api/v1/positions/${position.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Senior Lawyer', version: 1 })
    .expect(200);
  assert.equal(updated.body.data.name, 'Senior Lawyer');

  const disabled = await app.httpRequest()
    .post(`/api/v1/positions/${position.id}/disable`)
    .set('Authorization', `Bearer ${token}`)
    .send({ version: 2 })
    .expect(200);
  assert.equal(disabled.body.data.status, 'DISABLED');
});
