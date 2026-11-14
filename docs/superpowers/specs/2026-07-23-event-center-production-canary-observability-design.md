# SPEC-008 事件中心生产灰度与内置可观测性设计

日期：2026-07-23  
状态：已完成交互式设计评审，等待书面规格复核  
前置规格：`docs/superpowers/specs/2026-07-22-reliable-event-center-outbox-design.md`

## 1. 背景

SPEC-007 已交付 PostgreSQL Outbox、Dispatcher、租约 Worker、固定重试、MANUAL 恢复、事件运维 API/Web、一次性 drain、备份恢复演练和不可变证据边界。当前剩余的首要风险不是事件模型缺失，而是首次生产启用 Worker 时缺少可重复执行的灰度门禁、跨进程存活证据、稳定告警判定和故障演练。

当前生产形态是 Windows portable/installer、单应用实例和 PostgreSQL 16。项目尚未接入 Prometheus、Grafana、OpenTelemetry 或其他外部监控平台。因此本规格采用系统内置可观测性，不新增外部运行时依赖。

## 2. 目标

1. 为单机单实例首次上线提供可执行的 preflight、canary 和 rollback 门禁。
2. 从持久化状态计算积压、MANUAL、数据库故障、Worker 存活和租约异常。
3. 让受权限保护的运维页面和独立巡检 CLI 使用同一判定规则。
4. 在数据库中断、未知事件、进程重启、租约丢失和回滚期间保持不丢事件、不重复通知、不改写历史。
5. 用稳定状态、告警码和退出码支持人工巡检与 Windows 任务计划程序。
6. 保持未来接入 Prometheus/OpenMetrics 时的命名兼容性，但本期不实现采集端点。

## 3. 非目标

- 不引入 Prometheus、Grafana、OpenTelemetry 或第三方告警服务。
- 不引入负载均衡、多应用实例或生产多 Worker 部署；多 Worker 仅用于并发安全测试。
- 不提供运行时远程启停 Worker 的 API 或页面按钮。
- 不新增告警确认、告警生命周期或告警事件表。
- 不删除、修改、跳过、批量重放或回放 EventLog、EventDelivery、EventHandlerLog。
- 不在本期实现事件归档、保留期限或历史清理。
- 不扩大正式业务事件和 handler 范围。
- 不修改匿名 `/api/health` 的既有数据库可用性语义。

## 4. 核心原则

### 4.1 单一判定内核

API、Web 和 CLI 都使用同一个运行快照查询器和纯逻辑判定器。不得在控制器、页面或脚本中复制阈值和告警逻辑。

### 4.2 持久状态优先

积压、MANUAL、Dispatcher 故障和租约异常都从 PostgreSQL 读取。独立 CLI 不能访问应用进程内存，因此 Worker 存活必须有最小化、无敏感字段的持久化状态。进程内健康快照仍可用于即时诊断，但不能成为 CLI 唯一依据。

### 4.3 Fail closed

配置无效、数据库或 migration 不可用、快照不完整、模式与 Worker 状态冲突时，不得返回 READY。未知异常只映射为稳定错误码和随机错误引用，不输出原始 message、stack 或连接信息。

### 4.4 不可变历史

可观测性只读取事件历史。唯一新增的可变持久状态是 Worker 运行状态记录，它不属于事件业务证据，不包含 payload、workerId、锁持有者或异常原文。

## 5. 方案选择

### 5.1 采用：实时判定、巡检 CLI 与运维页面

从事件表和 Worker 状态实时生成快照，再由纯逻辑规则转换为 `READY | DEGRADED | BLOCKED`。不持久化告警实例，不依赖外部监控平台。

### 5.2 未采用：持久化告警生命周期

新增告警表、确认状态和通知闭环会引入新的状态机、权限、审计和清理边界，超出首次灰度所需的最小范围。

### 5.3 未采用：仅依赖日志和手册

日志无法为独立巡检提供可靠、结构化、重启后可恢复的当前状态，也难以形成稳定退出码。

## 6. 架构与组件

### 6.1 `EventRuntimeSnapshotReader`

职责：在同一逻辑评估时间读取并归一化以下数据：

- 未分派 EventLog 数量及最老年龄；
- EventDelivery 各状态数量；
- 已到期 PENDING/RETRY_WAIT 数量及最老到期年龄；
- PROCESSING、已过期 PROCESSING 和超过一个完整 lease 周期仍未恢复的数量；
- MANUAL 数量和未解决 Dispatcher 故障数量；
- 最近 15 分钟 EventHandlerLog 的 LEASE_LOST 数量；
- 持久化 Worker 运行状态与最近心跳；
- 进程内 Worker 数据库失败摘要（仅 API 同进程可用；CLI 不依赖它做 READY 判断）。

数据库查询应使用一致的 `now`。聚合查询不能返回 payload、异常原文、workerId、lockedBy 或数据库元数据。

### 6.2 `EventRolloutPolicy`

职责：纯函数式接收快照、模式、Worker 配置和阈值，返回：

- 总状态：`READY | DEGRADED | BLOCKED`；
- 稳定排序的安全告警；
- 本次评估使用的安全指标；
- 对应 CLI 退出类别。

该组件不访问 Prisma、HTTP、进程环境、日志或系统时钟。

### 6.3 `EventWorkerRuntimeStatusStore`

职责：为单机 `primary` slot 保存最小化运行状态，使独立 CLI 能检测另一进程的 Worker 是否实际启动、正常心跳、优雅停止或意外失联。

新增表 `event_worker_runtime_status`，数据库以主键和 `CHECK (slot = 'primary')` 强制只允许一行正式 slot；`state` 也由数据库检查约束限制为下列四个值：

| 字段 | 说明 |
|---|---|
| `slot` | 主键，首期固定 `primary` |
| `configuredEnabled` | 应用启动时解析后的 Worker 开关 |
| `state` | `DISABLED | STARTING | RUNNING | STOPPED` |
| `processStartedAt` | 当前应用生命周期开始时间 |
| `lastHeartbeatAt` | 最近一次数据库可写且 Worker tick 成功的心跳 |
| `lastSuccessfulTickAt` | 最近成功完成 Dispatcher/claim 查询的 tick |
| `lastStoppedAt` | 最近优雅停止时间，非优雅退出不更新 |
| `version` | 乐观版本 |
| `updatedAt` | 数据库更新时间 |

该表不保存 workerId、主机名、PID、连接信息、payload、错误 message/stack 或锁信息。migration 只加法新增表和约束，不修改事件历史表。

生命周期行为：

1. Worker 关闭启动时写 `DISABLED`。
2. Worker 开启启动时写 `STARTING`，首个成功 tick 后写 `RUNNING`。
3. RUNNING 状态按受限心跳间隔更新；心跳只在完整 tick 的数据库操作成功后写入，避免每个 poll 都写数据库，也避免失败 tick 伪造存活。
4. `beforeClose` 停止领取并完成等待后写 `STOPPED`；若写入失败只记录安全日志。
5. 进程崩溃不会伪造 STOPPED，过期心跳由策略判为 BLOCKED。

### 6.4 API、Web 与 CLI 适配器

- API 扩展现有受 `event.delivery.read` 保护的 summary。
- Web 只展示快照、告警和处置建议。
- CLI 直接连接同一数据库并调用同一 reader/policy，不通过 HTTP，不要求保存管理员 token。

## 7. 快照语义

### 7.1 未分派事件

`undispatchedCount` 是 `dispatchedAt IS NULL` 的 EventLog 数量。`oldestUndispatchedSeconds` 使用最早 `createdAt` 与评估时间之差；没有未分派事件时为 0。

### 7.2 已到期积压

以下投递视为到期：

- `PENDING`；
- `RETRY_WAIT` 且 `nextAttemptAt <= now`。

PENDING 的 ready time 为 `createdAt`；RETRY_WAIT 的 ready time 为 `nextAttemptAt`。`oldestDueBacklogSeconds` 使用最早 ready time 计算，未到期的 RETRY_WAIT 不计入。

### 7.3 租约

- `expiredProcessingCount`：PROCESSING 且 `lockedUntil <= now`。
- `staleExpiredProcessingCount`：PROCESSING 且 `lockedUntil <= now - leaseSeconds`。
- `leaseLost15mCount`：最近 15 分钟完成的 `LEASE_LOST` HandlerLog 数量。

未过期 PROCESSING 是正常在途，不触发告警。单个刚过期租约由其他 Worker 恢复，只有超过一个完整 lease 周期仍未恢复才 BLOCKED。

### 7.4 MANUAL 与 Dispatcher 故障

所有 MANUAL 都阻止灰度完成。下列现有稳定错误码还会计入 `unresolvedDispatcherFaultCount`：

- `HANDLER_NOT_REGISTERED`
- `SUBSCRIPTION_FILTER_INVALID`
- `EVENT_ENVELOPE_INVALID`

内部 quarantine 继续只读且不可通过公共 retry 消耗 Step-Up。

## 8. 模式与判定规则

### 8.1 Preflight

要求：

- 部署环境的 `EVENT_WORKER_ENABLED=false`；
- 持久状态为 `DISABLED`；
- 数据库、migration、registry 和订阅配置有效；
- MANUAL 和未解决 Dispatcher 故障为 0；
- stale expired PROCESSING 为 0。

Preflight 允许存在尚未处理的正常积压，但发布步骤必须随后执行受控事件和一次性 drain，再次巡检时未分派与到期积压必须回到阈值内。

### 8.2 Canary

要求：

- 部署环境的 `EVENT_WORKER_ENABLED=true`；
- 持久状态在启动宽限期内从 STARTING 转为 RUNNING；
- 心跳和成功 tick 未过期；
- 所有 BLOCKED 条件均不存在。

启动宽限期等于心跳过期阈值。在宽限期内尚无首个成功 tick 返回 DEGRADED；超过宽限期返回 BLOCKED。

### 8.3 默认规则

| 条件 | 结果 | 告警码 |
|---|---|---|
| 模式与配置/持久状态不一致 | BLOCKED | `EVENT_OBS_MODE_MISMATCH` |
| 任意 MANUAL | BLOCKED | `EVENT_OBS_MANUAL_PRESENT` |
| 任意未解决 Dispatcher 故障 | BLOCKED | `EVENT_OBS_DISPATCHER_FAULT` |
| 数据库或 migration 不可用 | BLOCKED/专用退出类别 | `EVENT_OBS_DATABASE_UNAVAILABLE` |
| 同进程连续数据库失败达到 3 次 | BLOCKED | `EVENT_OBS_DATABASE_FAILURES` |
| Canary 心跳或成功 tick 过期 | BLOCKED | `EVENT_OBS_WORKER_TICK_STALE` |
| 最老未分派事件达到 120 秒 | BLOCKED | `EVENT_OBS_UNDISPATCHED_STALE` |
| 最老到期投递达到 300 秒 | BLOCKED | `EVENT_OBS_DUE_BACKLOG_STALE` |
| 15 分钟内 LEASE_LOST 为 1–2 | DEGRADED | `EVENT_OBS_LEASE_LOST` |
| 15 分钟内 LEASE_LOST 达到 3 | BLOCKED | `EVENT_OBS_LEASE_LOST_EXCESSIVE` |
| stale expired PROCESSING 大于 0 | BLOCKED | `EVENT_OBS_PROCESSING_LEASE_STALE` |

状态优先级为 `BLOCKED > DEGRADED > READY`。告警按固定优先级和告警码排序，数据库返回顺序不得影响输出。

所有秒数和计数阈值都采用包含边界：`value >= threshold` 即触发对应状态。LEASE_LOST 的 DEGRADED 区间为 `degradedThreshold <= value < blockedThreshold`。

## 9. 配置

新增配置全部使用十进制整数并执行上下界校验：

| 环境变量 | 默认值 | 范围 |
|---|---:|---:|
| `EVENT_OBSERVABILITY_HEARTBEAT_SECONDS` | 10 | 5–60 |
| `EVENT_OBSERVABILITY_UNDISPATCHED_BLOCK_SECONDS` | 120 | 30–3600 |
| `EVENT_OBSERVABILITY_DUE_BACKLOG_BLOCK_SECONDS` | 300 | 60–86400 |
| `EVENT_OBSERVABILITY_LEASE_LOST_DEGRADED_COUNT` | 1 | 1–99 |
| `EVENT_OBSERVABILITY_LEASE_LOST_BLOCKED_COUNT` | 3 | 2–100 |
| `EVENT_OBSERVABILITY_CANARY_WINDOW_MINUTES` | 15 | 5–120 |

额外关系约束：

- BLOCKED 的 LEASE_LOST 阈值必须大于 DEGRADED 阈值；
- 心跳过期阈值派生为 `max(60 秒, 3 × heartbeatSeconds)`，不增加第二个可冲突的配置；
- 生产非法配置拒绝启动；CLI 非法配置返回调用/配置失败，不回显原始值。

## 10. API 契约

现有 `/api/v1/event-operations/summary` 仅做加法扩展：

```text
observability: {
  status,
  mode,
  evaluatedAt,
  metrics: {
    undispatchedCount,
    oldestUndispatchedSeconds,
    dueBacklogCount,
    oldestDueBacklogSeconds,
    manualCount,
    processingCount,
    expiredProcessingCount,
    staleExpiredProcessingCount,
    leaseLost15mCount,
    lastSuccessfulTickAt,
    lastHeartbeatAt
  },
  alerts: [{ code, severity, value, threshold }]
}
```

`severity` 只允许 `DEGRADED | BLOCKED`。`value` 和 `threshold` 只允许有限数字、布尔值或 null。API 不返回运行状态表版本、主机/进程标识、workerId、lockedBy 或任何原始错误。

数据库查询失败时使用现有安全错误处理边界返回 503 和稳定 `EVENT_OBSERVABILITY_UNAVAILABLE`，不泄漏 Prisma 或 PostgreSQL 文本。

匿名 `/api/health` 保持现状：它只表明服务器和数据库是否可用。Worker 计划关闭时不会把整个 HTTP 服务标为失败。

## 11. Web 契约

事件运维页新增：

- READY/DEGRADED/BLOCKED 状态横幅；
- preflight/canary 模式；
- 未分派、到期积压、MANUAL、租约和 Worker 心跳指标卡；
- 按后端稳定告警码映射的中文解释和处置建议；
- 最近评估时间和显式刷新。

页面不得提供 Worker 开关、删除、跳过、payload 编辑、attempt 修改、批量 replay、订阅编辑或历史清理。未知告警码以通用安全文本显示，不直接渲染后端任意文本。

## 12. 巡检 CLI

命令：

```text
npm.cmd --prefix apps/server run events:check -- --mode=preflight
npm.cmd --prefix apps/server run events:check -- --mode=canary
```

参数只接受一个显式 mode；未知参数、重复参数或缺失 mode 均拒绝。CLI 输出单行安全摘要，字段固定为 mode、status、各安全计数、最大年龄、告警码列表和 UTC evaluatedAt。

退出码：

| 退出码 | 语义 |
|---:|---|
| 0 | READY |
| 3 | DEGRADED，需要延长观察 |
| 4 | BLOCKED，禁止继续灰度 |
| 5 | 数据库或 migration 不可用 |
| 2 | 参数或配置无效 |
| 70 | 其他安全失败 |

CLI 不输出 DATABASE_URL、凭据、payload、通知内容、异常原文、stack、内部主键列表或 Worker 标识。

## 13. 生产灰度流程

### 13.1 发布前

1. 验证 Node 22.14、npm 10.9.2、PostgreSQL 16 和同一审核 Server/Web 产物。
2. 生成并验证 PostgreSQL 备份或恢复点。
3. 所有实例显式设置 `EVENT_WORKER_ENABLED=false`。
4. 加法部署 migration，发布 Server/Web。
5. 运行 preflight；必须 READY。

### 13.2 关闭 Worker 的受控验证

1. 通过正式治理审核生成一条受控事件。
2. 运行 `events:drain`。
3. 验证唯一通知、不可变投递/attempt 证据和第二次 drain 全 0。
4. 再次运行 preflight；必须 READY。

### 13.3 开启 Canary

1. 将唯一实例改为 `EVENT_WORKER_ENABLED=true` 并滚动重启。
2. 在启动宽限期内确认状态从 STARTING 转为 RUNNING。
3. 观察默认 15 分钟 canary 窗口。
4. 窗口内至少完成一个真实治理通知闭环。
5. READY 才完成上线；DEGRADED 延长观察并调查；BLOCKED 立即回滚。

### 13.4 回滚

1. 显式设为 `EVENT_WORKER_ENABLED=false` 并重启。
2. 确认不再领取新任务且运行状态为 DISABLED。
3. 必要时回退应用，但不做事件表破坏性 schema 回滚。
4. 保留 EventLog、Delivery、HandlerLog、Notification 幂等键和审计证据。
5. 修复后从现有状态继续，不清空队列，不跳过顺序阻塞。

## 14. 故障处置

### 14.1 数据库中断

API 返回安全 503，CLI 返回 5。Worker 继续使用既有退避；恢复后首个成功 tick 更新心跳。不得通过清理队列或伪造状态恢复 READY。

### 14.2 Worker 崩溃或停止心跳

非优雅退出不会写 STOPPED。心跳超过派生阈值后 Canary 为 BLOCKED。重启后 STARTING/RUNNING 使用新的 processStartedAt 覆盖当前 slot，但不修改历史事件。

### 14.3 未知事件、handler 或损坏过滤器

继续沿用 SPEC-007 quarantine/MANUAL 规则。告警 BLOCKED；先修复兼容代码或受控配置，再按既有 Step-Up 边界处理允许重试的 MANUAL。内部 quarantine 不开放公共 retry。

### 14.4 租约异常

单次 LEASE_LOST 允许 DEGRADED 观察；重复租约丢失或长期过期 PROCESSING 阻止上线。不得缩短租约绕过证据，也不得修改 HandlerLog。

## 15. 测试策略

### 15.1 TDD 单元测试

- 每个阈值的下界、等于阈值和越界；
- 状态优先级与告警稳定排序；
- preflight/canary 模式冲突；
- STARTING 宽限期、RUNNING 心跳过期、STOPPED/DISABLED；
- 配置范围和关系约束；
- CLI 参数、摘要和所有退出码；
- 未知告警码的安全 Web 降级显示。

### 15.2 PostgreSQL 集成测试

- migration、表约束、单一 primary slot 和重复部署；
- 未分派、到期/未到期积压和最老年龄；
- PROCESSING、过期和 stale expired 租约；
- MANUAL、Dispatcher 故障和最近 15 分钟 LEASE_LOST；
- 生命周期状态写入、心跳节流、优雅停止和崩溃后的过期判断；
- API 和 CLI 对相同持久快照给出一致结论。

共享可重置测试数据库的测试必须串行。并发验证在单个测试内使用独立 PrismaClient。

### 15.3 负载、并发与短时持续测试

- 批量创建受控事件并由多个测试 Worker 并发领取；
- 连续产生和消费事件，观察积压收敛与心跳节流；
- 注入处理延迟、重启和租约过期；
- 验证无重复通知、无重复成功 HandlerLog、无丢失 EventLog；
- 测试完成后清理业务 fixture，不删除不可变事件证据的生产语义。

### 15.4 故障演练

- 数据库中断与恢复；
- 未知事件隔离；
- graceful shutdown 和强制进程退出后的租约恢复；
- Worker false 回滚；
- 一次性 drain 幂等；
- 本地 15 分钟 canary。

演练必须锁定受保护的本地测试数据库目标，使用现有精确 reset guard，并在 finally 中清理 fixture。不得记录凭据或原始敏感值。

### 15.5 API、Web 和安全

- `event.delivery.read` 权限和无权访问拒绝；
- API 加法兼容、503 安全错误和字段白名单；
- Web 状态、卡片、处置建议和刷新；
- API、CLI、日志、报告、构建产物与持久文档泄漏扫描；
- 不存在启停、删除、跳过、修改、批量 replay 或清理入口。

## 16. 验收与完成定义

1. Preflight 在 Worker 关闭、配置正确和无未解决故障时 READY。
2. 受控 drain 产生唯一业务结果，第二次 drain 为空。
3. Worker 开启后在宽限期内进入 RUNNING，canary 持续 READY。
4. 数据库故障使 API/CLI fail closed，恢复后自动重新进入 READY。
5. 未知事件产生唯一内部 MANUAL 隔离证据并保持 BLOCKED。
6. 重启、并发、租约恢复和回滚不丢事件、不重复通知、不改写历史。
7. Server/Web lint、typecheck、无 Git 全量测试、覆盖率、构建、安全门禁、文档泄漏扫描通过。
8. 测试结束后源测试数据库应用表为空，隔离恢复数据库不存在。
9. runbook、handoff、SDD report 和 closeout 记录脱敏证据、阈值、演练结果及剩余风险。
10. 独立代码审阅无未解决 Critical 或 Important 问题。

## 17. 工具链与项目约束

- 使用 Node.js 22.14.0、npm 10.9.2 和 PostgreSQL 16。
- 不执行任何 Git/GitHub 命令，包括只读命令。
- 全量 Server 测试使用显式 no-Git 文件列表，排除会实际调用 Git 的 `test/ci/distribution-config-contract.test.ts`。
- 不覆盖或清理用户已有工作区修改。
- 不在报告、命令回显或文档中持久化凭据、密钥、token、cookie、TOTP、恢复码、治理原因、审核评论或原始业务 payload。

## 18. 后续工作

事件历史归档、法定/业务保留期限、分区、冷存储、删除审批和恢复检索需要独立规格。该工作不得以“控制表大小”为由在 SPEC-008 中添加删除或改写入口。
