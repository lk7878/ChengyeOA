# SPEC-040 例外审批 CLI（Audit Exception Review CLI）设计

日期：2026-08-05 ｜ 状态：用户授权自主推进 ｜ 需求来源：SPEC-036 closeout §9「例外自动审批流——Web 表单/服务端审批状态机（`pending_review`→`approved` 经接口审批）——设计 §6 OUT，可专项」
设计权威：本文档 ｜ 前置：SPEC-036（例外生命周期 status + `security:exceptions` 治理报告）、SPEC-038（SEC-2026-001 退役）

## 1. 背景与目标

SPEC-036 给例外加了生命周期（`pending_review`→`approved`，仅 approved 生效），但审批动作仍是**人工编辑 `security/dependency-exceptions.json`**（手改 status）。本 SPEC 把审批升级为**受控 CLI 命令**：`security:exceptions approve <id>` / `security:exceptions reject <id>`——审批是独立、可校验、可审计的动作，附评审元数据（reviewedAt/reviewedBy），替代裸文件编辑。**零业务代码变更**（仅 scripts/security 工具链 + exceptions 配置）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | approve 子命令 | `security:exceptions approve <id> --reviewed-by <name>`：条目 status `pending_review`→`approved`；设 `approvedBy=reviewedBy`、`reviewedAt=today`、`reviewedBy=name`；`name===owner` 拒（沿用 policy 独立审批约束）；已 approved → 幂等信息；找不到 → 错误 |
| D2 | reject 子命令 | `security:exceptions reject <id>`：移除该条目（rejected 不入库——未批准的请求不留在清单）；找不到 → 错误 |
| D3 | 评审元数据 | policy.mjs 例外新增**可选**字段 `reviewedAt`（ISO 日期）/ `reviewedBy`（非空字符串）校验；legacy 无此二字段兼容 |
| D4 | 原子写回 | approve/reject 修改后原子写回（temp 文件 + rename 覆盖），失败不损坏原文件 |
| D5 | 验证 | `security:test` 全绿（approve/reject/幂等/不存在/自审拒/reviewedAt 非法/reviewedBy 空）+ audit 双绿 + `security:exceptions` 报告反映审批结果 |

## 3. 实现

### 3.1 cli.mjs 子命令解析

- `parseCommandArguments`：`audit-exceptions` 带参解析——`approve <id> --reviewed-by <name>`（5 参）/ `reject <id>`（3 参）；非法参 fail。
- 返回 `{ command: 'audit-exceptions', action, id, reviewedBy? }`。

### 3.2 approve 实现（`approveException`）

1. 读 `{projectRoot}/security/dependency-exceptions.json` + `validateExceptions`（严格）。
2. 按 id 找条目；不存在 → fail `exception ${id} not found`。
3. 条目 status 若已 `approved` → 幂等信息（exit 0，不重写）；若非 `pending_review`（invalid status 已被校验拦截）→ 防御。
4. `reviewedBy` 非空校验；`reviewedBy === owner` → fail（独立审批）。
5. 设 `status='approved'`、`approvedBy=reviewedBy`、`reviewedAt=today(ISO)`、`reviewedBy=reviewedBy`。
6. 原子写回（temp + rename）；输出 `approved <id> by <name> on <date>`。

### 3.3 reject 实现（`rejectException`）

1. 读 + `validateExceptions`。
2. 按 id 找条目；不存在 → fail。
3. 从数组移除；原子写回；输出 `rejected <id>`（若该条目曾生效即被移除）。

### 3.4 policy.mjs 评审元数据校验

- 例外允许的**可选**字段追加 `reviewedAt` / `reviewedBy`（不在 required EXCEPTION_FIELDS，同 status 的 optional 处理）。
- `reviewedAt` 若存在须合法 ISO 日期；`reviewedBy` 若存在须非空字符串。
- 其余既有校验不变。

### 3.5 npm script

- `security:exceptions` 已存在（报告）；`approve`/`reject` 为子命令参数（`npm run security:exceptions -- approve <id> --reviewed-by <name>`）。

## 4. 测试策略

| 层 | 用例 |
|---|---|
| cli.test.mjs | approve：pending→approved（文件落盘 + status/approvedBy/reviewedAt/reviewedBy 断言）；already-approved 幂等；not-found 错误；owner==reviewer 拒；reject：移除条目（文件落盘）；not-found 错误；解析：非法参 fail |
| policy.test.mjs | reviewedAt 非法日期拒 / reviewedBy 空拒 / 二字段缺省兼容 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、`_test` 库、55432 禁触、撞车期间禁跑。安全脚本测试不需 DB。

## 5. 计数影响

**零结构变更**：迁移 **29**（外部在制）/模型 60/权限 **132**（外部在制）/事件 15/路由 **26**（外部在制）全不变；`security:test` 49→**~55**（+~6）；audit:all/prod 保持全 0；`security:exceptions` 报告不变（报告命令 + 审批子命令共存）。

## 6. 范围边界（明确 OUT）

- **Web 审批 UI**（浏览器审批流）——超出工具链，例外仍 CLI/文件治理。
- **服务端审批状态机**（DB 持久化审批记录）——例外是 repo 配置非 DB 数据，审批元数据落在 JSON。
- **批量审批**（多 id 一次批）——例外数量小，逐个即可。
- **审批通知**（通知 approver）——无邮件/IM 集成。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D5 | 见 §2 | 用户授权自主推进 |
