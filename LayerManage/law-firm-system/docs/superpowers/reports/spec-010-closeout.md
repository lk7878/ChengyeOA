# SPEC-010 谈案 / 合同 / 收款 — 收尾报告

日期：2026-07-31 ｜ 状态：**本地闭环**（Task 1-11 全部 Approved + Task 12 验收闸门全绿）
需求来源：docs/spec/modules/MOD-004-lead-crm.md（CRM-07 谈案）+ MOD-006-contract-finance.md（CON-01~07 合同、FIN-01 收款）
设计：docs/superpowers/specs/2026-07-30-negotiation-contract-payment-design.md ｜ 实施台账：.superpowers/sdd/2026-07-30-negotiation-contract-payment/progress.md

## 1. 交付范围

- **谈案（CRM-07）**：创建（四组织锚解析序：显式输入 > leadId 继承 > null；客户/员工/线索/邀约 4a 探针）→ 更新（仅 NEGOTIATING）→ 完结（SIGNED 置 signedAt / UNSIGNED 必填原因；矛盾载荷 400）。
- **合同（CON-01~06）**：四类型（FIRST_SIGN/FORMAL/SUPPLEMENT/RISK_NOTICE）× 四来源（CUSTOMER/NEGOTIATION/ANALYSIS/CASE）创建（模板快照引用 CON-01、合同编号 CON-02、内嵌审批 CON-04、电子签字段预留 CON-05）；状态机七动作（CON-06）；生效事务矩阵（FIRST_SIGN→分析委托最小建档、FORMAL→风险告知门禁+案件最小建档）；终止/作废（reason 必填、落行不落审计）。
- **应收与收款（CON-07/FIN-01）**：生效事务内计划生成（paymentTerms JSON 或默认一期）；收款登记（仅 SIGNED/EFFECTIVE 状态门禁）；财务确认三方同事务联动（Contract 行 FOR UPDATE 互斥 → 幂等翻转 → 贪心冲抵 → 溢出整事务回滚）。
- **事件**：7 类 v1 事件 outbox 同事务写入（载荷键集注册表钉死）。
- **权限与范围**：16 个权限码（14 新 + contract.void/payment.confirm 占位升级 ACTION/HIGH）迁移 provisioning；动作级数据范围（Payment 经 `{contract: …}` 关系包裹，`resource='payment'` 派发修正 S15）。
- **HTTP 层**：恰 20 条守卫路由（negotiations 5 + contracts 11 + payments 4）+ 原型路由 404 锁 6 条（PUT/DELETE contracts/:id、ledger 殊途同归、PUT/DELETE payments/:id、refund）。
- **前端**：api 客户端 ×3 + stores ×2 + 页面 ×5（谈案列表/合同列表/合同详情/合同创建向导/收款列表）+ 状态机按钮矩阵 meta.ts；原型 Contract/Payment 页删除、business.ts 手术（caseApi/dashboardApi 保留）；E2E 排练 spec（env 驱动静态交付，同 lead-crm-flow 先例）。
- **运维**：runbooks/negotiation-contract-payment.md。

## 2. 工具链

Egg.js 3 + TypeScript / Prisma 5.22 / PostgreSQL 16（生产 55432；测试 55433 `_test` 库）/ Node test runner（后端串行 `--test-concurrency=1`，逐文件枚举——tsx 不接受目录实参）/ React 19 + AntD 6 + Zustand / Vitest 4 + Playwright（排练式）/ 运行时 Node v24.18.0（见 §8 对账④）。

## 3. 测试计数链

### 3.1 各任务计数（后端全部串行）

| Task | 交付 | 计数 |
|---|---|---|
| 1 | schema + 迁移 20260730120000 + 重演契约 | 重演测试 4/4；实测新基线 model 54 / 迁移 17 |
| 2 | 权限目录 +16（14 新 + 2 升级）+ 迁移 20260730150000 | 新测试 9/9；authorization 套件 65/65；目录计数 87→**101** |
| 3 | contract-policy 状态机 + ContractError 9 码 | contract-policy 26/26 |
| 4 | 7 类事件注册 + 常量 | contract-events 43/43 |
| 5 | contract-number-service（CON-02） | 10/10 |
| 6 | negotiation-service | 24/24（Task 10 补 2 例后 26/26） |
| 7 | contract-service A（创建/提交/审批/驳回/签署）+ CON-01 模板迁移 20260731090000 | 23/23 |
| 8 | effect 生效矩阵 + terminate/void + generatePlansForEffect | +23（contract-service 15 + receivable 8）→ 目录 158/158 |
| 9 | 收款段（create/confirm/list/listPlans） | +27 → 目录 185/185 |
| 10 | factory + 3 控制器 + 20 路由 + 404 锁 | 新 API 22/22（negotiation 7/contract 8/payment 7）；权威闸门 **354/354**（test/app 167 + test/contract 187） |
| 11 | 前端全量 | Vitest **36 文件 129 例**（+13 新）；lint 0 err/5 warn（预存）；typecheck 0；build PASS |
| 12 | 验收与收尾（本报告） | 见 §3.2 |

### 3.2 最终全量（Task 12 验收跑）

| 闸门 | 结果 |
|---|---|
| 后端全量串行（163 文件，排除 2 个 55432 锁定排练件） | **1364 tests / 1360 pass / 0 fail / 4 skipped**（skip=pkg smoke 预存） |
| └ spec-008-acceptance 非锁定例（--test-name-pattern 保留） | 3/3 |
| └ 排除（实测失败、非回归） | spec-008-acceptance 2 例 + event-observability-load 1 例（rehearsal guard 硬编码 localhost:**55432**，本机测试库 55433 → guard fail-fast；源码护栏不可绕，SPEC-008 设计如此） |
| 迁移重演 + 空库断言 + 空库重跑 | `db:reset:test`（19 迁移重放）→ `db:assert-empty` PASS → test/contract **187/187** |
| provisioning 迁移-only 实证（reset 后零种子直查） | permission=**101**（16 码逐字段=目录：id/code/name/type/resource/action/riskLevel/status/path↔route，14 新 version=1 + 2 升级 ACTION/HIGH）+ contract_template=**2**（FIRST_SIGN_STANDARD/FORMAL_STANDARD，version=1、enabled=true、createdBy='system'） |
| security:test | 34/34 |
| check:baseline / check:bootstrap / check:docs-leakage | PASS / PASS / exit 0 |
| 前端四闸门复跑确权 | test 129/129、lint 0 err/5 warn、typecheck 0、build PASS（与 Task 11 逐字一致） |

后端有效覆盖合计 **1367 例**（1364 + spec-008 保留 3），0 fail；3 例 port-locked 排练件按实测排除（依据见上）。

### 3.3 终审修复轮（2026-07-31，全分支终审 NEEDS FIXES 裁决 F-1~F-4）

| 修复项 | 内容 | 测试变化 |
|---|---|---|
| F-1 stuck-SIGNED 根除 | receivable-service 导出 `assertPaymentTermsStructurallyValid`（复用同一解析器只验不建）；createContract paymentTerms≠null 时预验（金额缺省视 Decimal(0)）→ RECEIVABLE_PLAN_MISMATCH 400 零写入；effect 校验不变双闸 | contract-service.test.ts +1（畸形 6 变体 create 拒）；receivable-service.test.ts +2（预验正/反例族） |
| F-2 dueDate ISO 校验 | parsePlanEntry 裸 new Date() → ISO 正则+真实日历日校验（等效 parseIsoDate，单码纪律不变） | receivable-service.test.ts +1（非 ISO 3 形态 effect 路径拒）；create 侧非 ISO 变体并入 F-1 用例 |
| F-3 模板 parity 常驻钉死 | 新 domain 常量 `CONTRACT_TEMPLATE_CATALOG`（app/domain/contract/contract-template-catalog.ts，2 行 5 字段）+ 静态 parity 契约（沿 SPEC-009 F-1 形态，双向：目录→INSERT 逐字段 + 行数=目录长度）；双向变异实证转红 | 新 test/db/spec-010-contract-template-provision-contract.test.ts 3 例 |
| F-4 死类型清理 | types/index.ts 删原型 Contract/Payment interface（零消费者实证）；Case.contract 随删、DashboardAlerts.overduePayments 改 unknown[]（仅 .length 消费） | 零新测试；前端 typecheck 0 / lint 0 err（5 warn 预存）复跑 |

聚焦复跑计数（终审包豁免纪律，仅修复面）：test/contract 两文件 39+38 全绿；F-3 parity 文件 3/3；test/contract 全目录串行 **191/191**（187 基线 +4 新例）；contract-api.test.ts 复跑全绿（RECEIVABLE_PLAN_MISMATCH 段随 F-1 双闸重钉：create 闸 400 新增 + effect 闸遗产行注入——F-1 必然波及的同步件，差异面申报）；`tsc --noEmit` 0；eslint 改动文件 0。

## 4. 迁移与模型

- 新增迁移 3：`20260730120000_negotiation_contract_payment_expand`（Negotiation/Contract/ContractTemplate/ContractNumberSequence/PaymentPlan/Payment/AnalysisEngagement 7 表 + Case.lawyerId 可空 + Customer/Employee 反向关系）、`20260730150000_contract_permission_provision`（16 权限行：14 INSERT + 2 幂等 UPDATE 升级）、`20260731090000_contract_template_provision`（2 模板行，ON CONFLICT DO NOTHING）。
- **迁移总数 19（16→19）；model 总数 54（49→54）**。
- 基线契约同步点（本 Task 12 落地）：`check-baseline-contract.ts`（49→54 / 16→19）+ `baseline-contract.test.ts` 7 fixture 期望消息 + fixture 模型生成器 48→53 + `spec-008-event-observability-migration-contract.test.ts`（16→19）+ **`schema-contract.test.ts` 两处 49→54（全量跑发现的第 4 同步点，brief 三点之外）**。
- **Task 12 追加修复（同族封闭）**：`assert-empty-application-tables.ts` 排除清单 +ContractTemplate——Task 7 模板供给迁移使 reset 后 contract_template=2，未排除则 `db:assert-empty` 与 **SystemBootstrapService :60 生产 bootstrap 空库门禁**双双误报"Application data exists without initialization"（与 SPEC-009 EventSubscription 排除同族；测试夹具 truncate+目录播种从不暴露迁移真实供给，故 11 轮任务测试未捕获——迁移-only 实证路径捕获）。

## 5. 关键裁决记录（协调者裁决）

1. **权限计数 101（非 103）**：contract.void/payment.confirm 自 SPEC-001 基线以 SPECIAL/CRITICAL 惰性占位存在，SPEC-010 就地升级 ACTION/HIGH 正式启用，净新增 14 码（87+14=101）。
2. **CON-01 模板供给并入 Task 7**：独立迁移 20260731090000；恰好 2 行（SUPPLEMENT 引用被扩展模板族、RISK_NOTICE 无模板设计）。
3. **编号净化方案 a**：branchCode/teamCode 入参 `replace(/[^A-Z0-9]/g,'')` 净化，scopeKey 与编号输出同源使用净化后值（STABLE_CODE 允许 `_` 而编号格式钉死不含 `_`），净化后空串回落 HQ/ALL。
4. **effect/terminate/void 形态**：terminate/void 复用 transitionContract 骨架（changes/auditExtras 注入，原因落行业务列、审计仅 hasReason 布尔）；effect 另写（事件类型不同+副作用矩阵+effectiveDate 入参），步骤序钉死：requireAction 首行 → 范围 → EFFECTIVE 幂等首查（重放零副作用）→ 状态机 → **先翻转后副作用** → 矩阵 → contract.effective（恰 6 键，不发 status_changed）→ 审计 → 重读；矩阵内任一步失败整事务回滚零残留。
5. **confirm 幂等语义（裁决⑤）**：幂等翻转败者重读已 CONFIRMED → 返回现状投影零重冲（零事件零审计）；PAYMENT_ALREADY_CONFIRMED 保留词位不抛——幂等重放语义优先。
6. **收款状态门禁**：仅 SIGNED/EFFECTIVE 放行登记（草稿禁收款，CONTRACT_STATE_TRANSITION_INVALID 409）；签约即收款（SIGNED 未生效无计划行时冲抵 vacuous，合同级累计为唯一约束——裁决④）。
7. **计划校验单码**：paymentTerms 全类校验失败（畸形/未知键/期次断裂/金额非法/合计不符）一律 RECEIVABLE_PLAN_MISMATCH 400。
8. **事件载荷键集**：negotiation.closed 恰 2 键（unsignedReason 不入载荷，审计查库）；contract.effective 恰 6 键（caseId/engagementId 允许 null 占位）；closed/confirmed 事件限定结局子集（事件名即结局）。
9. **组织锚解析序**（Task 6 裁决 1）：显式输入 > leadId 继承 > null（Customer 无组织列）。
10. **EventLog FK 探针**（裁决 4）：创建探针组织/团队 id+code（缺失 400），杜绝 event_log Restrict FK P2003 路径。
11. **S16 追认**：Task 10 路由表含 `GET /api/v1/payments/:id` 而 Task 9 服务层无详情方法——实现者以三选分析（补纯读方法/控制器直查/撤路由）申报，最小风险闭合（逐字镜像 getContract 探查段），协调者审查追认。
12. **brief 计数修正**：计划陈旧"16→18"修正为 **16→19**（实际新增 3 迁移），三处同步点全部按 19（本 Task 12 执行中发现第 4 同步点 schema-contract.test.ts，一并按 54/19 同步）。
13. **审计纪律（裁决 9）**：OperationLog 只落编号/类型/id/状态/金额与布尔存在性；approvalComment/unsignedReason/remark/method/account 自由文本落行不落审计。

## 6. 安全审计状态

- `security:test` **34/34 PASS**（基线不回归）。
- `security:audit:prod` exit 1，现存 **2 个 production_high**——与 SPEC-009 收官逐项一致、**本 SPEC 零新增例外**：
  - server：brace-expansion GHSA-mh99-v99m-4gvg（egg-scripts→mz-modules→glob@7 链与 override 5.0.8 不兼容且无 1.x/2.x 补丁版——egg 工具链专项）。
  - web：react-router GHSA-qwww-vcr4-c8h2（SEC-2026-002 已登记，**2026-08-29 到期**；RSC-mode CSRF 路径在本 SPA 不存在，生产门禁机制不豁免，v8 迁移专项）。
- `check:docs-leakage` exit 0（持久化文档零密钥/连接串泄漏，含本报告与 runbook）。

## 7. 已知非阻断项

1. ~~**畸形 paymentTerms → SIGNED 卡死**~~ **已修复（终审修复轮 F-1+F-2，2026-07-31）**：create 侧结构预校验（`assertPaymentTermsStructurallyValid`，复用 receivable-service 同一解析器只验不建；paymentTerms≠null 时 createContract 调用，金额缺省视 Decimal(0)；畸形/期次断裂/合计≠金额/非 ISO dueDate 一律 RECEIVABLE_PLAN_MISMATCH 400 零写入）+ effect 侧校验不变构成双闸——无 update API，create 预验一次即永真，SIGNED 卡死路径根除。F-2 同轮：dueDate 由裸 new Date() 改 ISO 形态校验（等效 parseIsoDate 语义，单码纪律不变）。
2. **SUPPLEMENT 生效不复查父合同状态**（设计 §6.2 字面维持）——父终止后补充协议仍可生效，SPEC-011 决策。
3. **terminate 不动既有应收计划**——已生成计划保持原状继续可冲抵，SPEC-011 决策（终止-计划联动）。
4. **生效前确认期次低报语义**：SIGNED 态确认（无计划行）只累计合同级 receivedAmount，后续生效生成的计划期次 receivedAmount 不回补——查询层以合同级为准。
5. **appointmentId 纯存在性探针无归属链**（Task 6 Minor② 处置维持）：伪造存在邀约 id 可挂靠，归属一致性归后续。
6. **buildContractScopeWhere resource 形参缺省哑弹面**：四参调用（缺省 resource='contract'）在 payment.* 权限码下恒空集 fail-closed——Task 7 S2/Task 9 S15 注释已钉，根治归权限治理 SPEC（目录级双键校验）。
7. ~~**types/index.ts 死 Contract/Payment 类型**~~ **已清理（终审修复轮 F-4，2026-07-31）**：原型残余 interface 删除（零消费者实证）；连带两处悬空引用处置——`Case.contract` 字段随删（零消费）、`DashboardAlerts.overduePayments` 改 `unknown[]`（页面仅消费 `.length`，服务端实回收款计划行）。前端 typecheck 0 / lint 0 err（5 warn 预存）复跑确权。
8. **Node v24.18.0 vs CLAUDE.md 记 22.14.0**：全量 1364 例零影响实证，未见行为分叉（见 §8 对账④）。
9. **设计 §5.1 scopeKey 注 ID 语义 vs 实现 code 语义**：实现按 code（编号输出与 scopeKey 同源净化值），文档对账项（见 §8 对账②）。
10. **Task 1 迁移手写未经 shadow diff**（P3014 无 CREATEDB）：以 19 迁移全量重放 + information_schema/pg_index 逐列逐索引断言 + schema-contract 常驻契约做事实对账（见 §8 对账①）。
11. **OVERDUE 词位保留未写存储态**：逾期=查询时推导（`dueDate < now AND status∈{PENDING,PARTIAL}`），任何写入路径永不落库——视图类型保留词位供查询层复用。
12. 3 例 port-55432 锁定 SPEC-008 排练件在本机（55433）恒红：环境拓扑冲突非回归（rehearsal guard 为安全护栏，源码不可绕；标准容器回迁 55432 即绿）。
13. **negotiation 显式组织锚伪造经 EventLog Restrict FK P2003→500**（全分支终审 M1）：negotiation-service 创建/更新缺少 contract 侧裁决 4 的 4a 组织锚探针——伪造 branchId/professionalTeamId 可过服务层、在同事务 event_log 写入时撞 Restrict FK（P2003）冒泡 500，vs contract 侧同类伪造 400（contract-api 已钉）。不对称但数据完整性无损：FK 兜底整事务回滚响亮失败，零脏行零事件残留；后续统一 P2003→400 映射为候选（归 negotiation 服务加固 follow-up）。

## 8. 对账项

1. **migrate diff 声明**：Task 1 迁移因 shadow DB 权限（P3014）手写 SQL。对账链 = `db:reset:test` 全量重放 19 迁移成功（本 Task 12 实证）→ 重演契约测试（information_schema 逐列/逐索引断言，Task 1 建立）→ schema-contract.test.ts model 计数同步 54 → Prisma Client generate 零漂移。手写 SQL 与 schema 的事实一致性由重放闭环坐实。
2. **设计 §5.1 措辞**：设计注"scopeKey=类型|分所|团队|年份"段语义为组织 **ID**，实现为 **code**（净化后）——实现语义正确（编号可读性 + 净化同源纪律），措辞差异记此对账，设计文档修订归 follow-up。
3. **OVERDUE 推导口径**：存储词汇 PENDING/PARTIAL/RECEIVED；OVERDUE 仅查询推导位（projection 类型保留）。口径已写入 runbook §5.4 作为运维纪律（禁止新增刷新任务/触发器）。
4. **Node 版本**：运行时实测 v24.18.0，CLAUDE.md 记 22.14.0。Task 3 起逐任务注记未见影响；本 Task 12 全量 1364 例 + 前端 129 例 + 构建全绿再次实证零行为分叉。CLAUDE.md 版本记录修订归 follow-up（非本 SPEC 改动面）。

## 9. Follow-up 路由（SPEC-011 候选）

- **FIN-02~05**：退款（REFUNDED 词位已在 Payment.status 词汇）/发票/分账/对账——非目标项转正。
- **终止-计划联动**：terminate 对未清计划的处置政策（挂起/豁免/冲销）。
- **SUPPLEMENT 父状态复查**：父 TERMINATED 后补充协议生效门禁。
- **ANALYSIS/CASE 来源向导**：前端创建向导当前覆盖 CUSTOMER/NEGOTIATION 来源，ANALYSIS/CASE 来源入口。
- **appointmentId 归属链**：存在性探针 → 归属一致性校验（与 leadId↔customerId 归属同族）。
- **fail-closed 哑弹面目录级根治**：（resource, permissionCode）双键目录校验，权限治理 SPEC。
- **E2E 见证跑**：contract-payment-flow.spec.ts 排练件生产部署前见证跑一次（承 SPEC-009 建议）。
- **安全专项**：react-router 8 迁移（SEC-2026-002，2026-08-29 到期）+ egg 工具链（brace-expansion 链）。
- **文档修订**：设计 §5.1 scopeKey 措辞、CLAUDE.md Node 版本记录。

## 10. 双渠道验收链

Task 1-11 实现者渠道实现 + 协调者渠道独立审查（每任务 task-N-review-package/coord 双件）；全部任务审查结论 Approved / 0 Critical（Task 10 absorb-review 0C/0I/2M-注记、Task 11 absorb-review 全项 ✅ 为代表）。Task 12（本任务）为验收与收尾：全量闸门 + 迁移-only 实证 + 两文档落地。

## 11. 收官状态

**SPEC-010 本地闭环（2026-07-31）**：12/12 任务完成；后端全量 1364 例 0 fail（+spec-008 保留 3 例 = 1367 有效覆盖）、test/contract 187/187、前端 129/129 四闸门绿、security:test 34/34、provisioning 迁移-only 实证（permission=101 逐字段=目录、contract_template=2）通过、迁移重演+空库断言+重跑全绿、基线契约 19 迁移/54 model 四处同步、文档泄漏扫描 exit 0。安全门禁 2 高位为 SEC-2026-002 记录在案残留（2026-08-29 到期），本 SPEC 零新增例外。已知非阻断项 12 项照录，follow-up 路由 9 条归 SPEC-011 及专项。按项目约束零 git 操作，本地闭环。
