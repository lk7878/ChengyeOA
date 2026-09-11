# SPEC-034 安全审计门禁加固（Security Audit Gate Hardening）设计

日期：2026-08-05 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-030/031 closeout §9「audit 门禁 moderate 纳入 gate + audit 基线快照固化（防静默回归）」
设计权威：本文档 ｜ 前置：SPEC-030（生产审计清零 + undici 契约下限锁死）+ SPEC-031（dev 审计清零）

## 1. 背景与目标

`security:audit:prod`/`security:audit:all` 当前 production **moderate 为 'report' 不 block**（SPEC-030 评审关注项）——未来依赖回退到 moderate 区间时 audit 门禁**静默放行**（不失败），仅契约测试下限（undici 6.28/7.29）部分兜底。且 `var/security/audit/` 基线条目是运行时快照非断言对象，无「改动前固化基线」机制（SPEC-030 评审「历史基线不可复核」）。

**目标**：①audit 门禁将 **moderate 纳入 gate**（production moderate >0 → 失败）；②**基线快照固化断言**（期望 baseline 文件声明各 severity 计数，audit 实测与 baseline 精确匹配——防静默回归）。**零业务代码变更**（仅 scripts/security 工具链 + baseline 文件）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | moderate gate | audit-gate/policy：production **moderate 纳入 gate**（>0 → fail）——与 high/critical 同待遇（`security:audit:prod` 门禁 moderate=0） |
| D2 | 基线快照 | 固化基线文件（如 `var/security/audit/expected-baseline.json` 或 policy 内嵌）声明各 severity 期望值（production + dev 全 0）；audit 实测与基线精确匹配（`validateGate` 扩展：实测 ≥ 期望 → 超基线 fail） |
| D3 | 兼容 | 当前依赖已清零（production+dev 全 0）——基线 0 与现状一致，无例外；未来新增依赖须先加例外（policy EXCEPTION 机制已有 `advisories` 字段） |
| D4 | 验证 | `security:test`（含 policy/audit-gate 单测）+ `security:audit:all`/`prod` 全绿 + baseline 断言通过 |
| D5 | 零业务代码 | 仅 scripts/security + baseline 文件；零 .ts 业务变更 |

## 3. 实现

### 3.1 moderate gate（audit-gate.mjs / policy.mjs）

- `audit-gate.mjs` `normalizeFindings`/门禁：将 moderate 纳入 severe 解析（当前 `advisory.severity !== 'high' && !== 'critical'` 跳过 moderate → 改为包含 moderate）。
- `policy.mjs` `validateGate`：SEVERITIES 含 moderate（已含）；门禁策略 production moderate 从 'report' 改 'block'（沿 gate.mjs/policy 配置）。

### 3.2 基线快照断言（policy.mjs / baseline 文件）

- 固化 `var/security/audit/expected-baseline.json`：声明 `{ server: { production: {high:0,moderate:0,low:0,critical:0}, development: {...} }, web: {...} }`。
- `policy.mjs`/`security:audit:all` 校验：audit 实测各 severity 计数 **≥ 基线** → 超基线 fail（新增依赖无例外时阻断）。
- policy EXCEPTION 机制（`advisories` 字段）保持：需例外的新增 advisory 走例外审批（owner/approvedBy/expiresAt）。

## 4. 测试策略

| 层 | 用例 |
|---|---|
| 单测 | policy/audit-gate 测试：moderate >0 基线 0 → fail / moderate=0 基线 0 → pass / 基线超出的 advisory 需例外 |
| 集成 | `security:test` 34+；`security:audit:all`/`prod` 全绿 + baseline 断言通过 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针（撞车期间禁跑）、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 5. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 13 全不变；`security:audit:all`/`prod` 保持全 0（baseline 0 断言）。

## 6. 范围边界（明确 OUT）

- 生产/依赖代码变更（仅工具链）。
- 例外审批流程实现（policy 已有 EXCEPTION 机制，本次仅接线 moderate gate + 基线）。
- 其他 severity（low/info）门禁——仅 moderate+ 收口。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 无人值守自主立项（用户授权） |
