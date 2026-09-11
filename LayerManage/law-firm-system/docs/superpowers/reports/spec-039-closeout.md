# SPEC-039 客户复购与转介绍业务流程（Referral Workflow）— 收尾报告

日期：2026-08-05 ｜ 需求来源：业务链最后一步「客户复购与转介绍」——SPEC-032 只做了分析指标，转介绍登记流程与客户转介绍视图未建 ｜ 用户授权自主推进（「按你的推荐继续」）｜ 前置：SPEC-009（线索 CRM/客户主数据——referral 基础设施已建）、SPEC-032（客户经营分析）
注：**编号重定**——立项时自号 SPEC-038，实施中外部渠道 sec-2026-001-retirement 占用 **SPEC-038**（其 closeout 已落地、memory 已记录）→ 本专项改编号 **SPEC-039**（沿「编号被 closed 工作流占用即自改号」惯例）。

## 1. 交付范围

业务链最后一步「客户复购与转介绍」的**转介绍业务流程**——客户详情登记转介绍（REFERRAL 线索）+ 客户转介绍线索列表 + 前端集成。复购为派生指标（合同数>1），沿用 SPEC-032。**零结构变更**（迁移 29/模型 60/权限 132/事件 15 全不变；路由 26→**28** +2）。

1. **Task 1（转介绍后端流程）**：`lead-service.createReferralLead(customerId, input)`（校验客户存在 404 + **强制** sourceType=REFERRAL + referralCustomerId 绑定 → 委托 createLead 去重信号/幂等/事件复用）+ `listReferrals(customerId, query)`（客户存在 404 + 过滤 referralCustomerId + sourceType REFERRAL + 分页）+ `lead-errors.ts` +`CUSTOMER_NOT_FOUND`（404）+ `controller/customer.ts` +`createReferral`/`listReferrals` + `router.ts` +2 条；服务测试 2 例。
2. **Task 2（前端客户转介绍）**：`api/customer.ts` +`createReferral`/`listReferrals` + `api/types.ts` +`CreateReferralLeadInput` + `pages/customers/CustomerDetailPage.tsx` 转介绍区（登记转介绍 Modal：姓名/电话/微信/意向度 + 转介绍线索列表，`lead.create`/`lead.read` 门控）；前端测试 +3。
3. **Task 3（本报告）**：API 测试 4 例 + 闸门 + runbook §12 + 本 closeout。

**变更文件（共 5 后端 + 4 前端 + 2 测试 + 3 文档）**：Task 1 `lead-service.ts` + `lead-types.ts` + `lead-errors.ts` + `controller/customer.ts` + `router.ts` + `test/crm/referral-service.test.ts`；Task 2 `api/customer.ts` + `api/types.ts` + `pages/customers/CustomerDetailPage.tsx` + `pages/customers/__tests__/CustomerDetailPage.test.tsx`；Task 3 `test/app/referral-api.test.ts` + runbook §12 + 本 closeout。

## 2. 工具链

Node test runner（串行 `--test-concurrency=1 --test-force-exit`）/ Vitest + Playwright（前端）/ Node v24.18.0。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true；127.0.0.1；skip-pattern 排除 spec-008 排练 3 例。全程零 git 操作。撞车纪律沿用。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| referral 服务测试（`test/crm/referral-service.test.ts`） | **2/2 pass**（createReferralLead 客户 404/强制 REFERRAL 绑定/403；listReferrals 过滤分页/404/403） |
| referral API 测试（`test/app/referral-api.test.ts`） | **4/4 pass**（401/403/端到端登记+列表/错误码透传 404/400） |
| 前端 CustomerDetailPage Vitest | **5/5 pass**（原 2 例 + 转介绍列表渲染/登记提交/权限门控 3 例） |
| 前端全量 Vitest | **48 files / 236 tests 全绿**（CustomerDetailPage +3 净增，零回归） |

### 3.2 文件闸门

| 检查 | 结果 |
|---|---|
| server tsc + eslint（crm 域 + customer 控制器 + router + 测试） | **0 err** |
| web tsc + eslint（CustomerDetailPage + api + types + 测试） | **0 err** |
| web build（`tsc -b` + vite） | **exit 0** |
| `security:test`（root） | **49/49 pass** |
| `security:audit:all`（root） | **server + web 双 passed=true** |
| `check:baseline`（29 迁移 / 60 模型） | **pass**（exit 0） |
| `check:bootstrap` | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零结构变更**：迁移 **29** / 模型 **60** / 权限 **132** / 事件 **15** 全不变；路由 **26→28**（+2：`POST`/`GET /api/v1/customers/:id/referrals`）。复用既有 `lead.create`/`lead.read` 权限，零新码；复用 lead 事件（LEAD_CREATED）与公海记录语义。

## 5. 关键裁决记录（D1-D5 + 实施期 ⚠️ 记录）

| # | 决策 | 值 |
|---|---|---|
| D1 | 转介绍登记 | `createReferralLead(customerId, input)`——客户存在 404 `CUSTOMER_NOT_FOUND` + 强制 `sourceType=REFERRAL` + `referralCustomerId=customerId`（防伪造）→ 委托 createLead（去重信号/幂等/事件复用）；权限 `lead.create` |
| D2 | 客户转介绍列表 | `listReferrals(customerId, query)`——客户存在 404 + 过滤 `referralCustomerId` + `sourceType REFERRAL` + 分页 `PagedResult<LeadView>`；权限 `lead.read` |
| D3 | controller + 路由 | `controller/customer.ts` +`createReferral`/`listReferrals`；路由 +2 → 26→28 |
| D4 | 前端 | 客户详情转介绍区——登记 Modal + 线索列表 + 经营分析卡衔接；lead.create/lead.read 门控 |
| D5 | 零结构变更 | 迁移/模型/权限/事件全不变（复用 lead 权限，零新码）；路由 26→28 |

**实施期 ⚠️ 记录**：

- **编号重定（SPEC-038→039）**：外部渠道 sec-2026-001-retirement 占用 SPEC-038（closed）→ 本专项改 **SPEC-039**；plan/design/代码注释/closeout 全量改号；外部渠道文件零触碰（已核）。
- **D2 权限口径（设计修正）**：列表端点原设计挂 `customer.read`——返回 LeadView（lead 资源），字段投影按 lead 字段权限 → 改挂 **`lead.read`**（语义更正确，避免 customer.read actor 无 lead 字段可见性）。
- **转介绍登记返回形态**：`POST /customers/:id/referrals` 返回 `CreateLeadResult` `{ lead, duplicates }`（与 `POST /leads` 一致）——API 测试按 `data.lead.*` 断言。
- **事件/公海语义复用**：转介绍登记走 lead 创建全链路（LEAD_CREATED 事件 + 公海 PUBLIC + 去重信号）——非独立实体，无缝融入线索池。
- **前端 set-state-in-effect**：转介绍列表拉取在 effect 内同步 setState → 微任务推迟（沿 Case/Performance 页纪律）。

## 6. 安全审计状态

- `security:test` **49/49**（本 SPEC 零安全变更）。
- `security:audit:all` **server + web 双 passed=true**，production high=0/critical=0。
- `check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **编号重定**：转介绍流程 = SPEC-039（外部渠道已占 038 sec-2026-001-retirement）。
2. **转介绍激励/佣金核算**：模型未建——另行（设计 §6 OUT）。
3. **转介绍线索深度漏斗**（转介绍→邀约→成交归因链）——另行（设计 §6 OUT）。
4. **复购为派生指标**：合同数>1 推导（SPEC-032），无独立动作——设计 §6 OUT。
5. **承接既有已知项**：trust-root-guard ×2 外部漂移（SPEC-022，归外部渠道）；SEC-2026-002（react-router v8）保留观察；前端预存 vitest flake。

## 8. 对账项

- **零结构变更对账**：迁移 29/模型 60/权限 132/事件 15 全不变；路由 **28**（+2 requirePermission）——`check:baseline`（29/60）+ `check:bootstrap` PASS。
- **权限复用对账**：`lead.create`（转介绍登记）/ `lead.read`（转介绍列表）——零新码；`CUSTOMER_NOT_FOUND` 为 CrmError 码（errorHandler CrmError 分支已存在，404 透传）。
- **事件/公海对账**：转介绍登记产 LEAD_CREATED 事件 + 公海 PUBLIC 记录 + 去重信号（沿 POST /leads 语义）；列表过滤 `sourceType REFERRAL` + `referralCustomerId` + `deletedAt null`。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触。

## 9. Follow-up 路由（候选专项）

- **转介绍激励/佣金核算**：转介绍成单返佣（模型未建）——另行。
- **转介绍深度漏斗**：转介绍→邀约→成交归因链（统计驾驶舱）——另行。
- **复购预警**：临近复购周期客户提醒（基于合同到期）——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。

## 10. 验收链

- **Task 1（转介绍后端）**：createReferralLead（客户 404/强制 REFERRAL 绑定/去重委托）+ listReferrals（过滤分页/404）+ CUSTOMER_NOT_FOUND → 服务 2/2 + tsc/eslint 0。
- **Task 2（前端）**：客户详情转介绍区（登记 Modal + 线索列表 + 门控）→ CustomerDetailPage 5/5 + tsc/eslint/build 0。
- **Task 3（本报告）**：API 4/4 + 全量 vitest + `security:test` 49/49 + audit 双绿 + check:baseline/bootstrap/docs-leakage + web build 全 PASS + runbook §12 + 本 closeout 收口。

## 11. 收官状态

**SPEC-039 客户复购与转介绍业务流程本地闭环（2026-08-05）**：3/3 任务完成（Task 1 转介绍后端流程——createReferralLead 强制 REFERRAL 语义 + listReferrals + CUSTOMER_NOT_FOUND；Task 2 前端客户详情转介绍区——登记 Modal + 线索列表 + 门控；Task 3 API 测试 + 闸门 + runbook §12 + closeout）。**零结构变更**：迁移 29/模型 60/权限 132/事件 15 全不变；路由 **26→28**（+2）。**编号重定**：本专项 SPEC-038→**SPEC-039**（外部渠道已占 038 sec-2026-001-retirement）。聚焦验证：referral 服务 **2/2** + API **4/4** + 前端 CustomerDetailPage **5/5** + `security:test` **49/49** + `security:audit:all` 双绿 + check:baseline（29/60）+ check:bootstrap + docs-leakage + web build 全 PASS；全量 vitest **48 files/236**。实施期 ⚠️ §5（编号重定 / D2 权限口径 / 返回形态 / 事件复用 / set-state-in-effect），已知非阻断 §7，follow-up §9。**业务链「客户复购与转介绍」实际流程补齐——全链路端到端可用**。按项目约束零 git 操作，本地闭环。
