# 谈案 / 合同 / 收款 运维手册（SPEC-010）

适用范围：谈案（Negotiation）创建/更新/完结，合同（Contract）四类型全生命周期（创建→提交→审批→签署→生效→终止/作废），应收计划（PaymentPlan）生成与收款（Payment）登记/财务确认。
后端实现：`apps/server/app/application/contract/`（negotiation-service / contract-service / receivable-service / contract-number-service / contract-scope / 三投影）；领域纯函数 `app/domain/contract/`；路由 `app/router.ts:168-192`（`/api/v1/negotiations*`、`/api/v1/contracts*`、`/api/v1/payments*`，恰 20 条）。

---

## 1. 配置项

本模块**不新增任何环境变量**。运行依赖既有基建：PostgreSQL 数据源（`DATABASE_URL`）、事件 outbox（SPEC-007）、授权上下文（SPEC-004）。无特性开关、无阈值参数。

## 2. 合同状态机（`app/domain/contract/contract-policy.ts`）

状态词汇：`DRAFT / PENDING_APPROVAL / PENDING_SIGN / SIGNED / EFFECTIVE / TERMINATED / VOID`。
动作词汇（7 个）：`submit / approve / reject / sign / effect / terminate / void`。

```
DRAFT ──submit──▶ PENDING_APPROVAL（requiresApproval 类型）/ PENDING_SIGN（否则）
PENDING_APPROVAL ──approve──▶ PENDING_SIGN
PENDING_APPROVAL ──reject──▶ DRAFT
PENDING_SIGN ──sign──▶ SIGNED
SIGNED ──effect──▶ EFFECTIVE（仅 generatesReceivable 类型）
EFFECTIVE ──terminate──▶ TERMINATED
DRAFT | PENDING_APPROVAL | PENDING_SIGN ──void──▶ VOID
```

- **判定次序钉死**：政策门禁（approve 仅 requiresApproval 类型、effect 仅 generatesReceivable 类型）先于流转表判定；`TERMINATED`/`VOID` 为终态，任何动作返回 null → `CONTRACT_STATE_TRANSITION_INVALID` 409。
- `RISK_NOTICE` 因 `terminalAtSigned=true` 且无 effect 边，`SIGNED` 即事实终态。
- 全部流转动作经 version 乐观锁（`updateMany {id,version}`，count≠1 → `VERSION_CONFLICT` 409）；effect 为**先翻转后副作用**（翻转失败整事务回滚，零副作用残留）。

### 2.1 类型政策（审批配置，`CONTRACT_TYPE_POLICY`）

| 类型 | requiresApproval | generatesReceivable | terminalAtSigned |
|---|---|---|---|
| FIRST_SIGN（首签） | ✔ | ✔ | — |
| FORMAL（正式委托） | ✔ | ✔ | — |
| SUPPLEMENT（补充协议） | ✔ | ✔ | — |
| RISK_NOTICE（风险告知） | — | — | ✔ |

政策表是**唯一**审批路径配置面：无独立审批流引擎，approve/reject 端点 + `contract.approve` 权限即全部。RISK_NOTICE 不可达 PENDING_APPROVAL（submit 直进 PENDING_SIGN），故 reject 对全类型仅按流转表字面判定。

### 2.2 谈案状态（`NEGOTIATING / SIGNED / UNSIGNED`）

仅 `NEGOTIATING` 可 update/close；完结二结局：SIGNED（置 signedAt、拒收 unsignedReason——矛盾载荷 400）/ UNSIGNED（**必填** unsignedReason，400）；终态再完结 409。同事务发 `negotiation.closed`（载荷仅 `{negotiationId, status}`，unsignedReason 不入载荷、审计查库）。

## 3. 编号规则（CON-02，`contract-number-service.ts`）

### 3.1 合同编号（序列号）

格式：`{类型码}-{分所码}-{团队码}-{yyyy}-{4位流水}`，例 `FS-ZS01-YL-2026-0007`。

- 类型码：FIRST_SIGN→**FS**、FORMAL→**WT**、SUPPLEMENT→**SA**、RISK_NOTICE→**RN**。
- 分所/团队缺省 **HQ**/**ALL**；yyyy=UTC 年。
- 序列按 `scopeKey=类型|分所|团队|年份` 独立计数（`contract_number_sequence` 表）；取号在调用方事务内 `INSERT ... ON CONFLICT ("scopeKey") DO UPDATE ... RETURNING` 原子完成（唯一索引行级锁串行化并发）。
- **净化纪律（裁决方案 a）**：Organization/ProfessionalTeam 的 code 词汇表 `STABLE_CODE=/^[A-Z][A-Z0-9_]{1,31}$/` 允许 `_`，而编号格式钉死 `^(FS|WT|SA|RN)-[A-Z0-9]+-[A-Z0-9]+-\d{4}-\d{4}$` 不含 `_`——branchCode/teamCode 入参先经 `replace(/[^A-Z0-9]/g,'')` 净化，**scopeKey 与编号输出同源使用净化后值**（防分叉）；净化后为空串回落缺省 HQ/ALL。改净化规则必须双处同源，禁止分别实现。
- **跳号可接受**：调用方事务回滚使序列已 +1 而合同未落库 → 编号跳空。设计 §5.1 钉死"编号不重用作废语义"，**禁止**为消灭跳号做补偿/回收逻辑。

### 3.2 同类业务编号（随机码，非序列）

`makeBusinessNo` 薄封装：应收计划 **PP** / 收款 **PY** / 谈案 **NE** / 分析委托 **AE** / 案件 **CA**（与 SPEC-009 既有 L/AP/CU 无冲突）。P2002 碰撞重试上限 2 在调用方（同 lead-service `BUSINESS_NO_RETRY_LIMIT` 纪律），生成模块纯函数不落库。

## 4. 生效事务矩阵（CON-06/CON-07，`contract-service.effectContract`）

`effect` 不复用流转骨架（事件类型不同 + 副作用矩阵 + effectiveDate 入参），步骤序严格钉死：

1. `requireAction('contract.effect')` 首行 → 动作级数据范围探查；
2. **EFFECTIVE 幂等首查**：重放返回现状投影，零副作用、零事件、零审计；
3. 状态机 effect 判定（RISK_NOTICE 政策门禁 409）；
4. version 乐观锁翻转（**先翻转后副作用**；count≠1 → VERSION_CONFLICT 整事务回滚）；
5. **矩阵副作用**（类型驱动）：
   - FORMAL：**风险告知门禁**——同客户无 SIGNED 态 RISK_NOTICE → `RISK_NOTICE_MISSING` 409；
   - `generatePlansForEffect` 应收计划生成（见 §5.1）；
   - FIRST_SIGN → 分析委托（AnalysisEngagement）最小建档；FORMAL → 案件（Case，`caseType='GENERAL'`/`status='PENDING'`）最小建档；
6. `contract.effective` v1 事件（恰 6 键，**不发** status_changed）；
7. OperationLog（标识符/计数，无自由文本）→ 重读投影。

**矩阵内任一步失败整事务回滚（含翻转）——零计划、零案件/委托、零事件残留。** 生效不产生第二事件（`contract.status_changed` 只覆盖 submit/approve/reject/sign/terminate/void 六动作）。

### 4.1 终止 / 作废

terminate/void 复用流转骨架：reason **必填**（400）；原因持久化在合同行 `terminateReason`/`voidReason` 业务列（scope 内可读），审计只落 `{hasReason: true}` 布尔——自由文本绝不进 OperationLog。terminate 触发**终止-计划联动**（SPEC-012）：未清计划（PENDING/PARTIAL）转 CANCELLED（期望作废、已收不动、零资金移动）、在途退款/收款互斥 `CONTRACT_TERMINATE_CONFLICT` 409、confirm 竞速门禁 `PAYMENT_STATE_INVALID` 409、逐计划事件 `payment_plan.cancelled`（第 13 类）——完整处置政策详见 `finance-operations.md` §2.5。SUPPLEMENT 生效不复查父合同状态（设计 §6.2 字面维持）。

## 5. 应收计划与收款（CON-07 / FIN-01，`receivable-service.ts`）

### 5.1 计划生成（生效事务内）

- `contract.paymentTerms`（String? JSON 文本）形态：`{"plans":[{"period":1,"dueDate":"2026-09-01","amount":"5000.00"}]}`；null/空串 → **默认一期** `{period:1, dueDate: effectiveDate+30天, amount: contract.amount}`。
- 校验：JSON 畸形/结构不符（含未知键）/期次非 1..N 连续/单期金额非法（非负、scale≤2）/合计≠合同金额（Decimal 精确比较）→ 一律 `RECEIVABLE_PLAN_MISMATCH` 400（单码覆盖全类计划校验）。
- planNo=PP 前缀随机码；receivedAmount/status 走 schema 默认 0/PENDING。
- createdBy 必填 = effect 操作者（签名四参 `(tx, contract, effectiveDate, createdBy)`）。

### 5.2 收款登记（createPayment）

合同探查（范围包裹+未删）→ 状态门禁（**仅 SIGNED/EFFECTIVE 放行**——草稿禁收款）→ paymentPlanId 4a 探针（plan 存在且属该合同，否则 400）→ 金额 >0 且 scale≤2 → PY 编号 P2002 重试上限 2 → customerId 抄自合同（冗余双锚）→ status PENDING → 同事务 `payment.created`（恰 5 键）+ OperationLog（标识符+金额 only，remark/method/account 落行不落审计）。

### 5.3 财务确认（confirmPayment，三方同事务联动）

1. payment 探查（`{contract: scope}` 包裹+未删，404）；
2. **事务内首把锁 = Contract 行 FOR UPDATE**——同合同确认互斥，并发确认在此串行，冲抵读写只见已提交一致态；
3. **幂等翻转** `updateMany {id,version,status:'PENDING'}` → count=0 重读：已 CONFIRMED → **返回现状投影零重冲**（幂等重放，零事件零审计；`PAYMENT_ALREADY_CONFIRMED` 保留词位不抛——裁决⑤幂等语义优先）；其他 → VERSION_CONFLICT 409；
4. **冲抵（仅胜者）**：指定 paymentPlanId → 该期单期冲抵；未指定 → status∈{PENDING,PARTIAL} 计划按 `dueDate,period` 升序贪心扫；每期 `applied=min(剩余, plan.amount−plan.receivedAmount)`（期内永不溢出）；期状态派生 received=0→PENDING、0<received<amount→PARTIAL、received≥amount→RECEIVED；无计划行（SIGNED 未生效）冲抵 vacuous，合同级累计为唯一约束；扫完仍有剩余或合同级 `receivedAmount+amount>amount` → `PAYMENT_AMOUNT_EXCEEDED` 409 **整事务回滚零残留**；
5. `Contract.receivedAmount += amount`（互斥保护下 plain update 合法）；
6. `payment.confirmed` v1（恰 3 键）+ OperationLog → 重读投影。

> **SPEC-012 例外（TERMINATED 合同）**：confirm 在持锁重读合同后、幂等翻转前评估 `contract.status==='TERMINATED'` → `PAYMENT_STATE_INVALID` 409（门禁先于幂等翻转——已 CONFIRMED payment 在已终止合同上的 confirm 得 409 而非幂等重放现状，系有意：合同关停即资金操作整体失效）。详见 `finance-operations.md` §2.5 竞速门禁。

### 5.4 OVERDUE 查询时推导（纪律）

`PaymentPlan.status` 词汇含 OVERDUE 词位（schema 注释/视图类型保留），**任何写入路径永不落库**——逾期语义 = 查询时按 `dueDate < now AND status=PENDING|PARTIAL` 推导。禁止新增"定时刷新 OVERDUE"任务或写入触发器。

## 6. 事件清单（SPEC-007 outbox，全部同事务写入，v1 载荷键集钉死）

| eventType | 载荷键集 | 触发 |
|---|---|---|
| `negotiation.created` | `{negotiationId, customerId, negotiatorEmployeeId, status}` | 谈案创建 |
| `negotiation.closed` | `{negotiationId, status}`（status∈{SIGNED,UNSIGNED}） | 谈案完结 |
| `contract.created` | `{contractId, contractNo, contractType, customerId, sourceType}`（sourceType∈CUSTOMER/NEGOTIATION/ANALYSIS/CASE） | 合同创建 |
| `contract.status_changed` | `{contractId, fromStatus, toStatus}` | submit/approve/reject/sign/terminate/void 六动作 |
| `contract.effective` | `{contractId, contractType, customerId, planCount, caseId, engagementId}`（caseId/engagementId 允许 null 占位） | 生效（替代 status_changed） |
| `payment.created` | `{paymentId, paymentNo, contractId, customerId, status}` | 收款登记 |
| `payment.confirmed` | `{paymentId, contractId, status}`（status∈{CONFIRMED}） | 财务确认 |

事件投递运维（重放/隔离/健康/worker）见 SPEC-007/008 既有 runbook；本模块不新增订阅、不新增投递面。

## 7. 权限与数据范围

- **16 个权限码**（目录 `app/domain/authorization/permission-catalog.ts`）：菜单 `menu.contract`/`menu.payment`；动作 `negotiation.read/create/update`、`contract.read/create/submit/approve/sign/effect/terminate/void`、`payment.read/create/confirm`（其中 `contract.void`/`payment.confirm` 为占位升级 ACTION/HIGH，余 14 个全新）。
- 数据范围：Contract/Payment 查询锚定合同列（SELF→createdBy 链、TEAM/BRANCH/ORG→branch/team 列；Payment 经 `{contract: …}` 关系包裹）；Negotiation 锚自身组织列。不可见统一 404 不泄露存在性。
- 金额字段非 L3 不脱敏（设计 §8 决策，以数据范围+动作权限控制）；审计只落编号/类型/id/状态/金额与布尔存在性，**approvalComment/unsignedReason/remark 等自由文本落行不落审计**。
- 角色授予走角色管理 API（`PUT /api/v1/roles/:id/permissions`）；无业务角色 seed。

## 8. 错误码表（HTTP 语义稳定码；ContractError 按实例 httpStatus 透传）

| code | status | 场景 |
|---|---|---|
| `CONTRACT_NOT_FOUND` | 404 | 合同不存在或不可见（不泄露存在性） |
| `NEGOTIATION_NOT_FOUND` | 404 | 谈案不存在或不可见 |
| `PAYMENT_NOT_FOUND` | 404 | 收款不存在或不可见 |
| `CONTRACT_STATE_TRANSITION_INVALID` | 409 | 非法状态流转（含非 SIGNED 收款状态门禁、终态再完结） |
| `CONTRACT_APPROVAL_PENDING` | 409 | 审批中阻断语义（词位保留） |
| `RISK_NOTICE_MISSING` | 409 | FORMAL 生效缺已签风险告知 |
| `PAYMENT_ALREADY_CONFIRMED` | 409 | 重复确认（**词位保留不抛**——幂等重放返回现状，见 §5.3） |
| `PAYMENT_AMOUNT_EXCEEDED` | 409 | 冲抵扫完仍有剩余 / 合同级累计溢出 |
| `RECEIVABLE_PLAN_MISMATCH` | 400 | paymentTerms 计划校验全类失败 |
| `VALIDATION_FAILED`（复用 MasterDataError） | 400 | 入参校验失败（伪造 appointmentId/negotiationId 矛盾载荷、期次结构等） |
| `VERSION_CONFLICT`（复用 MasterDataError） | 409 | 乐观锁竞争败北 |

## 9. 运维注意

- **权限 provisioning 双纪律（必须复述）**：①权限表供给**只 INSERT + 幂等 UPDATE**——新码经迁移 `INSERT ... ON CONFLICT ("code") DO NOTHING`（先例 `20260730090000`/`20260730150000`），占位升级经显式幂等 `UPDATE ... SET type/riskLevel WHERE code IN (...)`；**role_permission 永不由 provisioning 迁移触碰**。②合同模板表供给 **只 `INSERT ... ON CONFLICT ("code") DO NOTHING`**（`20260731090000`：FIRST_SIGN_STANDARD/FORMAL_STANDARD 各一行，version=1、enabled=true、createdBy='system'）——模板的启用/停用/改版是业务操作，迁移绝不 UPDATE/DELETE 模板行。新增权限码/模板时必须同步 provisioning 迁移，否则 fresh 库 FK 阻断/引用 400（无 seed 通道，迁移即真相）。
- **OVERDUE 永不落库**：查询时推导（§5.4）。
- **编号跳号可接受**：禁止补偿/回收（§3.1）。
- **迁移/模型计数期望四处协调**：`scripts/ci/check-baseline-contract.ts`（CANONICAL 双常量）+ `test/ci/baseline-contract.test.ts`（7 个 fixture 期望消息 + fixture 模型生成器与 model 总数 parity）+ `test/db/spec-008-event-observability-migration-contract.test.ts`（迁移总数）+ `test/db/schema-contract.test.ts`（model 总数两处）——新迁移/新模型落地需四处同步（本 SPEC 收官：**19 迁移 / 54 model**）。
- **测试环境指纹**（承 SPEC-009）：并行负载/内存压力下 Egg boot 偶发 `APP_KEYS is required`（密钥注入竞态）——静默窗口重试即绿，非代码回归；共享 `_test` 库 reset 级操作前必须探 `pg_stat_activity` 静默窗口（双渠道共用）。
- **安全审计现状**（2026-07-31）：`security:audit:prod` 现存 2 个 production_high（exit 1，记录在案不阻断）——brace-expansion GHSA-mh99-v99m-4gvg（egg-scripts→glob@7 链无补丁版，egg 工具链专项）与 react-router GHSA-qwww-vcr4-c8h2（SEC-2026-002 登记，2026-08-29 到期，v8 迁移专项）。本 SPEC 未新增例外。
- 数据库：PostgreSQL（生产 55432；测试 55433 `_test` 库）。本 SPEC 新增迁移 3：`20260730120000_negotiation_contract_payment_expand`（7 表 + Case.lawyerId 可空）、`20260730150000_contract_permission_provision`（16 权限行）、`20260731090000_contract_template_provision`（2 模板行）。
