import path from 'node:path';
import { addRemediationMaterial, discardRemediationMaterials } from './remediation-material';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import {
  assertExactKeys,
  normalizeRequiredText,
  normalizeVersion,
} from '../../domain/master-data/master-data-validation';
import { sopFail } from '../../domain/sop/template-content';
import { checklist, qualityMonth, sampleIds, QualityCheck } from '../../domain/quality/quality-policy';
import { qualityActor, qualityCaseScope, qualityPolicyScope } from './quality-scope';
import { createOnce } from '../finance/domain-mutation';
import { hashPayload } from '../../domain/admin-governance/canonical-json';
import { materialBytes } from '../sop/review-policy';
import { requireCaseAccess } from '../case/case-scope';
import { CaseFileService } from '../case/case-file-service';
import { appendCollaborationChange } from '../collaboration/collaboration-change';
import { PrismaEventOutboxWriter } from '../events/event-outbox-writer';
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const text = (v: unknown, max = 200) => normalizeRequiredText(v, 1, max);
function page(raw: unknown) {
  assertExactKeys(raw, ['page', 'pageSize']);
  const page = Number(raw.page ?? 1),
    pageSize = Number(raw.pageSize ?? 50);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize)
  )
    sopFail('VALIDATION_FAILED');
  return { page, pageSize, skip: (page - 1) * pageSize };
}
export class QualityService {
  constructor(
    private db: PrismaClient,
    private actor: AuditActor,
    private ctx: AuthorizationContext,
  ) {}
  private auth() {
    return new AuthorizationService(new DataScopeService(this.db));
  }
  private async caseAccess(
    id: string,
    permission: PermissionCode,
    ctx = this.ctx,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const row = await tx.case.findFirst({
      where: { AND: [{ id }, await qualityCaseScope(this.db, ctx, permission, tx)] },
    });
    if (!row) sopFail('QUALITY_NOT_FOUND', 404);
    return row!;
  }
  private async policy(
    id: string,
    permission: PermissionCode,
    ctx = this.ctx,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const row = await tx.qualitySamplingPolicy.findFirst({
      where: { AND: [{ id }, await qualityPolicyScope(this.db, ctx, permission)] },
    });
    if (!row) sopFail('QUALITY_NOT_FOUND', 404);
    return row!;
  }
  async options() {
    const auth = this.auth();
    auth.requireAction(this.ctx, 'quality.sample.manage');
    const org = await auth.buildScopeWhere(this.ctx, 'organization', 'organization.read');
    const team = this.ctx.permissionCodes.includes('professional_team.read')
      ? await auth.buildScopeWhere(this.ctx, 'professional_team', 'professional_team.read')
      : null;
    return {
      organizations: await this.db.organization.findMany({
        where: { AND: [org, { status: 'ENABLED' }] },
        select: { id: true, name: true },
        take: 500,
      }),
      teams: team
        ? await this.db.professionalTeam.findMany({
            where: { AND: [team, { status: 'ENABLED' }] },
            select: { id: true, name: true, homeOrganizationId: true },
            take: 500,
          })
        : [],
      limit: 500,
    };
  }
  async policies(raw: unknown = {}) {
    const p = page(raw),
      where = await qualityPolicyScope(this.db, this.ctx, 'quality.sample.read');
    const [list, total] = await Promise.all([
      this.db.qualitySamplingPolicy.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.pageSize,
      }),
      this.db.qualitySamplingPolicy.count({ where }),
    ]);
    return { list, total, ...p };
  }
  async createPolicy(raw: unknown) {
    assertExactKeys(raw, [
      'code',
      'name',
      'organizationId',
      'professionalTeamId',
      'mode',
      'amount',
      'stratified',
      'checklist',
      'requestKey',
    ]);
    const code = text(raw.code, 50),
      name = text(raw.name),
      organizationId = text(raw.organizationId, 100),
      professionalTeamId = raw.professionalTeamId ? text(raw.professionalTeamId, 100) : null,
      mode = String(raw.mode),
      amount = Number(raw.amount),
      checks = checklist(raw.checklist),
      key = text(raw.requestKey, 128);
    if (
      !/^[A-Z0-9_-]+$/.test(code) ||
      !['COUNT', 'RATIO'].includes(mode) ||
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > (mode === 'RATIO' ? 100 : 10000) ||
      typeof raw.stratified !== 'boolean'
    )
      sopFail('VALIDATION_FAILED');
    this.auth().requireAction(this.ctx, 'quality.sample.manage');
    return createOnce(
      this.db,
      { actorId: this.ctx.userId, key, operation: 'QUALITY_POLICY_CREATE', normalized: raw },
      async (tx) => {
        const ctx = await qualityActor(tx, this.ctx.userId),
          auth = this.auth();
        auth.requireAction(ctx, 'quality.sample.manage');
        const org = await tx.organization.findFirst({
          where: {
            AND: [
              { id: organizationId, status: 'ENABLED' },
              await auth.buildScopeWhere(ctx, 'organization', 'organization.read'),
            ],
          },
        });
        if (!org) sopFail('QUALITY_NOT_FOUND', 404);
        if (
          professionalTeamId &&
          !(await tx.professionalTeam.findFirst({
            where: {
              AND: [
                { id: professionalTeamId, status: 'ENABLED', homeOrganizationId: organizationId },
                await auth.buildScopeWhere(ctx, 'professional_team', 'professional_team.read'),
              ],
            },
          }))
        )
          sopFail('QUALITY_NOT_FOUND', 404);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'QUALITY_POLICY:' + code},0))`;
        const last = await tx.qualitySamplingPolicy.findFirst({
          where: { code },
          orderBy: { number: 'desc' },
        });
        if (last) await this.policy(last.id, 'quality.sample.manage', ctx, tx);
        const row = await tx.qualitySamplingPolicy.create({
          data: {
            code,
            name,
            organizationId,
            professionalTeamId,
            mode,
            amount,
            stratified: raw.stratified as boolean,
            checklist: json(checks),
            number: (last?.number ?? 0) + 1,
            createdBy: ctx.userId,
          },
        });
        // A manageable organization alone does not grant a wider quality scope.
        await this.policy(row.id, 'quality.sample.manage', ctx, tx);
        await this.changed(tx, 'QUALITY_POLICY', row.id, 1, 'CREATE', organizationId);
        return row;
      },
      async (tx, id) => this.policy(id, 'quality.sample.manage', await qualityActor(tx, this.ctx.userId), tx),
    );
  }
  async runs(raw: unknown = {}) {
    const p = page(raw);
    const where = { policy: await qualityPolicyScope(this.db, this.ctx, 'quality.sample.read') };
    const rows = await this.db.qualitySamplingRun.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: p.skip,
      take: p.pageSize,
      select: {
        id: true,
        month: true,
        batchKey: true,
        createdAt: true,
        policy: { select: { name: true, number: true } },
      },
    });
    return { list: rows, total: await this.db.qualitySamplingRun.count({ where }), ...p };
  }
  async run(id: string) {
    const run = await this.db.qualitySamplingRun.findUnique({ where: { id }, include: { policy: true } });
    if (!run) sopFail('QUALITY_NOT_FOUND', 404);
    await this.policy(run!.policyId, 'quality.sample.read');
    const scope = await qualityCaseScope(this.db, this.ctx, 'quality.sample.read');
    const visible = await this.db.case.findMany({ where: scope, select: { id: true } }),
      ids = new Set(visible.map((c) => c.id));
    const candidates = (run!.candidateSnapshot as { id: string }[]).filter((c) => ids.has(c.id)),
      exclusions = (run!.exclusions as { id: string; reason: string }[]).filter((c) => ids.has(c.id));
    const items = this.ctx.permissionCodes.includes('quality.inspection.read')
      ? await this.db.qualitySamplingItem.findMany({
          where: { runId: id, case: await qualityCaseScope(this.db, this.ctx, 'quality.inspection.read') },
          select: { id: true, name: true, status: true, caseId: true, version: true },
        })
      : [];
    const complete = candidates.length === (run!.candidateSnapshot as unknown[]).length;
    return {
      id,
      policy: run!.policy,
      month: run!.month,
      batchKey: run!.batchKey,
      reason: run!.reason,
      algorithm: run!.algorithm,
      seed: run!.seed,
      candidateHash: complete ? run!.candidateHash : null,
      candidates,
      exclusions,
      items,
      scopeRestricted: !complete,
    };
  }
  async createRun(raw: unknown) {
    assertExactKeys(raw, ['policyId', 'month', 'batchKey', 'reason', 'exclusions', 'requestKey']);
    const policyId = text(raw.policyId, 100),
      { month, start, end } = qualityMonth(raw.month),
      batchKey = raw.batchKey === undefined ? 'PRIMARY' : text(raw.batchKey, 100),
      reason = raw.reason ? text(raw.reason, 2000) : null,
      key = text(raw.requestKey, 128);
    if (batchKey !== 'PRIMARY' && !reason) sopFail('QUALITY_REASON_REQUIRED');
    if (raw.exclusions !== undefined && (!Array.isArray(raw.exclusions) || raw.exclusions.length > 1000))
      sopFail('VALIDATION_FAILED');
    const exclusions = ((raw.exclusions ?? []) as unknown[]).map((e) => {
      assertExactKeys(e, ['id', 'reason']);
      return { id: text(e.id, 100), reason: text(e.reason, 2000) };
    });
    if (new Set(exclusions.map((e) => e.id)).size !== exclusions.length) sopFail('VALIDATION_FAILED');
    await this.policy(policyId, 'quality.sample.manage');
    return createOnce(
      this.db,
      { actorId: this.ctx.userId, key, operation: 'QUALITY_SAMPLE', normalized: { ...raw, month, batchKey } },
      async (tx) => {
        const ctx = await qualityActor(tx, this.ctx.userId),
          policy = await this.policy(policyId, 'quality.sample.manage', ctx, tx),
          auth = this.auth();
        const scopes = await Promise.all(
          ['case.read', 'quality.sample.manage'].map((p) =>
            auth.resolveScopeTargets(ctx, 'case', p as PermissionCode),
          ),
        );
        const scopeHash = hashPayload(
            scopes.map((s) => ({
              all: s.all,
              organizationTargets: [...s.organizationTargets]
                .map((o) => ({
                  path: o.path,
                  includeDescendants: o.includeDescendants,
                  excludedDescendantPaths: [...(o.excludedDescendantPaths ?? [])].sort(),
                }))
                .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
              professionalTeamIds: [...s.professionalTeamIds].sort(),
              employeeIds: [...s.employeeIds].sort(),
            })),
          ),
          lock = policyId + ':' + scopeHash + ':' + month;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))`;
        const existing = await tx.qualitySamplingRun.findUnique({
          where: { policyId_scopeHash_month_batchKey: { policyId, scopeHash, month, batchKey } },
        });
        if (existing) return { id: existing.id };
        const prior = await tx.qualitySamplingRun.findMany({
          where: { policyId, scopeHash, month },
          include: { items: { select: { caseId: true } } },
        });
        if (batchKey !== 'PRIMARY' && !prior.some((r) => r.batchKey === 'PRIMARY'))
          sopFail('QUALITY_PRIMARY_REQUIRED', 409);
        const rows = await tx.case.findMany({
          where: {
            AND: [
              await qualityCaseScope(this.db, ctx, 'quality.sample.manage', tx),
              {
                branchId: policy.organizationId,
                status: { in: ['CLOSED', 'ARCHIVED'] },
                closedAt: { gte: start, lt: end },
              },
            ],
          },
          select: { id: true, closedAt: true, version: true, teamIds: true },
          orderBy: { id: 'asc' },
        });
        const teamIds = (value: string | null): string[] => {
          try {
            const list = JSON.parse(value ?? '[]');
            return Array.isArray(list) && list.every((v) => typeof v === 'string') ? list : [];
          } catch {
            return [];
          }
        };
        const candidates = rows.filter(
          (c) => !policy.professionalTeamId || teamIds(c.teamIds).includes(policy.professionalTeamId),
        );
        if (exclusions.some((e) => !candidates.some((c) => c.id === e.id))) sopFail('QUALITY_NOT_FOUND', 404);
        const old = new Set(prior.flatMap((r) => r.items.map((i) => i.caseId))),
          excluded = new Set(exclusions.map((e) => e.id));
        const snapshot = candidates.map((c) => ({
          id: c.id,
          closedAt: c.closedAt!.toISOString(),
          version: c.version,
          stratum: policy.professionalTeamId ?? teamIds(c.teamIds).sort()[0] ?? 'UNASSIGNED',
        }));
        const seed = randomUUID(),
          selected = sampleIds(
            snapshot.filter((c) => !old.has(c.id) && !excluded.has(c.id)),
            seed,
            policy.mode,
            policy.amount,
            policy.stratified,
          );
        const run = await tx.qualitySamplingRun.create({
          data: {
            policyId,
            scopeHash,
            month,
            batchKey,
            reason,
            seed,
            candidateSnapshot: json(snapshot),
            candidateHash: hashPayload(snapshot),
            exclusions: json([
              ...exclusions,
              ...snapshot.filter((c) => old.has(c.id)).map((c) => ({ id: c.id, reason: '已在前批次抽取' })),
            ]),
            createdBy: ctx.userId,
          },
        });
        if (selected.length)
          await tx.qualitySamplingItem.createMany({
            data: selected.map((caseId, index) => ({
              runId: run.id,
              caseId,
              name: policy.name + ' / ' + month + ' / ' + (index + 1),
              checklist: policy.checklist as Prisma.InputJsonValue,
              createdBy: ctx.userId,
            })),
          });
        await this.changed(tx, 'QUALITY_SAMPLING', run.id, 1, 'CREATE', policy.organizationId);
        return { id: run.id };
      },
      async (tx, id) => {
        const run = await tx.qualitySamplingRun.findUniqueOrThrow({ where: { id } });
        await this.policy(run.policyId, 'quality.sample.manage', await qualityActor(tx, this.ctx.userId), tx);
        return { id };
      },
    );
  }
  async inspection(id: string) {
    const row = await this.db.qualitySamplingItem.findUnique({
      where: { id },
      include: { issues: { select: { id: true, name: true, status: true } } },
    });
    if (!row) sopFail('QUALITY_NOT_FOUND', 404);
    await this.caseAccess(row!.caseId, 'quality.inspection.read');
    return {
      ...row,
      issues:
        this.ctx.permissionCodes.includes('quality.issue.read') &&
        (await this.db.case.count({
          where: {
            AND: [{ id: row!.caseId }, await qualityCaseScope(this.db, this.ctx, 'quality.issue.read')],
          },
        }))
          ? row!.issues
          : [],
    };
  }
  async inspect(id: string, raw: unknown) {
    assertExactKeys(raw, ['expectedVersion', 'requestKey', 'checklist']);
    const version = normalizeVersion(raw.expectedVersion),
      key = text(raw.requestKey, 128),
      checks = checklist(raw.checklist, true);
    const initial = await this.inspection(id);
    await this.caseAccess(initial.caseId, 'quality.inspection.record');
    return createOnce(
      this.db,
      { actorId: this.ctx.userId, key, operation: 'QUALITY_INSPECT', normalized: { id, ...raw } },
      async (tx) => {
        const ctx = await qualityActor(tx, this.ctx.userId);
        await tx.$queryRaw`SELECT id FROM quality_sampling_item WHERE id=${id} FOR UPDATE`;
        const row = await tx.qualitySamplingItem.findUniqueOrThrow({ where: { id } });
        const target = await this.caseAccess(row.caseId, 'quality.inspection.record', ctx, tx);
        await this.caseAccess(row.caseId, 'quality.inspection.read', ctx, tx);
        if (row.version !== version) sopFail('QUALITY_VERSION_CONFLICT', 409);
        if (row.status !== 'PENDING') sopFail('QUALITY_STATE_INVALID', 409);
        const employee = await tx.user.findUniqueOrThrow({
          where: { id: ctx.userId },
          select: { employeeId: true },
        });
        if (target.lawyerId && target.lawyerId === employee.employeeId) sopFail('QUALITY_SELF_REVIEW', 403);
        if (
          await tx.sopSubmission.count({
            where: {
              task: { caseId: row.caseId },
              OR: [{ submittedBy: ctx.userId }, { executorUserId: ctx.userId }],
            },
          })
        )
          sopFail('QUALITY_SELF_REVIEW', 403);
        const frozen = row.checklist as QualityCheck[];
        if (
          checks.length !== frozen.length ||
          checks.some((c) => !frozen.some((f) => f.code === c.code && f.name === c.name))
        )
          sopFail('VALIDATION_FAILED');
        const next = await tx.qualitySamplingItem.update({
          where: { id },
          data: {
            checklist: json(checks),
            status: 'RECORDED',
            inspectorUserId: ctx.userId,
            resultHash: hashPayload(checks),
            version: { increment: 1 },
            updatedBy: ctx.userId,
          },
        });
        for (const check of checks.filter((c) => c.result === 'FAIL'))
          await tx.qualityIssue.create({
            data: {
              inspectionId: id,
              caseId: row.caseId,
              checkCode: check.code,
              name: check.name,
              evidence: check.reason,
              createdBy: ctx.userId,
            },
          });
        await this.changed(tx, 'QUALITY_INSPECTION', id, next.version, 'RECORD', target.branchId);
        return { id };
      },
      async (tx, targetId) => {
        const row = await tx.qualitySamplingItem.findUniqueOrThrow({ where: { id: targetId } });
        await this.caseAccess(
          row.caseId,
          'quality.inspection.record',
          await qualityActor(tx, this.ctx.userId),
          tx,
        );
        return { id: targetId };
      },
    );
  }
  async inspections(raw: unknown = {}) {
    const p = page(raw);
    const where = { case: await qualityCaseScope(this.db, this.ctx, 'quality.inspection.read') };
    const [list, total] = await this.db.$transaction([
      this.db.qualitySamplingItem.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: p.skip, take: p.pageSize,
        select: { id: true, name: true, status: true, caseId: true, version: true, createdAt: true } }),
      this.db.qualitySamplingItem.count({ where }),
    ]);
    return { list, total, page: p.page, pageSize: p.pageSize };
  }
  async issues(raw: unknown = {}) {
    const p = page(raw),
      where = { case: await qualityCaseScope(this.db, this.ctx, 'quality.issue.read') };
    return {
      list: await this.db.qualityIssue.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: p.skip,
        take: p.pageSize,
      }),
      total: await this.db.qualityIssue.count({ where }),
      ...p,
    };
  }
  async issue(id: string) {
    const row = await this.db.qualityIssue.findUnique({
      where: { id },
      include: {
        revisions: {
          orderBy: { number: 'asc' },
          include: { attachments: { include: { file: { select: { fileName: true } } } } },
        },
      },
    });
    if (!row) sopFail('QUALITY_NOT_FOUND', 404);
    await this.caseAccess(row!.caseId, 'quality.issue.read');
    let files = false;
    if (this.ctx.permissionCodes.includes('case.file.read')) {
      try {
        await requireCaseAccess(this.db, this.ctx, row!.caseId, 'case.file.read');
        files = true;
      } catch {
        files = false;
      }
    }
    return {
      ...row,
      materialsVisible: files,
      revisions: row!.revisions.map((r) => ({ ...r, attachments: files ? r.attachments : [] })),
    };
  }
  async assignees(id: string) {
    const issue = await this.issue(id);
    await this.caseAccess(issue.caseId!, 'quality.issue.manage');
    const where = await this.auth().buildScopeWhere(this.ctx, 'employee', 'employee.read');
    const users = await this.db.user.findMany({
      where: {
        status: 'ENABLED',
        employee: { AND: [where, { status: { not: 'LEAVED' }, deletedAt: null }] },
      },
      include: { employee: { select: { name: true } } },
      take: 500,
      orderBy: { id: 'asc' },
    });
    const result: { id: string; name: string }[] = [];
    for (const u of users) {
      try {
        const ctx = await qualityActor(this.db, u.id);
        await this.caseAccess(issue.caseId!, 'quality.issue.read', ctx);
        await this.caseAccess(issue.caseId!, 'quality.issue.resolve', ctx);
        result.push({ id: u.id, name: u.employee!.name });
      } catch {
        /* Skip unauthorized candidates. */
      }
    }
    return result;
  }
  async materialOptions(id: string) {
    const row = await this.issue(id);
    await requireCaseAccess(this.db, this.ctx, row.caseId!, 'case.file.read');
    return this.db.caseFile.findMany({
      where: { caseId: row.caseId },
      select: { id: true, fileName: true },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
  }
  async download(id: string, fileId: string) {
    const issue = await this.issue(id),
      attachment = await this.db.issueAttachment.findFirst({
        where: { fileId, revision: { issueId: id } },
        include: { file: true },
      });
    if (!attachment) sopFail('QUALITY_NOT_FOUND', 404);
    await requireCaseAccess(this.db, this.ctx, issue.caseId!, 'case.file.read');
    const bytes = await materialBytes(attachment!.file);
    if (bytes !== attachment!.sha256) sopFail('SOP_MATERIAL_CHANGED', 409);
    return new CaseFileService(this.db, this.actor, this.ctx).download(fileId);
  }
  async act(id: string, raw: unknown) {
    assertExactKeys(raw, [
      'action',
      'expectedVersion',
      'requestKey',
      'content',
      'assigneeUserId',
      'dueAt',
      'fileIds',
      'uploads',
    ]);
    const action = text(raw.action, 30),
      version = normalizeVersion(raw.expectedVersion),
      key = text(raw.requestKey, 128),
      content = raw.content ? text(raw.content, 20000) : '';
    if (!['ASSIGN', 'START', 'SUBMIT', 'VERIFY', 'RETURN', 'CANCEL'].includes(action))
      sopFail('VALIDATION_FAILED');
    const permission: PermissionCode = ['ASSIGN', 'CANCEL'].includes(action)
      ? 'quality.issue.manage'
      : ['VERIFY', 'RETURN'].includes(action)
        ? 'quality.issue.verify'
        : 'quality.issue.resolve';
    const initial = await this.issue(id);
    await this.caseAccess(initial.caseId!, permission);
    const createdPaths: string[] = [];
    return createOnce(
      this.db,
      { actorId: this.ctx.userId, key, operation: 'QUALITY_ISSUE_' + action, normalized: { id, ...raw } },
      async (tx) => {
        const ctx = await qualityActor(tx, this.ctx.userId);
        await tx.$queryRaw`SELECT id FROM quality_issue WHERE id=${id} FOR UPDATE`;
        const row = await tx.qualityIssue.findUniqueOrThrow({ where: { id } });
        const target = await this.caseAccess(row.caseId, permission, ctx, tx);
        await this.caseAccess(row.caseId, 'quality.issue.read', ctx, tx);
        if (row.version !== version) sopFail('QUALITY_VERSION_CONFLICT', 409);
        if (['CLOSED', 'CANCELLED'].includes(row.status)) sopFail('QUALITY_STATE_INVALID', 409);
        let status = row.status;
        const data: Prisma.QualityIssueUpdateInput = { version: { increment: 1 }, updatedBy: ctx.userId };
        if (action === 'ASSIGN') {
          if (row.status === 'PENDING_VERIFY') sopFail('QUALITY_STATE_INVALID', 409);
          const assignee = text(raw.assigneeUserId, 100),
            next = await qualityActor(tx, assignee),
            ew = await this.auth().buildScopeWhere(ctx, 'employee', 'employee.read');
          if (
            !(await tx.user.count({
              where: {
                id: assignee,
                employee: { AND: [ew, { status: { not: 'LEAVED' }, deletedAt: null }] },
              },
            }))
          )
            sopFail('QUALITY_NOT_FOUND', 404);
          await this.caseAccess(row.caseId, 'quality.issue.read', next, tx);
          await this.caseAccess(row.caseId, 'quality.issue.resolve', next, tx);
          if (!raw.dueAt || typeof raw.dueAt !== 'string' || !Number.isFinite(Date.parse(raw.dueAt)))
            sopFail('VALIDATION_FAILED');
          data.assignee = { connect: { id: assignee } };
          data.dueAt = new Date(raw.dueAt as string);
        }
        if (['START', 'SUBMIT'].includes(action) && row.assigneeUserId !== ctx.userId)
          sopFail('QUALITY_NOT_ASSIGNEE', 403);
        if (action === 'START') {
          if (row.status !== 'OPEN') sopFail('QUALITY_STATE_INVALID', 409);
          status = 'IN_PROGRESS';
        }
        if (action === 'SUBMIT') {
          if (row.status !== 'IN_PROGRESS' || !content) sopFail('QUALITY_STATE_INVALID', 409);
          status = 'PENDING_VERIFY';
        }
        if (['VERIFY', 'RETURN'].includes(action)) {
          if (row.status !== 'PENDING_VERIFY' || !content) sopFail('QUALITY_STATE_INVALID', 409);
          const submission = await tx.issueRevision.findFirst({
            where: { issueId: id, action: 'SUBMIT' },
            orderBy: { number: 'desc' },
            include: { attachments: { include: { file: true } } },
          });
          if (!submission) sopFail('QUALITY_STATE_INVALID', 409);
          if (ctx.userId === submission!.createdBy || ctx.userId === row.assigneeUserId)
            sopFail('QUALITY_SELF_REVIEW', 403);
          if (action === 'VERIFY' && submission!.attachments.length) {
            await requireCaseAccess(this.db, ctx, row.caseId, 'case.file.read', tx);
            for (const a of submission!.attachments) {
              const current = await materialBytes(a.file);
              if (current !== a.sha256 || a.fileSize !== a.file.fileSize)
                sopFail('SOP_MATERIAL_CHANGED', 409);
            }
          }
          status = action === 'VERIFY' ? 'CLOSED' : 'IN_PROGRESS';
        }
        if (action === 'CANCEL') {
          if (!content) sopFail('QUALITY_REASON_REQUIRED');
          status = 'CANCELLED';
        }
        const last = await tx.issueRevision.findFirst({
          where: { issueId: id },
          orderBy: { number: 'desc' },
        });
        const revision = await tx.issueRevision.create({
          data: { issueId: id, number: (last?.number ?? 0) + 1, action, content, createdBy: ctx.userId },
        });
        if (raw.fileIds !== undefined) {
          if (
            action !== 'SUBMIT' ||
            !Array.isArray(raw.fileIds) ||
            raw.fileIds.length > 100 ||
            new Set(raw.fileIds).size !== raw.fileIds.length ||
            raw.fileIds.some((f) => typeof f !== 'string')
          )
            sopFail('VALIDATION_FAILED');
          if ((raw.fileIds as string[]).length)
            await requireCaseAccess(this.db, ctx, row.caseId, 'case.file.read', tx);
          for (const fileId of raw.fileIds as string[]) {
            const file = await tx.caseFile.findFirst({ where: { id: fileId, caseId: row.caseId } });
            if (!file) sopFail('QUALITY_NOT_FOUND', 404);
            const bytes = await materialBytes(file!);
            await tx.issueAttachment.create({
              data: { revisionId: revision.id, fileId, sha256: bytes, fileSize: file!.fileSize },
            });
          }
        }
        if (raw.uploads !== undefined) {
          if (action !== 'SUBMIT' || !Array.isArray(raw.uploads) || raw.uploads.length > 10)
            sopFail('VALIDATION_FAILED');
          if ((raw.uploads as unknown[]).length)
            await requireCaseAccess(this.db, ctx, row.caseId, 'case.file.manage', tx);
          for (const upload of raw.uploads as unknown[])
            await addRemediationMaterial(tx, row.caseId, revision.id, ctx.userId, upload, createdPaths);
        }
        const updated = await tx.qualityIssue.update({ where: { id }, data: { ...data, status } });
        await this.changed(tx, 'QUALITY_ISSUE', id, updated.version, action, target.branchId);
        return { id };
      },
      async (tx, targetId) => {
        const row = await tx.qualityIssue.findUniqueOrThrow({ where: { id: targetId } });
        await this.caseAccess(row.caseId, permission, await qualityActor(tx, this.ctx.userId), tx);
        return { id: targetId };
      },
    ).catch(async (error) => {
      // A transport failure during commit is ambiguous: retain bytes if the DB cannot prove rollback.
      try {
        const persisted = await this.db.caseFile.findMany({
          where: { filePath: { in: createdPaths.map((p) => path.basename(p)) } },
          select: { filePath: true },
        });
        const kept = new Set(persisted.map((f) => f.filePath));
        discardRemediationMaterials(createdPaths.filter((p) => !kept.has(path.basename(p))));
      } catch {
        /* Leave unconfirmed bytes for reconciliation. */
      }
      throw error;
    });
  }
  private async changed(
    tx: Prisma.TransactionClient,
    type: string,
    id: string,
    version: number,
    action: string,
    organizationId: string | null,
  ) {
    await tx.operationLog.create({
      data: {
        userId: this.actor.actorUserId,
        action: type + '_' + action,
        targetType: type,
        targetId: id,
        newValues: JSON.stringify({ version, action }),
        ip: this.actor.ip,
      },
    });
    await new PrismaEventOutboxWriter().append(tx, {
      eventType: 'quality.changed',
      eventVersion: 1,
      objectType: 'QUALITY',
      objectId: id,
      operatorUserId: this.ctx.userId,
      organizationId,
      branchId: organizationId,
      teamId: null,
      payload: { id, version, action, type },
      traceId: this.actor.requestId ?? id,
      occurredAt: new Date(),
    });
    if (organizationId) {
      const org = await tx.organization.findUnique({ where: { id: organizationId } });
      const bases = await tx.collabTable.findMany({
        where: {
          source: { in: ['QUALITY_REVIEWS', 'QUALITY_ISSUES'] },
          base: { workspace: { organizationId: { in: org?.path.split('/').filter(Boolean) ?? [] } } },
        },
        select: { baseId: true },
        distinct: ['baseId'],
      });
      for (const b of bases)
        await appendCollaborationChange(tx, this.ctx.userId, b.baseId, 'business.changed', b.baseId);
    }
  }
}
