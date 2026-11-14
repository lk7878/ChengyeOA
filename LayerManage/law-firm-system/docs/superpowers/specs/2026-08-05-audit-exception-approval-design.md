# SPEC-036 审计例外审批闭环（Audit Exception Approval Workflow）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进 ｜ 需求来源：SPEC-034 closeout §9「例外审批流程——policy EXCEPTION 机制已接线（advisories 字段，development scope），但审批流程本身未实现（当前需人工编辑 `security/dependency-exceptions.json`）」
设计权威：本文档 ｜ 前置：SPEC-030（生产审计清零 + 契约下限锁死）、SPEC-031（dev 审计清零）、SPEC-034（moderate gate + 基线断言）

## 1. 背景与目标

`security/dependency-exceptions.json` 是 audit 门禁的豁免机制（development scope）。当前**按存在即生效**——文件里有该条即豁免 advisory，无任何审批/审查状态，到期/待审不可观测。治理缺口：任何人（或误操作）往文件加一条即静默放行，无「已审批」与「待审批」区分，也无到期预警。

**目标**：①例外增加**生命周期状态**（`pending_review` → `approved`），**仅 approved 生效**（未审批不豁免，fail-closed）；②新增**治理报告命令** `security:exceptions` 列出待审/已批/到期例外 + 到期预警；③向后兼容（legacy 无 status = approved）。**零业务代码变更**（仅 scripts/security 工具链 + exceptions 配置）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | status 生命周期 | 例外 +`status`：`pending_review` \| `approved`；**缺省 `approved`**（legacy 无 status 向后兼容，当前唯一例外 SEC-2026-001 保持生效）。枚举白名单校验 |
| D2 | 生效性 | audit-gate `hasException` **仅认 `approved`**（或 legacy 无 status）；`pending_review` 不豁免 → 该 advisory 仍 block（audit 门禁不静默放行，fail-closed） |
| D3 | 治理报告 | cli.mjs 新增 `audit-exceptions` 子命令（`npm run security:exceptions`）：读 raw JSON 分类列出 approved / pending_review / expired / invalid + 到期预警（N 天内）；gate 仍严格校验（expired 仍 fail-closed） |
| D4 | 验证 | policy/audit-gate/cli 单测（status 枚举/缺省兼容/pending 不豁免/approved 豁免/报告分类）+ `security:audit:all`/`prod` 全绿 |
| D5 | 零业务代码 | 仅 scripts/security（policy.mjs/audit-gate.mjs/cli.mjs/各 test）+ `security/dependency-exceptions.json`（SEC-2026-001 显式补 `status: "approved"`）；零 .ts 业务变更 |

## 3. 实现

### 3.1 status 校验（policy.mjs `validateExceptions`）

- `EXCEPTION_FIELDS` 追加 `status`（可选）。
- 校验：status 若存在须 ∈ `{pending_review, approved}`；缺省视为 `approved`。
- 其余既有校验（workspace/package/scope=development/owner≠approvedBy/advisories/createdAt/expiresAt/生命周期 ≤ maxDevelopmentExceptionDays/未过期）不变。

### 3.2 生效性（audit-gate.mjs `hasException`）

- `hasException` 追加：`(exception.status === undefined || exception.status === 'approved')` 才匹配。
- `pending_review` 例外被跳过 → development `exception` 动作仍 block、baselineExcess 不豁免。

### 3.3 治理报告（cli.mjs `audit-exceptions`）

- 新子命令 `audit-exceptions`（npm script `security:exceptions`）。
- 读 `{projectRoot}/security/dependency-exceptions.json` raw（不严格校验，容错展示）：
  - 按 status 分组输出：`approved`（含 legacy 无 status）/ `pending_review` / `expired`（expiresAt 已过）/ `invalid`（结构非法，逐条列出问题）。
  - 到期预警：expiresAt 距今 ≤ 14 天标 `expiring_soon`。
  - 输出不含敏感内容（无密码/URL）；exit 0（信息命令，不 gate）。

### 3.4 配置更新

- `security/dependency-exceptions.json` 中 SEC-2026-001 显式补 `"status": "approved"`（语义明确化，行为不变）。

## 4. 测试策略

| 层 | 用例 |
|---|---|
| policy.test.mjs | status 合法枚举接受 / 非法 status 拒绝 / 缺省兼容（无 status = approved）/ status 与 expiresAt 等其余字段共存校验不变 |
| audit-gate.test.mjs | `pending_review` 例外**不豁免**（development high 仍 block + baselineExcess 不豁免）/ `approved`（含 legacy）豁免 / 混合（同 package 一 pending 一 approved → approved 生效） |
| cli.test.mjs | `audit-exceptions` 报告：approved/pending_review/expired/invalid 分类 + expiring_soon 预警 + 非法 JSON 容错输出 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、`_test` 库、55432 禁触、撞车期间禁跑。

## 5. 计数影响

**零结构变更**：迁移 **28**（外部在制）/模型 60/权限 129/事件 15/路由 22 全不变；`security:test` 34→**42**→**~48**（+~6 用例）；`security:audit:all`/`prod` 保持全 0（当前唯一例外 SEC-2026-001 为 development legacy，approval 后仍不触发）。

## 6. 范围边界（明确 OUT）

- 例外**自动审批流**（Web 表单/服务端审批状态机）——超出工具链范围，例外文件仍人工维护。
- 例外**分页/检索**（例外数量小，列表即足够）。
- **生产 scope 例外**——scope 仍限 development（生产 zero-advisory 策略不变，见 SPEC-034 M-2 基线硬阻断）。
- baseline 演进流程（SPEC-034 §9 另一 follow-up，另行）。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 用户授权自主推进 |
