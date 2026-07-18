import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { JwtTokenService } from '../../app/domain/security/token-service';
import { assertTestDatabaseUrl, clearTestApplicationData } from '../../test/helpers/test-database';

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: assertTestDatabaseUrl().toString() } } });
  try {
    await clearTestApplicationData(prisma);
    const root = await prisma.organization.create({ data: { id: 'e2e-root', code: 'ROOT', name: '承业总所', type: 'FIRM', path: '/e2e-root' } });
    const user = await prisma.user.create({ data: { id: 'e2e-admin', username: 'e2e.admin', password: 'non-login-e2e-fixture' } });
    const role = await prisma.role.create({ data: { id: 'e2e-role', code: 'SYSTEM_SUPER_ADMIN', name: '系统超级管理员', type: 'SYSTEM' } });
    await prisma.userRole.create({ data: { id: 'e2e-user-role', userId: user.id, roleId: role.id } });
    await prisma.systemInitialization.create({ data: { id: 'PRIMARY', rootOrganizationId: root.id, superAdminUserId: user.id, completedAt: new Date() } });
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required');
    const token = new JwtTokenService(secret).signAccess(user.id, user.credentialVersion);
    process.stdout.write(JSON.stringify({ token, userId: user.id, rootOrganizationId: root.id }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'E2E preparation failed');
  process.exitCode = 1;
});
