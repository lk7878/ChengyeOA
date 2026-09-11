# SPEC-031 dev 依赖清理（Dev Dependency Cleanup）设计

日期：2026-08-04 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-030 closeout §9「dev 依赖清理（brace-expansion 5.0.8→5.0.9 + tar + web undici 7.28.0——生产已清零，dev 遗留）」
设计权威：本文档 ｜ 前置：SPEC-030（依赖安全收口——production 已清零，dev 遗留）

## 1. 背景与目标

`security:audit:all`（含 dev 依赖）仍报失败——dev 作用域遗留（production 审计已 0，但全量审计含 dev 工具链）：

- **server**：brace-expansion 5.0.8（GHSA-mh99-v99m-4gvg/rgw5-rvv9-x895 high，既有 override `@^5.0.5: 5.0.8` 未达 5.0.9）+ tar 7.5.20（GHSA-r292-9mhp-454m moderate）。
- **web**：brace-expansion 5.0.8（high）+ postcss ≤8.5.22（moderate）+ undici 7.28.0（GHSA-8xcm/4cwx/m8rv/jr45/v3r7 high，<7.29.0）。

**目标**：dev 依赖 override/升级清零，`security:audit:all` 全绿（含 dev）。**零业务代码变更**（纯 package.json overrides + lock）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | brace-expansion | server override `brace-expansion@^5.0.5: 5.0.8` → `5.0.9`（修复 GHSA-mh99/rgw5 high）；web +override `brace-expansion@^5.0.5: 5.0.9` |
| D2 | tar | server +override `tar@<7.5.21: 7.5.21`（修复 GHSA-r292 moderate） |
| D3 | undici | web +override `undici@<7.29.0: 7.29.0`（修复 GHSA-8xcm/4cwx/m8rv/jr45/v3r7 high） |
| D4 | postcss | web +override `postcss@<8.5.23: 8.5.23`（修复 moderate）——或最新兼容版本，实现时按 audit 建议 |
| D5 | 验证 | `security:audit:all`（server + web）全绿含 dev（high=0/moderate=0）；`security:test` 34/34；构建/测试工具链零回归 |
| D6 | 零业务代码 | 仅 package.json + lock；零 .ts |

## 3. 实现

`apps/server/package.json` + `apps/web/package.json` overrides 更新（按 D1-D4）。`npm install` 两处 → `security:audit:all` 验证。

**⚠️ 兼容风险**：brace-expansion 5.0.8→5.0.9 minor（dev 工具链 eslint 等）；tar 7.5.20→7.5.21 minor；undici 7.28.0→7.29.0 minor；postcss 8.5.22→8.5.23 minor——均 minor 升级低风险；若破坏 dev 工具链回退评估。

## 4. 测试策略

| 层 | 用例 |
|---|---|
| audit | `security:audit:all`（server + web）全绿含 dev（high=0/moderate=0） |
| 回归 | `security:test` 34/34；后端全量；前端四闸门（web 依赖变）；工具链（eslint/tsc/build）零回归 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针（撞车期间禁跑）、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 5. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 13 全不变；`security:audit:all` **dev 遗留 → 0**（生产已 0）。

## 6. 范围边界（明确 OUT）

- 生产依赖（SPEC-030 已清零，不改）。
- 其他 audit 项（若 override 后仍有 low/info 级）——仅 high/moderate 收口。
- 依赖大版本升级（均 minor，不重构）。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D6 | 见 §2 | 无人值守自主立项（用户授权） |
