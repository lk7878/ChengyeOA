# SPEC-009：线索销转与客户主数据设计

> 状态：待评审
> 日期：2026-07-28
> 需求基线：`律所闭环管理系统需求开发文档.md` V1.0
> 前置 Spec：SPEC-001、SPEC-002、SPEC-003、SPEC-004、SPEC-005、SPEC-006、SPEC-007、SEC-SPEC-001 已完成本地实施和验收；SPEC-008 事件中心可观测性已完成
> 关联专项设计：`docs/专项设计/数据库核心表设计草案.md`、`docs/专项设计/状态机与业务字典设计.md`、`docs/专项设计/API规范错误码与事务边界设计.md`、`docs/专项设计/数据流转事件中心设计.md`
> 运行环境约束：本机预生产诊断线（`.codex-safe/`）保持隔离不动；本 Spec 在标准开发环境（55433 dev 容器、`*_test` 库）实施与验收
> 实施约束：本 Spec 经书面审核后单独生成实施 Plan；全部开发、测试在本地完成，不执行 Git 提交或远程操作

## 1. 背景与问题

SPEC-001 ~ SPEC-008 已建立经营 OA 的公共底座：工程基线、信任根、组织人员主数据、RBAC 与数据范围、管理员治理、身份与 MFA、可靠事件中心及其生产可观测性。PRD §17 开发基线把"线索 - 客户 - 合同 - 收款 - 案件 - 质控 - 复盘 - 转介绍"定义为主链路，但该主链路尚无任何 SPEC 立项。仓库中不存在预先规划 SPEC-009 及之后业务 SPEC 的路线图文档；本 Spec 是主链路的第一环。

现有数据库中 `Lead`、`LeadFollow`、`Customer`、`Channel` 是 SPEC-001 从原 22 个模型保留的早期原型：

1. `Lead.status` 为简化的 `NEW|CONTACTED|...|SIGNED|LOST`，与 PRD §10 状态机不一致，且混入了已下推的谈案状态。
2. 缺少可读业务编号、归因字段（活动/转介绍人）、组织维度（分所/团队）、审计字段（创建人/版本/软删）和电话 Hash，无法支撑数据范围隔离、L3 脱敏和精确去重。
3. 缺少公海/私海归属管理、邀约对象、客户联系人。
4. 线索不能产出业务事件，与已就绪的 SPEC-007 事件中心脱节。
5. 现有原型字段直接明文存储电话，不满足 PRD §11.1 数据分级。

本 Spec 把线索销转前端（录入到到访）与客户主数据基础建成生产级，为后续谈案、合同、案件 SPEC 提供可承接的业务对象。

## 2. 目标

1. 建立线索主数据：可读编号、来源与归因、组织维度、脱敏与检索双字段、完整状态机、软删与审计。
2. 建立公海/私海归属管理，支持领取、分配、改派、可配置超时回收，全部留痕。
3. 建立跟进记录与首响时长计量。
4. 建立邀约对象，支持创建、到访确认、爽约、改期，保留改期历史。
5. 建立客户主数据与联系人，支持线索手动转客户的事务原子操作。
6. 线索/邀约/客户的关键状态变化同事务产出业务事件，接入 SPEC-007 事件中心，含一个首响超时 pilot 订阅。
7. 全部列表与详情接入 SPEC-004 数据范围与字段权限，L3 字段脱敏、查看/导出审计。
8. 提供线索列表、详情、公海看板、到访日历与客户列表、详情的桌面及响应式 Web 管理页。

## 3. 非目标

本 Spec 不实现：

1. 谈案记录、报价、首签、合同创建与签署（→ 后续 SPEC）。
2. 二次营销池（NURTURE）的激活流转业务；状态机保留 `LOST → NURTURE` 占位，service 暂只置 `LOST`。
3. 客户合并（CUS-04）；权限码 `customer.merge` 已注册占位，service 不实现、不路由。
4. 转介绍关系表（ReferralRelation，CUS-03）；`Lead.referralCustomerId` 仅引用已有 Customer。
5. 客户全景聚合页（CUS-05，跨合同/案件/满意度，对象未建）。
6. 渠道、活动、律师 IP 的管理界面（MKT-01~04）；本 Spec 仅建最小 `Campaign` 占位表供归因引用，不做管理 UI。
7. 完整通知中心；仅一个首响超时 pilot 订阅。
8. 身份证（idCard）收集与 L4 处理；去重不使用身份证规则。
9. 考勤、请假、绩效等人事业务。
10. 导入历史 SQLite 数据。

## 4. 模块边界与架构

遵循 PRD §7.1 主数据唯一数据源。Controller 仅 HTTP 适配与授权中间件接入，业务规则收敛到应用服务（沿用 SPEC-003 已验证的分层模式）。

| 应用服务 | 职责 | 唯一数据源 |
|---|---|---|
| `lead-service` | 线索录入、去重提示查询、状态流转、转客户 | Lead |
| `lead-assignment-service` | 公海/私海、分配/改派/领取/超时回收 | Lead + LeadPoolRecord |
| `lead-follow-service` | 跟进记录、首响时长计量 | LeadFollow |
| `appointment-service` | 邀约创建、到访确认、爽约、改期 | Appointment |
| `customer-service` | 客户档案、联系人基础增删改查 | Customer + Contact |
| `lead-dedup-service` | 多规则去重提示查询（只读，不自动合并） | — |
| `lead-projection` / `customer-projection` | 按调用者字段权限的脱敏投影 | — |

Controller：`app/controller/lead.ts`、`appointment.ts`、`customer.ts`。

边界约束：
- 不碰 `Contract`、`Payment`、`Case` 等已有原型表（由后续 SPEC 改造）。
- `Channel` 表已存在且够用，仅补充 `code` 唯一字段，不做管理 UI。
- 事件复用 SPEC-007 的 `EventLog` + 订阅/投递机制，本 Spec 注册新事件类型与一个 pilot 订阅。

## 5. 数据模型

### 5.1 扩充现有模型

#### Channel（补充）
- 新增 `code String @unique`（稳定编码，归因引用）。

#### Lead（重构原型）
现有原型字段保留语义，新增/改：
- `leadNo String @unique`（可读业务编号）
- `phone String`（规范值，展示用，按字段权限脱敏输出；明文不入索引）
- `phoneHash String @index`（规范化电话的 Hash，去重/检索用，值不泄露明文）
- `wechat String?`（规范值，展示用，同 `phone` 脱敏策略）
- `wechatHash String?`
- 归因：`sourceType String`（PHONE/FORM/DM/REFERRAL/MANUAL/OTHER）、`campaignId String?`、`referralCustomerId String?`
- 组织维度：`branchId String?`、`professionalTeamId String?`
- 状态机：`status String @default("NEW")` 取值 `NEW|ASSIGNED|CONTACTED|SCREENED|INVITED|VISITED|CONVERTED|LOST|NURTURE`（移除已下推的 NEGOTIATING/QUOTED/SIGNED）
- 归属：`poolStatus String @default("PUBLIC")` 取值 `PUBLIC|PRIVATE|RECYCLED`（与 status 正交）
- 首响：`firstResponseSeconds Int?`
- 通用审计：`createdBy String`、`updatedBy String?`、`version Int @default(1)`（乐观锁）、`deletedAt DateTime?`（软删）
- 保留：`name`、`phone`（明文，按字段权限脱敏输出）、`wechat`、`channelId`、`sourceDetail`、`intentionLevel`、`isValid`、`invalidReason`、`tags`、`assignedTo`
- 索引：`[status]`、`[assignedTo]`、`[channelId]`、`[phoneHash]`、`[branchId,createdAt]`、`[poolStatus,status]`

#### LeadFollow（补充审计）
- 新增 `updatedBy String?`（原 `createdBy` 保留）；类型枚举对齐 PRD：`PHONE|WECHAT|VISIT|ONLINE|OTHER`。
- 保留现有字段与 Cascade。

#### Customer（重构原型）
- 新增 `customerNo String @unique`
- `phone String`（规范值，展示用，按字段权限脱敏）
- `phoneHash String @index`（去重/检索，不泄露明文）
- `leadId` 改名 `sourceLeadId String? @unique`，关系语义"由该线索转化而来"
- `status` 取值对齐 `POTENTIAL|ACTIVE|INACTIVE`
- 新增 `customerType String @default("INDIVIDUAL")`（INDIVIDUAL/ENTERPRISE 占位）
- 通用审计：`createdBy`、`updatedBy?`、`version`、`deletedAt?`
- 不收 `idCard`（下推）
- 保留：`name`、`phone`、`wechat`、`email`、`address`、`tags`、`remark`

### 5.2 新增模型

#### Campaign（最小占位）
- `id`、`code String @unique`、`name`、`channelId String?`、`status String @default("ENABLED")`、审计字段
- 无管理 UI；后续 MKT SPEC 扩充。

#### LeadPoolRecord（公海/私海流转日志，不可业务删除）
- `leadId`、`action String`（CLAIM/ASSIGN/REASSIGN/RECYCLE）、`fromEmployeeId String?`、`toEmployeeId String?`、`reason String?`、`operatedBy String`、`createdAt`
- 索引 `[leadId,createdAt]`

#### Appointment（邀约）
- `appointmentNo String @unique`、`leadId`、`scheduledAt DateTime`、`channel String`（ONSITE/ONLINE）、`negotiatorEmployeeId String?`（谈案人预留）、`status String @default("PENDING")`（PENDING|CONFIRMED|VISITED|NOSHOW|CANCELLED|RESCHEDULED）、`rescheduledFromId String?`（改期链，自引用）、`remark String?`、审计字段
- 索引 `[leadId,scheduledAt]`、`[status,scheduledAt]`

#### Contact（客户联系人）
- `customerId`、`name`、`phone String`（规范值，脱敏）、`phoneHash`、`wechat String?`、`relation String?`、`isPrimary Boolean @default(false)`、审计字段、`deletedAt?`
- 唯一约束：`[customerId, phoneHash]`（一客户同电话不重复）
- 索引 `[customerId]`

### 5.3 事件类型（注册进 SPEC-007 事件订阅目录）
- `lead.created.v1`、`lead.assigned.v1`、`lead.status_changed.v1`
- `appointment.created.v1`、`appointment.visited.v1`
- `customer.created.v1`
- 事件载荷遵循 PRD §7.2 通用结构；不含 L3 明文电话，仅含对象 ID 与稳定状态码。

### 5.4 权限目录扩充（SPEC-004 permission-catalog）
- `lead.read`（READ）、`lead.create`（ACTION，MEDIUM）、`lead.update`（ACTION，MEDIUM）、`lead.assign`（ACTION，HIGH）、`lead.recycle`（ACTION，MEDIUM）、`lead.convert`（ACTION，HIGH）
- `appointment.read`（READ）、`appointment.create`（ACTION，MEDIUM）、`appointment.visit`（ACTION，MEDIUM）
- `customer.read`（READ）、`customer.create`（ACTION，MEDIUM）、`customer.update`（ACTION，MEDIUM）
- `customer.merge`（SPECIAL，CRITICAL）已注册占位，不实现。

## 6. 状态机与数据流

### 6.1 Lead 状态机
```
NEW ──assign──▶ ASSIGNED ──contact──▶ CONTACTED ──screen──▶ SCREENED
SCREENED ──invite──▶ INVITED ──visit──▶ VISITED ──convert──▶ CONVERTED
任意活状态 ──lose──▶ LOST ──nurture──▶ NURTURE ──reactivate──▶ CONTACTED
```
- 流转必须经 service 方法，记录操作人、时间、前状态、后状态、原因（PRD §10 规则1）。
- 禁止前端直接提交任意目标状态；状态变化走动作接口（PRD §12.1 规则2、§10 规则2）。
- `NURTURE` 流转标记为下期：service 接受 `lose`，`nurture/reactivate` 本 Spec 不实现。
- `poolStatus` 与 `status` 正交：业务推进不改变归属，除非超时回收。

### 6.2 事务边界（PRD §12.2）
| 业务动作 | 同事务原子 |
|---|---|
| 线索录入 | Lead 写入 + EventLog(`lead.created.v1`) |
| 线索分配/领取/改派/回收 | Lead 归属变更 + LeadPoolRecord 写入 + EventLog(`lead.assigned.v1`) |
| 转客户 | Customer + Contact 创建 + Lead.status=CONVERTED + sourceLeadId 关联 + EventLog(`customer.created.v1`) |
| 邀约到访 | Appointment.status=VISITED + Lead.status=VISITED（若未到访）+ EventLog(`appointment.visited.v1`) |

复用 SPEC-007 Outbox：业务写入与 EventLog 同事务提交，投递最终一致。

### 6.3 主链路（本 Spec 边界内）
1. 线索进入（录入/外部）→ 去重提示 → `NEW`（公海）+ `lead.created`
2. 客服领取 → `ASSIGNED`（私海，owner=客服）+ `lead.assigned` → pilot 首响计时开始
3. 客服跟进 → `CONTACTED`（LeadFollow）→ 内联计算 `firstResponseSeconds`
4. 初筛 → `SCREENED`
5. 创建邀约（Appointment PENDING）→ `INVITED` + `appointment.created`
6. 到访确认 → `VISITED`（appointment + lead）+ `appointment.visited`
7. 转客户 → Customer + Contact + `CONVERTED` + `customer.created`
（后续谈案/合同 = 下一 Spec）

### 6.4 首响时长
`LeadFollow` 创建时，若为该线索首条跟进，service 内联计算 `firstResponseSeconds`（基于 `lead.assigned` 时间）写回 Lead。不依赖事件往返，简单可靠。超时由 pilot 订阅异步通知主管。

### 6.5 超时回收（pilot 自动化）
- 轻量回收配置项：`lead.recycle.enabled`（默认 true）、`lead.recycle.noFollowHours`（默认 24，可由系统管理员改，非写死）。
- 规则：`poolStatus=PRIVATE` 且 `status∈{NEW,ASSIGNED}` 且 `updatedAt < now - noFollowHours` → 置 `poolStatus=RECYCLED` 回公海 + LeadPoolRecord + `lead.assigned` 事件（action=RECYCLE 语义）。
- 调度方式待实施 Plan 在以下候选中权衡锁定，本设计不预先固化（二者均不引入 AutomationRule 表）：
  - 候选 A：复用 SPEC-007/008 事件中心周期性 tick 通道新增一个回收检查 handler；
  - 候选 B：引入一个独立的轻量定时任务（Egg schedule 或等价机制）。
- 锁定原则：不得让事件投递 Worker 兼跑业务回收而混淆职责；若选 A，回收检查须是独立 handler 单元，与事件投递隔离。

## 7. 错误处理

- 复用 SPEC-003/004 的 `{code,message,data,requestId}` 包络与稳定错误码体系。
- 新增稳定业务码（`code` 为 HTTP 状态，与现有 SPEC 错误码体系一致）：
  - `LEAD_NOT_FOUND`（404）
  - `LEAD_STATE_TRANSITION_INVALID`（409，非法状态流转）
  - `LEAD_NOT_IN_POOL`（409）
  - `APPOINTMENT_CONFLICT`（409，同线索同时段重复邀约）
  - `CUSTOMER_ALREADY_CONVERTED`（409）
- 去重提示**不是错误**，不占用业务错误码：创建线索成功返回 HTTP 200/201 + `data.lead`，并在 `data.duplicates[]` 返回脱敏摘要（命中线索的编号、负责人、状态，不含电话明文）。前端据此引导人工决定（领取现有/合并/强制新建，写审计）。
- 非法状态流转返回 409 + 稳定码。
- 关键写接口支持 `idempotencyKey`：线索创建、转客户、邀约创建。重复请求返回首次结果。

## 8. 安全

- **数据范围**：所有 Lead/Customer/Appointment 列表与详情经 SPEC-004 `AuthorizationContext` 过滤（本人/本团队/本分所/全所）；越权返回 403 `PERMISSION_DENIED`，不泄露对象存在性。
- **字段权限**：`phone`/`wechat` 按 L3 字段权限脱敏展示，详情接口按 `FieldPermission` 投影；查看/导出 L3 写 `AuditLog`。
- **脱敏投影**：`lead-projection`/`customer-projection` 按调用者字段权限输出 L3 明文或脱敏值，序列化时二次扫描确保不泄露电话明文。
- **状态流转授权**：`lead.assign`/`lead.recycle`/`lead.convert` 等动作权限单独校验。
- **幂等**：`idempotencyKey` 唯一约束，重复请求返回首次结果。
- 电话双字段：`phone`（规范值，展示用，按字段权限脱敏）+ `phoneHash`（检索/去重），明文不入索引（PRD §11.1 L3）。

## 9. 性能

- 索引：`[status,assignedTo]`、`[branchId,createdAt]`、`[phoneHash]`、`[poolStatus,status]`。
- 列表目标 <2s（PRD §13）。
- 去重查询走 `phoneHash`/`wechatHash` 精确匹配，无全表正则。
- 规模验收仿 SPEC-004：500 线索分页中位数门槛。

## 10. 测试策略

沿用项目 TDD + `node:test` 串行 + Vitest + Playwright。

- **服务层单测**：状态机所有合法/非法流转、去重多规则（电话/姓名/微信）、转客户事务原子性（含失败回滚）、首响时长计算边界、超时回收规则。
- **HTTP 集成测试**（仿 `test/app/*-api.test.ts`，使用 `test/helpers/auth-session.ts` 的固定测试密钥）：数据范围四类各一组、字段脱敏、错误码、幂等、审计写入、状态流转授权。
- **事件测试**（接 SPEC-007 fixture）：`lead.created/assigned`、`appointment.visited` 同事务写入、pilot 订阅投递、幂等消费。
- **migration 重演**：从 SPEC-008 终态扩展，验证扩充 + 新表迁移正向/回滚，固定临时库删除断言（仿 SPEC-004 migration rehearsal）。
- **前端**：Vitest 组件测试 + Playwright E2E（线索列表→领取→跟进→邀约→到访→转客户主链路，桌面 + 移动）。
- **安全回归**：越权 403、L3 不泄露、审计必写、幂等不重复生成客户。
- **测试隔离**：遵循 `clearTestApplicationData` + 各文件 `beforeEach` 清库模式；本 Spec 新增表须纳入清库清单与权限/订阅目录 seed。

### 运行环境约束
- 本机预生产诊断线（`.codex-safe/`、55432 容器、`Read-only classifier handoff`）保持隔离不动。
- 本 Spec 实施与验收在标准开发环境：55433 dev 容器、`chengye_oa_test` 库、对齐 `test/helpers/auth-session.ts` 的固定测试密钥。
- 数据库测试串行 `--test-concurrency=1`；重置需 `ALLOW_TEST_DB_RESET=true`。
- SPEC-008 的 3 个 55432 端口锁定的 rehearsal 测试与本 Spec 无关，其失败不影响本 Spec 验收。

## 11. 交付与验收门禁

- 后端 lint、typecheck、串行测试通过；前端 lint、typecheck、Vitest、build 通过。
- 基线契约（`check:baseline`）与引导契约（`check:bootstrap`）通过：Prisma model 数与迁移数更新。
- migration 重演通过，临时库清理。
- 依赖安全策略与生产审计通过（不放宽既有例外）。
- 端到端主链路（线索→到访→转客户）通过，事件可从 EventLog/EventDelivery 查询。
- 数据范围、字段脱敏、审计、幂等的回归用例通过。
- 持久化文档泄漏扫描通过（无密钥/连接串/电话明文）。

## 12. 后续 Spec 接口

- 谈案与首签 SPEC：消费 `Lead.status=VISITED` 与 `Customer`，产出 Negotiation 与首签合同。
- 合同财务 SPEC：消费 Customer，改造现有 Contract/Payment 原型。
- 客户合并 SPEC：实现 `customer.merge` 权限码与 ReferralRelation。
- 渠道/活动/律师 IP（MKT）：扩充 Campaign 占位表为完整主数据 + 管理 UI。
- 通知中心 SPEC：把首响 pilot 订阅纳入完整通知体系。

## 13. 已确认决策摘要

| 维度 | 决定 |
|---|---|
| 范围 | CRM-01~06（录入/去重/公海私海/分配/跟进/邀约到访）+ CUS-01~02（客户档案/联系人） |
| 来源归因 | 线索带 source + 归因引用，渠道主数据下推；建最小 Campaign 占位表 |
| 去重 | 多规则提示（电话/姓名/微信）+ 人工决定，不自动合并；电话规范值+Hash |
| 公海私海 | 公海领取入私海 + 可配置超时回收（轻量配置项，非 AutomationRule） + 自动/手动分配，全记日志 |
| 事件 | 产出 lead.*/appointment.*/customer.created，同事务写 EventLog 接 SPEC-007；含 1 个首响 pilot 订阅 |
| 转客户 | 到访后手动转客户，Customer+Contact 同事务；客户主数据本 Spec 仅基础 CRUD |
| 敏感数据 | L3 脱敏 + 数据范围 + 查看/导出审计；不收 idCard（L4 下推） |
| 邀约 | 独立 Appointment 对象（创建/到访/爽约/改期），不含谈案 |
| 前端 | 线索列表/详情/公海看板/到访日历 + 客户列表/详情，桌面+响应式 |
| 超时回收调度 | 复用 SPEC-007 Worker handler，不引独立 cron |
| 首响时长 | LeadFollow 创建时内联计算写回 Lead |
