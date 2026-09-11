# Event Center 生产 Runner 交接设计

日期：2026-07-25

## 目标

在不重启 Codex、也不跨进程提取生产配置的前提下，让操作者从一个新 PowerShell 静默加载既有生产环境并启动一次 runner。runner 始终在该 PowerShell 的子进程中运行，因此后续项目命令能够继承同一环境。

runner 只记录安全状态、计数、告警码、UTC 和耗时，不记录任何生产配置值或业务敏感内容。

## 已确认的现有能力

- 项目已有 source 与 portable 的事件检查入口，支持 preflight 和 canary。
- 项目已有一次性 drain 入口。
- 项目没有现成的全实例 Worker 禁用、单实例 Worker 启用或生产回滚命令入口。
- 治理事件只有应用内入口，没有独立生产运维命令。
- 项目没有一个能够同时核验备份、隔离恢复点、Server/Web 同版和审批证据的完整生产入口。

因此 runner 不得新增远程 Worker toggle，不得伪造外部证据，也不得把“需要人工处理”误报为 READY。

## 组件

### Runner

文件位置：`.codex-safe/Invoke-EventCenterProductionRollout.ps1`。

职责：

1. 在连接前验证完整生产环境门禁。
2. 验证固定 Node 与 npm 工具链。
3. 验证外部证据收据的结构与时效，但不把未经外部系统确认的布尔自报当成证据。
4. 运行项目已有的 source 与 portable 检查及 drain。
5. 解析并重新输出允许字段，不透传原始输出。
6. 在治理事件、Worker 控制和回滚等缺少现有入口的步骤停在明确检查点。

### 安全状态文件

文件位置：`.codex-safe/production-runner-status.jsonl`。

每行只允许：

- phase
- status
- boundedCounts
- alertCodes
- utcStart
- utcEnd
- elapsedSeconds

写入使用追加和单写者约束。runner 不保存环境快照。

### 外部证据收据

文件位置：`.codex-safe/production-rollout-evidence.json`。

收据只保存以下结论及核验时间：

- 备份已验证
- 隔离恢复点已验证
- 所有实例 Worker 已禁用
- Server/Web 为同一审查版本
- 治理事件审批证据有效

runner 只验证字段完整、状态为已验证且时间处于允许窗口。收据必须来自操作者已核验的既有生产控制面；runner 不自行生成通过结论。

## 状态机

1. `ENV_GATE`：完整生产配置存在，运行环境精确为 production，Worker 精确为 false。失败即 `BLOCKED`，零连接退出。
2. `TOOLCHAIN_GATE`：固定版本同时匹配。失败即 `BLOCKED`。
3. `EVIDENCE_GATE`：五类外部证据均有效。缺失或过期即 `WAITING_EVIDENCE`，不得连接。
4. `PREFLIGHT_SOURCE`：只接受规范化安全摘要。
5. `PREFLIGHT_PORTABLE`：紧接 source 执行；两者必须对受控快照给出相同结论。任一 `BLOCKED` 即停止并标记 `ROLLBACK_REQUIRED`；`DEGRADED` 即 `EXTENDED_OBSERVATION_REQUIRED`。
6. `WAITING_GOVERNANCE_ACTION`：由现有应用受控生成治理事件。runner 不新增事件生成命令。
7. `DRAIN_FIRST`：执行一次性 drain，并校验安全退出状态。
8. `DRAIN_SECOND`：再次执行，claimed 必须为 0。
9. `PREFLIGHT_AFTER_DRAIN`：必须再次为 READY。
10. `WAITING_SINGLE_WORKER_ENABLE`：由既有部署控制面仅启用一个实例。runner 不实现 toggle。
11. `CANARY`：运行完整 15 分钟窗口，并要求至少一个真实治理通知闭环。
12. `READY`：只有 canary 最终 READY 才完成。

## 外部检查点

因为当前项目没有现成的 Worker 控制和生产回滚入口，以下动作不能由 runner 自动执行：

- 全实例 Worker 禁用证明
- 单实例 Worker 启用与滚动重启
- 治理事件的受控审核操作
- BLOCKED 后的应用回滚与 Worker 关闭

runner 在检查点写入安全状态后等待；Codex 可以继续读取状态，但必须由操作者通过既有控制面完成动作并提供安全确认。没有安全确认时保持等待或 BLOCKED。

## 失败处理

- 任何未知输出、解析失败、非允许退出状态或证据不完整均按 BLOCKED 处理。
- 不透传子命令原始标准输出或错误输出。
- DEGRADED 不自动重试推进，只记录延长观察要求。
- BLOCKED 不执行后续 drain、Worker 启用或 canary。
- runner 不删除、跳过或改写生产事件历史。

## 验证策略

- 使用伪环境验证零连接 fail-closed 门禁。
- 使用模拟子进程验证输出白名单、退出码映射和敏感内容拒绝。
- 验证 source 与 portable 结论不一致时停止。
- 验证第二次 drain 的 claimed 非零时停止。
- 使用注入时钟验证 15 分钟窗口约束，不以真实等待替代自动化测试。
- 验证每个外部检查点在缺少确认时不会推进。

## 成功标准

runner 可以从新 PowerShell 继承环境且不持久化配置值；所有自动阶段均使用现有项目入口；所有缺少现有生产入口的动作都保持显式人工检查点；最终安全记录只包含允许字段。
