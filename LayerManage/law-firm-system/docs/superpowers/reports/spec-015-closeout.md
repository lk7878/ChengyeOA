# SPEC-015 审批中心业务角色供给 — 收尾报告

日期：2026-08-02 ｜ 状态：**本地闭环**（Task 1-2 双渠道 Approved + Task 3 验收闸门全绿）
需求来源：SPEC-013 closeout「业务角色供给五码」（HR/SEAL_ADMIN/FINANCE/PARTNER 未创建致审批中心 5 类申请全部 `APPROVAL_ASSIGNEE_INVALID` 400）
设计：docs/superpowers/specs/2026-08-02-approval-role-provisioning-design.md ｜ 实施台账：.superpowers/sdd/2026-08-02-approval-role-provisioning/progress.md

## 1. 交付范围

**零结构变更**下使审批中心五类申请端到端可用（数据供给 + 契约更新 + 验证）：

- **bootstrap 4 BUSINESS 角色供给（Task 1）**：system-bootstrap-service 扩展 `BUSINESS_ROLE_SEEDS`（HR 人事管理 / SEAL_ADMIN 印章管理员 / FINANCE 财务 / PARTNER 合伙人，各 `type:'BUSINESS'`/`status:'ENABLED'`）——事务内沿既有 SYSTEM 角色创建形态建 4 角色 + 各授 `role_permission` 两行（`APPROVAL_REVIEWER_PERMISSION_CODES` = approval.read + approval.process，permission 按 code 查 id；approval.apply 不授）。幂等沿既有 `AlreadyInitializedError` 写前拒守卫（二次运行零新增）。
- **契约更新（Task 1）**：check-bootstrap-contract 角色契约 2→6（`bootstrapRoleLiterals` AST + `checkBootstrapRoles`：恰 6 code / 4 BUSINESS type·status / 2 SYSTEM type）+ 授权字面量检查（`checkApprovalReviewerGrants`：approval.read/process）。
- **端到端可用性验证（Task 2）**：`approval-instance-service.test.ts` 新增五类端到端段（LEAVE→HR / SEAL→SEAL_ADMIN / EXPENSE→FINANCE / CONTRACT_CHANGE→PARTNER / TRANSFER→HR，roleCode+formSchema 逐字镜像 Definition 种子）——测试内建角色指派成员 → apply 审批人解析非空 → 恰 1 task → 成员 processTask 定稿 APPROVED。**零生产代码改动**（resolveRoleMembers 与 Task 1 供给天然兼容，五类首跑即绿）。
- **运维文档（Task 3）**：runbook §9.1 角色未建边界更新为「已 bootstrap 供给 4 业务角色 + approval.read/process 授权（approval.apply 不授）；成员指派归运行期（role-auth-service/user-grant）」+ §9.7/§9.9 同步。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | bootstrap 4 BUSINESS 角色 + 权限授予 + 契约更新（system-bootstrap-service + check-bootstrap-contract + 两测试件） | system-bootstrap-service **12/12**（+1：幂等供给例）+ bootstrap-contract **122/122**（+4：6 code 契约/缺 HR/错 type/缺 approval.process 字面量）+ check-bootstrap 实测 PASS + tsc/eslint 0；回归 system/ci 255、approval 63、db/app 75 全绿 |
| 2 | 审批中心端到端可用性验证（五类申请→审批，验证型零生产代码） | test/approval **68/68**（instance 34 = 29+5 端到端 + policy 21 + catalog 13，评审修正 breakdown）+ tsc/eslint 0 |
| 3 | 闸门 + runbook/closeout 更新（本报告） | 见 §3.2 |

### 3.2 最终全量（Task 3 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端本 SPEC 直接改动面（串行） | 见 §3.1（bootstrap 12 + contract 122 + approval 68） |
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令） | **1759 tests / 1755 pass / 0 fail / 4 skipped**（skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归；对账见 §3.3） |
| 迁移重演 + 空库断言 + 重跑幂等 | db:reset:test（**23 迁移**重放——零结构变更，SPEC-015 零迁移）→ db:assert-empty PASS → `prisma migrate deploy` 二次零迁移（幂等） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（23 迁移/60 model）/ PASS（角色契约 2→6）/ exit 0 |
| security:test | 34/34 零新增（本 SPEC 零新增例外） |

### 3.3 全量合计（Task 3 实测，清净窗）

**实测：1759 tests / 1755 pass / 0 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件；4 skipped 为 opt-in pkg smoke 件，非回归）。

SPEC-014 基线 **1749 tests**。SPEC-015 净增 **10**：system-bootstrap-service +1（幂等供给例）、bootstrap-contract +4（6 code 契约/缺 HR/错 type/缺 process 字面量）、approval-instance-service +5（五类端到端）——与实测 **1749 + 10 = 1759 精确对账**。

> **对账**：1749 + 10 = 1759 预期，与实测**精确一致**（逐文件 grep 计数：bootstrap 12=11+1、contract 122=118+4、instance 34=29+5）。**0 真 fail 为权威结论**，计数链终态以实测 1759 为准。

## 4. 迁移与模型

- **迁移总数 23 维持**（SPEC-015 零新增迁移）；**model 60、权限 121、事件 15、路由不变**——与设计 §5「零结构变更」逐字对齐。无 schema/migration/permission/event/route 触碰（bootstrap 数据供给仅 Role/RolePermission 既有模型行）。
- check:baseline PASS（CANONICAL 23 迁移/60 model）；check:bootstrap PASS（角色契约 2→6）。
- 迁移实证：db:reset:test 重放 23 迁移 → db:assert-empty PASS → `prisma migrate deploy` 二次零迁移（幂等）。
- 基线契约同步点无变化（60/23 维持）。

## 5. 关键裁决记录（Q1-5，设计 §2 决策）

| # | 决策 | 裁决 |
|---|---|---|
| Q1 | 供给机制 | **bootstrap 种子**（system-bootstrap-service 扩展，沿既有 SYSTEM 角色创建形态建 4 个 BUSINESS 角色）——fresh init 即存在，优于迁移（避免 Role 入 assert-empty 排除的语义漂移）与纯运行期（无代码不落地） |
| Q2 | 角色集 | **4 唯一码**：HR（人事管理）/SEAL_ADMIN（印章管理员）/FINANCE（财务）/PARTNER（合伙人）；TRANSFER 复用 HR；type='BUSINESS'、status ENABLED；与 Definition 种子 roleCodes 逐字对齐 |
| Q3 | 权限授予 | 每角色 role_permission 种子：**approval.read + approval.process**（审批人角色）；approval.apply 不授（申请人为一般员工，非必经角色） |
| Q4 | 成员指派 | **运行期设置**（role-auth-service/user-grant 指派成员）——文档化（runbook/closeout），非代码 |
| Q5 | 契约更新 | check-bootstrap-contract 断言 2→6 角色（2 SYSTEM + 4 BUSINESS） |

**实施期裁决（评审追认 + 过程偏离）**：

1. **Task 1 ⚠️① 测试标题过时**（cosmetic）：bootstrap 测试既有标题「creates both reserved system roles…」正文已断言 6 角色——标题未改，纯 cosmetic 照录。
2. **Task 1 ⚠️② 授权字面量弱检查**：check-bootstrap-contract 授权检查为源码字面量存在性（非 AST 语义绑定）——行为由运行时测试兜底（rolePermission 直查 approval.read/process），符合设计分层，照录。
3. **Task 1 ⚠️③ 长度守卫第二道防线**：checkBootstrapRoles 的 REQUIRED_ROLE_CODES 清单守卫系正确第二道防线（上游 assertPermissionCatalog 先保证 catalog 一致性），照录。
4. **Task 2 ⚠️① 报告 breakdown 失准**：Task 2 报告写 34+14+20=68 失准——实 34+21+13=68（approval-policy 实 21 / permission-catalog-approval 实 13），总数正确，纯标签误标照录。
5. **Task 2 ⚠️② "失败测试先行"语义偏移**：验证型任务五类端到端首跑即绿（非 TDD 红→绿）——系验证实证（Task 1 前状态会 400），已解释一致。
6. **Task 2 ⚠️③ decidedAt 未断言**：定稿断言已含 APPROVED+decidedBy+version 2，decidedAt 时间戳断言非要求（既有覆盖），照录。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` exit 1，现存 **2 个 production_high**——与 SPEC-009/010/011/012/013/014 收官逐项一致、**本 SPEC 零新增例外**：
  - server：brace-expansion GHSA-mh99-v99m-4gvg（egg 工具链专项）。
  - web：react-router GHSA-qwww-vcr4-c8h2（SEC-2026-002 登记，**2026-08-29 到期**，v8 迁移专项）。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**Task 3 占位符口径**：task 报告/closeout env 块用 `JWT_SECRET="<redacted>"`/URL 去口令。

## 7. 已知非阻断项（评审累积逐条照录）

1. **Task 1 测试标题过时**（cosmetic）：bootstrap 既有标题「creates both reserved system roles…」未随 6 角色断言更新（§9）。
2. **Task 1 授权字面量弱检查**（minor）：check-bootstrap-contract 授权检查为字面量存在性——行为由运行时测试兜底、符合设计分层（§9 可强化 AST 语义绑定）。
3. **Task 1 长度守卫第二道防线**（信息性）：REQUIRED_ROLE_CODES 清单守卫系正确第二道防线（上游 assertPermissionCatalog 先保证），照录。
4. **Task 2 报告 breakdown 失准**（纯标签）：实 34+21+13=68 非 34+14+20——总数正确，文档已修正（§9 无代码项）。
5. **Task 2 "失败测试先行"语义偏移**（信息性）：验证型五类端到端首跑即绿（Task 1 前状态会 400），已解释一致。
6. **Task 2 decidedAt 未断言**（非要求）：定稿断言已含 decidedBy+version 2，decidedAt 时间戳非要求。
7. **终态边界**：零结构变更（迁移 23/模型 60/权限 121/事件 15/路由不变）；bootstrap 角色 2→6；成员指派归运行期（§9 承接——业务角色成员指派专项）。
8. **承接既有已知项（本 SPEC 零新增例外，全部维持）**：审批中心深化（多级/会签/Definition 管理/全组织视图 approval.manage 未建）；terminate 侧硬化（SPEC-014 MEDIUM 反向竞速——createPayment 提交后 terminate 在途闸残余窗）；SUPPLEMENT 父状态复查；前端预存 vitest flake（隔离复跑全 PASS 非回归）；Node v24.18.0 vs CLAUDE.md 记 22.14.0（全量零影响实证）；预存漂移 4 项（admin_operation 双索引名、permission.updatedAt、user_role validFrom/updatedAt 默认值）留漂移治理专项；SEC-2026-002（react-router v8 迁移，2026-08-29 到期）。

## 8. 对账项

1. **零结构变更对账**：迁移 23/模型 60/权限 121/事件 15/路由不变——与设计 §5 逐字对齐；本 SPEC 零迁移、零 schema/permission/event/route 触碰（bootstrap 数据供给仅 Role/RolePermission 既有模型行）。
2. **计数对账**：SPEC-014 1749 + 净增 10（bootstrap +1、contract +4、instance +5）= **1759 实测精确一致**（§3.3 逐文件 grep 核对）。
3. **docs-leakage 占位符口径**：task 报告/closeout 用 `JWT_SECRET="<redacted>"`/URL 去口令（沿 SPEC-012/013/014 先例），扫描 exit 0。
4. **`localhost` vs `127.0.0.1`**：本机 wslrelay IPv6 假连 flake 源，测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）。
5. **闸门计数按实际运行数**：Task 7 评审已提示口径——本报告按 Task 3 实际运行计数（非静态估计）。

## 9. Follow-up 路由（候选专项）

- **业务角色成员指派**（本 SPEC 承接，紧邻）：HR/SEAL_ADMIN/FINANCE/PARTNER 角色已供给，**成员指派归运行期**（role-auth-service/user-grant 经角色管理 API）——指派后五类审批方可产生实际审批人；建议提供成员指派运营指南/种子。
- **审批中心深化**（SPEC-013 §9 承接）：多级审批 / 会签 / 转交 / 超时升级 / Definition 管理 / 全组织视图（`approval.manage` 码未建）。
- **terminate 侧硬化**（SPEC-014 MEDIUM 承接）：createPayment 提交后 terminate 在途闸残余窗——terminate 侧在途闸取 Contract FOR UPDATE + 锁后重验在途 PENDING。
- **SUPPLEMENT 父状态复查**：独立 follow-up（设计 §6 OUT）。
- **check-bootstrap-contract 授权语义强化**（本 SPEC minor）：授权检查字面量 → AST 语义绑定（可选）。
- **测试标题现代化**（本 SPEC cosmetic）：bootstrap 既有标题随 6 角色断言更新。
- **漂移治理专项**：预存漂移 4 项 + SPEC-010/011/012/013/014 迁移 shadow diff 合并治理。
- **前端 flake 治理**：预存负载 flake 的 testTimeout/资源隔离治理。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）。
- **文档修订**：CLAUDE.md Node 版本记录、设计文档对账措辞。

## 10. 双渠道验收链

Task 1-2 实现者渠道实现 + 协调者渠道独立审查（task-N-review-package 双件）；全部任务审查结论 Approved / 0 Critical（Task 1 ⚠️×3 全照录——标题 cosmetic/字面量弱检查/长度守卫二道防线；Task 2 ⚠️×3 全照录——breakdown 失准/语义偏移/decidedAt 非要求）。Task 3（本任务）为验收与收尾：全量闸门 + 迁移实证 + runbook/closeout 两文档落地；SPEC-015 全程共享 55433 测试库清净窗纪律，无并行渠道碰撞污染记录。

## 11. 收官状态

**SPEC-015 本地闭环（2026-08-02）**：3/3 任务完成；零结构变更（迁移 **23 维持**/模型 60/权限 121/事件 15/路由不变——设计 §5 逐字对齐）；bootstrap 角色 2→6（4 BUSINESS 审批角色 + approval.read/process 授权，approval.apply 不授）；后端本 SPEC 直接改动面 bootstrap **12/12** + contract **122/122** + approval **68/68**，全量串行 **1759 tests / 1755 pass / 0 fail / 4 skipped**（SPEC-014 1749 + 净增 10 精确对账 §3.3，**0 真 fail 为权威**）；security:test 34/34 零新增；迁移实证 23 维持 + 空库断言 PASS + 重演幂等零迁移；check:baseline PASS（23 迁移/60 model）+ check:bootstrap PASS（角色契约 2→6）+ check:docs-leakage exit 0（占位符口径）；已知非阻断项 §7 共 8 条照录（含既有承接项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
