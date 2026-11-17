import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { lawyerProspectFields, lawyerProspectNames, lawyerProspectTemplate } from '../../app/application/collaboration/lawyer-prospect-template';
import { standardizeLawyerProspects } from '../../scripts/maintenance/standardize-lawyer-prospects';

let db: PrismaClient, svc: CollaborationService, base: string, user: string, workspaceId: string;
test.before(() => { db = createTestPrisma(); });
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  const org = key();
  await db.organization.create({ data: { id: org, code: org, name: '测试', type: 'FIRM', path: '/' + org } });
  user = (await db.user.create({ data: { username: key(), password: 'unused' } })).id;
  svc = new CollaborationService(db, {
    userId: user, employeeId: null, isSystemSuperAdmin: true, isSystemAdmin: false, evaluatedAt: new Date(),
    permissionCodes: PERMISSION_CATALOG.map(p => p.code), fieldRules: [],
    grants: PERMISSION_CATALOG.map(p => ({ sourceType: 'ROLE', sourceId: 'fixture', permissionCode: p.code,
      resource: p.resource, scopeIds: ['ALL'], validUntil: null })),
  });
  workspaceId = (await svc.createWorkspace({ name: '测试工作区', organizationId: org }, key())).id;
  base = (await svc.createBase(workspaceId, { name: '线索表' }, key())).id;
});
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });

test('24-field template validates input, supports shared editing, soft deletion and undo/redo', async () => {
  for (const name of lawyerProspectNames) {
    const table = await svc.createTable(base, { name, template: lawyerProspectTemplate }, key());
    const detail = await svc.describe(table.id);
    assert.equal(detail.fields.length, 24);
    assert.deepEqual(detail.fields.map(f => f.name), lawyerProspectFields().map(f => f.name));
    const field = (name: string) => detail.fields.find(f => f.name === name)!;
    assert.equal(field('创建时间').writable, false);
    assert.equal(field('最后更新时间').writable, false);
    const file = await db.collabAttachment.create({ data: {
      tableId: table.id, ownerId: user, name: '谈案报告.pdf', mimeType: 'application/pdf', size: 4, storageKey: key(),
    } });
    const workspace = await db.collabWorkspace.findUniqueOrThrow({where:{id:workspaceId}});
    const employee = await db.employee.create({data:{name:'跟进员工',employeeNo:key(),phone:'13800001234',type:'SALES',status:'FORMAL',entryDate:new Date('2025-01-01')}});
    const position = await db.position.create({data:{organizationId:workspace.organizationId,code:key(),name:'跟进岗位',categoryCode:'SALES'}});
    await db.employeeAssignment.create({data:{organizationId:workspace.organizationId,positionId:position.id,employeeId:employee.id,assignmentType:'PRIMARY',startedAt:new Date('2025-01-01')}});
    const memberUser = (await db.user.create({ data: { username: key(), password: 'unused',employeeId:employee.id } })).id;
    assert.equal(field('跟进人').type,'USER');
    const values = Object.fromEntries(detail.fields.filter(f => f.writable).map(f => [f.id,
      f.type === 'FILE' ? [file.id] : f.type === 'MULTI_SELECT' ? f.options.choices!.slice(0, 2).map(c => c.id) :
      f.type === 'SINGLE_SELECT' ? f.options.choices![0].id : f.type === 'DATETIME' ? '2026-11-03T04:00:00.000Z' :
      f.type === 'USER' ? employee.id : f.type === 'NUMBER' ? 15 : f.type === 'CURRENCY' ? '1234.56' : '测试内容',
    ]));
    await assert.rejects(svc.saveRecord(table.id, undefined, { schemaVersion: 1, values: {} }, key()), /COLLAB_REQUIRED/);
    await assert.rejects(svc.saveRecord(table.id, undefined, { schemaVersion: 1,
      values: { ...values, [field('客资来源').id]: '错误选项' } }, key()), /COLLAB_INVALID/);
    const row = await svc.saveRecord(table.id, undefined, { schemaVersion: 1, values }, key());
    const initial = (await svc.record(table.id, row.id)).record;
    for (const [id, value] of Object.entries(values)) assert.deepEqual(initial.values[id], value);
    assert.ok(initial.values[field('创建时间').id]);
    await assert.rejects(svc.saveRecord(table.id, row.id, { schemaVersion: 1, version: initial.version,
      values: { [field('创建时间').id]: '2000-01-01T00:00:00Z' } }, key()), /COLLAB_READONLY_FIELD/);
    const member = await db.collabMember.create({ data: { workspaceId, principalId: memberUser, role: 'READER', rowScope: 'ALL' } });
    const editor = new CollaborationService(db, { ...svc.actor, userId: memberUser, employeeId:employee.id, isSystemSuperAdmin: false });
    const patch = { schemaVersion: 1, version: initial.version, values: { [field('对话聊天记录').id]: '协作修改' } };
    assert.equal((await editor.query(table.id, {})).total, 1);
    await assert.rejects(editor.saveRecord(table.id, row.id, patch, key()), /COLLAB_FORBIDDEN/);
    await assert.rejects(editor.deleteRecords(table.id, { schemaVersion: 1, records: [{ id: row.id, version: initial.version }] }, key()), /COLLAB_FORBIDDEN/);
    await db.collabMember.update({ where: { id: member.id }, data: { role: 'EDITOR' } });
    const edited = await editor.saveRecord(table.id, row.id, patch, key());
    const updated = (await svc.record(table.id, row.id)).record;
    assert.equal(updated.values[field('对话聊天记录').id], '协作修改');
    assert.equal(updated.values[field('创建时间').id], initial.values[field('创建时间').id]);
    assert.ok(String(updated.values[field('最后更新时间').id]) >= String(initial.values[field('最后更新时间').id]));
    await editor.reverseRecordOperation(table.id, edited.operationId, { direction: 'undo' }, key());
    assert.equal((await svc.record(table.id, row.id)).record.values[field('对话聊天记录').id], '测试内容');
    await editor.reverseRecordOperation(table.id, edited.operationId, { direction: 'redo' }, key());
    await svc.saveRecord(table.id, undefined, { schemaVersion: 1, values }, key());
    const rows = (await editor.query(table.id, {})).records;
    await editor.deleteRecords(table.id, { schemaVersion: 1, records: rows.map(r => ({ id: r.id, version: r.version })) }, key());
    assert.equal((await svc.query(table.id, {})).total, 0);
    assert.equal(await db.collabRecord.count({ where: { tableId: table.id, archived: true } }), 2);
    const trash = await editor.recordOperations(table.id, { trash: 'true' });
    assert.ok(!Array.isArray(trash));
    for (const op of trash.rows) await editor.reverseRecordOperation(table.id, op.id, { direction: 'undo' }, key());
    assert.equal((await svc.query(table.id, {})).total, 2);
    assert.equal((await editor.attachment(table.id, file.id)).id, file.id);
    await db.collabMember.delete({ where: { id: member.id } });
    await assert.rejects(editor.query(table.id, {}), /COLLAB_FORBIDDEN|COLLAB_NOT_FOUND/);
  }
});

test('maintenance is previewable, idempotent, preserves IDs/ACLs and aligns every view', async () => {
  const first = await svc.createTable(base, { name: lawyerProspectNames[0] }, key());
  const second = await svc.createTable(base, { name: lawyerProspectNames[1], source: 'LEADS' }, key());
  const policy = { restricted: true, grants: [] };
  await db.collabBase.update({ where: { id: base }, data: { moduleSource: 'LEADS', accessPolicy: policy } });
  await db.collabTable.update({ where: { id: first.id }, data: { accessPolicy: policy } });
  const preview = await standardizeLawyerProspects(db, user);
  assert.equal(preview.length, 2);
  assert.ok(preview.every(r => r.changed));
  assert.equal((await db.collabTable.findUniqueOrThrow({ where: { id: second.id } })).source, 'LEADS');
  await standardizeLawyerProspects(db, user, true);
  const currentBase = await db.collabBase.findUniqueOrThrow({ where: { id: base } });
  assert.equal(currentBase.moduleSource, 'CUSTOMERS');
  assert.equal(currentBase.name, '律师客资工作表');
  assert.deepEqual(currentBase.accessPolicy, policy);
  assert.deepEqual((await svc.businessTables({ source: 'CUSTOMERS' })).tables.map(t => t.name).sort(), [...lawyerProspectNames].sort());
  assert.equal((await svc.businessTables({ source: 'LEADS' })).tables.length, 0);
  for (const table of [first, second]) {
    const detail = await svc.describe(table.id);
    assert.equal(detail.table.source, 'CUSTOM');
    assert.equal(detail.fields.length, 24);
    for (const view of detail.views) assert.deepEqual(view.config.visibleFields, detail.fields.map(f => f.id));
  }
  assert.deepEqual((await db.collabTable.findUniqueOrThrow({ where: { id: first.id } })).accessPolicy, policy);
  assert.ok((await standardizeLawyerProspects(db, user, true)).every(r => !r.changed));
  assert.equal(await db.collabRecord.count(), 0);
});

test('maintenance refuses populated placeholders without partially moving or changing them', async () => {
  const first = await svc.createTable(base, { name: lawyerProspectNames[0] }, key());
  await svc.createTable(base, { name: lawyerProspectNames[1], source: 'LEADS' }, key());
  const field = (await svc.describe(first.id)).fields[0];
  await svc.saveRecord(first.id, undefined, { schemaVersion: 1, values: { [field.id]: '需要保留' } }, key());
  await assert.rejects(standardizeLawyerProspects(db, user, true), /已有数据/);
  assert.equal((await svc.describe(first.id)).fields.length, 1);
  assert.equal((await db.collabBase.findUniqueOrThrow({ where: { id: base } })).name, '线索表');
});
