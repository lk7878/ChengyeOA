# SPEC-013 审批中心 — 收尾报告

日期：2026-08-01 ｜ 状态：**本地闭环**（Task 1-8 全部 Approved + Task 9 验收闸门全绿）
需求来源：MOD-013 + PRD §4.12 + 专项设计 `docs/专项设计/审批实例任务与消息回调设计.md` + SPEC-011 closeout §9 follow-up「审批中心迁移」「refund.approve 真实 Step-Up」
设计：docs/superpowers/specs/2026-08-01-approval-center-design.md ｜ 实施台账：.superpowers/sdd/2026-08-01-approval-center/progress.md

## 1. 交付范围

- **核心审批流（Q1/D1）**：Definition/Instance/Task/CallbackAction 四模型全生命周期——apply（建 Instance + N Task + 事件/审计）→ process（CallbackAction 幂等 + 实例行 FOR UPDATE 串行化 + **任一通过**定稿 + 余 task CANCELLED）→ withdraw（本人 PENDING 撤回 + 待办取消）。领域审批（refund/invoice/合同）保持直连不回填（Q2/D2）。
- **Definition 种子五类（Q3/D3）**：LEAVE 请假 / SEAL 用印 / EXPENSE 费用报销 / CONTRACT_CHANGE 合同变更 / TRANSFER 转所——provisioning 迁移落 5 行，approverRule 经 ROLE roleCodes 配置（**业务角色码 HR/SEAL_ADMIN/FINANCE/PARTNER 未建边界**，见 §7.2）。
- **审批人规则（Q4/D4）**：USER userIds 原序 + ROLE roleCodes→成员解析（活跃过滤 revokedAt null/validFrom≤now/validUntil 窗口）；**禁止自审**（申请人 ∈ 审批人集 → 409）。
- **遗留处置（Q5/D5）**：`DROP TABLE approval` + 移除无权限 4 路由/旧 controller/旧前端页——模型 57→60（+4 −1）。
- **Step-Up（Q6/D6）**：`REFUND_APPROVE` 目的位（target=refundRequestId+expectedVersion）+ refund.approve 真实 MFA 重验（SPEC-011 follow-up 落地）。
- **权限（D9）**：三码 `approval.read/apply/process`（118→121）；六门禁路由（approval 域 4→6，含 definitions 目录路由——design 修正，设计 §4.3 原文 5 路由）。
- **幂等（D10）**：process 双层幂等——外部 callbackKey（`callback_action.callbackKey` UNIQUE 重读首结果）+ 任务状态自幂等。
- **事件**：2 类 v1（`approval.instance.created` 恰 5 键 / `approval.instance.completed` 恰 3 键），sourceModule APPROVAL / objectType APPROVAL_INSTANCE（13→15）。
- **前端**：审批中心页（/approvals → ApprovalCenterPage 三 Tab：我的申请/待办/已办）+ 新建申请 Modal（formSchema 动态渲染五类）+ api/approval.ts + approval-store；旧 SPEC-001 原型页（pages/Approval/）+ api/organization.ts approval 段 + types/index.ts Approval 接口退休（1 替换）。
- **运维**：runbooks/finance-operations.md §9 审批中心节。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行，127.0.0.1:55433）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | 结构迁移 drop approval + 4 表 + 基线 57→60/21→22 | baseline+spec-008 **16/16** + schema-contract 11/11 + check-baseline valid + tsc 0 |
| 2 | 权限 +3 + Definition 种子 provisioning + parity | parity **13/13** + 计数 28/28 + bootstrap 129/129 + authorization 46/46 + baseline 27/27 + empty-app 14/14 |
| 3 | 事件注册 approval.instance.created/completed | approval-events **15** + contract-events 49 + finance-events 60 回归（总数 64 对账） |
| 4 | domain 层 approval-types/errors/policy | approval-policy **21/21**；tsc/eslint 0 |
| 5 | definition-service + instance-service | instance-service **27/27** + 回归 policy 21 + permission-catalog 13（累计 61/61） |
| 6 | factory + controller + 6 路由 + errorHandler + API | approval-api **11/11** + test/approval 61/61 + test/contract **239/239** |
| 7 | Step-Up REFUND_APPROVE + refund 接线 | 后端 **70**（refund-step-up 5 + refund-service 46 零改动 + refund-api 7 + step-up/security/governance 回归）；前端 43 files/176 |
| 8 | 前端审批中心页 + 旧页退休 | 前端全量 **44 files/185 tests**（ApprovalCenterPage 9 例非恒真）；tsc/lint/build 全绿 |
| 9 | 验收与收尾（本报告） | 见 §3.2 |

### 3.2 最终全量（Task 9 验收跑，清净窗）

| 闸门 | 结果 |
|---|---|
| 后端本 SPEC 直接改动面（串行） | **150/150**（approval-events 15 + permission-catalog-approval 13 + approval-policy 21 + approval-instance-service 27 + refund-step-up 5 + refund-service 46 + refund-api 7 + step-up-target 5 + approval-api 11，与逐文件 grep 计数逐字对上） |
| 后端全量串行（全 test/ 枚举，清净窗，官方闸门命令） | **1746 tests / 1742 pass / 0 fail / 0 cancelled / 4 skipped**（skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件照录；4 skipped 为 opt-in pkg smoke 件——pkg-drain-smoke 2 + pkg-event-check-smoke 2，非回归；对账见 §3.3） |
| 迁移重演 + 空库断言 + 重跑幂等 | db:reset:test（**23 迁移**重放）→ db:assert-empty PASS → `prisma migrate deploy` 二次零迁移（幂等） |
| provisioning 迁移-only 实证（reset 后零种子直查） | permission=**121**（3 新码逐字段=目录：id='permission:'+code/status='ENABLED'/version=1）+ approval_definition=**5 行**（LEAVE/SEAL/EXPENSE/CONTRACT_CHANGE/TRANSFER 逐 code/name/businessType/approverRule） |
| check:baseline / check:bootstrap / check:docs-leakage | PASS（23 迁移/60 model）/ PASS / exit 0 |
| security:test | 34/34 零新增 |
| 前端四闸门 | 全量 **44 files/185 tests** PASS（基线 flake 隔离复跑照录）；tsc 0、lint 0 err（4 warn 预存）、build PASS |

### 3.3 全量合计（Task 9 实测，清净窗）

**实测：1746 tests / 1742 pass / 0 fail / 4 skipped**（官方闸门命令 + `--test-skip-pattern` 排除 spec-008 排练 3 例 port-55432 锁定件；4 skipped 为 opt-in pkg smoke 件，非回归）。

SPEC-012 基线 **1652 tests**。SPEC-013 净增 **94**：approval-events +15、permission-catalog-approval +13（新件）、approval-policy +21（新件）、approval-instance-service +27（新件）、refund-step-up +5（新件）、approval-api +11（新件）、refund-api +1（Step-Up 持证 e2e 适配，6→7）、step-up-target +1（REFUND_APPROVE 目的位，4→5）——新件小计 92 + 既有件净增 2 = **94 精确对账**；实测 **1746 − 1652 = 94**。

> **对账**：1652 + 94 = 1746 预期，与实测**精确一致**（新件 92 逐文件 grep 计数 + refund-api/step-up-target 既有件净增 2 逐测试核对——refund-api 439 行为 Step-Up 新增、step-up-target 82 行为 REFUND_APPROVE 新增，其余为既有 6/4 保真）。**0 真 fail 为权威结论**，计数链终态以实测 1746 为准。

> **Task 9 顺手治理**：初跑全量 1746/1741/**1 fail**/4 skipped——唯一 fail 为 docs-leakage 扫描命中 **task-5-report.md:53 + task-6-report.md:69**（任务报告 env 块含完整测试连接串凭据）。按 SPEC-012 先例占位符口径脱敏（URL 去口令 `postgresql://chengye_test@...` + `JWT_SECRET="<redacted>"`），复跑 persisted-documentation-leakage.test **3/3 PASS** + `check:docs-leakage` exit 0。

## 4. 迁移与模型

- **迁移总数 21→23**（+2）：`20260801100000_approval_center_expand`（DROP approval + 4 新表 + 索引 + 2 FK：approval_task.instanceId CASCADE、approval_instance.definitionId RESTRICT、callback_action 无 FK——设计非缺陷，instance 永不物理删除）+ `20260801120000_approval_provision`（3 权限行 + 5 Definition 种子，ON CONFLICT DO NOTHING 幂等，无 UPDATE 段）。`migrate diff` 基线/终态逐字节相同（仅 4 项既有漂移零新 diff）。
- **model 总数 57→60**（+4 −1：ApprovalDefinition/ApprovalInstance/ApprovalTask/CallbackAction，删 Approval）。
- **权限 118→121**（+3 ACTION：approval.read LOW / approval.apply MEDIUM / approval.process HIGH）；**事件 13→15**（+2）；**approval 域路由 4→6**（Task 1 删旧 4 无权限 + Task 6 六门禁含 definitions 目录路由——design 修正，设计 §4.3 原文 5 路由）。
- **assert-empty 排除 ApprovalDefinition**（与 Permission/EventSubscription/ContractTemplate 同型——迁移供给目录，否则 fresh bootstrap 报非空）。
- **预存漂移 4 项照录（非本 SPEC 引入，Task 1 diff 暴露）**：admin_operation 双索引名、permission.updatedAt、user_role validFrom/updatedAt 默认值——fresh 库与累积库位形分叉，漂移治理独立立项（§9）。
- 基线契约同步点：`check-baseline-contract.ts`（CANONICAL 60/23）+ `baseline-contract.test.ts` + `spec-008-event-observability-migration-contract.test.ts` + `schema-contract.test.ts`——均同步 60/23。

## 5. 关键裁决记录（D1-D10，设计 §13 决策 + 实施期裁决）

| # | 决策 | 裁决 |
|---|---|---|
| D1 | 深度 | 核心审批流（Q1）：Instance + Task + 基础 Definition（单级节点）+ CallbackAction 幂等 |
| D2 | 领域审批关系 | 直连保持 + Step-Up（Q2）：refund/invoice/合同继续走既有服务动作不回填 |
| D3 | 初始类型 | 行政/HR 五类 Definition 种子（Q3）：EXPENSE/CONTRACT_CHANGE/SEAL/LEAVE/TRANSFER |
| D4 | 审批人规则 | 指定人员 + 角色 + 禁止自审（Q4）；上级/组织负责人/表达式归后续 |
| D5 | 遗留处置 | Drop 迁移退休（Q5）：`DROP TABLE approval` + 退役旧路由/控制器/前端页 |
| D6 | Step-Up | 仅 refund.approve（Q6）：REFUND_APPROVE 目的位 + 前端真实 MFA 重验 |
| D7 | 模块形态 | 独立 approval 模块（方案 A）：domain 纯领域层 + application 服务 + factory |
| D8 | 决策语义 | **任一通过**（会签归后续）：首个审批人决定定稿，余 PENDING task 全 CANCELLED |
| D9 | 权限 | approval.read/apply/process 三码（121） |
| D10 | 幂等 | CallbackAction callbackKey unique 重读返回首结果（幂等优先不抛） |

**实施期裁决（评审追认 + 过程偏离）**：

1. **permission INSERT 计划之误追认**（Task 2 偏离 1）：brief 用 gen_random_uuid()/'ACTIVE'/简化列集；实际按 finance 先例全列集 + `id='permission:'+code` + `status='ENABLED'`——必要性双证：`permission.updatedAt` NOT NULL 无 DB 默认 + bootstrap `assertPermissionCatalog` 断言 id/status。**计划代码之误，实现者纠正正确。**
2. **Definition 种子 roleCodes 保留**（Task 2 关键裁决）：HR/SEAL_ADMIN/FINANCE/PARTNER 均不存在（bootstrap 仅两 SYSTEM 角色），approverRule 为 JSONB 配置非 FK，保留 brief 逐字——5 业务审批路由不塌缩为系统管理员单一路由；角色供给归 follow-up。
3. **旧原型 controller/路由退役提前至 Task 1**（Task 1 偏离 3）：model Approval 删后旧控制器无法编译（tsc 闸门必需）；Task 6 范围相应调整为仅新增门禁 6 路由。
4. **ApprovalDefinition 补 @@map + 反向关系**（Task 1 偏离 1/2）：缺则 migrate diff 出新 diff / P1012 generate 失败——纯声明零 DB。
5. **assert-empty 排除 ApprovalDefinition**（Task 2 偏离 4）：迁移种子 5 行使空表断言非空，fresh bootstrap 必挂。
6. **definitions 路由 design 修正**（Task 6 裁决 ⑤）：设计 §4.3 五路由未含 definitions 目录（前端表单渲染必需），补第 6 路由 GET /api/v1/approvals/definitions 挂 approval.apply——**approval 域路由 4→6（修正 plan 的 4→5）**。
7. **Task 5 提前派发过程偏离**（Task 4 过程）：Task 5 实现者在 Task 4 未过评审门前派出（文件域分离零写碰撞，但 import 有时序依赖）——已向 Task 5 发依赖等待提示；后续严格串行。
8. **漏 await 自捕根治**（Task 7）：初版 assertRefundApproveStepUp 漏 await 致未捕获 rejection + TRUNCATE 死锁，加 await 全绿。
9. **用例断账修正**（Task 3 评审）：approval-events 实 **15** test()（非报告 21）、contract-events 实 49（非 43，8×3+8+17 循环），总数 64 对账正确——纯标签误标照录。
10. **processTask FOR UPDATE 串行化**（Task 5 关注项）：实例行 FOR UPDATE 较裁决"翻转败者重读"更严格——写事务首把锁恒实例行，与 withdraw 翻转互斥；CANCELLED task 409 已测。
11. **分桶数字实测修正**（Task 5 评审）：apply 7+process 7+withdraw 4+list/get 6+definition 3=27，总数正确照录。
12. **`void to;` eslint 修正**（Task 4 偏离）：no-unused-vars args:'after-used'——保留签名与 return true 语义，行为逐字一致。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归，本 SPEC 零新增例外）。
- `security:audit:prod` exit 1，现存 **2 个 production_high**——与 SPEC-009/010/011/012 收官逐项一致、**本 SPEC 零新增例外**：
  - server：brace-expansion GHSA-mh99-v99m-4gvg（egg 工具链专项）。
  - web：react-router GHSA-qwww-vcr4-c8h2（SEC-2026-002 登记，**2026-08-29 到期**，v8 迁移专项）。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。**Task 9 顺手治理**：SPEC-013 task-5/6 报告原含测试连接串凭据 + 密钥赋值，已按占位符口径脱敏（`postgresql://chengye_test@...` 去口令 + `JWT_SECRET="<redacted>"` 等），扫描 exit 0。

## 7. 已知非阻断项

1. **业务角色码未创建**（Task 2）：HR/SEAL_ADMIN/FINANCE/PARTNER 均不存在——5 Definition 种子为配置前瞻，approverRule 为 JSONB 配置非 FK；运行期 apply 角色缺 → 空审批人集 → `APPROVAL_ASSIGNEE_INVALID` 400 优雅兜底。**角色供给归 follow-up**（§9）。
2. **permission INSERT 计划之误追认**（Task 2 偏离 1）：沿 finance 先例全列集/id/status——计划代码之误，实现者纠正正确，评审追认。
3. **assert-empty 排除 ApprovalDefinition**（Task 2）：与 Permission/EventSubscription/ContractTemplate 同型迁移供给目录。
4. **用例断账修正**（Task 3）：approval-events 15/contract-events 49 纯标签误标照录，总数对账正确。
5. **callbackKey 跨实例同 key 并发 P2002 防御缺口**（Task 5 ⚠️②，minor）：调用方违规同一 idempotencyKey 用于两个不同逻辑操作时——顺序+同实例并发均正确，防御性 catch P2002→重读幂等化列 follow-up（§9）。
6. **listInstances role 必填**（Task 5 关注项③）：无默认三值，前端/controller 须显式传（缺 → 400）。
7. **definitions 路由 design 修正**（Task 6）：approval 域 4→6，plan 计数修正照录。
8. **process=taskId/withdraw=instanceId 语义**（Task 6/8）：同形 `/approvals/:id/...` 但 :id 语义不同，前端 API/页面显式区分（待办行取 myPendingTask(record).id）。
9. **TOTP 同 30s 窗口多敏感动作重放拒**（Task 7 ⚠️②）：StepUpService.issue 推进 lastAcceptedCounter 同窗口二次发证 403——SPEC-006/013 既有基础设施属性，产品侧知悉。
10. **审批失败静默 catch UX**（Task 7 ⚠️③ + Task 8 M1）：审批动作吞错 + 列表失败静默 catch——沿既有页面模式非本任务引入，列 follow-up 加 message.error（§9）。
11. **Task 8 Minor×4**：M2 Number 空值 NaN 潜在（种子全必填无现实路径）/ M3 detail 死面（列表内嵌 tasks）/ M4 handleCreate 时序（definitionCode required 实际不可达）。
12. **终态边界**：CANCELLED task 409；任一通过决策语义（首审批人定稿）；envelope 无组织锚（branchId/teamId 恒 null）；分页 createdAt DESC id ASC。
13. **前端预存 vitest flake**（SPEC-011 已知集：EventOperations/Position/SecurityUser/PublicPoolPage/SecurityRole/App.test/AdminGovernance，隔离复跑全 PASS，非回归）——Task 9 全量 44/185 一次通过零 flake。
14. **Node v24.18.0 vs CLAUDE.md 记 22.14.0**：全量零影响实证，未见行为分叉。
15. **Task 1 Minor**：extractObjectId 参数名 payload vs 母版 parsed（一致性观察项）。
16. **Task 7 后端闸门计数口径**：静态数 72-73 vs 报告 70 vs 实测 70——Task 9 按实际运行数记（150/150 直接改动面 + 全量 1746 实测）。

## 8. 对账项

1. **迁移 diff 只读不可复跑**（Task 1）：以 SQL↔schema 逐字等价 + 漂移逐字吻合 + 漂移前既有三重旁证采信；Task 9 以 db:reset:test 23 迁移重放 + 空库断言 + 重演幂等实证。
2. **Prisma Client 再生**（Task 1 ⚠️②）：Task 2 评审顺带确认——prisma.approvalDefinition 可用，parity 直查 5 行成功。
3. **计数对账**：SPEC-012 1652 + 净增 94 = 1746，与实测**精确一致**（§3.3 逐测试核对）；直接改动面 150/150 与逐文件计数逐字对上。
4. **`localhost` vs `127.0.0.1`**：本机 wslrelay IPv6 假连 flake 源，测试连接串纪律统一 127.0.0.1（承 SPEC-011 裁决 13）。
5. **目标计数 vs 实测**：模型 57→60、迁移 21→23、权限 118→121、事件 13→15、approval 域路由 4→6（含 definitions——修正 plan 4→5）、前端旧页→新中心页 1 替换——全部对齐设计目标（plan 路由计数 4→5 处修正为 4→6）。

## 9. Follow-up 路由（候选专项）

- **多级审批 / 会签 / 转交 / 超时**（设计 §12 OUT + 专项设计范畴）：当前为单级节点 + 任一通过，会签（全部通过才定稿）、多级链、转交、加签、超时升级均归后续。
- **Definition 管理**（设计 §12 OUT）：种子固定 5 类；Definition CRUD/版本管理接口归后续（当前 provisioning 只 INSERT + 幂等 UPDATE）。
- **全组织审批视图**（设计 §6.4）：`approval.manage` 码未建，全组织 list/get 归后续；当前仅 actor 作用域 fail-closed。
- **审批人表达式**（设计 Q4 OUT）：上级/组织负责人规则、表达式审批人归后续（当前 USER/ROLE 两型）。
- **业务角色供给**（Task 2 关键裁决）：创建 HR/SEAL_ADMIN/FINANCE/PARTNER 业务角色（经角色管理 API type='BUSINESS'）并授成员后，五类审批方可运行期产生实际审批人——**配置文档已固化五码约定**（runbook §9.1）。
- **callbackKey 跨实例 P2002 防御**（Task 5 ⚠️② minor-deferred）：process 幂等 catch P2002→重读幂等化，防御调用方违规跨实例同 key 竞态。
- **审批失败静默 catch UX**（Task 7 ⚠️③ + Task 8 M1）：审批动作/列表失败补 message.error 提示。
- **TOTP 同窗口多动作产品知悉**（Task 7 ⚠️②）：同 30s 窗口多敏感动作重放拒——产品侧知悉基础设施属性。
- **漂移治理专项**：预存漂移 4 项 + SPEC-010/011/012/013 迁移 shadow diff 合并治理。
- **前端 flake 治理**：预存 7 件负载 flake 的 testTimeout/资源隔离治理。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）。
- **文档修订**：CLAUDE.md Node 版本记录、设计文档对账措辞。

## 10. 双渠道验收链

Task 1-8 实现者渠道实现 + 协调者渠道独立审查（每任务 task-N-review-package 双件）；全部任务审查结论 Approved / 0 Critical（Task 1 偏离 1/2 必要性、Task 2 permission INSERT 追认、Task 3 用例断账、Task 5 FOR UPDATE 串行化、Task 6 definitions 路由修正、Task 7 TOTP 知悉、Task 8 Minor×4 为代表）。Task 9（本任务）为验收与收尾：全量闸门 + 迁移实证 + runbook/closeout 两文档落地；SPEC-013 全程共享 55433 测试库清净窗纪律，无并行渠道碰撞污染记录。

## 11. 收官状态

**SPEC-013 本地闭环（2026-08-01）**：9/9 任务完成；后端直接改动面 **150/150**（approval-events 15 + permission-catalog-approval 13 + approval-policy 21 + approval-instance-service 27 + refund-step-up 5 + refund-service 46 + refund-api 7 + step-up-target 5 + approval-api 11），全量串行 **1746 tests / 1742 pass / 0 fail / 4 skipped**（SPEC-012 1652 + 净增 94 精确对账 §3.3，**0 真 fail 为权威**）；前端四闸门绿（全量 **44 files/185 tests** PASS 零 flake、tsc 0、lint 0 err（4 warn 预存）、build PASS）；security:test 34/34 零新增；迁移实证 21→23 + 空库断言 PASS + 重演幂等零迁移 + provisioning 实证 permission=121 + Definition=5 行；check:baseline PASS（23 迁移/60 model）+ check:bootstrap PASS + check:docs-leakage exit 0（Task 9 顺手脱敏 task-5/6 报告凭据）；已知非阻断项 §7 共 16 条照录，follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
