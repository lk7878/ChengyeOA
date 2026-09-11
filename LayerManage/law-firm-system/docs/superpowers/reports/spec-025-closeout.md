# SPEC-025 审批定义导入导出（Definition Transfer）— 收尾报告

日期：2026-08-04 ｜ 需求来源：SPEC-017/024 closeout §9「Definition 导入导出（配置迁移/批量初始化）」+ 审批中心深化余项 ｜ 无人值守 subagent-driven（协调者 + 三任务实现者子代理 + 任务评审）

## 1. 交付范围

Definition **配置迁移/批量初始化**能力——管理员导出全量审批定义 JSON 快照（含 DISABLED、code 升序），导入批量 upsert（按 code，幂等）。**零结构变更**：

1. **Task 1 服务层**（`approval-definition-service.ts`）：`exportDefinitions()`（读操作不落审计）+ `importDefinitions(input)`（单事务全或无、上限 100、按 code upsert、version 前置条件、逐定义复用校验、审计 `APPROVAL_DEFINITION_IMPORT`）。
2. **Task 2 控制器 + 路由**（`controller/approval.ts` + `router.ts`）：`GET /definitions/export` + `POST /definitions/import`（approval.manage，字面量先于 `PATCH /:code`）；approval 域路由 11→**13**。
3. **Task 3 前端 + 文档**（`api/approval.ts` + `ApprovalCenterPage.tsx` 定义管理 Tab 导出/导入按钮 + `finance-operations.md` §9.14 + 本 closeout）：导出下载 JSON、导入上传解析 + **I×1 round-trip 修复**（剥离视图字段）。

**变更文件（共 10 件，零结构变更）**：`approval-definition-service.ts` / `approval-types.ts` / `controller/approval.ts` / `router.ts` / `test/approval/approval-definition-service.test.ts` / `test/app/approval-api.test.ts` / `apps/web/src/api/approval.ts` / `apps/web/src/pages/approvals/ApprovalCenterPage.tsx` / `apps/web/src/pages/approvals/__tests__/ApprovalCenterPage.test.tsx` / `docs/superpowers/runbooks/finance-operations.md`。未触碰：迁移/模型/权限/事件表。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Vitest 4（前端，仅 Vitest 无 DB）。运行时 Node v24（沿 SPEC-017-024 实证零影响）。全程零 git 操作。

## 3. 测试计数链

### 3.1 任务计数（三任务实现者独立复跑实证）

| 检查 | 结果 |
|---|---|
| `approval-definition-service.test.ts`（24 既有 + 9 新：export×2 + import×7，Task 1） | **33/33 pass**，fail 0 |
| `test/app/approval-api.test.ts`（26 既有 + 5 新：export/import 门禁 + 字面量优先，Task 2） | **31/31 pass**，fail 0 |
| 前端 `ApprovalCenterPage.test.tsx`（28 既有 + 2 新：导出调用+下载触发 / 导入参数剥离视图字段，Task 3） | **30/30 pass**，fail 0 |
| 前端 typecheck（`npm --prefix apps/web run typecheck`） | exit 0（0 错误） |
| 前端 lint（`npm --prefix apps/web run lint`，全量） | **0 错误**，4 预存 warning 照录（Case/Notification/Performance/User 页 `react-hooks/exhaustive-deps`，非本任务文件） |
| 前端 build（`npm --prefix apps/web run build`） | 成功 |

**TDD 红→绿实证（Task 3）**：先补 2 例 → **红**（`Test Files 1 failed / Tests 2 failed | 28 passed`——导出按钮/导入 input 缺失）→ 实现（`api/approval.ts` +2 API + 页面导出/导入按钮 + 剥离视图字段）→ **绿**（30/30）。

### 3.2 最终全量（后端全量串行，清净窗，2026-08-04）

`npx tsx --test --test-concurrency=1 --test-force-exit --test-skip-pattern="guarded PostgreSQL rehearsal covers preflight|guarded rehearsal main completes|four independent clients converge 200 events" "test/**/*.test.ts" "test/*.test.ts"`（spec-008 排练 3 例 port-55432 锁定件照录排除）：

- **实测：1874 tests / 1868 pass / 2 fail / 4 skipped**（duration ~39min，TAP 终态）——预期 1860（SPEC-024 终态）+ 本 SPEC 净增 +14（service +9 + api +5）= **1874** 精确吻合。
- **fail 分类**：2 例均为 **SPEC-022 已知外部漂移**（`trust-root-guard.test.ts`×2：`PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`，照录不计）——**0 真 fail 为权威结论**（本 SPEC 净增 +14 全绿，approval 域零回归）。
- **skip 分类**：spec-008 排练 3 例 port-55432 锁定件经 `--test-skip-pattern` 照录排除 + 1 例既有显式 skip（沿 SPEC-024 终态 4 skipped 口径）。

### 3.3 其他闸门

| 闸门 | 结果 |
|---|---|
| `npm run security:test`（cwd law-firm-system） | **34/34 pass**，exit 0 |
| `check:baseline`（26 迁移 / 60 模型） | **pass** |
| `check:bootstrap`（角色 2→7） | **pass** |
| `check:docs-leakage` | **pass**（exit 0，占位符口径） |

## 4. 迁移与模型

**零迁移、零模型、零权限、零事件变更**（迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** 全不变）。唯一计数变化为 approval 域路由 11→**13**（+`GET /definitions/export`、+`POST /definitions/import`，均 approval.manage，非结构变更）。无新权限码、无新事件、无新订阅。`approval_definition` 既有列（code/name/businessType/formSchema/approverRule/nodeSchema/version/status）即导入导出载体。

## 5. 关键裁决记录（D1-D10）

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限 | 导出/导入挂 **`approval.manage`**（定义管理权限，扩展至批量） |
| D2 | 导出 | `exportDefinitions()`：全量含 DISABLED，按 code 升序，返回 JSON 数组（每项含 code/name/businessType/formSchema/approverRule/nodeSchema/version/status）——配置迁移完整快照 |
| D3 | 导入 | `importDefinitions(input)`：批量 upsert（按 code）——已存在 → update（version 校验可选）；不存在 → create。单事务全或无 |
| D4 | 幂等 | 按 code upsert：已存在且 version 匹配 → 更新；已存在但 version 前置条件不符（若提供 version）→ 409；重复导入不产生重复 |
| D5 | 校验 | 逐定义复用 create/update 校验（code 命名惯例 `^[A-Z][A-Z0-9_]{0,99}$`/formSchema/approverRule/nodeSchema mode）；单条失败 → 400 整事务回滚 |
| D6 | 批量限制 | 单次导入上限 **100 条**——超限 → 400 |
| D7 | 路由 | `GET /definitions/export` + `POST /definitions/import`（approval.manage）——字面量先于 `PATCH /:code` |
| D8 | 前端 | 「定义管理」Tab 增「导出」（下载 JSON）+「导入」（上传 JSON 文件）——approval.manage 门控 |
| D9 | 审计 | 导入落 `APPROVAL_DEFINITION_IMPORT`（newValues 含 count/summary）；导出为读操作不落审计 |
| D10 | 零结构变更 | 无迁移/模型/权限/事件/路由表变更（+2 路由非结构变更） |

**I×1（Task 1 评审 Important，Task 3 落实）**：导入上传前**剥离视图字段** `id/createdAt/updatedAt`（仅保留 import 白名单 8 键）——保证「导出下载 → 原样上传」round-trip 可用（否则后端 `assertExactKeys` 对多余键 400）。前端导入兼容裸数组与 `{definitions}` 包络两形态。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（闸门实测 exit 0）——server 依赖树地板、CORS 插件、audit 例外精确匹配等零新增例外。零新增权限/零新增事件（复用既有 `approval.manage` 与 `APPROVAL_STATE_INVALID`/`VALIDATION_FAILED`）。
- 导入接口为 `approval.manage` 门控 + 逐定义校验 + 单事务全或无——畸形 payload 零写入（无注入面：formSchema/approverRule/nodeSchema 为 Json 列，服务层结构校验非 eval）。
- `check:docs-leakage` **exit 0**（含本 closeout 与 runbook §9.14 的终态）——**占位符口径**：持久化文档不落真实密钥/连接串口令（`JWT_SECRET="<redacted>"`/URL 去口令，沿 SPEC-012 起先例）；本 closeout 与 runbook §9.14 均不含 env 块真实值。

## 7. 已知非阻断项（评审累积逐条照录）

1. **I×1 round-trip 修复（Task 1 评审 Important，Task 3 已闭环）**：导出快照含视图字段 id/createdAt/updatedAt——原样上传会被后端 `assertExactKeys` 400。前端导入前逐项剥离视图字段（仅留白名单 8 键）闭环，测试钉死剥离后参数。
2. **M×2 照录**：
   - **M1 导入按钮无 loading/防连点态**：导入为异步批量操作，按钮未挂 loading（与编辑 Modal `confirmLoading` 不同）；快速连点会重复提交——非阻断（导入按 code upsert 幂等，重复导入不产生重复，第二次走 update）。列 follow-up（前端加载态统一）。
   - **M2 导出文件名日期语义**：`approval-definitions-{date}.json` 按本地时区日期命名——同日多次导出同文件名（浏览器下载通常自动追加序号）；跨时区团队文件名日期可能相差一日。非阻断，列 follow-up（文件名加时分/UTC）。
3. **审计 `targetId` 哨兵 `'IMPORT'`**（Task 1 备注）：批量导入无单一业务对象，采用哨兵（沿 system-bootstrap 批量审计先例）；具体 imported/updated/count/summary 落 newValues。
4. **controller 冗余 assertExactKeys**（Task 2 备注）：`importDefinitions` 在 controller 与 service 层各 assert 一次 `['definitions']`——沿本文件双层校验先例，无害且保持薄控制器形态一致。
5. **既有并发用例时序 flake（承接 SPEC-024 §7 照录）**：instance `forwardTask concurrent` 等 `Promise.allSettled` 时序竞争用例偶发 flake——本 SPEC 未触碰 instance 域；确定性构造推广列 follow-up。
6. **SPEC-022 外部漂移（照录不计）**：trust-root-guard×2 权限升级守卫错误码 `PRIVILEGE_ESCALATION_BLOCKED`→`PERMISSION_DENIED`——外部并行渠道在制漂移，非本 SPEC 回归（本 SPEC 未触碰权限/授权域）。
7. **测试进程残留干扰 / 共享 DB 撞车纪律**：沿 runbook §8（pg_stat_activity 清净窗探针、杀闸门等静默窗重跑、不计失败）；本 SPEC 全量初跑 0 撞车失败（清净窗一次通过）。
8. **承接既有已知项**：SPEC-018 缺 ALL 并发用例 / nodeName 唯一性；SPEC-019 转交目标存在性校验；SPEC-020 加签幂等 key；SPEC-021 dedup UTC 天边界；前端预存 vitest flake（隔离复跑全 PASS）；SEC-2026-002 观察。

## 8. 对账项

- **零结构变更**：迁移 **26** / 模型 **60** / 权限 **124** / 事件 **15** 全不变；approval 域路由 11→**13**（+2 export/import 非结构变更）。
- **测试计数**：definition 服务 24→33（+9：export 全量含 DISABLED + code 升序 / 无 manage 403 + import 批量 create / upsert / 幂等 / version 409 / 畸形 400 回滚 / 上限 100 / 审计）；approval-api 26→31（+5：export 门禁 + 导出 / import 门禁 + 导入 / 字面量优先）；前端 28→30（+2：导出调用 + 下载触发 / 导入参数剥离视图字段）。approval 域后端净增 **+14**。
- **全量对账**：SPEC-024 终态 **1860** + 本 SPEC 净增 **+14** = **1874**；实测 **1874 tests / 1868 pass / 2 fail / 4 skipped**（fail 2 例均为 SPEC-022 已知外部漂移 trust-root-guard×2 照录不计，**0 真 fail 为权威**——本 SPEC 净增全绿，approval 域零回归）。
- **错误码对账**：无新增错误码——导入校验/超限复用 `VALIDATION_FAILED` 400；version 前置条件复用 `APPROVAL_STATE_INVALID` 409；code 唯一冲突复用 `APPROVAL_DEFINITION_CODE_CONFLICT` 400（既有）。
- **docs-leakage 占位符口径**：runbook/closeout 不落真实密钥/连接串口令，扫描 exit 0。
- **localhost vs 127.0.0.1**：测试连接串纪律统一 127.0.0.1:55433（承 SPEC-011 裁决）；55432 禁触（spec-008 排练 3 例经 skip-pattern 照录排除）。

## 9. Follow-up 路由（候选专项）

- **导入导出的格式版本/兼容校验**（跨版本迁移）——另行（SPEC-025 明确 OUT）。
- **增量/选择性导出**（按 code/businessType 筛选）——另行（OUT）。
- **导入时关联角色/权限供给**（仅定义，角色已有）——另行（OUT）。
- **前端图形化导入编辑器**——JSON 文件上传即可（OUT）。
- **导入按钮 loading/防连点态统一**（M1 照录）——前端加载态统一专项。
- **导出文件名加时分/UTC**（M2 照录）——文件名规范微调。
- **并发测试确定性化推广**（承接 SPEC-024 §9）：把 version 前置条件确定性构造推广到既有 `Promise.allSettled` 时序竞争并发用例。
- **审批中心深化余项（承接 SPEC-021/023/024 §9）**：超时自动升级动作 / 多级升级 / 审批人维度统计驾驶舱 / 前端超时 Tag；全量筛选/搜索、全组织动作、导出/报表/统计。
- **SEC-2026-002（react-router v8 迁移专项）**：2026-08-29 到期。

## 10. 双渠道验收链

- **Task 1（服务层 export/import）**：实现者 DONE（definition 33/33 + approval 域 185/185 + tsc/eslint 0）→ 评审 I×1（round-trip 剥离视图字段）交 Task 3 落实。
- **Task 2（控制器 + 路由）**：实现者 DONE（approval-api 31/31 + approval 域 153/153 + tsc/eslint 0）。
- **Task 3（前端 + 文档，本报告）**：TDD 红→绿（2 新例红 → 实现 → 30/30 绿）；typecheck 0 / lint 0 err / build 成功；runbook §9.14 + 本 closeout 收口。
- **闸门收口（本报告，2026-08-04）**：后端全量串行 **1874 tests / 1868 pass / 2 fail / 4 skipped**（2 fail = SPEC-022 外部漂移照录不计，**0 真 fail**）+ `security:test` **34/34** + check:baseline（26/60）+ check:bootstrap（角色 2→7）+ check:docs-leakage exit 0。

## 11. 收官状态

**SPEC-025 本地闭环（2026-08-04）**：3/3 任务完成（Task 1 服务层导出/导入；Task 2 控制器 + 路由；Task 3 前端导出/导入 + I×1 round-trip 修复 + runbook/closeout 收尾）。Definition 配置迁移/批量初始化能力落地——**零结构变更**（迁移 **26**/模型 **60**/权限 **124**/事件 **15** 全不变；approval 域路由 11→**13**）；后端本 SPEC 净增 **+14**，全量串行（清净窗终态）**1874 tests / 1868 pass / 2 fail / 4 skipped**（2 fail = SPEC-022 已知外部漂移 trust-root-guard×2 照录不计，**0 真 fail 为权威**）；security:test **34/34** 零新增；check:baseline PASS（26 迁移/60 model）+ check:bootstrap PASS（角色契约 2→7）+ check:docs-leakage exit 0（占位符口径）；前端四闸门全绿（隔离测试 30/30 + typecheck 0 + lint 0 err + build）。I×1 round-trip 修复闭环（前端导入剥离视图字段 + 测试钉死）；已知非阻断项 §7 照录（M×2、审计哨兵、controller 双层校验、既有并发 flake、SPEC-022 外部漂移、测试进程残留干扰、承接既有项），follow-up 路由 §9 归专项。按项目约束零 git 操作，本地闭环。
