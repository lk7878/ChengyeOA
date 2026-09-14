import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERMISSION_CODES,
  RESOURCE_CODES,
} from '../../app/domain/authorization/authorization-types';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';

// SPEC-011 Task 2: 财务运营域（开票/退款减免/成本/异常数据）权限目录 parity 契约测试。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/finance/permission-catalog-finance.test.ts
//
// 计数说明：SPEC-010 收敛后 PERMISSION_CODES 总数为 101（87 基线 + 14 净新增，
// contract.void/payment.confirm 占位就地升级）。本任务追加 17 个全新码，
// refund.approve 保持 SPECIAL/CRITICAL 既定治理语义原状不动（无晋升、无 UPDATE），
// 故总数 = 101 + 17 = 118；SPEC-013 Task 2 再追加 3 个审批中心码 → 121。

const NEW_RESOURCE_CODES = ['invoice', 'cost', 'anomaly'] as const;

const NEW_PERMISSION_CODES = [
  'menu.invoice',
  'menu.refund',
  'menu.cost',
  'menu.anomaly',
  'invoice.read',
  'invoice.create',
  'invoice.approve',
  'invoice.complete',
  'refund.read',
  'refund.create',
  'refund.execute',
  'payment.void',
  'cost.read',
  'cost.create',
  'cost.update',
  'cost.delete',
  'anomaly.read',
] as const;

const EXPECTED_ACTION_ENTRIES = {
  'invoice.read': { name: '查看开票', resource: 'invoice', action: 'read', riskLevel: 'LOW' },
  'invoice.create': { name: '创建开票申请', resource: 'invoice', action: 'create', riskLevel: 'MEDIUM' },
  'invoice.approve': { name: '审核开票', resource: 'invoice', action: 'approve', riskLevel: 'HIGH' },
  'invoice.complete': { name: '完成开票', resource: 'invoice', action: 'complete', riskLevel: 'MEDIUM' },
  'refund.read': { name: '查看退款减免', resource: 'refund', action: 'read', riskLevel: 'LOW' },
  'refund.create': { name: '创建退款减免申请', resource: 'refund', action: 'create', riskLevel: 'MEDIUM' },
  'refund.execute': { name: '执行退款减免', resource: 'refund', action: 'execute', riskLevel: 'HIGH' },
  'payment.void': { name: '冲销收款', resource: 'payment', action: 'void', riskLevel: 'HIGH' },
  'cost.read': { name: '查看成本', resource: 'cost', action: 'read', riskLevel: 'LOW' },
  'cost.create': { name: '记录成本', resource: 'cost', action: 'create', riskLevel: 'MEDIUM' },
  'cost.update': { name: '修改成本', resource: 'cost', action: 'update', riskLevel: 'MEDIUM' },
  'cost.delete': { name: '删除成本', resource: 'cost', action: 'delete', riskLevel: 'HIGH' },
  'anomaly.read': { name: '查看异常数据', resource: 'anomaly', action: 'read', riskLevel: 'LOW' },
} as const;

const EXPECTED_MENU_ENTRIES = {
  'menu.invoice': { name: '开票管理', route: '/invoices' },
  'menu.refund': { name: '退款减免', route: '/refunds' },
  'menu.cost': { name: '成本管理', route: '/costs' },
  'menu.anomaly': { name: '异常数据', route: '/anomalies' },
} as const;

// S15 双键 parity（本测试最高权重断言）：权限码 resource 字段必须与 Task 5/6/9
// 服务层 buildContractScopeWhere 调用的 resource 形参逐字一致。
const S15_RESOURCE_PARITY = {
  'invoice.read': 'invoice',
  'invoice.create': 'invoice',
  'invoice.approve': 'invoice',
  'invoice.complete': 'invoice',
  'refund.read': 'refund',
  'refund.create': 'refund',
  'refund.execute': 'refund',
  'refund.approve': 'refund',
  'cost.read': 'cost',
  'cost.create': 'cost',
  'cost.update': 'cost',
  'cost.delete': 'cost',
  'anomaly.read': 'anomaly',
  'payment.void': 'payment',
} as const;

test('RESOURCE_CODES registers the invoice/cost/anomaly resources and retains refund', () => {
  const resources = new Set(RESOURCE_CODES);
  for (const code of NEW_RESOURCE_CODES) {
    assert.ok(resources.has(code), `resource ${code} must be registered`);
  }
  assert.ok(resources.has('refund'), 'resource refund must remain registered (pre-existing since SPEC-001 baseline)');
});

test('PERMISSION_CODES registers every SPEC-011 finance permission code', () => {
  const codes = new Set(PERMISSION_CODES);
  for (const code of NEW_PERMISSION_CODES) {
    assert.ok(codes.has(code), `permission ${code} must be registered`);
  }
});

test('PERMISSION_CODES matches the current catalog baseline (146)', () => {
  assert.equal(PERMISSION_CODES.length, 146);
  assert.equal(new Set(PERMISSION_CODES).size, PERMISSION_CODES.length);
});

test('PERMISSION_CATALOG has no duplicate permission codes', () => {
  const codes = PERMISSION_CATALOG.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length, 'duplicate permission codes found in catalog');
});

test('PERMISSION_CATALOG registers a catalog entry for every SPEC-011 permission code', () => {
  const byCode = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));
  for (const code of NEW_PERMISSION_CODES) {
    const entry = byCode.get(code);
    assert.ok(entry, `${code} must have a catalog entry`);
  }
});

test('every SPEC-011 ACTION permission matches the pinned name/resource/action/riskLevel', () => {
  const byCode = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));
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

test('SPEC-011 MENU permissions route to the finance pages', () => {
  const byCode = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));
  for (const [code, expected] of Object.entries(EXPECTED_MENU_ENTRIES)) {
    const entry = byCode.get(code as keyof typeof EXPECTED_MENU_ENTRIES);
    assert.ok(entry, `${code} must have a catalog entry`);
    assert.equal(entry.type, 'MENU', `${code} must be a MENU permission`);
    assert.equal(entry.name, expected.name, `${code} name mismatch`);
    assert.equal(entry.resource, 'menu', `${code} must be on the menu resource`);
    assert.equal(entry.action, 'view', `${code} action must be view`);
    assert.equal(entry.riskLevel, 'LOW', `${code} riskLevel must be LOW`);
    assert.equal(entry.route, expected.route, `${code} route mismatch`);
  }
});

test('S15 resource parity: catalog resource keys match the service-layer scope resource arguments', () => {
  const byCode = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));
  for (const [code, expectedResource] of Object.entries(S15_RESOURCE_PARITY)) {
    const entry = byCode.get(code as keyof typeof S15_RESOURCE_PARITY);
    assert.ok(entry, `${code} must have a catalog entry`);
    assert.equal(entry.resource, expectedResource, `${code} resource must be '${expectedResource}' for S15 scope parity`);
  }
});

test('refund.approve stays an untouched SPECIAL/CRITICAL entry (no promotion in SPEC-011)', () => {
  const entry = PERMISSION_CATALOG.find((item) => item.code === 'refund.approve');
  assert.ok(entry, 'refund.approve must have a catalog entry');
  assert.equal(entry.type, 'SPECIAL', 'refund.approve type must remain SPECIAL');
  assert.equal(entry.riskLevel, 'CRITICAL', 'refund.approve riskLevel must remain CRITICAL');
  assert.equal(entry.name, '审批退款', 'refund.approve name must remain unchanged');
  assert.equal(entry.resource, 'refund', 'refund.approve resource must remain refund');
  assert.equal(entry.action, 'approve', 'refund.approve action must remain approve');
  assert.equal(entry.route, null, 'refund.approve must not declare a route');
});

test('PERMISSION_CATALOG length matches PERMISSION_CODES length (no orphan or missing entries)', () => {
  assert.equal(PERMISSION_CATALOG.length, PERMISSION_CODES.length);
  assert.deepEqual(
    [...PERMISSION_CATALOG.map((item) => item.code)].sort(),
    [...PERMISSION_CODES].sort(),
  );
});
