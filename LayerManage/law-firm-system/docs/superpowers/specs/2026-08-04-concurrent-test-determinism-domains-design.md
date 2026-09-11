# SPEC-027 其余域并发测试确定性化（Concurrent Test Determinism — Domains）设计

日期：2026-08-04 ｜ 状态：用户授权自主推进 ｜ 需求来源：SPEC-026 closeout §9「其余域并发用例确定性化推广——finance/contract/CRM 等域若存在 Promise.allSettled 时序竞争并发用例」+ 各域全量 flake 观察
设计权威：本文档 ｜ 前置：SPEC-026（approval/authorization 域确定性构造——宽容断言 :2128）、SPEC-024（version 前置确定性构造）

## 1. 背景与目标

SPEC-026 已将 approval/authorization 域的 `Promise.allSettled` 时序竞争并发用例确定性化（仅 :2128 forwardTask 一处真 flake 改宽容断言）。**其余域**（contract/finance/crm/master-data/system/admin-governance/auth/events/acceptance）仍存在 ~24 处 `Promise.allSettled` 用法——逐一评估分类，修补**真 flake**，将确定性纪律推广到全项目。

**目标**：系统化评估全部 ~24 处 `Promise.allSettled` 并发用例，分类确认确定性，修补真 flake，消除残余 flake 源。**零结构变更**（仅测试改造）。

## 2. 评估分类框架（D1）

| 分类 | 判定 | 处置 |
|---|---|---|
| **A. 唯一约束竞争** | 双调/create 并发触唯一约束（code/identity/外键）→ P2002 → 冲突码；串行化也一胜一败 | **已确定性，零改动**（唯一约束保证结果） |
| **B. version 守卫（client version 参数）** | 服务接受客户端 version + updateMany {id, version} 守卫 → 双调同 version → 一胜一败 VERSION_CONFLICT | **已确定性，零改动** |
| **C. 受控锁竞争（lockHolder）** | prisma 事务持 FOR UPDATE 行锁 + 固定延时 → 竞速方在锁下确定性一胜一败/双成功 | **已确定性，零改动** |
| **D. 宽容断言** | 断言接受多结果（成功或 409/404 皆可）+ 终态钉死 | **不 flake，零改动** |
| **E. 真 flake** | 无唯一约束/无 client version/无锁控/固定断言——loser 结果取决于读取时序 | **修补**（version 前置 / 宽容断言 / lockHolder） |
| **F. 非并发测试** | `Promise.allSettled` 仅作清理（`$disconnect` 等）或单元素包装 | **零改动** |

## 3. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 分类框架 | §2 六分类（A-F）逐一评估 |
| D2 | 确定性构造 | 真 flake（E）按 SPEC-026 模式修补——有 client version 参数的服务用 version 前置；无的用宽容断言或 lockHolder |
| D3 | 断言不变 | 改造仅改触发方式，预期结果不变（一胜一败/409 等） |
| D4 | 零结构变更 | 仅测试文件改造 |
| D5 | 文档化 | 评估表 + runbook §8 纪律扩展 + closeout——全项目确定性纪律固化 |

## 4. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | 逐用例按 A-F 分类；E 类修补后断言不变 + 多次运行确认零 flake |
| 回归 | 改造文件全绿（多次运行）+ 相关域零回归 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触、撞车期间禁跑。

## 5. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 13 全不变；后端测试数不变（改造非新增）。

## 6. 范围边界（明确 OUT）

- 生产代码并发逻辑改造（仅测试）。
- approval/authorization 域（SPEC-026 已闭环）。
- 新功能开发。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §3 | 用户授权自主推进 |
