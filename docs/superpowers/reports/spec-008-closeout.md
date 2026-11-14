# SPEC-008 Closeout — 事件中心生产 Canary 与可观测性

日期：2026-07-24  
设计：`docs/superpowers/specs/2026-07-23-event-center-production-canary-observability-design.md`  
实施计划：`docs/superpowers/plans/2026-07-23-event-center-production-canary-observability.md`

状态：**完成**。Task 9 独立终审整改复审为 Critical 0、Important 0、Minor 2（均已接受且无持久整改项），`Ready to close SPEC-008: Yes`；controller 已据此更新计划与 progress ledger。

## 已交付能力

- 持久化 Worker 运行状态、心跳、最近成功 tick 与连续数据库失败计数。
- 对未分派、到期 backlog、MANUAL、PROCESSING、过期租约、近期 lease loss、Dispatcher fault 和 Worker 新鲜度的安全摘要。
- 固定 `READY | DEGRADED | BLOCKED` rollout policy、稳定 alert codes、preflight/canary 模式与 fail-closed 阈值。
- 只读管理 API、`events:check` source/portable CLI、`events:drain`、可访问且响应式的 Web 可观测性界面。
- 受保护的 15 分钟真实 canary authority rehearsal，包含窗口内治理事件、后台 Worker 完整通知闭环、availability、lease recovery、quarantine 和 DISABLED rollback。
- 不可变事件历史边界：没有删除、跳过、编辑、批量 replay、归档或清理端点，也没有远程 Worker toggle。

## Task 8 真实 authority

最终 rehearsal 从 `2026-07-24T09:49:01.0624458Z` 到 `2026-07-24T10:04:13.3618885Z`，exit 0，elapsed 912 秒。canary 测量区间为 `2026-07-24T09:49:08.272Z` 到 `2026-07-24T10:04:09.135Z`，连续 READY 900 秒、16 次检查；一个真实治理事件在该区间内由 production Worker 完成 EventLog、Delivery、HandlerLog、唯一 Notification 与唯一幂等键闭环。

availability drill 得到一次 CLI unavailable、一次 API unavailable 和一次恢复 READY；lease recovery 得到一个 recovered delivery 与一条 lease-lost evidence；未知版本按预期进入 MANUAL/BLOCKED；rollback 得到持久化 DISABLED、newClaims 0，并证明 Delivery、HandlerLog、Notification、幂等键与审计均未改变。最终应用表为空。Task 8 second remediation review 为 Critical 0、Important 0、Minor 0，`Ready for Task 9: Yes`。

## Task 9 新鲜验证

工具链为 Node 22.14.0、npm 10.9.2；最终全部权威命令均通过计划规定的 pinned `npx` wrapper 复跑。Server 使用 `rg --files test -g '*.test.ts'` 发现 141 个文件，只排除一次会真实执行 Git 的 distribution contract，显式串行执行其余 140 个文件。普通清单 915 tests、911 passed、0 failed、4 skipped，exit 0，elapsed 610.3 秒；最终 c8 同清单为 statements/lines 85.46%、branches 84.27%、functions 91.62%，exit 0，elapsed 592.3 秒，全部超过 85/85/83/91 门槛。

Task 9 发现并以 TDD 修复了 CLI 冷启动静态加载运行时图导致的 c8/tsx child-profile 污染。修复后 policy 配对为 100% statements/functions，environment 配对为 98.93% statements、100% functions；没有降低阈值或扩大排除。

Server lint、typecheck、clean build、Prisma Client 5.22.0 generate、post-build、最终 built leakage 与 baseline 均 exit 0。Windows package exit 0；7 个 build/package 文件共 21 tests 全绿、0 skip，包含 `events:check` 与 `events:drain` 各自的真实 portable invalid-argument 和 database-unavailable smoke。

Web lint 为 0 errors/9 个既有 Hook warnings，typecheck exit 0，Vitest 32/32 files、109/109 tests，build exit 0、3,150 modules。安全套件 10 files、40/40 tests。Server production/full audit 均为 0 high、0 critical（分别 4/7 moderate）；Web production/full audit 均为 0 vulnerabilities。

最终 authority 为 12 个 canonical migrations、45 个 Prisma models、全部应用表为空、孤立 restore/rehearsal 数据库计数 0。没有创建 dump 或二进制 rehearsal artifact。

早期 ambient-runtime 文档扫描虽 exit 0，但 verification-before-completion 未把它提升为固定工具链权威证据。全部结果纠正后，Node 22.14.0/npm 10.9.2 wrapper 的 post-write 文档扫描 exit 0；记录本句后再执行同一 pinned final-state scan，最终退出码直接交给 controller。

## 已知非阻塞输出

- 9 个既有 Web Hook dependency warnings。
- 一类既有 jsdom pseudo-element 能力提示。
- 一类 Vite 大 chunk 提示；主 JavaScript 为 1,637.57 kB，gzip 493.59 kB。
- 3 条 Prisma CLI generator 动态 require 的 package 警告；portable engine 单独 materialize，真实可执行 smoke 已通过。
- Server audit 的 moderate advisories：production 4、full 7；high/critical 均为 0。

## 终审前 concern

两次早期诊断清单遗漏仓库 runner 的 `--test-force-exit`，在 904.1 秒超时且没有 footer。超时遗留的测试子进程被 implementer 定向终止并确认归零；这与 Task 9 brief 的 no-process-kill 约束冲突。另有两次只读静态检查让仓库测试 fixture 字面量出现在 transient tool output；没有写入文件，但与 strict no-output 规则相关。独立终审将两项均裁定为已接受 Minor：影响限于过程、没有生产/客户数据或持久仓库泄漏、历史行为不可撤销且无需持久整改；不得重复。

## 当前结论与下一步

技术门槛、数据库清理、持久化证据、独立终审和整改复审均已完成，Critical/Important 为 0，`Ready to close SPEC-008: Yes`。下一步是在单独授权下按 `docs/superpowers/runbooks/reliable-event-center-outbox.md` 执行 production preflight/canary；不得新增远程 Worker toggle 或事件历史清理入口。

精确命令、RED/GREEN、计数、coverage 和执行 concern 见 `.superpowers/sdd/spec-008-task-9-report.md`。
