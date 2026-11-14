import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { SessionService } from '../../app/application/auth/session-service';
import { BcryptPasswordHasher } from '../../app/domain/security/password-hasher';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { assertMigrationsReady } from '../system/migration-status';
import { adminMfaResetMain, type SystemCliDependencies } from '../system/system-cli';

const EXPECTED_DATABASE = 'chengye_oa_test';
const USERNAME = 'rehearsal.superadmin';

async function main(): Promise<void> {
  const databaseUrl = assertIsolatedTestDatabase();
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const password = randomBytes(24).toString('base64url');
  let userId: string;
  let factorId: string;
  let sessionId: string;
  const transcript: string[] = [];

  try {
    await truncateApplicationData(prisma);
    const role = await prisma.role.create({
      data: {
        id: `role:rehearsal:${randomUUID()}`,
        code: 'SYSTEM_SUPER_ADMIN',
        name: 'Rehearsal Super Admin',
        type: 'SYSTEM',
      },
    });
    const user = await prisma.user.create({
      data: { username: USERNAME, password: await new BcryptPasswordHasher(4).hash(password) },
    });
    userId = user.id;
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
    const factor = await prisma.mfaFactor.create({ data: {
      userId,
      encryptedSecret: 'isolated-rehearsal-ciphertext',
      secretIv: 'isolated-rehearsal-iv',
      secretAuthTag: 'isolated-rehearsal-tag',
      verifiedAt: new Date(),
    } });
    factorId = factor.id;
    await prisma.mfaRecoveryCode.create({
      data: { factorId, codeHash: `isolated-rehearsal-hash-${randomUUID()}` },
    });
    sessionId = (await new SessionService(
      prisma,
      new JwtTokenService('isolated-rehearsal-jwt-secret-32-bytes'),
    ).create(userId, 'MFA', {})).sessionId;

    const answers = [
      USERNAME,
      password,
      `RESET ADMIN MFA ${EXPECTED_DATABASE} ${USERNAME}`,
    ];
    const dependencies: SystemCliDependencies = {
      isTty: true,
      prompts: {
        text: async () => answers.shift() ?? '',
        secret: async () => answers.shift() ?? '',
        close: () => undefined,
      },
      stdout: { write: value => { transcript.push(String(value)); return true; } },
      stderr: { write: value => { transcript.push(String(value)); return true; } },
      assertMigrationsReady,
      createPrisma: url => new PrismaClient({ datasources: { db: { url } } }),
      hostname: () => 'spec-006-isolated-rehearsal',
      randomUUID,
    };
    const exitCode = await adminMfaResetMain([], { DATABASE_URL: databaseUrl }, dependencies);
    if (exitCode !== 0) throw new Error(`CLI_EXIT_${exitCode}`);

    const [updatedUser, updatedFactor, updatedSession, recoveryCode, audit] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.mfaFactor.findUniqueOrThrow({ where: { id: factorId } }),
      prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } }),
      prisma.mfaRecoveryCode.findFirstOrThrow({ where: { factorId } }),
      prisma.operationLog.findFirstOrThrow({
        where: { userId, action: 'ADMIN_MFA_RESET_RECOVERY', targetId: userId },
      }),
    ]);
    if (
      updatedUser.credentialVersion !== 2
      || !updatedFactor.disabledAt
      || !updatedSession.revokedAt
      || !recoveryCode.usedAt
    ) {
      throw new Error('RESET_POSTCONDITION_FAILED');
    }
    const evidence = `${transcript.join('')}\n${JSON.stringify(audit)}`;
    if (
      evidence.includes(password)
      || evidence.includes('isolated-rehearsal-ciphertext')
      || evidence.includes(`RESET ADMIN MFA ${EXPECTED_DATABASE} ${USERNAME}`)
    ) {
      throw new Error('SECRET_REDACTION_FAILED');
    }
    process.stdout.write(`Emergency admin MFA CLI rehearsal passed against ${EXPECTED_DATABASE}.\n`);
  } finally {
    await truncateApplicationData(prisma);
    await prisma.$disconnect();
  }
}

function assertIsolatedTestDatabase(): string {
  if (process.env.ALLOW_TEST_DB_RESET !== 'true') {
    throw new Error('TEST_RESET_GUARD_REQUIRED');
  }
  const raw = process.env.DATABASE_URL_TEST ?? '';
  const url = new URL(raw);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (
    url.protocol !== 'postgresql:'
    || !['localhost', '127.0.0.1'].includes(url.hostname)
    || databaseName !== EXPECTED_DATABASE
  ) {
    throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
  }
  return url.toString();
}

async function truncateApplicationData(prisma: PrismaClient): Promise<void> {
  const tables = Prisma.dmmf.datamodel.models.map(model => model.dbName ?? model.name);
  const quoted = tables.map(table => `"${table.replaceAll('"', '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} CASCADE`);
}

void main().catch(() => {
  process.stderr.write(`Emergency admin MFA CLI rehearsal failed. Reference: ${randomUUID()}\n`);
  process.exitCode = 1;
});
