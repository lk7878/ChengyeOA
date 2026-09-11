# SPEC-014 健壮性补强 — 收尾报告

日期：2026-08-01 ｜ 状态：**本地闭环**（Task 1-3 双渠道 Approved + Task 4 验收闸门全绿）
需求来源：SPEC-013 终审 F1 + Task 5 ⚠️②（callbackKey 跨实例 P2002）、SPEC-012 终审 F1（createPayment 与 terminate 竞速）、SPEC-013 Task 7 ⚠️③ + Task 8 M1（审批动作静默 catch UX）
设计：docs/superpowers/specs/2026-08-01-robustness-reinforcement-design.md ｜ 实施台账：.superpowers/sdd/2026-08-01-robustness-reinforcement/progress.md

## 1. 交付范围

三个已验证防御性缺口闭合（零结构变更）：

- **callbackKey 跨实例 P2002 防御（D1/D2）**：`processTask` 幂等查找限定实例域——同实例命中重放首结果；异实例占用 → `CALLBACK_KEY_CONFLICT` 409（消息钉死不泄露异实例 id）；并发同 key P2002 事务外 catch → 重读归属（同实例重放 / 异实例 409），**杜绝 500**。修复原实现会静默重放异实例视图的缺陷。
- **createPayment FOR UPDATE 竞速补强（D3）**：`createWithPaymentNoRetry` INSERT 事务内首把锁 = Contract 行 FOR UPDATE（仿 confirmPayment）+ 持锁重读合同 + 重验 `status ∈ SIGNED/EFFECTIVE`（否则 `CONTRACT_STATE_TRANSITION_INVALID` 409，整事务回滚零行零事件零审计）——关闭与 terminate 竞速（事务外预读通过后 terminate 先胜 → 锁后重验 TERMINATED → 409，杜绝 PENDING 固化到已终止合同）。**双闸形态**：事务外预读（快路径短路）+ 事务内 FOR UPDATE 重验（竞速兜底）。
- **审批动作静默 catch UX（D4）**：approval-store 三动作（apply/process/withdraw）catch 补 `message.error`（读 `response.data.message` 业务码，兜底「操作失败」）+ 返回 `false`（契约零破坏——唯一调用方仅真值判断）；RefundListPage approve `ok === false` 分支（409 陈旧 expectedVersion / 403 STEP_UP）+ 非 `STEP_UP_CANCELLED` 异常兜底 → 内联提示 + 动作 Modal 保持打开。
- **运维文档（Task 4）**：runbook §2.5 收款纪律补 createPayment 持锁重验 + §7 复用码补 `CONTRACT_STATE_TRANSITION_INVALID` + §9.3/§9.4/§9.8 审批幂等跨实例 409 语义。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | callbackKey 跨实例 P2002 防御（approval-instance-service 幂等语义收窄 + 并发兜底 + 本地镜像 isUniqueConflictOn） | approval-instance-service **29/29**（27+2）+ test/approval **63/63** + tsc/eslint 0 |
| 2 | createPayment FOR UPDATE 竞速补强（createWithPaymentNoRetry 首把锁 + 持锁重验） | terminate-plan-linkage **11/11**（10+1）+ receivable-service **38/38** 零回归 + receivable-void **10/10** 安全回归 + tsc/eslint 0 |
| 3 | 审批动作静默 catch UX（approval-store 三动作 + RefundListPage approve） | 隔离 4 文件 **27/27**（approval-store 5 + RefundListPage 10 + RefundListPage.step-up 3 + ApprovalCenterPage 9）；typecheck/lint/build 全绿 |
| 4 | 闸门 + runbook/closeout 更新（本报告） | 见 §3.2 |

### 3.2 最终全量（Task 4 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端本 SPEC 直接改动面（串行） | **78/78**（approval-instance-service 29 + terminate-plan-linkage 11 + receivable-service 38，与逐文件 grep 计数逐字对上；另附 receivable-void 10/10 安全回归） |
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令） | **1749 tests / 1745 pass / 0 fail / 4 skipped**（skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归；对账见 §3.3） |
| 迁移重演 + 空库断言 + 重跑幂等 | db:reset:test（**23 迁移**重放——零结构变更，SPEC-014 零迁移）→ db:assert-empty PASS → `prisma migrate deploy` 二次零迁移（幂等） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（23 迁移/60 model）/ PASS / exit 0 |
| security:test | 34/34 零新增（本 SPEC 零新增例外） |
| 前端四闸门 | 全量 **45 files / 191 tests** PASS 零 flake（基线 flake 隔离复跑照录）；tsc 0、lint 0 err（4 warn 预存）、build PASS |

### 3.3 全量合计（Task 4 实测，清净窗）

**实测：1749 tests / 1745 pass / 0 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件；4 skipped 为 opt-in pkg smoke 件，非回归）。

SPEC-013 基线 **1746 tests**。SPEC-014 净增 **3**：approval-instance-service +2（顺序异实例 409 / 并发同 key 异实例 409 非 500）、terminate-plan-linkage +1（createPayment 竞速 terminate 先胜 → 409 零行）——与实测 **1746 + 3 = 1749 精确对账**。

> **对账**：1746 + 3 = 1749 预期，与实测**精确一致**（逐文件 grep 计数：approval-instance-service 29 = 27+2、terminate-plan-linkage 11 = 10+1）。**0 真 fail 为权威结论**，计数链终态以实测 1749 为准。

> **Task 4 顺手治理**：初跑全量 1749/1744/1 fail/4 skipped——唯一 fail 为 docs-leakage 扫描命中 **task-2-report.md:67**（Task 2 报告 env 块含完整测试连接串凭据）。按 SPEC-012/013 先例占位符口径脱敏（URL 去口令 `postgresql://chengye_test@...` + `JWT_SECRET="<redacted>"` 等），复跑 persisted-documentation-leakage.test **3/3 PASS** + `check:docs-leakage` exit 0，全量转绿 **1749/1745/0/4**。

## 4. 迁移与模型

- **迁移总数 23 维持**（SPEC-014 零新增迁移）；**model 60、权限 121、事件 15、路由不变**——与设计 §7「零结构变更」逐字对齐。无 schema/migration/permission/event/route 触碰。
- **migrate diff 基线/终态逐字节相同**（零新 diff；预存漂移 4 项为既有，非本 SPEC 引入，漂移治理独立立项 §9）。
- 基线契约同步点无变化（60/23 维持）。

## 5. 关键裁决记录（D1-D5，设计 §2 决策 + 实施期裁决）

| # | 决策 | 裁决 |
|---|---|---|
| D1 | callbackKey 顺序幂等查找限定实例域 | 两段 `findFirst({callbackKey, instanceId})`——同实例命中重放首结果；异实例占用 → `CALLBACK_KEY_CONFLICT` 409，消息钉死 `'idempotency key already used for another approval'` 不泄露异实例 id |
| D2 | callbackKey 并发 P2002 | create 冲突事务外 catch（PG P2002 中止当前事务）→ 新查询重读归属：同实例重放 / 异实例 409。杜绝 500 |
| D3 | createPayment 竞速 | INSERT 事务内首把锁 = Contract 行 FOR UPDATE（仿 confirmPayment）+ 持锁重读重验 `status ∈ SIGNED/EFFECTIVE` → 否 `CONTRACT_STATE_TRANSITION_INVALID` 409（复用门禁码）；锁序 Contract→Payment 无死锁 |
| D4 | UX 反馈 | approval-store 三动作 catch `message.error`（读 response.data.message 业务码）+ 返回 false 保持契约；RefundListPage approve catch 同加（含 409/403 路径）——Modal 保持打开 |
| D5 | 零结构变更 | 无新模型/权限/事件/路由/迁移 |

**实施期裁决（评审追认 + 过程偏离）**：

1. **前置 task 探查（Task 1）**：processTask 新增 1 次事务外读解析 `targetInstanceId`（P2002 兜底判定异实例归属所必需）；404 语义与事务内探查一致，零行为回归。协调者裁决 `|| !idempotencyKey` 守卫优于 brief 伪代码（normalizeOptionalText 缺失返 null 防 findUnique null 型误入）。**列 minor：可后续 `if (idempotencyKey)` 门控**。
2. **门禁消息双位同串（Task 2）**：createPayment 事务外预读（receivable-service :350）与事务内重验（:720）共用 `cannot register payment for contract in status ${status}` 消息形态——未抽常量为保持与既有门禁逐字同串，留常量收敛（并入 Task 1 ⚠️③）。
3. **返回类型统一 boolean（Task 3）**：applyApproval/processApproval 由 `ApprovalInstanceView | null` 统一为 `boolean`——全仓库唯一调用方 ApprovalCenterPage 仅真值判断（页面从未消费返回实例），零调用方破坏。
4. **actionErrorMessage 助手（Task 3）**：TS unknown catch 需显式 cast（`error?.response` 不通过 typecheck）——抽出助手读 `response.data.message` 兜底「操作失败」，与 brief 表达式语义一致。
5. **双闸形态措辞修正（Task 2 评审）**：评审包「快路径零锁开销」不精确——成功登记均 +1 Contract 锁 +1 重读（「零额外」仅事务外短路分支）；已授权正确性优先，照录。
6. **报告子分项误标（Task 1 评审）**：approval-policy 实 21 / permission-catalog-approval 实 13（非报告 22/12）——总数 63 正确、两文件本任务未触碰，纯标签误标照录。
7. **catch `!winner` 裸抛（Task 1 评审）**：基本不可达（可接受防御）照录。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` exit 1，现存 **2 个 production_high**——与 SPEC-009/010/011/012/013 收官逐项一致、**本 SPEC 零新增例外**：
  - server：brace-expansion GHSA-mh99-v99m-4gvg（egg 工具链专项）。
  - web：react-router GHSA-qwww-vcr4-c8h2（SEC-2026-002 登记，**2026-08-29 到期**，v8 迁移专项）。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**Task 4 占位符口径**：task 报告/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令。

## 7. 已知非阻断项（评审累积逐条照录）

1. **Task 1 前置探查无条件读**（minor）：processTask 前置 task 探查在无 idempotencyKey 时也执行——授权内、权衡记录，可后续 `if (idempotencyKey)` 门控（§9）。
2. **Task 1 409 消息字面量两处重复**（minor）：approval-instance-service :229/:357 共用 `'idempotency key already used for another approval'`——抽模块级常量（§9）。
3. **Task 1 报告子分项误标照录**：approval-policy 21 / permission-catalog-approval 13（纯标签误标，总数 63 正确）。
4. **Task 2 门禁消息双位同串**（minor）：receivable-service :350/:720 共用消息形态——并入常量收敛（§9）。
5. **Task 2 事件计数断言可窄化 eventType**（minor）：断言偏宽但 beforeEach 重置安全，可窄化（§9）。
6. **Task 2 同合同 createPayment 并发串行化**（信息性）：合同级 FOR UPDATE 使同合同批量导入并发登记串行化——吞吐代价正确性优先预期。
7. **Task 3 reject 分支对齐**（follow-up 小改动）：RefundListPage reject 分支 `rejectRefund` 返 false 时仍静默关 Modal——协调者裁决仅 approve；同款 `message.error` + return 可作后续对齐（§9）。
8. **Task 3 store 动作字面重复 toast**（minor）：request 拦截器全局提示 + 内联同文本双弹——可改通用文案规避字面重复（§9）。
9. **Task 3 双助手 errorMessage/actionErrorMessage 合并候选**（minor）：approval-store 两助手语义相近可合并（§9）。
10. **终态边界**：零结构变更（迁移 23/模型 60/权限 121/事件 15/路由不变）；双闸形态（事务外预读 + 事务内 FOR UPDATE 重验）；CALLBACK_KEY_CONFLICT 不泄露异实例 id。
11. **承接 SPEC-013 已知项（本 SPEC 零新增例外，全部维持）**：业务角色码 HR/SEAL_ADMIN/FINANCE/PARTNER 未创建（§9 角色供给）；TOTP 同 30s 窗口多敏感动作重放拒（SPEC-006/013 基础设施属性）；前端预存 vitest flake 7 件（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；预存漂移 4 项（admin_operation 双索引名、permission.updatedAt、user_role validFrom/updatedAt 默认值）留漂移治理专项。

## 8. 对账项

1. **零结构变更对账**：迁移 23/模型 60/权限 121/事件 15/路由不变——与设计 §7 逐字对齐；本 SPEC 零迁移、零 schema/permission/event/route 触碰。
2. **计数对账**：SPEC-013 1746 + 净增 3（approval-instance-service +2、terminate-linkage +1）= **1749 实测精确一致**（§3.3 逐文件 grep 核对）。
3. **docs-leakage 占位符口径**：task 报告/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012/013 先例），扫描 exit 0。
4. **`localhost` vs `127.0.0.1`**：本机 wslrelay IPv6 假连 flake 源，测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）。
5. **闸门计数按实际运行数**：Task 7 评审已提示口径——本报告按 Task 4 实际运行计数（非静态估计）。

## 9. Follow-up 路由（候选专项）

- **审批中心深化**（SPEC-013 §9 承接）：多级审批 / 会签 / 转交 / 超时升级 / Definition 管理 / 全组织视图（`approval.manage` 码未建）。
- **业务角色供给**（SPEC-013 §9 承接）：创建 HR/SEAL_ADMIN/FINANCE/PARTNER 业务角色（经角色管理 API type='BUSINESS'）并授成员——五类审批方可运行期产生实际审批人。
- **常量收敛专项**（本 SPEC minor 项合并）：Task 1 409 消息字面量 :229/:357 + Task 2 门禁消息 :350/:720 + Task 3 双助手 errorMessage/actionErrorMessage 合并——统一抽模块级常量/助手。
- **前置探查门控**（Task 1 minor）：processTask 前置 task 探查改 `if (idempotencyKey)` 门控（性能权衡）。
- **reject 分支对齐**（Task 3 follow-up 小改动）：RefundListPage reject 失败同款 `message.error` + Modal 保持打开。
- **事件计数断言窄化**（Task 2 minor）：terminate-linkage 事件计数断言按 eventType 窄化。
- **漂移治理专项**：预存漂移 4 项 + SPEC-010/011/012/013 迁移 shadow diff 合并治理。
- **前端 flake 治理**：预存 7 件负载 flake 的 testTimeout/资源隔离治理。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）。
- **文档修订**：CLAUDE.md Node 版本记录、设计文档对账措辞。

## 10. 双渠道验收链

Task 1-3 实现者渠道实现 + 协调者渠道独立审查（每任务 task-N-review-package 双件）；全部任务审查结论 Approved / 0 Critical（Task 1 前置探查权衡 + `|| !idempotencyKey` 守卫、Task 2 双闸措辞修正、Task 3 返回类型契约变更 + 双提示裁决为代表）。Task 4（本任务）为验收与收尾：全量闸门 + 迁移实证 + runbook/closeout 两文档落地；SPEC-014 全程共享 55433 测试库清净窗纪律，无并行渠道碰撞污染记录。

## 11. 收官状态

**SPEC-014 本地闭环（2026-08-01）**：4/4 任务完成；零结构变更（迁移 **23 维持**/模型 60/权限 121/事件 15/路由不变——设计 §7 逐字对齐）；后端本 SPEC 直接改动面 **78/78**（approval-instance-service 29 + terminate-plan-linkage 11 + receivable-service 38，另附 receivable-void 10/10 安全回归），全量串行 **1749 tests / 1745 pass / 0 fail / 4 skipped**（SPEC-013 1746 + 净增 3 精确对账 §3.3，**0 真 fail 为权威**）；前端四闸门绿（全量 **45 files / 191 tests** PASS 零 flake、tsc 0、lint 0 err（4 warn 预存）、build PASS）；security:test 34/34 零新增；迁移实证 23 维持 + 空库断言 PASS + 重演幂等零迁移；check:baseline PASS（23 迁移/60 model）+ check:bootstrap PASS + check:docs-leakage exit 0（Task 4 顺手治理 task-2-report 凭据 + 占位符口径）；已知非阻断项 §7 共 11 条照录（含 SPEC-013 承接项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
