# 线索销转 + 客户主数据 运维手册（SPEC-009）

适用范围：线索（Lead）录入/公海私海/跟进/首响计量/邀约/转客户全链路，客户（Customer）与联系人（Contact）主数据。
后端实现：`apps/server/app/application/crm/`；路由：`app/router.ts`（`/api/v1/leads*`、`/api/v1/appointments*`、`/api/v1/customers*`）。

---

## 1. 配置项

| 环境变量 | 默认 | 范围 | 语义 |
|---|---|---|---|
| `LEAD_RECYCLE_ENABLED` | `true` | 显式 `true`/`false`，其他值启动即 fail-fast | 超时自动回收总开关。`false` 时扫描器每 tick 返回 0、零写入 |
| `LEAD_RECYCLE_NO_FOLLOW_HOURS` | `24` | 整数 1–720 | 私海线索超过 N 小时未跟进即回收的阈值 |

解析见 `apps/server/config/env.ts`（`LeadRecycleEnvironment`），经 `config/config.default.ts` → `app.config.leadRecycle` 注入事件服务工厂（`app.ts` boot）。

**非默认值警告**：若生产设置非默认 `LEAD_RECYCLE_*`，`eventOperations`/`governance-factory` 两调用点必须与 boot 同步传值（SPEC-009 Task 10 已根治为同源读取 `app.config.leadRecycle`——勿回退为省略该参数）。

## 2. 超时回收机制（设计 §6.5）

- **扫描单元**：`LeadRecycleScanner`（`app/application/crm/lead-recycle-scanner.ts`），**不是** EventHandler，不注册进投递管线；由 `EventWorker` 每次 tick 完成后经可选 `tickListener` 触发，双向 try/catch 隔离（scanner 抛错仅记 `[lead-recycle-scanner]` 前缀日志，绝不影响投递；投递失败也不阻塞 scanner）。
- **候选规则**：`poolStatus=PRIVATE AND status IN (NEW,ASSIGNED) AND updatedAt < now - N小时`（**严格小于**，恰在阈值不回收），`deletedAt IS NULL`。无独立 watch 表——`Lead.assignedAt` 为锚。
- **回收动作**（复用 `LeadAssignmentService.recycleOverdueLeads`，每条独立事务，单行失败跳过不中断）：`poolStatus→RECYCLED`、清 `assignedTo/assignedAt`、写 `LeadPoolRecord(action=RECYCLE, reason=AUTO_RECYCLE:NO_FOLLOW_{N}H, operatedBy='system')`、同事务发 `lead.assigned`(RECYCLE) 事件（系统事件 `operatorUserId=null`）、OperationLog 审计。
- **语义要点**：已首响（`firstResponseSeconds` 非 null）≠ 豁免——首跟会推进状态出候选或刷新 `updatedAt`；公海计量后被领取再闲置的线索**会**从领取时刻重新计时并回收（用户裁决 M-1，防死线索）。
- **无 HTTP 触发口**：批量回收不暴露任何端点（单条手动回收走 `POST /api/v1/leads/:id/recycle`，`lead.recycle` 权限）。

## 3. 线索状态机（`app/domain/crm/lead-policy.ts`）

```
NEW ──assign──▶ ASSIGNED ──contact──▶ CONTACTED ──screen──▶ SCREENED
SCREENED ──invite──▶ INVITED ──visit──▶ VISITED ──convert──▶ CONVERTED
任意活状态 ──lose──▶ LOST ──nurture──▶ NURTURE ──reactivate──▶ CONTACTED
```

- 状态取值：NEW/ASSIGNED/CONTACTED/SCREENED/INVITED/VISITED/CONVERTED/LOST/NURTURE；同态流转非法。
- **poolStatus 与 status 正交**：PUBLIC（公海）/PRIVATE（私海）/RECYCLED（回收池）。公海定义=可领取集合 {PUBLIC, RECYCLED}；仅 PRIVATE 拒绝领取（LEAD_NOT_IN_POOL 409）。
- **推进门禁**：一切状态推进经 `canTransition` 门卫。自动推进点：claim/assign/reassign 落私海时 NEW→ASSIGNED；首个见到 ASSIGNED 的跟进推进 CONTACTED（决策 4 修订，与首响计量解耦）；创建邀约时可推进 INVITED；确认到访时可推进 VISITED。手动流转走 `PATCH /api/v1/leads/:id`（`{targetStatus, reason}`，`lead.update` 权限），非法流转 → LEAD_STATE_TRANSITION_INVALID 409。
- **reactivate（NURTURE→CONTACTED）当前禁用**：`REACTIVATE_ENABLED=false`，service 层先查开关再查状态机。

## 4. 关键业务流程

### 4.1 录入与去重
`POST /api/v1/leads`（`lead.create`）：电话规范化（剥 +86/86/0086，≥7 位纯数字，非法字符 LEAD_PHONE_INVALID 400）→ sha256 检索 hash 精确匹配去重（PHONE/WECHAT/NAME 三信号，不明文返回）→ 创建（初始 NEW + PUBLIC）。`Idempotency-Key` 请求头幂等：同 key+同人+同电话重放返回首次记录、`duplicates` 为空、不重复写事件。

### 4.2 公海领取 / 分配 / 回收
- 领取 `POST /api/v1/leads/pool/claim`（`lead.pool.claim`，body `{leadId}`）：actor 必须绑定员工（`User.employeeId`，未绑定 ACTOR_EMPLOYEE_UNBOUND 403）→ PRIVATE + assignedTo=actor 员工 + `assignedAt=now()`。
- 分配/改派 `POST /api/v1/leads/:id/assign`（`lead.assign`）：不限来源池态；目标员工必须存在。
- 手动回收 `POST /api/v1/leads/:id/recycle`（`lead.recycle`）：仅 PRIVATE 可回收 → RECYCLED + 清归属；status 不动。
- 每次池动作同事务写 `lead.assigned` v1（四键 `{leadId, action, fromEmployeeId, toEmployeeId}`）+ `LeadPoolRecord`（append-only）。

### 4.3 跟进与首响计量
`POST /api/v1/leads/:id/follows`（`lead.update`）：同事务写 LeadFollow → 双独立标志 version 锁写回 Lead——`shouldMeter`（`firstResponseSeconds` 仍 null → 锚 `assignedAt ?? createdAt` 内联计量，**一经写入绝不重算**）与 `shouldPromote`（首见 ASSIGNED → 推进 CONTACTED + `lead.status_changed` 事件）。并发双跟恰一方胜出，败方不抛错、跟进照常提交。

### 4.4 邀约
`POST /api/v1/appointments`（`appointment.create`）：冲突槽=同 lead + 活动状态(PENDING|CONFIRMED) + scheduledAt 精确相等；同创建人命中→幂等回放返回既有行，他人→APPOINTMENT_CONFLICT 409。lead 为 CONVERTED/LOST/NURTURE 禁止创建。改期 `POST /:id/reschedule`（旧行 RESCHEDULED + 新行 PENDING 指 `rescheduledFromId`，无事件）；到访 `POST /:id/visit`（PENDING|CONFIRMED→VISITED，可推进 lead=VISITED）。查询：单线索 `GET /api/v1/leads/:id/appointments`；**跨线索日历 `GET /api/v1/appointments?from&to[&page&pageSize]`**（含界 gte/lte，跨度上限 366 天）。

### 4.5 转客户
`POST /api/v1/leads/:id/convert`（`lead.convert`）：同事务 lead→CONVERTED + 建 Customer（`sourceLeadId` 唯一，重复转 → CUSTOMER_ALREADY_CONVERTED 409，天然幂等）。客户主数据：`POST/GET/PATCH /api/v1/customers[/:id]`，联系人 `GET/POST/PATCH/DELETE /api/v1/customers/:id/contacts[/:contactId]`（GET 列表为 C1 增量——用户裁决补开，`customer.read`；phoneHash `@@unique([customerId, phoneHash])`，重复 → VALIDATION_FAILED 携带 **409**；主联系人互清除；软删）。

## 5. 事件清单（SPEC-007 outbox，全部同事务写入）

| eventType | v | 载荷 | 触发 |
|---|---|---|---|
| `lead.created` | 1 | 见 event-registry | 录入 |
| `lead.assigned` | 1 | `{leadId, action, fromEmployeeId, toEmployeeId}` | claim/assign/reassign/recycle（含自动回收，系统事件 operatorUserId=null） |
| `lead.status_changed` | 1 | `{leadId, fromStatus, toStatus}` | 状态实际流转时（自动推进与手动流转同规） |
| `appointment.created` | 1 | `{appointmentId, leadId, channel, status}` | 创建邀约（恒发） |
| `appointment.visited` | 1 | 见 event-registry | 确认到访（恒发） |
| `customer.created` | 1 | 见 event-registry | 转客户 |

订阅：`lead-first-response-monitor-v1`（首响 pilot，ENABLED；handler 最小消费、safeSummary 仅 `{leadId, action}` 标量，不写业务表）。

## 6. 权限与数据范围

- 动作权限（SPEC-004）：`lead.create/read/update/assign/recycle/convert/pool.claim`、`appointment.read/create/visit`、`customer.read/create/update`；菜单 `menu.lead_crm`/`menu.customer`。
- 数据范围锚定：Lead 自身列（SELF→`assignedTo`、TEAM→`professionalTeamId`、BRANCH/ORG→`branchId` 组织子树，多范围 OR 并集，零谓词 fail-closed）；Appointment 经 `{lead: …}` 关系包裹；Customer SELF→`createdBy`、TEAM/BRANCH→`sourceLead` 关系列（null-sourceLead 仅 SELF+ALL 可见）。不可见统一 LEAD_NOT_FOUND 404，不泄露存在性。
- L3 字段（phone/wechat）按字段权限脱敏输出；明文读取落 `READ_L3_FIELDS` 审计；业务审计只落安全字段（绝不落电话/微信/自由文本明文）。
- **角色授予**：业务角色（如客服）须持有 `lead.pool.claim` 方可领取——经角色管理 API 授予（`PUT /api/v1/roles/:id/permissions`）；无业务角色 seed。

## 7. 常见错误码（HTTP 语义稳定码；CrmError 按实例 httpStatus 映射）

| code | status | 场景 |
|---|---|---|
| `LEAD_NOT_FOUND` | 404 | 线索/邀约/客户不存在或不可见（不泄露存在性） |
| `LEAD_STATE_TRANSITION_INVALID` | 409 | 非法状态流转；非 PRIVATE 手动回收 |
| `LEAD_NOT_IN_POOL` | 409 | 领取私海线索（含本人已持有） |
| `ACTOR_EMPLOYEE_UNBOUND` | 403 | 领取时 actor 未绑定员工 |
| `LEAD_PHONE_INVALID` | 400 | 电话规范化失败 |
| `APPOINTMENT_CONFLICT` | 409 | 邀约冲突槽（非本人创建） |
| `CUSTOMER_ALREADY_CONVERTED` | 409 | 重复转客户 |
| `VALIDATION_FAILED` | 400 或 409 | 入参校验失败（status 随实例——联系人电话重复为 409，按实例透传勿按码硬映射） |
| `VERSION_CONFLICT` | 409 | 乐观锁竞争败北（可安全重试语义由调用方判定） |

## 8. 运维注意

- 事件投递运维（重放/隔离/健康）见 SPEC-007/008 既有 runbook；本模块不新增投递面。
- 回收扫描错误日志以 `[lead-recycle-scanner]` 前缀检索；行级回收失败日志以 `[lead-assignment-service] recycleOverdueLeads row failed` 检索（候选数 vs `recycledCount` 可对账）。
- 数据库：PostgreSQL（生产 55432；测试 55433 `_test` 库）。迁移即真相——本 SPEC 新增迁移：`20260728090000_lead_crm_customer_expand`、`20260729090000_leadfollow_updated_by`、`20260730090000_crm_permission_provision`（15 个 CRM 权限行，model 总数 49）、`20260730090002_lead_first_response_subscription_provision`（首响 pilot 订阅行，终审 F-1 补齐）。
- **权限 provisioning**：权限行由迁移 SQL INSERT 配给（无业务角色 seed）。新增权限码时必须同步 provisioning 迁移，否则生产授权 FK 阻断（RolePermission→Permission Restrict）。SPEC-009 教训：代码目录与 DB 行的差集曾致全模块 403 风险，T12 补齐。
- **事件订阅 provisioning（同一纪律，终审 F-1 扩展）**：`event_subscription` 行同样只由迁移 SQL INSERT 配给（生产代码无任何 create/upsert 路径，baseline 契约禁止通用 seed）。`EVENT_SUBSCRIPTION_CATALOG`（`app/domain/events/event-subscription-catalog.ts`）新增/变更订阅时必须同步 provisioning 迁移，否则：fresh 部署 bootstrap 目录断言（`SystemBootstrapService.assertEventSubscriptionCatalog` 计数+逐字段）硬失败；存量库订阅行永久缺失、事件零投递静默死亡。逃逸机制与权限同源——测试夹具按目录全量播种（`test/helpers/test-database.ts`），从不暴露迁移真实供给；常驻静态契约 `test/db/spec-008-event-observability-migration-contract.test.ts` 的 "every catalog event subscription is provisioned by a migration INSERT" 已封闭（目录每条订阅必须在迁移 SQL 中有对应 INSERT）。SPEC-009 教训：pilot 订阅 `lead-first-response-monitor-v1` 曾无迁移供给（2≠3），终审 F-1 补齐。
- **迁移计数期望三处协调**：`scripts/ci/check-baseline-contract.ts` + 7 个 baseline fixture 数组 + `test/db/spec-008-event-observability-migration-contract.test.ts`——新迁移落地需三处同步（当前 16）。
- **测试环境指纹**：并行负载/内存压力下 Egg boot 偶发 `APP_KEYS is required`（密钥注入竞态）——静默窗口重试即绿，非代码回归。
- **安全审计现状**（2026-07-30）：`security:audit:prod` 现存 2 个 production_high——brace-expansion（egg-scripts→glob@7 链与 5.0.8 不兼容且无 1.x/2.x 补丁版，override 仅覆盖 minimatch 10 运行时链）与 react-router（需 ≥8.3.0 即 v7→v8 大版本升级）。SEC-2026-002 已按 SEC-2026-001 机制登记，但生产门禁不豁免（policy.mjs 设计如此）——属框架级专项决策（egg 工具链替换 / react-router 8 迁移），非本模块阻断项。

- **客户经营分析（SPEC-032，2026-08-05）**：CustomerView 扩展经营指标——`contractCount`（deletedAt null 合同数）/ `repurchaseCount`（= max(0, 合同数-1)，首单后每单为复购）/ `referralCount`（`referralCustomerId=本客户` 的线索数）/ `firstContractAt` / `latestContractAt`。`getCustomer`/`listCustomers` 批量聚合（contract groupBy count + min/max createdAt、lead referralCustomerId count——IN 查询）。**零结构变更**（复用既有关系）；前端客户详情页「经营分析」卡（合同数/复购数/转介绍数/首单/最近单 + 复购 Tag）。**口径注意**：contractCount 含已终止合同（历史经营事实）；referralCount 计任意状态引荐线索（引荐即口碑信号）。后续「有效合同」口径/客户生命周期阶段划分归 follow-up。
