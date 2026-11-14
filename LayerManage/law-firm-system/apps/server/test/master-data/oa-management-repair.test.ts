import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { createRoleMatrix } from '../../scripts/test/oa-role-matrix-fixture';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { AuthorizationService } from '../../app/application/authorization/authorization-service';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { PositionService } from '../../app/application/master-data/position-service';
import { ProfessionalTeamService } from '../../app/application/master-data/professional-team-service';
import { EmployeeService } from '../../app/application/master-data/employee-service';
import { UserGrantService } from '../../app/application/authorization/user-grant-service';
import { RoleAuthorizationService } from '../../app/application/authorization/role-authorization-service';
import { CollaborationService } from '../../app/application/collaboration/collaboration-service';

test('16 headquarters/branch identities: permissions, scope isolation, sharing, deletion and private document handover', async () => {
  const db = createTestPrisma();
  try {
    await clearTestApplicationData(db);
    const hqId = randomUUID(), branchId = randomUUID();
    await db.organization.create({ data: { id: hqId, code: 'MATRIX_HQ', name: '验收总所', type: 'FIRM', path: `/${hqId}`, level: 0 } });
    await db.organization.create({ data: { id: branchId, code: 'MATRIX_BRANCH', name: '验收分所', type: 'BRANCH', parentId: hqId, path: `/${hqId}/${branchId}`, level: 1 } });
    const accounts = await createRoleMatrix(db, hqId, branchId, 'matrix');
    assert.equal(accounts.length, 16);
    const loader = new AuthorizationContextLoader(db);
    const superAccount = accounts.find(a => a.key === 'SUPER_ADMIN')!;
    const superContext = await loader.load(superAccount.userId);
    const hqPositions = new PositionService(db, { actorUserId: superAccount.userId }, superContext);
    assert.equal((await hqPositions.list({ organizationId: hqId, includeDescendants: true })).length, 16);
    const workspace = await db.collabWorkspace.create({ data: { organizationId: hqId, ownerId: superAccount.userId, name: '全角色共享验收' } });
    const shared = await db.collabBase.create({ data: { workspaceId: workspace.id, name: '共享文档' } });
    const privateBases: Record<string, string> = {};
    for (const account of accounts) {
      const context = await loader.load(account.userId);
      const expected = account.key === 'SUPER_ADMIN' ? PERMISSION_CATALOG.map(p => p.code) : (await new RoleAuthorizationService(db, { actorUserId: superAccount.userId }).detail(account.roleId)).permissionCodes;
      assert.ok(expected.length > 10, `${account.username} has a usable role`);
      for (const permission of PERMISSION_CATALOG) {
        if (expected.includes(permission.code)) new AuthorizationService().requireAction(context, permission.code);
        else assert.throws(() => new AuthorizationService().requireAction(context, permission.code));
      }
      const positions = await new PositionService(db, { actorUserId: account.userId }, context).list({ organizationId: hqId, includeDescendants: true });
      assert.equal(positions.length, account.organizationId === branchId && account.key !== 'SUPER_ADMIN' ? 8 : 16);
      if (account.key !== 'SUPER_ADMIN' && account.key !== 'PARTNER' && account.key !== 'BRANCH_ADMIN') {
        assert.throws(() => new AuthorizationService().requireAction(context, 'position.delete'));
        assert.throws(() => new AuthorizationService().requireAction(context, 'role.permission.manage'));
      }
      await db.collabMember.create({ data: { workspaceId: workspace.id, principalId: account.userId, role: 'MANAGER', rowScope: 'ALL', canCreate: true } });
      const policy = { restricted: true, grants: [{ principalType: 'USER', principalId: account.userId, role: 'MANAGER', rowScope: 'ALL', canCreate: true, hiddenFields: [], readonlyFields: [] }] };
      const base = await db.collabBase.create({ data: { workspaceId: workspace.id, name: `${account.username}个人文档`, accessPolicy: policy } });
      await db.driveNode.create({ data: { id: base.id, workspaceId: workspace.id, baseId: base.id, kind: 'BASE', ownerId: account.userId, createdAt: new Date() } });
      privateBases[account.userId] = base.id;
      const collab = new CollaborationService(db, context);
      await collab.baseAccess(shared.id);
      await collab.baseAccess(base.id, db, 3);
    }
    for (const account of accounts) {
      const other = accounts.find(a => a.userId !== account.userId)!;
      await assert.rejects(() => new CollaborationService(db, { ...superContext, ...( { userId: account.userId, employeeId: account.employeeId } ) }).baseAccess(privateBases[other.userId]));
    }
    const branchAdmin = accounts.find(a => a.key === 'BRANCH_ADMIN' && a.organizationId === branchId)!;
    const context = await loader.load(branchAdmin.userId);
    const branchPositions = new PositionService(db, { actorUserId: branchAdmin.userId }, context);
    await assert.rejects(() => branchPositions.create({ organizationId: hqId, code: 'DENIED', name: '越权岗位', categoryCode: 'ADMIN', level: 0 }));
    const added = await branchPositions.create({ organizationId: branchId, code: '自编-001', name: '分所新增岗位', categoryCode: 'ADMIN', level: 0 });
    const changed = await branchPositions.update(added.id, { code: '自编-002', version: 1 });
    assert.ok((await hqPositions.list({ organizationId: hqId, includeDescendants: true })).some(p => p.id === added.id));
    const assignment = await db.employeeAssignment.findFirstOrThrow({ where: { employeeId: branchAdmin.employeeId } });
    await branchPositions.remove(assignment.positionId, 1);
    assert.ok(await db.employeeAssignment.findUnique({ where: { id: assignment.id } }));
    await assert.rejects(() => branchPositions.enable(assignment.positionId, 2));
    await branchPositions.remove(changed.id, changed.version);
    const teamService = new ProfessionalTeamService(db, { actorUserId: superAccount.userId }, superContext);
    let team = await teamService.create({ code: 'TEST_TEAM', name: '测试专业团队', categoryCode: 'LEGAL', homeOrganizationId: hqId });
    team = await teamService.addMember(team.id, { employeeId: accounts[2].employeeId, memberRole: 'LEAD' });
    team = await teamService.endMember(team.id, team.members[0].id, team.members[0].version);
    assert.ok(team.members[0].endedAt);
    await teamService.remove(team.id, team.version);
    await assert.rejects(() => teamService.detail(team.id));
    const target = accounts.find(a => a.key === 'LAWYER')!;
    const grants = new UserGrantService(db, superContext);
    await grants.replaceBusinessRoles(target.userId, { roleIds: [target.roleId] });
    await grants.replaceBusinessRoles(target.userId, { roleIds: [] });
    assert.equal((await loader.load(target.userId)).permissionCodes.length, 0);
    await grants.replaceBusinessRoles(target.userId, { roleIds: [target.roleId] });
    await assert.rejects(() => grants.replaceBusinessRoles(target.userId, { roleIds: [superAccount.roleId] }));
    const employeeService = new EmployeeService(db, { actorUserId: superAccount.userId }, superContext);
    const material = await db.approvalAttachment.create({ data: { ownerUserId: target.userId, fileName: '个人材料.txt', mimeType: 'text/plain', fileSize: 1, sha256: 'fixture', bytes: Buffer.from('x') } });
    const payroll = await db.payrollBatch.create({ data: { ownerUserId: target.userId, title: '个人草稿', period: '2026-09', attachmentId: material.id } });
    await assert.rejects(() => employeeService.remove(target.employeeId, { version: 1, confirmed: true }), /EMPLOYEE_TRANSFER_REQUIRED/);
    assert.equal((await db.employee.findUniqueOrThrow({ where: { id: target.employeeId } })).deletedAt, null);
    const recipient = accounts.find(a => a.key === 'FINANCE' && a.organizationId === branchId)!;
    await employeeService.remove(target.employeeId, { version: 1, confirmed: true, recipientUserId: recipient.userId });
    assert.equal((await db.driveNode.findUniqueOrThrow({ where: { id: privateBases[target.userId] } })).ownerId, recipient.userId);
    assert.equal((await db.approvalAttachment.findUniqueOrThrow({ where: { id: material.id } })).ownerUserId, recipient.userId);
    assert.equal((await db.payrollBatch.findUniqueOrThrow({ where: { id: payroll.id } })).ownerUserId, recipient.userId);
    await new CollaborationService(db, await loader.load(recipient.userId)).baseAccess(privateBases[target.userId], db, 3);
    await assert.rejects(() => loader.load(target.userId));
    await assert.rejects(() => new CollaborationService(db, superContext).baseAccess(privateBases[target.userId]));
  } finally { await db.$disconnect(); }
});
