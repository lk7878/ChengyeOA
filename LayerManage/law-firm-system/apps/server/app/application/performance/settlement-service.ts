import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildContractScopeWhere } from '../contract/contract-scope';
import { buildCaseScopeWhere } from '../case/case-scope';
import { check } from '../../domain/workflow/schema';
import { object, text } from '../collaboration/collaboration-policy';
import { calculate, decimal, D, policyFields } from './settlement-calculation';

type Tx = Prisma.TransactionClient;
const activeTeam: Prisma.ProfessionalTeamWhereInput = { deletedAt: null, status: 'ENABLED' } as const;
const activeEmployee: Prisma.EmployeeWhereInput = { deletedAt: null, status: { not: 'LEAVED' } };
const employees = { select: { id: true, name: true, employeeNo: true } } as const;
const lineOrder = { orderBy: { employeeNo: 'asc' as const } };

export function payPeriod(value: unknown) {
  check(typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value), '请选择结算月份');
  return value;
}
export async function payLog(
  tx: Tx,
  actor: AuthorizationContext,
  id: string,
  action: string,
  detail: unknown,
) {
  await tx.operationLog.create({
    data: {
      userId: actor.userId,
      targetType: 'CASE_PERFORMANCE',
      targetId: id,
      action,
      newValues: JSON.stringify(detail),
    },
  });
}
export class SettlementService {
  constructor(
    readonly db: PrismaClient,
    readonly actor: AuthorizationContext,
  ) {}
  async rights(tx: Tx = this.db) {
    const { employeeId, userId, isSystemSuperAdmin: admin } = this.actor;
    const leads = employeeId
      ? await tx.professionalTeamMember.findMany({
          where: {
            employeeId,
            memberRole: 'LEAD',
            startedAt: { lte: new Date() },
            endedAt: null,
            employee: activeEmployee,
            professionalTeam: activeTeam,
          },
          select: { professionalTeamId: true },
        })
      : [];
    const lead = leads.map((m) => m.professionalTeamId);
    const policies = await tx.casePayPolicy.findMany({
      where: admin ? {} : { OR: [{ teamId: { in: lead } }, { financeIds: { has: userId } }] },
    });
    const finance = policies.filter((p) => admin || p.financeIds.includes(userId)).map((p) => p.teamId);
    const visible: Prisma.CaseSettlementWhereInput = admin
      ? {}
      : {
          OR: [
            { teamId: { in: lead } },
            { teamId: { in: finance }, status: { not: 'DRAFT' } },
            { shares: { some: { userId, expiresAt: { gt: new Date() } } } },
          ],
        };
    return { lead, finance, visible, admin, policies };
  }
  async view(period: string) {
    payPeriod(period);
    const r = await this.rights();
    const rows = await this.db.caseSettlement.findMany({
      where: { AND: [{ period }, r.visible] },
      include: { lines: lineOrder },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    const teams = await this.db.professionalTeam.findMany({
      where: {
        ...activeTeam,
        ...(r.admin ? {} : { id: { in: [...r.lead, ...r.finance, ...rows.map((s) => s.teamId)] } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const editable = teams.filter((t) => r.admin || r.lead.includes(t.id)).map((t) => t.id);
    const members = await this.db.professionalTeamMember.findMany({
      where: {
        professionalTeamId: { in: editable },
        startedAt: { lte: new Date() },
        endedAt: null,
        employee: activeEmployee,
      },
      select: { professionalTeamId: true, employee: employees },
    });
    const accounts = r.admin
      ? await this.db.user.findMany({
          where: { status: 'ENABLED' },
          select: { id: true, username: true, employee: { select: { name: true } } },
          orderBy: { username: 'asc' },
        })
      : [];
    const canPayroll =
      this.actor.permissionCodes.includes('performance.update') &&
      this.actor.permissionCodes.includes('approval.apply') &&
      this.actor.permissionCodes.includes('performance.read');
    const drafts =
      canPayroll && r.finance.length
        ? await this.db.payrollBatch.findMany({
            where: { ownerUserId: this.actor.userId, period, instanceId: null, workflowInstanceId: null },
            select: { id: true, title: true, version: true },
            orderBy: { createdAt: 'desc' },
          })
        : [];
    const batchIds = rows
      .filter((row) => r.finance.includes(row.teamId))
      .flatMap((row) => (row.payrollId ? [row.payrollId] : []));
    const batches = await this.db.payrollBatch.findMany({
      where: { id: { in: batchIds } },
      select: {
        id: true,
        title: true,
        version: true,
        ownerUserId: true,
        instance: { select: { status: true } },
        workflow: { select: { status: true } },
      },
    });
    return {
      rows,
      teams,
      members,
      editable,
      finance: r.finance,
      admin: r.admin,
      accounts,
      drafts,
      batches: batches.map((b) => ({
        id: b.id,
        title: b.title,
        version: b.version,
        owner: b.ownerUserId === this.actor.userId,
        status: (b.workflow ?? b.instance)?.status ?? 'DRAFT',
      })),
      policies: r.policies.map((p) => ({ ...p, financeIds: r.admin ? p.financeIds : [] })),
    };
  }
  async sources(query: string, id?: string, tx: Tx = this.db) {
    const scope = await buildCaseScopeWhere(this.db, this.actor, 'case.read', tx);
    const contractScope = this.actor.permissionCodes.includes('contract.read')
      ? await buildContractScopeWhere(
          this.db,
          new AuthorizationService(new DataScopeService(this.db)),
          this.actor,
          'contract.read',
        )
      : { id: { in: [] as string[] } };
    const rows = await tx.case.findMany({
      where: {
        AND: [
          scope,
          { OR: [{ contractId: null }, { contract: { AND: [contractScope, { deletedAt: null }] } }] },
          id
            ? { id }
            : {
                OR: [
                  { caseNo: { contains: query, mode: 'insensitive' } },
                  { title: { contains: query, mode: 'insensitive' } },
                  { contract: { contractNo: { contains: query, mode: 'insensitive' } } },
                ],
              },
        ],
      },
      select: {
        id: true,
        title: true,
        caseNo: true,
        fee: true,
        intakeData: true,
        lawyer: employees,
        contract: { select: { id: true, contractNo: true, amount: true, receivedAmount: true } },
      },
      orderBy: { caseNo: 'asc' },
      take: 50,
    });
    return rows.map((c) => {
      const intake = (c.intakeData ?? {}) as Record<string, unknown>;
      return {
        id: c.id,
        title: c.title,
        caseNo: c.caseNo,
        lawyer: c.lawyer,
        contractId: c.contract?.id ?? null,
        contractNo: c.contract?.contractNo ?? String(intake.contractNumber ?? ''),
        amount: String(c.contract?.amount ?? c.fee),
        received: String(c.contract?.receivedAmount ?? intake.totalReceivedAmount ?? 0),
      };
    });
  }
  async policy(raw: unknown) {
    check(this.actor.isSystemSuperAdmin, '仅超级管理员可设置规则', 403);
    const b = object(raw),
      teamId = text(b.teamId),
      fields = policyFields(b.fields),
      formula = text(b.formula, 250);
    const basis = text(b.basis);
    check(basis === 'received' || basis === 'amount', '请选择结算依据');
    calculate(formula, Object.fromEntries(['基数', ...fields].map((f) => [f, new D(1)])), true);
    check(Array.isArray(b.financeIds) && b.financeIds.length <= 100, '财务授权无效');
    const financeIds = [...new Set(b.financeIds.map((id) => text(id)))];
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM professional_team WHERE id=${teamId} FOR UPDATE`;
      check(await tx.professionalTeam.count({ where: { id: teamId, ...activeTeam } }), '团队不可用');
      check(
        (await tx.user.count({ where: { id: { in: financeIds }, status: 'ENABLED' } })) === financeIds.length,
        '财务账号不可用',
      );
      const old = await tx.casePayPolicy.findUnique({ where: { teamId } });
      check((old?.version ?? 0) === b.version, '规则已更新，请刷新', 409);
      const directorId = text(b.directorId);
      check(
        await tx.user.count({ where: { id: directorId, status: 'ENABLED' } }),
        '请选择启用的主任审核账号',
      );
      const data = { basis, formula, fields, financeIds, directorId };
      await tx.casePayPolicy.upsert({
        where: { teamId },
        create: { teamId, ...data },
        update: { ...data, version: { increment: 1 } },
      });
      await payLog(tx, this.actor, teamId, 'CASE_PAY_POLICY', { ...data, version: (old?.version ?? 0) + 1 });
    });
  }
  async save(raw: unknown) {
    const b = object(raw),
      teamId = text(b.teamId),
      caseId = text(b.caseId),
      period = payPeriod(b.period);
    const inputs = object(b.inputs),
      basis = decimal(b.basisAmount, '本期基数');
    check(basis.gt(0), '本期基数须大于零');
    check(Array.isArray(b.lines) && b.lines.length <= 200, '分配明细无效');
    const items = b.lines.map(object);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM professional_team WHERE id=${teamId} FOR UPDATE`;
      if (b.id) await tx.$queryRaw`SELECT id FROM case_settlement WHERE id=${text(b.id)} FOR UPDATE`;
      const r = await this.rights(tx);
      check(r.admin || r.lead.includes(teamId), '仅本团队负责人可填写', 403);
      check(await tx.professionalTeam.count({ where: { id: teamId, ...activeTeam } }), '团队不可用');
      const policy = r.policies.find((p) => p.teamId === teamId);
      check(policy && policy.version === b.policyVersion, '请先配置团队规则，或刷新读取新规则', 409);
      const source = (await this.sources('', caseId, tx))[0];
      check(source, '案件或关联合同不可访问', 404);
      const limit = decimal(policy.basis === 'amount' ? source.amount : source.received, '关联金额');
      check(basis.lte(limit), '本期基数超过来源金额');
      const fields = policyFields(policy.fields);
      const values = Object.fromEntries(fields.map((f) => [f, decimal(inputs[f], f, 4)]));
      const pool = calculate(policy.formula, { 基数: basis, ...values });
      const roster = await tx.professionalTeamMember.findMany({
        where: {
          professionalTeamId: teamId,
          endedAt: null,
          startedAt: { lte: new Date() },
          employee: activeEmployee,
        },
        select: { employee: employees },
      });
      const seen = new Set<string>();
      const lines = items.map((item) => {
        const employee = roster.find((m) => m.employee.id === item.employeeId)?.employee;
        check(employee && !seen.has(employee.id), '成员须属于当前团队且只能分配一次');
        seen.add(employee.id);
        const rate = decimal(item.rate, '比例', 4),
          adjustment = decimal(item.adjustment, '调整额');
        const reason = String(item.reason ?? '').trim();
        check(
          rate.gte(0) && rate.lte(100) && reason.length <= 300 && (adjustment.isZero() || reason),
          '请核对比例，并注明调整原因',
        );
        const amount = pool.mul(rate).div(100).toDecimalPlaces(2).add(adjustment);
        check(amount.gte(0) && amount.lt('10000000000000000'), '分配金额超出范围');
        return {
          employeeId: employee.id,
          employeeNo: employee.employeeNo,
          name: employee.name,
          rate,
          adjustment,
          reason,
          amount,
        };
      });
      const data = {
        teamId,
        caseId,
        contractId: source.contractId,
        period,
        basisAmount: basis,
        pool,
        snapshot: {
          source,
          directorId: policy.directorId,
          formula: policy.formula,
          policyVersion: policy.version,
          basis: policy.basis,
          inputs: Object.fromEntries(fields.map((f) => [f, values[f].toString()])),
        },
      };
      const old = await tx.caseSettlement.findUnique({
        where: { teamId_caseId_period: { teamId, caseId, period } },
      });
      check(
        b.id ? old?.id === b.id && old?.status === 'DRAFT' && old.version === b.version : !old,
        '同团队同月已有此案件，或本行已被修改',
        409,
      );
      const row = old
        ? await tx.caseSettlement.update({
            where: { id: old.id },
            data: { ...data, version: { increment: 1 }, lines: { deleteMany: {}, create: lines } },
          })
        : await tx.caseSettlement.create({ data: { ...data, lines: { create: lines } } });
      await payLog(tx, this.actor, row.id, 'CASE_PAY_SAVE', { version: row.version });
      return row.id;
    });
  }
  async action(id: string, raw: unknown) {
    const b = object(raw);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM case_settlement WHERE id=${id} FOR UPDATE`;
      const r = await this.rights(tx);
      const row = await tx.caseSettlement.findFirst({
        where: { AND: [{ id }, r.visible] },
        include: { lines: true },
      });
      check(row, '记录不可访问', 404);
      const editor = r.admin || r.lead.includes(row.teamId),
        finance = r.admin || r.finance.includes(row.teamId);
      check(row.version === b.version, '记录已更新，请刷新', 409);
      const action = text(b.action);
      let status = row.status,
        remark = row.remark;
      if (action === 'delete') {
        check(editor && row.status === 'DRAFT', '仅可删除本团队结算草稿', 403);
        await tx.caseSettlement.delete({ where: { id } });
        await payLog(tx, this.actor, id, 'CASE_PAY_DELETE', { version: row.version });
        return;
      }
      if (action === 'share' || action === 'unshare') {
        check(editor, '仅团队负责人或管理员可调整共享', 403);
        const user = await tx.user.findFirst({
          where: { username: text(b.username), status: 'ENABLED' },
          select: { id: true },
        });
        check(user, '未找到启用账号');
        if (action === 'share') {
          const expiresAt = new Date(text(b.expiresAt));
          check(expiresAt.getTime() > Date.now(), '共享截止时间无效');
          await tx.casePayShare.upsert({
            where: { settlementId_userId: { settlementId: id, userId: user.id } },
            create: { settlementId: id, userId: user.id, expiresAt },
            update: { expiresAt },
          });
        } else await tx.casePayShare.deleteMany({ where: { settlementId: id, userId: user.id } });
      } else if (action === 'submit') {
        check(editor && status === 'DRAFT', '当前记录无法提交', 403);
        check(
          row.lines.length && row.lines.reduce((s, l) => s.add(l.amount), new D(0)).eq(row.pool),
          '成员分配合计必须等于可分配金额',
        );
        const source = (await this.sources('', row.caseId, tx))[0];
        const snap = object(row.snapshot),
          policy = r.policies.find((p) => p.teamId === row.teamId);
        check(
          policy?.version === snap.policyVersion &&
            source &&
            Object.entries(source).every(([key, value]) => {
              const original = object(snap.source)[key];
              return key === 'lawyer'
                ? (value as { id?: string } | null)?.id === (original as { id?: string } | null)?.id
                : value === original;
            }),
          '来源或规则已更新，请重新保存草稿',
          409,
        );
        const members = await tx.professionalTeamMember.count({
          where: {
            professionalTeamId: row.teamId,
            endedAt: null,
            startedAt: { lte: new Date() },
            employee: activeEmployee,
            employeeId: { in: row.lines.map((l) => l.employeeId) },
          },
        });
        check(members === row.lines.length, '团队成员已变更，请重新分配');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.caseId},0))`;
        const used = await tx.caseSettlement.aggregate({
          where: { caseId: row.caseId, status: { not: 'DRAFT' }, id: { not: id } },
          _sum: { basisAmount: true },
        });
        check(
          new D(used._sum.basisAmount ?? 0)
            .add(row.basisAmount)
            .lte(snap.basis === 'amount' ? source.amount : source.received),
          '历次结算基数合计超过来源金额',
        );
        status = 'SUBMITTED';
      } else if (action === 'confirm') {
        check(finance && status === 'SUBMITTED', '仅授权财务可确认已提交记录', 403);
        status = 'CONFIRMED';
      } else if (action === 'return') {
        check(
          finance && ['SUBMITTED', 'CONFIRMED'].includes(status) && !row.payrollId,
          '当前记录不可退回',
          403,
        );
        remark = text(b.reason, 300);
        status = 'DRAFT';
      } else check(false, '未知操作');
      await tx.caseSettlement.update({ where: { id }, data: { status, remark, version: { increment: 1 } } });
      await payLog(tx, this.actor, id, 'CASE_PAY_' + action.toUpperCase(), {
        status,
        remark,
        username: b.username,
        expiresAt: b.expiresAt,
      });
    });
  }
}
