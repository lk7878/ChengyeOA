# SPEC-028 依赖安全收口（Dependency Security Closeout）设计

日期：2026-08-04 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：spec-progress-and-next 远期候选「brace-expansion moderate 链（egg-session/koa-session/uuid）」+ SEC-2026-002 到期（2026-08-29）前收口 + audit 实测现存 2 moderate
设计权威：本文档 ｜ 前置：SEC-2026-002（react-router 8.3.0 + brace-expansion 5.0.8 双 production_high 已清零）

## 1. 背景与目标

`security:audit:prod` 现存 **2 个 production moderate**（非阻断但到期前应收口）：

1. **brace-expansion GHSA-rgw5-rvv9-x895**（DoS via unbounded intermediate arrays，<1.1.18）——影响 `multimatch`/`mz-modules` 链（当前 override `@<1.1.17→1.1.17` 未达 1.1.18）。
2. **uuid GHSA-w5hq-g745-h8pq**（Missing buffer bounds check，<11.1.1）——影响 `mochawesome-with-mocha`→uuid 链（当前 8.3.2）。

**目标**：override 升级至安全版本（brace-expansion ≥1.1.18、uuid ≥11.1.1），`security:audit:prod` moderate 清零。**零业务代码变更**（纯 package.json overrides + 依赖锁版本）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | brace-expansion | override `brace-expansion@<1.1.18: 1.1.18`（替换现有 `@<1.1.17: 1.1.17`）——覆盖 multimatch/mz-modules 链 |
| D2 | uuid | override `uuid@<11.1.1: 11.1.1`（或 11.1.1 兼容）——覆盖 mochawesome 链（仅 dev 依赖，生产不受影响但 audit 报 production） |
| D3 | 验证 | `security:audit:prod` moderate=0；`security:test` 34/34 零回归；npm ls 确认 override 生效；构建/测试零回归 |
| D4 | 零业务代码 | 仅 package.json + lock 更新；无 .ts 变更 |
| D5 | 兼容 | uuid 8→11 大版本——`mochawesome-with-mocha` 的 uuid 使用面仅测试工具（`v4()` 调用），11.x 向后兼容常见用法；若破坏测试工具链则回退版本并评估 |

## 3. 实现

`apps/server/package.json` overrides 更新：

```json
"overrides": {
  "brace-expansion@^5.0.5": "5.0.8",
  "brace-expansion@<1.1.18": "1.1.18",
  "uuid@<11.1.1": "11.1.1",
  ...
}
```

（`@^5.0.5→5.0.8` 保持主链；`@<1.1.18→1.1.18` 覆盖 1.x/2.x moderate 链。）

执行：`npm install` 应用 override → `npm ls brace-expansion uuid` 确认 → `npm audit` 确认 moderate 清零。

**⚠️ 兼容风险**：uuid 8→11 大版本 + brace-expansion 1.1.17→1.1.18 minor——若 `npm ls`/构建/测试工具链（mocha/nyc/egg-bin）报错，回退至最小满足版本（uuid 11.1.1 / brace-expansion 1.1.18 为 GHSA 修复版本）并评估。

## 4. 测试策略

| 层 | 用例 |
|---|---|
| audit | `security:audit:prod` moderate=0（server + web） |
| 回归 | `security:test` 34/34；后端全量（依赖版本变化后全绿）；前端四闸门（若 web 依赖变） |
| 工具链 | npm ls override 生效 + mocha/nyc/egg-bin 构建正常 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针（撞车期间禁跑）、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 5. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 13 全不变；`security:audit:prod` **2 moderate → 0**。

## 6. 范围边界（明确 OUT）

- 其他 audit 项（若 override 后仍有 low/info 级）——仅 moderate+ 收口。
- 依赖升级引发的功能重构（仅 override 版本，不重构代码）。
- react-router 8.3.0（SEC-2026-002 已覆盖，保留观察）。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 无人值守自主立项（用户授权） |
