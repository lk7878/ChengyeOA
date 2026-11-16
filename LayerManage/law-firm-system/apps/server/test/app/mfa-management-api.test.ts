import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import mm from 'egg-mock';
import { SessionService } from '../../app/application/auth/session-service';
import { decodeBase32 } from '../../app/domain/security/base32';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { hashOpaqueToken } from '../../app/domain/security/opaque-token';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { TotpService } from '../../app/domain/security/totp-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';

process.env.EGG_TYPESCRIPT = 'true';
const app = mm.app();
const origin = 'http://localhost:3000';
const jwtSecret = '01234567890123456789012345678901';
let prisma: PrismaClient;

interface BrowserIdentity {
  userId: string;
  secret: string;
  token: string;
  csrfToken: string;
}

function totpCode(secret: string): string {
  const counter = BigInt(Math.floor(Date.now() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

async function identity(administrator = false): Promise<BrowserIdentity> {
  const user = await prisma.user.create({
    data: { username: `mfa.api.manage.${randomUUID()}`, password: 'x' },
  });
  if (administrator) {
    const role = await prisma.role.create({
      data: { id: 'role:system-admin', code: 'SYSTEM_ADMIN', name: 'System Admin', type: 'SYSTEM' },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  const secret = new TotpService().generateSecret();
  const encrypted = new MfaSecretCrypto((app.config as typeof app.config & { identitySecurity: { mfaEncryptionKeys: ReadonlyMap<number, Buffer> } }).identitySecurity.mfaEncryptionKeys).encrypt(secret);
  await prisma.mfaFactor.create({ data: {
    userId: user.id,
    encryptedSecret: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    verifiedAt: new Date(),
  } });
  const credentials = await new SessionService(prisma, new JwtTokenService(jwtSecret)).create(user.id, 'MFA', {});
  return { userId: user.id, secret, token: credentials.accessToken, csrfToken: credentials.csrfToken };
}

function authenticated(request: ReturnType<ReturnType<typeof app.httpRequest>['post']>, value: BrowserIdentity) {
  return request
    .set('Authorization', `Bearer ${value.token}`)
    .set('Origin', origin)
    .set('X-CSRF-Token', value.csrfToken)
    .set('Cookie', `chengye_csrf=${value.csrfToken}`);
}

async function stepUp(value: BrowserIdentity, purpose: string, target: unknown): Promise<string> {
  const response = await authenticated(app.httpRequest().post('/api/v1/auth/step-up'), value)
    .send({ purpose, target, code: totpCode(value.secret) })
    .expect(200);
  return response.body.data.stepUpToken;
}

test.before(async () => { prisma = createTestPrisma(); await app.ready(); });
test.beforeEach(async () => { await clearTestApplicationData(prisma); });
test.after(async () => {
  await clearTestApplicationData(prisma);
  await prisma.$disconnect();
  await app.close();
  await mm.restore();
});

test('returns MFA status and regenerates recovery codes without step-up', async () => {
  const actor = await identity();
  const status = await app.httpRequest().get('/api/v1/auth/mfa')
    .set('Authorization', `Bearer ${actor.token}`).expect(200);
  assert.equal(status.body.data.enabled, true);

  const response = await authenticated(app.httpRequest().post('/api/v1/auth/mfa/recovery-codes'), actor)
    .expect(200);
  assert.equal(response.body.data.recoveryCodes.length, 10);
  assert.equal(await prisma.mfaRecoveryCode.count({ where: { usedAt: null } }), 10);
});

test('disables ordinary-user MFA but rejects administrator disable without consuming the grant', async () => {
  const administrator = await identity(true);
  const blockedGrant = await stepUp(administrator, 'MFA_DISABLE_SELF', { userId: administrator.userId });
  const blocked = await authenticated(app.httpRequest().delete('/api/v1/auth/mfa'), administrator)
    .set('X-Step-Up-Token', blockedGrant).expect(403);
  assert.equal(blocked.body.message, 'MFA_REQUIRED');
  assert.equal((await prisma.stepUpGrant.findUniqueOrThrow({
    where: { tokenHash: hashOpaqueToken(blockedGrant) },
  })).consumedAt, null);

  await clearTestApplicationData(prisma);
  const ordinary = await identity();
  await authenticated(app.httpRequest().delete('/api/v1/auth/mfa'), ordinary)
    .expect(200);
  assert.equal(await prisma.mfaFactor.count({ where: { userId: ordinary.userId, disabledAt: null } }), 0);
  assert.equal(await prisma.authSession.count({ where: { userId: ordinary.userId, revokedAt: null } }), 0);
});
