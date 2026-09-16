import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { clearTestApplicationData, createTestPrisma } from '../helpers/test-database';
import { CaseService } from '../../app/application/case/case-service';
import { SopTemplateService } from '../../app/application/sop/template-service';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { createGovernanceServices } from '../../app/application/admin-governance/governance-factory';
import { allowTestGovernanceStepUp, testGovernanceStepUp } from '../helpers/governance-step-up';
import { parseSopContent, SOP_PRESETS } from '../../app/domain/sop/template-content';
import { AuthorizationContext } from '../../app/application/authorization/authorization-service';
let db: PrismaClient,
  admin: string,
  reviewer: string,
  org: string,
  team: string,
  context: AuthorizationContext,
  reviewContext: AuthorizationContext,
  service: SopTemplateService;
const reject = (code: string) => (error: unknown) => (error as { code?: string }).code === code;
const content = () =>
  parseSopContent({
    schemaVersion: 1,
    nodes: [
      { code: 'COLLECT', name: '材料收集' },
      { code: 'REPORT', name: '报告审核', dependsOn: ['COLLECT'], reviewRequired: true },
    ],
  });
const gov = () =>
  createGovernanceServices(db, { databaseName: 'chengye_collab_test', stepUp: allowTestGovernanceStepUp });
const input = () => ({
  code: 'TEST_' + randomUUID().slice(0, 8).replaceAll('-', ''),
  name: '医疗流程',
  organizationId: org,
  professionalTeamId: team,
  caseType: '医疗纠纷',
  content: content(),
  requestKey: randomUUID(),
});
async function draft() {
  const row = await service.create(input());
  return {
    template: row,
    revision: await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: row.id } }),
  };
}
async function request(
  id: string,
  type: 'SOP_TEMPLATE_PUBLISH' | 'SOP_TEMPLATE_DISABLE' = 'SOP_TEMPLATE_PUBLISH',
) {
  const row = await db.sopTemplateVersion.findUniqueOrThrow({ where: { id } });
  return gov().command.create(
    context,
    {
      operationType: type,
      targetType: 'SOP_TEMPLATE_VERSION',
      targetId: id,
      expectedTargetVersion: row.version,
      payload: { contentHash: row.contentHash },
      reason: '核对模板并申请治理审核',
      idempotencyKey: randomUUID(),
    },
    undefined,
    testGovernanceStepUp(admin),
  );
}
async function approve(id: string, version: number) {
  return gov().review.review(
    reviewContext,
    id,
    { decision: 'APPROVE', comment: '已核验模板适用范围与节点配置', expectedOperationVersion: version },
    undefined,
    testGovernanceStepUp(reviewer),
  );
}
test.before(() => {
  db = createTestPrisma();
});
test.beforeEach(async () => {
  await clearTestApplicationData(db);
  org = randomUUID();
  await db.organization.create({
    data: { id: org, code: 'SOP_ORG', name: '医疗团队组织', type: 'FIRM', path: '/' + org },
  });
  team = (
    await db.professionalTeam.create({
      data: { code: 'SOP_TEAM', name: '医疗团队', categoryCode: 'MEDICAL', homeOrganizationId: org },
    })
  ).id;
  for (const [code, name] of [
    ['SYSTEM_ADMIN', '配置管理员'],
    ['SYSTEM_SUPER_ADMIN', '治理审核员'],
  ]) {
    const user = await db.user.create({
      data: { username: code, password: 'unused', mustChangePassword: false },
    });
    const role = await db.role.create({ data: { code, name, type: 'SYSTEM' } });
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
    if (code === 'SYSTEM_ADMIN') admin = user.id;
    else reviewer = user.id;
  }
  context = await new AuthorizationContextLoader(db).load(admin);
  reviewContext = await new AuthorizationContextLoader(db).load(reviewer);
  service = new SopTemplateService(db, { actorUserId: admin }, context);
});
test.after(async () => {
  await clearTestApplicationData(db);
  await db.$disconnect();
});
test('template create retries persist exactly one draft and all defaults are non-blocking', async () => {
  const data = input();
  const first = await service.create(data),
    second = await service.create(data);
  assert.equal(first.id, second.id);
  assert.equal(await db.sopTemplateVersion.count(), 1);
  assert.equal((await db.sopTemplateVersion.findFirstOrThrow()).status, 'DRAFT');
  await assert.rejects(service.create({ ...data, name: 'changed' }), reject('IDEMPOTENCY_CONFLICT'));
  assert.deepEqual(
    SOP_PRESETS.map((p) => p.content.nodes.length),
    [9, 9, 12],
  );
  assert.ok(
    SOP_PRESETS.every((p) =>
      p.content.nodes.every((n) => !n.closeGate && !n.reviewRequired && n.dependsOn.length === 0),
    ),
  );
  assert.equal(SOP_PRESETS[2].content.nodes[0].code, 'CR_FIRST_RECEPTION');
});
test('draft parser rejects cycles missing dependencies duplicate nodes and unknown fields', () => {
  for (const nodes of [
    [{ code: 'AA', name: 'A', dependsOn: ['AA'] }],
    [{ code: 'AA', name: 'A', dependsOn: ['BB'] }],
    [
      { code: 'AA', name: 'A' },
      { code: 'AA', name: 'B' },
    ],
    [{ code: 'AA', name: 'A', arbitrary: true }],
  ])
    assert.throws(() => parseSopContent({ schemaVersion: 1, nodes }));
});
test('governed publish locks drafts and preserves history across disabling and copied rollback', async () => {
  const { template, revision } = await draft();
  const op = await request(revision.id);
  assert.equal(op.status, 'PENDING_REVIEW');
  await assert.rejects(
    service.updateVersion(revision.id, { expectedVersion: 1, content: content() }),
    reject('SOP_REVIEW_PENDING'),
  );
  await assert.rejects(
    gov().review.review(
      context,
      op.id,
      { decision: 'APPROVE', expectedOperationVersion: op.version },
      undefined,
      testGovernanceStepUp(admin),
    ),
  );
  const result = await approve(op.id, op.version);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(
    (await db.sopTemplate.findUniqueOrThrow({ where: { id: template.id } })).activeVersionId,
    revision.id,
  );
  await assert.rejects(
    service.updateVersion(revision.id, { expectedVersion: 2, content: content() }),
    reject('SOP_VERSION_CONFLICT'),
  );
  const disable = await request(revision.id, 'SOP_TEMPLATE_DISABLE');
  await approve(disable.id, disable.version);
  assert.equal(
    (await db.sopTemplate.findUniqueOrThrow({ where: { id: template.id } })).activeVersionId,
    null,
  );
  const next = await service.copyVersion(template.id, {
    sourceVersionId: revision.id,
    requestKey: randomUUID(),
  });
  assert.equal(next.number, 2);
  assert.equal(next.contentHash, revision.contentHash);
  const publish = await request(next.id);
  await approve(publish.id, publish.version);
  assert.equal(
    (await db.sopTemplateVersion.findUniqueOrThrow({ where: { id: revision.id } })).status,
    'DISABLED',
  );
});
test('rejecting governance makes unchanged draft editable but stale versions remain rejected', async () => {
  const { revision } = await draft();
  const op = await request(revision.id);
  await gov().review.review(
    reviewContext,
    op.id,
    {
      decision: 'REJECT',
      comment: '请补充节点说明和材料配置后重新提交',
      expectedOperationVersion: op.version,
    },
    undefined,
    testGovernanceStepUp(reviewer),
  );
  await service.updateVersion(revision.id, { expectedVersion: 1, content: content() });
  await assert.rejects(
    service.updateVersion(revision.id, { expectedVersion: 1, content: content() }),
    reject('SOP_VERSION_CONFLICT'),
  );
});
test('revoked requester cannot publish from an old governance approval', async () => {
  const { revision } = await draft();
  const op = await request(revision.id);
  await db.userRole.updateMany({
    where: { userId: admin },
    data: { revokedAt: new Date(), revokedByUserId: reviewer, revokeReason: '测试撤销模板发布申请人的权限' },
  });
  await assert.rejects(approve(op.id, op.version));
  assert.equal(
    (await db.sopTemplateVersion.findUniqueOrThrow({ where: { id: revision.id } })).status,
    'DRAFT',
  );
});
test('tampered content digest and wrong organization team pairing fail closed', async () => {
  const { revision } = await draft();
  const op = await request(revision.id);
  await db.sopTemplateVersion.update({
    where: { id: revision.id },
    data: { content: { schemaVersion: 1, nodes: [{ code: 'WRONG', name: 'changed' }] } },
  });
  await assert.rejects(approve(op.id, op.version), reject('SOP_VERSION_CONFLICT'));
  const outsideId = randomUUID();
  const outside = await db.organization.create({
    data: { id: outsideId, code: 'OUTSIDE', name: '外部', type: 'FIRM', path: '/' + outsideId },
  });
  await assert.rejects(
    service.create({ ...input(), organizationId: outside.id }),
    reject('SOP_TARGET_NOT_AVAILABLE'),
  );
});
test('ordinary actor has no implicit template authority or organization directory grant', async () => {
  const user = (await db.user.create({ data: { username: 'ordinary', password: 'unused' } })).id;
  const ctx = await new AuthorizationContextLoader(db).load(user),
    ordinary = new SopTemplateService(db, { actorUserId: user }, ctx);
  await assert.rejects(ordinary.list({}), reject('PERMISSION_DENIED'));
  await assert.rejects(ordinary.create(input()), reject('PERMISSION_DENIED'));
  const noDirectory = {
    ...context,
    permissionCodes: context.permissionCodes.filter((code) => code !== 'organization.read'),
  };
  await assert.rejects(
    new SopTemplateService(db, { actorUserId: admin }, noDirectory).create(input()),
    reject('PERMISSION_DENIED'),
  );
});

test('template scopes constrain list detail edit and directory choices independently', async () => {
  const { template, revision } = await draft();
  const employee = await db.employee.create({
    data: {
      employeeNo: 'SOP_OWNER',
      name: '配置人',
      phone: '13800000000',
      type: 'ADMIN',
      entryDate: new Date(),
    },
  });
  await db.user.update({ where: { id: admin }, data: { employeeId: employee.id } });
  const outsideId = randomUUID();
  await db.organization.create({
    data: { id: outsideId, code: 'OTHER_ORG', name: '另一组织', type: 'FIRM', path: '/' + outsideId },
  });
  const otherTeam = await db.professionalTeam.create({
    data: { code: 'OTHER_TEAM', name: '另一团队', categoryCode: 'MEDICAL', homeOrganizationId: outsideId },
  });
  const otherService = new SopTemplateService(db, { actorUserId: reviewer }, reviewContext);
  const other = await otherService.create({
    ...input(),
    organizationId: outsideId,
    professionalTeamId: otherTeam.id,
  });
  const scopes = await Promise.all([
    db.dataScope.create({ data: { name: '本人', scopeType: 'SELF' } }),
    db.dataScope.create({ data: { name: '组织', scopeType: 'ORG', organizationId: org } }),
    db.dataScope.create({ data: { name: '团队', scopeType: 'TEAM', professionalTeamId: team } }),
  ]);
  for (const scope of scopes) {
    const ctx = {
      ...context,
      employeeId: employee.id,
      isSystemAdmin: false,
      grants: context.grants.map((g) => (g.resource === 'sop_template' ? { ...g, scopeIds: [scope.id] } : g)),
    };
    const scoped = new SopTemplateService(db, { actorUserId: admin }, ctx);
    assert.deepEqual(
      (await scoped.list({})).list.map((t) => t.id),
      [template.id],
    );
    await assert.rejects(scoped.get(other.id), reject('SOP_TEMPLATE_NOT_FOUND'));
    const otherVersion = await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: other.id } });
    await assert.rejects(
      scoped.updateVersion(otherVersion.id, { expectedVersion: 1, content: content() }),
      reject('SOP_VERSION_NOT_FOUND'),
    );
  }
  const none = {
    ...context,
    grants: context.grants.map((g) => (g.resource === 'sop_template' ? { ...g, scopeIds: [] } : g)),
  };
  assert.equal((await new SopTemplateService(db, { actorUserId: admin }, none).list({})).pagination.total, 0);
  assert.equal((await db.sopTemplateVersion.findUniqueOrThrow({ where: { id: revision.id } })).version, 1);
});
test('concurrent creates edits and publication requests have a single durable winner', async () => {
  const data = input();
  const created = await Promise.all([service.create(data), service.create(data)]);
  assert.equal(created[0].id, created[1].id);
  const row = await db.sopTemplateVersion.findFirstOrThrow();
  const updates = await Promise.allSettled([
    service.updateVersion(row.id, { expectedVersion: 1, content: content() }),
    service.updateVersion(row.id, { expectedVersion: 1, content: content() }),
  ]);
  assert.equal(updates.filter((x) => x.status === 'fulfilled').length, 1);
  const requests = await Promise.allSettled([request(row.id), request(row.id)]);
  assert.equal(requests.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(await db.adminOperation.count({ where: { targetId: row.id, status: 'PENDING_REVIEW' } }), 1);
});
test('published reviewer role must remain enabled and SOP references block legacy case deletion', async () => {
  const role = await db.role.create({ data: { code: 'SOP_EXPERT', name: '专家', type: 'BUSINESS' } });
  const data = input();
  data.content.nodes[1].reviewerRoleId = role.id;
  const svc = new SopTemplateService(db, { actorUserId: reviewer }, reviewContext);
  const template = await svc.create(data);
  const revision = await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: template.id } });
  const op = await request(revision.id);
  await db.role.update({ where: { id: role.id }, data: { status: 'DISABLED' } });
  // The existing super-admin authored this draft: first prove author self-review rejection.
  await assert.rejects(approve(op.id, op.version), reject('SOP_REVIEWER_INVALID'));
  const roleData = input();
  roleData.content.nodes[1].reviewerRoleId = role.id;
  await db.role.update({ where: { id: role.id }, data: { status: 'ENABLED' } });
  const manageWithRole = { ...context, permissionCodes: [...context.permissionCodes, 'role.read' as const] };
  const second = await new SopTemplateService(db, { actorUserId: admin }, manageWithRole).create(roleData);
  const secondVersion = await db.sopTemplateVersion.findFirstOrThrow({ where: { templateId: second.id } });
  const secondOp = await request(secondVersion.id);
  await db.role.update({ where: { id: role.id }, data: { status: 'DISABLED' } });
  await assert.rejects(approve(secondOp.id, secondOp.version), reject('SOP_REVIEWER_ROLE_INVALID'));
  const customer = await db.customer.create({
    data: {
      customerNo: 'SOP_CUSTOMER',
      name: '测试客户',
      phone: '13800000000',
      phoneHash: 'test',
      createdBy: admin,
    },
  });
  const caseRow = await db.case.create({
    data: {
      caseNo: 'SOP_CASE',
      title: '流程案件',
      caseType: '医疗纠纷',
      customerId: customer.id,
      createdBy: admin,
      branchId: org,
    },
  });
  await db.sopInstance.create({
    data: { caseId: caseRow.id, templateVersionId: revision.id, createdBy: admin },
  });
  await assert.rejects(
    new CaseService(db, { actorUserId: reviewer }, reviewContext).deleteCase(caseRow.id, { version: 1 }),
    reject('CASE_IN_USE'),
  );
  await assert.rejects(db.case.delete({ where: { id: caseRow.id } }));
  assert.equal(await db.sopInstance.count(), 1);
});
