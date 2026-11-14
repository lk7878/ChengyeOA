# SPEC-015 审批中心业务角色供给（Approval Role Provisioning）设计

日期：2026-08-02 ｜ 状态：用户批准（§1-3 全节 + 后续直接确认）｜ 需求来源：SPEC-013 closeout「业务角色供给五码」（HR/SEAL_ADMIN/FINANCE/PARTNER 未创建致审批中心 5 类申请全部 400）
设计权威：本文档 ｜ 实施计划：待 writing-plans

## 1. 背景与目标

SPEC-013 审批中心 5 类 Definition 种子（LEAVE/SEAL/EXPENSE/CONTRACT_CHANGE/TRANSFER）的 `approverRule.roleCodes` 引用 HR/SEAL_ADMIN/FINANCE/PARTNER 四角色码——但 bootstrap 仅创建 SYSTEM_ADMIN/SYSTEM_SUPER_ADMIN 两 SYSTEM 角色，**四业务角色不存在** → 审批人解析空集 → 5 类申请全部落 `APPROVAL_ASSIGNEE_INVALID` 400。刚交付的审批中心实际不可用。

**目标**：5 个约定业务角色 bootstrap 种子供给（fresh init 即存在）+ 授予审批权限，使五类申请端到端可用。**零结构变更**（Role/RolePermission 模型已存在，仅数据供给）。

## 2. 核心决策（Q1-5）

| # | 决策 | 值 |
|---|---|---|
| Q1 | 供给机制 | **bootstrap 种子**（system-bootstrap-service 扩展：沿既有 SYSTEM 角色创建形态建 4 个 BUSINESS 角色）——fresh init 即存在，优于迁移（避免 Role 入 assert-empty 排除的语义漂移——Role 在扫描名单 :18 仅排除四表）与纯运行期（无代码不落地） |
| Q2 | 角色集 | **4 唯一码**：HR（人事管理）/SEAL_ADMIN（印章管理员）/FINANCE（财务）/PARTNER（合伙人）；TRANSFER 复用 HR；type='BUSINESS'、status ENABLED；与 Definition 种子 roleCodes 逐字对齐 |
| Q3 | 权限授予 | 每角色 role_permission 种子：**approval.read + approval.process**（审批人角色）；approval.apply 不授（申请人为一般员工，非必经角色） |
| Q4 | 成员指派 | **运行期设置**（role-auth-service/user-grant 指派成员）——文档化（runbook/closeout），非代码 |
| Q5 | 契约更新 | check-bootstrap-contract 断言 2→6 角色（2 SYSTEM + 4 BUSINESS） |

## 3. 行为细节

- **system-bootstrap-service 扩展**：事务内沿既有 `tx.role.create`（:65-91）形态追加 4 个 BUSINESS 角色（code/name/type='BUSINESS'/status='ENABLED'）+ 各角色 role_permission 两行（approval.read/approval.process——permission 按 code 查 id）。
- **check-bootstrap-contract**：更新角色计数断言（2→6）+ 角色 code 清单（SYSTEM_ADMIN/SYSTEM_SUPER_ADMIN/HR/SEAL_ADMIN/FINANCE/PARTNER）。
- **resolveRoleMembers 兼容**：现有查询 `role.findMany {code in, status ENABLED}`（approval-instance-service:557）已兼容——bootstrap 后角色存在即解析；成员为空时仍 400（指派后生效）。
- **审计**：bootstrap 建角色属初始态供给，不产生审批域事件/审计（沿既有 bootstrap 形态）。

## 4. 测试策略

| 层 | 用例 |
|---|---|
| bootstrap | fresh init 后角色恰 6（4 BUSINESS code 清单+类型 BUSINESS+状态 ENABLED）；check-bootstrap-contract PASS |
| 权限授予 | HR 等四角色 role_permission 含 approval.read/process（直查） |
| 端到端 | 测试内指派成员 → LEAVE 申请（HR 角色解析成员）→ HR 成员审批定稿——五类各一（LEAVE/SEAL/EXPENSE/CONTRACT_CHANGE/TRANSFER） |
| 回归 | 既有 bootstrap/授权/审批域全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库且 `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 5. 计数影响

**零结构变更**：迁移 23、模型 60、权限 121、事件 15、路由不变；后端测试 +N（增量）。

## 6. 范围边界（明确 OUT）

成员指派（运行期设置，文档化）、审批中心深化（多级/会签/Definition 管理/全组织视图 approval.manage）、terminate 侧硬化（SPEC-014 MEDIUM 反向竞速）、SUPPLEMENT 父状态复查、漂移治理、前端 flake、安全专项（SEC-2026-002）。均独立 follow-up。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| Q1-Q5 | 见 §2 | 用户批准（§1-3 全节 + 后续直接确认） |
