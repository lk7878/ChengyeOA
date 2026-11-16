import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { SessionService } from '../../app/application/auth/session-service';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
const jwtSecret = '01234567890123456789012345678901';
let prisma: PrismaClient;
let adminRoleId: string;

async function createUser() {
  return prisma.user.create({ data: { username: `guard.${randomUUID()}`, password: 'unused' } });
}

async function session(userId: string, assuranceLevel: 'PASSWORD' | 'MFA') {
  return new SessionService(prisma, new JwtTokenService(jwtSecret)).create(userId, assuranceLevel, {});
}

async function assignAdmin(userId: string): Promise<void> {
  await prisma.userRole.create({ data: { userId, roleId: adminRoleId } });
}

async function addVerifiedFactor(userId: string, disabledAt: Date | null = null): Promise<void> {
  await prisma.mfaFactor.create({ data: {
    userId,
    type: 'TOTP',
    encryptedSecret: 'encrypted',
    secretIv: 'iv',
    secretAuthTag: 'tag',
    keyVersion: 1,
    verifiedAt: new Date(),
    disabledAt,
  } });
}

function authorization(token: string) {
  return app.httpRequest()
    .get('/api/v1/authorization/me')
    .set('Authorization', `Bearer ${token}`);
}

test.before(async () => { prisma = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => {
  await clearTestApplicationData(prisma);
  adminRoleId = (await prisma.role.create({
    data: { id: 'role:system-admin', code: 'SYSTEM_ADMIN', name: 'System Admin', type: 'SYSTEM' },
  })).id;
});
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('allows ordinary reads by administrators without a factor', async () => {
  const user = await createUser();
  await assignAdmin(user.id);
  const credentials = await session(user.id, 'PASSWORD');
  await authorization(credentials.accessToken).expect(200);
});

test('allows ordinary reads by password-only administrators with an old factor', async () => {
  const user = await createUser();
  await assignAdmin(user.id);
  await addVerifiedFactor(user.id);
  const credentials = await session(user.id, 'PASSWORD');
  await authorization(credentials.accessToken).expect(200);
});

test('allows a verified MFA administrator session and an ordinary password session', async () => {
  const admin = await createUser();
  await assignAdmin(admin.id);
  await addVerifiedFactor(admin.id);
  await authorization((await session(admin.id, 'MFA')).accessToken).expect(200);

  const ordinary = await createUser();
  await authorization((await session(ordinary.id, 'PASSWORD')).accessToken).expect(200);
});

test('role promotion does not force login MFA on ordinary reads', async () => {
  const user = await createUser();
  const credentials = await session(user.id, 'PASSWORD');
  await authorization(credentials.accessToken).expect(200);
  await assignAdmin(user.id);
  await authorization(credentials.accessToken).expect(200);
});
