# SPEC-035 案件办理域收尾（Case 乐观锁 + 前端任务/沟通交互）— 收尾报告

日期：2026-08-05 ｜ 需求来源：SPEC-033 closeout §9 follow-up 推荐（按用户指示「按你推荐，继」续做）——D2「version 乐观锁」因 Case 无 version 列收敛为终态守卫 + D8 前端深度交互（任务/沟通增改 UI）范围 OUT ｜ 用户授权自主推进 ｜ 前置：SPEC-033（案件办理域核心）
注：**编号**——SPEC-033 案件办理核心 / SPEC-034 安全审计门禁 / 本专项 **SPEC-035**（无撞号）。

## 1. 交付范围

补全 SPEC-033 D2/D8 范围 OUT 两项：**① Case 乐观锁**（Case +version 列 → updateCase 必填 version `updateMany {id, version}` → 409 VERSION_CONFLICT，并发编辑防护）；**② 前端任务/沟通交互**（详情抽屉内任务新建 + 状态翻转 + 沟通新建，案件域端到端可用）。**结构性变更**（迁移 27→**28**，加列；模型 60/权限 129/事件 15/路由 22 不变）。

1. **Task 1（Case version 乐观锁）**：`schema.prisma` Case +`version Int @default(1)` + 迁移 `20260805110000_case_version_column`（ALTER TABLE 加列，NOT NULL DEFAULT 1 零回填）+ `case-types.ts`（UpdateCaseInput +version/CaseView +version）+ `case-service.ts updateCase` 改乐观锁（assertExactKeys +version；先读现状 404/终态判；`updateMany {id, version, status notIn 终态}` count=0 → 404/409 CASE_STATE_INVALID/**409 VERSION_CONFLICT**；成功 version+1）+ `case-errors.ts` +`CASE_VERSION_CONFLICT: 'VERSION_CONFLICT'`（消息与成本域对齐）+ `controller/case.ts` UPDATE_CASE_BODY_KEYS +version + 服务测试/API 测试。
2. **Task 2（前端任务/沟通交互）**：`pages/Case/index.tsx` 详情抽屉——「新建任务」Modal（name/nodeType/dueDate/remark，`case.task.manage` 门控）+ 任务行状态翻转按钮（PENDING「开始办理」→IN_PROGRESS「完成」→COMPLETED）+「新增沟通」Modal（type/content/isKey，`case.communication.create` 门控）；操作后 `openDetail(detail)` 重拉全量；`CaseTask` 类型对齐后端（null 字段 + createdAt/updatedAt）；测试 +3。
3. **Task 3（本报告）**：闸门（case 域清净窗 + 全量 vitest + security/check/docs-leakage + web build）+ runbook §10 更新 + 本 closeout。

**变更文件（共 5 后端 + 2 前端 + 2 文档 + 3 测试）**：Task 1 `apps/server/prisma/schema.prisma` + `prisma/migrations/20260805110000_case_version_column/migration.sql`（新建）+ `app/application/case/case-types.ts` + `app/application/case/case-service.ts` + `app/domain/case/case-errors.ts` + `app/controller/case.ts` + `test/case/case-service.test.ts` + `test/app/case-api.test.ts` + `scripts/ci/check-baseline-contract.ts`（迁移 27→28）；Task 2 `apps/web/src/pages/Case/index.tsx` + `apps/web/src/types/index.ts`（CaseTask 对齐）+ `apps/web/src/pages/Case/__tests__/CasePage.test.tsx`；文档 runbook §10 + 本 closeout + plan/design。

## 2. 工具链

Node test runner（串行 `--test-concurrency=1 --test-force-exit`）/ Vitest + Playwright（前端）/ Node v24.18.0。测试库 55433 `_test`；**55432 禁触**；ALLOW_TEST_DB_RESET=true；连接串一律 127.0.0.1；skip-pattern 排除 spec-008 排练 3 例。全程零 git 操作。**撞车纪律**：共享 test DB 外来 ACTIVE 连接即不起跑；撞车失败不计、清净窗重跑为权威。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| case 域服务测试（`test/case/case-service.test.ts`） | **6/6 pass，0 fail**（原 5 例 + 乐观锁 VERSION_CONFLICT/缺 version 400） |
| case API 测试（`test/app/case-api.test.ts`） | **6/6 pass，0 fail**（原 5 例 + 乐观锁透传/缺 version 400/create 视图 version 1） |
| 前端 Case 页 Vitest（`CasePage.test.tsx`） | **9/9 pass，0 fail**（原 6 例 + 任务创建/任务状态翻转/沟通创建） |
| 前端全量 Vitest | **47 files / 229 tests 全绿**（+3 交互用例，零回归） |

### 3.2 文件闸门

| 检查 | 结果 |
|---|---|
| server tsc + eslint（case 域 5 文件 + controller + check-baseline） | **0 err** |
| web tsc + eslint（Case 页 + 测试 + types） | **0 err** |
| web build（`tsc -b` + vite） | **exit 0** |
| `security:test`（root） | **42/42 pass** |
| `security:audit:all` / `security:audit:prod`（root） | **server + web 双 passed=true**，production high=0/critical=0 |
| `check:baseline`（**28 迁移** / 60 模型） | **pass**（exit 0） |
| `check:bootstrap` | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**结构性变更**：迁移 **27→28**（+1 `20260805110000_case_version_column`——`ALTER TABLE "case" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1`，纯加列零回填）；模型 **60** 不变（加列非新模型）；权限 **129** 不变（零新码）；事件 **15** 不变；路由 **22** 不变。`check:baseline` 迁移计数 27→28 已同步。

## 5. 关键裁决记录（D1-D5 + 实施期 ⚠️ 记录）

| # | 决策 | 值 |
|---|---|---|
| D1 | Case +version 列 | `version Int @default(1)`（迁移 27→28） |
| D2 | updateCase 乐观锁 | 必填 `version` → `updateMany {id, version, status notIn 终态}` count=0 → 404/409 CASE_STATE_INVALID/**409 VERSION_CONFLICT**；成功 version+1 |
| D3 | closeCase 不变 | 保持终态守卫（设计 D2 仅要求 update 乐观锁） |
| D4 | 前端任务/沟通交互 | 详情抽屉：任务新建 Modal + 状态翻转（PENDING→IN_PROGRESS→COMPLETED）+ 沟通新建 Modal；case.task.manage / case.communication.create 门控 |
| D5 | 权限复用 | 沿用 SPEC-033 case 六码，零新码 |

**实施期 ⚠️ 记录**：

- **D2 补全（SPEC-033 收敛项的完整版）**：SPEC-033 因 Case 无 version 列将乐观锁收敛为终态守卫——本 SPEC 加 version 列补全设计意图；close 保持终态守卫（终态动作并发风险低，version 语义不引入）。
- **VERSION_CONFLICT 消息对齐**：`CASE_VERSION_CONFLICT` 码值设为 `'VERSION_CONFLICT'`（非 CASE_ 前缀）——与成本域 `VERSION_CONFLICT` 消息一致（前端拦截器 409 统一语义）。
- **AntD Select 虚拟化坑（实施期发现）**：nodeType/沟通方式 Select 缺省虚拟化——jsdom 无真实布局时 rc-select 虚拟列表选项点击不注册选择（combobox 值空）→ 补 `virtual={false}`（8/5 选项小列表，合理生产配置，沿 CostListPage 非虚拟先例）。
- **前端 CaseTask 类型对齐**：web `CaseTask` 原为可选 string（无 null/createdAt/updatedAt）——后端 CaseTaskView 返回 null + createdAt/updatedAt → 对齐（`dueDate?/completedAt?/remark?: string | null` + `createdAt/updatedAt: string`）；`tsc -b` 构建捕获（隔离 `tsc --noEmit` 未覆盖 Dashboard 类似路径——本页测试 fixture 的 null 字面量触发）。
- **check:baseline 迁移计数同步**：SPEC-035 加迁移 → `CANONICAL_PRISMA_MIGRATION_COUNT` 27→28（Task 3 闸门实测前同步）。
- **组合跑批撞车（照录非回归）**：case-service + case-api 组合清净窗前探起跑后外部通道 TRUNCATE 撞车 → 2 例瞬态失败（requires-authentication/端到端），隔离清净窗复跑 **12/12 全绿**（撞车签名 `permission.createMany` 竞态，按 §8 纪律不计）。
- **乐观锁测试形态**：服务层 +2（stale version → VERSION_CONFLICT 409 / 缺 version 400）；API 层 +1（乐观锁透传 + 缺 version 400 + create 视图 version 1）——确定性构造（先推进 version、客户端持旧 version 调用 → 409），无时序竞争。

## 6. 安全审计状态

- `security:test` **42/42**（SPEC-034 基线维持，本 SPEC 零安全变更）。
- `security:audit:all` / `security:audit:prod` **server + web 双 passed=true**，production high=0/critical=0。
- `check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **closeCase 无 version 语义**：设计 D2 仅要求 update 乐观锁；close 为终态动作保持终态守卫——如需并发 close 防护可 follow-up。
2. **前端锚点映射上限**：客户/律师名映射基于 pageSize=100 懒加载子集（沿用 SPEC-033 已知项）。
3. **前端深度交互余项**（D8 范围 OUT 续）：任务拖拽/甘特/统计驾驶舱——另行。
4. **案件文件/证据管理 + 绩效联动**：模型未建——另行。
5. **承接既有已知项**：trust-root-guard ×2 外部漂移（SPEC-022，归外部渠道）；SEC-2026-002（react-router v8）保留观察；前端预存 vitest flake。

## 8. 对账项

- **结构性变更对账**：迁移 **28**（+1 version 列）/模型 60/权限 129/事件 15/路由 22 全不变——`check:baseline`（28/60）+ `check:bootstrap` PASS。
- **乐观锁语义对账**：updateCase `updateMany {id, version, status notIn 终态}`——count=0 三分支（404 不存在 / 409 CASE_STATE_INVALID 终态 / 409 VERSION_CONFLICT stale）；与成本域 cost-service 乐观锁同构（消息 `VERSION_CONFLICT` 对齐）。createCase 视图 version=1 起算；updateCase 成功 version+1。
- **审计对账**：CASE_UPDATE 审计 newValues 含 version（`{caseId, caseNo, version}`）；其余写操作审计沿用 SPEC-033。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触。

## 9. Follow-up 路由（候选专项）

- **案件深度工作流**：多阶段自动推进/审批联动——另行。
- **案件并发 close 防护**：closeCase 如需 version 语义（终态并发）——可 follow-up。
- **前端深度交互**：任务拖拽/甘特/统计驾驶舱——另行。
- **案件文件/证据管理 + 绩效联动**：模型未建——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。
- **测试环境指纹**：共享 test DB 撞车禁跑纪律沿用（本 SPEC 实证组合跑批撞车 + 隔离复跑全绿）。

## 10. 验收链

- **Task 1（Case 乐观锁）**：schema +version 列 + 迁移 28 + updateCase 乐观锁（必填 version → VERSION_CONFLICT 409）+ 视图/入参透传 → 服务 6/6 + API 6/6 清净窗全绿 → tsc/eslint 0。
- **Task 2（前端交互）**：详情抽屉任务新建/状态翻转/沟通新建 + 权限门控 + `virtual={false}` → 前端 9/9 + 全量 vitest 47/229 全绿 + web build exit 0。
- **Task 3（本报告）**：case 域清净窗 12/12 + 全量 vitest 229 + `security:test` 42/42 + audit 双绿 + check:baseline（28/60）+ check:bootstrap + docs-leakage + web build 全 PASS + runbook §10 更新 + 本 closeout 收口。后端全量串行清净窗实测结果（撞车分类按 §8 纪律，0 真 fail 预期）见 §11。

## 11. 收官状态

**SPEC-035 案件办理域收尾本地闭环（2026-08-05）**：3/3 任务完成（Task 1 Case version 乐观锁——D2 补全；Task 2 前端任务/沟通交互——D8 补全；Task 3 闸门 + runbook §10 + closeout）。**结构性变更**：迁移 **27→28**（+version 列）/模型 60/权限 129/事件 15/路由 22 不变。聚焦验证：case 域 **12/12**（服务 6 + API 6）+ 前端 **9/9** + 全量 vitest **47 files/229** + `security:test` **42/42** + audit 双绿 + check:baseline（**28/60**）+ check:bootstrap + docs-leakage + web build 全 PASS。**后端全量串行**：清净窗前探起跑后，外部通道编辑 permission 文件（catalog/codes 短暂失配）→ **361 文件级模块加载失败级联**（12-16ms 快败，全为 permission-catalog 系文件）——**非 SPEC-035 回归**；起跑时 catalog/codes 已复核一致（129=129，零 missing/extra），失败为瞬时中窗撞车（SPEC-034 §7 run1 同签名），变更文件清净窗目录级全绿为权威（沿 SPEC-028/030/031/032/033/034 纪律）。实施期 ⚠️ §5（D2 补全 / VERSION_CONFLICT 对齐 / AntD Select 虚拟化 / CaseTask 类型对齐 / check-baseline 迁移计数 / 撞车照录），已知非阻断 §7，follow-up §9。按项目约束零 git 操作，本地闭环。
