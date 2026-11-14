# SPEC-010：谈案与合同收款设计

> 状态：**已批准**（2026-07-30 用户批准）
> 日期：2026-07-30
> 需求基线：`律所闭环管理系统需求开发文档.md` V1.0；`docs/spec/modules/MOD-006-contract-finance.md`（CON-01~06、FIN-01）；`docs/spec/modules/MOD-004-lead-crm.md`（CRM-07 谈案管理，SPEC-009 下推项）
> 前置 Spec：SPEC-001 ~ SPEC-009 已完成本地实施与验收（SPEC-009 终态：合并收官闸门 1151/1147/0/4，迁移 16，model 49）
> 关联专项设计：`docs/专项设计/数据库核心表设计草案.md`、`docs/专项设计/状态机与业务字典设计.md`、`docs/专项设计/API规范错误码与事务边界设计.md`、`docs/专项设计/数据流转事件中心设计.md`
> 横切契约：FTN-001（数据模型）、FTN-002（状态机字典）、FTN-003（RBAC 数据范围）、FTN-004（API 与事务一致性）、FTN-005（事件模型）
> 运行环境约束：本机预生产诊断线（`.codex-safe/`、55432 容器）保持隔离不动；本 Spec 在标准开发环境（55433 dev 容器、`*_test` 库）实施与验收
> 实施约束：本 Spec 经书面审核后单独生成实施 Plan；全部开发、测试在本地完成，不执行 Git 提交或远程操作

## 1. 背景与问题

SPEC-009 建成了主链路第一环（线索→公海/私海→跟进→邀约到访→客户）。PRD §17 主链路的下一环是"谈案与两类合同→收款"。当前仓库中该环只有 SPEC-001 保留的早期原型：

1. **原型 `Contract`**（schema.prisma:789）：单一 `type` 枚举（CONSULTING/RETAINER/...）不区分 PRD 要求的四类合同对象（首签/证据收集、正式委托、补充协议、风险告知书）；`status` 枚举（DRAFT/PENDING/APPROVED/SIGNED/EXECUTING/COMPLETED/TERMINATED/CANCELLED）与 FTN-002 状态字典（草稿、审批中、待签署、已签署、生效中、已终止、已作废）不对齐；无编号规则（CON-02 要求合同类型+分所+专业团队+年份+流水号）；无模板关联；无电子签预留字段（CON-05）；无 `version`/`deletedAt`/`updatedBy` 通用审计字段；无数据范围锚（branchId/professionalTeamId）。
2. **原型 `Payment`**（schema.prisma:820）：无 `PaymentPlan` 应收计划对象——CON-07"合同生效必须生成应收计划"在现有 schema 上根本无法表达；收款确认（FIN-01）要求的 Payment/PaymentPlan/Contract 收款状态同事务联动无从谈起。
3. **原型路由无权限守卫**：`router.ts:169-187` 的 10 条 contract 路由 + 7 条 payment 路由全部裸挂（含物理删除 `DELETE /contracts/:id`、`DELETE /payments/:id`），与 SPEC-009 T10 根除的 lead/customer 原型同型同害。
4. **谈案对象缺失**：CRM-07（谈案人、报价、客户关注点、竞争对手、未签原因）是 SPEC-009 明确下推项，schema 无 Negotiation 表；MOD-004 §6 回归验收要求"线索到正式签约主链路必须有端到端用例，覆盖归因、分配、跟进、邀约、谈案、合同、收款、案件建档全链路"——谈案与合同是该链路缺失的两个中间环。
5. **审批底座缺位**：CON-04 要求两类合同分别配置审批流，但审批任务引擎（ApprovalDefinition/Instance/Task/CallbackAction）无 SPEC（属 MOD-013 底座缺口）。
6. 合同/收款不产出业务事件，与 SPEC-007 事件中心脱节；`Case` 原型（schema.prisma:845）存在但无建档入口，正式委托合同生效事务验收（合同状态+应收计划+案件建档+风险告知同事务）无落点。

本 Spec 把谈案、四类合同全生命周期、应收计划与收款确认建成生产级，为后续财务进阶（SPEC-011）、专业团队 SOP（MOD-007）、案件交付（MOD-008）提供已建档的可承接对象。

## 2. 目标

1. 建立谈案对象（CRM-07）：谈案人、报价、客户关注点、竞争对手、未签原因；状态流转 谈案中→已签/未签；与线索/客户/邀约关联可追溯。
2. 建立合同模板最小主数据（CON-01）：首签/正式委托分别维护模板（文本+版本+启停），创建合同时引用模板版本快照。
3. 建立合同编号（CON-02）：合同类型+分所+专业团队+年份+流水号，同事务序列计数器保证唯一连续。
4. 合同创建四来源（CON-03）：从客户、谈案、分析委托或案件创建；补充协议依附父合同。
5. 内嵌单步审批（CON-04）：合同状态机内嵌"审批中"态，提交/通过/驳回三个守卫动作，按合同类型配置是否需要审批；完整审批中心下推 MOD-013 专项。
6. 电子签入口预留（CON-05）：签署链接、签署流水号、签署状态、回调载荷字段；不做真实对接。
7. 合同状态机（CON-06）：草稿、审批中、待签署、已签署、生效中、已终止、已作废，全部流转经 service 动作接口留痕。
8. 应收计划（CON-07）：合同生效同事务生成 PaymentPlan（支持分期）；计划金额合计=合同金额校验。
9. 收款确认（FIN-01）：收款登记→财务确认到账，同事务联动 Payment、PaymentPlan、Contract 收款状态；财务角色/权限独占确认动作；重复确认幂等。
10. 生效事务验收（MOD-006 §6）：首签生效=合同状态+应收计划+分析委托最小建档同事务；正式委托生效=合同状态+应收计划+案件最小建档+风险告知签署门禁同事务。
11. 事件接入：negotiation/contract/payment 关键状态变化同事务写 EventLog 接 SPEC-007；**权限码与事件订阅的 provisioning 迁移与目录同变更落地**（SPEC-009 T12/F-1 双教训纪律）。
12. 全部列表/详情接入 SPEC-004 数据范围；生效/终止/作废/审批/收款确认全量 OperationLog 审计；原型无守卫路由根除并 404 锁定。
13. 提供谈案、合同列表/详情/创建审批签署、收款登记/财务确认的桌面及响应式 Web 管理页。

## 3. 非目标

本 Spec 不实现：

1. FIN-02 开票申请、FIN-03 退款/减免、FIN-04 成本记录、FIN-05 异常数据报表（→ SPEC-011 财务进阶；`Payment.status` 保留 REFUNDED 占位）。
2. 完整审批中心（ApprovalDefinition/Instance/Task/Cc/CallbackAction 引擎、可配置多节点流、消息回调）——下推 MOD-013 专项；本 Spec 内嵌单步审批的审计字段与未来引擎迁移兼容。
3. 电子签真实对接（签章平台 API、回调接收端点）；仅按 CON-05 预留字段。
4. 案件完整生命周期（MOD-008）、分析委托 SOP 与材料任务明细（MOD-007）——本 Spec 仅生效事务内最小建档（Case/AnalysisEngagement 各一行核心字段）。
5. 合同正文在线编辑/富文本版本比对；模板为纯文本+整数版本号。
6. 客户全景聚合页（CUS-05）；分账、提成、自动结算（PRD §3.5 明确不做）。
7. 收款渠道/支付网关对接；收款登记为线下到账的人工录入+财务确认。
8. 首签未二签等经营预警（FIN-05 族，下推 SPEC-011）。
9. 考勤人事、品牌获客界面等无关域。

## 4. 模块边界与架构

遵循 PRD §7.1 主数据唯一数据源与 SPEC-003/009 已验证分层：Controller 仅 HTTP 适配+授权中间件，业务规则收敛应用服务。

| 应用服务 | 职责 | 唯一数据源 |
|---|---|---|
| `negotiation-service` | 谈案创建/更新/完结（已签/未签） | Negotiation |
| `contract-service` | 合同创建（四来源）、提交/审批/驳回、签署登记、生效、终止、作废 | Contract + ContractTemplate |
| `contract-number-service` | 合同编号（类型+分所+团队+年份+流水），同事务序列计数 | ContractNumberSequence |
| `receivable-service` | 应收计划生成（生效触发）、收款登记、财务确认、三方状态联动 | PaymentPlan + Payment |
| `contract-projection` / `payment-projection` | 按调用者权限的输出投影 | — |

Controller：`app/controller/negotiation.ts`（新建）、`contract.ts`（整体重建原型）、`payment.ts`（整体重建原型）。

边界约束：
- `Case`/`AnalysisEngagement` 仅做最小建档写入与只读引用，其管理动作（分派/办理/办结）属 MOD-007/008 SPEC。
- 事件复用 SPEC-007 EventLog + 订阅/投递；本 Spec 新增事件类型注册，订阅 provisioning 迁移同步（本 Spec 无新订阅则仅注册类型）。
- 模板不做 UI 编辑器；系统内置两条初始模板（首签/正式委托）经迁移供给，管理界面下推。
- 不碰 Lead/Customer/Appointment 冻结服务层；谈案经 customerId/leadId/appointmentId 只读引用。

## 5. 数据模型

### 5.1 新增模型

#### Negotiation（谈案）
- `negotiationNo String @unique`（可读编号，复用 makeBusinessNo 前缀 `NE`）
- `customerId String`（FK）；`leadId String?`、`appointmentId String?`（溯源，只读引用）
- `negotiatorEmployeeId String`（谈案人，FK Employee）
- `quotedAmount Decimal? @db.Decimal(18,2)`（报价）
- `customerConcerns String?`（客户关注点）、`competitorInfo String?`（竞争对手）
- `status String @default("NEGOTIATING")`：`NEGOTIATING|SIGNED|UNSIGNED`
- `unsignedReason String?`（未签原因，status=UNSIGNED 必填）
- `signedAt DateTime?`、`remark String?`
- 组织维度：`branchId String?`、`professionalTeamId String?`（数据范围锚，创建时从客户/谈案人解析）
- 通用审计：`createdBy`、`updatedBy?`、`version`、`deletedAt?`
- 索引：`[customerId]`、`[status]`、`[negotiatorEmployeeId]`、`[branchId,createdAt]`

#### ContractTemplate（合同模板，最小）
- `code String @unique`、`contractType String`、`name`、`content String`（纯文本）、`version Int @default(1)`、`enabled Boolean @default(true)`
- 通用审计字段；初始两条（首签/正式委托）由迁移供给
- 唯一约束 `[contractType, version]` 不强制（code 已唯一）；同一类型多模板由 code 区分

#### ContractNumberSequence（编号序列计数器）
- `scopeKey String @unique`（`{contractType}|{branchId}|{teamId}|{yyyy}`）
- `lastSerial Int @default(0)`
- 同事务 `UPDATE ... SET lastSerial = lastSerial + 1 RETURNING` 取号；回滚产生跳号可接受（编号不重用作废语义）

#### PaymentPlan（应收计划）
- `planNo String @unique`（前缀 `PP`，makeBusinessNo）
- `contractId String`（FK）；`period Int`（期次，从 1 起）；`dueDate DateTime`；`amount Decimal @db.Decimal(18,2)`
- `receivedAmount Decimal @default(0)`；`status String @default("PENDING")`：`PENDING|PARTIAL|RECEIVED|OVERDUE`
- 通用审计（`version` 乐观锁必带——收款确认并发联动写）
- 索引：`[contractId,period]`、`[status,dueDate]`

#### AnalysisEngagement（分析委托，最小建档）
- `engagementNo String @unique`（前缀 `AE`）
- `customerId`、`contractId String @unique`（一首签合同对应一分析委托）
- `status String @default("PENDING")`：`PENDING|IN_PROGRESS|COMPLETED`（本 Spec 仅建档 PENDING，推进归 MOD-007）
- 通用审计；索引 `[customerId]`

### 5.2 重建原型模型

#### Contract（整体重构，原型 13 字段语义映射保留）
- `contractNo String @unique`（新规则生成，见 §6.4）
- `contractType String`：`FIRST_SIGN|FORMAL|SUPPLEMENT|RISK_NOTICE`
- `title`、`customerId`（FK）
- 来源：`sourceType String`（`CUSTOMER|NEGOTIATION|ANALYSIS|CASE`）+ `sourceId String?`；`negotiationId String?`（谈案来源直链）
- `parentContractId String?`（补充协议→父合同，自引用）
- 模板快照：`templateCode String?`、`templateVersion Int?`
- 组织维度：`branchId String?`、`professionalTeamId String?`
- 金额：`amount Decimal @db.Decimal(18,2)`、`receivedAmount Decimal @default(0)`
- 状态：`status String @default("DRAFT")`：`DRAFT|PENDING_APPROVAL|PENDING_SIGN|SIGNED|EFFECTIVE|TERMINATED|VOID`
- 审批（内嵌单步）：`submittedBy String?`、`submittedAt DateTime?`、`approvedBy String?`、`approvedAt DateTime?`、`approvalComment String?`
- 签署与电子签预留（CON-05）：`signDate DateTime?`、`esignLinkId String?`、`esignSerialNo String?`、`esignStatus String?`、`esignCallbackPayload Json?`
- 生效/终止/作废：`effectiveDate DateTime?`、`terminatedAt DateTime?`、`terminateReason String?`、`voidedAt DateTime?`、`voidReason String?`
- 通用审计：`createdBy`、`updatedBy?`、`version`、`deletedAt?`
- 保留原型语义字段：`startDate?`、`endDate?`、`paymentTerms?`（JSON 分期约定输入）、`terms?`
- 索引：`[status]`、`[customerId]`、`[contractType,status]`、`[branchId,createdAt]`、`[professionalTeamId]`
- 原型 `approvedBy/approvedAt` 语义并入内嵌审批字段；原型 `case` 反向关系保留给 §5.2 Case

#### Payment（整体重建）
- `paymentNo String @unique`（前缀 `PY`）
- `contractId String`（FK）；`paymentPlanId String?`（FK，指定冲抵期次；空=按 dueDate 顺序冲抵）
- `customerId String`（FK，冗余便于数据范围与列表）
- `amount Decimal @db.Decimal(18,2)`（本次收款金额）
- `method String?`（收款方式）、`account String?`（收款账户）、`paidAt DateTime?`（到账时间）
- `status String @default("PENDING")`：`PENDING|CONFIRMED|REFUNDED`（REFUNDED 占位，SPEC-011 启用）
- `confirmedBy String?`、`confirmedAt DateTime?`、`remark String?`
- 通用审计：`createdBy`、`updatedBy?`、`version`、`deletedAt?`（收款记录不得业务删除——FTN-001 §3.6：删除仅允许超级管理员数据干预通道，本 Spec 不提供业务删除端点）
- 索引：`[contractId]`、`[paymentPlanId]`、`[status]`、`[customerId]`

#### Case（最小改动）
- `lawyerId String?`（原型必填 → 可空：签约建档时主办律师未定，指派归 MOD-008）
- 其余原型字段不动；`status` 沿用原型枚举，建档=PENDING。

### 5.3 事件类型（注册进 SPEC-007 目录）
- `negotiation.created.v1`、`negotiation.closed.v1`（已签/未签）
- `contract.created.v1`、`contract.status_changed.v1`（含生效/终止/作废）、`contract.effective.v1`
- `payment.created.v1`、`payment.confirmed.v1`
- 载荷仅对象 ID+稳定状态码，不含金额明细的必要性评估按 FTN-005（金额非 L3，可入载荷——最终由实施 Plan 定载荷键集并入注册表 assertExactKeys）。

### 5.4 权限目录扩充（SPEC-004 permission-catalog，与 provisioning 迁移同变更）
- `negotiation.read`（READ）、`negotiation.create`（ACTION，MEDIUM）、`negotiation.update`（ACTION，MEDIUM）
- `contract.read`（READ）、`contract.create`（ACTION，MEDIUM）、`contract.submit`（ACTION，MEDIUM）、`contract.approve`（ACTION，HIGH）、`contract.sign`（ACTION，MEDIUM）、`contract.effect`（ACTION，HIGH）、`contract.terminate`（ACTION，HIGH）、`contract.void`（ACTION，HIGH）
- `payment.read`（READ）、`payment.create`（ACTION，MEDIUM）、`payment.confirm`（ACTION，HIGH，财务角色）
- 菜单：`menu.contract`、`menu.payment`（风险级口径与 menu.lead_crm/menu.customer 一致——LOW 口径差异已在 SPEC-009 终审 triage 记录，供权限治理 SPEC 统一）

## 6. 状态机与数据流

### 6.1 Contract 状态机（FTN-002 对齐）
```
DRAFT ──submit(需审批类型)──▶ PENDING_APPROVAL ──approve──▶ PENDING_SIGN
DRAFT ──submit(免审批类型)──▶ PENDING_SIGN
PENDING_APPROVAL ──reject──▶ DRAFT（驳回回草稿，approvalComment 必填）
PENDING_SIGN ──sign──▶ SIGNED ──effect──▶ EFFECTIVE ──terminate──▶ TERMINATED
DRAFT/PENDING_APPROVAL/PENDING_SIGN ──void──▶ VOID
```
- 类型驱动差异（配置化于 domain policy 表，非数据库配置）：
  - `FIRST_SIGN`/`FORMAL`：需审批（默认开）；生效生成应收计划。
  - `SUPPLEMENT`：需审批（默认开）；生效生成自身应收计划（依附父合同，不自动改父合同计划）。
  - `RISK_NOTICE`：免审批（默认）；SIGNED 即终态（无 EFFECTIVE/应收）；FORMAL 生效的签署门禁。
- `TERMINATED` 仅可从 `EFFECTIVE`；`VOID` 仅可从生效前状态；终态不可逆。
- 流转必须经 service 动作接口，记录操作人/时间/前后状态/原因（PRD §10 规则 1）；禁止任意目标状态提交。

### 6.2 生效事务矩阵（MOD-006 §6 事务验收）
| 动作 | 同事务原子 |
|---|---|
| 首签生效（FIRST_SIGN effect） | Contract.status=EFFECTIVE + PaymentPlan 批量生成（合计=合同金额校验）+ AnalysisEngagement 最小建档 + EventLog(`contract.effective.v1`) |
| 正式委托生效（FORMAL effect） | Contract.status=EFFECTIVE + PaymentPlan 批量生成 + **Case 最小建档**（caseNo/客户/合同关联/status=PENDING，lawyerId 空）+ **风险告知门禁**（同客户存在 status=SIGNED 的 RISK_NOTICE，缺失抛 `RISK_NOTICE_MISSING` 整事务回滚）+ EventLog |
| 补充协议生效（SUPPLEMENT effect） | 自身 status=EFFECTIVE + 自身 PaymentPlan + EventLog |
| 收款确认（payment.confirm） | Payment.status=CONFIRMED+confirmedBy/At + PaymentPlan.receivedAmount 冲抵（指定期次或按 dueDate 序）与状态联动（PENDING→PARTIAL→RECEIVED）+ Contract.receivedAmount 累加 + EventLog(`payment.confirmed.v1`)，三方同事务；统计异步下推 |
| 合同创建 | Contract（DRAFT）+ 编号同事务取号 + EventLog(`contract.created.v1`)；来源为谈案时校验谈案存在且可签 |
| 谈案完结 | Negotiation.status=SIGNED/UNSIGNED（未签必填原因）+ EventLog(`negotiation.closed.v1`) |

### 6.3 幂等
- 合同生效、收款确认、合同创建支持 `idempotencyKey`（沿用 SPEC-009 createLead 模式）；生效/确认同时由状态机天然幂等（已 EFFECTIVE/已 CONFIRMED 重放返回首次结果不重复生成计划/不重复累加）。
- 编号取号同事务序列自增，重试不产生重号；跳号可接受。

### 6.4 合同编号（CON-02）
格式：`{类型码}-{分所码}-{团队码}-{yyyy}-{4位流水}`，例 `FS-ZS01-YL-2026-0007`（FS/FORMAL→WT/SUPPLEMENT→SA/RISK_NOTICE→RN 稳定类型码；分所/团队码取 Organization/ProfessionalTeam 稳定 code，缺省 `HQ`/`ALL`）。序列按 scopeKey=`类型|分所|团队|年份` 独立计数（ContractNumberSequence）。

### 6.5 主链路（本 Spec 边界内，衔接 SPEC-009 终态）
1. 线索到访 VISITED / 客户已建 → 创建谈案（NEGOTIATING，记录报价/关注点/竞争）+ `negotiation.created`
2. 谈案完结：已签（SIGNED，可携签约金额）/ 未签（UNSIGNED+原因）+ `negotiation.closed`
3. 从谈案（或客户/分析委托/案件）创建合同（DRAFT，模板快照+编号）+ `contract.created`
4. 提交→（审批）→待签署→签署登记（或电子签预留回调）→SIGNED
5. 生效（FIRST_SIGN→应收+分析委托建档；FORMAL→应收+案件建档+风险告知门禁）+ `contract.effective`
6. 收款登记（PENDING）→ 财务确认（CONFIRMED，三方联动）+ `payment.confirmed`
7. （后续：开票/退款/成本/异常报表=SPEC-011；案件办理=MOD-008）

## 7. 错误处理

- 复用 `{code,message,data,requestId}` 包络与稳定码体系；领域错误沿用 SPEC-009 CrmError 模式（实例携带 `httpStatus`，errorHandler 按实例 status 透传）。
- 新增稳定业务码：
  - `NEGOTIATION_NOT_FOUND`（404）、`CONTRACT_NOT_FOUND`（404）、`PAYMENT_NOT_FOUND`（404）
  - `CONTRACT_STATE_TRANSITION_INVALID`（409，含 TERMINATED/VOID 终态再流转、VOID 已生效合同等）
  - `CONTRACT_APPROVAL_PENDING`（409，审批中重复提交/签署）
  - `RISK_NOTICE_MISSING`（409，FORMAL 生效门禁）
  - `PAYMENT_ALREADY_CONFIRMED`（409；幂等重放返回 200 首次结果，非本码——本码仅用于无幂等键的冲突确认）
  - `PAYMENT_AMOUNT_EXCEEDED`（409，确认金额超应收余额）
  - `RECEIVABLE_PLAN_MISMATCH`（400/409，应收计划合计≠合同金额）
- 金额/期次/日期入参校验失败 `VALIDATION_FAILED`（400；唯一冲突按实例 409 透传）。

## 8. 安全

- **数据范围**：Negotiation/Contract 列表与详情经 SPEC-004 AuthorizationContext（SELF→negotiatorEmployeeId/createdBy，TEAM→professionalTeamId，BRANCH/ORG→branchId 子树，多范围 OR 并集，零谓词 fail-closed）；Payment 经 `{contract: …}` 关系包裹 + customerId 冗余列双锚。不可见统一 404。
- **动作授权**：approve/effect/terminate/void/confirm 独立 HIGH 权限码逐路由校验；`payment.confirm` 预期授予财务角色。
- **审计**：生效/终止/作废/审批通过驳回/收款确认全量 OperationLog（前后状态+原因+操作人）；终止/作废/退款类为 FTN-002 §3 高风险动作——本 Spec 形态=独立 HIGH 权限+原因必填+审计（二次确认 UI 交互归前端）；系统管理员数据干预走 SPEC-005 既有治理通道，不经业务端点。
- **金额字段**：非 L3 明文（不设字段级脱敏），以数据范围+动作权限控制；该定性入实施 Plan 决策集备终审复核。
- **不得业务删除**：Payment/PaymentPlan 无业务删除端点（FTN-001 §3.6）；Contract 软删仅限 DRAFT（service 层守卫，超管干预除外）。
- **事件载荷**：不含 L3（电话/微信）；金额入载荷的边界见 §5.3。

## 9. 性能

- 索引见 §5 各表；列表目标 <2s（PRD §13）；规模验收仿 SPEC-004/009：500 合同分页中位数门槛。
- 编号取号单行使键锁，并发创建同 scope 序列串行化（预期低冲突——按 类型×分所×团队×年 分桶）。
- 收款确认联动写 3 表行级锁，单事务内按 Contract→PaymentPlan→Payment 固定顺序取锁防死锁。

## 10. 测试策略

沿用项目 TDD + `node:test` 串行 + Vitest + Playwright（排练式）。

- **服务层单测**：合同状态机全合法/非法箭头（含类型差异矩阵）、编号序列并发取号、生效事务原子性（含 RISK_NOTICE_MISSING 回滚、计划合计不等回滚）、收款确认三方联动（指定期次/顺序冲抵/PARTIAL 边界）、幂等重放、原型路由 404 锁。
- **HTTP 集成测试**（仿 test/app/*-api.test.ts 固定密钥模式）：数据范围四类各一组、动作权限 403、错误码、审计写入、幂等、电子签预留字段读写。
- **事件测试**：新事件类型同事务写入、载荷键集 assertExactKeys。
- **provisioning 契约**：15+ 新权限码迁移供给实证（reset 后零种子直查）；事件目录 parity 静态契约自动覆盖（SPEC-009 F-1 修复的常驻断言对新订阅生效）。
- **migration 重演**：从 SPEC-009 终态（16 迁移/49 model）扩展，重演+空库断言+空库重播种。
- **前端**：Vitest 组件测试 + Playwright 排练 spec（谈案→合同→审批→签署→生效→收款确认主链路；MOD-004 §6 全链路回归与 SPEC-009 E2E 衔接成端到端）。
- **测试隔离**：新增表纳入 `clearTestApplicationData` 自动覆盖核查与权限目录 seed；串行 `--test-concurrency=1`。

### 运行环境约束
- 本机预生产诊断线（`.codex-safe/`、55432 容器）保持隔离不动；标准开发环境 55433 `chengye_oa_test` 库、固定测试密钥。
- 数据库测试串行；重置需 `ALLOW_TEST_DB_RESET=true`；SPEC-008 的 55432 端口锁定 rehearsal 测试与本 Spec 无关。

## 11. 交付与验收门禁

- 后端 lint、typecheck、串行测试通过；前端 lint、typecheck、Vitest、build 通过。
- `check:baseline`/`check:bootstrap` 通过：model 数（49→预期 49+5=54：Negotiation/ContractTemplate/ContractNumberSequence/PaymentPlan/AnalysisEngagement；Contract/Payment/Case 为既有模型重建）与迁移数（16→预期 18：业务表迁移+权限 provisioning 迁移）三处期望同步。
- migration 重演通过；权限 provisioning 迁移-only 实证（reset 后零种子直查权限行数增长精确等于新码数）。
- 原型 contract/payment 无守卫路由（含双侧物理删除）根除，404 锁定测试。
- 端到端：谈案→合同生效→收款确认主链路通过，EventLog 可查；FORMAL 生效的案件建档与风险告知门禁实证。
- 数据范围、审计、幂等回归用例通过；持久化文档泄漏扫描通过。
- 依赖安全策略与生产审计按既有口径（不新增例外）。

## 12. 后续 Spec 接口

- **SPEC-011 财务进阶**（FIN-02~05）：消费 PaymentPlan/Payment 已联动状态；启用 Payment REFUNDED 与 InvoiceRequest/RefundRequest/CostEntry；异常报表读合同/收款/案件事实。
- **MOD-007 专业团队 SOP**：消费 AnalysisEngagement 建档行，推进其状态与材料任务明细。
- **MOD-008 案件交付**：消费 Case 建档行（lawyerId 指派、办理、办结）。
- **MOD-013 审批中心**：内嵌单步审批迁移到 ApprovalDefinition 引擎（审计字段已兼容）。
- **电子签对接 SPEC**：消费 esign* 预留字段，加回调端点。
- **MOD-009 转介绍**：`Lead.referralCustomerId` 链路与合同收款事实汇合。

## 13. 已确认决策摘要

| 维度 | 决定 |
|---|---|
| 范围（用户 2026-07-30 裁决） | CRM-07 谈案 + CON-01~06 合同四类型全生命周期 + CON-07 应收计划 + FIN-01 收款确认；FIN-02~05 下推 SPEC-011 |
| 审批（用户裁决） | 内嵌单步审批（提交/通过/驳回+按类型开关+全审计）；完整审批中心下推 MOD-013 |
| 跨模块事务（用户裁决） | 生效事务内最小建档：FORMAL→Case（lawyerId 可空）、FIRST_SIGN→AnalysisEngagement；材料任务明细与完整生命周期下推 |
| 合同类型 | FIRST_SIGN/FORMAL/SUPPLEMENT/RISK_NOTICE 四独立对象；类型驱动审批开关/应收生成/生效门禁差异 |
| 风险告知 | RISK_NOTICE 为合同对象（免审批、SIGNED 即终态）；FORMAL 生效强制存在已签 RISK_NOTICE（同事务门禁） |
| 编号 | `{类型}-{分所}-{团队}-{yyyy}-{流水}`，ContractNumberSequence 同事务自增取号，跳号可接受 |
| 模板 | ContractTemplate 最小主数据（文本+版本+启停），迁移供给初始两条，合同存模板快照 |
| 原型处置 | Contract/Payment 模型整体重构（语义字段迁移保留）；原型 17 条无守卫路由根除+404 锁（同 SPEC-009 T10 先例）；Case 仅 lawyerId 可空最小改动 |
| 电子签 | 仅预留 linkId/流水号/状态/回调载荷四字段，不对接 |
| 事件 | negotiation.*/contract.*/payment.* 同事务 outbox；订阅 provisioning 迁移与目录同变更（F-1 纪律）；权限码同（T12 纪律） |
| 收款 | 登记 PENDING→财务 CONFIRMED 两段；确认三方同事务联动；幂等键+状态机双幂等；无业务删除端点 |
| 金额安全 | 非 L3 不脱敏，数据范围+动作权限控制；实施 Plan 决策集备终审 |
| 高风险动作 | 独立 HIGH 权限+原因必填+审计（终止/作废/确认）；二次确认交互在前端 |
