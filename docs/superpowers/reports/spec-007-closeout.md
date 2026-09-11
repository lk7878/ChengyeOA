# SPEC-007 Closeout — 可靠事件中心与治理通知

日期：2026-07-22  
设计：`docs/superpowers/specs/2026-07-22-reliable-event-center-outbox-design.md`  
实施计划：`docs/superpowers/plans/2026-07-22-reliable-event-center-outbox.md`

状态：**complete**。最终独立 re-review：**Ready to close: Yes**。复审后的人工备份清理已完成，当前开放问题为 0 Critical、0 Important、0 Minor。

## 已交付能力

- PostgreSQL Outbox 事件契约、四张事件表、通知幂等字段、权限与代码所有的 pilot 订阅。
- 治理审核状态、review、audit 和 `admin.operation.reviewed.v1` 在同一事务提交。
- 多实例安全 Dispatcher、租约 Worker、不可变 attempt evidence、固定重试计划、对象内有序阻塞与 MANUAL 恢复。
- `ADMIN_OPERATION_REVIEWED_NOTIFICATION` 幂等通知处理器及共享 production service graph。
- Egg 生命周期、graceful shutdown、一次性 `events:drain`、健康摘要、管理 API、目标绑定 Step-Up retry。
- Web 事件运维页、菜单/路由/权限、筛选、详情、订阅只读视图和无敏感值 Step-Up 交互。
- 构建产物共享敏感 fixture 扫描、受保护 event-center rehearsal、备份恢复演练和运维手册。

## 验收与演练证据

Acceptance 首轮 RED 确认了两个缺口：受保护 rehearsal 模块不存在；共享 leakage scanner 尚不识别 SPEC-007 fixture。实现后聚焦套件通过 5/5：

- 治理 review → 原子 EventLog → production Dispatcher/Worker → 唯一 requester Notification；重复 tick 和新 PrismaClient 重启不重复。
- retryable attempts 1–4 分别进入 15 秒、5 分钟、1 小时、6 小时 RETRY_WAIT；第 5 次进入 MANUAL。
- 目标绑定 `{ deliveryId, expectedVersion }` 的 `EVENT_DELIVERY_RETRY` Step-Up 被事务消费，随后恢复 SUCCEEDED，通知仍唯一。
- 事件、投递、attempt、审计和通知的序列化安全证据不含已知 fixture secrets。
- SPEC-006 原有扫描签名全部保留，新增 SPEC-007 治理原因、review comment 和业务 payload fixture。

真实 event-center rehearsal 使用 production service factory 与 `drainMain`：首次 `dispatched=1, claimed=1, succeeded=1`；第二次所有计数为 0；最终 `events=1, deliveries=1, notifications=1`。`finally` 后所有应用表为空。

## PostgreSQL 备份恢复证据

目标在每个 destructive 边界前均解析并精确核验：source 为本地 `chengye_oa_test`，restore 仅为本地 `chengye_oa_restore_test`；恢复库与源库不同。受控快照包含一个未分派 EventLog、一个 PENDING Delivery，以及一个 SUCCEEDED Delivery/HandlerLog/Notification。

- 历史 10 迁移演练（已被下述 11 迁移权威演练取代）：`2026-07-22T09:58:36.1811843+00:00` 至 `2026-07-22T09:58:38.9363785+00:00`，elapsed `2.755` 秒。
- UTC start：`2026-07-22T11:59:12.123Z`
- UTC end：约 `2026-07-22T11:59:25.9Z`
- elapsed wall time：约 `13.8` 秒
- 保留 dump：`spec-007-event-center-20260722T115912123Z.dump`（`148016` bytes；文件时间 `2026-07-22T11:59:14.000Z`）
- dump SHA-256：`05d99194dba95d8e937651d1c284edea717f67c6994646159a1d1427e8055474`

恢复时自动 Worker 保持关闭。显式 drain 得到 `dispatched=1, claimed=2, succeeded=2`，第二次 drain 全 0。最终 3 个事件、3 个投递、3 条各自唯一通知，原成功通知重复数为 0。恢复库已删除并由 `pg_database` count=0 证明；源 fixture 已清理，源测试库所有应用表为空。

11 迁移复跑使用脱敏但精确的编排顺序：受保护 helper prepare → 容器内 custom-format/no-owner/no-privileges dump → 仅创建隔离 restore DB → `pg_restore` → helper verify 两次 drain → `finally` 清理源 fixture、删除 restore DB、删除容器临时 dump → 独立核验 restore count=0 与源库空表。一次缺少运行时安全变量的首轮尝试安全失败且同样完成 finally；它不作为证据。复审后已人工删除该失败轮非权威 host dump，同时删除被 11 迁移权威演练取代的历史 10 迁移 dump。备份目录当前只保留 SPEC-006 与 SPEC-007 两个权威 dump。

报告没有记录数据库凭据、MFA 密钥、密码、Token、Cookie、TOTP、恢复码、治理原因、评论或原始 payload。

## 安全与不可变性结论

- API/Web/CLI/rehearsal 只显示安全摘要、计数、稳定错误码和随机引用。
- EventLog、EventDelivery、EventHandlerLog、人工重试审计没有删除或改写入口。
- MANUAL 继续阻塞相同 handler/object ordering key，直至目标绑定 Step-Up 重试成功。
- 未知 handler/version、损坏 filter 和数据库故障均 fail closed；不会静默跳过事件。
- 每个锁定的 EventLog 在订阅匹配前校验完整 registry/envelope；未知或损坏事件保持未分发，并形成唯一、持久化、内部只读的 MANUAL 隔离证据。
- 对外健康摘要合并持久化 Dispatcher 故障与 Worker 数据库状态；数据库成功 tick 不会掩盖未解决故障，修复配置并正式重试后才恢复 healthy。
- 主演练严格锁定 `localhost:55432/chengye_oa_test`，并要求两个数据库 URL 字面完全一致；省略/错误端口、别名、远程主机及 userinfo/query 差异均拒绝。
- SDD report、closeout 与 handoff 通过持久化文档泄漏扫描；URL userinfo、JWT/APP/MFA 赋值和已知固定测试材料指纹均不得出现，占位符和变量名不误报。
- 早期一次广泛测试内部调用过一次只读 `git ls-files --stage`；没有 Git 写入，也没有造成工作区变化。发现后已排除该测试，最终验证使用显式 no-Git 文件清单。整个周期未执行 Git/GitHub 写操作。

## 最终固定工具链验证

权威验证使用 Node `22.14.0` 与 npm `10.9.2`。Server 全量测试从 129 个测试文件中仅排除内部真实执行 Git 的 `test/ci/distribution-config-contract.test.ts`，以 128 文件无 Git等价清单串行运行：823 tests，821 passed，0 failed，2 skipped；statements/lines 85.04%（17491/20566），branches 83.96%（4949/5894），functions 91.85%（2041/2222）。

Server ESLint、`tsc --noEmit`、clean/emit、Prisma Client 5.22.0 generate、post-build、构建产物泄漏扫描和持久化文档泄漏扫描全部 exit 0。当前迁移 SQL 数为 11，Prisma model 数为 44。Web ESLint 为 0 errors/9 个既有 Hook warnings，typecheck exit 0，Vitest 32/32 files、102/102 tests，Vite build exit 0。

依赖策略有效，安全测试 38/38。Server production audit 为 0 high/critical、4 moderate；full audit 为 0 high/critical、7 moderate。新发现且不在既有精确例外中的 development-only `serialize-javascript` high 已通过兼容 override 到 `7.0.7` 消除，没有扩大例外或执行强制 major 修复。Web full/production audit 均为 0 vulnerabilities。最终测试库所有应用表为空，隔离恢复库数量为 0。

非阻断输出仅包括 9 个既有 Web Hook dependency warnings、jsdom pseudo-element 能力提示和 Vite 主 chunk 大于 500 kB 的提示。完整命令、作废的承载诊断与精确计数记录于 `.superpowers/sdd/task-10-report.md`。

## 终审状态

Task 10 实现、自验证与独立只读终审均已完成。最终 re-review 结论为 `Ready to close: Yes`；原 5 个 Important 已全部闭环，复审后唯一人工清理 Minor 也已完成，当前无开放 Critical、Important 或 Minor。
