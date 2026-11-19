import { handlingLawyers } from '../case/handling-lawyer';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { buildContractScopeWhere } from '../contract/contract-scope';
import { buildCaseScopeWhere } from '../case/case-scope';
import { check } from '../../domain/workflow/schema';
import { object, text } from '../collaboration/collaboration-policy';
import { calculate, decimal, D, policyFields, referencedFields } from './settlement-calculation';

import { readMemberRules, type MemberRule } from './settlement-member-rules';

import { allocateRemainder, undoRemainder } from './settlement-remainder';

import {
  activeEmployee,
  activeTeam,
  personFields,
  personalScope,
  caseAssignment,
  checkInitiator,
  lockCost,
  allocated,
} from './settlement-scope';

type Tx = Prisma.TransactionClient;
const employees = { select: personFields } as const;
const lineOrder = { orderBy: { employeeNo: 'asc' as const } };

function settlementTeam(input: Record<string, unknown>) {
  check(input.mode === undefined || input.mode === 'team' || input.mode === 'personal', '办案方式无效');
  if (input.mode !== 'personal') return text(input.teamId);
  check(!input.teamId, '个人办案不能指定团队');
  return null;
}

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
    const { userId, isSystemSuperAdmin: admin } = this.actor;
    const person =
      this.actor.employeeId &&
      (await tx.employee.findFirst({
        where: { id: this.actor.employeeId, ...activeEmployee },
        select: personFields,
      }));
    const employeeId = person?.id;
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
      where: admin
        ? {}
        : {
            OR: [
              { teamId: { in: lead } },
              ...(employeeId ? [{ scopeId: { in: ['personal', personalScope(employeeId)] } }] : []),
              { financeIds: { has: userId } },
            ],
          },
    });
    const finance = policies.filter((p) => admin || p.financeIds.includes(userId)).map((p) => p.scopeId);
    const visible: Prisma.CaseSettlementWhereInput = admin
      ? {}
      : {
          OR: [
            { teamId: { in: lead } },
            ...(employeeId ? [{ ownerEmployeeId: employeeId }] : []),
            { policyId: { in: finance }, status: { not: 'DRAFT' } },
            { shares: { some: { userId, expiresAt: { gt: new Date() } } } },
          ],
        };
    return { lead, finance, visible, admin, policies, person, employeeId };
  }
  async view(period: string) {
    payPeriod(period);
    const r = await this.rights();
    const rows = await this.db.caseSettlement.findMany({
      where: { AND: [{ period }, r.visible] },
      include: { lines: lineOrder, owner: employees, case: { select: { lawyerId: true, intakeData: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    const teams = await this.db.professionalTeam.findMany({
      where: {
        ...activeTeam,
        ...(r.admin
          ? {}
          : { id: { in: [...r.lead, ...r.finance, ...rows.flatMap((s) => (s.teamId ? [s.teamId] : []))] } }),
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
      select: { professionalTeamId: true, memberRole: true, employee: employees },
    });
    const directory =
      r.admin || (r.person && this.actor.permissionCodes.includes('case.read'))
        ? await this.db.employee.findMany({
            where: activeEmployee,
            select: personFields,
            orderBy: [{ name: 'asc' }, { employeeNo: 'asc' }],
          })
        : [];
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
      .filter((row) => r.finance.includes(row.policyId))
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
      rows: rows.map(({ case: matter, ...row }) => ({
        ...row,
        mode: row.teamId ? 'team' : 'personal',
        canSettle:
          !!r.employeeId &&
          (row.teamId ? r.lead.includes(row.teamId) : row.ownerEmployeeId === r.employeeId) &&
          (matter.lawyerId === r.employeeId ||
            (matter.intakeData as Record<string, unknown> | null)?.handlingLawyer === r.employeeId),
      })),
      teams,
      person: r.person || null,
      leads: r.lead,
      directory,
      costs: await this.db.casePayMonthCost.findMany({
        where: { period, scope: { in: [...r.lead, ...(r.employeeId ? [personalScope(r.employeeId)] : [])] } },
      }),
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
      policies: r.policies.map((p) => ({
        ...p,
        teamInputFields: referencedFields(policyFields(p.fields), [p.formula]),
        memberRules:
          r.admin ||
          editable.includes(p.teamId) ||
          (!p.teamId && r.employeeId && (!p.employeeId || p.employeeId === r.employeeId))
            ? (p.memberRules as MemberRule[]).map(({ employeeId, rate, formula }) => ({
                employeeId,
                rate,
                formula: r.admin ? formula : undefined,
                inputFields: referencedFields(policyFields(p.fields), [formula]),
              }))
            : [],
        financeIds: r.admin ? p.financeIds : [],
      })),
    };
  }
  async recipients(id: string, query: string) {
    const rights = await this.rights();
    check(
      await this.db.caseSettlement.count({
        where: {
          id,
          ...(rights.admin
            ? {}
            : {
                OR: [
                  { teamId: { in: rights.lead } },
                  ...(rights.employeeId ? [{ ownerEmployeeId: rights.employeeId }] : []),
                ],
              }),
        },
      }),
      '无权管理此结算单的共享',
      403,
    );
    return this.db.user.findMany({
      where: {
        status: 'ENABLED',
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { employee: { name: { contains: query, mode: 'insensitive' } } },
        ],
      },
      select: { id: true, username: true, employee: { select: { name: true } } },
      orderBy: { username: 'asc' },
      take: 40,
    });
  }
  async sources(
    query: string,
    id?: string,
    tx: Tx = this.db,
    teamId: string | null = null,
    rights?: Awaited<ReturnType<SettlementService['rights']>>,
  ) {
    const r = rights ?? (await this.rights(tx));
    checkInitiator(r.employeeId, teamId, r.lead);
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
          caseAssignment(r.employeeId, teamId),
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
        caseSettlement: {
          select: { id: true, teamId: true, ownerEmployeeId: true, period: true, status: true },
        },
        id: true,
        title: true,
        caseNo: true,
        fee: true,
        intakeData: true,
        teamIds: true,
        contract: {
          select: {
            id: true,
            professionalTeamId: true,
            contractNo: true,
            amount: true,
            receivedAmount: true,
          },
        },
      },
      orderBy: { caseNo: 'asc' },
      take: 50,
    });
    const byId = await handlingLawyers(
      tx,
      rows.map((c) => (c.intakeData as Record<string, unknown> | null)?.handlingLawyer),
    );
    return rows
      .filter((c) => {
        if (c.contract?.professionalTeamId || !c.teamIds) return true;
        try {
          const teams: unknown = JSON.parse(c.teamIds);
          return (
            Array.isArray(teams) &&
            teams.every((t) => typeof t === 'string') &&
            (!teams.length || teams.includes(teamId))
          );
        } catch {
          return false;
        }
      })
      .map((c) => {
        const intake = (c.intakeData ?? {}) as Record<string, unknown>;
        return {
          ...(id
            ? {}
            : {
                existing: c.caseSettlement
                  ? {
                      status: '已有结算',
                      ...(c.caseSettlement.teamId === teamId &&
                      (teamId || c.caseSettlement.ownerEmployeeId === r.employeeId)
                        ? { id: c.caseSettlement.id, period: c.caseSettlement.period }
                        : {}),
                    }
                  : null,
              }),
          id: c.id,
          title: c.title,
          caseNo: c.caseNo,
          lawyer: byId.get(String(intake.handlingLawyer ?? '')) ?? null,
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
      teamId = settlementTeam(b),
      fields = policyFields(b.fields),
      formula = text(b.formula, 250);
    const basis = text(b.basis);
    check(basis === 'received' || basis === 'amount', '请选择结算依据');
    calculate(formula, Object.fromEntries(['基数', ...fields].map((f) => [f, new D(1)])), true);
    check(Array.isArray(b.financeIds) && b.financeIds.length <= 100, '财务授权无效');
    const financeIds = [...new Set(b.financeIds.map((id) => text(id)))];
    const employeeId = !teamId && b.employeeId ? text(b.employeeId) : null;
    const scopeId = teamId ?? (employeeId ? personalScope(employeeId) : 'personal');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scopeId},2))`;
      if (teamId)
        check(await tx.professionalTeam.count({ where: { id: teamId, ...activeTeam } }), '团队不可用');
      if (employeeId)
        check(await tx.employee.count({ where: { id: employeeId, ...activeEmployee } }), '人员不可用');
      check(
        (await tx.user.count({ where: { id: { in: financeIds }, status: 'ENABLED' } })) === financeIds.length,
        '财务账号不可用',
      );
      const old = await tx.casePayPolicy.findUnique({ where: { scopeId } });
      check((old?.version ?? 0) === b.version, '规则已更新，请刷新', 409);
      const directorId = text(b.directorId);
      check(
        await tx.user.count({ where: { id: directorId, status: 'ENABLED' } }),
        '请选择启用的主任审核账号',
      );
      const memberRules = readMemberRules(
        b.memberRules === undefined ? (old?.memberRules ?? []) : b.memberRules,
        fields,
      );
      if (!teamId && memberRules.length)
        check(
          (await tx.employee.count({
            where: { ...activeEmployee, id: { in: memberRules.map((m) => m.employeeId) } },
          })) === memberRules.length,
          '成员不可用',
        );
      if (teamId && memberRules.length) {
        const roster = await tx.professionalTeamMember.findMany({
          where: {
            professionalTeamId: teamId,
            startedAt: { lte: new Date() },
            endedAt: null,
            employee: activeEmployee,
            employeeId: { in: memberRules.map((rule) => rule.employeeId) },
          },
          select: { employeeId: true },
        });
        check(
          new Set(roster.map((m) => m.employeeId)).size === memberRules.length,
          '个人规则只能配置给当前团队的在职成员',
        );
      }
      const data = { basis, formula, fields, financeIds, directorId, memberRules };
      await tx.casePayPolicy.upsert({
        where: { scopeId },
        create: { scopeId, teamId, employeeId, ...data },
        update: { ...data, version: { increment: 1 } },
      });
      await payLog(tx, this.actor, scopeId, 'CASE_PAY_POLICY', { ...data, version: (old?.version ?? 0) + 1 });
    });
  }
  async cost(raw: unknown) {
    const b = object(raw),
      period = payPeriod(b.period);
    const teamId = settlementTeam(b);
    const amount = decimal(b.amount, '月度成本');
    check(amount.gte(0), '月度成本不能为负');
    return this.db.$transaction(async (tx) => {
      const r = await this.rights(tx);
      checkInitiator(r.employeeId, teamId, r.lead);
      const scope = teamId ?? personalScope(r.employeeId);
      await lockCost(tx, scope, period);
      const key = { scope_period: { scope, period } };
      const old = await tx.casePayMonthCost.findUnique({ where: key });
      check((old?.version ?? 0) === b.version, '月度成本已更新，请刷新', 409);
      check(amount.gte(await allocated(tx, teamId, r.employeeId, period)), '月度成本低于已分摊金额');
      await tx.casePayMonthCost.upsert({
        where: key,
        create: { scope, period, amount },
        update: { amount, version: { increment: 1 } },
      });
      await payLog(tx, this.actor, scope, 'CASE_PAY_COST', { period, amount: amount.toString() });
    });
  }
  async save(raw: unknown) {
    const b = object(raw),
      teamId = settlementTeam(b),
      caseId = text(b.caseId),
      period = payPeriod(b.period);
    const inputs = object(b.inputs),
      basis = decimal(b.basisAmount, '本期基数');
    check(basis.gt(0), '本期基数须大于零');
    check(Array.isArray(b.lines) && b.lines.length <= 200, '分配明细无效');
    const items = b.lines.map(object);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${caseId},0))`;
      if (b.id) await tx.$queryRaw`SELECT id FROM case_settlement WHERE id=${text(b.id)} FOR UPDATE`;
      const r = await this.rights(tx);
      checkInitiator(r.employeeId, teamId, r.lead);
      const ownerEmployeeId = teamId ? null : r.employeeId;
      const policy = teamId
        ? r.policies.find((p) => p.teamId === teamId)
        : (r.policies.find((p) => p.employeeId === ownerEmployeeId) ??
          r.policies.find((p) => p.scopeId === 'personal'));
      check(
        policy && policy.version === b.policyVersion && (!b.policyId || b.policyId === policy.scopeId),
        '请先配置适用规则，或刷新读取新规则',
        409,
      );
      const source = (await this.sources('', caseId, tx, teamId, r))[0];
      check(source, '案件或关联合同不可访问', 404);
      const limit = decimal(policy.basis === 'amount' ? source.amount : source.received, '关联金额');
      check(basis.lte(limit), '本期基数超过来源金额');
      const memberRules = policy.memberRules as MemberRule[];
      const selectedIds = new Set(items.map((item) => item.employeeId));
      const fields = referencedFields(policyFields(policy.fields), [
        policy.formula,
        ...memberRules.filter((rule) => selectedIds.has(rule.employeeId)).map((rule) => rule.formula),
      ]);
      const values = Object.fromEntries(fields.map((f) => [f, decimal(inputs[f], f, 4)]));
      const gross = calculate(policy.formula, { 基数: basis, ...values });
      const cost = decimal(b.allocatedCost ?? '0', '本案分摊成本');
      const scope = teamId ?? personalScope(ownerEmployeeId);
      await lockCost(tx, scope, period);
      check(cost.gte(0) && gross.gte(cost), '分摊成本须在零与本案可分配金额之间');
      if (cost.gt(0)) {
        const budget = await tx.casePayMonthCost.findUnique({ where: { scope_period: { scope, period } } });
        check(
          budget &&
            cost
              .add(await allocated(tx, teamId, ownerEmployeeId, period, b.id ? text(b.id) : undefined))
              .lte(budget.amount),
          '超过本月剩余可分摊成本',
        );
      }
      const pool = gross.sub(cost);
      const roster = teamId
        ? await tx.professionalTeamMember.findMany({
            where: {
              professionalTeamId: teamId,
              endedAt: null,
              startedAt: { lte: new Date() },
              employee: activeEmployee,
            },
            select: { employee: employees },
          })
        : (
            await tx.employee.findMany({
              where: { ...activeEmployee, id: { in: items.map((i) => text(i.employeeId)) } },
              select: personFields,
            })
          ).map((employee) => ({ employee }));
      const seen = new Set<string>();
      const lines = items.map((item) => {
        const employee = roster.find((m) => m.employee.id === item.employeeId)?.employee;
        check(
          employee && !seen.has(employee.id),
          teamId ? '成员须属于当前团队且只能分配一次' : '请选择在职员工，每人只能分配一次',
        );
        seen.add(employee.id);
        const rule = memberRules.find((r) => r.employeeId === employee.id);
        const rate = rule ? new D(rule.rate) : decimal(item.rate, '比例', 4),
          adjustment = decimal(item.adjustment, '调整额');
        const reason = String(item.reason ?? '').trim();
        check(
          rate.gte(0) && rate.lte(100) && reason.length <= 300 && (adjustment.isZero() || reason),
          '请核对比例，并注明调整原因',
        );
        const commission = rule
          ? calculate(rule.formula, {
              ...values,
              基数: basis,
              可分配金额: pool,
              个人提成比例: rate,
            })
          : pool.mul(rate).div(100).toDecimalPlaces(2);
        const amount = commission.add(adjustment);
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
        ownerEmployeeId,
        policyId: policy.scopeId,
        allocatedCost: cost,
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
          customMemberIds: memberRules
            .filter((rule) => seen.has(rule.employeeId))
            .map((rule) => rule.employeeId),
          basis: policy.basis,
          inputs: Object.fromEntries(fields.map((f) => [f, values[f].toString()])),
        },
      };
      const old = await tx.caseSettlement.findUnique({
        where: { caseId },
      });
      check(
        b.id
          ? old?.id === b.id &&
              old.teamId === teamId &&
              old.ownerEmployeeId === ownerEmployeeId &&
              old.period === period &&
              old?.status === 'DRAFT' &&
              old.version === b.version
          : !old,
        '该案件已有结算主单，或草稿已变更，请刷新',
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
      const editor =
          r.admin || (row.teamId ? r.lead.includes(row.teamId) : row.ownerEmployeeId === r.employeeId),
        finance = r.admin || r.finance.includes(row.policyId);
      check(row.version === b.version, '记录已更新，请刷新', 409);
      const action = text(b.action);
      let snapshot: Prisma.InputJsonObject | undefined;
      let status = row.status,
        remark = row.remark;
      if (action === 'delete') {
        check(editor && row.status === 'DRAFT', '仅可删除有管理权限的结算草稿', 403);
        await tx.caseSettlement.delete({ where: { id } });
        await payLog(tx, this.actor, id, 'CASE_PAY_DELETE', { version: row.version });
        return;
      }
      if (action === 'share' || action === 'unshare') {
        check(editor, '仅结算负责人或管理员可调整共享', 403);
        const user = await tx.user.findFirst({
          where: {
            ...(b.userId !== undefined ? { id: text(b.userId) } : { username: text(b.username) }),
            status: 'ENABLED',
          },
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
        check(row.teamId || row.ownerEmployeeId === r.employeeId, '仅发起律师可提交个人结算', 403);
        const source = (await this.sources('', row.caseId, tx, row.teamId, r))[0];
        const snap = object(row.snapshot),
          policy = row.teamId
            ? r.policies.find((p) => p.teamId === row.teamId)
            : (r.policies.find((p) => p.employeeId === row.ownerEmployeeId) ??
              r.policies.find((p) => p.scopeId === 'personal'));
        check(
          policy?.scopeId === row.policyId &&
            policy.version === snap.policyVersion &&
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
        const members = row.teamId
          ? await tx.professionalTeamMember.count({
              where: {
                professionalTeamId: row.teamId,
                endedAt: null,
                startedAt: { lte: new Date() },
                employee: activeEmployee,
                employeeId: { in: row.lines.map((l) => l.employeeId) },
              },
            })
          : await tx.employee.count({
              where: { ...activeEmployee, id: { in: row.lines.map((l) => l.employeeId) } },
            });
        check(members === row.lines.length, '团队成员已变更，请重新分配');
        snapshot = await allocateRemainder(tx, row, b);
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
        snapshot = await undoRemainder(tx, row);
        status = 'DRAFT';
      } else check(false, '未知操作');
      await tx.caseSettlement.update({
        where: { id },
        data: { status, remark, snapshot, version: { increment: 1 } },
      });
      await payLog(tx, this.actor, id, 'CASE_PAY_' + action.toUpperCase(), {
        status,
        remark,
        username: b.username,
        recipientId: b.userId,
        leaderRemainder: snapshot?.leaderRemainder,
        expiresAt: b.expiresAt,
      });
    });
  }
}
