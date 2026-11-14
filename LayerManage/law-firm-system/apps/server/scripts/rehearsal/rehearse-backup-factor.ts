import { createHash, createHmac, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { decodeBase32, encodeBase32 } from '../../app/domain/security/base32';
import { MfaSecretCrypto } from '../../app/domain/security/mfa-factor-crypto';
import { TotpService } from '../../app/domain/security/totp-service';

const SOURCE_DATABASE = 'chengye_oa';
const RESTORE_DATABASE = 'chengye_oa_restore_test';
const USERNAME = 'spec006.backup.rehearsal';
const PUBLIC_MARKER = 'SPEC-006 controlled backup restore factor v1';
const FIXED_TIME = new Date('2030-01-02T03:04:05.000Z');

async function main(): Promise<void> {
  const action = process.argv[2];
  const { databaseName, databaseUrl } = assertTarget(action);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    if (action === 'prepare') await prepare(prisma);
    else if (action === 'verify') await verify(prisma);
    else await cleanup(prisma);
    process.stdout.write(`Backup factor rehearsal ${action} passed against ${databaseName}.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

async function prepare(prisma: PrismaClient): Promise<void> {
  const existingUsers = await prisma.user.count();
  const existingFactors = await prisma.mfaFactor.count();
  if (existingUsers !== 0 || existingFactors !== 0) throw new Error('SOURCE_DATABASE_NOT_EMPTY');
  const crypto = factorCrypto();
  const encrypted = crypto.encrypt(controlledSecret());
  const user = await prisma.user.create({
    data: { username: USERNAME, password: randomBytes(32).toString('hex') },
  });
  await prisma.mfaFactor.create({ data: {
    userId: user.id,
    encryptedSecret: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    verifiedAt: FIXED_TIME,
  } });
}

async function verify(prisma: PrismaClient): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { username: USERNAME } });
  const factor = await prisma.mfaFactor.findFirstOrThrow({
    where: { userId: user.id, disabledAt: null, verifiedAt: { not: null } },
  });
  const secret = factorCrypto().decrypt({
    ciphertext: factor.encryptedSecret,
    iv: factor.secretIv,
    authTag: factor.secretAuthTag,
    keyVersion: factor.keyVersion,
  });
  if (secret !== controlledSecret()) throw new Error('RESTORED_FACTOR_DECRYPTION_FAILED');
  const match = new TotpService().verify(secret, codeAt(secret, FIXED_TIME), FIXED_TIME);
  if (!match) throw new Error('RESTORED_FACTOR_TOTP_FAILED');
}

async function cleanup(prisma: PrismaClient): Promise<void> {
  const user = await prisma.user.findUnique({ where: { username: USERNAME } });
  if (!user) return;
  await prisma.$transaction(async tx => {
    const factors = await tx.mfaFactor.findMany({ where: { userId: user.id }, select: { id: true } });
    const factorIds = factors.map(factor => factor.id);
    await tx.mfaRecoveryCode.deleteMany({ where: { factorId: { in: factorIds } } });
    await tx.mfaFactor.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });
}

function assertTarget(action: string | undefined): { databaseName: string; databaseUrl: string } {
  if (process.env.ALLOW_BACKUP_REHEARSAL !== 'true') throw new Error('BACKUP_REHEARSAL_GUARD_REQUIRED');
  if (!['prepare', 'verify', 'cleanup'].includes(action ?? '')) throw new Error('ACTION_INVALID');
  const raw = process.env.DATABASE_URL ?? '';
  const url = new URL(raw);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const expected = action === 'verify' ? RESTORE_DATABASE : SOURCE_DATABASE;
  if (
    url.protocol !== 'postgresql:'
    || !['localhost', '127.0.0.1'].includes(url.hostname)
    || databaseName !== expected
  ) {
    throw new Error('BACKUP_REHEARSAL_DATABASE_INVALID');
  }
  return { databaseName, databaseUrl: url.toString() };
}

function factorCrypto(): MfaSecretCrypto {
  const raw = process.env.MFA_ENCRYPTION_KEY_V1 ?? '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) throw new Error('MFA_KEY_INVALID');
  return new MfaSecretCrypto(new Map([[1, key]]));
}

function controlledSecret(): string {
  return encodeBase32(createHash('sha256').update(PUBLIC_MARKER).digest().subarray(0, 20));
}

function codeAt(secret: string, time: Date): string {
  const counter = BigInt(Math.floor(time.getTime() / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

void main().catch(() => {
  process.stderr.write('Backup factor rehearsal failed.\n');
  process.exitCode = 1;
});
