# SPEC-021 审批超时升级（Timeout Escalation）设计

日期：2026-08-03 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-016/017/018/019/020 closeout §9「审批中心深化余项——超时升级（PENDING task 滞留自动升级/提醒）」
设计权威：本文档 ｜ 前置：SPEC-013（Task/Notification 模型）+ SPEC-007/008（事件 worker tick 旁挂模式）+ SPEC-009（LeadRecycleScanner 先例）

## 1. 背景与目标

审批中心已具备完整处置能力（多级/会签/定义管理/转交/加签），但 **PENDING task 滞留无感知**——审批人请假/忽略/失联时，任务静默悬挂，申请人和系统无提醒，审批链可能卡死。

**目标**：超时升级——定时扫描 PENDING task 滞留超时（配置阈值），为目标审批人生成**提醒通知**（Notification type APPROVAL，deduplicationKey 幂等防重）+ 审计。**零结构变更**（复用 Notification/operation_log 既有表，不产 outbox 事件——事件 15 不变；无 worker 部署新增——复用事件 worker tick 旁挂 scanner 模式）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 判定 | PENDING task 且 `createdAt < now - thresholdHours`（阈值 = `APPROVAL_TIMEOUT_HOURS` env，默认 **72**）且实例仍 PENDING——超时候选 |
| D2 | 升级动作 | 为目标审批人（task.assigneeId）生成 **Notification**（type `'APPROVAL'`、title「审批超时提醒」、content 含实例标题/节点、relatedId=instanceId、relatedType='APPROVAL_INSTANCE'、routeUrl 待办页）——**deduplicationKey** 幂等防重（`approval-timeout:{instanceId}:{taskId}:{scanDate}` 或 taskId 粒度） |
| D3 | 频率 | 每个超时 task 每 scan 窗口最多提醒一次（dedup key 含扫描日期粒度——按天去重，避免每 tick 刷屏） |
| D4 | 审计 | operation_log action `APPROVAL_TIMEOUT_NOTIFIED`（targetType APPROVAL_TASK，newValues 含 taskId/instanceId/assigneeId/timeoutHours） |
| D5 | worker | `ApprovalTimeoutScanner`（仿 LeadRecycleScanner）：`scanOnce(now)` 返回提醒数；由 event-services-factory 组装时注入 event-worker tick 旁挂 listener（沿 SPEC-009 注入点） |
| D6 | 幂等 | dedup key 唯一冲突 → 已提醒跳过（P2002 或 findFirst 预查）；重复 scan 不重复提醒 |
| D7 | 可测性 | `now` 注入 + 阈值可配（构造参）；`scanOnce(now)` 纯函数式可单测 |
| D8 | 前端 | 待办/详情 PENDING task 超时标识——**基于 Notification 的提醒**（用户见通知即可感知）；可选 Task 2 加基于 createdAt 的「超时」Tag（常量阈值镜像） |
| D9 | 零结构变更 | 无迁移/模型/权限/事件/路由变更（复用 Notification + operation_log） |
| D10 | 事件 | **不产 outbox 事件**（超时提醒直接落 Notification 表 + 审计；observability 经 Notification 承载） |

## 3. 服务层（approval-timeout-scanner.ts 新建）

```ts
export interface ApprovalTimeoutScannerConfig {
  readonly timeoutHours: number;   // 阈值（env APPROVAL_TIMEOUT_HOURS 默认 72）
  readonly dedupPrefix: string;    // 'approval-timeout'
  readonly batchSize: number;      // 单次扫描上限（默认 100）
}

export class ApprovalTimeoutScanner {
  constructor(prisma: PrismaClient, config: ApprovalTimeoutScannerConfig, now: () => Date) {}

  /** 扫描超时 PENDING task → 为 assignee 生成提醒通知（dedup 幂等）→ 审计。返回提醒数。 */
  async scanOnce(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.timeoutHours * 3600_000);
    // 超时候选：PENDING task + 实例 PENDING（关联实例）
    const tasks = await this.prisma.approvalTask.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: cutoff },
        instance: { status: 'PENDING' },
      },
      include: { instance: { select: { id: true, title: true, applicantId: true } } },
      take: this.config.batchSize,
      orderBy: [{ createdAt: 'asc' }],
    });
    let notified = 0;
    for (const task of tasks) {
      const dedupKey = `${this.config.dedupPrefix}:${task.instanceId}:${task.id}:${dateKey(now)}`;  // 按天
      const existing = await this.prisma.notification.findUnique({ where: { deduplicationKey: dedupKey } });
      if (existing) continue;
      try {
        await this.prisma.$transaction(async tx => {
          await tx.notification.create({
            data: {
              userId: task.assigneeId, type: 'APPROVAL',
              title: '审批超时提醒',
              content: `审批「${task.instance.title}」在节点「${task.nodeName}」已超过 ${this.config.timeoutHours} 小时待处理`,
              relatedId: task.instanceId, relatedType: 'APPROVAL_INSTANCE',
              deduplicationKey: dedupKey,
              routeUrl: '/approvals?role=TODO',
            },
          });
          await tx.operationLog.create({
            data: {
              userId: task.assigneeId, action: 'APPROVAL_TIMEOUT_NOTIFIED',
              targetType: 'APPROVAL_TASK', targetId: task.id,
              newValues: JSON.stringify({ taskId: task.id, instanceId: task.instanceId, assigneeId: task.assigneeId, timeoutHours: this.config.timeoutHours }),
              ip: 'system',
            },
          });
        });
        notified += 1;
      } catch (error) {
        if (isUniqueConflictOn(error, 'deduplicationKey')) continue;  // 并发防重
        throw error;
      }
    }
    return notified;
  }
}
```

- **节律**：`event-services-factory` 组装时沿 SPEC-009 LeadRecycleScanner 注入点（event-worker tick 旁挂 listener）注入 `scanner.scanOnce`——零部署新增。
- **不做动作权限/数据范围**：系统任务入口（沿 LeadRecycleScanner 注释语义），影响面由查询条件（PENDING + 超时 + 实例 PENDING）限定。
- **错误隔离**：tick 旁挂 listener try/catch 隔离（沿既有 listener 语义），scanOnce 抛错仅记日志不影响投递循环。

## 4. 配置

`APPROVAL_TIMEOUT_HOURS` env（默认 72；测试注入短阈值）。`config.ts`/`config.default.ts` 或 factory 读取——沿既有 env 配置模式。

## 5. 前端（可选 Task 2）

- 待办/详情 PENDING task 超时标识：基于 Notification 提醒（用户可见通知）为主；可选加「超时」Tag（前端镜像阈值常量计算 createdAt 距今）。
- **首版聚焦后端扫描 + 通知**（可独立验证）；前端超时 Tag 作为 Task 2 增强（需阈值配置同步——若前端无配置源，则仅在通知中体现，前端零改动）。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| 服务（scanOnce） | 超时 task 生成通知（assigneeId/title/content/dedup key/relatedId）+ 审计 / 未超时（createdAt 近）不生成 / 实例非 PENDING 不生成 / dedup 幂等（二次 scan 不重复）/ 按天去重（同日不重复、跨日再提醒）/ 并发 P2002 防重 |
| 节律 | factory 注入 tick 旁挂 listener（scanOnce 被调用） |
| 回归 | approval 域既有（instance 73 + definition 17 + api 23 + policy/catalog 34 + events 15）全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 7. 计数影响

**零结构变更**：迁移 26/模型 60/权限 122/事件 15/路由 11 全不变；后端测试 +N（scanner ~6 + 节律 ~1）；前端 +M（可选超时 Tag）。

## 8. 范围边界（明确 OUT）

- 自动升级动作（超时自动转交/加签/定稿）——高风险需更多裁决，另行。
- 超时提醒的多级升级（一级提醒→二级管理员）——另行。
- 审批人维度超时统计/驾驶舱——另行。
- 通知渠道（短信/邮件）——现有 Notification 表内承载，渠道另立。
- 全组织视图（approval.manage 扩展）——另行。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D10 | 见 §2 | 无人值守自主立项（用户授权） |
