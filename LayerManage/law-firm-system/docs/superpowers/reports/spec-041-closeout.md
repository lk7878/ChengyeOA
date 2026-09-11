# SPEC-041 审批表达式审批人 + 直属上级规则（SUPERVISOR Approver）— 收尾报告

日期：2026-08-05 ｜ 需求来源：审批中心已建（SPEC-013~025），approverRule 仅支持 USER/ROLE 两型，无法按申请人动态路由；「表达式审批人/上级规则」多份 closeout §9 照录为另行 ｜ 用户授权自主推进（「根据你的推荐继续」）｜ 前置：SPEC-003（员工报告线 `EmployeeReportingLine`）、SPEC-013/016/017/018（approverRule + nodeSchema + 定义 CRUD）
注：**编号重定**——立项时自号 SPEC-040，实施中外部渠道 exception-review-cli 占用 **SPEC-040**（其 closeout 已落地、memory 已记录）→ 本专项改编号 **SPEC-041**（沿「编号被 closed 工作流占用即自改号」惯例）。

## 1. 交付范围

approverRule 扩展 **`SUPERVISOR`** 规则（按申请人报告线自动路由直属上级/多级上溯）——审批定义与申请流转端到端可用。**零结构变更**（approverRule JSON 配置扩展，迁移 29/模型 60/权限 132/事件 15/路由 28 全不变）。

1. **Task 1（后端 SUPERVISOR 规则）**：`approval-types.ts` `ApproverRule` +`{ type: 'SUPERVISOR'; levels?: number }` + `approval-instance-service.ts` `resolveApproverIds(rule, applicantId, db)` +SUPERVISOR 分支（`resolveSupervisorApprovers`：applicant → User.employeeId → 报告线步行 levels 级 → 上级绑定账号；任一步缺失 400）+ apply/节点推进传 applicantId + `approval-definition-service.ts` `assertApproverRuleValid` +SUPERVISOR（levels 可选整数 ≥1）+ `approval-policy.ts` `resolveApproverRule` SUPERVISOR 返回空集（纯函数边界）；服务测试 6 例。
2. **Task 2（前端最小）**：`ApprovalCenterPage.tsx` 定义编辑器审批人类型 +「直属上级」（无需取值 CSV）+ 回填处理 + 详情显示；测试 +1。
3. **Task 3（本报告）**：API 测试 3 例 + 闸门 + runbook §9.16 + 本 closeout。

**变更文件（共 4 后端 + 1 前端 + 2 测试 + 3 文档）**：Task 1 `approval-types.ts` + `approval-instance-service.ts` + `approval-definition-service.ts` + `approval-policy.ts` + `test/approval/approval-supervisor-service.test.ts`；Task 2 `ApprovalCenterPage.tsx` + `__tests__/ApprovalCenterPage.test.tsx`；Task 3 `test/app/approval-supervisor-api.test.ts` + runbook §9.16 + 本 closeout。

## 2. 工具链

Node test runner（串行 `--test-concurrency=1 --test-force-exit`）/ Vitest + Playwright（前端）/ Node v24.18.0。测试库 55433 `_test`；55432 禁触；ALLOW_TEST_DB_RESET=true；127.0.0.1；skip-pattern 排除 spec-008 排练 3 例。全程零 git 操作。撞车纪律沿用。

## 3. 测试计数链

### 3.1 聚焦验证（清净窗，串行）

| 检查 | 结果 |
|---|---|
| SUPERVISOR 服务测试（`test/approval/approval-supervisor-service.test.ts`） | **6/6 pass**（直接上级/levels 2 上溯/无 employee 400/无报告线 400/无账号 400/定义 levels 非法 400） |
| SUPERVISOR API 测试（`test/app/approval-supervisor-api.test.ts`） | **3/3 pass**（定义 CRUD SUPERVISOR + apply 直属上级审批人端到端/畸形 levels 400/无报告线 apply 400） |
| 前端 ApprovalCenterPage Vitest | **35/35 pass**（原 34 例 + SUPERVISOR 定义创建 1 例） |
| 前端全量 Vitest | **48 files / 237 tests 全绿**（ApprovalCenterPage +1 净增，零回归） |

### 3.2 文件闸门

| 检查 | 结果 |
|---|---|
| server tsc + eslint（approval 域 + 测试） | **0 err** |
| web tsc + eslint（ApprovalCenterPage + 测试） | **0 err** |
| web build（`tsc -b` + vite） | **exit 0** |
| `security:test`（root） | **57/57 pass**（含外部 SPEC-040 +8） |
| `security:audit:all`（root） | **server + web 双 passed=true** |
| `check:baseline`（29 迁移 / 60 模型） | **pass**（exit 0） |
| `check:bootstrap` | **pass**（exit 0） |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零结构变更**：迁移 **29** / 模型 **60** / 权限 **132** / 事件 **15** / 路由 **28** 全不变（approverRule JSON 配置扩展，无迁移/模型/权限/路由变更）。`check:baseline`（29/60）+ `check:bootstrap` PASS。

## 5. 关键裁决记录（D1-D6 + 实施期 ⚠️ 记录）

| # | 决策 | 值 |
|---|---|---|
| D1 | ApproverRule +SUPERVISOR | `{ type: 'SUPERVISOR'; levels?: number }`（levels 缺省 1=直属上级，可 2=上级的上级） |
| D2 | 解析 | `resolveApproverIds(rule, applicantId, db)` +SUPERVISOR：applicant → User.employeeId → 报告线步行 levels 级 → 上级绑定账号 → approverIds；任一步缺失 400 ASSIGNEE_INVALID |
| D3 | 定义校验 | `assertApproverRuleValid` +SUPERVISOR（levels 可选整数 ≥1） |
| D4 | 传递 applicantId | apply 节点[0] 传 actor.actorUserId；节点推进传 instance.applicantId |
| D5 | 前端最小 | 定义编辑器 +「直属上级」（无需取值 CSV）；详情显示 |
| D6 | 零结构变更 | 迁移/模型/权限/事件/路由全不变 |

**实施期 ⚠️ 记录**：

- **编号重定（SPEC-040→041）**：外部渠道 exception-review-cli 占用 SPEC-040（closed）→ 本专项改 **SPEC-041**；plan/design/代码注释/closeout 全量改号；外部渠道文件零触碰（已核）。
- **纯函数边界**：`resolveApproverRule`（approval-policy，纯函数无 DB）对 SUPERVISOR 返回空集——SUPERVISOR 需报告线查询，由服务层 `resolveSupervisorApprovers` 处理；`ApproverRule` 联合扩展后 TS 类型收窄需 ROLE 显式分支。
- **applicantId 传递**：`resolveApproverIds` 签名加 `applicantId`——apply（actor.actorUserId）与节点推进（instance.applicantId）两处调用点同步更新；SUPERVISOR 在多级 nodeSchema 下节点按申请人（非当前审批人）报告线解析。
- **前端取值字段**：SUPERVISOR 无需取值 CSV——submit 跳过取值必填校验；`openManageEdit` 回填 SUPERVISOR 时取值留空；value Form.Item required 规则移除（提交时按类型校验）。
- **服务测试形态**：apply 后直查 approvalTask.assigneeId 断言直属上级绑定账号（确定性，非时序）。

## 6. 安全审计状态

- `security:test` **57/57**（含外部 SPEC-040 +8；本 SPEC 零安全变更）。
- `security:audit:all` **server + web 双 passed=true**，production high=0/critical=0。
- `check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **编号重定**：SUPERVISOR 规则 = SPEC-041（外部渠道已占 040 exception-review-cli）。
2. **部门主管/维度表达式**（除直属上级外）——另行（表达式引擎）。
3. **报告线离职/转岗历史追溯**——沿用活跃线（endedAt null）。
4. **前端定义编辑器结构化改造**（JSON 文本 → 表单化）——另行。
5. **承接既有已知项**：trust-root-guard ×2 外部漂移（SPEC-022，归外部渠道）；SEC-2026-002（react-router v8）保留观察；前端预存 vitest flake。

## 8. 对账项

- **零结构变更对账**：迁移 29/模型 60/权限 132/事件 15/路由 28 全不变——`check:baseline`（29/60）+ `check:bootstrap` PASS。
- **规则类型对账**：`APPROVER_RULE_TYPES` = USER/ROLE/SUPERVISOR 三型；定义 CRUD 校验 + 运行期解析 + 纯函数边界三处一致（SUPERVISOR 由服务层解析）。
- **报告线解析对账**：applicant 用户→员工绑定（`User.employeeId`）→ 活跃报告线（`employee_reporting_line` endedAt null）→ 上级员工→账号绑定；三链任一缺失 400 `APPROVAL_ASSIGNEE_INVALID`；自审 409 沿用（上级=申请人时）。
- **docs-leakage 占位符口径**：closeout/report/runbook 更新段不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433；55432 禁触。

## 9. Follow-up 路由（候选专项）

- **部门主管/维度表达式**：除直属上级外的表达式审批人（表达式引擎）——另行。
- **报告线多级上溯上限**：levels 支持大数时的链深度限制/防环（报告线已防环，apply 步行短链）——可加 levels 上限。
- **前端定义编辑器表单化**：approverRule 结构化编辑器——另行。
- **SEC-2026-002 观察**：react-router v8 迁移专项（2026-08-29 到期）保留观察。

## 10. 验收链

- **Task 1（后端 SUPERVISOR）**：ApproverRule +SUPERVISOR + resolveApproverIds/ resolveSupervisorApprovers + 定义校验 + 纯函数边界 → 服务 6/6 + tsc/eslint 0。
- **Task 2（前端最小）**：定义编辑器 +「直属上级」（无需取值）+ 回填 → ApprovalCenterPage 35/35 + tsc/eslint/build 0。
- **Task 3（本报告）**：API 3/3 + 全量 vitest + `security:test` 57/57 + audit 双绿 + check:baseline/bootstrap/docs-leakage + web build 全 PASS + runbook §9.16 + 本 closeout 收口。

## 11. 收官状态

**SPEC-041 审批表达式审批人 + 直属上级规则本地闭环（2026-08-05）**：3/3 任务完成（Task 1 ApproverRule +SUPERVISOR + 服务层解析 + 定义校验 + 纯函数边界；Task 2 前端定义编辑器 +「直属上级」；Task 3 API 测试 + 闸门 + runbook §9.16 + closeout）。**零结构变更**：迁移 29/模型 60/权限 132/事件 15/路由 28 全不变（approverRule JSON 配置扩展）。**编号重定**：本专项 SPEC-040→**SPEC-041**（外部渠道已占 040 exception-review-cli）。聚焦验证：SUPERVISOR 服务 **6/6** + API **3/3** + 前端 ApprovalCenterPage **35/35** + `security:test` **57/57** + `security:audit:all` 双绿 + check:baseline（29/60）+ check:bootstrap + docs-leakage + web build 全 PASS；全量 vitest **48 files/237**。实施期 ⚠️ §5（编号重定 / 纯函数边界 / applicantId 传递 / 前端取值 / 测试形态），已知非阻断 §7，follow-up §9。**审批中心新增「按申请人报告线自动路由」能力——定义可配置直属上级/多级上级审批**。按项目约束零 git 操作，本地闭环。
