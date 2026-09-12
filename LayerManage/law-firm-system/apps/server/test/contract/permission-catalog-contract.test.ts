import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERMISSION_CODES,
  RESOURCE_CODES,
} from '../../app/domain/authorization/authorization-types';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';

// SPEC-010 Task 2: 权限类型与目录扩充（谈案/合同/收款）契约测试。
// 串行运行：npx tsx --test --test-concurrency=1 --test-force-exit test/contract/permission-catalog-contract.test.ts
//
// 计数说明：brief 的 87+16=103 基于"16 码全部为新码"的假设；实际上 contract.void /
// payment.confirm 在 SPEC-001 基线（20260718210000_authorization_expand）中已作为
// SPECIAL/CRITICAL 惰性占位码存在（与 customer.merge 同款先例）。这两个码在 SPEC-010
// 范围内被正式启用，故就地升级为 ACTION/HIGH 正式定义而非新增，净新增 14 码，
// PERMISSION_CODES 总数 = 87 + 14 = 101。
// SPEC-011 Task 2 追加 17 个财务运营码（refund.approve 保持 SPECIAL/CRITICAL 原状），
// 总数随之变为 101 + 17 = 118（见 test/finance/permission-catalog-finance.test.ts）；
// SPEC-013 Task 2 再追加 3 个审批中心码 → 121。

const NEW_RESOURCE_CODES = ['negotiation', 'contract', 'payment'] as const;

const NEW_PERMISSION_CODES = [
  'negotiation.read',
  'negotiation.create',
  'negotiation.update',
  'contract.read',
  'contract.create',
  'contract.submit',
  'contract.approve',
  'contract.sign',
  'contract.effect',
  'contract.terminate',
  'contract.void',
  'payment.read',
  'payment.create',
  'payment.confirm',
  'menu.contract',
  'menu.payment',
] as const;

// 自 SPEC-001 基线以 SPECIAL/CRITICAL 占位存在、本任务就地升级为正式定义的 2 个码。
const UPGRADED_PLACEHOLDER_CODES = ['contract.void', 'payment.confirm'] as const;

const EXPECTED_ACTION_ENTRIES = {
  'negotiation.read': { name: '查看谈案', resource: 'negotiation', action: 'read', riskLevel: 'LOW' },
  'negotiation.create': { name: '创建谈案', resource: 'negotiation', action: 'create', riskLevel: 'MEDIUM' },
  'negotiation.update': { name: '修改谈案', resource: 'negotiation', action: 'update', riskLevel: 'MEDIUM' },
  'contract.read': { name: '查看合同', resource: 'contract', action: 'read', riskLevel: 'LOW' },
  'contract.create': { name: '创建合同', resource: 'contract', action: 'create', riskLevel: 'MEDIUM' },
  'contract.submit': { name: '提交合同', resource: 'contract', action: 'submit', riskLevel: 'MEDIUM' },
  'contract.approve': { name: '审批合同', resource: 'contract', action: 'approve', riskLevel: 'HIGH' },
  'contract.sign': { name: '签署合同', resource: 'contract', action: 'sign', riskLevel: 'MEDIUM' },
  'contract.effect': { name: '合同生效', resource: 'contract', action: 'effect', riskLevel: 'HIGH' },
  'contract.terminate': { name: '终止合同', resource: 'contract', action: 'terminate', riskLevel: 'HIGH' },
  'contract.void': { name: '作废合同', resource: 'contract', action: 'void', riskLevel: 'HIGH' },
  'payment.read': { name: '查看收款', resource: 'payment', action: 'read', riskLevel: 'LOW' },
  'payment.create': { name: '创建收款', resource: 'payment', action: 'create', riskLevel: 'MEDIUM' },
  'payment.confirm': { name: '确认收款', resource: 'payment', action: 'confirm', riskLevel: 'HIGH' },
} as const;

const EXPECTED_MENU_ENTRIES = {
  'menu.contract': { name: '合同管理', route: '/contracts' },
  'menu.payment': { name: '收款管理', route: '/payments' },
} as const;

test('RESOURCE_CODES registers the negotiation/contract/payment resources', () => {
  const resources = new Set(RESOURCE_CODES);
  for (const code of NEW_RESOURCE_CODES) {
    assert.ok(resources.has(code), `resource ${code} must be registered`);
  }
});

test('PERMISSION_CODES registers every SPEC-010 negotiation/contract/payment permission code', () => {
  const codes = new Set(PERMISSION_CODES);
  for (const code of NEW_PERMISSION_CODES) {
    assert.ok(codes.has(code), `permission ${code} must be registered`);
  }
});

test('PERMISSION_CODES matches the V1.2 catalog baseline (144)', () => {
  assert.equal(PERMISSION_CODES.length, 144);
  assert.equal(new Set(PERMISSION_CODES).size, PERMISSION_CODES.length);
});

test('PERMISSION_CATALOG has no duplicate permission codes', () => {
  const codes = PERMISSION_CATALOG.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length, 'duplicate permission codes found in catalog');
});

test('PERMISSION_CATALOG registers a catalog entry for every SPEC-010 permission code', () => {
  const byCode = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));
  for (const code of NEW_PERMISSION_CODES) {
    const entry = byCode.get(code);
    assert.ok(entry, `${code} must have a catalog entry`);
  }
});

test('every SPEC-010 ACTION permission matches the pinned name/resource/action/riskLevel', () => {
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

test('SPEC-010 MENU permissions route to the contract/payment pages', () => {
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

test('contract.void / payment.confirm placeholders are promoted to live ACTION definitions', () => {
  const byCode = new Map(PERMISSION_CATALOG.map((item) => [item.code, item]));
  for (const code of UPGRADED_PLACEHOLDER_CODES) {
    const entry = byCode.get(code);
    assert.ok(entry, `${code} must have a catalog entry`);
    assert.equal(entry.type, 'ACTION', `${code} must be promoted from SPECIAL placeholder to ACTION`);
    assert.equal(entry.riskLevel, 'HIGH', `${code} must carry the SPEC-010 HIGH risk level`);
  }
});

test('PERMISSION_CATALOG length matches PERMISSION_CODES length (no orphan or missing entries)', () => {
  assert.equal(PERMISSION_CATALOG.length, PERMISSION_CODES.length);
  assert.deepEqual(
    [...PERMISSION_CATALOG.map((item) => item.code)].sort(),
    [...PERMISSION_CODES].sort(),
  );
});
