import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { withFailingCollaborationOutbox } from '../helpers/collaboration-outbox-failure';

let db: PrismaClient, svc: CollaborationService, base: string, org: string, user: string, employee: string;
const code = (name: string) => (error: unknown) => (error as { code?: string }).code === name;
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = key();
  await db.organization.create({
    data: { id: org, code: org, name: '表格测试', type: 'FIRM', path: '/' + org },
  });
  employee = (
    await db.employee.create({
      data: {
        employeeNo: key(),
        name: '测试员工',
        phone: '13800000000',
        type: 'LAWYER',
        status: 'FORMAL',
        entryDate: new Date('2020-01-01'),
      },
    })
  ).id;
  const position = await db.position.create({
    data: { code: key(), name: '律师', organizationId: org, categoryCode: 'LAWYER' },
  });
  await db.employeeAssignment.create({
    data: {
      employeeId: employee,
      organizationId: org,
      positionId: position.id,
      assignmentType: 'PRIMARY',
      startedAt: new Date('2020-01-01'),
    },
  });
  user = (await db.user.create({ data: { username: key(), password: 'unused', employeeId: employee } })).id;
  const ctx: AuthorizationContext = {
    userId: user,
    employeeId: employee,
    isSystemSuperAdmin: true,
    isSystemAdmin: false,
    evaluatedAt: new Date(),
    permissionCodes: PERMISSION_CATALOG.map((p) => p.code),
    grants: PERMISSION_CATALOG.map((p) => ({
      sourceType: 'ROLE',
      sourceId: 'fixture',
      permissionCode: p.code,
      resource: p.resource,
      scopeIds: ['ALL'],
      validUntil: null,
    })),
    fieldRules: [],
  };
  svc = new CollaborationService(db, ctx);
  const workspace = await svc.createWorkspace({ name: '工作区', organizationId: org }, key());
  base = (await svc.createBase(workspace.id, { name: '业务表格' }, key())).id;
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
test('deleting a business worksheet keeps canonical customers and removes only its extensions', async () => {
  const customer = await seed('CUSTOMERS');
  const table = await svc.createTable(base, { name: '客户工作表', source: 'CUSTOMERS' }, key());
  await db.collabExtension.create({
    data: { tableId: table.id, recordId: customer, values: { note: 'extension' }, updatedBy: user },
  });
  await svc.mutateTable(table.id, { remove: true, version: 1 }, key());
  assert.ok(await db.customer.findUnique({ where: { id: customer } }));
  assert.equal(await db.collabExtension.count({ where: { tableId: table.id } }), 0);
  const reconnected = await svc.createTable(base, { name: '客户工作表', source: 'CUSTOMERS' }, key());
  assert.equal((await svc.query(reconnected.id, {})).records[0].id, customer);
});
async function seed(source: string) {
  const customer = await db.customer.create({
    data: { customerNo: key(), name: '原客户', phone: '13800000000', phoneHash: key(), createdBy: user },
  });
  if (source === 'CUSTOMERS') return customer.id;
  if (source === 'NEGOTIATIONS')
    return (
      await db.negotiation.create({
        data: {
          negotiationNo: key(),
          customerId: customer.id,
          negotiatorEmployeeId: employee,
          branchId: org,
          quotedAmount: '100.00',
          createdBy: user,
        },
      })
    ).id;
  if (source === 'CHANNELS')
    return (
      await db.channel.create({
        data: { code: key(), name: '原渠道', type: 'OTHER', branchId: org, createdBy: user },
      })
    ).id;
  if (source === 'COSTS')
    return (
      await db.costEntry.create({
        data: { category: 'OFFICE', amount: '100.00', occurredAt: new Date(), createdBy: user },
      })
    ).id;
  if (source === 'PERFORMANCES')
    return (
      await db.performance.create({
        data: { employeeId: employee, period: '2026-10', type: 'MONTHLY', kpiData: '{}', createdBy: user },
      })
    ).id;
  return (
    await db.inventoryItem.create({
      data: { code: key(), name: '原物品', kind: 'OFFICE', category: '文具', unit: '支', createdBy: user },
    })
  ).id;
}
async function table(source: string) {
  const id = (await svc.createTable(base, { name: source, source }, key())).id;
  const detail = await svc.describe(id);
  const fields = Object.fromEntries(
    detail.fields.map((f) => [String((f.options as { businessKey?: string }).businessKey), f.id]),
  );
  return { id, detail, fields };
}
for (const [source, field, value] of [
  ['CUSTOMERS', 'name', '修改客户'],
  ['NEGOTIATIONS', 'quotedAmount', '200.50'],
  ['CHANNELS', 'name', '修改渠道'],
  ['COSTS', 'amount', '300.50'],
  ['INVENTORY_ITEMS', 'name', '修改物品'],
  ['PERFORMANCES', 'goal', '修改考核目标'],
])
  test(`${source} inline edit writes canonical data, is idempotent and rejects stale/protected writes`, async () => {
    const t = await table(source),
      id = await seed(source);
    assert.equal(t.detail.fields.find((f) => f.id === t.fields[field])?.writable, true);
    const input = { schemaVersion: 1, version: 1, values: { [t.fields[field]]: value } },
      mutation = key();
    const result = await svc.saveRecord(t.id, id, input, mutation);
    assert.equal(result.version, 2);
    assert.deepEqual(await svc.saveRecord(t.id, id, input, mutation), result);
    assert.equal((await svc.record(t.id, id)).record.values[t.fields[field]], value);
    assert.equal(await db.collabRecord.count({ where: { tableId: t.id } }), 0);
    await assert.rejects(svc.saveRecord(t.id, id, input, key()), code('COLLAB_RECORD_CONFLICT'));
    const protectedField = t.detail.fields.find((f) => !f.writable)!;
    await assert.rejects(
      svc.saveRecord(t.id, id, { ...input, version: 2, values: { [protectedField.id]: '伪造' } }, key()),
    );
    const denied = new CollaborationService(db, {
      ...svc.actor,
      permissionCodes: svc.actor.permissionCodes.filter(
        (p) =>
          ![
            'customer.update',
            'negotiation.update',
            'channel.update',
            'cost.update',
            'inventory.manage',
            'performance.update',
          ].includes(p),
      ),
    });
    await assert.rejects(
      denied.saveRecord(t.id, id, { ...input, version: 2 }, key()),
      code('COLLAB_FORBIDDEN'),
    );
  });
test('negotiation amount can be cleared; completed negotiations and invalid amounts cannot be edited', async () => {
  const t = await table('NEGOTIATIONS'),
    id = await seed('NEGOTIATIONS');
  const input = { schemaVersion: 1, version: 1, values: { [t.fields.quotedAmount]: null } };
  await svc.saveRecord(t.id, id, input, key());
  assert.equal((await db.negotiation.findUniqueOrThrow({ where: { id } })).quotedAmount, null);
  await assert.rejects(
    svc.saveRecord(t.id, id, { ...input, version: 2, values: { [t.fields.quotedAmount]: '-1' } }, key()),
    code('VALIDATION_FAILED'),
  );
  await db.negotiation.update({ where: { id }, data: { status: 'SIGNED' } });
  assert.equal((await svc.record(t.id, id)).record.writable, false);
  await assert.rejects(
    svc.saveRecord(t.id, id, { ...input, version: 2 }, key()),
    code('CONTRACT_STATE_TRANSITION_INVALID'),
  );
});
test('mixed customer fields and extensions roll back together when collaboration event fails', async () => {
  const t = await table('CUSTOMERS'),
    id = await seed('CUSTOMERS');
  const extra = await svc.saveField(t.id, undefined, { name: '备注', type: 'TEXT', version: 1 }, key());
  const schema = (await svc.describe(t.id)).table.schemaVersion;
  await assert.rejects(
    withFailingCollaborationOutbox(db, async () => {
      await svc.saveRecord(
        t.id,
        id,
        {
          schemaVersion: schema,
          version: 1,
          values: { [t.fields.name]: '不应保存', [extra.id]: '不应保存' },
        },
        key(),
      );
    }),
  );
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id } })).name, '原客户');
  assert.equal(await db.collabExtension.count({ where: { tableId: t.id } }), 0);
});
test('batch customer changes roll back on a later record version conflict', async () => {
  const t = await table('CUSTOMERS'),
    first = await seed('CUSTOMERS'),
    second = await seed('CUSTOMERS');
  await assert.rejects(
    svc.saveRecords(
      t.id,
      {
        schemaVersion: 1,
        records: [
          { id: first, version: 1, values: { [t.fields.name]: '不应保存' } },
          { id: second, version: 99, values: { [t.fields.name]: '不应保存' } },
        ],
      },
      key(),
    ),
    code('COLLAB_RECORD_CONFLICT'),
  );
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: first } })).name, '原客户');
});
test('customer inline editing respects reader role, field restrictions and masked phone values', async () => {
  const t = await table('CUSTOMERS'),
    id = await seed('CUSTOMERS');
  const other = await db.user.create({ data: { username: key(), password: 'unused' } });
  const workspaceId = (await db.collabBase.findUniqueOrThrow({ where: { id: base } })).workspaceId;
  const member = await db.collabMember.create({
    data: { workspaceId, principalId: other.id, role: 'READER', rowScope: 'ALL' },
  });
  const editor = new CollaborationService(db, {
    ...svc.actor,
    userId: other.id,
    employeeId: null,
    isSystemSuperAdmin: false,
  });
  const input = { schemaVersion: 1, version: 1, values: { [t.fields.name]: '新名称' } };
  await assert.rejects(editor.saveRecord(t.id, id, input, key()), code('COLLAB_FORBIDDEN'));
  await db.collabMember.update({
    where: { id: member.id },
    data: { role: 'EDITOR', readonlyFields: [t.fields.name] },
  });
  assert.equal((await editor.describe(t.id)).fields.find((f) => f.id === t.fields.name)?.writable, false);
  await assert.rejects(editor.saveRecord(t.id, id, input, key()), code('COLLAB_FIELD_UNAVAILABLE'));
  await db.collabMember.update({ where: { id: member.id }, data: { readonlyFields: [] } });
  assert.equal((await editor.describe(t.id)).fields.find((f) => f.id === t.fields.phone)?.writable, false);
  await assert.rejects(
    editor.saveRecord(t.id, id, { ...input, values: { [t.fields.phone]: '138****0000' } }, key()),
    code('COLLAB_USE_BUSINESS_ACTION'),
  );
  await editor.saveRecord(t.id, id, input, key());
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id } })).name, '新名称');
});
