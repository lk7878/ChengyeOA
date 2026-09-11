import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CONTRACT_TEMPLATE_CATALOG } from '../../app/domain/contract/contract-template-catalog';

// SPEC-010 终审修复轮 F-3：contract_template 供给迁移与目录常量 parity 常驻契约。
// 沿 SPEC-009 F-1 EventSubscription parity 形态（test/db/spec-008-event-observability-migration-contract.test.ts:53-78）：
// 测试夹具逐用例自建模板行，从不暴露迁移真实供给——供给迁移改坏/漏同步时无闸门捕获，
// 直到 createContract 引用 templateCode 业务 400。本测试纯静态解析供给迁移 SQL（不起库），
// 双向钉死：
//   正向：目录每条目必须有对应 INSERT 行（code/contractType/version/enabled/createdBy 逐字段）；
//   反向：INSERT 行数必须等于目录长度（迁移新增模板未回录目录即红）。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/db/spec-010-contract-template-provision-contract.test.ts

const migrationsRoot = path.resolve('prisma/migrations');
const migrationName = '20260731090000_contract_template_provision';
const migrationPath = path.join(migrationsRoot, migrationName, 'migration.sql');
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

interface ProvisionedRow {
  code: string;
  contractType: string;
  version: number;
  enabled: boolean;
  createdBy: string;
}

/** 解析 INSERT INTO "contract_template" (...) VALUES (...), (...) 行：元组内无 ASCII 括号/逗号（正文为全角标点），逐列位置还原。 */
function parseProvisionedRows(migrationSql: string): ProvisionedRow[] {
  const insert = migrationSql.match(
    /INSERT\s+INTO\s+"contract_template"\s*\(([^)]*)\)\s*VALUES([\s\S]*?)\s*ON\s+CONFLICT/i,
  );
  assert.ok(insert, 'migration must contain an INSERT INTO "contract_template" ... ON CONFLICT statement');
  const columns = insert[1].split(',').map(column => column.trim().replaceAll('"', ''));
  const tuples = insert[2].match(/\(([^)]*)\)/g) ?? [];
  return tuples.map(tuple => {
    const values = tuple.slice(1, -1).split(',').map(value => value.trim());
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index]])) as Record<string, string>;
    return {
      code: unquote(row.code),
      contractType: unquote(row.contractType),
      version: Number(row.version),
      enabled: row.enabled === 'true',
      createdBy: unquote(row.createdBy),
    };
  });
}

function unquote(value: string): string {
  return value.replace(/^'|'$/g, '');
}

test('exactly one migration provisions contract_template rows, idempotently', () => {
  assert.ok(fs.existsSync(migrationPath), `migration ${migrationName} must exist`);
  const allMigrationSql = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const filePath = path.join(migrationsRoot, entry.name, 'migration.sql');
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    })
    .join('\n');
  const inserts = allMigrationSql.match(/INSERT\s+INTO\s+"contract_template"/gi) ?? [];
  assert.equal(inserts.length, 1, 'exactly one INSERT INTO "contract_template" across all migrations');
  assert.match(sql, /ON\s+CONFLICT\s*\("code"\)\s+DO\s+NOTHING/i, 'provisioning stays idempotent');
});

test('every catalog template is provisioned by the migration field-by-field', () => {
  const rows = parseProvisionedRows(sql);
  for (const entry of CONTRACT_TEMPLATE_CATALOG) {
    const provisioned = rows.find(row => row.code === entry.code);
    assert.ok(provisioned, `catalog template ${entry.code} must be provisioned by the migration`);
    assert.deepEqual(
      {
        code: provisioned.code,
        contractType: provisioned.contractType,
        version: provisioned.version,
        enabled: provisioned.enabled,
        createdBy: provisioned.createdBy,
      },
      {
        code: entry.code,
        contractType: entry.contractType,
        version: entry.version,
        enabled: entry.enabled,
        createdBy: entry.createdBy,
      },
      `provisioned row for ${entry.code} must equal the catalog entry field-by-field`,
    );
  }
});

test('the migration provisions exactly the catalog rows (no unrecorded templates)', () => {
  const rows = parseProvisionedRows(sql);
  assert.equal(
    rows.length,
    CONTRACT_TEMPLATE_CATALOG.length,
    'a provisioned template missing from the catalog must turn this test red',
  );
});
