# SPEC-018 审批会签（节点内全部通过）设计

日期：2026-08-03 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-016/017 closeout §9「审批中心深化余项——会签（节点内多人并行）」
设计权威：本文档 ｜ 前置：SPEC-016（nodeSchema 多级链 + currentNode + 节点内任一通过）+ SPEC-017（Definition CRUD + approval.manage）

## 1. 背景与目标

SPEC-016 已实现**节点内任一通过**（ANY）：节点内首个审批人 APPROVE 即定稿/推进，余 PENDING task 全 CANCELLED。但业务需**会签**（节点内全部通过才放行）——如合同变更需主管+财务双签、重大支出需多合伙人联签。

**目标**：nodeSchema 节点扩展 `mode`（`'ANY'` 缺省=任一通过向后兼容；`'ALL'`=全部通过），processTask 在 ALL 模式下首个 APPROVE 不推进（等节点内全部 APPROVED 才推进下一节点/定稿），前端节点状态显示会签语义。**零结构变更**（迁移 26/模型 60/权限 122/事件 15 不变；nodeSchema 是 Json 列，mode 字段随配置数据走，无 schema 变更）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | mode 字段 | 节点结构 `{name, approverRule, mode?}`——`mode` ∈ `'ANY'|'ALL'`，**缺省 `'ANY'`**（既有 5 种子 + 既有自定义 nodeSchema 零行为变化，向后兼容） |
| D2 | ANY 语义保持 | mode 缺省/'ANY' → 现有行为：首个 APPROVE 定稿/推进，余 PENDING CANCELLED（零改动） |
| D3 | ALL 语义 | mode='ALL' → 首个（及后续非最后）APPROVE **仅翻转该 task**，实例停留当前节点（currentNode 不变、零推进、零 completed 事件、不创建下节点 Task）；**最后一个** PENDING task APPROVE → 推进/定稿（同 ANY 的推进/定稿路径） |
| D4 | REJECT 语义 | 任意节点、任意 mode REJECT → 仍定稿 REJECTED（当前+未来 PENDING CANCELLED）——REJECT 一票否决，不变 |
| D5 | 自审校验 | 不变：申请人 ∈ 节点审批人集 → 409（apply 节点[0] + 推进时下节点） |
| D6 | 推进判定 | processTask 翻转后：若当前节点 mode==='ALL' **且** 该节点仍有 PENDING task（即非最后一个）→ 停留当前节点，实例仍 PENDING，无推进无 completed；否则走既有推进/定稿分支 |
| D7 | 校验 | buildApprovalChain/definition-service 校验：mode 若存在必须 ∈ {'ANY','ALL'}，否则 `APPROVAL_ASSIGNEE_INVALID` 400（畸形配置防静默） |
| D8 | 版本语义 | 每个 APPROVE 都 version+1（task 翻转 + 实例在推进/定稿时 version+1；ALL 中途 APPROVE 仅 task version+1，实例 version 不变） |
| D9 | 幂等 | 不变：已处理 task 重放返回现状零事件；推进 callbackKey 重放返回推进后状态 |
| D10 | 前端 | 详情弹窗节点进度 + 节点内 task 表已逐条显示状态（PENDING/APPROVED/REJECTED/CANCELLED）——ALL 模式下部分已签部分待签自然呈现；节点 tag 语义补「会签（全部通过）」标注 |
| D11 | 零结构变更 | nodeSchema Json 配置数据，无 schema/迁移/权限/事件/路由变更 |

## 3. 服务层（approval-instance-service processTask）

### 3.1 节点结构扩展

```ts
interface ApprovalChainNode {
  name: string;
  approverRule: Prisma.JsonValue;
  mode?: 'ANY' | 'ALL';   // SPEC-018：缺省 ANY
}
```

`buildApprovalChain` 增校验：逐节点 mode 若存在且 ∉ {'ANY','ALL'} → `APPROVAL_ASSIGNEE_INVALID` 400。`ApprovalChainSource`/`buildApprovalChain` 签名不变（消费方零改动）。

### 3.2 processTask 分支（:297-366 推进段前插入 ALL 判定）

翻转 task 后、进入既有推进/定稿分支前：

```ts
// SPEC-018 会签：当前节点 mode==='ALL' 且该节点仍有 PENDING task（非最后）→ 停留当前节点。
if (target === 'APPROVED' && !isFinalNode) {
  const currentNode = instance.currentNode;
  const node = chain[currentNode];
  if (node.mode === 'ALL') {
    const remainingPending = await tx.approvalTask.count({
      where: { instanceId: instance.id, nodeName: node.name, status: 'PENDING' },
    });
    if (remainingPending > 0) {
      // 会签未满：仅翻转当前 task，实例停留，零推进零 completed。审计 toStatus PENDING + mode ALL。
      await tx.operationLog.create({ ...action:'APPROVAL_PROCESS', newValues:{fromStatus:'PENDING', toStatus:'PENDING', currentNode, mode:'ALL', hasReason} });
      if (idempotencyKey) { await tx.callbackAction.create({...result:{status:'PENDING', currentNode}}); }
      return this.loadInstanceView(tx, instance.id);
    }
  }
  // 既有推进分支（含 ANY / ALL 最后一人）...
}
```

- ALL 中途 APPROVE：不取消兄弟 PENDING（仅翻转自身）；实例 currentNode 不变、version 不变；零 completed 事件。
- ALL 最后一 APPROVE（remainingPending===0）：走既有推进分支（取消当前节点余 PENDING——此时仅自己刚 APPROVED，无余；下节点解析/自审/创建 task + currentNode++）。
- 末节点 ALL 最后一 APPROVE：走既有定稿分支（APPROVED + completed）。
- **注**：ALL 模式下节点内并行 APPROVE 由实例行 FOR UPDATE 串行化——每次翻转后重查 remainingPending，判定一致。

### 3.3 既有 ANY 零回归

mode 缺省/'ANY' 节点不进入 ALL 分支，既有推进/定稿语义逐字不变（`node.mode === 'ALL'` 为 false 短路）。

## 4. 定义管理校验（approval-definition-service 扩展）

`assertNodeSchemaValid` 增：逐节点 `mode` 若存在且 ∉ {'ANY','ALL'} → `APPROVAL_ASSIGNEE_INVALID` 400（与 buildApprovalChain 同型本地镜像）。create/update 定义时即拒畸形 mode。

## 5. 前端（ApprovalCenterPage 节点显示）

- 详情弹窗节点进度链 `nodeStateMeta`/`renderTaskGroups`：节点 tag 补语义——node.mode==='ALL' 时节点名旁加 `Tag('会签', 'purple')`（提示该节点需全部通过）。
- 节点内 task 表已逐条显示状态（PENDING 待处理/APPROVED 已通过）——ALL 会签部分已签部分待签自然呈现，无需改分组逻辑。
- **前端数据来源**：`ApprovalInstanceView` 当前**不含 nodeSchema**（视图未投影 nodeSchema——SPEC-016 仅投影 currentNode）。会签标注需 nodeSchema 的 mode——**需视图 +nodeSchema（或节点 mode 摘要）**，前端才能显示「会签」Tag。
  - 决策：`ApprovalDefinitionView` 已含 nodeSchema（SPEC-016）；`ApprovalInstanceView` 加 `nodeSchema`（定义投影透传，沿 approval-types 投影既有形态）——Task 2 落地。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| 服务（processTask） | ALL 首 APPROVE 停留（currentNode 不变/余 PENDING 保留/零推进/零 completed/审计 mode ALL）/ ALL 全部 APPROVE 后推进（currentNode++ + 下节点 Task）/ ALL 末节点全签定稿 APPROVED / ALL 中 REJECT 一票否决 REJECTED / ANY 缺省向后兼容零回归（既有 48 例）/ ALL 下节点自审 409 回滚 |
| 服务（校验） | buildApprovalChain mode 非法 400 / definition-service create mode 非法 400 |
| 服务（视图） | ApprovalInstanceView +nodeSchema |
| 回归 | approval 域既有（instance 48 + policy/catalog 46 + definition 16 + api 18）全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 7. 计数影响

**零结构变更**：迁移 26/模型 60/权限 122/事件 15/路由 9 全不变；后端测试 +N（会签 ~6）、前端 +M（会签 Tag）。

## 8. 范围边界（明确 OUT）

- 转交/加签/超时升级/表达式审批人/上级规则（审批中心深化余项——另行立项）。
- 会签配置 UI 图形化（前端 JSON 文本编辑已够，沿 SPEC-017 简化形态）。
- 节点级事件（会签节点推进不产 completed——沿既有观测语义）。
- 定义管理乐观锁 M2/同体原子性（SPEC-017 follow-up，另行）。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D11 | 见 §2 | 无人值守自主立项（用户授权） |
