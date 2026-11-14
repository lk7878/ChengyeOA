# SPEC-024 Definition 加固（乐观锁 + 原子性）设计

日期：2026-08-03 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-017 closeout §7/§9「M2 乐观版本锁（update/setStatus 无 version 条件）+ PATCH 同体非单事务」+ SPEC-018/019/020/021/022/023 承接
设计权威：本文档 ｜ 前置：SPEC-017（approval-definition-service CRUD + approval.manage）+ SPEC-019（forward 乐观锁先例 updateMany version 守卫）

## 1. 背景与目标

`approval-definition-service` 的 `updateDefinition`/`setDefinitionStatus` 存在两个 SPEC-017 评审遗留的并发正确性缺陷：

1. **M2 无乐观版本锁**：update/setStatus 在事务外 `findUnique` 读 version，事务内 `update({where:{code}})` **无 version 条件**——并发双更新时后写覆盖前写，审计 `fromVersion` 失真（无数据损坏，但并发正确性弱）。
2. **PATCH 同体非单事务**：controller `updateDefinition`（PATCH）在「同体 update+status」时两次独立 service 调用（两个事务）——极端进程中断半应用风险（SPEC-017 Task 2 披露，SPEC-018-023 承接）。

**目标**：①updateDefinition/setDefinitionStatus 加**乐观版本锁**（`updateMany({code, version}, ...)` count=0 → 409 `APPROVAL_STATE_INVALID`，沿 SPEC-019 forward 守卫先例）；②新增 **service 组合方法**（`updateDefinitionWithStatus` 单事务包裹 update+status），controller PATCH 同体改调组合方法——**真原子性**。**零结构变更**。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 乐观锁 | `updateDefinition`/`setDefinitionStatus` 的 `update` → `updateMany({code, version: existing.version}, data)`；count=0 → 409 `APPROVAL_STATE_INVALID`（并发竞争，沿 SPEC-019 forwardTask :541-552 同型） |
| D2 | fromVersion 审计 | 审计 `fromVersion` 用锁前读取的 `existing.version`（保证与更新前一致）；锁后 count=0 时审计不落（抛 409） |
| D3 | 组合方法 | 新增 `updateDefinitionWithStatus(code, input)`（controller PATCH 同体调用）：单 `$transaction` 内——白名单解析 + 校验 + **updateDefinition 核心逻辑（含乐观锁）** + **setDefinitionStatus 核心逻辑（含乐观锁）**——两次 updateMany 在同一事务，进程中断全或无 |
| D4 | 控制器重构 | `controller/approval.ts` updateDefinition：PATCH 同体（含 status）→ 调 `updateDefinitionWithStatus`；仅 update 字段 → 调 `updateDefinition`；仅 status → 调 `setDefinitionStatus`——**三分支明确，同体真原子** |
| D5 | 幂等 | 组合方法内 updateMany 各带 version 守卫；若 update 成功 status 失败（同事务回滚）——全或无；重复调用（同 version 已变更）→ 409 |
| D6 | 兼容 | 单字段/单 status PATCH 路径（controller 分支）行为不变；`updateDefinition`/`setDefinitionStatus` 公开方法签名不变（组合方法为新增） |
| D7 | 零结构变更 | 无迁移/模型/权限/事件/路由变更 |

## 3. 服务层（approval-definition-service）

### 3.1 updateDefinition 乐观锁

```ts
const updated = await this.prisma.$transaction(async tx => {
  const flipped = await tx.approvalDefinition.updateMany({
    where: { code: definitionCode, version: existing.version },
    data,  // 含 version increment
  });
  if (flipped.count === 0) {
    throw new ApprovalError(APPROVAL_ERROR_CODES.APPROVAL_STATE_INVALID, 409, 'approval definition state changed concurrently');
  }
  const row = await tx.approvalDefinition.findUniqueOrThrow({ where: { code: definitionCode } });
  await tx.operationLog.create({ ...newValues 含 fromVersion: existing.version, toVersion: existing.version + 1... });
  return row;
});
```

### 3.2 setDefinitionStatus 乐观锁

同 3.1 模式（`updateMany({code, version}, {status, version increment})` + count=0 → 409 + 审计 fromStatus/toStatus）。

### 3.3 updateDefinitionWithStatus（组合方法）

```ts
async updateDefinitionWithStatus(code: string, input: UpdateDefinitionWithStatusInput): Promise<ApprovalDefinitionView> {
  // input: { name?, formSchema?, approverRule?, nodeSchema?, status? }——至少一项
  // 单事务：解析白名单 → 校验 → updateMany(update 字段 + version) → 若 status 存在 updateMany(status + version) → 审计（两段合并）→ 返回视图
  // 注意：update 与 status 各 bump version——两段 version 条件都用锁前读的 existing.version（第一段后 version+1，第二段基于 updated.version）
  // 进程中断 → 单事务回滚全或无
}
```

**version 语义**：组合方法内 update+status 两段各 bump version（同 PATCH 同体当前行为——update +1 + status +1 = +2）；第二段乐观锁基于第一段后的版本（事务内重读）。

## 4. 控制器重构（controller/approval.ts updateDefinition）

```ts
// PATCH :code——三分支
const hasUpdateFields = body 含 name/formSchema/approverRule/nodeSchema 任一;
const hasStatus = body.status !== undefined;
if (hasUpdateFields && hasStatus) {
  return service.updateDefinitionWithStatus(code, body);  // 同体真原子（原两次调用）
}
if (hasUpdateFields) return service.updateDefinition(code, body);
return service.setDefinitionStatus(code, body.status);  // 仅 status（现状保留）
```

**移除同体两次调用**（原 controller 先 update 后 setStatus 两事务）→ 改单组合方法单事务。

## 5. 测试策略

| 层 | 用例 |
|---|---|
| 服务（乐观锁） | update 并发竞争 409（version 不符 count=0）/ setStatus 并发竞争 409 / update 成功审计 fromVersion 正确 / 既有 update/setStatus 零回归 |
| 服务（组合方法） | 同体 update+status 单事务成功（视图 + version +2 + 审计两段）/ 同体进程中断语义（单事务回滚——模拟 status 失败 update 回滚，或 update 失败 status 不执行）/ 仅 update / 仅 status 经组合方法 |
| 控制器 | PATCH 同体调组合方法（单事务）/ 仅 update 调 updateDefinition / 仅 status 调 setStatus / 404/400/409 透传 |
| 回归 | approval 域既有（instance 73 + definition 17 + api 23 + policy/catalog 34 + events 15）全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 6. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15/路由 11 全不变；后端测试 +N（乐观锁 ~4 + 组合方法 ~4 + 控制器 ~2）。

## 7. 范围边界（明确 OUT）

- 导入导出/复制（Definition 加固余项）——另行。
- createDefinition 乐观锁（新建无并发版本问题）——不需要。
- getActiveDefinition/listDefinitions 只读——不变。
- 审批中心深化其他（超时自动升级动作等）——另行。

## 8. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D7 | 见 §2 | 无人值守自主立项（用户授权） |
