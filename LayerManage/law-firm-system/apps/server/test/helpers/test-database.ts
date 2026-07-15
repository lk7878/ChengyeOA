import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

export function assertTestDatabaseUrl(rawUrl = process.env.DATABASE_URL_TEST ?? ''): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:' || !url.pathname.slice(1).endsWith('_test')) {
    throw new Error('Integration tests require a PostgreSQL database ending in _test');
  }
  return url;
}

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: assertTestDatabaseUrl().toString() } } });
}

export async function clearTestApplicationData(prisma: PrismaClient): Promise<void> {
  assertTestDatabaseUrl();
  const tables = Prisma.dmmf.datamodel.models.map(model => model.dbName ?? model.name);
  const quoted = tables.map(table => `"${table.replaceAll('"', '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} CASCADE`);
}
