import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { InventoryService } from '../../app/application/inventory/inventory-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
let db: PrismaClient, service: InventoryService, userId: string, employeeId: string;
const permissions: PermissionCode[] = ['inventory.read', 'inventory.manage', 'inventory.inbound', 'inventory.outbound', 'inventory.stocktake', 'inventory.export'];
function context(codes = permissions): AuthorizationContext { return { userId, employeeId: null, isSystemSuperAdmin: false, isSystemAdmin: false, grants: [], permissionCodes: codes, fieldRules: [], evaluatedAt: new Date() }; }
test.before(() => { db = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  userId = (await db.user.create({ data: { username: 'inventory-' + randomUUID(), password: 'test-only' } })).id;
  const rootId = randomUUID(), deptId = randomUUID();
  await db.organization.create({ data: { id: rootId, code: 'ROOT', name: '重庆承业律师事务所', type: 'FIRM', path: '/' + rootId } });
  await db.organization.create({ data: { id: deptId, code: 'LAW', name: '律师部', type: 'DEPARTMENT', parentId: rootId, path: '/' + rootId + '/' + deptId, level: 1 } });
  const position = await db.position.create({ data: { code: 'LAWYER', name: '律师', categoryCode: 'LEGAL', organizationId: deptId } });
  employeeId = (await db.employee.create({ data: { employeeNo: 'EMP01', name: '测试员工', phone: '13800000000', type: 'LAWYER', entryDate: new Date('2026-01-01') } })).id;
  await db.employeeAssignment.create({ data: { employeeId, organizationId: deptId, positionId: position.id, assignmentType: 'PRIMARY', startedAt: new Date('2026-01-01') } });
  service = new InventoryService(db, { actorUserId: userId }, context());
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });
const date = '2026-09-11';
const itemInput = { name: '中性笔', kind: 'OFFICE', category: '书写用品', unit: '支', minimumStock: '2' };
async function fixture(q = '10') {
  const item = await service.saveItem(itemInput);
  await service.move({ action: 'INBOUND', itemId: item.id, version: item.version, quantity: q, occurredAt: date, source: '供应商', idempotencyKey: randomUUID() });
  return db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
}
test('Chinese item starts at zero, inbound and issue share one exact balance and historical identity', async () => {
  const item = await fixture('10.125');
  const issue = await service.move({ action: 'OUTBOUND', itemId: item.id, version: item.version, quantity: '3.025', employeeId, reason: '日常办公', occurredAt: date, idempotencyKey: randomUUID() });
  assert.equal(issue.afterStock.toFixed(3), '7.100');
  assert.equal(issue.organizationPath, '重庆承业律师事务所/律师部');
  await db.employee.update({ where: { id: employeeId }, data: { name: '新名字' } });
  assert.equal((await db.inventoryMovement.findUniqueOrThrow({ where: { id: issue.id } })).employeeName, '测试员工');
  const records = await service.list({ view: 'movements', kind: 'OFFICE', action: 'OUTBOUND' });
  assert.ok('list' in records); assert.equal(records.total, 1); assert.equal(records.list[0].id, issue.id);
  assert.equal('requestHash' in records.list[0], false);
  const stats = await service.list({ view: 'statistics', kind: 'OFFICE', groupBy: 'organization', from: date, to: date });
  assert.ok('list' in stats); assert.equal(stats.total, 1); assert.ok('quantity' in stats.list[0]); assert.equal(stats.list[0].quantity, '3.025');
});
test('repeated requests replay once; changed content on the same key is rejected', async () => {
  const item = await fixture();
  const input = { action: 'OUTBOUND', itemId: item.id, version: item.version, quantity: '3', employeeId, reason: '办公', occurredAt: date, idempotencyKey: randomUUID() };
  const [a, b] = await Promise.all([service.move(input), service.move(input)]);
  assert.equal(a.id, b.id); assert.equal(await db.inventoryMovement.count({ where: { action: 'OUTBOUND' } }), 1);
  await assert.rejects(service.move({ ...input, quantity: '4' }), { code: 'INVENTORY_KEY_CONFLICT' });
});
test('concurrent issues cannot oversell and stale versions cannot overwrite new stock', async () => {
  const item = await fixture('5');
  const input = { action: 'OUTBOUND', itemId: item.id, version: item.version, quantity: '4', employeeId, reason: '办公', occurredAt: date };
  const results = await Promise.allSettled([service.move({ ...input, idempotencyKey: randomUUID() }), service.move({ ...input, idempotencyKey: randomUUID() })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const fresh = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } }); assert.equal(fresh.stock.toFixed(3), '1.000');
  await assert.rejects(service.move({ ...input, version: fresh.version, idempotencyKey: randomUUID() }), { code: 'INVENTORY_INSUFFICIENT' });
  assert.equal(await db.inventoryMovement.count({ where: { action: 'OUTBOUND' } }), 1);
});
test('stocktake records exact differences, requires reasons and is idempotent even for zero difference', async () => {
  const item = await fixture('7');
  const input = { itemId: item.id, version: item.version, actualStock: '6', occurredAt: date, idempotencyKey: randomUUID() };
  await assert.rejects(service.stocktake(input), { code: 'INVENTORY_REASON_REQUIRED' });
  const row = await service.stocktake({ ...input, reason: '损耗核实' });
  assert.equal(row.difference.toFixed(3), '-1.000'); assert.equal((await service.stocktake({ ...input, reason: '损耗核实' })).id, row.id);
  await assert.rejects(service.stocktake({ ...input, idempotencyKey: randomUUID(), actualStock: '8', reason: '旧数据' }), { code: 'VERSION_CONFLICT' });
  const current = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
  const same = await service.stocktake({ itemId: item.id, version: current.version, actualStock: '6', occurredAt: date, idempotencyKey: randomUUID() });
  assert.equal(same.difference.toFixed(3), '0.000'); assert.equal(await db.inventoryStocktake.count(), 2); assert.equal(await db.inventoryMovement.count({ where: { action: 'ADJUST' } }), 1);
});
test('disabled goods, historical units and inactive recipients are protected', async () => {
  const item = await fixture();
  await assert.rejects(service.saveItem({ ...itemInput, unit: '盒', version: item.version }, item.id), { code: 'INVENTORY_UNIT_FROZEN' });
  const stopped = await service.saveItem({ ...itemInput, version: item.version, status: 'DISABLED' }, item.id);
  await assert.rejects(service.move({ action: 'INBOUND', itemId: item.id, version: stopped.version, quantity: 1, occurredAt: date, idempotencyKey: randomUUID() }), { code: 'INVENTORY_DISABLED' });
  const restored = await service.saveItem({ ...itemInput, version: stopped.version }, item.id);
  await db.employee.update({ where: { id: employeeId }, data: { status: 'LEAVED' } });
  assert.equal((await service.recipients()).length, 0);
  await assert.rejects(service.move({ action: 'OUTBOUND', itemId: item.id, version: restored.version, quantity: 1, employeeId, reason: '办公', occurredAt: date, idempotencyKey: randomUUID() }), { code: 'INVENTORY_RECIPIENT_INVALID' });
});
test('permissions protect mutations, recipient details and export independently', async () => {
  const reader = new InventoryService(db, { actorUserId: userId }, context(['inventory.read']));
  await assert.rejects(reader.saveItem(itemInput)); await assert.rejects(reader.recipients()); await assert.rejects(reader.export({ view: 'items' }));
  const none = new InventoryService(db, { actorUserId: userId }, context([])); await assert.rejects(none.list({ view: 'items' }));
  const people = await service.recipients('测试'); assert.equal(people.length, 1); assert.equal('phone' in people[0], false); assert.equal('idCard' in people[0], false);
});
test('filtered exports preserve Chinese headers and neutralize spreadsheet formulas', async () => {
  await service.saveItem({ ...itemInput, name: '=HYPERLINK(123)', kind: 'CUSTOMIZED' });
  const csv = await service.export({ view: 'items', kind: 'CUSTOMIZED' }); assert.match(csv.csv, /物品名称/); assert.match(csv.csv, /定制物品/); assert.match(csv.csv, /'=HYPERLINK/);
  const item = await fixture(); await service.move({ action: 'OUTBOUND', itemId: item.id, version: item.version, quantity: 1, employeeId, reason: '办公', occurredAt: date, idempotencyKey: randomUUID() });
  const report = await service.list({ view: 'dashboard', from: date, to: date }); assert.ok('outboundCount' in report); assert.equal(report.outboundCount, 1); assert.equal(report.inboundCount, 1);
  const empty = await service.list({ view: 'statistics', from: '2026-09-12', to: '2026-09-12' }); assert.ok('total' in empty); assert.equal(empty.total, 0);
});
test('zero, negative and excessive precision cannot alter stock', async () => {
  const item = await fixture();
  for (const quantity of ['0', '-1', '1.0001', '1000000000000000']) await assert.rejects(service.move({ action: 'INBOUND', itemId: item.id, version: item.version, quantity, occurredAt: date, idempotencyKey: randomUUID() }), { code: 'INVENTORY_QUANTITY_INVALID' });
  assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock.toFixed(3), '10.000');
});

test('statistics keep one identity across renames while detail retains its original snapshot', async () => {
  let item = await fixture();
  const input = { action: 'OUTBOUND', itemId: item.id, quantity: '1', employeeId, reason: '办公', occurredAt: date };
  await service.move({ ...input, version: item.version, idempotencyKey: randomUUID() });
  item = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
  item = await service.saveItem({ ...itemInput, name: '新名称', version: item.version }, item.id);
  await db.employee.update({ where: { id: employeeId }, data: { name: '新姓名' } });
  await service.move({ ...input, version: item.version, idempotencyKey: randomUUID() });
  const result = await service.list({ view: 'statistics', groupBy: 'employee' });
  assert.ok('list' in result); assert.equal(result.total, 1); const row = result.list[0];
  assert.ok('quantity' in row); assert.equal(row.quantity, '2.000'); assert.equal(row.itemName, '新名称'); assert.equal(row.employeeName, '新姓名');
});

test('audit failure rolls back the balance and movement together', async () => {
  const item = await fixture();
  await db.$executeRawUnsafe(`CREATE FUNCTION inventory_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'INVENTORY_OUTBOUND' THEN RAISE EXCEPTION 'test audit unavailable'; END IF; RETURN NEW; END; $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER inventory_test_audit_failure BEFORE INSERT ON operation_log FOR EACH ROW EXECUTE FUNCTION inventory_test_audit_failure()');
  try {
    await assert.rejects(service.move({ action: 'OUTBOUND', itemId: item.id, version: item.version, quantity: '3', employeeId, reason: '办公', occurredAt: date, idempotencyKey: randomUUID() }));
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock.toFixed(3), '10.000');
    assert.equal(await db.inventoryMovement.count({ where: { action: 'OUTBOUND' } }), 0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER inventory_test_audit_failure ON operation_log');
    await db.$executeRawUnsafe('DROP FUNCTION inventory_test_audit_failure()');
  }
});
