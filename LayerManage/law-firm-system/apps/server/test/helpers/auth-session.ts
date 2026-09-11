import { PrismaClient } from '@prisma/client';
import { SessionService } from '../../app/application/auth/session-service';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { TotpService } from '../../app/domain/security/totp-service';

const JWT_SECRET = '01234567890123456789012345678901';
const MFA_KEY = Buffer.from('0123456789abcdef0123456789abcdef');

export async function createApiSession(
  prisma: PrismaClient,
  userId: string,
  assuranceLevel: 'PASSWORD' | 'MFA' = 'PASSWORD',
): Promise<{ token: string; refreshToken: string; sessionId: string; csrfToken: string }> {
  if (assuranceLevel === 'MFA') await ensureVerifiedFactor(prisma, userId);
  const credentials = await new SessionService(prisma, new JwtTokenService(JWT_SECRET)).create(
    userId,
    assuranceLevel,
    {},
  );
  return {
    token: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    sessionId: credentials.sessionId,
    csrfToken: credentials.csrfToken,
  };
}

async function ensureVerifiedFactor(prisma: PrismaClient, userId: string): Promise<void> {
  const existing = await prisma.mfaFactor.findFirst({ where: { userId, disabledAt: null } });
  if (existing) return;
  const secret = new TotpService().generateSecret();
  const encrypted = new MfaSecretCrypto(new Map([[1, MFA_KEY]])).encrypt(secret);
  await prisma.mfaFactor.create({ data: {
    userId,
    encryptedSecret: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    verifiedAt: new Date(),
  } });
}
