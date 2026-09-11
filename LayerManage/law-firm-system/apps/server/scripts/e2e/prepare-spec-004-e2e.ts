import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { SessionService } from '../../app/application/auth/session-service';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { TotpService } from '../../app/domain/security/totp-service';
import { assertTestDatabaseUrl, clearTestApplicationData } from '../../test/helpers/test-database';

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: assertTestDatabaseUrl().toString() } } });
  try {
    await clearTestApplicationData(prisma);
    const root = await prisma.organization.create({ data: {
      id: 'spec004-e2e-root', code: 'ROOT', name: '承业总所', type: 'FIRM', path: '/spec004-e2e-root',
    } });
    const admin = await prisma.user.create({ data: {
      id: 'spec004-e2e-admin', username: 'spec004.e2e.admin', password: 'non-login-e2e-fixture', mustChangePassword: false,
    } });
    const manager = await prisma.user.create({ data: {
      id: 'spec004-e2e-manager', username: 'spec004.e2e.manager', password: 'non-login-e2e-fixture', mustChangePassword: false,
    } });
    const role = await prisma.role.create({ data: {
      id: 'spec004-e2e-root-role', code: 'SYSTEM_SUPER_ADMIN', name: '系统超级管理员', type: 'SYSTEM',
    } });
    await prisma.userRole.create({ data: { id: 'spec004-e2e-root-grant', userId: admin.id, roleId: role.id } });
    await prisma.systemInitialization.create({ data: {
      id: 'PRIMARY', rootOrganizationId: root.id, superAdminUserId: admin.id, completedAt: new Date(),
    } });
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required');
    const tokens = new JwtTokenService(secret);
    const mfaKey = Buffer.from(process.env.MFA_ENCRYPTION_KEY_V1 ?? '', 'base64');
    if (mfaKey.length !== 32) throw new Error('MFA_ENCRYPTION_KEY_V1 must decode to 32 bytes');
    const factorSecret = new TotpService().generateSecret();
    const encrypted = new MfaSecretCrypto(new Map([[1, mfaKey]])).encrypt(factorSecret);
    await prisma.mfaFactor.create({ data: {
      userId: admin.id, encryptedSecret: encrypted.ciphertext, secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag, keyVersion: encrypted.keyVersion, verifiedAt: new Date(),
    } });
    const sessions = new SessionService(prisma, tokens);
    process.stdout.write(JSON.stringify({
      adminToken: (await sessions.create(admin.id, 'MFA', {})).accessToken,
      managerToken: (await sessions.create(manager.id, 'PASSWORD', {})).accessToken,
      adminUserId: admin.id,
      managerUserId: manager.id,
      rootOrganizationId: root.id,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'SPEC-004 E2E preparation failed');
  process.exitCode = 1;
});
