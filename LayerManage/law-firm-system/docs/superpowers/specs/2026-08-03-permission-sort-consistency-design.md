# SPEC-022 权限排序一致性（Permission Sort Consistency）设计

日期：2026-08-03 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-021 Task 2 全量 71 fail 根因——`assertPermissionCatalog` localeCompare vs PG ORDER BY C collation 排序不一致（外部并行渠道 `user_role.membership.manage` 权限码触发，closeout §7.5/§8.1 跨渠道待办）
设计权威：本文档 ｜ 前置：SPEC-002（bootstrap 信任根）+ SPEC-015/021（权限目录 122→124 漂移）

## 1. 背景与目标

`SystemBootstrapService.assertPermissionCatalog`（system-bootstrap-service.ts:200-240）用 JS `localeCompare` 排序 `PERMISSION_CATALOG`，DB 查询用 PostgreSQL `ORDER BY code`（默认 **C collation**）。两者排序语义不同：

- **JS `localeCompare`**（默认 locale，如 en-US）：语言排序，`.`（46）与 `_`（95）的次序受 locale 规则影响，`_` 常被忽略/置于特定位置。
- **PG C collation**：严格 ASCII 字节序——`.`(46) < 大写字母(65-90) < `_`(95) < 小写字母(97-122)。故含下划线的码（`user_role.membership.manage`、`menu.organization_personnel` 等）与含点分段码在两种排序下**相对次序不同** → 逐位比对错位 → `InconsistentSystemStateError: Permission catalog is inconsistent`。

该缺陷**既有潜在**（权限码一直含下划线，但此前无对应边界触发），由外部并行渠道新增 `user_role.membership.manage`（第 123 码）在 SPEC-021 全量中暴露（71 fail 根因）。`assertEventSubscriptionCatalog`（:256）同模式。

**目标**：catalog 侧排序对齐 PG C collation 字节序——修复权限/事件订阅 catalog 断言，使含下划线码的 bootstrap 一致性校验正确。**零结构变更**。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 排序对齐 | catalog 侧排序改用**显式 C collation 字节序比较器**（非 localeCompare）——对齐 PG `ORDER BY code` 语义（ASCII 字节序：`.`< 大写 < `_` < 小写） |
| D2 | 实现 | 提取模块级 `compareByCodeC` 助手（`(left, right) => left.code < right.code ? -1 : left.code > right.code ? 1 : 0`——纯字典序，等值于 PG C collation 对 ASCII 码） |
| D3 | 应用点 | `assertPermissionCatalog`（:216）+ `assertEventSubscriptionCatalog`（:256）两处 sort 替换 |
| D4 | 幂等/向后兼容 | 排序助手零副作用（仅比较器）；既有无下划线码的排序序不变（字典序与 C collation 对纯字母数字点分段一致） |
| D5 | 测试 | 补含下划线码的 bootstrap 一致性用例（构造含 `_` 码的目录 → 断言不抛 InconsistentSystemStateError；对照旧 localeCompare 会抛） |
| D6 | 零结构变更 | 无迁移/模型/权限/事件/路由变更（排序逻辑修复） |

## 3. 实现（system-bootstrap-service.ts）

```ts
/** PG C collation 字节序比较器（对齐 ORDER BY code 默认语义——ASCII：`.`<大写<`_`<小写）。 */
function compareByCodeC(left: { code: string }, right: { code: string }): number {
  return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
}

// assertPermissionCatalog :216
const expected = [...PERMISSION_CATALOG].sort(compareByCodeC);

// assertEventSubscriptionCatalog :256
const expected = [...EVENT_SUBSCRIPTION_CATALOG].sort(compareByCodeC);
```

**正确性**：`<`/`>` 对字符串是 UTF-16 码元序，对纯 ASCII 码（权限码/事件码均 ASCII）逐字节等价 PG C collation；`_`(95) > 大写(65-90)、`.`(46) < 大写——与 PG 一致。

## 4. 测试策略

| 层 | 用例 |
|---|---|
| 服务 | 含下划线码目录（`user_role.membership.manage` 形态）→ assertPermissionCatalog 不抛（旧 localeCompare 会抛——TDD 红→绿）/ assertEventSubscriptionCatalog 同 / 既有无下划线码零回归 |
| 回归 | system-bootstrap 域既有（auth/system-bootstrap/user/role/browser-fixture）+ 权限目录契约全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 5. 计数影响

**零结构变更**：迁移 26/模型 60/权限（漂移后 124，非本 SPEC 变更）/事件 15/路由 11 全不变；后端测试 +N（排序用例）。

## 6. 范围边界（明确 OUT）

- 权限目录本身增删（外部渠道在制，不触碰）。
- 权限计数 122→124 契约测试同步（外部渠道同步，非本 SPEC）。
- 事件订阅目录内容变更。
- 其他 localeCompare 使用点（crm/其他域——仅修 bootstrap 断言两处，其余无关）。

## 7. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D6 | 见 §2 | 无人值守自主立项（用户授权） |
