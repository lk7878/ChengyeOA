import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

const migrationsRoot = path.resolve('prisma/migrations');
const migrationName = '20260728090000_lead_crm_customer_expand';
const migrationPath = path.join(migrationsRoot, migrationName, 'migration.sql');
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

function assertSafeTestDatabaseUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'postgresql:') throw new Error('Test reset requires PostgreSQL');
  if (!url.pathname.slice(1).endsWith('_test')) {
    throw new Error('Test database name must end with _test');
  }
  return url;
}

function readRequiredEnv(): { databaseUrl: string; allowReset: boolean } {
  const rawUrl = process.env.DATABASE_URL_TEST ?? '';
  const allowReset = process.env.ALLOW_TEST_DB_RESET === 'true';
  if (!rawUrl) throw new Error('DATABASE_URL_TEST must be set for the rehearsal test');
  assertSafeTestDatabaseUrl(rawUrl);
  return { databaseUrl: rawUrl, allowReset };
}

function runPrisma(args: readonly string[], databaseUrl: string): void {
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
}

interface TableExistenceRow {
  table_name: string;
}

async function introspectColumns(
  prisma: PrismaClient,
  tableNames: readonly string[],
): Promise<Record<string, Record<string, ColumnRow>>> {
  const rows = await prisma.$queryRaw<ColumnRow[]>`
    SELECT
      c.table_name,
      c.column_name,
      c.is_nullable,
      c.column_default::text
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = ANY (${tableNames}::text[])
  `;
  const result: Record<string, Record<string, ColumnRow>> = {};
  for (const row of rows) {
    const table = row.table_name;
    if (!result[table]) result[table] = {};
    result[table][row.column_name] = row;
  }
  return result;
}

async function introspectTables(
  prisma: PrismaClient,
  tableNames: readonly string[],
): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<TableExistenceRow[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY (${tableNames}::text[])
  `;
  return new Set(rows.map(row => row.table_name));
}

interface IndexRow {
  table_name: string;
  index_name: string;
  is_unique: boolean;
}

async function introspectIndexes(
  prisma: PrismaClient,
  tableNames: readonly string[],
): Promise<IndexRow[]> {
  const rows = await prisma.$queryRaw<IndexRow[]>`
    SELECT
      schemulus.table_name,
      schemulus.index_name,
      schemulus.is_unique
    FROM (
      SELECT
        t.relname AS table_name,
        i.relname AS index_name,
        ix.indisunique AS is_unique
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
    ) schemulus
    WHERE schemulus.table_name = ANY (${tableNames}::text[])
  `;
  return rows;
}

test('SPEC-009 lead CRM expansion migration directory and SQL exist', () => {
  const directories = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory());
  assert.ok(directories.some(entry => entry.name === migrationName),
    `expected migration directory ${migrationName}`);
  assert.ok(sql.length > 0, 'migration.sql must be non-empty');
});

test('migration SQL contains the required additive DDL', () => {
  if (!sql) assert.fail('SPEC-009 migration SQL is missing');
  assert.match(sql, /ALTER TABLE "lead"\s+ADD COLUMN "leadNo"/i);
  assert.match(sql, /ADD COLUMN "phoneHash"/i);
  assert.match(sql, /ADD COLUMN "poolStatus" TEXT NOT NULL DEFAULT 'PUBLIC'/i);
  assert.match(sql, /ALTER TABLE "customer" RENAME COLUMN "leadId" TO "sourceLeadId"/i);
  assert.match(sql, /DROP COLUMN "idCard"/i);
  assert.match(sql, /ALTER TABLE "channel"\s+ADD COLUMN "code"/i);
  assert.match(sql, /CREATE TABLE "campaign"/i);
  assert.match(sql, /CREATE TABLE "lead_pool_record"/i);
  assert.match(sql, /CREATE TABLE "appointment"/i);
  assert.match(sql, /CREATE TABLE "contact"/i);
  // sourceLeadId uniqueness is preserved by renaming the pre-existing unique index
  // (data-preserving rename, not a fresh CREATE UNIQUE INDEX).
  assert.match(sql, /RENAME TO "customer_sourceLeadId_key"/i);
});

test('migration SQL keeps the named relations and cascade rules', () => {
  if (!sql) assert.fail('SPEC-009 migration SQL is missing');
  assert.match(sql, /"lead_referralCustomerId_fkey"/i);
  assert.match(sql, /"customer_sourceLeadId_fkey"/i);
  assert.match(sql, /"appointment_rescheduledFromId_fkey"/i);
  assert.match(sql, /FOREIGN KEY \("leadId"\) REFERENCES "lead"\("id"\) ON DELETE CASCADE/i);
  assert.match(sql, /FOREIGN KEY \("customerId"\) REFERENCES "customer"\("id"\) ON DELETE CASCADE/i);
});

test('applies every migration cleanly against the test database', async () => {
  const { databaseUrl, allowReset } = readRequiredEnv();
  if (!allowReset) {
    assert.fail('ALLOW_TEST_DB_RESET=true is required for the rehearsal test');
  }
  // First reset to a pristine SPEC-000 baseline so the full sequence reapplies.
  runPrisma(['migrate', 'reset', '--force', '--skip-seed'], databaseUrl);
  // Then deploy to apply the full migration set (including the new migration).
  runPrisma(['migrate', 'deploy'], databaseUrl);

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const tables = await introspectTables(prisma, [
      'lead', 'customer', 'channel', 'lead_follow',
      'campaign', 'lead_pool_record', 'appointment', 'contact',
    ]);
    assert.ok(tables.has('campaign'), 'campaign table must exist after deploy');
    assert.ok(tables.has('lead_pool_record'), 'lead_pool_record table must exist after deploy');
    assert.ok(tables.has('appointment'), 'appointment table must exist after deploy');
    assert.ok(tables.has('contact'), 'contact table must exist after deploy');

    const columns = await introspectColumns(prisma, [
      'lead', 'customer', 'channel', 'appointment', 'contact',
    ]);

    const lead = columns['lead'] ?? {};
    assert.ok(lead['leadNo'], 'lead.leadNo column must exist');
    assert.equal(lead['leadNo']?.is_nullable, 'NO', 'lead.leadNo must be NOT NULL');
    assert.ok(lead['phoneHash'], 'lead.phoneHash column must exist');
    assert.ok(lead['poolStatus'], 'lead.poolStatus column must exist');
    assert.match(lead['poolStatus']?.column_default ?? '', /PUBLIC/i,
      'lead.poolStatus default must be PUBLIC');
    assert.ok(lead['firstResponseSeconds'], 'lead.firstResponseSeconds column must exist');
    assert.ok(lead['assignedAt'], 'lead.assignedAt column must exist');
    assert.ok(lead['referralCustomerId'], 'lead.referralCustomerId column must exist');

    const customer = columns['customer'] ?? {};
    assert.ok(customer['customerNo'], 'customer.customerNo column must exist');
    assert.ok(customer['phoneHash'], 'customer.phoneHash column must exist');
    assert.ok(customer['sourceLeadId'], 'customer.sourceLeadId column must exist after rename');
    assert.ok(!customer['idCard'], 'customer.idCard column must have been removed');
    assert.ok(!customer['leadId'], 'customer.leadId column must have been renamed away');
    assert.ok(customer['createdBy'], 'customer.createdBy column must exist');
    assert.ok(customer['updatedBy'], 'customer.updatedBy column must exist');
    assert.ok(customer['version'], 'customer.version column must exist');
    assert.ok(customer['deletedAt'], 'customer.deletedAt column must exist');

    const channel = columns['channel'] ?? {};
    assert.ok(channel['code'], 'channel.code column must exist');

    const appointment = columns['appointment'] ?? {};
    assert.ok(appointment['appointmentNo'], 'appointment.appointmentNo column must exist');
    assert.ok(appointment['rescheduledFromId'],
      'appointment.rescheduledFromId column must exist');

    const contact = columns['contact'] ?? {};
    assert.ok(contact['phoneHash'], 'contact.phoneHash column must exist');
    assert.ok(contact['isPrimary'], 'contact.isPrimary column must exist');

    const indexes = await introspectIndexes(prisma, [
      'lead', 'customer', 'appointment', 'contact',
    ]);
    const indexNames = new Set(indexes.map(row => row.index_name));
    assert.ok(indexNames.has('lead_leadNo_key'), 'lead.leadNo unique index must exist');
    assert.ok(indexNames.has('lead_phoneHash_idx'), 'lead.phoneHash index must exist');
    assert.ok(indexNames.has('customer_sourceLeadId_key'),
      'customer.sourceLeadId unique index must exist');
    assert.ok(indexNames.has('customer_phoneHash_idx'),
      'customer.phoneHash index must exist');
    assert.ok(indexNames.has('appointment_appointmentNo_key'),
      'appointment.appointmentNo unique index must exist');
    assert.ok(indexNames.has('contact_customerId_phoneHash_key'),
      'contact customerId+phoneHash unique index must exist');
  } finally {
    await prisma.$disconnect();
  }
});
