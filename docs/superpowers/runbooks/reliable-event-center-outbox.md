# 可靠事件中心与 Outbox 运维手册

本文适用于 SPEC-007 的 PostgreSQL Outbox、应用内 Event Worker、一次性 drain、事件运维页以及 `admin.operation.reviewed.v1` 通知闭环。它不授权删除、跳过、改写或重放历史事件，也不授权直接编辑 payload、attempt、delivery 状态或订阅过滤器。

## 安全边界

- 使用 Node.js `22.14.0`、npm `10.9.2`、PostgreSQL 16 和同一份经审查的 Server/Web 发布物。
- 数据库连接、JWT/应用密钥、MFA 密钥、密码、Token、Cookie、CSRF、TOTP、恢复码、治理原因、审核评论及原始业务 payload 不得进入命令回显、日志、截图、工单或报告。
- `EventLog`、`EventDelivery`、`EventHandlerLog` 和人工重试审计是不可变证据。禁止删除或改写事件历史；纠错只能通过修复兼容代码、人工重试或新的补偿业务操作完成。
- 生产环境必须显式设置 `EVENT_WORKER_ENABLED=true|false`；缺失、拼写错误或越界配置必须拒绝启动。
- 备份/恢复、测试重置和演练只允许经过解析并精确核验的目标。不得使用通配符、宽泛目录或根据未核验变量执行 drop/truncate。

## 配置

| 环境变量 | 约束 |
|---|---|
| `EVENT_WORKER_ENABLED` | production 必填 `true` 或 `false`；development 默认 true；unittest 默认 false |
| `EVENT_WORKER_POLL_MS` | 250–60000，默认 1000 |
| `EVENT_WORKER_BATCH_SIZE` | 1–200，默认 25 |
| `EVENT_WORKER_LEASE_SECONDS` | 30–600，默认 60 |
| `EVENT_WORKER_SHUTDOWN_SECONDS` | 1–120，默认 30，且必须小于 lease |

Worker 在 `didReady` 启动一个共享实例，在 `beforeClose` 停止新领取并最多等待配置的 shutdown 时间。计时器不阻止进程退出；未完成投递保留租约，重启或另一实例在租约过期后恢复。

## 健康检查与安全证据

具有 `event.delivery.read` 的管理员通过 `/security/event-operations` 或 `/api/v1/event-operations/summary` 查看：

- PENDING、RETRY_WAIT、PROCESSING、MANUAL、SUCCEEDED 数量；
- 最近 24 小时成功率和最长积压秒数；
- Worker 是否启用、最近成功 tick、最近数据库失败、连续数据库失败数和安全错误引用。

详情只允许显示注册表批准的 payload 标量摘要、稳定错误码、随机错误引用和 attempt 时间线。不得显示完整 payload、workerId、lockedBy、异常 message/stack、数据库信息、治理原因或评论。排障记录使用 event/delivery ID、稳定错误码、错误引用和 UTC 时间；敏感上下文只在受控系统内关联。

## 一次性 drain

在已加载受控环境、确认 migration 状态且自动 Worker 关闭后，从 `LayerManage/law-firm-system` 运行：

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix apps/server run events:drain
```

drain 使用与生产应用相同的 Dispatcher、Registry、DeliveryStore 和 Worker，连续两轮无可处理项后退出。输出仅包含 dispatched、claimed、succeeded、retryScheduled、manual、leaseLost 和安全状态。

- exit 0：当前到期工作已处理且没有新 MANUAL。
- exit 4：产生 MANUAL，必须进入事件运维页处理。
- exit 5：数据库或 migration 状态不可用。
- exit 2/70：配置无效或其他安全失败。

不得把非零退出误判为成功，不得通过改表、删行或跳过投递让 drain 变绿。

## 重试、顺序阻塞与 MANUAL 恢复

Retryable failure 的固定计划如下：

| 失败 attempt | 结果 |
|---:|---|
| 1 | 15 秒后 RETRY_WAIT |
| 2 | 5 分钟后 RETRY_WAIT |
| 3 | 1 小时后 RETRY_WAIT |
| 4 | 6 小时后 RETRY_WAIT |
| 5 及以后 | MANUAL |

Permanent failure 立即进入 MANUAL。未知异常映射为稳定 `EVENT_HANDLER_UNKNOWN` 和随机引用，不持久化原始异常。

同一 `handlerCode + orderingKey` 必须按源 EventLog 的 `createdAt,id` 串行。更早的未完成事件（包括 MANUAL 和尚未分派的更早 EventLog）持续阻塞后续投递；只有 SUCCEEDED 才解除阻塞。不得为提升吞吐绕过顺序。

人工恢复步骤：

1. 用详情页确认 delivery 为 MANUAL、当前 version、错误码/引用及被阻塞对象。
2. 修复数据库、处理器、版本或来源数据的真实原因；不要改写事件或 attempt。
3. 由具备 `event.delivery.retry` 权限的有效超级管理员执行；人工重试不再要求验证器二次验证。
4. 请求必须携带当前 `expectedVersion`，并满足 MANUAL 状态、租约及隔离记录限制。
5. 提交一次人工重试。事务将 MANUAL 改为 PENDING、增加 `manualRetryCount/version` 并写 `EVENT_DELIVERY_MANUAL_RETRY` 审计；审计失败仍整体回滚，不消费 Step-Up 凭据。
6. 若 version、actor、target、token、租约或审计冲突，停止并刷新详情；不得复用旧授权。
7. 人工重试后若再次失败，立即回到 MANUAL；成功后确认后续有序投递解除阻塞。

## 常见故障

### 未知 handler 或事件版本

Dispatcher/Worker 不得静默丢弃。未知 handler、注册事件类型/版本不匹配或损坏订阅过滤器形成 MANUAL 和安全错误引用；drain 返回非零。确认发布物与订阅目录一致后，再使用目标绑定的人工重试。禁止动态加载代码、脚本或任意 SQL。

### 数据库不可用

Worker 将健康状态标为 degraded，数据库连续失败退避为 1、2、5、10、30 秒上限；HTTP 主进程不因一次 Worker 失败退出。恢复数据库后自动继续。先验证 PostgreSQL、连接池和 migrations，再观察租约恢复、积压和 MANUAL；不得清空队列。

### 租约丢失或进程退出

只有当前 delivery ID/version/workerId 且租约未过期的持有者能提交业务写、SUCCEEDED 和日志。过期 PROCESSING 被新 Worker 恢复时先记录唯一 LEASE_LOST，再开启下一 attempt。业务幂等键确保重复投递不产生重复通知。

## 发布

1. 生成并验证 PostgreSQL 备份与隔离恢复点。
2. 所有实例显式设置 `EVENT_WORKER_ENABLED=false`。
3. 应用加法 migration；发布同一审查版本的 Server/Web。
4. 使用源命令运行 preflight；只有 `READY` 才可继续：

   ```powershell
   npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd --prefix LayerManage/law-firm-system/apps/server run events:check -- --mode=preflight
   ```

   便携产物使用 `law-firm-system.exe events:check --mode=preflight`，两者必须对同一持久快照给出同一结论。
5. 以受控治理审核生成一个事件，运行 `events:drain`，验证唯一通知与不可变 HandlerLog；第二次 drain 的 claimed 必须为 0。
6. 再次运行 preflight；只有 `READY` 才可将唯一实例的 Worker 开关改为 true 并滚动重启。
7. 使用源命令 `events:check -- --mode=canary` 或便携命令 `law-firm-system.exe events:check --mode=canary` 观察完整 canary 窗口。默认窗口为 15 分钟，窗口内至少完成一个真实治理通知闭环。
8. `READY` 才完成上线；`DEGRADED` 必须延长观察并调查告警码；`BLOCKED` 必须立即按下节回滚。不得通过删行、改状态或缩短租约让检查变绿。
9. 验证运维页权限、无需验证码的人工重试，以及版本冲突、隔离记录和审计保护。

## 回滚

先显式关闭 Worker，再回滚应用。事件表不得做破坏性 schema 回滚；保留 EventLog、Delivery、HandlerLog、Notification 幂等键与审计。修复后的同版本兼容 Worker 从现有状态继续。若 handler 有缺陷，只能通过受控数据库变更暂停对应订阅并保留审批证据；本期没有订阅启停 API。

回滚后必须确认运行状态为 `DISABLED`、不再产生新 claim，并重新运行 preflight。回滚不删除、跳过或改写尚未处理及已处理事件；应用修复后从现有状态继续。

## 本地生产灰度演练

演练命令只允许受保护的本地测试目标。运行前必须同时满足精确测试库 reset guard、专用事件可观测性 rehearsal guard、`EVENT_WORKER_ENABLED=false`、`DATABASE_URL` 与 `DATABASE_URL_TEST` 字面相等，以及 localhost、显式 55432 端口、`chengye_oa_test` 库名和唯一允许的 schema 查询参数。任何别名、远程主机、缺失端口、不同 userinfo/query 或不同库名都必须在连接前拒绝。

从 `LayerManage/law-firm-system/apps/server` 运行：

```powershell
npx.cmd -y -p node@22.14.0 -p npm@10.9.2 npm.cmd run rehearse:event-observability
```

真实 authority 演练使用默认 15 分钟窗口。自动化测试只能注入短窗口与时钟，不得用真实 sleep 代替。演练依次验证 preflight、一次性 drain、canary、一次分类数据库不可用与恢复、租约恢复、未知版本隔离和 `DISABLED` 回滚；故障注入不得停止数据库、修改防火墙或终止进程。输出仅记录 phase、状态、安全计数、告警码、UTC 起止时间和 elapsed seconds，finally 清理受控 fixture。

## 备份与隔离恢复

遵循 `postgresql-backup-restore.md`，并增加以下事件中心检查：

1. 解析数据库 URL，精确核验源和隔离恢复库名、localhost 与端口；drop/create 前再次核验字面目标。
2. 备份必须包含至少一个未分派 EventLog、一个未完成 Delivery，以及一个 SUCCEEDED Delivery/HandlerLog/Notification。
3. 记录 UTC start/end、elapsed seconds 和 dump SHA-256；报告不得记录凭据、MFA 密钥或原始敏感值。
4. 恢复环境必须保持 `EVENT_WORKER_ENABLED=false`，先验证 migration、订阅、事件、投递、日志和通知幂等键。
5. 显式运行 drain；确认既有成功通知仍为一条，未完成/未分派事件各产生唯一业务结果；再次 drain 必须为空。
6. 删除精确隔离恢复库，清理源 fixture，并断言源测试库所有应用表为空。

本地演练还要求 `ALLOW_TEST_DB_RESET=true` 和显式恢复演练 guard。任何守卫、目标或 migration 检查失败都应停止，不得自动“修复”数据库。

## 事件历史保留原则

不提供 EventLog、Delivery、HandlerLog 的删除 API，不提供 payload/attempt 修改、跳过、批量 replay 或历史订阅回放。即使业务 fixture 被清理，正式发布环境中的脱敏事件历史和审计仍需按保留策略保存；未来归档或保留期必须另行设计并审批。
