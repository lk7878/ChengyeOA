import { guardAnalysisApproval } from '../quality/analysis-review-policy';
import { qualityActor } from '../quality/quality-scope';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * SPEC-021 Task 1: 审批超时升级扫描单元（ApprovalTimeoutScanner）。
 * **不是** EventHandler、不注册进 handler registry：由 EventWorker 的可选 tickListener
 * 节律驱动（event-services-factory 组装时注入 `scanner.scanOnce`，沿 SPEC-009
 * LeadRecycleScanner 注入点），与事件投递管线完全隔离——worker 以 try/catch 包裹
 * listener，扫描器失败仅记日志，绝不影响投递。
 *
 * 判定（设计 D1）：PENDING task 且 `createdAt < now - timeoutHours` 且关联实例仍 PENDING。
 * 升级动作（D2/D3）：为目标审批人（task.assigneeId）生成 Notification（type 'APPROVAL'、
 * title「审批超时提醒」、content 含实例标题与节点、relatedId=instanceId、
 * relatedType='APPROVAL_INSTANCE'、routeUrl 待办页）——deduplicationKey
 * `approval-timeout:{instanceId}:{taskId}:{dateKey(now)}` 按天去重，避免每 tick 刷屏。
 * 审计（D4）：operation_log action APPROVAL_TIMEOUT_NOTIFIED（targetType APPROVAL_TASK，
 * newValues 含 taskId/instanceId/assigneeId/timeoutHours，ip 'system'——系统任务入口，
 * 'system' 自描述且落无外键审计列）。
 * 幂等（D6）：findFirst 预查 dedup key 命中跳过；并发 P2002（isUniqueConflictOn
 * deduplicationKey）跳过。
 * 零事件（D10）：不产 outbox 事件，直接落 Notification + 审计；零结构变更。
 * 系统任务入口：不做动作权限/数据范围校验，影响面由查询条件
 * （PENDING + 超时 + 实例 PENDING）天然收敛。
 */
export interface ApprovalTimeoutScannerConfig {
  /** 阈值（env APPROVAL_TIMEOUT_HOURS 默认 72），小时。 */
  readonly timeoutHours: number;
  /** dedup key 前缀（'approval-timeout'）。 */
  readonly dedupPrefix: string;
  /** 单次扫描上限（默认 100）。 */
  readonly batchSize: number;
}

export class ApprovalTimeoutScanner {
  private cursor: { createdAt: Date; id: string } | null = null;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: ApprovalTimeoutScannerConfig,
  ) {
    // 防御性阈值范围校验（Task 2 M 项，沿 config/env.ts parseApprovalTimeoutEnvironment
    // 1-8760 语义）：构造时即 fail-fast，防误配/非法注入产生静默窗口。
    if (!Number.isSafeInteger(config.timeoutHours) || config.timeoutHours < 1 || config.timeoutHours > 8760) {
      throw new RangeError('Approval timeout threshold must be between 1 and 8760 hours');
    }
    if (!Number.isSafeInteger(config.batchSize) || config.batchSize < 1) {
      throw new RangeError('Approval timeout scanner batch size must be a positive integer');
    }
    if (typeof config.dedupPrefix !== 'string' || config.dedupPrefix.trim().length === 0) {
      throw new TypeError('Approval timeout dedup prefix must be a non-empty string');
    }
  }

  /**
   * 执行一次超时扫描：查 PENDING task 且 createdAt < now - timeoutHours 且实例 PENDING
   * → 为 assignee 生成提醒通知（dedup 幂等）→ 审计。返回成功提醒数。
   * now 为确定性测试接缝（worker 注入其 tick 时钟，生产即当前时间）。
   */
  async scanOnce(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.timeoutHours * 3_600_000);
    const dayKey = dateKey(now);
    // batchSize 饥饿修复（Task 2，I×1 必修）：恒定取最旧 batchSize 条时，超时 task
    // > batchSize 则 101+ 永远不进窗口漏提醒。修复（裁决 2 首选方案 a）：查询加
    // NOT IN 已通知 dedup key 谓词——已通知 task 的 dedup key 已知
    // （approval-timeout:{instanceId}:{taskId}:{dateKey}），按当天日期提取已通知
    // taskId 集排除，查询窗口自然推进（下个 tick 排除已通知 → 取下一批最旧未通知）。
    // 跨日不排除（按天去重语义：昨日已通知仍可今日再提醒）。
    const notified = await this.prisma.notification.findMany({
      where: {
        type: 'APPROVAL',
        deduplicationKey: {
          startsWith: `${this.config.dedupPrefix}:`,
          endsWith: `:${dayKey}`,
        },
      },
      select: { deduplicationKey: true },
    });
    const notifiedTaskIds = notified
      .map(item => item.deduplicationKey.split(':')[2])
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const tasks = await this.prisma.approvalTask.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: cutoff },
        ...(this.cursor ? { OR: [
          { createdAt: { gt: this.cursor.createdAt } },
          { createdAt: this.cursor.createdAt, id: { gt: this.cursor.id } },
        ] } : {}),
        ...(notifiedTaskIds.length > 0 ? { id: { notIn: notifiedTaskIds } } : {}),
        instance: { status: 'PENDING',businessType:{not:'SOP_REVIEW'} },
      },
      include: { instance: { select: { id: true, title: true, applicantId: true,businessType:true } } },
      take: this.config.batchSize,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    // Revoked managed reviewers produce no notification; still advance past them.
    // Wrap after the last page so a subsequently restored grant is reconsidered.
    const last = tasks.at(-1);
    this.cursor = tasks.length === this.config.batchSize && last
      ? { createdAt: last.createdAt, id: last.id } : null;

    let notifiedCount = 0;
    for (const task of tasks) {
      if(task.instance.businessType==='QUALITY_ANALYSIS'){
        try{const ctx=await qualityActor(this.prisma,task.assigneeId);await guardAnalysisApproval(this.prisma,ctx,task.instanceId,'APPROVE');const close=await this.prisma.analysisCloseRequest.findUnique({where:{approvalInstanceId:task.instanceId},include:{analysis:true}});if(!close||close.status!=='PENDING'||close.analysis.currentCloseId!==close.id||close.analysis.status!=='PENDING_CLOSE')continue;}catch(error){const status=(error as {status?:number})?.status;if(status&&status>=400&&status<500)continue;throw error;}
      }

      const dedupKey = `${this.config.dedupPrefix}:${task.instanceId}:${task.id}:${dateKey(now)}`;
      const existing = await this.prisma.notification.findUnique({
        where: { deduplicationKey: dedupKey },
      });
      if (existing) continue;

      try {
        const inserted = await this.prisma.$transaction(async tx => {
          if (task.instance.businessType === 'QUALITY_ANALYSIS') {
            const current = await tx.approvalTask.findUnique({ where: { id: task.id }, include: { instance: true } });
            if (current?.status !== 'PENDING' || current.instance.status !== 'PENDING') return false;
            await guardAnalysisApproval(tx, await qualityActor(tx, task.assigneeId), task.instanceId, 'APPROVE');
          }
          await tx.notification.create({
            data: {
              userId: task.assigneeId,
              type: 'APPROVAL',
              title: '审批超时提醒',
              content: `审批「${task.instance.title}」在节点「${task.nodeName}」已超过 ${this.config.timeoutHours} 小时待处理`,
              relatedId: task.instanceId,
              relatedType: 'APPROVAL_INSTANCE',
              deduplicationKey: dedupKey,
              routeUrl: '/approvals?role=TODO',
            },
          });
          await tx.operationLog.create({
            data: {
              userId: task.assigneeId,
              action: 'APPROVAL_TIMEOUT_NOTIFIED',
              targetType: 'APPROVAL_TASK',
              targetId: task.id,
              newValues: JSON.stringify({
                taskId: task.id,
                instanceId: task.instanceId,
                assigneeId: task.assigneeId,
                timeoutHours: this.config.timeoutHours,
              }),
              ip: 'system',
            },
          });
          return true;
        });
        if (inserted) notifiedCount += 1;
      } catch (error) {
        if (task.instance.businessType === 'QUALITY_ANALYSIS' && [401, 403, 404, 409].includes((error as { status?: number }).status ?? 0)) continue;
        // 并发防重：同一 dedup key 唯一冲突 → 视为已提醒跳过。
        if (isUniqueConflictOn(error, 'deduplicationKey')) continue;
        throw error;
      }
    }
    return notifiedCount;
  }
}

/** UTC 天 key（YYYY-MM-DD）：dedup key 按天粒度，跨日再提醒。 */
function dateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Prisma P2002 唯一冲突判定（沿 approval-instance-service :1023 同型本地镜像，零 import 循环）。 */
function isUniqueConflictOn(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes(field);
}
