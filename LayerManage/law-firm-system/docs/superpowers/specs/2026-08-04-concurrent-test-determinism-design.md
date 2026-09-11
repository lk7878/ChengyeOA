# SPEC-026 并发测试确定性化（Concurrent Test Determinism）设计

日期：2026-08-04 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-024 closeout §9「并发测试确定性化推广——既有 Promise.allSettled 时序并发用例改 version 前置确定性构造」+ SPEC-018/019/023/024 多次全量 flake 观察
设计权威：本文档 ｜ 前置：SPEC-024（version 前置确定性构造先例——同体 PATCH 并发用例）

## 1. 背景与目标

项目多个并发测试用例用 `Promise.allSettled` 双调/多调制造时序竞争（loser 的初始读与 winner 提交竞速），导致**偶发 flake**（loser 读落 winner 提交后 → 双成功而非一胜一败）——已在 instance forwardTask concurrent、service update/setStatus/组合方法、processTask callbackKey 等多次全量中观察到。SPEC-024 已为同体 PATCH 引入 **version 前置确定性构造**（先推进 version、客户端持旧 version 调用 → 409，全程无时序依赖），验证有效。

**目标**：将既有 Promise.allSettled 时序竞争并发用例**推广改造为确定性构造**（version 前置 / 锁竞争可控 / 状态前置），消除 flake 源。**零结构变更**（仅测试代码改造）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 确定性构造优先 | 并发用例改 **version 前置条件**（如 SPEC-024 同体 PATCH 先例：先推进 version、客户端持旧 version 调用 → 确定性 409）——无时序依赖 |
| D2 | 保留竞争语义 | 若需真实并发竞争证据，用**可控锁竞争构造**（prisma 事务持行锁未提交 + 第二 client 读旧 version 后 updateMany 阻塞于行锁 → 提交后重评估 count=0 → 409）——但 **SPEC-024 实证 pg_stat_activity 轮询不可靠**（非超级用户看不到 query），故**首选 version 前置** |
| D3 | 适用面 | 已知 flake 源：`approval-instance-service.test.ts` :586（processTask callbackKey 跨实例并发）/ :2128（forwardTask 并发竞争）/ :2188/:2554（其他）；`role-authorization-service.test.ts` :74。逐一评估改造 |
| D4 | 断言不变 | 改造仅改**触发方式**（时序竞争 → 确定性构造），**预期结果不变**（一胜一败/一 200 一 409 等）——零行为断言变化 |
| D5 | 不可确定性化的保留 | 部分用例（如 callbackKey 跨实例并发 P2002 兜底）需真实并发触发——保留 Promise.allSettled 但**加 retry/容错**或**注记 flake 已知**（评审裁决） |
| D6 | 零结构变更 | 仅测试文件改造，无生产代码变更 |

## 3. 改造模式

### 3.1 version 前置确定性构造（首选）

```ts
// 原：Promise.allSettled 双调（时序 flake）
// 改：先推进 version 提交，客户端持旧 version 调用 → 确定性 409
await prisma.approvalTask.update({ where: { id }, data: { version: { increment: 1 } } });  // 模拟并发 winner 已提交
await assert.rejects(
  () => service.forwardTask(id, { forwardToUserId: 'B' }),
  isApprovalError(APPROVAL_STATE_INVALID, 409),
);
// 断言：task 未被触碰（assigneeId 不变 / version 不变）
```

适用：forwardTask / updateDefinition / setDefinitionStatus / 组合方法等**有 version 守卫**的并发用例。

### 3.2 保留真实并发 + 容错（需真实竞争证据时）

若用例需证明「两并发调用恰一胜一败」的真实并发语义（非仅守卫正确性），保留 Promise.allSettled 但：
- 断言改为**宽泛**（胜者成功 + 败者 409 或 404——两者皆可接受，因 loser 读落 winner 提交前后语义不同）；
- 或加 **retry**（flake 时重跑一次）；
- 评审裁决哪些保留、哪些改确定性。

## 4. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | 逐用例改造后断言不变（一胜一败/409）+ 确定性（无时序依赖——多跑不 flake） |
| 回归 | 改造文件全绿（多次运行确认零 flake）+ 相关域零回归 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 5. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 13 全不变；后端测试数不变（改造非新增）。

## 6. 范围边界（明确 OUT）

- 生产代码并发逻辑改造（仅测试，生产已由 SPEC-024/019 乐观锁覆盖）。
- callbackKey P2002 兜底并发用例（若不可确定性化，评审裁决保留或容错）。
- 其他域并发用例（finance/contract 等——仅本 SPEC 清单内 approval/authorization）。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D6 | 见 §2 | 无人值守自主立项（用户授权） |
