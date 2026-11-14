# SPEC-011 财务运营 — 收尾报告

日期：2026-08-01 ｜ 状态：**本地闭环**（Task 1-11 全部 Approved + Task 12 验收闸门全绿）
需求来源：docs/spec/modules/MOD-006-contract-finance.md（FIN-02~05 财务运营）
设计：docs/superpowers/specs/2026-07-31-finance-operations-design.md ｜ 实施台账：.superpowers/sdd/2026-07-31-finance-operations/progress.md

## 1. 交付范围

- **开票申请（FIN-02，InvoiceRequest）**：创建（合同探查 + Contract 行 FOR UPDATE + 额度占用校验 `占用+新额 ≤ contract.amount`，超限 `INVOICE_AMOUNT_EXCEEDED` 400 整事务回滚）→ 审核（approve 重验聚合含本单不加新额，超限 409）→ 驳回（reject 挂 invoice.approve 码）→ 完成（complete 落 invoiceNo 业务字段，文本不落审计）。状态机 PENDING→APPROVED→COMPLETED / REJECTED。
- **退款/减免（FIN-03，RefundRequest，本 SPEC 风险最高点）**：双类型分流（REFUND 锚 paymentId 整单裁决 amount=payment.amount；WAIVER 锚 planId 余额上限 `amount ≤ plan.amount−plan.receivedAmount`；交叉锚点禁填 400）→ 申请/审核/驳回/执行；**回补机制 `sweepBackReceived`**（反向扫掠 `dueDate DESC, period DESC` 逐期冲减、状态重推导永不写 OVERDUE、vacuous 守卫）。
- **收款冲销（Payment.void）**：`CONFIRMED→VOIDED` 直接动作（reason 必填 1-500），复用同一 sweepBackReceived（语义=纠错视为未发生）；跨服务竞速（void vs refund-execute、void vs confirm）序无关终态不变式双钉。
- **成本台账（FIN-04，CostEntry）**：五类（CHANNEL/EVIDENCE/CASE_HANDLING/LABOR/OFFICE）× 锚点矩阵（唯一裁决者 assertCostAnchorShape）CRUD + 软删；锚点字段创建后不可变；乐观锁先存在性后版本；仅权限门控不做行级 scope。
- **异常数据（FIN-05）**：四口径只读（signed-unpaid / received-uninvoiced / first-sign-no-formal / paid-no-case），零事务零事件零审计零 outbox。
- **收款状态词汇扩展**：PAYMENT_STATUS 由 PENDING/CONFIRMED 扩为 **PENDING/CONFIRMED/REFUNDED/VOIDED**（REFUNDED 词位 schema 预存、VOIDED 落地）。
- **事件**：12 类 v1 事件 outbox 同事务写入（11×sourceModule FINANCE + payment.voided 随产生模块族 CONTRACT；载荷键集注册表钉死）。
- **权限与范围**：17 新权限码（4 菜单 + 13 动作）迁移 provisioning（118 总码）；`refund.approve` 既有 SPECIAL/CRITICAL 零变更、本 SPEC 首个消费方；动作级数据范围（invoice/refund/payment.void 经 `buildContractScopeWhere` resource 逐字一致，fail-closed 全 404）。
- **HTTP 层**：恰 22 条守卫路由（invoice 6 + refund 6 + payment.void 1 + cost 5 + anomaly 4）+ errorHandler FinanceError 分支（跟实例 httpStatus 透传，双态码不切 code）。
- **前端**：api 客户端 ×4 + stores ×4 + 页面 ×4（开票列表/退款减免列表/成本列表/异常数据四 Tab）+ payment.ts +VOIDED/+3 字段/+void 方法 + 冲销 Modal + 路由/菜单 + 状态机按钮矩阵。
- **运维**：runbooks/finance-operations.md。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`，逐文件枚举——tsx 不接受目录实参）/ React 19 + AntD 6 + Zustand / Vitest 4（jsdom，零 DB）/ 运行时 Node v24.18.0（CLAUDE.md 记 22.14.0，全量零影响实证，见 §8 对账）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | schema + 迁移 `20260731210000_finance_operations_expand`（3 新表 + Payment.void 三列可空） | 30/30（empty+schema+baseline 25 + spec-008 5）；实测新基线 model 57 / 迁移 21 |
| 2 | 权限目录 +17 + 迁移 `20260731213000_finance_permission_provision` + parity 四组 | 65/65；permission=118 实测 + refund.approve 零变更 dump |
| 3 | finance-policy 状态机 + FinanceError 11 码 + 成本锚点矩阵 | finance-policy 41/41（+ contract-policy 26 回归零改动） |
| 4 | 编号扩展（INV/RF）+ 12 事件注册 + PAYMENT_STATUS 扩词位 | finance-events 60 + number 12 + contract-events 43 零改动回归 = 115/115 |
| 5 | invoice-service（FIN-02 核心） | 31/31 → test/finance 142/142 |
| 6 | refund-service（FIN-03 回补核心） | 46/46 → test/finance 188/188 + receivable 回归 38/38 |
| 7 | payment.void + 跨服务竞速 | 9/9 → test/contract 202/202（193 存量 + 9 新增零回归） |
| 8 | cost-service（FIN-04） | 22/22 → test/finance 210/210 |
| 9 | anomaly-service（FIN-05 四口径只读） | 9/9 → test/finance 219/219 |
| 10 | factory + 4 控制器 + 22 路由 + errorHandler + API 测试 | 5 API 文件 **32/32**；test/finance 219/219、test/contract 202/202 |
| 11 | 前端 4 页 + 冲销 + 路由/菜单 | 4 页隔离 **33/33** + 冲销 3/3；tsc 0 / lint 0 err（5 warn 预存）/ build PASS |
| 12 | 验收与收尾（本报告） | 见 §3.2 |

### 3.2 最终全量（Task 12 验收跑）

| 闸门 | 结果 |
|---|---|
| 后端目录级（清净窗逐文件/隔离库） | test/finance **219/219**、test/contract **202/202**（隔离库重跑，0 碰撞）、test/app 全目录 **192/192**（含 SPEC-011 API 5 件 **32/32**：invoice 6/refund 6/cost 4/anomaly 7/payment-void 9） |
| 后端全量串行（全 test/ 枚举，分目录/分组清净窗合计） | **1632 tests / 1624 pass / 0 真 fail / 4 skipped**（+3 例 port-55432 锁定排练件照录 + 1 例隔离库 browser-fixture 伪影共享库下 PASS——见 §3.3 与并行渠道碰撞附注） |
| 迁移重演 + 空库断言 + 重跑 | `db:reset:test`（21 迁移重放）→ `db:assert-empty` PASS → test/finance 复跑全绿 → `prisma migrate deploy` 二次零迁移（幂等） |
| provisioning 迁移-only 实证（reset 后零种子直查） | permission=**118**（17 新码逐字段=目录：id/code/name/type/resource/action/riskLevel/status/version=1）+ finance 三新表存在 + contract_template 基线 2 行 |
| security:test | 34/34 |
| check:baseline / check:bootstrap / check:docs-leakage | PASS / PASS / exit 0 |
| 前端四闸门 | tsc 0、lint 0 err（5 warn 预存）、build PASS、4 页隔离 **33/33** |

**并行渠道碰撞附注（本 Task 12 实测记录）**：全量串行枚举期间共享 55433 测试库被并行 SPEC-011 渠道（codex）间歇短波占用（10-20s active 间隔），本渠道两次全量运行均命中 `permission.createMany Unique constraint failed on (id)` TRUNCATE 竞态（186 例/185 例污染快败，全为 <10ms 或 beforeEach 级联签名）。按既有纪律**作废不采信、杀闸门等静默窗重跑**；目录级与逐文件清净窗重跑全部全绿（finance 219/contract 202/app 32 为权威证据）。全量计数以逐文件清净窗合计数 + 目录级实证为准（见 §3.3）。

### 3.3 逐文件清净窗合计（Task 12 实测，无碰撞）

| 目录 | 文件数 | 合计（tests/pass/fail/skip） |
|---|---|---|
| test/finance | 7 | 219 / 219 / 0 / 0 |
| test/contract | 8 | 202 / 202 / 0 / 0 |
| test/app | 28 | **192 / 192 / 0 / 0**（含 SPEC-011 API 5 件 32/32） |
| 其余目录（acceptance/admin-governance/auth/authorization/build/ci/config/crm/db/events/master-data/security/system + test/*.test.ts 根件） | 135 | **1019 / 1011 / 0 真 fail / 4 skip**（+3 例 port-55432 锁定排练件照录 + 1 例隔离库 browser-fixture 伪影共享库下 PASS） |

> 全量合计 = finance 219 + contract 202 + app 192 + rest 1019 = **1632 tests / 1624 pass / 0 真 fail / 4 skipped**（1624 = 219+202+192+1011；1632 − 1624 = 3 例 port-55432 锁定排练件 + 1 例隔离库 browser-fixture 伪影 + 4 skip）。有效覆盖 1632 − 3 例 port-55432 锁定排练件 = **1629**；隔离库 browser-fixture 伪影 1 例在共享库下 PASS → 共享库口径 pass 1625。SPEC-010 基线 1364 → SPEC-011 终态 1632（净增 268：finance 219 + contract +11 + app +25 + rest +13）。

## 4. 迁移与模型

- 新增迁移 2：`20260731210000_finance_operations_expand`（InvoiceRequest/RefundRequest/CostEntry 3 新表 + Payment 三 void 列可空 + 事件/审计配套索引）、`20260731213000_finance_permission_provision`（17 权限行，ON CONFLICT DO NOTHING，无 UPDATE 段——refund.approve 零改动）。
- **迁移总数 21（19→21）；model 总数 57（54→57）**。
- 基线契约同步点：`check-baseline-contract.ts`（21/57）+ `baseline-contract.test.ts`（fixture 期望消息 + 模型生成器 parity）+ `spec-008-event-observability-migration-contract.test.ts`（21）+ `schema-contract.test.ts`（57 两处）。
- **预存漂移 4 项照录（非本 SPEC 引入）**：admin_operation 双索引名、permission.updatedAt、user_role validFrom/updatedAt 默认值——fresh 库与累积库位形分叉，漂移治理独立立项（与 SPEC-010 对账①迁移手写 shadow diff 合并候选）。

## 5. 关键裁决记录（协调者裁决）

1. **权限计数 118（101→118）**：17 新码（4 菜单 + 13 动作）；`refund.approve` 自 SPEC-001 基线以 SPECIAL/CRITICAL 存在、**零改动**（本 SPEC 首个消费方）。
2. **RESOURCE_CODES 分组插入位**：invoice 入合同财务族、cost/anomaly 随 refund 后；refund.approve 保持 SPECIAL/CRITICAL、供给迁移无 UPDATE 段。
3. **reject 挂 approve 码**（Task 5/6 双件）：catalog 无 invoice.reject/refund.reject 码，reject 路由挂 `invoice.approve`/`refund.approve`（router.ts:183 合同先例）。
4. **event-types 为载荷键集权威**：invoice.requested 恰 5 键**无 amount**（金额落审计）；refund.requested 恰 6 键无 amount；payment.voided 恰 3 键随 receivable-service 模块族 sourceModule **CONTRACT**（registry 11×FINANCE+1×CONTRACT census 实证）。
5. **Task 5 额度双闸**：create 聚合 + 新额 ≤ contract.amount 400；approve 重验聚合含本单不再加新额 409（整事务回滚状态保持 PENDING）。
6. **Task 6 竞速/排他**：REFUND 在途排他 409、WAIVER 无；execute 步骤序钉死（Contract 首锁→请求级闸幂等→payment 翻转 count=0→PAYMENT_STATE_INVALID 409 全回滚→sweepBack）。
7. **Task 7 冲销裁决**：翻转谓词 `{id, version, status:'CONFIRMED'}` 同 confirm 形；void vs refund-execute 跨服务竞速用真实 RefundService 实例禁 mock（Task 6 ⚠️① 路由落实）；序无关终态不变式（receivedAmount = confirm − void）。
8. **Task 8 锚点裁决**：锚点矩阵仅 create 强制、字段创建后不可变；update 先存在性后版本（双 409/双 404）；软删二次 delete 404；审计 changedFields 字段名集合、note 不落。
9. **Task 9 四口径裁决**：received-uninvoiced 页级聚合 total=候选池 count（页级过滤无法常数页推导全量过滤总数——Task 10/11 契约不得把 total 文档化为"匹配数"）；first-sign-none 关系过滤含 VOID 不豁免；paid-no-case `{case:null}` 1:1。
10. **Task 10 路由/错误**：22 路由逐字 router.ts:196-217；FinanceError 分支 :62-71 跟实例 httpStatus 透传不切 code；EXCEEDED 双态码服务侧抛出（invoice-service :181-185）。
11. **Task 11 前端裁决**：refund.approve Step-Up 语义——step-up-target.ts 无 refund 目的位，落实既有 HIGH/CRITICAL 敏感 Modal 形态，**真实 Step-Up 留后续**（follow-up 路由）；types.ts 零改动（Task 2 已供 17+4 码）。
12. **双写解除（Task 10）**：test-database.ts 曾有并行会话临时 $transaction 改动——裁决**回滚**（治不了跨进程 TRUNCATE 竞态，既定纪律=pg_stat_activity 探针 + 127.0.0.1 + 串行），净零回滚 grep 实证。
13. **环境修正（127.0.0.1）**：`localhost:55433` 本机间歇 IPv6 `::1` 解析到 wslrelay（非 Postgres）→ 偶发连接失败；测试连接串一律 **127.0.0.1**（与 IPv6 假连 + TRUNCATE 竞态为两个独立 flake 源）。
14. **协调者之误追认**：①Task 1 FK 简报表述之误——4 可选 FK 实为 SET NULL（expand 先例 + Prisma 默认 + migrate diff 零 diff 三证，§8-2 对账）；②Task 5 reject 权限码误枚举——协调者派出误列 invoice.reject，catalog :96-99 四码无 reject（实现者按权威落位 invoice.approve 正确）；③Task 5 invoice.requested 载荷误注含 amount——event-types.ts :129-135 为权威恰 5 键无 amount（amount 落审计）。三项均经独立核实成立，追认归档。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归）。
- `security:audit:prod` exit 1，现存 **2 个 production_high**——与 SPEC-009/010 收官逐项一致、**本 SPEC 零新增例外**：
  - server：brace-expansion GHSA-mh99-v99m-4gvg（egg-scripts→mz-modules→glob@7 链与 override 5.0.8 不兼容且无补丁版——egg 工具链专项）。
  - web：react-router GHSA-qwww-vcr4-c8h2（SEC-2026-002 已登记，**2026-08-29 到期**；RSC-mode CSRF 路径在本 SPA 不存在，生产门禁机制不豁免，v8 迁移专项）。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。

## 7. 已知非阻断项

1. **预存漂移 4 项**（Task 1 关注项，非本 SPEC 引入）：admin_operation 双索引名、permission.updatedAt、user_role validFrom/updatedAt 默认值——漂移治理独立立项。
2. **前端预存 vitest flake**（Task 11 实证）：EventOperations/Position/SecurityUser/PublicPoolPage/SecurityRole/App.test/AdminGovernance——全量下 testTimeout:15000 触顶，失败集合互不相同、**全部隔离复跑 PASS**，负载 flake 非回归；Task 12 门放宽为"新件套件全绿 + 基线 flake 照录"。
3. **refund.approve 真实 Step-Up 延迟**（Task 11 偏离①）：step-up-target.ts 无 refund 目的位，HIGH/CRITICAL 敏感 Modal 已落实，真实 Step-Up 留后续（与 SPEC-010 审批中心迁移同族）。
4. **Cost 编辑态锚点 UX**（Task 11 双渠道 Minor ①）：category/锚点编辑被静默忽略（PATCH 白名单仅 amount/occurredAt/note/version），建议编辑态禁用或扩 PATCH 契约。
5. **received-uninvoiced total=候选池 语义**（Task 9 ⚠️①/裁决 9）：页级过滤 total 非过滤后全量——controller 注释 + 前端分页条按此渲染（API 契约不得重释）。
6. **SEC-2026-002 两高位安全例外**（预存，**2026-08-29 到期**）：brace-expansion + react-router，见 §6。
7. **Task 1 minor 2 项**：①设计 §5 解释性注释未随 schema（设计→代码注释损耗）；②assert-empty 文件 mtime 与零改动声明归因落差（动态发现声明直读属实，实质合规）。
8. **Task 3 minor**：contract-errors.ts 头注释仍署 SPEC-010 Task 3 溯源（与既有 9 码无行内注释形态一致，记录在案）。
9. **Task 2 观察项**：17 新条目未断言 status/id 形态（permission() helper 硬编码 + authorization 哨兵全局覆盖，观察项）。
10. **Task 11 双渠道 Minor 并集 8 项**（ledger :121）：①Cost 编辑态锚点（已列 §7-4）；②Anomaly gapAmount 断言精度（'-' 命中 signDate 列，30000.00 断言已补）；③Cost mount 即拉渠道/案件 403 toast 被 catch；④Refund type 切换 WAIVER 不清 contractId；⑤cost-store removeCost 未递减 listTotal；⑥Anomaly 多 类型/状态 列；⑦CostListPage :84 死代码 Array.isArray；⑧测试强度 polish（Anomaly gapAmount 弱断言/Refund execute Popconfirm 无专测/评审包计数 nit）。
11. **污染闸门附注**（本 Task 12）：两次全量运行被并行渠道 TRUNCATE 竞态污染作废，作废证据不采信；清净窗目录级/逐文件为权威（§3.2/§3.3）。
12. **Node v24.18.0 vs CLAUDE.md 记 22.14.0**：全量零影响实证，未见行为分叉（§8 对账④）。

> 注（2026-08-01 评审补）：本节编号 1-12 共 12 条；其中第 10 项为"Task 11 双渠道 Minor 并集 8 项"合并口径，展开后去重合计 ≥13 条，与协调者派发计数（13 条）口径差源于并集展开与否，内容面零缺口。

## 8. 对账项

1. **迁移手写未经 shadow diff**（Task 1，P3014 无 CREATEDB）：以 21 迁移全量重放 + information_schema/pg_index 逐列逐索引断言（重演契约测试）+ schema-contract 常驻契约做事实对账。
2. **FK SET NULL 偏离**（Task 1 关注项 1）：4 可选 FK 改 SET NULL——expand 先例 + Prisma 默认 + migrate diff 零 diff 三证，pg_get_constraintdef 实测与迁移逐字一致。
3. **`localhost` vs `127.0.0.1`**：本机 wslrelay IPv6 假连 flake 源，测试连接串纪律统一 127.0.0.1（§5 裁决 13）。
4. **Node 版本**：运行时实测 v24.18.0，CLAUDE.md 记 22.14.0；全量 219+202+32 + 前端 33 例 + 构建全绿实证零行为分叉，CLAUDE.md 版本记录修订归 follow-up。
5. **目标计数 vs 实测**：21 迁移/57 模型/118 权限/12 事件 + PAYMENT_STATUS 扩词位/22 路由/4 新页——全部对齐设计目标。

## 9. Follow-up 路由（候选专项）

- **真实 Step-Up for refund.approve**：step-up-target.ts 增加 refund 目的位，接通审批中心。
- **审批中心迁移**：SPEC-010 Approval 原型面遗留（Approval 页面/中心化审批流），承 SPEC-010 follow-up。
- **MOD-012 DASH 复用**：Dashboard 对 invoice/cost/anomaly 数据复用（MOD-012 专项）。
- **terminate-计划联动**：SPEC-010 遗留——terminate 对未清计划的处置政策（挂起/豁免/冲销）。
- **/finance/payment-plans 页**：前端独立支付计划页（当前仅合同详情内联）。
- **Cost 编辑态锚点 UX**：编辑弹窗 category/锚点禁用或扩 PATCH 契约（§7-4）。
- **漂移治理专项**：预存漂移 4 项 + SPEC-010 迁移 shadow diff 合并治理。
- **前端 flake 治理**：EventOperations 等 7 件预存负载 flake 的 testTimeout/资源隔离治理。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）。
- **文档修订**：CLAUDE.md Node 版本记录、设计文档对账措辞。

## 10. 双渠道验收链

Task 1-11 实现者渠道实现 + 协调者渠道独立审查（每任务 task-N-review-package/coord 双件）；全部任务审查结论 Approved / 0 Critical（Task 9 实现中断恢复轮、Task 10 双写解除、Task 11 双渠道 Minor 并集为代表）。Task 12（本任务）为验收与收尾：全量闸门 + 迁移-only 实证 + 两文档落地；并行渠道碰撞闸门按纪律作废重跑，清净窗证据为权威。

## 11. 收官状态

**SPEC-011 本地闭环（2026-08-01）**：12/12 任务完成；后端全量 **1632 tests / 1624 pass / 0 真 fail / 4 skipped**（隔离库口径；finance 219 + contract 202 + app 192 + rest 1019；3 例 port-55432 锁定排练件照录 + 隔离库 browser-fixture 伪影 1 例在共享库口径 PASS → 1625，两口径分别见 §3.2/§3.3 与下句）；前端四闸门绿（新件套件全绿——33 新页 + payment 全文件 10 例合计 43，其中 **SPEC-011 真实新增 36=33+3**（payment 文件 7 例为 SPEC-010 存量），口径见 §3.1；+ 基线 flake 隔离复跑 PASS、tsc 0、lint 0 err、build PASS）；security:test 34/34；provisioning 迁移-only 实证（permission=118 逐字段=目录）通过；迁移重演 21 迁移 + 空库断言 + 重跑全绿 + 重演幂等零迁移；基线契约 21 迁移/57 model 同步；文档泄漏扫描 exit 0。安全门禁 2 高位为 SEC-2026-002 记录在案残留（2026-08-29 到期），本 SPEC 零新增例外。已知非阻断项 §7 共 12 条照录（含并集口径注记），follow-up 路由 10 条归专项。按项目约束零 git 操作，本地闭环。

**终审（2026-08-01，opus 全分支）**：**MERGE-READY**。三使命完成——①台账 17 项 Minor + follow-up 路由全部 triage 裁决（fix-now 0 / accept 11 / follow-up-SPEC 6：漂移 4 项、前端 flake 治理、Cost 编辑态锚点 UX、refund.approve 真实 Step-Up、SEC-2026-002 安全专项）；②跨任务接缝六面逐一直读核验零 Critical 零 Important（118 权限端到端 catalog→迁移→router→菜单/按钮→scope 双键；12 事件键集 registry→服务→测试闭合含 payment.voided CONTRACT 源模块；22 路由与 5 API 客户端逐条对齐；anomaly total=候选池跨 service→controller→前端→API 测试 :214 一致；PAYMENT_STATUS 五处一致；死代码/静默错误/安全面无新增）；③终审新增 Minor×6 全部非阻断 UX/文案/文档级（M1 anomaly 分页 showTotal 文案、M2 行跳转跨权限死角、M3 invoiceNo 标签不实建议转 follow-up、M4 refund.approve CRITICAL 客户端 Modal 形态、M5 first-sign none 不套 scope、M6 创建期合同探查 TOCTOU 窗）。closeout 前必须修复项：无。
