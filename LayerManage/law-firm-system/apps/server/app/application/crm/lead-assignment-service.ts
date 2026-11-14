import { crmTransaction } from './crm-transaction';
// SPEC-009 Task 6: lead-assignment-service —— 公海领取、分配/改派、手动回收、超时回收批。
// 事务边界（设计 §6.2）：Lead 归属变更 + LeadPoolRecord 写入 + outbox 事件同事务。
// 公海定义（决策 2）：poolStatus ∈ {PUBLIC, RECYCLED} 可领取；仅 PRIVATE 拒绝领取
//   （LEAD_NOT_IN_POOL 409，含本人已持有，无自我领取特例）。
// 动作权限（决策 1，覆盖一切较早 lead.update 注记）：claimFromPool=lead.pool.claim；
//   assign/reassign=lead.assign；recycle=lead.recycle；均用 AuthorizationService.requireAction
//   作为每个公开方法的第一条语句。recycleOverdueLeads 是系统自动化入口（Task 9 扫描器以系统
//   actor 调用），刻意不做动作权限/数据范围校验——影响面由查询条件（PRIVATE + NEW/ASSIGNED +
//   超时）天然收敛，operatedBy 取构造时 actor（见方法注释）。**Task 10 禁止把本方法无守卫地
//   暴露为 HTTP 端点**（无权限/范围校验，仅供系统任务调用）。
// actor→员工解析（决策 3）：assignedTo 是 Employee id，actor 是 user；绑定关系即 User.employeeId
//   列（EmployeeAccountBinding 的持久化形态），authorization-context-loader 已将其载入
//   AuthorizationContext.employeeId，故直接取 context.employeeId；未绑定抛
//   ACTOR_EMPLOYEE_UNBOUND(403)。
// assignedAt 与 status 纪律（决策 4，Task 9 首响计量依赖）：claim/assign/reassign 写
//   assignedAt=now() 且置 PRIVATE；lead.status=NEW 时经 canTransition 门卫推进到 ASSIGNED，
//   其余 status 不变。recycle 置 RECYCLED + 清 assignedTo/assignedAt，status 一律不动
//   （poolStatus 与 status 正交，设计 §6.1）。手动 recycle 仅允许 PRIVATE
//   （否则 LEAD_STATE_TRANSITION_INVALID 409）。
// 事件（决策 5）：每次池动作同事务写 lead.assigned v1（严格四键 {leadId, action,
//   fromEmployeeId, toEmployeeId}；claim from=null；assign 池内 ASSIGN/私海 REASSIGN；
//   recycle to=null）；status 实际流转时再写 lead.status_changed v1。envelope
//   objectType='LEAD'、objectId=leadId、eventVersion=1，branchId/teamId 取 Lead 行原样透传
//   （决策 8，同 lead-service 模式，Task 10 负责入口校验），organizationId 恒 null。
// 数据范围（决策 6）：每个操作按自身权限码走 lead-scope 共享 buildLeadScopeWhere
//   （与 lead-service 同语义：SELF→assignedTo / TEAM→professionalTeamId / BRANCH·ORG→branchId
//   组织子树 / 多分量 OR 并集 / 零谓词 fail-closed）；不可见 → LEAD_NOT_FOUND(404) 不泄露存在性。
// 并发：每次 Lead 变更走 version 乐观锁（同 lead-service 模式，updateMany where {id, version}
//   count!==1 → MasterDataError('VERSION_CONFLICT', 409)）。并发双领取先提交者胜；败者按竞态
//   时序得 VERSION_CONFLICT 或 LEAD_NOT_IN_POOL，均为冲突类错误，绝不静默覆盖。
// LeadPoolRecord：append-only，绝不更新/删除旧记录。
// 视图与审计：返回 LeadView 的方法走 lead-projection 脱敏（字段权限锚定 lead.read，同
//   lead-service）+ lead-audit 共享助手的 READ_L3_FIELDS 明文读取审计（与 getLead 同规则，
//   事务提交后独立事务写审计，purpose 按操作区分 lead.claim/lead.assign/lead.recycle）；
//   每次池变更另写 OperationLog 业务审计（只落安全字段，禁止 phone/wechat 明文）。

import { randomUUID } from 'node:crypto';

import { Lead, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { FieldProjectionService } from '../authorization/field-projection-service';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import {
  ACTOR_EMPLOYEE_UNBOUND,
  CrmError,
  LEAD_NOT_FOUND,
  LEAD_NOT_IN_POOL,
  LEAD_STATE_TRANSITION_INVALID,
} from '../../domain/crm/lead-errors';
import { canTransition, LeadPoolAction, LeadStatus } from '../../domain/crm/lead-policy';
import {
  EventEnvelopeInput,
  LEAD_ASSIGNED,
  LEAD_STATUS_CHANGED,
  LeadAssignedV1,
  LeadStatusChangedV1,
} from '../../domain/events/event-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  normalizeNonNegativeInteger,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import { auditRawL3Access } from './lead-audit';
import { LeadFieldPermissions, projectLead } from './lead-projection';
import { buildLeadScopeWhere } from './lead-scope';
import { LeadView } from './lead-types';

const HOUR_MS = 3_600_000;
const AUTO_RECYCLE_REASON = (hours: number): string => `AUTO_RECYCLE:NO_FOLLOW_${hours}H`;

/** 超时回收批处理汇总（决策 7）：recycledCount=成功条数，leadIds=成功回收的 leadId 列表。 */
export interface RecycleOverdueResult {
  recycledCount: number;
  leadIds: string[];
}

interface PoolMutation {
  action: LeadPoolAction;
  fromEmployeeId: string | null;
  toEmployeeId: string | null;
  reason: string | null;
  poolStatus: 'PRIVATE' | 'RECYCLED';
  assignedTo: string | null;
  assignedAt: Date | null;
  auditAction: string;
}

export class LeadAssignmentService {
  private readonly authorization: AuthorizationService;
  private readonly fieldProjection: FieldProjectionService;
  private readonly outbox: EventOutboxWriter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
    outbox?: EventOutboxWriter,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
    this.fieldProjection = new FieldProjectionService();
    this.outbox = outbox ?? new PrismaEventOutboxWriter();
  }

  /**
   * 公海领取（决策 1/2/3/4）：lead.pool.claim 权限；actor 必须绑定员工；
   * poolStatus ∈ {PUBLIC, RECYCLED} → PRIVATE + owner=actor 员工 + assignedAt=now()；
   * status=NEW 时推进 ASSIGNED（写 lead.status_changed）；PRIVATE 抛 LEAD_NOT_IN_POOL(409)。
   */
  async claimFromPool(leadId: string, transaction?: Prisma.TransactionClient): Promise<LeadView> {
    this.authorization.requireAction(this.authorizationContext, 'lead.pool.claim');
    const id = normalizeRequiredText(leadId, 1, 100);
    const employeeId = this.authorizationContext.employeeId;
    if (!employeeId) {
      throw new CrmError(ACTOR_EMPLOYEE_UNBOUND, 403, 'actor account is not bound to an employee');
    }
    const scopeWhere = await this.scopeWhere('lead.pool.claim');

    return this.mutatePoolOwnership(id, scopeWhere, 'lead.claim', (_tx, lead) => {
      if (lead.poolStatus === 'PRIVATE') {
        throw new CrmError(LEAD_NOT_IN_POOL, 409, 'lead is not in a claimable pool');
      }
      return {
        action: 'CLAIM',
        fromEmployeeId: null,
        toEmployeeId: employeeId,
        reason: null,
        poolStatus: 'PRIVATE',
        assignedTo: employeeId,
        assignedAt: new Date(),
        auditAction: 'LEAD_POOL_CLAIM',
      };
    }, transaction);
  }

  /**
   * 分配/改派（决策 1/4）：lead.assign 权限；目标员工必须存在（Lead.assignedTo 真 FK，
   * 伪造 id 会 P2003 成 500）。fromEmployeeId null → ASSIGN，否则 REASSIGN（记录原负责人）。
   * 置 PRIVATE + assignedAt=now()；status=NEW 时推进 ASSIGNED。不限定来源池态
   * （公海/回收池/私海均可分配）。
   */
  async assign(leadId: string, toEmployeeId: string, reason?: string, transaction?: Prisma.TransactionClient): Promise<LeadView> {
    this.authorization.requireAction(this.authorizationContext, 'lead.assign');
    const id = normalizeRequiredText(leadId, 1, 100);
    const targetEmployeeId = normalizeRequiredText(toEmployeeId, 1, 100);
    const note = normalizeOptionalText(reason, 500);
    const scopeWhere = await this.scopeWhere('lead.assign');

    return this.mutatePoolOwnership(id, scopeWhere, 'lead.assign', async (tx, lead) => {
      const target = await tx.employee.findFirst({
        where: { id: targetEmployeeId },
        select: { id: true },
      });
      if (!target) throw new MasterDataError('VALIDATION_FAILED', 400);
      const fromEmployeeId = lead.assignedTo;
      const action: LeadPoolAction = fromEmployeeId ? 'REASSIGN' : 'ASSIGN';
      return {
        action,
        fromEmployeeId,
        toEmployeeId: targetEmployeeId,
        reason: note,
        poolStatus: 'PRIVATE',
        assignedTo: targetEmployeeId,
        assignedAt: new Date(),
        auditAction: action === 'REASSIGN' ? 'LEAD_REASSIGN' : 'LEAD_ASSIGN',
      };
    }, transaction);
  }

  /**
   * 手动回收（决策 1/4）：lead.recycle 权限；仅 PRIVATE 可回收（否则
   * LEAD_STATE_TRANSITION_INVALID 409）→ RECYCLED + assignedTo=null + assignedAt=null；
   * status 不动（poolStatus 与 status 正交）。
   */
  async recycle(leadId: string, reason?: string, transaction?: Prisma.TransactionClient): Promise<LeadView> {
    this.authorization.requireAction(this.authorizationContext, 'lead.recycle');
    const id = normalizeRequiredText(leadId, 1, 100);
    const note = normalizeOptionalText(reason, 500);
    const scopeWhere = await this.scopeWhere('lead.recycle');

    return this.mutatePoolOwnership(id, scopeWhere, 'lead.recycle', (_tx, lead) => {
      if (lead.poolStatus !== 'PRIVATE') {
        throw new CrmError(LEAD_STATE_TRANSITION_INVALID, 409, 'only a privately held lead can be recycled');
      }
      return {
        action: 'RECYCLE',
        fromEmployeeId: lead.assignedTo,
        toEmployeeId: null,
        reason: note,
        poolStatus: 'RECYCLED',
        assignedTo: null,
        assignedAt: null,
        auditAction: 'LEAD_RECYCLE',
      };
    }, transaction);
  }

  /**
   * 超时回收批（决策 7，内部方法——Task 9 超时扫描器以系统 actor 构造本 service 后调用）：
   * 刻意不做动作权限/数据范围校验（调用方是系统任务而非用户请求，影响面由查询条件天然收敛）。
   * **Task 10 禁止把本方法无守卫地暴露为 HTTP 端点**：若未来需要手动触发，必须在路由层
   * 单独加动作权限（lead.recycle）与数据范围校验，不得直接路由到本方法。
   *   poolStatus=PRIVATE AND status IN ('NEW','ASSIGNED') AND updatedAt < now - noFollowHours
   *   （严格小于：恰在阈值上不回收；阈值一次性计算，候选查询与逐条复核共用同一边界）。
   * 每条线索在**独立事务**中回收：单行失败（版本冲突/事件写入失败等）整体回滚该行并跳过，
   * 不中断批次；返回 { recycledCount, leadIds }（仅成功项）。
   * now 参数为确定性测试接缝，生产调用省略。
   */
  async recycleOverdueLeads(noFollowHours: number, now?: Date): Promise<RecycleOverdueResult> {
    const hours = normalizeNonNegativeInteger(noFollowHours);
    if (hours < 1) throw new MasterDataError('VALIDATION_FAILED', 400);
    if (now !== undefined && (!(now instanceof Date) || Number.isNaN(now.getTime()))) {
      throw new MasterDataError('VALIDATION_FAILED', 400);
    }
    const threshold = new Date((now ?? new Date()).getTime() - hours * HOUR_MS);
    const overdueWhere: Prisma.LeadWhereInput = {
      deletedAt: null,
      poolStatus: 'PRIVATE',
      status: { in: ['NEW', 'ASSIGNED'] },
      updatedAt: { lt: threshold },
    };
    const candidates = await this.prisma.lead.findMany({
      where: overdueWhere,
      select: { id: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });

    const leadIds: string[] = [];
    for (const candidate of candidates) {
      try {
        const recycledId = await this.prisma.$transaction(async tx => {
          // 事务内按同一阈值复核资格：候选快照后状态可能已变（被跟进/被手动回收）。
          const lead = await tx.lead.findFirst({
            where: { AND: [overdueWhere, { id: candidate.id }] },
          });
          if (!lead) return null;
          const changed = await tx.lead.updateMany({
            where: { id: lead.id, version: lead.version },
            data: {
              poolStatus: 'RECYCLED',
              assignedTo: null,
              assignedAt: null,
              updatedBy: this.actor.actorUserId,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);
          await tx.leadPoolRecord.create({
            data: {
              leadId: lead.id,
              action: 'RECYCLE',
              fromEmployeeId: lead.assignedTo,
              toEmployeeId: null,
              reason: AUTO_RECYCLE_REASON(hours),
              operatedBy: this.actor.actorUserId,
            },
          });
          await this.outbox.append(tx, this.envelope(lead, {
            leadId: lead.id,
            action: 'RECYCLE',
            fromEmployeeId: lead.assignedTo,
            toEmployeeId: null,
          }));
          await this.writeOperationAudit(tx, lead, 'LEAD_RECYCLE', {
            action: 'RECYCLE',
            fromEmployeeId: lead.assignedTo,
            toEmployeeId: null,
            poolStatus: 'RECYCLED',
            reason: AUTO_RECYCLE_REASON(hours),
          });
          return lead.id;
        });
        if (recycledId) leadIds.push(recycledId);
      } catch (error) {
        // 决策 7：单行失败不中断批次。失败行事务已整体回滚（归属/日志/事件均未落库）。
        // 最小可观测钩子（决策 7 修复轮）：error 级日志带 leadId 与错误摘要（错误对象只含
        // 稳定码/消息，不含业务明文），使失败行可被运维发现；返回形状不变——扫描器侧
        // 仍可对账（候选数 vs recycledCount），明细不随返回形状带出。
        console.error(
          '[lead-assignment-service] recycleOverdueLeads row failed: leadId=%s error=%s',
          candidate.id,
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
    }
    return { recycledCount: leadIds.length, leadIds };
  }

  /**
   * 手动池操作共享事务骨架：范围过滤加载（404 fail-closed）→ decide 计算归属变更 →
   * version 乐观锁更新（NEW→ASSIGNED 联动写 status）→ LeadPoolRecord(append-only) →
   * outbox lead.assigned（+ 条件 lead.status_changed）→ OperationLog 业务审计，全部同事务；
   * 提交后投影脱敏视图并做 READ_L3_FIELDS 明文读取审计（读后置，同 getLead）。
   */
  private async mutatePoolOwnership(
    leadId: string,
    scopeWhere: Prisma.LeadWhereInput,
    purpose: string,
    decide: (
      tx: Prisma.TransactionClient,
      lead: Lead,
    ) => PoolMutation | Promise<PoolMutation>,
    transaction?: Prisma.TransactionClient,
  ): Promise<LeadView> {
    const updated = await crmTransaction(this.prisma, transaction, async tx => {
      const lead = await tx.lead.findFirst({
        where: { AND: [scopeWhere, { id: leadId, deletedAt: null }] },
      });
      if (!lead) throw new CrmError(LEAD_NOT_FOUND, 404, 'lead not found');
      const mutation = await decide(tx, lead);

      // 决策 4：落地私海时若 status=NEW 则经 canTransition 门卫推进到 ASSIGNED；
      // 其余 status（含回收路径）一律不动。
      const fromStatus = lead.status as LeadStatus;
      const promoteToAssigned = mutation.poolStatus === 'PRIVATE'
        && canTransition(fromStatus, 'ASSIGNED');
      const changed = await tx.lead.updateMany({
        where: { id: lead.id, version: lead.version },
        data: {
          poolStatus: mutation.poolStatus,
          assignedTo: mutation.assignedTo,
          assignedAt: mutation.assignedAt,
          ...(promoteToAssigned ? { status: 'ASSIGNED' } : {}),
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new MasterDataError('VERSION_CONFLICT', 409);

      await tx.leadPoolRecord.create({
        data: {
          leadId: lead.id,
          action: mutation.action,
          fromEmployeeId: mutation.fromEmployeeId,
          toEmployeeId: mutation.toEmployeeId,
          reason: mutation.reason,
          operatedBy: this.actor.actorUserId,
        },
      });
      await this.outbox.append(tx, this.envelope(lead, {
        leadId: lead.id,
        action: mutation.action,
        fromEmployeeId: mutation.fromEmployeeId,
        toEmployeeId: mutation.toEmployeeId,
      }));
      if (promoteToAssigned) {
        const statusPayload: LeadStatusChangedV1 = {
          leadId: lead.id,
          fromStatus,
          toStatus: 'ASSIGNED',
        };
        await this.outbox.append(tx, this.envelope(lead, statusPayload, LEAD_STATUS_CHANGED));
      }
      await this.writeOperationAudit(tx, lead, mutation.auditAction, {
        action: mutation.action,
        fromEmployeeId: mutation.fromEmployeeId,
        toEmployeeId: mutation.toEmployeeId,
        poolStatus: mutation.poolStatus,
        ...(promoteToAssigned ? { fromStatus, toStatus: 'ASSIGNED' } : {}),
        ...(mutation.reason ? { reason: mutation.reason } : {}),
      });
      return tx.lead.findUniqueOrThrow({ where: { id: lead.id } });
    });

    const fieldPermissions = this.leadFieldPermissions();
    await auditRawL3Access(
      this.prisma,
      this.actor,
      'LEAD',
      updated.id,
      'lead',
      fieldPermissions,
      1,
      purpose,
      transaction,
    );
    return projectLead(updated, fieldPermissions);
  }

  /** 与 lead-service 同一范围语义（决策 6）：共享 lead-scope buildLeadScopeWhere。 */
  private async scopeWhere(permissionCode: PermissionCode): Promise<Prisma.LeadWhereInput> {
    return buildLeadScopeWhere(this.prisma, this.authorization, this.authorizationContext, permissionCode);
  }

  /** 字段权限与 lead-service 一致：返回视图即一次读取，按 lead.read 判定 L3 readLevel。 */
  private leadFieldPermissions(): LeadFieldPermissions {
    return {
      phone: this.fieldProjection.fieldCapability(
        this.authorizationContext, 'lead', 'lead.phone', 'lead.read',
      ).readLevel,
      wechat: this.fieldProjection.fieldCapability(
        this.authorizationContext, 'lead', 'lead.wechat', 'lead.read',
      ).readLevel,
    };
  }

  /**
   * 池变更 OperationLog 业务审计：只落安全字段（leadNo/action/from/to/poolStatus/status 对/
   * reason），禁止 phone/wechat/name 明文（与 lead-service 审计纪律一致）。
   */
  private async writeOperationAudit(
    tx: Prisma.TransactionClient,
    lead: Lead,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await tx.operationLog.create({
      data: {
        userId: this.actor.actorUserId,
        action,
        targetType: 'LEAD',
        targetId: lead.id,
        newValues: JSON.stringify({ leadNo: lead.leadNo, ...details }),
        ip: this.actor.ip,
      },
    });
  }

  private envelope(
    lead: Lead,
    payload: LeadAssignedV1 | LeadStatusChangedV1,
    eventType: string = LEAD_ASSIGNED,
  ): EventEnvelopeInput {
    return {
      eventType,
      eventVersion: 1,
      objectType: 'LEAD',
      objectId: lead.id,
      operatorUserId: this.actor.actorUserId,
      organizationId: null,
      branchId: lead.branchId ?? null,
      teamId: lead.professionalTeamId ?? null,
      payload,
      traceId: this.actor.requestId ?? randomUUID(),
      occurredAt: new Date(),
    };
  }
}
