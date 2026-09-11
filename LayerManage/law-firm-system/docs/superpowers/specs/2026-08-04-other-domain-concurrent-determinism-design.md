# SPEC-027 其余域并发测试确定性化（Other-Domain Concurrent Test Determinism）设计

日期：2026-08-04 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-026 closeout §9「其余域并发用例确定性化推广——finance/contract/CRM Promise.allSettled 审计」
设计权威：本文档 ｜ 前置：SPEC-026（审批域并发测试确定性化：仅真 flake 改确定性/宽容断言 + runbook §8 纪律）

## 1. 背景与目标

SPEC-026 已在审批域消除 Promise.allSettled 时序竞争 flake（仅 :2128 真 flake 改宽容断言，其余已确定性零改动）。其余域（contract/admin-governance/authorization/auth）仍有同类 Promise.allSettled 并发用例，可能有隐藏 flake 源。

**目标**：逐一评估 contract/admin-governance/user-grant/step-up/acceptance 的 Promise.allSettled 并发用例，**仅真 flake 改确定性/宽容断言**（沿用 SPEC-026 模式），其余已确定性零改动。**零结构变更**。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 评估优先 | 逐一审读各用例：已确定性（唯一约束/version 守卫/宽容断言）→ 零改动；真 flake → 改确定性/宽容断言（SPEC-026 :2128 先例） |
| D2 | 改造模式 | version 前置确定性（有 client version 参数）或宽容断言（无 version 参数）——沿 SPEC-026 runbook §8 纪律 |
| D3 | 适用面 | contract-service :908/:1516、negotiation :661、receivable :1130、receivable-void :509/:585、governance-concurrency :50/:73、user-grant :50、step-up :221、acceptance :177——逐一评估 |
| D4 | 断言不变 | 改造仅改触发方式，预期结果不变（一胜一败/409/终态） |
| D5 | 不可确定性化保留 | 需真实并发证据的保留 + 宽断言或注记（评审裁决） |
| D6 | 零结构变更 | 仅测试文件改造 |

## 3. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | 逐用例评估 + 真 flake 改造（确定性/宽容断言） |
| 回归 | 改造文件全绿（多次运行零 flake）+ 相关域零回归 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针（**撞车期间禁跑**——SPEC-026 补入纪律）、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 4. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 13 全不变；后端测试数不变（改造非新增）。

## 5. 范围边界（明确 OUT）

- 生产代码并发逻辑（仅测试，生产已由各域乐观锁/唯一约束覆盖）。
- approval 域并发用例（SPEC-026 已闭环）。
- 非 Promise.allSettled 的并发用例（FOR UPDATE 串行化等已确定性）。

## 6. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D6 | 见 §2 | 无人值守自主立项（用户授权） |
