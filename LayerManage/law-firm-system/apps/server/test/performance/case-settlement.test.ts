import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createTestPrisma, clearTestApplicationData } from '../helpers/test-database';
import { AuthorizationContextLoader } from '../../app/application/authorization/authorization-context-loader';
import { PERMISSION_CATALOG } from '../../app/domain/authorization/permission-catalog';
import { SettlementService } from '../../app/application/performance/settlement-service';
import { calculate, D } from '../../app/application/performance/settlement-calculation';
import {
  bindEarnings,
  markPaid,
  releaseEarnings,
} from '../../app/application/performance/settlement-payroll';
import { PayrollService } from '../../app/application/performance/payroll-service';
import { WorkflowService } from '../../app/application/workflow/workflow-service';
import { PerformanceService } from '../../app/application/performance/performance-service';
import { WorkflowSchema } from '../../app/domain/workflow/schema';

test('decimal formulas, precedence and invalid input', () => {
  assert.equal(calculate('-(0.10 - 金额) * 3 / 2 + 0.01', { 金额: new D('1.10') }).toFixed(2), '1.51');
  for (const invalid of ['基数/0', '基数+', '(基数', '基数()', 'process.exit()', '1 2'])
    assert.throws(() => calculate(invalid, { 基数: new D(10) }));
});

test('team settlement, limited sharing, frozen payroll and director approval', async () => {
  const db = createTestPrisma();
  try {
    await clearTestApplicationData(db);
    const org = await db.organization.create({
      data: { id: 'HQ', code: 'HQ', name: '测试组织', path: '/HQ', type: 'FIRM' },
    });
    async function person(no: string, perms: string[], admin = false) {
      const emp = await db.employee.create({
        data: { employeeNo: no, name: no, phone: '0', entryDate: new Date(), type: 'PARTNER' },
      });
      const u = await db.user.create({ data: { username: no, password: 'unused', employeeId: emp.id } });
      const role = await db.role.create({
        data: {
          name: no,
          code: admin ? 'SYSTEM_SUPER_ADMIN' : no,
          type: admin ? 'SYSTEM' : 'BUSINESS',
          permissions: {
            create: PERMISSION_CATALOG.filter((p) => perms.includes(p.code)).map((p) => ({
              permissionId: p.id,
            })),
          },
        },
      });
      await db.userRole.create({ data: { userId: u.id, roleId: role.id, validFrom: new Date(0) } });
      const ctx = await new AuthorizationContextLoader(db).load(u.id);
      ctx.grants = ctx.grants.map((g) => ({ ...g, scopeIds: ['ALL'] }));
      return new SettlementService(db, ctx);
    }
    const admin = await person(
      'admin',
      PERMISSION_CATALOG.map((p) => p.code),
      true,
    );
    const a = await person('A', ['case.read', 'contract.read']),
      b = await person('B', ['case.read']),
      member = await person('M', []);
    const reviewer = await person('主任', ['approval.read', 'approval.process']);
    const f = await person('财务', [
      'performance.read',
      'performance.create',
      'performance.update',
      'approval.read',
      'approval.apply',
      'approval.process',
    ]);
    async function team(code: string, lead: SettlementService) {
      const t = await db.professionalTeam.create({
        data: { name: code, code, categoryCode: 'LAW', homeOrganizationId: org.id },
      });
      await db.professionalTeamMember.create({
        data: {
          professionalTeamId: t.id,
          employeeId: lead.actor.employeeId!,
          memberRole: 'LEAD',
          startedAt: new Date(0),
        },
      });
      return t.id;
    }
    const ta = await team('律师一组', a),
      tb = await team('律师二组', b);
    await db.professionalTeamMember.create({
      data: {
        professionalTeamId: ta,
        employeeId: member.actor.employeeId!,
        memberRole: 'LAWYER',
        startedAt: new Date(0),
      },
    });
    const period = '2026-11';
    const policy = {
      version: 0,
      basis: 'amount',
      formula: '(基数 - 成本) * 比例 / 100',
      fields: ['成本', '比例', '提成比例'],
      directorId: reviewer.actor.userId,
      financeIds: [f.actor.userId],
    };
    await assert.rejects(a.policy({ ...policy, teamId: ta }), /超级管理员/);
    const personalRule = {
      employeeId: a.actor.employeeId!,
      rate: '60',
      formula: '可分配金额 * 个人提成比例 / 100 + (基数 - 成本) * 比例 / 1000',
    };
    await assert.rejects(admin.policy({ ...policy, teamId: tb, memberRules: [personalRule] }), /在职成员/);
    await assert.rejects(admin.policy({ ...policy, teamId: ta, memberRules: [personalRule, personalRule] }), /一条个人规则/);
    await assert.rejects(admin.policy({ ...policy, teamId: ta, memberRules: [{ ...personalRule, formula: '基本工资 + 1' }] }), /无效/);
    await admin.policy({ ...policy, teamId: ta, memberRules: [personalRule] });
    await admin.policy({ ...policy, teamId: tb });
    const customer = await db.customer.create({
      data: { customerNo: 'C', name: '验收', phone: '0', phoneHash: '0', createdBy: a.actor.userId },
    });
    const contract = await db.contract.create({
      data: {
        contractNo: 'HT-001',
        contractType: 'FORMAL',
        title: '合同',
        customerId: customer.id,
        amount: 20000,
        receivedAmount: 15000,
        professionalTeamId: ta,
        createdBy: a.actor.userId,
      },
    });
    const c = await db.case.create({
      data: {
        caseNo: 'CY-001',
        title: '验收案件',
        caseType: '民事',
        contractId: contract.id,
        lawyerId: a.actor.employeeId,
        intakeData: { handlingLawyer: member.actor.employeeId },
        customerId: customer.id,
      },
    });
    assert.equal((await a.sources('', c.id))[0].lawyer?.id, member.actor.employeeId);
    const body = {
      teamId: ta,
      caseId: c.id,
      policyVersion: 1,
      period,
      basisAmount: 16000,
      inputs: { 成本: 1000, 比例: 80 },
      lines: [
        { employeeId: a.actor.employeeId, rate: 70, adjustment: 0, reason: '' },
        { employeeId: member.actor.employeeId, rate: 30, adjustment: 0, reason: '' },
      ],
    };
    await assert.rejects(b.save(body), /负责人/);
    const id = await a.save(body);
    const initial = (await a.view(period)).rows[0];
    assert.deepEqual(initial.snapshot['customMemberIds'], [personalRule.employeeId]);
    assert.equal(initial.lines.find((line) => line.employeeId === personalRule.employeeId)?.rate.toString(), '60');
    const succeed = async (s: SettlementService, action: string, extra = {}) =>
      s.action(id, {
        action,
        version: (await db.caseSettlement.findUniqueOrThrow({ where: { id } })).version,
        ...extra,
      });
    assert.equal((await a.view(period)).rows[0].snapshot['source'].contractNo, 'HT-001');
    assert.deepEqual((await b.view(period)).rows, []);
    assert.deepEqual((await f.view(period)).rows, []);
    await succeed(a, 'share', { username: 'B', expiresAt: '2099-01-01' });
    assert.equal((await b.view(period)).rows.length, 1);
    await assert.rejects(succeed(b, 'submit'), /无法提交/);
    await succeed(a, 'unshare', { username: 'B' });
    assert.equal((await b.view(period)).rows.length, 0);
    assert.deepEqual((await a.recipients(id, 'B')).map((u) => u.id), [b.actor.userId]);
    await assert.rejects(b.recipients(id, 'A'), /无权/);
    await succeed(a, 'share', { userId: b.actor.userId, expiresAt: '2099-01-01' });
    await succeed(a, 'unshare', { userId: b.actor.userId });
    assert.deepEqual((await a.view(period)).policies.find((p) => p.teamId === ta)?.teamInputFields, ['成本', '比例']);
    const over = await a.save({ ...body, period: '2026-09', lines: [{ ...body.lines[1], rate: 100, adjustment: 1, reason: '调整' }] });
    await assert.rejects(a.action(over, { action: 'submit', version: 1 }), /超过可分配金额/);
    await a.action(over, { action: 'delete', version: 1 });
    for (const existingLead of [false, true]) {
      const lines = existingLead ? [{ ...body.lines[0], adjustment: 10, reason: '奖金' }] : [body.lines[1]];
      const scratch = await a.save({ ...body, period: '2026-10', lines });
      const before = await db.casePayLine.findMany({ where: { settlementId: scratch } });
      const gap = existingLead ? '3590.00' : '8400.00';
      const submit = { action: 'submit', version: 1, leaderId: a.actor.employeeId, remainder: gap };
      await assert.rejects(a.action(scratch, { ...submit, remainder: '1.00' }), /核对差额/);
      await assert.rejects(a.action(scratch, { ...submit, leaderId: member.actor.employeeId }), /负责人/);
      await a.action(scratch, submit);
      const billed = await db.casePayLine.findMany({ where: { settlementId: scratch } });
      assert.equal(billed.reduce((sum, line) => sum.add(line.amount), new D(0)).toFixed(2), '12000.00');
      const leader = billed.find((line) => line.employeeId === a.actor.employeeId)!;
      assert.equal(leader.rate.toString(), existingLead ? '60' : '0');
      assert.equal(leader.adjustment.toString(), existingLead ? '3600' : '8400');
      await f.action(scratch, { action: 'return', version: 2, reason: '复核' });
      assert.deepEqual(await db.casePayLine.findMany({ where: { settlementId: scratch } }), before);
      await a.action(scratch, { action: 'delete', version: 3 });
    }
    await succeed(a, 'submit');
    assert.deepEqual(
      (await f.view(period)).rows[0].lines.map((l) => l.amount.toString()),
      ['8400', '3600'],
    );
    await assert.rejects(succeed(a, 'confirm'), /财务/);
    await succeed(f, 'confirm');
    const second = await a.save({ ...body, period: '2026-12' });
    await assert.rejects(a.action(second, { action: 'submit', version: 1 }), /超过来源金额/);
    await a.action(second, { action: 'delete', version: 1 });
    const otherCase = await db.case.create({
      data: { caseNo: 'CY-B', title: '二组案件', caseType: '民事', fee: 2000, customerId: customer.id },
    });
    const idB = await b.save({
      ...body,
      teamId: tb,
      caseId: otherCase.id,
      basisAmount: 1000,
      inputs: { 成本: 0, 比例: 100 },
      lines: [{ employeeId: b.actor.employeeId, rate: 100, adjustment: 0, reason: '' }],
    });
    await b.action(idB, { action: 'submit', version: 1 });
    await f.action(idB, { action: 'confirm', version: 2 });
    assert.equal((await f.view(period)).rows.length, 2);
    assert.deepEqual(
      (await a.view(period)).rows.map((r) => r.id),
      [id],
    );
    assert.deepEqual(
      (await b.view(period)).rows.map((r) => r.id),
      [idB],
    );
    const rec = await db.performance.create({
      data: { employeeId: a.actor.employeeId!, type: 'QUARTERLY', period: '2026-12', kpiData: '{}' },
    });
    const metrics = await new PerformanceService(
      db,
      { actorUserId: admin.actor.userId },
      admin.actor,
    ).getBusinessMetrics(rec.id);
    assert.equal(metrics.caseEarnings, '8400.00');
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('工资');
    sheet.addRows([
      ['员工编号', '原工资', '案件绩效'],
      ['M', 5000, null],
      ['A', 3000, null],
      ['B', 2000, null],
    ]);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const file = await db.approvalAttachment.create({
      data: {
        ownerUserId: f.actor.userId,
        fileName: '工资.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes,
        fileSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    });
    const payroll = new PayrollService(db, { actorUserId: f.actor.userId }, f.actor);
    const batch = await payroll.save({ period, title: '工资验收', attachmentId: file.id });
    await assert.rejects(bindEarnings(b, batch.id, { ids: [id, idB], version: 1 }));
    await Promise.all([1, 2].map(() => bindEarnings(f, batch.id, { ids: [id, idB], version: 1 })));
    assert.equal(await db.operationLog.count({ where: { action: 'CASE_PAY_PAYROLL' } }), 1);
    await releaseEarnings(f, batch.id, { version: 2 });
    assert.equal((await payroll.get(batch.id)).attachmentId, file.id);
    assert.equal((await f.view(period)).rows[0].status, 'CONFIRMED');
    await bindEarnings(f, batch.id, { version: 3, ids: [id, idB] });
    const merged = await db.payrollBatch.findUniqueOrThrow({
      where: { id: batch.id },
      include: { attachment: true },
    });
    await book.xlsx.load(Uint8Array.from(merged.attachment.bytes).buffer);
    assert.deepEqual(book.worksheets[0].getRow(2).values.slice(1), ['M', 5000, 3600]);
    assert.deepEqual(book.worksheets[0].getRow(3).values.slice(1), ['A', 3000, 8400]);
    assert.deepEqual(book.worksheets[0].getRow(4).values.slice(1), ['B', 2000, 1000]);
    await assert.rejects(
      payroll.save({ period, title: '修改', attachmentId: file.id, version: merged.version }, batch.id),
    );
    await assert.rejects(markPaid(f, id), /审批/);
    const schema: WorkflowSchema = {
      fields: [{ key: 'title', label: '标题', type: 'text' }],
      nodes: [
        { id: 's', name: '开始', type: 'START', x: 0, y: 0 },
        {
          id: 'r',
          name: '主任审核',
          type: 'APPROVAL',
          x: 100,
          y: 0,
          rule: { type: 'USER', ids: [reviewer.actor.userId] },
          mode: 'ALL',
        },
        { id: 'e', name: '结束', type: 'END', x: 200, y: 0 },
      ],
      edges: [
        { id: '1', from: 's', to: 'r' },
        { id: '2', from: 'r', to: 'e' },
      ],
      settings: { allowCorrection: false },
    };
    const definition = await new WorkflowService(db, admin.actor).saveDefinition(undefined, {
      name: '主任工资审批',
      schema,
      publish: true,
    });
    const instance = await new WorkflowService(db, f.actor).start(
      {
        definitionId: definition.id,
        title: '工资',
        content: { title: '工资' },
        payrollBatchId: batch.id,
        payrollVersion: merged.version,
      },
      randomUUID(),
    );
    await new WorkflowService(db, reviewer.actor).act(
      instance.id,
      { action: 'APPROVE', version: instance.version },
      randomUUID(),
    );
    await admin.policy({ ...policy, teamId: ta, version: 1, memberRules: [] });
    await assert.rejects(a.save({ ...body, period: '2027-01' }), /新规则/);
    const fallbackId = await a.save({ ...body, period: '2027-01', policyVersion: 2 });
    const fallback = await db.caseSettlement.findUniqueOrThrow({ where: { id: fallbackId }, include: { lines: true } });
    assert.equal(fallback.lines.find((line) => line.employeeId === personalRule.employeeId)?.rate.toString(), '70');
    assert.deepEqual(fallback.snapshot['customMemberIds'], []);
    assert.equal((await a.view(period)).rows[0].snapshot['policyVersion'], 1);
    await markPaid(f, id);
    assert.equal((await f.view(period)).rows[0].status, 'PAID');
    assert.equal(await db.operationLog.count({ where: { action: 'CASE_PAY_PAYROLL' } }), 2);
  } finally {
    await clearTestApplicationData(db);
    await db.$disconnect();
  }
});
