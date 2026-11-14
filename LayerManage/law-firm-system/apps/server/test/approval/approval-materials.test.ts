import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { ApprovalDefinitionService } from '../../app/application/approval/approval-definition-service';
import { ApprovalInstanceService } from '../../app/application/approval/approval-instance-service';
import { ApprovalAttachmentService } from '../../app/application/approval/approval-attachment-service';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
import { PermissionCode } from '../../app/domain/authorization/authorization-types';
import { validateApprovalFile } from '../../app/domain/approval/approval-file-validation';

let db: PrismaClient;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
test.before(() => { db = createTestPrisma(); });
test.beforeEach(async () => { await clearTestApplicationData(db); });
test.after(async () => { await clearTestApplicationData(db); await db.$disconnect(); });
function context(id: string, permissions: PermissionCode[] = ['approval.apply', 'approval.read', 'approval.process']): AuthorizationContext {
  return { userId: id, employeeId: null, isSystemAdmin: false, isSystemSuperAdmin: false, fieldRules: [], evaluatedAt: new Date(), permissionCodes: permissions, grants: permissions.map(permissionCode => ({ sourceType: 'ROLE', sourceId: 'test', sourceRoleId: 'test', permissionCode, resource: 'approval', scopeIds: ['ALL'], validUntil: null })) };
}
function services(id: string, permissions?: PermissionCode[]) {
  const actor = { actorUserId: id, requestId: randomUUID() }; const auth = context(id, permissions);
  return { files: new ApprovalAttachmentService(db, actor, auth), definitions: new ApprovalDefinitionService(db, actor, auth), instances: new ApprovalInstanceService(db, actor, auth) };
}
async function fixture() {
  const users = await Promise.all(['a', 'b', 'c'].map(tag => db.user.create({ data: { username: tag + randomUUID(), password: 'test-only' } })));
  const [a, b, c] = users.map(user => user.id);
  const definition = await db.approvalDefinition.create({ data: { code: 'EXPENSE', name: '费用报销', businessType: 'EXPENSE', formSchema: { fields: [{ key: 'reason', label: '申请事由', type: 'text', required: true }] }, approverRule: { type: 'USER', userIds: [b] }, createdBy: a } });
  return { a, b, c, definition, apply: { definitionCode: 'EXPENSE', title: '申请', content: { reason: '发票报销' }, idempotencyKey: randomUUID() } };
}
test('personal types inherit a permitted template and are private; public CUSTOM remains manageable', async () => {
  const { a, b } = await fixture();
  const personal = await services(a).definitions.createPersonalDefinition({ name: '工资绩效发放', templateCode: 'EXPENSE' });
  assert.equal(personal.businessType, 'CUSTOM'); assert.deepEqual(personal.approverRule, { type: 'USER', userIds: [b] });
  assert.equal((await services(a).definitions.listDefinitions()).length, 2);
  assert.equal((await services(b).definitions.listDefinitions()).length, 1);
  await assert.rejects(services(b).definitions.getActiveDefinition(personal.code), { code: 'APPROVAL_DEFINITION_NOT_FOUND' });
  await assert.rejects(services(b).definitions.createPersonalDefinition({ name: '窃取', templateCode: personal.code }), { code: 'APPROVAL_DEFINITION_NOT_FOUND' });
  await assert.rejects(services(a, []).definitions.createPersonalDefinition({ name: '无权限', templateCode: 'EXPENSE' }));
  const created = await services(a).instances.applyForApproval({ definitionCode: personal.code, title: '薪资', content: { reason: '本月工资' } });
  assert.equal(created.formSnapshot?.name, '工资绩效发放');
  const manager = services(a, ['approval.manage']);
  const publicType = await manager.definitions.createDefinition({ code: 'CUSTOM_PUBLIC', name: '公共类型', businessType: 'CUSTOM', formSchema: { fields: [] }, approverRule: { type: 'USER', userIds: [b] } });
  assert.ok((await services(b).definitions.listDefinitions()).some(item => item.id === publicType.id));
});
test('drafts are private, bind atomically, become readable by participants and frozen', async () => {
  const { a, b, c, apply } = await fixture();
  const file = await services(a).files.upload('发票.png', png);
  await assert.rejects(services(b).files.download(file.id), { code: 'APPROVAL_FILE_NOT_FOUND' });
  const instance = await services(a).instances.applyForApproval({ ...apply, attachmentIds: [file.id] });
  assert.equal((await services(b).files.list(instance.id)).length, 1);
  assert.equal((await services(b).files.download(file.id, 'PREVIEW')).base64, png.toString('base64'));
  await assert.rejects(services(c).files.download(file.id), { code: 'APPROVAL_FILE_NOT_FOUND' });
  await assert.rejects(services(a).files.remove(file.id), { code: 'APPROVAL_FILE_FROZEN' });
  await assert.rejects(services(a).instances.applyForApproval({ ...apply, idempotencyKey: 'different', attachmentIds: [file.id] }), { code: 'APPROVAL_FILE_BIND_INVALID' });
  assert.equal(await db.approvalInstance.count(), 1);
  const material = await services(b).files.exportRecord(instance.id);
  assert.equal(material.attachments.length, 1); assert.equal(material.instance.formSnapshot && typeof material.instance.formSnapshot, 'object');
  assert.ok(await db.operationLog.findFirst({ where: { action: 'APPROVAL_MATERIAL_EXPORT' } }));
  assert.equal((await services(c, ['approval.manage']).files.list(instance.id)).length, 1);
});
test('wrong owner and mixed missing files roll back the complete application and all bindings', async () => {
  const { a, c, apply } = await fixture();
  const mine = await services(a).files.upload('mine.png', png); const other = await services(c).files.upload('other.png', png);
  await assert.rejects(services(a).instances.applyForApproval({ ...apply, attachmentIds: [mine.id, other.id] }), { code: 'APPROVAL_FILE_BIND_INVALID' });
  assert.equal(await db.approvalInstance.count(), 0); assert.equal(await db.approvalTask.count(), 0);
  assert.equal((await db.approvalAttachment.findUniqueOrThrow({ where: { id: mine.id } })).instanceId, null);
  await assert.rejects(services(a).instances.applyForApproval({ ...apply, attachmentIds: [mine.id, mine.id] }), { code: 'APPROVAL_FILE_INVALID' });
});
test('concurrent retry returns one application; changing submitted payload conflicts', async () => {
  const { a, apply } = await fixture(); const file = await services(a).files.upload('工资凭证.png', png);
  const input = { ...apply, attachmentIds: [file.id] };
  const [first, second] = await Promise.all([services(a).instances.applyForApproval(input), services(a).instances.applyForApproval(input)]);
  assert.equal(first.id, second.id); assert.equal(await db.approvalInstance.count(), 1);
  assert.equal(await db.operationLog.count({ where: { action: 'APPROVAL_APPLY' } }), 1);
  await assert.rejects(services(a).instances.applyForApproval({ ...input, title: '另一申请' }), { code: 'APPROVAL_APPLY_KEY_CONFLICT' });
});
test('edit/copy preserves original; withdrawal can be cloned without mutating prior evidence', async () => {
  const { a, b, apply } = await fixture();
  const original = await services(a).files.upload('原件.png', png);
  const edited = await services(a).files.upload('修改版.png', png, original.id);
  assert.equal(edited.sourceId, original.id);
  await assert.rejects(services(a).files.remove(original.id), { code: 'APPROVAL_FILE_FROZEN' });
  await assert.rejects(services(b).files.upload('窃取原件.png', png, original.id), { code: 'APPROVAL_FILE_NOT_FOUND' });
  const instance = await services(a).instances.applyForApproval({ ...apply, attachmentIds: [original.id, edited.id] });
  await services(a).instances.withdrawInstance(instance.id, { reason: '修改材料' });
  const clone = await services(a).files.clone(edited.id);
  assert.equal(clone.instanceId, null); assert.equal(clone.sourceId, edited.id);
  assert.equal((await services(a).files.list(instance.id)).length, 2);
  await services(a).files.remove(clone.id);
});
test('file type, filename and size checks reject disguised/oversize/legacy files', () => {
  assert.equal(validateApprovalFile('票据.png', png), 'image/png');
  assert.throws(() => validateApprovalFile('../票据.png', png));
  assert.throws(() => validateApprovalFile('票据.pdf', png));
  assert.throws(() => validateApprovalFile('工资.xls', png));
  assert.throws(() => validateApprovalFile('恶意.xlsx', Buffer.from('PK\x03\x04invalid')));
  assert.throws(() => validateApprovalFile('大文件.pdf', Buffer.alloc(10 * 1024 * 1024 + 1)), { code: 'APPROVAL_FILE_TOO_LARGE' });
});
