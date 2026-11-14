# SPEC-037 绩效模块正规化（Performance Regularization）— 收尾报告

日期：2026-08-05 ｜ 需求来源：绩效模块为**遗留原型**（controller 直连 ctx.prisma、无权限门禁/校验/审计/测试，与 SPEC-033 前案件域同状态）——用户「需要」确认按推荐续做 ｜ 前置：SPEC-004（RBAC + provisioning 纪律）、SPEC-033（案件域正规化模式先例）
注：**编号重定**——立项时自号 SPEC-036，实施中外部渠道 audit-exception-approval 占用 **SPEC-036**（其 closeout 已落地、memory 已记录）→ 本专项改编号 **SPEC-037**（plan/design 文档同步更新；沿「编号被 closed 工作流占用即自改号」惯例，SPEC-034 先例）。

## 1. 交付范围

绩效模块（`Performance` 模型 + 遗留原型 controller + 前端原型页）**正规化**——仿 SPEC-033 案件域：+performance 权限码 + 服务层（create/list/get/confirm）+ controller 薄重构 + 路由门禁 + 测试 + 前端最小。**结构性变更**（迁移 28→**29**，provisioning；权限 129→**132**；路由 22→**26**；模型 60/事件 15 不变）。

1. **Task 1（权限码 + provisioning）**：`PERMISSION_CODES` +3（performance.read/create/confirm）+ `RESOURCE_CODES` +'performance' + provisioning 迁移 `20260805120000_performance_provision`（3 行 `permission` INSERT ON CONFLICT DO NOTHING）+ baseline 同步（迁移计数 28→29；权限计数断言 129→**132** 五处：authorization/approval/contract/finance/unittest-database）。
2. **Task 2（服务层）**：`performance-service.ts`（createPerformance——校验 employeeId 存在/period `^\d{4}-\d{2}$`/type 枚举/kpiData JSON/score/bonus 非负 Decimal + 唯一探针 employeeId+period+type → 409 PERFORMANCE_DUPLICATE + 审计；listPerformances——过滤+分页 PagedResult；getPerformance——详情含 employee 主职投影；confirmPerformance——PENDING→CONFIRMED 终态 + 审计）+ `performance-types.ts` + `performance-factory.ts` + `performance-errors.ts`；服务测试 4 例。
3. **Task 3（本报告）**：controller 薄重构（替代原型直连 prisma）+ `errorHandler.ts` +PerformanceError 分支 + 路由门禁（+4 requirePermission）+ API 测试 4 例 + 前端最小列表/详情/录入/确认 + 闸门 + runbook §11 + 本 closeout。

**变更文件（共 8 后端 + 3 前端 + 3 测试 + 3 文档）**：Task 1 `authorization-types.ts`（+3 码 +'performance' 资源）+ `permission-catalog.ts`（+3 条目）+ `20260805120000_performance_provision/migration.sql` + `check-baseline-contract.ts`（29）+ 5 处计数断言；Task 2 `app/application/performance/`（3 文件）+ `app/domain/performance/performance-errors.ts` + `test/performance/performance-service.test.ts`；Task 3 `app/controller/performance.ts` + `app/middleware/errorHandler.ts` + `app/router.ts` + `test/app/performance-api.test.ts` + 前端 `pages/Performance/index.tsx`（重写）+ `features/authorization/types.ts`（+3 码）+ `types/index.ts`（Performance 对齐）+ `api/organization.ts`（PagedResult）+ `pages/Performance/__tests__/PerformancePage.test.tsx`（新建）+ runbook §11 + 本 closeout。

## 2. 工具链

Node test runner（串行 `--test-concurrency=1 --test-force-exit`）/ Vitest + Playwright（前端）/ Node v24.18.0。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true；127.0.0.1；skip-pattern 排除 spec-008 排练 3 例。全程零 git 操作。撞车纪律沿用（清净窗 + 撞车不计）。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| performance 服务测试（`test/performance/performance-service.test.ts`） | **4/4 pass**（create 校验/唯一 409/审计、list 过滤分页、get 详情+投影、confirm 状态机/重复拒） |
| performance API 测试（`test/app/performance-api.test.ts`） | **4/4 pass**（401/403 权限/端到端+审计透传/错误码透传 404/409/400） |
| 前端 Performance 页 Vitest（`PerformancePage.test.tsx`） | **4/4 pass**（列表渲染/权限门控/录入提交/确认调用） |
| 前端全量 Vitest | **48 files / 233 tests 全绿**（Performance 页 +4 净增，零回归） |

### 3.2 文件闸门

| 检查 | 结果 |
|---|---|
| server tsc + eslint（performance 域 + errorHandler + router） | **0 err** |
| web tsc + eslint（Performance 页 + 测试 + types + authorization） | **0 err** |
| web build（`tsc -b` + vite） | **exit 0** |
| `security:test`（root） | **49/49 pass**（含外部渠道 SPEC-036 audit-exception +7） |
| `security:audit:all`（root） | **server + web 双 passed=true** |
| `check:baseline`（**29 迁移** / 60 模型） | **pass**（exit 0） |
| `check:bootstrap` | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**结构性变更**：迁移 **28→29**（+1 provisioning `20260805120000_performance_provision`——3 行 `permission` INSERT，role_permission 零触碰）；模型 **60** 不变；权限 **129→132**（+3，catalog + provisioning 双源一致）；事件 **15** 不变；路由 **22→26**（+4 requirePermission）。`check:baseline` 迁移 29 / 计数断言 132 已同步。

## 5. 关键裁决记录（D1-D8 + 实施期 ⚠️ 记录）

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限码 | +3：performance.read / performance.create / performance.confirm |
| D2 | 状态机 | create=PENDING；confirm=PENDING→CONFIRMED（终态，重复确认 409 PERFORMANCE_STATE_INVALID） |
| D3 | 校验 | employeeId 存在探针；period `^\d{4}-\d{2}$`；type 枚举 MONTHLY/QUARTERLY/YEARLY；kpiData 合法 JSON（≤2000，缺省 '{}'）；score/bonus 非负 Decimal；remark ≤500 |
| D4 | 唯一约束 | employeeId+period+type 已存在 → 409 PERFORMANCE_DUPLICATE（探针先查，非 P2002 500） |
| D5 | 审计 | create/confirm 同事务落 operation_log（PERFORMANCE_CREATE/CONFIRM，targetType PERFORMANCE）；读不落 |
| D6 | 错误类 | PerformanceError（code/httpStatus/message）+ errorHandler 分支（仿 CaseError 先例） |
| D7 | controller 重构 | 遗留原型逐方法改调 service（薄控制器纪律） |
| D8 | 前端 | 最小：列表（类型过滤+分页）+ 详情抽屉 + 录入（员工/周期/类型/KPI/分数/奖金）+ 确认；type/status 枚举对齐后端 |

**实施期 ⚠️ 记录**：

- **编号重定（SPEC-036→037）**：外部渠道 audit-exception-approval 占用 SPEC-036（closed）→ 本专项改 **SPEC-037**；plan/design/代码注释/closeout 全量改号；外部渠道文件零触碰（已核）。
- **前端枚举漂移对齐**：遗留原型 `typeMap` 含 ANNUAL/PROJECT（后端模型仅 YEARLY/MONTHLY/QUARTERLY）+ `statusMap` 含 DRAFT（后端仅 PENDING/CONFIRMED）→ 重写对齐；遗留 `keyword` 搜索（后端无该过滤，会 400）移除；无后端 update 的假编辑（"更新功能需后端支持"）移除。
- **前端遗留数据形态对齐**：遗留读嵌套 `pagination`（后端 PagedResult 扁平）→ 改 `res.data.list/total`；score/bonus 数字 → 字符串 Decimal；employee 投影（organization 移除、primaryAssignment 增补）→ 列表/详情改用 employeeId→姓名映射。
- **AntD Table dataIndex 坑**：type/score/bonus/status 列缺 dataIndex → `render(value)` 的 value 实为整行 record → React「Object as child」崩溃（与 SPEC-033/035 Case 页同坑）→ 补 dataIndex 修复。
- **check-baseline 迁移计数 + 权限计数契约同步**：迁移 28→29 + 权限 129→132 五处断言同步（含 contract/finance 标题 breakdown）。
- **服务测试形态**：唯一探针先查（避免唯一约束 P2002 落 500）；审计断言 actor=请求用户。

## 6. 安全审计状态

- `security:test` **49/49**（含外部渠道 SPEC-036 +7；本 SPEC 零安全变更）。
- `security:audit:all` **server + web 双 passed=true**，production high=0/critical=0。
- `check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **编号重定**：绩效正规化 = SPEC-037（外部渠道已占 036 audit-exception）。
2. **绩效评分/考核流程未建**：模型仅 score/bonus 手工录入——目标设定/自评/主管评归 follow-up（设计 §7 OUT）。
3. **绩效与案件/财务联动**：结案案件数、回款额驱动绩效——另行（设计 §7 OUT）。
4. **前端深度**（绩效驾驶舱/趋势图/对比）——另行（设计 §7 OUT）。
5. **承接既有已知项**：trust-root-guard ×2 外部漂移（SPEC-022，归外部渠道）；SEC-2026-002（react-router v8）保留观察；前端预存 vitest flake。

## 8. 对账项

- **结构性变更对账**：迁移 **29**（+1 provisioning）/模型 60/权限 **132**（+3）/事件 15/路由 **26**（+4 requirePermission）——`check:baseline`（29/60）+ `check:bootstrap` PASS。
- **权限计数对账**：catalog 132 = provisioning 132 = 断言 132（五处同步）；`RESOURCE_CODES` +'performance'。
- **审计对账**：PERFORMANCE_CREATE/CONFIRM 落 operation_log（targetType PERFORMANCE），actor=请求用户；读不落。
- **错误码对账**：PerformanceError（`.httpStatus`）经 errorHandler 分支透传——404 PERFORMANCE_NOT_FOUND / 409 PERFORMANCE_STATE_INVALID / 409 PERFORMANCE_DUPLICATE；校验 400 VALIDATION_FAILED（MasterDataError）。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触。

## 9. Follow-up 路由（候选专项）

- **绩效考核流程**：目标设定/自评/主管评（模型扩展）——另行。
- **绩效与案件/财务联动**：案件办结数、回款额驱动绩效——另行。
- **绩效前端驾驶舱**：趋势图/对比/排行——另行。
- **绩效乐观锁**：并发编辑防护（沿 SPEC-035 Case 先例，如需要）。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。

## 10. 验收链

- **Task 1（权限码 + provisioning）**：+3 码 +'performance' 资源 + provisioning 迁移 + baseline/断言同步 → `check:baseline`（29/60）PASS + 计数断言 132 全绿。
- **Task 2（服务层）**：performance-service 4 方法 + 校验/审计/唯一探针 → 服务 4/4 + tsc/eslint 0。
- **Task 3（本报告）**：controller 薄重构 + errorHandler 分支 + 路由门禁 + API 4/4 + 前端 4/4 + 全量 vitest + `security:test` 49/49 + audit 双绿 + check:baseline/bootstrap/docs-leakage + web build 全 PASS + runbook §11 + 本 closeout 收口。

## 11. 收官状态

**SPEC-037 绩效模块正规化本地闭环（2026-08-05）**：3/3 任务完成（Task 1 performance 权限码三枚 + provisioning 迁移 + baseline 同步；Task 2 服务层 create/list/get/confirm + 校验/审计/唯一探针 + 测试；Task 3 controller 薄重构 + errorHandler PerformanceError 分支 + 路由门禁 + API 测试 + 前端最小列表/详情/录入/确认 + runbook/closeout 收尾）。**结构性变更**：迁移 **28→29** / 模型 60 / 权限 **129→132**（+3）/ 事件 15 / 路由 **22→26**（+4 requirePermission）。**编号重定**：本专项 SPEC-036→**SPEC-037**（外部渠道已占 036 audit-exception）。聚焦验证：performance **8/8**（服务 4 + API 4）+ 前端 **4/4** + `security:test` **49/49** + `security:audit:all` 双绿 + check:baseline（**29/60**）+ check:bootstrap + docs-leakage + web build 全 PASS；全量 vitest **48 files/233**。实施期 ⚠️ §5（编号重定 / 前端枚举/形态对齐 / AntD dataIndex 坑 / 计数契约同步），已知非阻断 §7，follow-up §9。按项目约束零 git 操作，本地闭环。
