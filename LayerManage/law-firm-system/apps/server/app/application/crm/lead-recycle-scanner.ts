import { Prisma, PrismaClient } from '@prisma/client';

import type { LeadRecycleEnvironment } from '../../../config/env';
import { EventEnvelopeInput } from '../../domain/events/event-types';
import { AuthorizationContext } from '../authorization/authorization-service';
import { EventOutboxWriter } from '../events/event-outbox-writer';
import { AuditActor } from '../master-data/master-data-types';
import { LeadAssignmentService } from './lead-assignment-service';

/**
 * SPEC-009 Task 9 超时回收扫描单元（候选 A，设计 §6.5/§13）。
 * **不是** EventHandler、不注册进 handler registry：由 EventWorker 的可选 tickListener
 * 节律驱动（event-services-factory 组装时注入 `scanner.scanOnce`），与事件投递管线完全
 * 隔离——worker 以 try/catch 包裹 listener，扫描器失败仅记日志，绝不影响投递。
 * 回收核心直接复用 lead-assignment-service.recycleOverdueLeads 原样候选规则
 * （R-1 裁定：不附加 firstResponseSeconds IS NULL 谓词——公海计量后认领再闲置的线索
 * 必须可回收，否则形成死线索漏洞）。
 *
 * 系统 actor（模块级常量，本 SPEC 内唯一）：{ actorUserId: 'system' }。
 *   - 落无外键审计列：Lead.updatedBy / LeadPoolRecord.operatedBy / OperationLog.userId
 *     （均为纯文本列，'system' 自描述且安全）。
 *   - **不可**直接落 EventLog.operatorUserId：该列有真 FK
 *     （event_log_operatorUserId_fkey → "user"(id)）且信封校验 validateEventEnvelope
 *     要求 operatorUserId 为 UUID 或 null。故构造时经 SystemEventOperatorNullingOutboxWriter
 *     包装，把系统 actor 的事件 operatorUserId 改写为 null（系统来源事件无人为操作者；
 *     null 同时满足信封校验与 FK）。仅改写 operatorUserId === 'system' 的信封，其余原样透传。
 */
const LEAD_RECYCLE_SYSTEM_ACTOR: AuditActor = Object.freeze({ actorUserId: 'system' });

/**
 * recycleOverdueLeads 刻意不做动作权限/数据范围校验（系统任务入口，影响面由查询条件
 * 天然收敛）；该上下文仅为满足 LeadAssignmentService 构造签名，永远不会被读取。
 */
const SYSTEM_AUTHORIZATION_CONTEXT: AuthorizationContext = Object.freeze({
  userId: LEAD_RECYCLE_SYSTEM_ACTOR.actorUserId,
  employeeId: null,
  isSystemSuperAdmin: false,
  isSystemAdmin: false,
  grants: [],
  fieldRules: [],
  permissionCodes: [],
  evaluatedAt: new Date(0),
});

class SystemEventOperatorNullingOutboxWriter implements EventOutboxWriter {
  constructor(private readonly inner: EventOutboxWriter) {}

  append(tx: Prisma.TransactionClient, input: EventEnvelopeInput): Promise<{ eventId: string }> {
    if (input.operatorUserId !== LEAD_RECYCLE_SYSTEM_ACTOR.actorUserId) {
      return this.inner.append(tx, input);
    }
    return this.inner.append(tx, { ...input, operatorUserId: null });
  }
}

export class LeadRecycleScanner {
  private readonly assignmentService: LeadAssignmentService;

  constructor(
    prisma: PrismaClient,
    private readonly config: LeadRecycleEnvironment,
    outboxWriter: EventOutboxWriter,
  ) {
    this.assignmentService = new LeadAssignmentService(
      prisma,
      LEAD_RECYCLE_SYSTEM_ACTOR,
      SYSTEM_AUTHORIZATION_CONTEXT,
      new SystemEventOperatorNullingOutboxWriter(outboxWriter),
    );
  }

  /**
   * 执行一次超时扫描：enabled=false 时直接返回 0 且零写入；
   * 否则按 noFollowHours 窗口回收超时私海线索，返回成功回收条数。
   * now 为确定性测试接缝（worker 注入其 tick 时钟，生产即当前时间）。
   */
  async scanOnce(now: Date): Promise<number> {
    if (!this.config.enabled) return 0;
    const result = await this.assignmentService.recycleOverdueLeads(this.config.noFollowHours, now);
    return result.recycledCount;
  }
}
