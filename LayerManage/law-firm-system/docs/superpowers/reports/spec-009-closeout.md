# SPEC-009 线索销转 + 客户主数据 — 收尾报告

日期：2026-07-30 ｜ 状态：**本地闭环**（全部任务 + 终审 + 修复轮 + 复审 READY）
需求来源：docs/spec/modules/MOD-004-lead-crm.md（CRM-01~06）+ MOD-005-customer-master-data.md（CUS-01~02）
设计：docs/superpowers/specs/2026-07-28-lead-crm-customer-master-data-design.md ｜ 实施台账：.superpowers/sdd/2026-07-28-lead-crm-customer-master-data/progress.md

## 1. 交付范围

- 线索全链路：录入（去重提示/幂等）→ 公海/私海（领取/分配/手动与超时回收）→ 跟进（首响计量/状态推进）→ 邀约（创建/改期/到访/日历范围查询）→ 转客户（同事务幂等）。
- 客户主数据：客户 CRUD + 联系人（主联系人互清除/软删/电话去重）。
- 事件接入：5 类 CRM 事件 outbox 同事务写入 + 首响 pilot 订阅（ENABLED）+ 超时回收扫描单元（EventWorker tick 驱动，双向隔离）。
- 权限与范围：15 个 CRM 权限码（目录 + **迁移 provisioning**）；SELF/TEAM/BRANCH/ALL 数据范围（Lead 自身列锚定 / Appointment 关系包裹 / Customer 混合锚定）；L3 字段脱敏 + READ_L3_FIELDS 审计。
- HTTP 层：25 条守卫路由（leads 12 + appointments 5 + customers 8，含日历增量 GET /api/v1/appointments 与 C1 增量 GET /api/v1/customers/:id/contacts）。原型无守卫路由已整体根除：customer 侧原型路由（PUT/DELETE /customers/:id、跨模块只读子资源 /contracts /cases /payments）有 404 锁定测试（customer-api.test.ts）；lead 侧原型物理删除 DELETE /leads/:id 无 404 锁测试，其安全结果由 router 通读（无该行注册）+ typecheck 0（零孤儿引用）证明（终审 F-4/台账 §B #21 如实记录）。
- 运维：runbooks/lead-crm-customer-master-data.md。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`）/ React 19 + AntD 6 + Zustand（前端）/ Vitest + Playwright（排练式）。

## 3. 测试计数（后端，全部串行）

| 闸门 | 结果 |
|---|---|
| 全量串行（排除 2 个 55432 锁定排练件；终审修复轮后合并收官跑） | **1151 / 1147 pass / 0 fail / 4 skipped**（skip=pkg smoke 预存） |
| └ CRM 定型 8 文件 | 149/149 |
| └ test/app 全量（22 路由文件，含 CRM API 36 例） | 145/145 |
| └ test/events（23 文件 glob） | 233 / 232 pass / 1 fail（=event-observability-load 排练哨兵，55432 port-guarded 预存项，与本 SPEC 零交集） |
| 迁移-only 实证（db:reset:test 后零种子直查） | permission=87（含 15 CRM 码）+ event_subscription=3（含 pilot ENABLED 逐字段=目录） |
| security:test | 34/34 |
| check:baseline / check:docs-leakage / typecheck / lint | PASS / exit 0 / 0 / 0 |

前端计数（T11 独立审查亲跑，task-11-review-v2.md）：**Vitest 34 文件/116 例全绿；lint 0 错误/7 警告（全预存页）；typecheck 0；build PASS**；E2E 排练 spec 静态核查合格、未实跑（无栈无 env，终审裁决为非阻断——与 spec-003/004 排练式先例一致，建议生产部署前见证跑一次）。

## 4. 迁移与模型

- 新增迁移 4：`20260728090000_lead_crm_customer_expand`（Lead 扩充 + Campaign/LeadPoolRecord/Appointment/Contact/Customer 扩充）、`20260729090000_leadfollow_updated_by`、`20260730090000_crm_permission_provision`（15 权限行 provisioning）、`20260730090002_lead_first_response_subscription_provision`（pilot 订阅 provisioning，终审 F-1 修复——同族盲区由 spec-008 契约新增 parity 常驻断言永久封闭）。
- model 总数 49（45→49）；迁移总数 16（12→16）；迁移计数期望三处协调（checker + 7 fixture 数组 + spec-008 contract 测试）已同步。
- migration 重演 + 空库断言 + 空库重播种（149/149）验证通过。

## 5. 关键裁决记录（用户裁决）

1. Task 6 版本冲突 → version B 权威、决策统一走协调者（决策集 1-8 转正）。
2. M-1（决策 4 修订）：首响计量与状态推进解耦——首个 ASSIGNED 态跟进恒推进 CONTACTED，与是否已计量无关（消死态）。
3. 运行模式：分工制（并行线实现/协调者审查）→ T9/T10/T11 因并行线停滞逐次改派协调者渠道（每次单独裁决）。
4. 到访日历：补后端范围查询端点（GET /api/v1/appointments?from&to，纯追加）。
5. 联系人查询：补 GET /api/v1/customers/:id/contacts（C1 增量，customer.read，纯追加；前端客户详情页接上真实数据源，同时修掉掩码 wechat 回填编辑表单的 I-1 缺陷）。
6. 安全审计：brace-expansion override 修、react-router 记 SEC-2026-002 例外。

## 6. 安全审计状态

- `security:test` 34/34 PASS。
- `security:audit:prod` 现存 2 个 production_high（exit 1，记录在案不阻断）：
  - brace-expansion GHSA-mh99-v99m-4gvg：override 5.0.8 已覆盖 minimatch 10 运行时链；egg-scripts→mz-modules→glob@7 链与 5.0.8 不兼容且无 1.x/2.x 补丁版——需 egg 工具链专项。
  - react-router GHSA-qwww-vcr4-c8h2：需 ≥8.3.0（v7→v8 大版本升级）——SEC-2026-002 已登记，生产门禁机制不豁免（policy.mjs 设计），升级专项后续。

## 7. 已知非阻断项

- 9 个既有 React Hook warning（前端 lint，预存）；主包大小（构建警告，预存）；远端门禁未做（本地闭环，git 操作按项目约束未执行）。
- 递延 Minor 21 项总表（终审 triage 输入）见台账"台账对账"节 B——含 appointment 活跃槽 DB 唯一索引、伪造 FK→500 族、公海分裂视图、customerNo 前缀分裂等，全部为接受/后续 SPEC 级。
- 测试环境指纹：共享 `_test` 库并发 reseed 竞态（静默窗口重试纪律）；内存压力下 Egg boot 偶发 APP_KEYS 注入失败（重试即绿）。

## 8. 双渠道验收链

T1-T8 并行线实现 + 协调者采用-审查；T9/T10/T11 协调者渠道实现（并行线停滞，用户逐次裁决改派）+ 协调者渠道独立审查（部分任务另有静态审查互为 corroboration）。全部任务独立审查结论 0 Critical。审查件：sdd 目录 task-N-review*.md。

## 9. 收官状态

**SPEC-009 本地闭环（2026-07-30）**：全分支终审 READY-WITH-FIXES → 终审修复轮 6/6 → scoped 复审 **READY**（final-fix-review.md）。终审捕获 F-1 Critical（pilot 订阅 provisioning 缺口，与 T12 权限盲区同族）已修复并常驻契约封闭；21+1 项递延 Minor 全部 triage（fix-now 3 已修、follow-up-SPEC 2、accept 24）。E2E 排练 spec 链路已修（补 SCREENED 步骤）——生产部署前见证跑一次（既有建议维持）。后续：finishing-a-development-branch（按项目约束不执行 git 操作，本地闭环）；follow-up 项（appointment 活跃槽 DB 部分唯一索引、assign 验 LEAVED、egg 工具链/react-router 安全专项——SEC-2026-002 2026-08-29 到期）转各自专项。
