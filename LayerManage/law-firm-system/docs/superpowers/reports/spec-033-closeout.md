# SPEC-033 案件办理域核心（Case Handling Core）— 收尾报告

日期：2026-08-05 ｜ 需求来源：业务链「案件办理与交付」核心——Schema 已建（Case/CaseTask/Communication 模型 + 遗留原型 controller 直连 ctx.prisma、无权限门禁/校验/审计/测试）→ 构建正规案件办理域 ｜ 用户授权自主推进 ｜ 前置：SPEC-009（客户主数据）、SPEC-010（合同）、Spec-004（RBAC 权限框架 + provisioning 迁移纪律）
注：**编号裁决**——本专项与安全审计门禁加固原同号 SPEC-033（后者编号沿革 032→033 占用），**用户裁决案件办理 = SPEC-033、安全审计门禁 = SPEC-034**（其 plan/design/closeout 已改号；memory 同步）。

## 1. 交付范围

业务链「案件办理与交付」核心——新增 **case 权限码六枚** + **provisioning 迁移** + **正规服务层**（Case 生命周期 / CaseTask 状态机 / Communication）+ **controller 重构**（薄控制器替代遗留原型，移除 destroy）+ **路由门禁** + **API/服务/前端测试**。**结构性变更**（迁移 26→**27**、模型 60 不变、权限 123→**129**、事件 15 不变、路由 15→**22**）。

1. **Task 1（权限码 + provisioning + baseline）**：`PERMISSION_CODES` +6（case.read/case.create/case.update/case.close/case.task.manage/case.communication.create）+ provisioning 迁移 `20260805100000_case_permission_provision`（6 行 `permission` INSERT `ON CONFLICT ("code") DO NOTHING`，沿审批先例）+ baseline 同步（迁移计数 26→27；权限计数断言 129 与现状一致——实际 base 123 +6 = 129，计划/设计估算「124→130」为口径偏差）。
2. **Task 2（服务层）**：`case-service.ts`（create/update/list/get/close）+ `case-task-service.ts`（PENDING→IN_PROGRESS→COMPLETED 状态机）+ `case-communication-service.ts`（create）+ `case-types.ts`（DTO/视图）+ `case-factory.ts`（ctx 装配）+ `case-errors.ts`；服务测试 5 例（生命周期/状态机/审计/存在性校验/终态拒）。
3. **Task 3（本报告）**：controller 重构（薄控制器调 service，移除 destroy）+ 路由门禁（+8 条 case 路由全 requirePermission，路由 15→22）+ `errorHandler.ts` 补 **CaseError 分支**（Task 3 实测发现：无此分支 404/409 落 500）+ API 测试 5 例（权限 403/状态机/审计透传/错误码/参数作用域）+ 前端最小列表/详情 + runbook §10 + 本 closeout。

**变更文件（共 6 后端代码 + 4 前端 + 3 文档）**：Task 1 `app/domain/authorization/authorization-types.ts`（+6 码）+ `prisma/migrations/20260805100000_case_permission_provision/migration.sql`（新建）+ `scripts/ci/check-baseline-contract.ts`（迁移 26→27）；Task 2 `app/application/case/`（5 文件新建）+ `app/domain/case/case-errors.ts`（新建）+ `test/case/case-service.test.ts`（新建）；Task 3 `app/controller/case.ts`（重构）+ `app/router.ts`（+8 条）+ `app/middleware/errorHandler.ts`（CaseError 分支）+ `test/app/case-api.test.ts`（新建）+ 前端 `pages/Case/index.tsx`（重写）+ `src/api/business.ts`（caseApi 对齐 PagedResult/去 delete/close 白名单）+ `src/types/index.ts`（Case 对齐 CaseView）+ `src/features/authorization/types.ts`（+6 码）+ 前端测试 `pages/Case/__tests__/CasePage.test.tsx`（新建）；文档 `docs/superpowers/runbooks/finance-operations.md`（§10）+ `docs/superpowers/plans/2026-08-05-case-handling.md`（勾选）+ 本 closeout。

## 2. 工具链

Node test runner（串行 `--test-concurrency=1 --test-force-exit`）/ Vitest + Playwright（前端）/ Node v24.18.0（沿 SPEC-017-032 实证零影响）。测试库 55433 `_test`；**55432 禁触**；ALLOW_TEST_DB_RESET=true；连接串一律 127.0.0.1；skip-pattern 排除 spec-008 排练 3 例 port-55432 锁定件。全程零 git 操作。测试 env 块按项目纪律（占位符口径）。**撞车纪律**：共享 test DB 外来 ACTIVE 连接即不起跑（撞车期间禁跑）；撞车签名=`permission.createMany Unique constraint failed`——撞车失败不计、清净窗重跑为权威。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| case 域服务测试（`test/case/case-service.test.ts`） | **5/5 pass，0 fail**（生命周期/白名单/终态拒/任务状态机/沟通） |
| case API 测试（`test/app/case-api.test.ts`） | **5/5 pass，0 fail**（401 全端点/403 权限/端到端状态机/错误码透传/参数作用域+审计） |
| 前端 Case 页 Vitest（`pages/Case/__tests__/CasePage.test.tsx`） | **6/6 pass，0 fail**（列表渲染/空态/权限门控/新建提交/结案提交） |
| 前端全量 Vitest | **47 files / 226 tests 全绿**（Case 页 +6 净增，零回归） |
| 后端全量串行（清净窗前探起跑） | **run 至 290 tests：288 pass / 2 fail / 0 skip**——2 fail 全系 `trust-root-guard.test.ts` **已知外部漂移**（SPEC-022 起逐 closeout 照录不计：role-grant 权限码期望 vs 实际 PERMISSION_DENIED/PRIVILEGE_ESCALATION_BLOCKED 契约失配，归外部渠道 role-membership 在制）→ **0 真 fail 归 SPEC-033**；因外部通道持续 TRUNCATE 撞车中止，**变更文件清净窗目录级全绿为权威**（沿 SPEC-028/030/031/032/034 全量碰撞纪律） |

### 3.2 文件闸门

| 检查 | 结果 |
|---|---|
| server tsc | **0 err** |
| server eslint（case 域 8 文件 + errorHandler + router） | **0 err** |
| web tsc | **0 err** |
| web eslint（Case 页 + 测试 + business.ts + authorization/types + types） | **0 err** |
| `security:test`（root） | **42/42 pass**（SPEC-034 基线维持） |
| `security:audit:all` / `security:audit:prod`（root） | **server + web 双 passed=true**，production high=0/critical=0 |
| `check:baseline`（27 迁移 / 60 模型） | **pass**（exit 0） |
| `check:bootstrap`（角色契约） | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径——含 runbook §10 + 本 closeout 更新后复扫） |

## 4. 迁移与模型

**结构性变更（本 SPEC 首次业务域结构变更自 SPEC-028 以来）**：迁移 **26→27**（+1 provisioning `20260805100000_case_permission_provision`，仅 `permission` 表 6 行 INSERT，`role_permission` 零触碰）；模型 **60** 不变（Case/CaseTask/Communication 为既有模型）；权限 **123→129**（+6 case 码，catalog 与 provisioning 双源一致；`permission-catalog.test.ts`/`unittest-database.test.ts` 断言 129 通过）；事件 **15** 不变（Case 域不产 outbox 事件）；路由 **15→22**（+8 条 case 路由，全 requirePermission——计划/设计写「+7」系净计数口径，实际新增 8 条：index/show/create/update/close/tasks POST/tasks PATCH/communications POST）。

## 5. 关键裁决记录（D1-D8 + 实施期 ⚠️ 记录）

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限码 | +6：case.read/create/update/close/task.manage/communication.create——catalog + provisioning 迁移 |
| D2 | Case 生命周期 | PENDING→ACCEPTED→PROCESSING→CLOSED→ARCHIVED；create=PENDING；close=PENDING/ACCEPTED/PROCESSING→CLOSED；终态 CLOSED/ARCHIVED 动作拒 |
| D3 | CaseTask 状态机 | PENDING→IN_PROGRESS→COMPLETED（OVERDUE 查询推导不落库）；非法翻转拒 |
| D4 | 审计 | 写操作（create/update/close/task/communication）同事务落 operation_log；读不落 |
| D5 | 校验 | caseNo=makeBusinessNo('CA') 随机码；title/caseType 必填 1-100；customerId/lawyerId/contractId 存在性探针；枚举白名单 |
| D6 | 权限 | 各方法 requireAction 对应码；list/get=case.read；create=case.create；update=case.update；close=case.close；task=case.task.manage；communication=case.communication.create |
| D7 | controller 重构 | 遗留原型逐方法改调 service（薄控制器纪律）——替代直连 prisma；destroy 移除（案件不可删，归档替代） |
| D8 | 前端 | 案件列表 + 详情（最小：列表/详情只读 + 新建/结案）——深度交互归 follow-up |

**实施期 ⚠️ 记录**：

- **编号裁决（SPEC-033 双占用）**：案件办理与安全审计门禁同号 SPEC-033——用户裁决**案件办理 = 033**、安全审计 = **034**（其 plan/design/closeout 已改号，memory 同步）。
- **errorHandler CaseError 分支（Task 3 实测补）**：设计/计划未列 errorHandler，但 API 测试首跑暴露 CaseError（`.httpStatus` 字段）不映射 → 404/409 落 500——补 CaseError 分支（仿 ApprovalError 先例，按实例 httpStatus 透传）。**先例一致**：SPEC-009/010/011/013 各域错误类均在此文件补分支。
- **D2 乐观锁收敛（Case 无 version 列）**：设计「version 乐观锁（updateMany {id, version} → VERSION_CONFLICT 409）」——但 Case 模型无 version 列 → **更新收敛为 last-write-wins + 终态守卫**（updateMany {id, status notIn 终态} count=0 → 409 CASE_STATE_INVALID）。零结构变更（不为此加列）。
- **权限计数口径**：计划/设计「124→130」为估算——实际 catalog 123 +6 = **129**（含外部通道此前在制 +6 中 3 码差异归外部渠道计数核对；129 与 `permission-catalog.test.ts`/`unittest-database.test.ts` 断言一致，零同步改动）。
- **前端遗留原型不可用**：遗留 `pages/Case/index.tsx` 依赖已根除的 `DELETE /cases/:id` + 嵌套 `pagination` 形态 + 嵌套 `customer`/`lawyer` 投影 + create 表单提交 `caseNo`（后端生成，非白名单）→ **重写最小页**（列表/详情/新建/结案；任务/沟通详情只读展示）。
- **权限计数契约同步（清净窗实测补）**：Task 1 迁移/基线同步遗漏 2 处硬编码计数契约——`test/contract/permission-catalog-contract.test.ts:82`（断言 123）与 `test/finance/permission-catalog-finance.test.ts:97`（断言 123）未随 +6 case 码更新 → 清净窗跑批实测失败 → 同步为 **129**（含 SPEC-015 follow-up 1 码 + case 6 码）+ 标题 breakdown 修正（原标题写 122 已陈旧）。`test/authorization/permission-catalog.test.ts`/`approval/permission-catalog-approval.test.ts`/`config/unittest-database.test.ts` 断言 129 本就一致。
- **前端 Case 类型对齐**：`Case` 类型镜像后端 CaseView（customer/lawyer 为 ID 非嵌套；fee 字符串 Decimal；teamIds 字符串数组）——`CostListPage` 案件锚点选择器仅读 id/caseNo/title，零影响。
- **AntD Table dataIndex 坑（实施期发现）**：无 `dataIndex` 的列 `render(value)` 的 `value` 实为整行 record → `?? value` 回退返回对象 → React「Object as child」崩溃——priority/status 列补 `dataIndex` 修复（customer/lawyer 列用 `record` 参数不受影响）。
- **路由 15→22 计数**：+8 条 case 路由（计划/设计「+7」为净计数）；spec-003-router 契约仅覆盖 SPEC-003 路由，零影响。

## 6. 安全审计状态

- `security:test` **42/42**（SPEC-034 基线维持，本 SPEC 零安全变更）。
- `security:audit:all` / `security:audit:prod` **server + web 双 passed=true**，production high=0/critical=0（moderate gate + 基线断言生效，SPEC-034）。
- `check:docs-leakage` exit 0（占位符口径：本 closeout 与 runbook §10 不落真实密钥/连接串口令）。

## 7. 已知非阻断项（照录）

1. **编号双占用已裁决**：案件办理=SPEC-033、安全审计=SPEC-034（plan/design/closeout/memory 已改号）。
2. **D2 乐观锁收敛**：Case 无 version 列 → 更新为 last-write-wins + 终态守卫（无 409 VERSION_CONFLICT 语义，有 409 CASE_STATE_INVALID）——如需乐观锁可 follow-up 加 version 列。
3. **前端深度交互归 follow-up**（D8 范围 OUT）：任务/沟通增改 UI、案件文件/证据、绩效联动——另行专项。
4. **前端锚点映射上限**：详情/列表客户/律师名映射基于 pageSize=100 懒加载子集——超集 ID 回退显示原始 ID（分页为锚点选择器服务，非全量）。
5. **承接既有已知项**：SEC-2026-002（react-router v8）保留观察；前端预存 vitest flake；trust-root-guard 外部漂移（spec-022，归外部渠道）；各 SPEC closeout §9 follow-up。
6. **撞车纪律照录**：全量 run 若受共享 test DB 撞车污染，撞车失败不计、清净窗重跑为权威（runbook §8）。

## 8. 对账项

- **结构性变更对账**：迁移 **27**（+1 provisioning）/模型 **60**（不变）/权限 **129**（+6 case 码，catalog 与 provisioning 双源一致）/事件 **15**（不变）/路由 **22**（+8 case 路由）。`check:baseline`（27/60）+ `check:bootstrap` PASS。
- **权限计数对账**：`permission-catalog.test.ts`/`permission-catalog-approval.test.ts`/`unittest-database.test.ts` 断言 **129**——catalog 实测 129（含 case 六码）→ 全绿；计划/设计估算 124→130 为口径偏差，closeout/runbook 明示。
- **审计对账**：API 写操作落 `operation_log`（CASE_CREATE/UPDATE/CLOSE、CASE_TASK_CREATE/UPDATE、CASE_COMMUNICATION_CREATE），actor=请求用户（API 测试断言 audit.userId）；读不落。
- **错误码对账**：CaseError（`.httpStatus`）经 errorHandler CaseError 分支透传——404 CASE_NOT_FOUND/CASE_TASK_NOT_FOUND、409 CASE_STATE_INVALID/CASE_TASK_STATE_INVALID；校验 400 VALIDATION_FAILED（MasterDataError `.status` 通用分支）。跨案件任务参数作用域（findFirst {id, caseId}）→ 404。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触（spec-008 排练 3 例经 skip-pattern 照录排除）。

## 9. Follow-up 路由（候选专项）

- **案件深度工作流**：多阶段自动推进/审批联动——另行（设计 §7 OUT）。
- **案件乐观锁**：如需并发编辑防护，Case 加 version 列 + updateMany {id, version}（D2 收敛为状态守卫的完整版）。
- **前端深度交互**：任务拖拽/甘特/统计驾驶舱 + 任务/沟通增改 UI——另行（D8 OUT）。
- **案件文件/证据管理**：模型未建——另行。
- **绩效联动**：Performance 模型——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。
- **测试环境指纹**：共享 test DB 撞车禁跑纪律沿用；并行渠道编辑代码文件中窗（permission 文件短暂失配）也会撞车——依赖该模块的全量跑前清净窗。

## 10. 验收链

- **Task 1**：+6 case 权限码（catalog + provisioning 迁移 + PERMISSION_CODES 类型）→ `check:baseline`（27 迁移）PASS + 权限计数断言 129 通过 → Task 2/3 消费。
- **Task 2**：case 服务层 5 测试全绿（create 审计/存在性校验、update 白名单/终态拒、list 过滤分页、close 状态机/重复拒、task 状态机/非法翻转、communication 终态拒）→ tsc/eslint 0。
- **Task 3（本报告）**：API 测试 5 例全绿（401/403/端到端状态机/错误码透传/参数作用域+审计透传）+ 前端 6 例全绿 + 全量 vitest 47/226 全绿 + 后端全量 run 290 tests 288 pass / 2 fail（全系 trust-root-guard 已知外部漂移照录，**0 真 fail 归 SPEC-033**）+ `security:test` 42/42 + audit 双绿 + check:baseline/bootstrap/docs-leakage 全 PASS + runbook §10 + 本 closeout 收口。

## 11. 收官状态

**SPEC-033 案件办理域核心本地闭环（2026-08-05）**：3/3 任务完成（Task 1 case 权限码六枚 + provisioning 迁移 + baseline 同步；Task 2 服务层 Case/CaseTask/Communication 三服务 + 测试；Task 3 controller 重构 + 路由门禁 + errorHandler CaseError 分支 + API 测试 + 前端最小列表/详情 + runbook/closeout 收尾）。**结构性变更**：迁移 **26→27** / 模型 60 不变 / 权限 **123→129**（+6 case 码）/ 事件 15 不变 / 路由 **15→22**（+8 条 requirePermission）。**编号裁决**：案件办理 = SPEC-033、安全审计门禁 = SPEC-034（后者已改号）。聚焦验证：case 域 **10/10**（服务 5 + API 5）+ 前端 **6/6** + 全量 vitest **47/226** 全绿 + `security:test` **42/42** + `security:audit:all`/`prod` 双绿 + check:baseline（27/60）+ check:bootstrap + check:docs-leakage + web build 全 PASS。后端全量 run 290 tests：**288 pass / 2 fail（trust-root-guard 已知外部漂移照录，0 真 fail 归 SPEC-033）**——外部通道持续 TRUNCATE 撞车中止，变更文件清净窗目录级全绿为权威（沿 SPEC-028/030/031/032/034 全量碰撞纪律）。实施期 ⚠️ 记录 §5（编号裁决 / errorHandler CaseError 分支 / D2 乐观锁收敛 / 权限计数口径 / 前端重写 / AntD dataIndex 坑），已知非阻断 §7，follow-up §9。按项目约束零 git 操作，本地闭环。
