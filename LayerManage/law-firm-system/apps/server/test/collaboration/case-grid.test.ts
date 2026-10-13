import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { withFailingCollaborationOutbox } from '../helpers/collaboration-outbox-failure';

let db: PrismaClient, owner: CollaborationService, editor: CollaborationService, reader: CollaborationService;
let table: string, record: string, org: string, workspace: string;
let fields: Record<string, string>;
const code = (expected: string) => (e: unknown) => (e as { code?: string }).code === expected;
function context(userId: string, admin = false): AuthorizationContext {
  const permissionCodes: AuthorizationContext['permissionCodes'] = [
    'case.read',
    'case.create',
    'case.update',
    'case.delete',
    'customer.read',
  ];
  return {
    userId,
    employeeId: null,
    isSystemSuperAdmin: admin,
    isSystemAdmin: false,
    permissionCodes,
    fieldRules: [],
    evaluatedAt: new Date(),
    grants: permissionCodes.map((permissionCode) => ({
      sourceType: 'ROLE',
      sourceId: 'fixture',
      permissionCode,
      resource: permissionCode.split('.')[0],
      scopeIds: ['ALL'],
      validUntil: null,
    })),
  };
}
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = key();
  await db.organization.create({
    data: { id: org, code: org, name: '案件测试', type: 'FIRM', path: '/' + org },
  });
  const users = [];
  for (const name of ['owner', 'editor', 'reader'])
    users.push(await db.user.create({ data: { username: name, password: 'unused' } }));
  owner = new CollaborationService(db, context(users[0].id, true));
  editor = new CollaborationService(db, context(users[1].id));
  reader = new CollaborationService(db, context(users[2].id));
  workspace = (await owner.createWorkspace({ name: '案件', organizationId: org }, key())).id;
  await db.collabMember.createMany({
    data: [
      { workspaceId: workspace, principalId: editor.actor.userId, role: 'EDITOR', rowScope: 'ALL' },
      { workspaceId: workspace, principalId: reader.actor.userId, role: 'READER', rowScope: 'ALL' },
    ],
  });
  const base = await owner.createBase(workspace, { name: '案件' }, key());
  table = (await owner.createTable(base.id, { name: '案件工作表', source: 'CASES' }, key())).id;
  const customer = await db.customer.create({
    data: {
      customerNo: key(),
      name: '客户',
      phone: '13800000000',
      phoneHash: key(),
      createdBy: owner.actor.userId,
    },
  });
  record = (
    await db.case.create({
      data: {
        caseNo: key(),
        title: '原名称',
        caseType: '合同纠纷',
        customerId: customer.id,
        branchId: org,
        createdBy: owner.actor.userId,
        intakeData: { region: '北京', contractNumber: '保留编号' },
      },
    })
  ).id;
  await db.collabField.create({ data: { tableId: table, name: '备注', type: 'TEXT' } });
  fields = Object.fromEntries(
    (await db.collabField.findMany({ where: { tableId: table } })).map((f) => [
      String((f.options as { businessKey?: string } | null)?.businessKey ?? 'extra'),
      f.id,
    ]),
  );
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});

test('case grid edits core and extension values atomically, clears optional intake values, queries and deletes', async () => {
  const description = await editor.describe(table);
  const schemaVersion = description.table.schemaVersion;
  assert.equal(description.fields.find((f) => f.id === fields.title)?.writable, true);
  assert.equal(description.fields.find((f) => f.id === fields.caseNo)?.writable, false);
  assert.equal(description.fields.find((f) => f.id === fields.priority)?.type, 'SINGLE_SELECT');
  assert.equal(description.canDeleteRecords, true);
  const body = {
    schemaVersion,
    version: 1,
    values: {
      [fields.title]: '新名称',
      [fields['intake.region']]: '',
      [fields.extra]: '表格备注',
      [fields.fee]: '125.50',
    },
  };
  const receipt = key();
  const updated = await editor.saveRecord(table, record, body, receipt);
  assert.deepEqual(await editor.saveRecord(table, record, body, receipt), updated);
  const row = await db.case.findUniqueOrThrow({ where: { id: record } });
  assert.equal(row.title, '新名称');
  assert.equal(row.fee.toFixed(2), '125.50');
  assert.deepEqual(row.intakeData, { contractNumber: '保留编号' });
  assert.equal(
    (
      await editor.query(table, {
        config: { filter: { fieldId: fields.title, operator: 'contains', value: '新名称' } },
      })
    ).total,
    1,
  );
  await assert.rejects(
    editor.saveRecord(table, record, { ...body, values: { [fields.title]: '过期' } }, key()),
    code('COLLAB_RECORD_CONFLICT'),
  );
  const removal = { schemaVersion, version: updated.version, archived: true };
  const removalKey = key();
  await editor.saveRecord(table, record, removal, removalKey);
  await editor.saveRecord(table, record, removal, removalKey);
  assert.equal(await db.case.count({ where: { id: record } }), 0);
  assert.equal(await db.operationLog.count({ where: { targetId: record, action: 'CASE_DELETE' } }), 1);
});

test('reader, readonly fields, protected keys and self-only rows cannot be modified', async () => {
  const schemaVersion = (await editor.describe(table)).table.schemaVersion;
  const input = { schemaVersion, version: 1, values: { [fields.title]: '非法修改' } };
  await assert.rejects(reader.saveRecord(table, record, input, key()), code('COLLAB_FORBIDDEN'));
  await assert.rejects(
    editor.saveRecord(table, record, { ...input, values: { [fields.status]: 'CLOSED' } }, key()),
    code('COLLAB_USE_BUSINESS_ACTION'),
  );
  await db.collabMember.updateMany({
    where: { workspaceId: workspace, principalId: editor.actor.userId },
    data: { readonlyFields: [fields.title] },
  });
  await assert.rejects(editor.saveRecord(table, record, input, key()), code('COLLAB_FIELD_UNAVAILABLE'));
  await db.collabMember.updateMany({
    where: { workspaceId: workspace, principalId: editor.actor.userId },
    data: { readonlyFields: [], rowScope: 'SELF' },
  });
  await assert.rejects(editor.saveRecord(table, record, input, key()), code('COLLAB_NOT_FOUND'));
});

test('closed cases and invalid values are rejected; failed events roll back core edits and deletion', async () => {
  const schemaVersion = (await editor.describe(table)).table.schemaVersion;
  const input = { schemaVersion, version: 1, values: { [fields.title]: '新名称' } };
  await assert.rejects(
    editor.saveRecord(table, record, { ...input, values: { [fields.priority]: 'INVALID' } }, key()),
  );
  await withFailingCollaborationOutbox(db, async () => {
    await assert.rejects(editor.saveRecord(table, record, input, key()));
    await assert.rejects(
      editor.saveRecord(table, record, { schemaVersion, version: 1, archived: true }, key()),
    );
  });
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: record } })).title, '原名称');
  assert.equal(await db.operationLog.count({ where: { targetId: record } }), 0);
  await db.case.update({ where: { id: record }, data: { status: 'CLOSED' } });
  await assert.rejects(editor.saveRecord(table, record, input, key()), code('CASE_STATE_INVALID'));
});

test('pasting case fields uses the same validation and rolls back the entire batch on conflict', async () => {
  const schemaVersion = (await editor.describe(table)).table.schemaVersion;
  const first = await db.case.findUniqueOrThrow({ where: { id: record } });
  const second = await db.case.create({
    data: {
      caseNo: key(),
      title: '第二案件',
      caseType: first.caseType,
      customerId: first.customerId,
      branchId: org,
      createdBy: owner.actor.userId,
    },
  });
  const records = [
    { id: record, version: 1, values: { [fields.title]: '批量一' } },
    { id: second.id, version: 99, values: { [fields.priority]: 'HIGH' } },
  ];
  await assert.rejects(
    editor.saveRecords(table, { schemaVersion, records }, key()),
    code('COLLAB_RECORD_CONFLICT'),
  );
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: record } })).title, '原名称');
  records[1].version = 1;
  await editor.saveRecords(table, { schemaVersion, records }, key());
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: record } })).title, '批量一');
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: second.id } })).priority, 'HIGH');
});
