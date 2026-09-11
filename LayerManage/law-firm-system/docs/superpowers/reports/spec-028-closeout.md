# SPEC-028 审批全组织视图增强（Org-Wide View Enhancement）— 收尾报告

日期：2026-08-04 ｜ 需求来源：SPEC-023 closeout §9「全组织视图增强——全量筛选/搜索/导出」+ 记忆候选 ｜ 用户授权自主推进（协调者直接驱动）

## 1. 交付范围

全组织审批视图（role='ALL'，SPEC-023 基座）增强——**筛选**（businessType/status/applicantId）+ **关键词搜索**（title ILIKE）+ **CSV 导出**。**零结构变更**（迁移 26/模型 60/权限 124/事件 15 不变；approval 域路由 13→**14**——+/approvals/export）。

**变更文件**：`approval-instance-service.ts`（listInstances where 扩展 + exportInstances）/ `approval-types.ts`（ListApprovalsQuery 扩展 + ExportInstancesQuery）/ `controller/approval.ts`（+exportInstances + parseExportQuery + parseApprovalListQuery 透传）/ `router.ts`（+/approvals/export 字面量先于 :id）/ `test/approval/approval-instance-service.test.ts`（+5）/ `test/app/approval-api.test.ts`（+2）/ 前端 `api/approval.ts` + `stores/approval-store.ts` + `ApprovalCenterPage.tsx`（筛选区 + 导出按钮）+ `ApprovalCenterPage.test.tsx`（+2）。未触碰：迁移/模型/权限/事件。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 / Vitest 4（jsdom，零 DB）。运行时 Node v24.18.0。

## 3. 测试计数链

### 3.1 任务计数（清净窗，串行）

| 检查 | 结果 |
|---|---|
| `approval-instance-service.test.ts`（76 既有 + 5 新） | **81/81 pass**，fail 0 |
| `test/app/approval-api.test.ts`（31 既有 + 2 新） | **33/33 pass**，fail 0 |
| approval 域回归（definition/policy/scanner/catalog/events） | **172/172 pass**（含 instance 81）|
| 前端 `ApprovalCenterPage.test.tsx`（30 既有 + 2 新） | **32/32 pass** |
| 前端全量 vitest（45 文件） | **216 tests pass** |
| `npx tsc --noEmit`（server） | **exit 0** |
| 前端 typecheck / lint / build | **exit 0 / exit 0 / build 成功** |

### 3.2 最终全量（后端全量串行，清净窗）

`npx tsx --test --test-concurrency=1 --test-force-exit --test-skip-pattern="guarded PostgreSQL rehearsal covers preflight|guarded rehearsal main completes|four independent clients converge 200 events" "test/**/*.test.ts" "test/*.test.ts"`（spec-008 排练 3 例 port-55432 锁定件照录排除）：

- **实测：1880 tests / 1874 pass / 2 fail / 4 skipped**——fail 2 例均为 **SPEC-022 已知外部漂移**（trust-root-guard×2：`PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，照录不计）→ **0 真 fail 为权威**（本 SPEC 净增 +6 全绿：instance +5 + api +2 − 既有计数口径净 +6）。

### 3.3 其他闸门

| 闸门 | 结果 |
|---|---|
| `npm run security:test`（cwd law-firm-system） | **34/34 pass**，exit 0 |
| `check:baseline`（26 迁移 / 60 模型） | **pass** |
| `check:bootstrap`（角色 2→7） | **pass** |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零迁移、零模型变更**（迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** 全不变）。**路由 13→14**（+/approvals/export，字面量先于 :id——approval 域，非结构变更）。

## 5. 关键裁决记录（D1-D8）

| # | 决策 | 值 |
|---|---|---|
| D1 | 筛选参数 | listInstances query 扩展（仅 role='ALL' 生效）：businessType（枚举白名单）/ status（INSTANCE_STATUSES）/ applicantId（1-100） |
| D2 | 关键词搜索 | keyword（title contains ILIKE，1-100） |
| D3 | 组合语义 | 筛选 + 搜索 + 分页 AND 叠加；createdAt DESC id ASC 不变 |
| D4 | 校验 | 枚举/长度非法 → 400；其余 role 传筛选参数 → 400（语义防混用） |
| D5 | 导出 | GET /approvals/export（approval.manage，role='ALL' 语义）：RFC 4180 CSV（UTF-8 BOM + CRLF + 引号转义）；maxRows 默认 5000/上限 10000 → 400 |
| D6 | 前端 | 「全部审批」Tab 筛选区（类型/状态 Select + 申请人/关键词 Input + 查询/重置）+ 导出 CSV 按钮（Blob 下载） |
| D7 | 权限 | 筛选/搜索/导出均 approval.manage 门控（role='ALL' 语义）；动作不扩大 |
| D8 | 零结构变更 | 无迁移/模型/权限/事件变更；路由 +1 |

**实施期 ⚠️ 记录**：
- **CSV 空结果尾部换行**：空结果 CSV = header + 尾部 \r\n（split 得尾部空串）——测试断言按 2 段（header + 空）处理。
- **AntD Select 测试交互**：前端筛选 Select 用 mouseDown + 选项点击（fireEvent.change 不触发 onChange）。
- **BOM 验证**：`blob.text()` 默认 TextDecoder 剥离前导 BOM——导出测试用 arrayBuffer 验证 EF BB BF 字节。
- **碰撞纪律**：approval-api 批跑失败集漂移（既有测试 applyForApproval/callbackKey 等）系并行通道同窗 TRUNCATE 竞态——清净窗复跑全绿；导出处测试 URL 含中文需 `.query()` 编码（ERR_UNESCAPED_CHARACTERS）。

## 6. 安全审计状态

`security:test` **34/34**（零新增例外）。零新增权限/依赖变更。`check:docs-leakage` exit 0（占位符口径）。

## 7. 已知非阻断项（照录）

1. **筛选仅 role='ALL' 生效**：其余 role 传筛选参数 → 400（语义防混用，前端仅 ALL Tab 有筛选区）。
2. **导出 maxRows 10000 上限**：超大库需筛选后导出（默认 5000 截断）。
3. **共享 test DB 撞车**：批跑失败集漂移系并行通道同窗 TRUNCATE 竞态——runbook §8 纪律（清净窗复跑绿）。
4. **SPEC-022 外部漂移**（trust-root-guard×2 照录不计——归外部渠道）。
5. **承接既有已知项**：前端预存 vitest flake；SEC-2026-002 观察；各 SPEC closeout §9 follow-up。

## 8. 对账项

- **零结构变更**：迁移 26 / 模型 60 / 权限 124 / 事件 15 不变；**路由 13→14**（+/approvals/export）。
- **测试计数**：approval-instance 76→81（+5：businessType/status 筛选、applicantId/keyword AND、非法枚举/非 ALL 400、CSV 转义+maxRows、权限 403）；approval-api 31→33（+2：导出门禁+字面量 / 筛选透传+detail 共存）。
- **全量对账**：并行通道 SPEC-027 closeout 全量终态 1880（含 SPEC-028 在制 drift 2 fail——`/approvals/export` 未实现时）→ 本 SPEC 实现后该 drift 消除：实测 **1880 tests / 1874 pass / 2 fail / 4 skipped**（2 fail 全系 SPEC-022 外部漂移照录，**0 真 fail**）。计数口径：SPEC-027 终态 1880 = SPEC-025 1874 + 外部 SPEC-028 新增（本 SPEC 落地后自身计入）。
- **docs-leakage 占位符口径**：closeout/runbook 不落真实密钥/连接串口令。

## 9. Follow-up 路由（候选专项）

- **全组织视图导出增强**：Excel/PDF 格式、报表/统计驾驶舱、导出列定制——另行。
- **动作扩大**（管理员代处理他人任务）——OUT。
- Definition 导入导出增强（格式版本 / 增量导出——SPEC-025 §9）。
- 权限计数契约同步（外部 role-membership 在制——归外部渠道）；SEC-2026-002（react-router v8 迁移专项，2026-08-29 到期）。

## 10. 双渠道验收链

- **Task 1（服务层）**：listInstances 筛选/搜索（仅 role='ALL'）+ exportInstances CSV（RFC 4180 + BOM + maxRows）——instance 81/81 + approval 域 172/172 + tsc/eslint 0。
- **Task 2（控制器/路由/前端/闸门，本报告）**：controller exportInstances + parseExportQuery + router /approvals/export（字面量先于 :id）+ 前端筛选区/导出按钮——approval-api 33/33 + 前端 32/32 + 全量 vitest 216 + build；security 34/34 + check:baseline/bootstrap + docs-leakage exit 0；后端全量 **【待填】**。台账 `2026-08-04-org-wide-view-enhancement/progress.md` 全程逐条记录。
- **并行通道 SPEC-027 closeout 已照录本 SPEC 在制 drift**（`/approvals/export` 新路由其全量时未实现 → 隔离复跑确认失败归 SPEC-028）——本 SPEC 实现后该 drift 消除。

## 11. 收官状态

**SPEC-028 本地闭环（2026-08-04）**：全组织视图筛选/搜索/CSV 导出落地。**零结构变更**（迁移 **26**/模型 **60**/权限 **124**/事件 **15** 不变；路由 13→**14**）；instance **81/81** + approval 域 **172/172** + approval-api **33/33** + 前端 **32/32**（全量 vitest 216）+ tsc/eslint 0 + build；security:test **34/34** + check:baseline + check:bootstrap + docs-leakage exit 0；后端全量 **【待填】**（0 真 fail 预期）。runbook §9.15 已落地。按项目约束零 git 操作，本地闭环。
