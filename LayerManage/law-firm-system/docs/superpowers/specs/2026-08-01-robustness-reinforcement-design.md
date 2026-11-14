# SPEC-014 健壮性补强（Robustness Reinforcement）设计

日期：2026-08-01 ｜ 状态：用户批准（§1-3 全节）｜ 需求来源：SPEC-013 终审 F1 + Task 5 ⚠️②、SPEC-012 终审 F1、SPEC-013 Task 7 ⚠️③ + Task 8 M1
设计权威：本文档 ｜ 实施计划：待 writing-plans

## 1. 背景与目标

三个已验证防御性缺口（各有明确失败场景，均经评审/终审裁决路由）：
1. **callbackKey 跨实例 P2002 防御**（SPEC-013 终审 F1 + Task 5 ⚠️②）：`processTask` 幂等查找不校验 instanceId——同 key 跨实例顺序复用静默返回异视图；跨实例并发 P2002 目前 500。
2. **createPayment FOR UPDATE 竞速补强**（SPEC-012 终审 F1）：createPayment 状态门禁读与 INSERT 分属两事务且不取合同锁——与 terminate 竞速致 PENDING 固化到已终止合同（无 API 处置路径）。
3. **审批动作静默 catch UX**（Task 7 ⚠️③ + Task 8 M1）：approval-store 三动作 + RefundListPage approve catch 吞错——Step-Up 后 409/403 路径增多，用户无反馈。

**目标**：三缺口全部闭合。**零结构变更**（迁移 23/模型 60/权限 121/事件 15/路由均不变）；后端 + 前端增量修复 + 测试。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | callbackKey 顺序幂等查找 | `findFirst({callbackKey, instanceId: task.instanceId})`——同实例幂等返回；异实例占用 → `CALLBACK_KEY_CONFLICT` 409（复用现有码，不泄露异实例存在性） |
| D2 | callbackKey 并发 P2002 | create 冲突 catch → 重读：同实例幂等返回；异实例 409。杜绝 500 |
| D3 | createPayment 竞速 | INSERT 事务内首把锁 = Contract 行 FOR UPDATE（仿 confirmPayment）+ 持锁后重验 `status ∈ SIGNED/EFFECTIVE` → 否 `CONTRACT_STATE_TRANSITION_INVALID` 409（复用门禁码）；锁序 Contract→Payment 无死锁 |
| D4 | UX 反馈 | approval-store 三动作 catch `message.error`（读 response.data.message 业务码）+ 返回 false/null 保持契约；RefundListPage approve catch 同加 |
| D5 | 零结构变更 | 无新模型/权限/事件/路由/迁移 |

## 3. callbackKey 防御（approval-instance-service）

### 3.1 现状缺口

`processTask` 幂等查找（:197-202）：`findUnique({callbackKey})`——同 key 跨实例顺序复用（调用方违规）静默丢弃返回**首实例**视图；跨实例并发（两事务均读 null）后写者 P2002 → 目前未捕获 500。

### 3.2 修复

1. **顺序幂等查找限定实例域**：`findUnique({callbackKey})` → `findFirst({callbackKey, instanceId: task.instanceId})`。同实例命中 → 幂等返回首结果；发现 callbackKey 已被异实例占用 → `CALLBACK_KEY_CONFLICT` 409（错误消息如 `'idempotency key already used for another approval'`——不泄露异实例 id）。
2. **并发 P2002 捕获**：callbackAction create 抛 P2002（isUniqueConflictOn callbackKey）→ catch → 事务内重读 callbackKey：同实例 → 幂等返回首结果；异实例 → `CALLBACK_KEY_CONFLICT` 409。杜绝 500。

### 3.3 测试

- 顺序同实例幂等（既有）。
- **顺序异实例 → 409**（首个实例已用 key，第二实例同 key → CALLBACK_KEY_CONFLICT）。
- **并发同 key 异实例 → 409 非 500**（P2002 钉法——两事务同时发，后写者 catch 重读异实例 → 409）。

## 4. createPayment FOR UPDATE（receivable-service）

### 4.1 现状缺口（SPEC-012 F1）

`createPayment` 合同探查（:340-342）事务外无锁 + `createWithPaymentNoRetry` 独立事务 INSERT。terminate 在途闸 plain read + version 乐观锁。竞速：createPayment 读 EFFECTIVE → terminate 翻转 TERMINATED（在途闸未见未提交 PENDING）→ createPayment INSERT PENDING 到已终止合同 → 该 PENDING 不可 confirm（Task 5 门禁）/void（需 CONFIRMED）/refund（需 CONFIRMED）——无 API 处置路径。

### 4.2 修复

INSERT 事务内首把锁 = Contract 行 FOR UPDATE（仿 confirmPayment 锁点 `$queryRaw SELECT id FROM contract ... FOR UPDATE`）+ 持锁后重读合同 + 重验 `status ∈ SIGNED/EFFECTIVE` → 否 `CONTRACT_STATE_TRANSITION_INVALID` 409（复用现有门禁码），整事务回滚零行。锁序 Contract→Payment 与 confirmPayment/void/refund 全写路径同序，无死锁。

### 4.3 测试

- **terminate 先胜 → createPayment 409 零行**（持锁钉法：第三方持合同锁 1s 造确定性串行——terminate 先提交 TERMINATED → createPayment 锁后重验 → 409）。
- createPayment 先胜 → terminate 在途闸见 PENDING → 409（既有语义回归）。
- 既有 createPayment 用例（EFFECTIVE/SIGNED 正常登记）零回归。

## 5. UX（approval-store + RefundListPage）

### 5.1 现状缺口（Task 7 ⚠️③ + Task 8 M1）

`approval-store.ts:86-107` 三动作吞错 return null/false；`RefundListPage` approve catch 静默——Step-Up 后 409（陈旧 expectedVersion）/403 路径增多，用户无反馈（Modal 静默保持打开）。

### 5.2 修复

1. **approval-store** 三动作（applyApproval/processApproval/withdrawApproval）：catch → `message.error`（读 `response.data.message` 业务码或友好文案）+ return false/null（保持既有调用方契约）。
2. **RefundListPage** approve catch：`message.error`（含 409/403 路径）——Modal 保持打开，用户可见错误。

### 5.3 测试

- store 动作失败 → message.error 调用断言。
- 页面 catch → 错误提示断言。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| callbackKey 防御 | 顺序异实例 409 / 并发同 key 异实例 409 非 500 / 同实例幂等回归 |
| createPayment | terminate 先胜 409 零行（持锁钉法）/ 正常登记回归 |
| UX | store 失败 message.error / 页面 catch 提示 |
| 回归 | approval 域 + contract 域 + refund 既有全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库且 `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 7. 计数影响

**零结构变更**：迁移 23、模型 60、权限 121、事件 15、路由不变；后端测试 +N、前端 +N（增量）。

## 8. 范围边界（明确 OUT）

审批中心多级/会签/Definition 管理/全组织视图；业务角色供给五码；TOTP 产品策略；漂移治理；前端 flake；安全专项。均独立 follow-up。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 用户批准（§1-3 全节） |
