import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  PERMISSION_CODES,
  RESOURCE_CODES,
} from '../../app/domain/authorization/authorization-types';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import {
  assertTestDatabaseUrl,
  createTestPrisma,
} from '../helpers/test-database';

// SPEC-013 Task 2: 审批中心权限目录 parity 契约测试。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/approval/permission-catalog-approval.test.ts
//
// 计数说明：SPEC-011 收敛后 PERMISSION_CODES 总数为 118。本任务追加 3 个全新审批中心码
// （approval.read/apply/process，resource='approval'），refund.approve 等既有码零改动，
// 故总数 = 118 + 3 = 121。
//
// 四处一致断言：catalog（permission-catalog.ts）↔ PERMISSION_CODES/RESOURCE_CODES
// （authorization-types.ts）↔ provisioning 迁移（migration.sql）↔ 前端镜像
// （apps/web/src/features/authorization/types.ts）。
// Definition 种子直查：静态解析迁移 INSERT 行（沿 SPEC-010 contract-template-provision-contract
// 形态）逐字段钉死；并重新执行幂等 INSERT 后经 Prisma 直查 approval_definition 5 行。

const migrationsRoot = path.resolve('prisma/migrations');
const migrationName = '20260801120000_approval_provision';
const migrationPath = path.join(migrationsRoot, migrationName, 'migration.sql');
const migrationSql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

const webTypesPath = path.resolve('../../apps/web/src/features/authorization/types.ts');
const webTypesSql = fs.existsSync(webTypesPath) ? fs.readFileSync(webTypesPath, 'utf8') : '';

const NEW_PERMISSION_CODES = [
  'approval.read',
  'approval.apply',
  'approval.process',
] as const;

const EXPECTED_ACTION_ENTRIES = {
  'approval.read': { name: '查看审批中心', resource: 'approval', action: 'read', riskLevel: 'LOW' },
  'approval.apply': { name: '发起审批申请', resource: 'approval', action: 'apply', riskLevel: 'MEDIUM' },
  'approval.process': { name: '处理审批任务', resource: 'approval', action: 'process', riskLevel: 'HIGH' },
} as const;

// S15 双键 parity：权限码 resource 字段必须与 Task 5/6/8 服务层 scope resource 形参逐字一致。
const S15_RESOURCE_PARITY = {
  'approval.read': 'approval',
  'approval.apply': 'approval',
  'approval.process': 'approval',
} as const;

const EXPECTED_DEFINITIONS = {
  LEAVE: {
    name: '请假申请',
    businessType: 'LEAVE',
    approverRule: { type: 'ROLE', roleCodes: ['HR'] },
  },
  SEAL: {
    name: '用印申请',
    businessType: 'SEAL',
    approverRule: { type: 'ROLE', roleCodes: ['SEAL_ADMIN'] },
  },
  EXPENSE: {
    name: '费用报销',
    businessType: 'EXPENSE',
    approverRule: { type: 'ROLE', roleCodes: ['FINANCE'] },
  },
  CONTRACT_CHANGE: {
    name: '合同变更',
    businessType: 'CONTRACT_CHANGE',
    approverRule: { type: 'ROLE', roleCodes: ['PARTNER'] },
  },
  TRANSFER: {
    name: '转所申请',
    businessType: 'TRANSFER',
    approverRule: { type: 'ROLE', roleCodes: ['HR'] },
  },
} as const;

// ---------- SQL VALUES 解析工具（兼容 gen_random_uuid() 内层括号与 JSON 引号内逗号） ----------

function extractInsertValues(migrationSql: string, tableName: string): { columns: string[]; tuples: string[] } {
  const insert = migrationSql.match(
    new RegExp(`INSERT\\s+INTO\\s+"${tableName}"\\s*\\(([^)]*)\\)\\s*VALUES([\\s\\S]*?)\\s*ON\\s+CONFLICT`, 'i'),
  );
  assert.ok(insert, `migration must contain an INSERT INTO "${tableName}" ... ON CONFLICT statement`);
  const columns = insert[1].split(',').map(column => column.trim().replaceAll('"', ''));
  const tuples = extractTopLevelTuples(insert[2]);
  return { columns, tuples };
}

function extractTopLevelTuples(valuesClause: string): string[] {
  const tuples: string[] = [];
  let depth = 0;
  let inString = false;
  let start = -1;
  for (let i = 0; i < valuesClause.length; i += 1) {
    const ch = valuesClause[i];
    if (inString) {
      if (ch === "'") {
        if (valuesClause[i + 1] === "'") i += 1;
        else inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === '(') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesClause.slice(start + 1, i));
        start = -1;
      }
    }
  }
  return tuples;
}

function splitTupleValues(tuple: string): string[] {
  const values: string[] = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < tuple.length; i += 1) {
    const ch = tuple[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (tuple[i + 1] === "'") {
          current += "'";
          i += 1;
        } else {
          inString = false;
        }
      }
    } else if (ch === "'") {
      inString = true;
      current += ch;
    } else if (ch === ',') {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) values.push(current.trim());
  return values;
}

function unquote(value: string): string {
  return value.replace(/^'|'$/g, '');
}

function rowsFor(migrationSql: string, tableName: string): Array<Record<string, string>> {
  const { columns, tuples } = extractInsertValues(migrationSql, tableName);
  return tuples.map(tuple => {
    const values = splitTupleValues(tuple).map(unquote);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
}

// ---------- 权限目录 parity ----------

test('RESOURCE_CODES registers the approval resource', () => {
  const resources = new Set(RESOURCE_CODES);
  assert.ok(resources.has('approval'), 'resource approval must be registered');
});

test('PERMISSION_CODES registers every SPEC-013 approval permission code', () => {
  const codes = new Set(PERMISSION_CODES);
  for (const code of NEW_PERMISSION_CODES) {
    assert.ok(codes.has(code), `permission ${code} must be registered`);
  }
});

test('PERMISSION_CODES matches the V1.2 catalog baseline (145)', () => {
  assert.equal(PERMISSION_CODES.length, 145);
  assert.equal(new Set(PERMISSION_CODES).size, PERMISSION_CODES.length);
});

test('PERMISSION_CATALOG has no duplicate permission codes', () => {
  const codes = PERMISSION_CATALOG.map(item => item.code);
  assert.equal(new Set(codes).size, codes.length, 'duplicate permission codes found in catalog');
});

test('PERMISSION_CATALOG registers a catalog entry for every SPEC-013 approval permission code', () => {
  const byCode = new Map(PERMISSION_CATALOG.map(item => [item.code, item]));
  for (const code of NEW_PERMISSION_CODES) {
    const entry = byCode.get(code);
    assert.ok(entry, `${code} must have a catalog entry`);
  }
});

test('every SPEC-013 approval ACTION permission matches the pinned name/resource/action/riskLevel', () => {
  const byCode = new Map(PERMISSION_CATALOG.map(item => [item.code, item]));
  for (const [code, expected] of Object.entries(EXPECTED_ACTION_ENTRIES)) {
    const entry = byCode.get(code as keyof typeof EXPECTED_ACTION_ENTRIES);
    assert.ok(entry, `${code} must have a catalog entry`);
    assert.equal(entry.type, 'ACTION', `${code} must be an ACTION permission`);
    assert.equal(entry.name, expected.name, `${code} name mismatch`);
    assert.equal(entry.resource, expected.resource, `${code} resource mismatch`);
    assert.equal(entry.action, expected.action, `${code} action mismatch`);
    assert.equal(entry.riskLevel, expected.riskLevel, `${code} riskLevel mismatch`);
    assert.equal(entry.route, null, `${code} ACTION permission must not declare a route`);
  }
});

test('S15 resource parity: catalog resource keys match the service-layer scope resource arguments', () => {
  const byCode = new Map(PERMISSION_CATALOG.map(item => [item.code, item]));
  for (const [code, expectedResource] of Object.entries(S15_RESOURCE_PARITY)) {
    const entry = byCode.get(code as keyof typeof S15_RESOURCE_PARITY);
    assert.ok(entry, `${code} must have a catalog entry`);
    assert.equal(entry.resource, expectedResource, `${code} resource must be '${expectedResource}' for S15 scope parity`);
  }
});

// ---------- provisioning 迁移 parity ----------

test('the approval provision migration inserts approval permission + definition rows idempotently', () => {
  assert.ok(fs.existsSync(migrationPath), `migration ${migrationName} must exist`);
  const allMigrationSql = fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const filePath = path.join(migrationsRoot, entry.name, 'migration.sql');
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    })
    .join('\n');
  const permissionInserts = allMigrationSql.match(/INSERT\s+INTO\s+"permission"/gi) ?? [];
  const approvalInserts = allMigrationSql.match(/INSERT\s+INTO\s+"approval_definition"/gi) ?? [];
  assert.ok(permissionInserts.length >= 1, 'at least one migration INSERTs approval permission rows');
  assert.equal(approvalInserts.length, 1, 'exactly one migration INSERTs approval_definition rows');
  assert.match(migrationSql, /ON\s+CONFLICT\s*\("code"\)\s+DO\s+NOTHING/i, 'provisioning stays idempotent');
});

test('migration permission INSERT rows match the catalog field-by-field', () => {
  const rows = rowsFor(migrationSql, 'permission');
  const permissionRows = rows.filter(row => row.code.startsWith('approval.'));
  assert.equal(permissionRows.length, 3, 'exactly 3 approval permission rows provisioned');
  for (const code of NEW_PERMISSION_CODES) {
    const row = permissionRows.find(item => item.code === code);
    assert.ok(row, `${code} must be provisioned by the migration`);
    assert.equal(row.id, `permission:${code}`, `${code} id must be permission:${code} for bootstrap catalog parity`);
    const catalogEntry = PERMISSION_CATALOG.find(item => item.code === code);
    assert.ok(catalogEntry, `${code} must have a catalog entry`);
    assert.equal(row.name, catalogEntry.name, `${code} name mismatch`);
    assert.equal(row.resource, catalogEntry.resource, `${code} resource mismatch`);
    assert.equal(row.action, catalogEntry.action, `${code} action mismatch`);
    assert.equal(row.riskLevel, catalogEntry.riskLevel, `${code} riskLevel mismatch`);
    assert.equal(row.type, catalogEntry.type, `${code} type mismatch`);
    assert.equal(row.status, 'ENABLED', `${code} status must be ENABLED (catalog status)`);
  }
});

// ---------- Definition 种子（静态迁移解析 + DB 直查） ----------

test('migration approval_definition INSERT provisions exactly 5 seed rows field-by-field', () => {
  const rows = rowsFor(migrationSql, 'approval_definition');
  assert.equal(rows.length, 5, 'exactly 5 definition seed rows provisioned');
  for (const [code, expected] of Object.entries(EXPECTED_DEFINITIONS)) {
    const row = rows.find(item => item.code === code);
    assert.ok(row, `definition ${code} must be provisioned by the migration`);
    assert.equal(row.name, expected.name, `${code} name mismatch`);
    assert.equal(row.businessType, expected.businessType, `${code} businessType mismatch`);
    assert.deepEqual(JSON.parse(row.approverRule), expected.approverRule, `${code} approverRule mismatch`);
    assert.equal(row.version, '1', `${code} version must be 1`);
    assert.equal(row.status, 'ACTIVE', `${code} status must be ACTIVE`);
    assert.equal(row.createdBy, '00000000-0000-0000-0000-000000000000', `${code} createdBy must be the system zero id`);
    assert.ok(row.formSchema.startsWith('{"fields":['), `${code} formSchema must be a fields schema`);
  }
});

test('approval_definition seed rows are directly queryable (reset, count=5, field-by-field)', async () => {
  assertTestDatabaseUrl();
  const prisma = createTestPrisma();
  try {
    // 重新执行幂等 INSERT（ON CONFLICT DO NOTHING），确保直查不依赖此前是否被
    // clearTestApplicationData TRUNCATE；同时验证迁移 SQL 可在目标库真实执行。
    const { tuples } = extractInsertValues(migrationSql, 'approval_definition');
    const columnsSql = `"id", "code", "name", "businessType", "formSchema", "approverRule", "version", "status", "createdBy", "createdAt", "updatedAt"`;
    const insertSql = `INSERT INTO "approval_definition" (${columnsSql}) VALUES\n  ${tuples.map(tuple => `(${tuple})`).join(',\n  ')}\nON CONFLICT ("code") DO NOTHING;`;
    await prisma.$executeRawUnsafe(insertSql);

    const rows = await prisma.approvalDefinition.findMany({ orderBy: { code: 'asc' } });
    assert.equal(rows.length, 5, 'approval_definition must contain exactly 5 seed rows');
    const byCode = new Map(rows.map(row => [row.code, row]));
    for (const [code, expected] of Object.entries(EXPECTED_DEFINITIONS)) {
      const row = byCode.get(code);
      assert.ok(row, `definition ${code} must be directly queryable`);
      assert.equal(row.name, expected.name, `${code} name mismatch`);
      assert.equal(row.businessType, expected.businessType, `${code} businessType mismatch`);
      assert.deepEqual(row.approverRule, expected.approverRule, `${code} approverRule mismatch`);
      assert.equal(row.status, 'ACTIVE', `${code} status mismatch`);
    }
  } finally {
    await prisma.$disconnect();
  }
});

// ---------- 前端镜像 parity ----------

test('frontend types.ts mirrors the 3 SPEC-013 approval permission codes', () => {
  assert.ok(fs.existsSync(webTypesPath), 'apps/web/src/features/authorization/types.ts must exist');
  for (const code of NEW_PERMISSION_CODES) {
    assert.ok(webTypesSql.includes(`'${code}'`), `frontend types.ts must include ${code}`);
  }
});

test('PERMISSION_CATALOG length matches PERMISSION_CODES length (no orphan or missing entries)', () => {
  assert.equal(PERMISSION_CATALOG.length, PERMISSION_CODES.length);
  assert.deepEqual(
    [...PERMISSION_CATALOG.map(item => item.code)].sort(),
    [...PERMISSION_CODES].sort(),
  );
});
