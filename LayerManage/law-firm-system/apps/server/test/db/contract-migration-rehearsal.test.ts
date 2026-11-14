import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

const migrationsRoot = path.resolve('prisma/migrations');
const migrationName = '20260730120000_negotiation_contract_payment_expand';
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

interface ReferentialRow {
  constraint_name: string;
  delete_rule: string;
}

async function introspectReferentialRules(
  prisma: PrismaClient,
  constraintNames: readonly string[],
): Promise<Record<string, string>> {
  const rows = await prisma.$queryRaw<ReferentialRow[]>`
    SELECT constraint_name, delete_rule
    FROM information_schema.referential_constraints
    WHERE constraint_schema = 'public'
      AND constraint_name = ANY (${constraintNames}::text[])
  `;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.constraint_name] = row.delete_rule;
  }
  return result;
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

test('SPEC-010 negotiation/contract/payment expansion migration directory and SQL exist', () => {
  const directories = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory());
  assert.ok(directories.some(entry => entry.name === migrationName),
    `expected migration directory ${migrationName}`);
  assert.ok(sql.length > 0, 'migration.sql must be non-empty');
});

test('migration SQL contains the required DDL for new tables', () => {
  if (!sql) assert.fail('SPEC-010 migration SQL is missing');
  assert.match(sql, /CREATE TABLE "negotiation"/i);
  assert.match(sql, /CREATE TABLE "contract_template"/i);
  assert.match(sql, /CREATE TABLE "contract_number_sequence"/i);
  assert.match(sql, /CREATE TABLE "payment_plan"/i);
  assert.match(sql, /CREATE TABLE "analysis_engagement"/i);
});

test('migration SQL rebuilds contract and payment columns', () => {
  if (!sql) assert.fail('SPEC-010 migration SQL is missing');
  // contract: destructive column replacement (prototype table, test data is disposable)
  assert.match(sql, /ALTER TABLE "contract"\s+ADD COLUMN "contractType"/i);
  assert.match(sql, /ADD COLUMN "sourceType"/i);
  assert.match(sql, /ADD COLUMN "negotiationId"/i);
  assert.match(sql, /ADD COLUMN "parentContractId"/i);
  assert.match(sql, /ADD COLUMN "esignLinkId"/i);
  assert.match(sql, /ADD COLUMN "version"/i);
  assert.match(sql, /ADD COLUMN "deletedAt"/i);
  assert.match(sql, /DROP COLUMN "type"/i);
  assert.match(sql, /DROP COLUMN "paidAmount"/i);
  // payment: rebuilt with business identity columns
  assert.match(sql, /ALTER TABLE "payment"\s+ADD COLUMN "paymentNo"/i);
  assert.match(sql, /ADD COLUMN "paymentPlanId"/i);
  assert.match(sql, /ADD COLUMN "confirmedBy"/i);
  assert.match(sql, /ADD COLUMN "createdBy"/i);
  // case: lawyerId becomes nullable
  assert.match(sql, /ALTER TABLE "case"\s+ALTER COLUMN "lawyerId" DROP NOT NULL/i);
});

test('applies every migration cleanly against the test database', async () => {
  const { databaseUrl, allowReset } = readRequiredEnv();
  if (!allowReset) {
    assert.fail('ALLOW_TEST_DB_RESET=true is required for the rehearsal test');
  }
  // First reset to a pristine baseline so the full sequence reapplies.
  runPrisma(['migrate', 'reset', '--force', '--skip-seed'], databaseUrl);
  // Then deploy to apply the full migration set (including the new migration).
  runPrisma(['migrate', 'deploy'], databaseUrl);

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const tables = await introspectTables(prisma, [
      'negotiation', 'contract_template', 'contract_number_sequence',
      'payment_plan', 'analysis_engagement', 'contract', 'payment', 'case',
    ]);
    assert.ok(tables.has('negotiation'), 'negotiation table must exist after deploy');
    assert.ok(tables.has('contract_template'),
      'contract_template table must exist after deploy');
    assert.ok(tables.has('contract_number_sequence'),
      'contract_number_sequence table must exist after deploy');
    assert.ok(tables.has('payment_plan'), 'payment_plan table must exist after deploy');
    assert.ok(tables.has('analysis_engagement'),
      'analysis_engagement table must exist after deploy');

    const columns = await introspectColumns(prisma, [
      'negotiation', 'contract_template', 'contract_number_sequence',
      'payment_plan', 'analysis_engagement', 'contract', 'payment', 'case',
    ]);

    const contract = columns['contract'] ?? {};
    assert.ok(contract['contractType'], 'contract.contractType column must exist');
    assert.ok(contract['sourceType'], 'contract.sourceType column must exist');
    assert.ok(contract['negotiationId'], 'contract.negotiationId column must exist');
    assert.ok(contract['parentContractId'], 'contract.parentContractId column must exist');
    assert.ok(contract['branchId'], 'contract.branchId column must exist');
    assert.ok(contract['professionalTeamId'],
      'contract.professionalTeamId column must exist');
    assert.ok(contract['receivedAmount'], 'contract.receivedAmount column must exist');
    assert.ok(contract['version'], 'contract.version column must exist');
    assert.ok(contract['deletedAt'], 'contract.deletedAt column must exist');
    assert.ok(contract['esignLinkId'], 'contract.esignLinkId column must exist');
    assert.ok(contract['esignSerialNo'], 'contract.esignSerialNo column must exist');
    assert.ok(contract['esignStatus'], 'contract.esignStatus column must exist');
    assert.ok(contract['esignCallbackPayload'],
      'contract.esignCallbackPayload column must exist');
    assert.ok(contract['createdBy'], 'contract.createdBy column must exist');
    assert.ok(!contract['type'], 'contract.type column must have been removed');
    assert.ok(!contract['paidAmount'], 'contract.paidAmount column must have been removed');

    const payment = columns['payment'] ?? {};
    assert.ok(payment['paymentNo'], 'payment.paymentNo column must exist');
    assert.ok(payment['paymentPlanId'], 'payment.paymentPlanId column must exist');
    assert.ok(payment['confirmedBy'], 'payment.confirmedBy column must exist');
    assert.ok(payment['confirmedAt'], 'payment.confirmedAt column must exist');
    assert.ok(payment['createdBy'], 'payment.createdBy column must exist');
    assert.ok(payment['updatedBy'], 'payment.updatedBy column must exist');
    assert.ok(payment['version'], 'payment.version column must exist');
    assert.ok(payment['deletedAt'], 'payment.deletedAt column must exist');
    assert.equal(payment['contractId']?.is_nullable, 'NO',
      'payment.contractId must be NOT NULL after rebuild');
    assert.ok(!payment['receivedAmount'],
      'payment.receivedAmount column must have been removed');
    assert.ok(!payment['dueDate'], 'payment.dueDate column must have been removed');
    assert.ok(!payment['receivedDate'],
      'payment.receivedDate column must have been removed');
    assert.ok(!payment['paymentMethod'],
      'payment.paymentMethod column must have been removed');
    assert.ok(!payment['paymentAccount'],
      'payment.paymentAccount column must have been removed');

    const negotiation = columns['negotiation'] ?? {};
    assert.ok(negotiation['negotiationNo'], 'negotiation.negotiationNo column must exist');
    assert.ok(negotiation['customerId'], 'negotiation.customerId column must exist');
    assert.ok(negotiation['negotiatorEmployeeId'],
      'negotiation.negotiatorEmployeeId column must exist');
    assert.ok(negotiation['status'], 'negotiation.status column must exist');
    assert.match(negotiation['status']?.column_default ?? '', /NEGOTIATING/i,
      'negotiation.status default must be NEGOTIATING');
    assert.ok(negotiation['version'], 'negotiation.version column must exist');
    assert.ok(negotiation['deletedAt'], 'negotiation.deletedAt column must exist');

    const paymentPlan = columns['payment_plan'] ?? {};
    assert.ok(paymentPlan['planNo'], 'payment_plan.planNo column must exist');
    assert.ok(paymentPlan['contractId'], 'payment_plan.contractId column must exist');
    assert.ok(paymentPlan['period'], 'payment_plan.period column must exist');
    assert.ok(paymentPlan['receivedAmount'],
      'payment_plan.receivedAmount column must exist');

    const analysisEngagement = columns['analysis_engagement'] ?? {};
    assert.ok(analysisEngagement['engagementNo'],
      'analysis_engagement.engagementNo column must exist');
    assert.ok(analysisEngagement['contractId'],
      'analysis_engagement.contractId column must exist');

    const caseColumns = columns['case'] ?? {};
    assert.equal(caseColumns['lawyerId']?.is_nullable, 'YES',
      'case.lawyerId must be nullable after migration');

    const indexes = await introspectIndexes(prisma, [
      'negotiation', 'contract_template', 'contract_number_sequence',
      'payment_plan', 'analysis_engagement', 'contract', 'payment',
    ]);
    const indexNames = new Set(indexes.map(row => row.index_name));
    assert.ok(indexNames.has('negotiation_negotiationNo_key'),
      'negotiation.negotiationNo unique index must exist');
    assert.ok(indexNames.has('contract_template_code_key'),
      'contract_template.code unique index must exist');
    assert.ok(indexNames.has('contract_number_sequence_scopeKey_key'),
      'contract_number_sequence.scopeKey unique index must exist');
    assert.ok(indexNames.has('payment_plan_planNo_key'),
      'payment_plan.planNo unique index must exist');
    assert.ok(indexNames.has('payment_plan_contractId_period_idx'),
      'payment_plan [contractId, period] index must exist');
    assert.ok(indexNames.has('payment_plan_status_dueDate_idx'),
      'payment_plan [status, dueDate] index must exist');
    assert.ok(indexNames.has('analysis_engagement_engagementNo_key'),
      'analysis_engagement.engagementNo unique index must exist');
    assert.ok(indexNames.has('analysis_engagement_contractId_key'),
      'analysis_engagement.contractId unique index must exist');
    assert.ok(indexNames.has('payment_paymentNo_key'),
      'payment.paymentNo unique index must exist');
    assert.ok(indexNames.has('payment_paymentPlanId_idx'),
      'payment.paymentPlanId index must exist');
    assert.ok(indexNames.has('contract_contractType_status_idx'),
      'contract [contractType, status] index must exist');
    assert.ok(indexNames.has('contract_branchId_createdAt_idx'),
      'contract [branchId, createdAt] index must exist');
    assert.ok(indexNames.has('negotiation_branchId_createdAt_idx'),
      'negotiation [branchId, createdAt] index must exist');

    // FK delete behavior: optional relations must be SET NULL (Prisma default
    // for optional relations; pins the lawyerId-nullability drift class).
    const rules = await introspectReferentialRules(prisma, [
      'case_lawyerId_fkey',
      'contract_negotiationId_fkey',
      'contract_parentContractId_fkey',
      'payment_paymentPlanId_fkey',
      'negotiation_customerId_fkey',
      'negotiation_negotiatorEmployeeId_fkey',
      'payment_contractId_fkey',
      'payment_plan_contractId_fkey',
      'analysis_engagement_customerId_fkey',
      'analysis_engagement_contractId_fkey',
    ]);
    assert.equal(rules['case_lawyerId_fkey'], 'SET NULL',
      'case.lawyerId FK must be ON DELETE SET NULL after nullability change');
    assert.equal(rules['contract_negotiationId_fkey'], 'SET NULL',
      'contract.negotiationId FK must be ON DELETE SET NULL');
    assert.equal(rules['contract_parentContractId_fkey'], 'SET NULL',
      'contract.parentContractId FK must be ON DELETE SET NULL');
    assert.equal(rules['payment_paymentPlanId_fkey'], 'SET NULL',
      'payment.paymentPlanId FK must be ON DELETE SET NULL');
    assert.equal(rules['negotiation_customerId_fkey'], 'RESTRICT',
      'negotiation.customerId FK must be ON DELETE RESTRICT');
    assert.equal(rules['negotiation_negotiatorEmployeeId_fkey'], 'RESTRICT',
      'negotiation.negotiatorEmployeeId FK must be ON DELETE RESTRICT');
    assert.equal(rules['payment_contractId_fkey'], 'RESTRICT',
      'payment.contractId FK must be ON DELETE RESTRICT');
    assert.equal(rules['payment_plan_contractId_fkey'], 'RESTRICT',
      'payment_plan.contractId FK must be ON DELETE RESTRICT');
    assert.equal(rules['analysis_engagement_customerId_fkey'], 'RESTRICT',
      'analysis_engagement.customerId FK must be ON DELETE RESTRICT');
    assert.equal(rules['analysis_engagement_contractId_fkey'], 'RESTRICT',
      'analysis_engagement.contractId FK must be ON DELETE RESTRICT');
  } finally {
    await prisma.$disconnect();
  }
});
