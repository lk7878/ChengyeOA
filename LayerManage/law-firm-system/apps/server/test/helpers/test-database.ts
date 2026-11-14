import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { EVENT_SUBSCRIPTION_CATALOG } from '../../app/domain/events/event-subscription-catalog';

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
  await prisma.permission.createMany({
    data: PERMISSION_CATALOG.map(item => ({
      id: item.id,
      code: item.code,
      name: item.name,
      type: item.type,
      resource: item.resource,
      action: item.action,
      riskLevel: item.riskLevel,
      path: item.route,
      status: item.status,
    })),
  });
  await prisma.eventSubscription.createMany({
    data: EVENT_SUBSCRIPTION_CATALOG.map(item => ({
      id: item.id,
      code: item.code,
      eventType: item.eventType,
      eventVersion: item.eventVersion,
      handlerCode: item.handlerCode,
      status: item.status,
      filterJson: Prisma.DbNull,
    })),
  });
}
