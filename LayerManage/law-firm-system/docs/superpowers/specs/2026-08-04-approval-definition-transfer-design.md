# SPEC-025 审批定义导入导出（Definition Transfer）设计

日期：2026-08-04 ｜ 状态：用户授权无人值守开发（自主推进）｜ 需求来源：SPEC-017/024 closeout §9「Definition 导入导出（配置迁移/批量初始化）」+ 审批中心深化余项
设计权威：本文档 ｜ 前置：SPEC-017（Definition CRUD + approval.manage + code 命名惯例）+ SPEC-024（乐观锁 + 组合方法 + version 前置条件）

## 1. 背景与目标

审批定义（ApprovalDefinition）已具备完整 CRUD + 乐观锁 + 原子性（SPEC-017/024），但**无批量配置迁移能力**——多环境（开发/测试/生产）间同步审批定义、批量初始化新定义，只能逐条手工 create，低效且易错。

**目标**：Definition 导入导出——管理员导出全量审批定义（含 nodeSchema/formSchema/approverRule/code/name/businessType JSON），导入批量创建/更新（按 code upsert，幂等）。**零结构变更**（复用 ApprovalDefinition 既有字段 + create/update 校验）。

## 2. 核心决策

| # | 决策 | 值 |
|---|---|---|
| D1 | 权限 | 导出/导入挂 **`approval.manage`**（定义管理权限——create/update 已用，扩展至批量） |
| D2 | 导出 | `exportDefinitions()`：全量含 DISABLED，按 code 升序，返回 JSON 数组（每个含 code/name/businessType/formSchema/approverRule/nodeSchema/version/status）——配置迁移的完整快照 |
| D3 | 导入 | `importDefinitions(input)`：批量 upsert（按 code）——已存在 → update（版本校验可选）；不存在 → create。单事务全或无（任一定义失败整体回滚） |
| D4 | 幂等 | 导入按 code upsert：已存在且 version 匹配 → 更新；已存在但 version 前置条件不符（若提供 version）→ 409；重复导入不产生重复（按 code 唯一） |
| D5 | 校验 | 逐定义复用 create/update 校验（code 命名惯例/name/formSchema/approverRule/nodeSchema mode）；单条失败 → 400 整事务回滚 |
| D6 | 批量限制 | 单次导入上限（如 100 条）——防超大请求；超限 → 400 |
| D7 | 路由 | `GET /definitions/export`（approval.manage，导出）/ `POST /definitions/import`（approval.manage，导入）——字面量先于 /:code |
| D8 | 前端 | 「定义管理」Tab 增「导出」按钮（下载 JSON）+「导入」按钮（上传 JSON 文件）——approval.manage 门控 |
| D9 | 审计 | 导入落 operation_log（action APPROVAL_DEFINITION_IMPORT，newValues 含 count/summary）；导出为读操作不落审计 |
| D10 | 零结构变更 | 无迁移/模型/权限/事件/路由表变更（+2 路由非结构变更） |

## 3. 服务层（approval-definition-service）

### 3.1 exportDefinitions()

```ts
async exportDefinitions(): Promise<ApprovalDefinitionView[]> {
  this.authorization.requireAction(this.authorizationContext, 'approval.manage');
  return this.listAllDefinitions();  // 全量含 DISABLED，code 升序——复用既有
}
```

### 3.2 importDefinitions(input)

```ts
interface ImportDefinitionsInput {
  definitions: Array<{
    code: string; name: string; businessType: ApprovalBusinessType;
    formSchema: FormSchemaSpec; approverRule: RuleSpec;
    nodeSchema?: JsonValue | null;
    version?: number;   // 可选——已存在时前置条件；缺省沿用当前
    status?: 'ACTIVE' | 'DISABLED';
  }>;
}

async importDefinitions(input: ImportDefinitionsInput): Promise<{ imported: number; updated: number }> {
  this.authorization.requireAction(this.authorizationContext, 'approval.manage');
  // assertExactKeys + normalize definitions 数组（上限 100）
  return this.prisma.$transaction(async tx => {
    let imported = 0, updated = 0;
    for (const def of input.definitions) {
      const existing = await tx.approvalDefinition.findUnique({ where: { code: def.code } });
      if (existing) {
        // update（复用 updateDefinition 校验 + version 前置条件：def.version 提供且 !== existing.version → 409）
        await updateDefinitionTx(tx, def.code, { name, formSchema, approverRule, nodeSchema, status, version: def.version });
        updated += 1;
      } else {
        // create（复用 createDefinition 校验）
        await createDefinitionTx(tx, def);
        imported += 1;
      }
    }
    // 审计 APPROVAL_DEFINITION_IMPORT（count/summary）
    return { imported, updated };
  });
}
```

**单事务全或无**：任一定义校验失败/version 冲突 → 整事务回滚零写入（D3/D4/D5）。
**幂等**：重复导入同 payload → 同 code upsert 不重复（D4）。

### 3.3 复用校验

import 逐定义复用 createDefinition/updateDefinition 的校验逻辑（code 命名惯例 `^[A-Z][A-Z0-9_]{0,99}$`/formSchema/approverRule/nodeSchema mode）——抽取内部 tx 版本或事务内直接调用（实现时按既有结构，避免重复校验逻辑）。

## 4. 控制器 + 路由

- `controller/approval.ts` +`exportDefinitions`（GET /definitions/export）+ `importDefinitions`（POST /definitions/import，body {definitions: [...]}）——approval.manage。
- `router.ts` +2 条（字面量 `GET /definitions/export`/`POST /definitions/import` 先于 `PATCH /definitions/:code`）——approval 域路由 11→**13**。

## 5. 前端（ApprovalCenterPage 定义管理 Tab）

- **导出**：按钮 → `exportDefinitions()` 下载 JSON 文件（Blob + a.download）。
- **导入**：按钮 → 文件选择（.json）→ 解析 → `importDefinitions({definitions})` → 成功 message + 刷新列表；失败 message.error（业务码）+ 展示错误。
- **api/approval.ts** +`exportDefinitions`/`importDefinitions` + `ImportDefinitionsInput` 类型。
- 既有 28 例零回归。

## 6. 测试策略

| 层 | 用例 |
|---|---|
| 服务（export） | 导出全量含 DISABLED + code 升序 / 无 manage → 403 |
| 服务（import） | 批量 create（新建 N 条）/ 批量 upsert（已存在更新 version+1）/ 幂等重复导入不重复 / version 前置条件不符 409 / 单条畸形 400 整事务回滚零写入 / 上限 100 超限 400 / 审计 IMPORT |
| 路由 | GET /export 门禁 + POST /import 门禁 + 字面量优先 |
| 回归 | approval 域既有（definition 24 + instance 73 + api 26 + policy/catalog 34 + events 15）全绿 |

闸门纪律沿用：串行 `--test-concurrency=1`、`127.0.0.1:55433`、pg_stat_activity 探针、`_test` 库 + `ALLOW_TEST_DB_RESET=true`、55432 禁触。

## 7. 计数影响

**零结构变更**：迁移 26/模型 60/权限 124/事件 15 全不变；路由 approval 域 11→**13**（+2 export/import 非结构变更）；后端测试 +N（export ~2 + import ~6 + 路由 ~2）、前端 +M。

## 8. 范围边界（明确 OUT）

- 导入导出的格式版本/兼容校验（跨版本迁移）——另行。
- 导入时关联角色/权限供给（仅定义，角色已有）——另行。
- 增量/选择性导出（按 code/businessType 筛选）——另行。
- 前端图形化导入编辑器——JSON 文件上传即可。

## 9. 决策记录

| # | 决策 | 裁决 |
|---|---|---|
| D1-D10 | 见 §2 | 无人值守自主立项（用户授权） |
