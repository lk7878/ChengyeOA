// SPEC-009 Task 7: lead-follow-service —— 跟进记录 + 首响时长计量。
// 事务边界（设计 §6.2/§6.4）：LeadFollow 写入、首响计量写回、状态推进、outbox 事件、
//   OperationLog 审计全部同事务；不依赖事件往返。
// 动作权限（决策 1）：recordFollow=lead.update、listFollows=lead.read，均为公开方法首条语句
//   （AuthorizationService.requireAction）。
// 数据范围（决策 1）：用同一权限码走共享 buildLeadScopeWhere（与 lead-service 完全同语义：
//   SELF→assignedTo / TEAM→professionalTeamId / BRANCH·ORG→branchId 子树 / OR 并集 / 零谓词
//   fail-closed）；不可见 → LEAD_NOT_FOUND(404) 不泄露存在性。
// 输入纪律（决策 2）：type ∈ PHONE|WECHAT|VISIT|ONLINE|OTHER（否则 400 VALIDATION_FAILED）；
//   content 必填非空；nextPlan/nextTime 可选；createdBy=actorUserId（同 lead-service 写 createdBy
//   的方式）；updatedBy 创建时恒 null（schema Minor-2 回补列，预留给后续编辑动作）。
// 首响计量（决策 3，设计 §6.4）：同事务内若 lead.firstResponseSeconds IS NULL，
//   锚点 = assignedAt ?? createdAt，firstResponseSeconds = max(0, floor((follow.createdAt
//   - 锚点)/1000))（非负兜底：时钟回拨/未来锚点归 0），经 version 乐观锁 updateMany 写回
//   Lead。计量一经写入绝不重算——lead 快照 firstResponseSeconds 非 NULL 时不再触碰该列
//   （但见决策 4 修订：ASSIGNED 首跟仍可能为推进而写 Lead 行其他列）。
// 状态推进（决策 4，设计 §6.3 步骤 3）：仅当 lead.status=ASSIGNED 且 canTransition 时，随同一次
//   写回推进 CONTACTED 并同事务发 lead.status_changed v1（严格三键 {leadId, fromStatus,
//   toStatus}；envelope objectType='LEAD'、objectId=leadId、eventVersion=1、branchId/teamId 取
//   Lead 行原样透传，同 Task 6 模式）。NEW 不推进（NEW→CONTACTED 不在流转表）但仍计量
//   （锚点回退 createdAt）；其余 status 一律不动。
// 决策 4 修订（2026-07-29 用户裁定）：原"第二条跟进起 Lead 行完全不动"放宽为——计量绝不
//   重算，但首个见到 status=ASSIGNED 的跟进仍推进 CONTACTED（即使计量早在公海 NEW 阶段
//   已完成）。计量（shouldMeter）与推进（shouldPromote）解耦为两个独立标志，任一成立即
//   做一次 version 乐观锁写回；仅计量不写事件，仅推进或两者兼有均照常推进+发事件。
//   修复场景：公海 NEW 首跟计量 → 认领转 ASSIGNED → 再跟进时原实现永跳过计量块导致
//   状态滞留 ASSIGNED（死状态）。
// 审计（决策 5）：每次创建写 OperationLog(LEAD_FOLLOW_CREATE)，只落安全字段
//   {leadId, followId, type}——绝不落 content/nextPlan 自由文本。LeadFollow 无 L3 字段，
//   列表/详情输出不脱敏、不落 READ_L3_FIELDS 审计。
// 并发（决策 7）：并发双跟（首跟计量竞态，或已计量 ASSIGNED 的推进竞态）写回走 version
//   乐观锁——恰一方 count=1 胜出（写回 + 状态推进 + 事件）；败方 count=0 视为"写回已被
//   胜出者完成"，不抛错、不重试，自己的 LeadFollow 行照常提交。绝不静默覆盖，也绝不因
//   计量/推进竞态回滚跟进记录。

import { randomUUID } from 'node:crypto';

import { LeadFollow, Prisma, PrismaClient } from '@prisma/client';

import { AuthorizationContext, AuthorizationService } from '../authorization/authorization-service';
import { DataScopeService } from '../authorization/data-scope-service';
import { EventOutboxWriter, PrismaEventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import { PermissionCode } from '../../domain/authorization/authorization-types';
import { CrmError, LEAD_NOT_FOUND } from '../../domain/crm/lead-errors';
import { canTransition } from '../../domain/crm/lead-policy';
import {
  EventEnvelopeInput,
  LEAD_STATUS_CHANGED,
  LeadStatusChangedV1,
} from '../../domain/events/event-types';
import { MasterDataError } from '../../domain/master-data/master-data-errors';
import {
  assertExactKeys,
  normalizeAllowedValue,
  normalizeOptionalText,
  normalizeRequiredText,
} from '../../domain/master-data/master-data-validation';
import { buildLeadScopeWhere } from './lead-scope';

/** schema LeadFollow.type 取值（决策 2，对齐 PRD 枚举）。 */
export const LEAD_FOLLOW_TYPES = ['PHONE', 'WECHAT', 'VISIT', 'ONLINE', 'OTHER'] as const;
export type LeadFollowType = (typeof LEAD_FOLLOW_TYPES)[number];

export interface RecordFollowInput {
  type: LeadFollowType;
  content: string;
  nextPlan?: string;
  nextTime?: Date;
}

/** LeadFollow 输出视图（决策 6）：无 L3 字段，content 明文可见；不含 updatedBy（创建恒 null）。 */
export interface LeadFollowView {
  id: string;
  leadId: string;
  type: string;
  content: string;
  nextPlan: string | null;
  nextTime: Date | null;
  createdBy: string;
  createdAt: Date;
}

export class LeadFollowService {
  private readonly authorization: AuthorizationService;
  private readonly outbox: EventOutboxWriter;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: AuditActor,
    private readonly authorizationContext: AuthorizationContext,
    outbox?: EventOutboxWriter,
  ) {
    this.authorization = new AuthorizationService(new DataScopeService(prisma));
    this.outbox = outbox ?? new PrismaEventOutboxWriter();
  }

  /**
   * 记录跟进（决策 1/2/3/4/5/7）：lead.update 权限 + 范围校验（不可见 404）→
   * 同事务写 LeadFollow（createdBy=actor、updatedBy=null）→ 按两个独立标志做一次
   * version 锁写回：shouldMeter（尚未计量 → 内联计量 firstResponseSeconds）与
   * shouldPromote（首见 ASSIGNED → 推进 CONTACTED + 状态事件；决策 4 修订 2026-07-29，
   * 与计量解耦，计量已完成仍推进）→ OperationLog 安全字段审计。
   * 写回竞态败方不抛错，跟进记录照常提交。
   */
  async recordFollow(leadId: string, input: RecordFollowInput): Promise<LeadFollowView> {
    this.authorization.requireAction(this.authorizationContext, 'lead.update');
    const id = normalizeRequiredText(leadId, 1, 100);
    assertExactKeys(input, ['type', 'content', 'nextPlan', 'nextTime']);
    const type = normalizeAllowedValue(input.type, LEAD_FOLLOW_TYPES);
    const content = normalizeRequiredText(input.content, 1, 2000);
    const nextPlan = normalizeOptionalText(input.nextPlan, 500);
    const nextTime = normalizeOptionalDateTime(input.nextTime);
    const scopeWhere = await this.scopeWhere('lead.update');

    const follow = await this.prisma.$transaction(async tx => {
      const lead = await tx.lead.findFirst({
        where: { AND: [scopeWhere, { id, deletedAt: null }] },
      });
      if (!lead) throw new CrmError(LEAD_NOT_FOUND, 404, 'lead not found');

      const created = await tx.leadFollow.create({
        data: {
          leadId: lead.id,
          type,
          content,
          nextPlan,
          nextTime,
          createdBy: this.actor.actorUserId,
          updatedBy: null,
        },
      });

      // 决策 3/4（决策 4 修订 2026-07-29）：计量与推进是两个独立标志——
      //   shouldMeter：尚未计量（firstResponseSeconds IS NULL）→ 锚点 assignedAt ?? createdAt 写回；
      //   shouldPromote：首个见到 status=ASSIGNED 的跟进（且流转表允许）→ 推进 CONTACTED，
      //     即使计量早已完成（修复"公海计量后认领，状态滞留 ASSIGNED"死状态）。
      // 任一成立即做一次 version 乐观锁写回；二者皆不成立则 Lead 行完全不动。
      const shouldMeter = lead.firstResponseSeconds === null;
      const shouldPromote =
        lead.status === 'ASSIGNED' && canTransition('ASSIGNED', 'CONTACTED');
      if (shouldMeter || shouldPromote) {
        const data: Prisma.LeadUncheckedUpdateManyInput = {
          updatedBy: this.actor.actorUserId,
          version: { increment: 1 },
        };
        if (shouldMeter) {
          const anchor = lead.assignedAt ?? lead.createdAt;
          data.firstResponseSeconds = Math.max(
            0,
            Math.floor((created.createdAt.getTime() - anchor.getTime()) / 1000),
          );
        }
        if (shouldPromote) {
          data.status = 'CONTACTED';
        }
        const changed = await tx.lead.updateMany({
          where: { id: lead.id, version: lead.version },
          data,
        });
        // 决策 7：count=0 即并发败方（计量/推进已被胜出者完成）——不抛错，跟进照常提交。
        // 仅计量（shouldPromote=false）的写回不发任何事件。
        if (changed.count === 1 && shouldPromote) {
          const statusPayload: LeadStatusChangedV1 = {
            leadId: lead.id,
            fromStatus: 'ASSIGNED',
            toStatus: 'CONTACTED',
          };
          await this.outbox.append(tx, this.envelope(lead, statusPayload));
        }
      }

      // 决策 5：审计只落安全字段，绝不落 content/nextPlan 自由文本。
      await tx.operationLog.create({
        data: {
          userId: this.actor.actorUserId,
          action: 'LEAD_FOLLOW_CREATE',
          targetType: 'LEAD',
          targetId: lead.id,
          newValues: JSON.stringify({ leadId: lead.id, followId: created.id, type: created.type }),
          ip: this.actor.ip,
        },
      });
      return created;
    });

    return projectLeadFollow(follow);
  }

  /**
   * 跟进列表（决策 1/6）：lead.read 权限 + 范围校验（不可见/不存在 → 404）；
   * 按 createdAt DESC（id ASC 决胜）返回视图契约字段。
   */
  async listFollows(leadId: string): Promise<LeadFollowView[]> {
    this.authorization.requireAction(this.authorizationContext, 'lead.read');
    const id = normalizeRequiredText(leadId, 1, 100);
    const scopeWhere = await this.scopeWhere('lead.read');
    const lead = await this.prisma.lead.findFirst({
      where: { AND: [scopeWhere, { id, deletedAt: null }] },
      select: { id: true },
    });
    if (!lead) throw new CrmError(LEAD_NOT_FOUND, 404, 'lead not found');
    const follows = await this.prisma.leadFollow.findMany({
      where: { leadId: lead.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return follows.map(projectLeadFollow);
  }

  /** 与 lead-service 同一范围语义（决策 1）：共享 lead-scope buildLeadScopeWhere。 */
  private async scopeWhere(permissionCode: PermissionCode): Promise<Prisma.LeadWhereInput> {
    return buildLeadScopeWhere(this.prisma, this.authorization, this.authorizationContext, permissionCode);
  }

  /** lead.status_changed v1 信封（同 Task 6 模式：branch/team 取 Lead 行原样透传）。 */
  private envelope(
    lead: { id: string; branchId: string | null; professionalTeamId: string | null },
    payload: LeadStatusChangedV1,
  ): EventEnvelopeInput {
    return {
      eventType: LEAD_STATUS_CHANGED,
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

function projectLeadFollow(follow: LeadFollow): LeadFollowView {
  return {
    id: follow.id,
    leadId: follow.leadId,
    type: follow.type,
    content: follow.content,
    nextPlan: follow.nextPlan,
    nextTime: follow.nextTime,
    createdBy: follow.createdBy,
    createdAt: follow.createdAt,
  };
}

function normalizeOptionalDateTime(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new MasterDataError('VALIDATION_FAILED', 400);
  }
  return value;
}
