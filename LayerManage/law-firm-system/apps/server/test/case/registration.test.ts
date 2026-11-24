import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as key } from 'node:crypto';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';
import { CaseRegistrationService } from '../../app/application/case/registration-service';
import { CaseService } from '../../app/application/case/case-service';
import { WorkflowService } from '../../app/application/workflow/workflow-service';

test('lawyer registration freezes submitted content; designated manager rejects, applicant resubmits and withdraws; no self or cross-account approval', async () => {
  const db = createTestPrisma();
  try {
    await clearTestApplicationData(db);
    async function person(name: string, roleCode: string, permissions: string[]) {
      const employee = await db.employee.create({ data: { employeeNo: name, name, phone: '0', type: 'LAWYER', entryDate: new Date() } });
      const user = await db.user.create({ data: { username: name, password: 'unused', employeeId: employee.id } });
      const role = await db.role.create({ data: { name, code: roleCode, type: roleCode === 'SYSTEM_SUPER_ADMIN' ? 'SYSTEM' : 'BUSINESS', permissions: { create: PERMISSION_CATALOG.filter(p => permissions.includes(p.code)).map(p => ({ permissionId: p.id })) } } });
      const scope = await db.dataScope.create({ data: { name: name + '本人', scopeType: roleCode === 'MANAGER' ? 'ALL' : 'SELF' } });
      await db.roleDataScope.create({ data: { roleId: role.id, resource: 'case', dataScopeId: scope.id } });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id, validFrom: new Date(0) } });
      return await new AuthorizationContextLoader(db).load(user.id);
    }
    const permissions = ['case.read', 'case.create', 'case.update', 'case.delete', 'case.close', 'customer.read', 'approval.read', 'approval.apply', 'approval.process'];
    const admin = await person('admin', 'SYSTEM_SUPER_ADMIN', permissions);
    const lawyer = await person('chengyelj', 'LAWYER', permissions);
    const other = await person('chengyelzh', 'OTHER_LAWYER', permissions);
    const manager = await person('chengyelmj', 'MANAGER', permissions);
    const orgId = key();
    await db.organization.create({ data: { id: orgId, code: orgId, name: '隔离审批测试', type: 'FIRM', path: '/' + orgId } });
    const owner = new CollaborationService(db, admin);
    const workspace = await owner.createWorkspace({ name: '案件', organizationId: orgId }, key());
    const base = await owner.createBase(workspace.id, { name: '案件' }, key());
    const table = await owner.createTable(base.id, { name: '案件登记', source: 'CASES' }, key());
    const extraField = await db.collabField.create({ data: { tableId: table.id, name: '测试补充信息', type: 'TEXT' } });
    for (const actor of [lawyer, other, manager]) await db.collabMember.create({ data: { workspaceId: workspace.id, principalId: actor.userId, role: 'EDITOR', rowScope: actor.userId === manager.userId ? 'ALL' : 'SELF' } });
    const customer = await db.customer.create({ data: { customerNo: key(), name: '合成客户', phone: '0', phoneHash: key(), createdBy: lawyer.userId } });
    const row = await db.case.create({ data: { caseNo: key(), title: '合成登记案件', caseType: '合同纠纷', branchId: orgId, customerId: customer.id, createdBy: lawyer.userId, registrationRequired: true } });
    const service = new CaseRegistrationService(db, lawyer);
    const editor = new CollaborationService(db, lawyer);
    const business = new CaseService(db, { actorUserId: lawyer.userId }, lawyer);
    const wf = new WorkflowService(db, lawyer), review = new WorkflowService(db, manager);
    const info = await service.detail(table.id, row.id);
    assert.equal(info.canSubmit, true);
    assert.deepEqual(info.reviewers.map(u => u.id), [manager.userId]);
    await assert.rejects(new CaseRegistrationService(db, other).submit(table.id, row.id, { version: info.version, reviewerId: manager.userId }));
    await assert.rejects(service.submit(table.id, row.id, { version: info.version, reviewerId: lawyer.userId }));
    await assert.rejects(business.transitionCase(row.id, { version: row.version, status: 'ACCEPTED' }), /登记/);
    await assert.rejects(business.closeCase(row.id, {}), /登记/);
    const first = await service.submit(table.id, row.id, { version: info.version, reviewerId: manager.userId });
    assert.equal((await editor.record(table.id, row.id)).record.writable, false);
    await assert.rejects(service.submit(table.id, row.id, { version: info.version, reviewerId: manager.userId }));
    const schema = await editor.describe(table.id);
    const titleField = extraField;
    await assert.rejects(editor.saveRecord(table.id, row.id, { schemaVersion: schema.table.schemaVersion, version: info.version, values: { [titleField.id]: '非法变更' } }, key()));
    const instance = await review.detail(first.workflowInstanceId);
    assert.equal(instance.content.title, '合成登记案件');
    await assert.rejects(wf.act(instance.id, { action: 'APPROVE', version: instance.version }, key()));
    await assert.rejects(new WorkflowService(db, other).detail(instance.id));
    await assert.rejects(new WorkflowService(db, admin).act(instance.id, { action: 'APPROVE', version: instance.version }, key()));
    await review.act(instance.id, { action: 'REJECT', version: instance.version, remark: '补充登记内容' }, key());
    assert.equal((await db.caseRegistration.findFirstOrThrow()).status, 'REJECTED');
    assert.equal((await db.case.findUniqueOrThrow({ where: { id: row.id } })).status, 'PENDING');
    assert.equal((await editor.record(table.id, row.id)).record.writable, true);
    const second = await service.submit(table.id, row.id, { version: info.version, reviewerId: manager.userId });
    await wf.act(second.workflowInstanceId, { action: 'WITHDRAW', version: (await wf.detail(second.workflowInstanceId)).version }, key());
    assert.equal((await editor.record(table.id, row.id)).record.writable, true);
    const third = await service.submit(table.id, row.id, { version: info.version, reviewerId: manager.userId });
    // Removing the reviewer role revokes pending decision access immediately.
    await db.userRole.updateMany({ where: { userId: manager.userId }, data: { revokedAt: new Date(), revokedByUserId: admin.userId, revokeReason: '隔离测试撤销案件管理员审批资格' } });
    await assert.rejects(review.act(third.workflowInstanceId, { action: 'APPROVE', version: (await wf.detail(third.workflowInstanceId)).version }, key()));
    await db.userRole.updateMany({ where: { userId: manager.userId }, data: { revokedAt: null, revokedByUserId: null, revokeReason: null } });
    const pending = await review.detail(third.workflowInstanceId);
    // A change from another writer must not be accepted using a stale approval snapshot.
    await db.collabExtension.create({ data: { tableId: table.id, recordId: row.id, values: { [extraField.id]: '并发补充' }, version: 1, updatedBy: admin.userId } });
    await assert.rejects(review.act(pending.id, { action: 'APPROVE', version: pending.version }, key()), /已变化/);
    assert.equal((await db.case.findUniqueOrThrow({ where: { id: row.id } })).status, 'PENDING');
    assert.equal((await db.caseRegistration.findUniqueOrThrow({ where: { workflowInstanceId: pending.id } })).status, 'PENDING');
    await review.act(pending.id, { action: 'REJECT', version: pending.version, remark: '退回核对修改' }, key());
    const current = await editor.record(table.id, row.id);
    await assert.rejects(service.submit(table.id, row.id, { version: info.version, reviewerId: manager.userId }), /已被修改/);
    const edited = await editor.saveRecord(table.id, row.id, { schemaVersion: schema.table.schemaVersion, version: current.record.version, values: { [extraField.id]: '已核对补充' } }, key());
    const fourth = await service.submit(table.id, row.id, { version: edited.version, reviewerId: manager.userId });
    const finalReview = await review.detail(fourth.workflowInstanceId);
    const decisionKey = key();
    await review.act(finalReview.id, { action: 'APPROVE', version: finalReview.version }, decisionKey);
    const accepted = await db.case.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(accepted.status, 'ACCEPTED');
    assert.equal(accepted.version, row.version + 1);
    assert.equal(accepted.updatedBy, manager.userId);
    assert.equal((await db.caseRegistration.findUniqueOrThrow({ where: { workflowInstanceId: finalReview.id } })).status, 'APPROVED');
    await review.act(finalReview.id, { action: 'APPROVE', version: finalReview.version }, decisionKey);
    assert.equal((await db.case.findUniqueOrThrow({ where: { id: row.id } })).version, accepted.version);
    assert.equal(await db.operationLog.count({ where: { targetId: row.id, action: 'CASE_STATUS' } }), 1);
    assert.equal((await service.detail(table.id, row.id)).canSubmit, false);
    assert.equal(await db.approvalInstance.count(), 0);

  } finally {
    await clearTestApplicationData(db);
    await db.$disconnect();
  }
});
